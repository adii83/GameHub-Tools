using System;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace GameHubDesktop.Services
{
    public static class HomeDataService
    {
        private const string POPULAR_GAMES_URL = "https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/appid_populer.json";
        private const string NEW_FIX_GAMES_URL = "https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/new_fix_games.json";
        private const int CACHE_TTL_HOURS = 24;

        private static readonly string CacheDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GameHub");
        private static readonly string PopularCacheFile = Path.Combine(CacheDir, "appid_populer.json");
        private static readonly string PopularMetaFile = Path.Combine(CacheDir, "appid_populer_meta.json");
        private static readonly string NewFixCacheFile = Path.Combine(CacheDir, "new_fix_games.json");
        private static readonly string NewFixMetaFile = Path.Combine(CacheDir, "new_fix_games_meta.json");

        private class CacheState
        {
            public object? Data { get; set; }
            public DateTime? LastLoadTime { get; set; }
        }

        private static readonly CacheState _popularCache = new CacheState();
        private static readonly CacheState _newFixCache = new CacheState();
        
        private static readonly object _popularLock = new object();
        private static readonly object _newFixLock = new object();

        public static Action<string>? Log { get; set; }
        private static void LogInfo(string message)
        {
            try { Log?.Invoke($"[HomeDataService] {message}"); } catch { }
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

        public static async Task<object?> GetPopularGamesAsync(bool forceRefresh = false, Action<int, string>? progressCallback = null)
        {
            return await GetGenericDataAsync(
                forceRefresh, 
                POPULAR_GAMES_URL, 
                PopularCacheFile, 
                PopularMetaFile, 
                _popularLock, 
                _popularCache, 
                "appid_populer", 
                progressCallback);
        }

        public static async Task<object?> GetNewFixGamesAsync(bool forceRefresh = false, Action<int, string>? progressCallback = null)
        {
            return await GetGenericDataAsync(
                forceRefresh, 
                NEW_FIX_GAMES_URL, 
                NewFixCacheFile, 
                NewFixMetaFile, 
                _newFixLock, 
                _newFixCache, 
                "new_fix_games", 
                progressCallback);
        }

        private static async Task<object?> GetGenericDataAsync(
            bool forceRefresh, 
            string url, 
            string cacheFile, 
            string metaFile, 
            object syncLock, 
            CacheState cacheState,
            string label,
            Action<int, string>? progressCallback)
        {
            lock (syncLock)
            {
                if (!forceRefresh && cacheState.Data != null && cacheState.LastLoadTime.HasValue)
                {
                    var age = DateTime.UtcNow - cacheState.LastLoadTime.Value;
                    if (age.TotalHours < CACHE_TTL_HOURS)
                    {
                        progressCallback?.Invoke(100, "Data dari memori");
                        return cacheState.Data;
                    }
                }
            }

            var cacheValid = !forceRefresh && IsCacheValid(cacheFile, metaFile);

            if (cacheValid)
            {
                try
                {
                    progressCallback?.Invoke(50, "Memuat dari cache disk...");
                    var data = LoadFromDisk(cacheFile);
                    if (data != null)
                    {
                        lock (syncLock)
                        {
                            cacheState.Data = data;
                            cacheState.LastLoadTime = DateTime.UtcNow;
                        }
                        progressCallback?.Invoke(100, "Data dimuat dari cache");
                        return data;
                    }
                    cacheValid = false;
                }
                catch (Exception ex)
                {
                    cacheValid = false;
                    LogInfo($"Failed to load {label} from disk cache: {ex.Message}");
                }
            }

            LogInfo($"{(forceRefresh ? "Force refresh requested" : "Cache expired")}, downloading {label}.json");

            try
            {
                LogInfo($"Downloading {label}.json from GitHub");
                progressCallback?.Invoke(10, "Memulai download...");
                var downloadResult = await DownloadDataAsync(url, progressCallback);
                if (downloadResult.HasValue && downloadResult.Value.Data != null)
                {
                    var data = downloadResult.Value.Data;
                    try
                    {
                        progressCallback?.Invoke(95, "Menyimpan ke cache...");
                        SaveToDisk(data, cacheFile, metaFile, downloadResult.Value.ETag, downloadResult.Value.LastModified);
                        LogInfo($"{label} data saved to disk cache");
                        progressCallback?.Invoke(100, "Selesai!");
                    }
                    catch (Exception ex)
                    {
                        LogInfo($"Failed to save {label} to disk: {ex.Message}");
                    }

                    lock (syncLock)
                    {
                        cacheState.Data = data;
                        cacheState.LastLoadTime = DateTime.UtcNow;
                    }
                    return data;
                }
            }
            catch (Exception ex)
            {
                LogInfo($"Failed to download {label}: {ex.Message}");
                if (File.Exists(cacheFile))
                {
                    try
                    {
                        var stale = LoadFromDisk(cacheFile);
                        if (stale != null)
                        {
                            lock (syncLock)
                            {
                                cacheState.Data = stale;
                                cacheState.LastLoadTime = DateTime.UtcNow;
                            }
                            return stale;
                        }
                    }
                    catch { }
                }
            }

            return null;
        }

        private static bool IsCacheValid(string cacheFile, string metaFile)
        {
            try
            {
                if (!File.Exists(cacheFile) || !File.Exists(metaFile))
                    return false;

                var metaJson = File.ReadAllText(metaFile);
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

        private static object? LoadFromDisk(string cacheFile)
        {
            try
            {
                if (!File.Exists(cacheFile))
                    return null;

                var json = File.ReadAllText(cacheFile);
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

        private static void SaveToDisk(object data, string cacheFile, string metaFile, string? eTag = null, string? lastModified = null)
        {
            try
            {
                var json = JsonSerializer.Serialize(data, new JsonSerializerOptions
                {
                    WriteIndented = false
                });
                File.WriteAllText(cacheFile, json);

                var meta = new CacheMeta
                {
                    Timestamp = DateTime.UtcNow,
                    ETag = eTag,
                    LastModified = lastModified
                };
                var metaJson = JsonSerializer.Serialize(meta);
                File.WriteAllText(metaFile, metaJson);
            }
            catch (Exception ex)
            {
                LogInfo($"SaveToDisk error: {ex.Message}");
                throw;
            }
        }

        private static async Task<(object? Data, string? ETag, string? LastModified)?> DownloadDataAsync(string url, Action<int, string>? progressCallback = null)
        {
            using var http = new HttpClient();
            http.Timeout = TimeSpan.FromSeconds(10);

            try
            {
                var requestUrl = url;
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
                progressCallback?.Invoke(30, "Mengunduh...");

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
                        var percent = 30 + (int)((totalRead * 60.0) / totalBytes);
                        if (percent > lastPercent + 5)
                        {
                            lastPercent = percent;
                            progressCallback?.Invoke(percent, $"Mengunduh {totalRead / 1024} KB...");
                        }
                    }
                    else
                    {
                        var percent = 30 + (int)Math.Min(60, (totalRead / 10000.0) * 60);
                        if (percent > lastPercent + 5)
                        {
                            lastPercent = percent;
                            progressCallback?.Invoke(percent, $"Mengunduh {totalRead / 1024} KB...");
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
                
                string? eTag = resp.Headers.ETag?.Tag;
                string? lastModified = resp.Content.Headers.LastModified?.ToString("R");
                
                LogInfo($"Downloaded successfully ({json.Length} bytes)");
                return (data, eTag, lastModified);
            }
            catch (Exception ex)
            {
                LogInfo($"DownloadDataAsync error: {ex.Message}");
                return null;
            }
        }

        public static void ClearCache()
        {
            try
            {
                lock (_popularLock)
                {
                    _popularCache.Data = null;
                    _popularCache.LastLoadTime = null;
                }
                lock (_newFixLock)
                {
                    _newFixCache.Data = null;
                    _newFixCache.LastLoadTime = null;
                }
                
                if (File.Exists(PopularCacheFile)) File.Delete(PopularCacheFile);
                if (File.Exists(PopularMetaFile)) File.Delete(PopularMetaFile);
                if (File.Exists(NewFixCacheFile)) File.Delete(NewFixCacheFile);
                if (File.Exists(NewFixMetaFile)) File.Delete(NewFixMetaFile);
                
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

