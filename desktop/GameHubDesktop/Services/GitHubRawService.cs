using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace GameHubDesktop.Services
{
    public static class GitHubRawService
    {
        private const string GITHUB_RAW_URL = "https://raw.githubusercontent.com/adii83/steam-metadata-archive/refs/heads/main/steam_data.json";
        private const int CACHE_TTL_HOURS = 12;
        private static readonly string CacheDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GameHub");
        private static readonly string CacheFile = Path.Combine(CacheDir, "github_raw_full.json");
        private static readonly string MetaFile = Path.Combine(CacheDir, "github_raw_full_meta.json");
        
        private static object? _cachedRaw = null;
        private static DateTime? _lastLoadTime = null;
        private static readonly object _lock = new object();
        
        // In-memory index: appid -> metadata object (untuk lookup cepat tanpa deserialize ulang)
        private static Dictionary<int, object>? _metadataIndex = null;

        public static Action<string>? Log { get; set; }
        private static void LogInfo(string message)
        {
            try { Log?.Invoke($"[GitHubRawService] {message}"); } catch { }
        }

        public static void Initialize()
        {
            try
            {
                if (!Directory.Exists(CacheDir))
                {
                    Directory.CreateDirectory(CacheDir);
                    LogInfo($"Created cache directory: {CacheDir}");
                }
            }
            catch (Exception ex)
            {
                LogInfo($"Failed to initialize cache directory: {ex.Message}");
            }
        }

        public static async Task<object?> GetRawDatasetAsync(bool forceRefresh = false, Action<int, string>? progressCallback = null)
        {
            lock (_lock)
            {
                // Return cached in-memory if available and not expired
                if (!forceRefresh && _cachedRaw != null && _lastLoadTime.HasValue)
                {
                    var age = DateTime.UtcNow - _lastLoadTime.Value;
                    if (age.TotalHours < CACHE_TTL_HOURS)
                    {
                        // Build index jika belum ada (untuk lookup cepat nanti)
                        if (_metadataIndex == null)
                        {
                            BuildMetadataIndex(_cachedRaw);
                        }
                        progressCallback?.Invoke(100, "Data dari memori");
                        return _cachedRaw;
                    }
                }
            }

            // Check disk cache
            if (!forceRefresh && IsCacheValid())
            {
                try
                {
                    progressCallback?.Invoke(50, "Memuat dari cache disk...");
                    var raw = LoadFromDisk();
                    if (raw != null)
                    {
                    lock (_lock)
                    {
                        _cachedRaw = raw;
                        _lastLoadTime = DateTime.UtcNow;
                        _metadataIndex = null; // Reset index
                    }
                    // Build index di background (tidak blocking, akan siap saat GetMetadataForAppid dipanggil)
                    _ = Task.Run(() => BuildMetadataIndex(raw));
                    progressCallback?.Invoke(100, "Data dimuat dari cache");
                    return raw;
                    }
                }
                catch (Exception ex)
                {
                    LogInfo($"Failed to load from disk cache: {ex.Message}");
                }
            }

            // Download fresh data
            try
            {
                LogInfo("Downloading dataset from GitHub");
                progressCallback?.Invoke(10, "Memulai download...");
                var raw = await DownloadRawAsync(progressCallback);
                if (raw != null)
                {
                    try
                    {
                        progressCallback?.Invoke(95, "Menyimpan ke cache...");
                        SaveToDisk(raw);
                        LogInfo("Dataset saved to disk cache");
                        progressCallback?.Invoke(100, "Selesai!");
                    }
                    catch (Exception ex)
                    {
                        LogInfo($"Failed to save to disk: {ex.Message}");
                    }

                    lock (_lock)
                    {
                        _cachedRaw = raw;
                        _lastLoadTime = DateTime.UtcNow;
                        _metadataIndex = null; // Reset index, akan di-build saat pertama kali GetMetadataForAppid dipanggil
                    }
                    return raw;
                }
            }
            catch (Exception ex)
            {
                LogInfo($"Failed to download: {ex.Message}");
                // Try to return stale cache if download fails
                if (File.Exists(CacheFile))
                {
                    try
                    {
                        var stale = LoadFromDisk();
                        if (stale != null)
                        {
                            lock (_lock)
                            {
                                _cachedRaw = stale;
                                _lastLoadTime = DateTime.UtcNow;
                                _metadataIndex = null; // Reset index, akan di-build saat pertama kali GetMetadataForAppid dipanggil
                            }
                            return stale;
                        }
                    }
                    catch { }
                }
            }

            return null;
        }

        private static bool IsCacheValid()
        {
            try
            {
                if (!File.Exists(CacheFile) || !File.Exists(MetaFile))
                    return false;

                var metaJson = File.ReadAllText(MetaFile);
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

        private static object? LoadFromDisk()
        {
            try
            {
                if (!File.Exists(CacheFile))
                    return null;

                var json = File.ReadAllText(CacheFile);
                return JsonSerializer.Deserialize<object>(json, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });
            }
            catch (Exception ex)
            {
                LogInfo($"LoadFromDisk error: {ex.Message}");
                return null;
            }
        }

        private static void SaveToDisk(object raw)
        {
            try
            {
                var json = JsonSerializer.Serialize(raw, new JsonSerializerOptions
                {
                    WriteIndented = false
                });
                File.WriteAllText(CacheFile, json);

                var meta = new CacheMeta
                {
                    Timestamp = DateTime.UtcNow,
                    ETag = null,
                    LastModified = null
                };
                var metaJson = JsonSerializer.Serialize(meta);
                File.WriteAllText(MetaFile, metaJson);
            }
            catch (Exception ex)
            {
                LogInfo($"SaveToDisk error: {ex.Message}");
                throw;
            }
        }

        private static async Task<object?> DownloadRawAsync(Action<int, string>? progressCallback = null)
        {
            using var http = new HttpClient();
            http.Timeout = TimeSpan.FromMinutes(5); // Large file may take time

            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, GITHUB_RAW_URL);
                req.Headers.Add("User-Agent", "GameHub/1.0");
                
                progressCallback?.Invoke(20, "Menghubungkan ke server...");
                using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
                if (!resp.IsSuccessStatusCode)
                {
                    LogInfo($"Download failed with status: {(int)resp.StatusCode}");
                    return null;
                }

                var totalBytes = resp.Content.Headers.ContentLength ?? 0;
                progressCallback?.Invoke(30, totalBytes > 0 ? $"Mengunduh {FormatBytes(totalBytes)}..." : "Mengunduh...");

                using var stream = await resp.Content.ReadAsStreamAsync();
                using var reader = new System.IO.StreamReader(stream);
                var buffer = new System.Text.StringBuilder();
                var charBuffer = new char[8192];
                long totalRead = 0;
                int lastPercent = 30;

                while (true)
                {
                    var read = await reader.ReadAsync(charBuffer, 0, charBuffer.Length);
                    if (read == 0) break;
                    
                    buffer.Append(charBuffer, 0, read);
                    totalRead += read;

                    if (totalBytes > 0)
                    {
                        var percent = 30 + (int)((totalRead * 70.0) / totalBytes);
                        if (percent > lastPercent + 5) // Update every 5%
                        {
                            lastPercent = percent;
                            var msg = $"Mengunduh {FormatBytes(totalRead)} / {FormatBytes(totalBytes)} ({percent}%)";
                            progressCallback?.Invoke(percent, msg);
                        }
                    }
                    else
                    {
                        // Unknown size, show indeterminate progress
                        var percent = 30 + (int)Math.Min(60, (totalRead / 1000000.0) * 60); // Estimate based on MB downloaded
                        if (percent > lastPercent + 5)
                        {
                            lastPercent = percent;
                            progressCallback?.Invoke(percent, $"Mengunduh {FormatBytes(totalRead)}...");
                        }
                    }
                }

                progressCallback?.Invoke(90, "Memproses data...");
                var json = buffer.ToString();
                var raw = JsonSerializer.Deserialize<object>(json, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                progressCallback?.Invoke(95, "Menyimpan ke cache...");
                LogInfo($"Downloaded dataset successfully ({FormatBytes(json.Length)})");
                return raw;
            }
            catch (Exception ex)
            {
                LogInfo($"DownloadRawAsync error: {ex.Message}");
                return null;
            }
        }

        private static string FormatBytes(long bytes)
        {
            string[] sizes = { "B", "KB", "MB", "GB" };
            double len = bytes;
            int order = 0;
            while (len >= 1024 && order < sizes.Length - 1)
            {
                order++;
                len = len / 1024;
            }
            return $"{len:0.##} {sizes[order]}";
        }

        // Build in-memory index dari dataset (sekali saja, untuk lookup cepat)
        private static void BuildMetadataIndex(object? raw)
        {
            if (raw == null) return;
            
            lock (_lock)
            {
                if (_metadataIndex != null) return; // Already indexed
                
                _metadataIndex = new Dictionary<int, object>();
                
                try
                {
                    if (raw is JsonElement jsonElement)
                    {
                        if (jsonElement.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var item in jsonElement.EnumerateArray())
                            {
                                int? id = null;
                                if (item.TryGetProperty("appid", out var idProp))
                                    id = idProp.GetInt32();
                                else if (item.TryGetProperty("id", out var idProp2))
                                    id = idProp2.GetInt32();
                                
                                if (id.HasValue)
                                {
                                    try
                                    {
                                        var metadata = JsonSerializer.Deserialize<object>(item.GetRawText());
                                        if (metadata != null && !_metadataIndex.ContainsKey(id.Value))
                                        {
                                            _metadataIndex[id.Value] = metadata;
                                        }
                                    }
                                    catch { }
                                }
                            }
                        }
                        else if (jsonElement.ValueKind == JsonValueKind.Object)
                        {
                            foreach (var prop in jsonElement.EnumerateObject())
                            {
                                if (int.TryParse(prop.Name, out var id))
                                {
                                    try
                                    {
                                        var metadata = JsonSerializer.Deserialize<object>(prop.Value.GetRawText());
                                        if (metadata != null && !_metadataIndex.ContainsKey(id))
                                        {
                                            _metadataIndex[id] = metadata;
                                        }
                                    }
                                    catch { }
                                }
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    LogInfo($"Error building metadata index: {ex.Message}");
                    _metadataIndex = null;
                }
            }
        }

        public static async Task<object?> GetMetadataForAppidAsync(int appid)
        {
            try
            {
                // PRIORITY 1: Cek override data dulu (game baru dari override)
                // Cek user override (prioritas tertinggi)
                var userOverride = OverrideDataService.GetUserOverride();
                if (userOverride != null && userOverride.TryGetValue(appid.ToString(), out var userData))
                {
                    LogInfo($"GetMetadataForAppid: found in user override for appid={appid}");
                    return userData;
                }
                
                // Cek global override
                var globalOverride = await OverrideDataService.GetGlobalOverrideAsync(false);
                if (globalOverride != null && globalOverride.TryGetValue(appid.ToString(), out var globalData))
                {
                    LogInfo($"GetMetadataForAppid: found in global override for appid={appid}");
                    return globalData;
                }

                // PRIORITY 2: Cek raw data (steam_data.json)
                // Cek index dulu (O(1) lookup, sangat cepat!)
                lock (_lock)
                {
                    if (_metadataIndex != null && _metadataIndex.TryGetValue(appid, out var cached))
                    {
                        LogInfo($"GetMetadataForAppid: found in raw data index for appid={appid}");
                        return cached;
                    }
                }

                // Jika belum ada di index, load dataset dan build index
                var raw = await GetRawDatasetAsync(false);
                if (raw == null) return null;

                // Build index jika belum ada
                BuildMetadataIndex(raw);

                // Cek lagi setelah build index
                lock (_lock)
                {
                    if (_metadataIndex != null && _metadataIndex.TryGetValue(appid, out var found))
                    {
                        LogInfo($"GetMetadataForAppid: found in raw data after index build for appid={appid}");
                        return found;
                    }
                }
                
                // Fallback: search manual di raw data
                if (raw is JsonElement jsonElement)
                {
                    if (jsonElement.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in jsonElement.EnumerateArray())
                        {
                            if (item.TryGetProperty("appid", out var idProp) && idProp.GetInt32() == appid)
                            {
                                LogInfo($"GetMetadataForAppid: found in raw data array for appid={appid}");
                                return JsonSerializer.Deserialize<object>(item.GetRawText());
                            }
                            if (item.TryGetProperty("id", out var idProp2) && idProp2.GetInt32() == appid)
                            {
                                LogInfo($"GetMetadataForAppid: found in raw data array (id field) for appid={appid}");
                                return JsonSerializer.Deserialize<object>(item.GetRawText());
                            }
                        }
                    }
                    else if (jsonElement.ValueKind == JsonValueKind.Object)
                    {
                        var idStr = appid.ToString();
                        if (jsonElement.TryGetProperty(idStr, out var appData))
                        {
                            LogInfo($"GetMetadataForAppid: found in raw data object for appid={appid}");
                            return JsonSerializer.Deserialize<object>(appData.GetRawText());
                        }
                    }
                }

                LogInfo($"GetMetadataForAppid: not found anywhere for appid={appid}");
                return null;
            }
            catch (Exception ex)
            {
                LogInfo($"GetMetadataForAppid error for appid={appid}: {ex.Message}");
                return null;
            }
        }

        public static void ClearCache()
        {
            try
            {
                lock (_lock)
                {
                    _cachedRaw = null;
                    _lastLoadTime = null;
                    _metadataIndex = null; // Clear index juga
                }
                
                if (File.Exists(CacheFile))
                {
                    File.Delete(CacheFile);
                    LogInfo("Cache file deleted");
                }
                
                if (File.Exists(MetaFile))
                {
                    File.Delete(MetaFile);
                    LogInfo("Meta file deleted");
                }
                
                LogInfo("Cache cleared successfully");
            }
            catch (Exception ex)
            {
                LogInfo($"Failed to clear cache: {ex.Message}");
            }
        }

        private class CacheMeta
        {
            public DateTime? Timestamp { get; set; }
            public string? ETag { get; set; }
            public string? LastModified { get; set; }
        }
    }
}

