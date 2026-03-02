using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace GameHubDesktop.Services
{
    public static class FixGamesDataService
    {
        private const string FIX_GAMES_URL = "https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/fix_games.json";
        private const int CACHE_TTL_HOURS = 24;
        
        private static readonly string CacheDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GameHub");
        private static readonly string CacheFile = Path.Combine(CacheDir, "fix_games.json");
        private static readonly string MetaFile = Path.Combine(CacheDir, "fix_games_meta.json");
        
        private static object? _cachedData = null;
        private static DateTime? _lastLoadTime = null;
        private static readonly object _lock = new object();

        public static Action<string>? Log { get; set; }
        private static void LogInfo(string message)
        {
            try { Log?.Invoke($"[FixGamesDataService] {message}"); } catch { }
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

        public static async Task<object?> GetFixGamesDataAsync(bool forceRefresh = false, Action<int, string>? progressCallback = null)
        {
            lock (_lock)
            {
                // Return cached in-memory if available and not expired
                if (!forceRefresh && _cachedData != null && _lastLoadTime.HasValue)
                {
                    var age = DateTime.UtcNow - _lastLoadTime.Value;
                    if (age.TotalHours < CACHE_TTL_HOURS)
                    {
                        progressCallback?.Invoke(100, "Data dari memori");
                        return _cachedData;
                    }
                }
            }

            var cacheValid = !forceRefresh && IsCacheValid();

            if (cacheValid)
            {
                try
                {
                    progressCallback?.Invoke(50, "Memuat dari cache disk...");
                    var data = LoadFromDisk();
                    if (data != null)
                    {
                        lock (_lock)
                        {
                            _cachedData = data;
                            _lastLoadTime = DateTime.UtcNow;
                        }
                        progressCallback?.Invoke(100, "Data dimuat dari cache");
                        return data;
                    }

                    cacheValid = false;
                }
                catch (Exception ex)
                {
                    cacheValid = false;
                    LogInfo($"Failed to load from disk cache: {ex.Message}");
                }
            }

            if (forceRefresh)
            {
                LogInfo("Force refresh requested, downloading latest fix_games.json");
            }
            else
            {
                LogInfo("Cache expired atau tidak valid (>=24 jam), downloading latest fix_games.json");
            }

            // Download fresh data
            try
            {
                LogInfo("Downloading fix_games.json from GitHub");
                progressCallback?.Invoke(10, "Memulai download...");
                var downloadResult = await DownloadDataAsync(progressCallback);
                if (downloadResult.HasValue && downloadResult.Value.Data != null)
                {
                    var data = downloadResult.Value.Data;
                    try
                    {
                        progressCallback?.Invoke(95, "Menyimpan ke cache...");
                        SaveToDisk(data, downloadResult.Value.ETag, downloadResult.Value.LastModified);
                        LogInfo("Fix games data saved to disk cache");
                        progressCallback?.Invoke(100, "Selesai!");
                    }
                    catch (Exception ex)
                    {
                        LogInfo($"Failed to save to disk: {ex.Message}");
                    }

                    lock (_lock)
                    {
                        _cachedData = data;
                        _lastLoadTime = DateTime.UtcNow;
                    }
                    return data;
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
                                _cachedData = stale;
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

        private static void SaveToDisk(object data, string? eTag = null, string? lastModified = null)
        {
            try
            {
                var json = JsonSerializer.Serialize(data, new JsonSerializerOptions
                {
                    WriteIndented = false
                });
                File.WriteAllText(CacheFile, json);

                var meta = new CacheMeta
                {
                    Timestamp = DateTime.UtcNow,
                    ETag = eTag,
                    LastModified = lastModified
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

        private static async Task<(object? Data, string? ETag, string? LastModified)?> DownloadDataAsync(Action<int, string>? progressCallback = null)
        {
            using var http = new HttpClient();
            http.Timeout = TimeSpan.FromMinutes(2);

            try
            {
                var requestUrl = FIX_GAMES_URL;
                if (requestUrl.Contains("raw.githubusercontent.com"))
                {
                    requestUrl += $"?t={DateTime.UtcNow.Ticks}";
                }

                using var req = new HttpRequestMessage(HttpMethod.Get, requestUrl);
                req.Headers.Add("User-Agent", "GameHub/1.0");
                req.Headers.Add("Cache-Control", "no-cache");
                req.Headers.Add("Pragma", "no-cache");
                
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
                using var reader = new StreamReader(stream);
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
                        var percent = 30 + (int)((totalRead * 60.0) / totalBytes); // 30-90% for download
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
                        var percent = 30 + (int)Math.Min(60, (totalRead / 10000.0) * 60); // Estimate based on KB downloaded
                        if (percent > lastPercent + 5)
                        {
                            lastPercent = percent;
                            progressCallback?.Invoke(percent, $"Mengunduh {FormatBytes(totalRead)}...");
                        }
                    }
                }

                progressCallback?.Invoke(90, "Memproses data...");
                var json = buffer.ToString();
                var data = JsonSerializer.Deserialize<object>(json, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                progressCallback?.Invoke(95, "Menyimpan ke cache...");
                
                // Get ETag and LastModified from response (before disposing)
                string? eTag = resp.Headers.ETag?.Tag;
                string? lastModified = resp.Content.Headers.LastModified?.ToString("R");
                
                LogInfo($"Downloaded fix_games.json successfully ({FormatBytes(json.Length)})");
                return (data, eTag, lastModified);
            }
            catch (Exception ex)
            {
                LogInfo($"DownloadDataAsync error: {ex.Message}");
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

        public static void ClearCache()
        {
            try
            {
                lock (_lock)
                {
                    _cachedData = null;
                    _lastLoadTime = null;
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

