using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace GameHubDesktop.Services
{
    public static class OverrideDataService
    {
        // URL untuk override data global (dari GitHub)
        private const string OVERRIDE_DATA_URL = "https://raw.githubusercontent.com/adii83/steam-metadata-archive/refs/heads/main/override_data.json";
        private const int CACHE_TTL_HOURS = 6; // Override lebih sering di-update (6 jam)
        
        private static readonly string CacheDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GameHub");
        private static readonly string OverrideCacheFile = Path.Combine(CacheDir, "override_data.json");
        private static readonly string OverrideMetaFile = Path.Combine(CacheDir, "override_data_meta.json");
        private static readonly string UserOverrideFile = Path.Combine(CacheDir, "user_override_data.json");
        
        private static Dictionary<string, object>? _cachedOverride = null;
        private static DateTime? _lastLoadTime = null;
        private static readonly object _lock = new object();
        
        // Clear in-memory cache (untuk force reload setelah update)
        public static void ClearMemoryCache()
        {
            lock (_lock)
            {
                _cachedOverride = null;
                _lastLoadTime = null;
            }
        }

        public static Action<string>? Log { get; set; }
        private static void LogInfo(string message)
        {
            try { Log?.Invoke($"[OverrideDataService] {message}"); } catch { }
        }

        public static void Initialize()
        {
            try
            {
                if (!Directory.Exists(CacheDir))
                {
                    Directory.CreateDirectory(CacheDir);
                }
            }
            catch (Exception ex)
            {
                LogInfo($"Failed to initialize cache directory: {ex.Message}");
            }
        }

        // Get global override data (from GitHub, cached on disk)
        public static async Task<Dictionary<string, object>?> GetGlobalOverrideAsync(bool forceRefresh = false)
        {
            lock (_lock)
            {
                // Return cached in-memory if available and not expired
                if (!forceRefresh && _cachedOverride != null && _lastLoadTime.HasValue)
                {
                    var age = DateTime.UtcNow - _lastLoadTime.Value;
                    if (age.TotalHours < CACHE_TTL_HOURS)
                    {
                        return _cachedOverride;
                    }
                }
            }

            // Check disk cache
            if (!forceRefresh && IsCacheValid())
            {
                try
                {
                    var overrideData = LoadFromDisk();
                    if (overrideData != null)
                    {
                        lock (_lock)
                        {
                            _cachedOverride = overrideData;
                            _lastLoadTime = DateTime.UtcNow;
                        }
                        return overrideData;
                    }
                }
                catch (Exception ex)
                {
                    LogInfo($"Failed to load from disk cache: {ex.Message}");
                }
            }

            // Check if server file has changed before downloading
            // PERBAIKAN: Jika forceRefresh = true, skip check dan langsung download
            bool needsDownload = forceRefresh;
            if (!forceRefresh)
            {
                try
                {
                    var hasUpdate = await CheckForUpdateAsync();
                    if (!hasUpdate)
                    {
                        LogInfo("Server file unchanged, using cache");
                        needsDownload = false;
                    }
                    else
                    {
                        LogInfo("Server file changed, downloading...");
                    }
                }
                catch (Exception ex)
                {
                    LogInfo($"Error checking for update: {ex.Message}, will download");
                }
            }
            else
            {
                LogInfo("Force refresh requested, downloading...");
            }

            // If file unchanged, return cached data
            if (!needsDownload && File.Exists(OverrideCacheFile))
            {
                try
                {
                    var cached = LoadFromDisk();
                    if (cached != null)
                    {
                        lock (_lock)
                        {
                            _cachedOverride = cached;
                            _lastLoadTime = DateTime.UtcNow; // Update timestamp
                        }
                        // Update meta timestamp
                        if (File.Exists(OverrideMetaFile))
                        {
                            try
                            {
                                var metaJson = File.ReadAllText(OverrideMetaFile);
                                var meta = JsonSerializer.Deserialize<CacheMeta>(metaJson);
                                if (meta != null)
                                {
                                    meta.Timestamp = DateTime.UtcNow;
                                    var updatedMetaJson = JsonSerializer.Serialize(meta);
                                    File.WriteAllText(OverrideMetaFile, updatedMetaJson);
                                }
                            }
                            catch { }
                        }
                        return cached;
                    }
                }
                catch (Exception ex)
                {
                    LogInfo($"Error loading cached file: {ex.Message}, will download");
                }
            }

            // Download fresh data
            try
            {
                LogInfo("Downloading override data from GitHub");
                var overrideData = await DownloadOverrideAsync();
                if (overrideData != null)
                {
                    try
                    {
                        SaveToDisk(overrideData);
                        LogInfo("Override data saved to disk cache");
                    }
                    catch (Exception ex)
                    {
                        LogInfo($"Failed to save to disk: {ex.Message}");
                    }

                    lock (_lock)
                    {
                        _cachedOverride = overrideData;
                        _lastLoadTime = DateTime.UtcNow;
                    }
                    return overrideData;
                }
            }
            catch (Exception ex)
            {
                LogInfo($"Failed to download: {ex.Message}");
                // Try to return stale cache if download fails
                if (File.Exists(OverrideCacheFile))
                {
                    try
                    {
                        var stale = LoadFromDisk();
                        if (stale != null)
                        {
                            lock (_lock)
                            {
                                _cachedOverride = stale;
                                _lastLoadTime = DateTime.UtcNow;
                            }
                            return stale;
                        }
                    }
                    catch { }
                }
            }

            return null;
        }

        // Check if there's a newer version available on GitHub
        // Method: Download file, normalize JSON, dan compare content dengan cache di disk
        public static async Task<bool> CheckForUpdateAsync()
        {
            try
            {
                // Jika tidak ada cache, pasti ada update
                if (!File.Exists(OverrideCacheFile) || !File.Exists(OverrideMetaFile))
                {
                    LogInfo("CheckForUpdate: No cache found, update available");
                    return true;
                }

                using var http = new HttpClient();
                http.Timeout = TimeSpan.FromSeconds(15);
                
                // Download file untuk compare (file kecil, tidak masalah)
                using var req = new HttpRequestMessage(HttpMethod.Get, OVERRIDE_DATA_URL);
                req.Headers.Add("User-Agent", "GameHub/1.0");
                
                var resp = await http.SendAsync(req);
                if (!resp.IsSuccessStatusCode)
                {
                    LogInfo($"CheckForUpdate: HTTP {resp.StatusCode}, assuming no update");
                    return false;
                }

                var serverJson = await resp.Content.ReadAsStringAsync();
                if (string.IsNullOrWhiteSpace(serverJson))
                {
                    LogInfo("CheckForUpdate: Server returned empty, assuming no update");
                    return false;
                }

                // Compare dengan cache di disk (normalize JSON dulu untuk ignore formatting)
                try
                {
                    var cachedJson = File.ReadAllText(OverrideCacheFile);
                    
                    // Normalize kedua JSON (deserialize lalu serialize lagi dengan format sama)
                    // Ini mengabaikan perbedaan whitespace/indentation
                    try
                    {
                        var serverData = JsonSerializer.Deserialize<Dictionary<string, object>>(serverJson);
                        var cachedData = JsonSerializer.Deserialize<Dictionary<string, object>>(cachedJson);
                        
                        if (serverData == null || cachedData == null)
                        {
                            // Jika salah satu null, compare string langsung
                            var hasUpdateNull = !string.Equals(cachedJson, serverJson, StringComparison.Ordinal);
                            LogInfo($"CheckForUpdate: One of the data is null, using string comparison: {hasUpdateNull}");
                            return hasUpdateNull;
                        }
                        
                        // Normalize: serialize dengan format yang sama (compact, no indentation)
                        var normalizedServer = JsonSerializer.Serialize(serverData, new JsonSerializerOptions { WriteIndented = false });
                        var normalizedCached = JsonSerializer.Serialize(cachedData, new JsonSerializerOptions { WriteIndented = false });
                        
                        var hasUpdateNormalized = !string.Equals(normalizedCached, normalizedServer, StringComparison.Ordinal);
                        if (hasUpdateNormalized)
                        {
                            LogInfo($"CheckForUpdate: Content differs after normalization, update available (cached: {cachedData.Count} entries, server: {serverData.Count} entries)");
                        }
                        else
                        {
                            LogInfo($"CheckForUpdate: Content is identical, no update needed");
                        }
                        return hasUpdateNormalized;
                    }
                    catch (JsonException jsonEx)
                    {
                        // Jika JSON invalid, fallback ke string comparison
                        LogInfo($"CheckForUpdate: JSON parse error, using string comparison: {jsonEx.Message}");
                        var hasUpdateString = !string.Equals(cachedJson, serverJson, StringComparison.Ordinal);
                        if (hasUpdateString)
                        {
                            LogInfo($"CheckForUpdate: File content differs (string comparison), update available");
                        }
                        return hasUpdateString;
                    }
                }
                catch (Exception ex)
                {
                    LogInfo($"CheckForUpdate: Error comparing cache: {ex.Message}, assuming update available");
                    return true; // Jika error compare, assume ada update untuk safety
                }
            }
            catch (Exception ex)
            {
                LogInfo($"CheckForUpdate error: {ex.Message}");
                return false;
            }
        }

        // Get last update time of cached override
        public static DateTime? GetLastUpdateTime()
        {
            try
            {
                if (!File.Exists(OverrideMetaFile))
                    return null;

                var metaJson = File.ReadAllText(OverrideMetaFile);
                var meta = JsonSerializer.Deserialize<CacheMeta>(metaJson);
                return meta?.Timestamp;
            }
            catch
            {
                return null;
            }
        }

        // Get user-specific override (from local file)
        public static Dictionary<string, object>? GetUserOverride()
        {
            try
            {
                if (!File.Exists(UserOverrideFile))
                    return null;

                var json = File.ReadAllText(UserOverrideFile);
                var data = JsonSerializer.Deserialize<Dictionary<string, object>>(json);
                return data;
            }
            catch (Exception ex)
            {
                LogInfo($"Failed to load user override: {ex.Message}");
                return null;
            }
        }

        // Save user-specific override
        public static void SaveUserOverride(Dictionary<string, object> overrideData)
        {
            try
            {
                var json = JsonSerializer.Serialize(overrideData, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(UserOverrideFile, json);
                LogInfo("User override saved");
            }
            catch (Exception ex)
            {
                LogInfo($"Failed to save user override: {ex.Message}");
            }
        }

        // Merge: User override > Global override > Raw data
        public static Dictionary<string, object> MergeOverrides(
            Dictionary<string, object>? globalOverride,
            Dictionary<string, object>? userOverride)
        {
            var merged = new Dictionary<string, object>();

            // First: Apply global override
            if (globalOverride != null)
            {
                foreach (var kvp in globalOverride)
                {
                    merged[kvp.Key] = kvp.Value;
                }
            }

            // Then: Apply user override (takes priority)
            if (userOverride != null)
            {
                foreach (var kvp in userOverride)
                {
                    merged[kvp.Key] = kvp.Value; // User override overwrites global
                }
            }

            return merged;
        }

        private static bool IsCacheValid()
        {
            try
            {
                if (!File.Exists(OverrideCacheFile) || !File.Exists(OverrideMetaFile))
                    return false;

                var metaJson = File.ReadAllText(OverrideMetaFile);
                var meta = JsonSerializer.Deserialize<CacheMeta>(metaJson);
                if (meta == null || !meta.Timestamp.HasValue)
                    return false;

                var age = DateTime.UtcNow - meta.Timestamp.Value;
                return age.TotalHours < CACHE_TTL_HOURS;
            }
            catch
            {
                return false;
            }
        }

        private static Dictionary<string, object>? LoadFromDisk()
        {
            try
            {
                if (!File.Exists(OverrideCacheFile))
                    return null;

                var json = File.ReadAllText(OverrideCacheFile);
                var data = JsonSerializer.Deserialize<Dictionary<string, object>>(json);
                return data;
            }
            catch (Exception ex)
            {
                LogInfo($"LoadFromDisk error: {ex.Message}");
                return null;
            }
        }

        private static void SaveToDisk(Dictionary<string, object> data)
        {
            try
            {
                var json = JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(OverrideCacheFile, json);

                var meta = new CacheMeta { Timestamp = DateTime.UtcNow };
                var metaJson = JsonSerializer.Serialize(meta);
                File.WriteAllText(OverrideMetaFile, metaJson);
            }
            catch (Exception ex)
            {
                LogInfo($"SaveToDisk error: {ex.Message}");
            }
        }

        private static async Task<Dictionary<string, object>?> DownloadOverrideAsync()
        {
            try
            {
                using var http = new HttpClient();
                http.Timeout = TimeSpan.FromMinutes(2);
                
                using var req = new HttpRequestMessage(HttpMethod.Get, OVERRIDE_DATA_URL);
                req.Headers.Add("User-Agent", "GameHub/1.0");
                
                using var resp = await http.SendAsync(req);
                if (!resp.IsSuccessStatusCode)
                {
                    LogInfo($"Download failed with status: {(int)resp.StatusCode}");
                    return null;
                }

                var json = await resp.Content.ReadAsStringAsync();
                var data = JsonSerializer.Deserialize<Dictionary<string, object>>(json);
                return data;
            }
            catch (Exception ex)
            {
                LogInfo($"DownloadOverrideAsync error: {ex.Message}");
                return null;
            }
        }

        private class CacheMeta
        {
            public DateTime? Timestamp { get; set; }
        }
    }
}

