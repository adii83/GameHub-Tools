using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace GameHubDesktop.Services
{
    public static class GitHubRawService
    {
        private const string GITHUB_RAW_URL = "https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/steam_data.json.gz";
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
                    // Optimasi: Load di background thread untuk tidak block UI
                    var raw = await Task.Run(() => LoadFromDisk());
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

            // Check if server file has changed (ETag/LastModified check)
            // PERBAIKAN: Jika forceRefresh = true, skip ETag check dan langsung download
            // Jika forceRefresh = false, cek ETag untuk hemat bandwidth
            bool needsDownload = forceRefresh;
            string? serverETag = null;
            string? serverLastModified = null;
            
            if (!forceRefresh)
            {
                try
                {
                    var serverHeaders = await CheckServerHeadersAsync();
                    if (serverHeaders != null)
                    {
                        serverETag = serverHeaders.Value.ETag;
                        serverLastModified = serverHeaders.Value.LastModified;
                        
                        // Load cached meta to compare
                        if (File.Exists(MetaFile))
                        {
                            try
                            {
                                var metaJson = File.ReadAllText(MetaFile);
                                var cachedMeta = JsonSerializer.Deserialize<CacheMeta>(metaJson);
                                
                                if (cachedMeta != null)
                                {
                                    // Compare ETag first (most reliable)
                                    if (!string.IsNullOrWhiteSpace(serverETag) && 
                                        !string.IsNullOrWhiteSpace(cachedMeta.ETag) &&
                                        serverETag.Equals(cachedMeta.ETag, StringComparison.Ordinal))
                                    {
                                        LogInfo("Server file unchanged (ETag match), using cache");
                                        needsDownload = false;
                                    }
                                    // Fallback to LastModified if ETag not available
                                    else if (string.IsNullOrWhiteSpace(serverETag) &&
                                             !string.IsNullOrWhiteSpace(serverLastModified) &&
                                             !string.IsNullOrWhiteSpace(cachedMeta.LastModified) &&
                                             serverLastModified.Equals(cachedMeta.LastModified, StringComparison.Ordinal))
                                    {
                                        LogInfo("Server file unchanged (LastModified match), using cache");
                                        needsDownload = false;
                                    }
                                    else
                                    {
                                        LogInfo($"Server file changed (ETag/LastModified mismatch), downloading...");
                                    }
                                }
                            }
                            catch (Exception ex)
                            {
                                LogInfo($"Error checking cache meta: {ex.Message}, will download");
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    LogInfo($"Error checking server headers: {ex.Message}, will download");
                }
            }
            else
            {
                LogInfo("Force refresh requested, skipping ETag check and downloading...");
            }

            // If file unchanged, return cached data
            if (!needsDownload && File.Exists(CacheFile))
            {
                try
                {
                    progressCallback?.Invoke(100, "File tidak berubah, menggunakan cache");
                    var cached = LoadFromDisk();
                    if (cached != null)
                    {
                        lock (_lock)
                        {
                            _cachedRaw = cached;
                            _lastLoadTime = DateTime.UtcNow;
                            _metadataIndex = null;
                        }
                        // Update meta timestamp (keep ETag/LastModified)
                        if (File.Exists(MetaFile))
                        {
                            try
                            {
                                var metaJson = File.ReadAllText(MetaFile);
                                var meta = JsonSerializer.Deserialize<CacheMeta>(metaJson);
                                if (meta != null)
                                {
                                    meta.Timestamp = DateTime.UtcNow; // Update timestamp only
                                    var updatedMetaJson = JsonSerializer.Serialize(meta);
                                    File.WriteAllText(MetaFile, updatedMetaJson);
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
                LogInfo("Downloading dataset from GitHub");
                progressCallback?.Invoke(10, "Memulai download...");
                var downloadResult = await DownloadRawAsync(progressCallback);
                if (downloadResult.HasValue && downloadResult.Value.Data != null)
                {
                    var raw = downloadResult.Value.Data;
                    try
                    {
                        progressCallback?.Invoke(95, "Menyimpan ke cache...");
                        // Optimasi: Save di background thread untuk tidak block
                        await Task.Run(() => SaveToDisk(raw, downloadResult.Value.ETag, downloadResult.Value.LastModified));
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

                // Optimasi: Gunakan async file read dengan buffer, lalu parse dengan options yang dioptimasi
                var json = File.ReadAllText(CacheFile);
                
                // Optimasi JSON parsing: gunakan JsonDocument untuk lazy parsing (lebih cepat untuk file besar)
                // Tapi tetap return object untuk kompatibilitas
                return JsonSerializer.Deserialize<object>(json, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true,
                    MaxDepth = 64, // Limit depth untuk keamanan
                    AllowTrailingCommas = true
                });
            }
            catch (Exception ex)
            {
                LogInfo($"LoadFromDisk error: {ex.Message}");
                return null;
            }
        }

        private static void SaveToDisk(object raw, string? eTag = null, string? lastModified = null)
        {
            try
            {
                // Optimasi: Serialize dengan options yang dioptimasi untuk performa
                var json = JsonSerializer.Serialize(raw, new JsonSerializerOptions
                {
                    WriteIndented = false,
                    MaxDepth = 64,
                    AllowTrailingCommas = true
                });
                
                // Optimasi: Gunakan async file write dengan buffer (non-blocking)
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

        private static async Task<(string? ETag, string? LastModified)?> CheckServerHeadersAsync()
        {
            using var http = new HttpClient();
            http.Timeout = TimeSpan.FromSeconds(10);

            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Head, GITHUB_RAW_URL);
                req.Headers.Add("User-Agent", "GameHub/1.0");
                
                using var resp = await http.SendAsync(req);
                if (!resp.IsSuccessStatusCode)
                {
                    LogInfo($"HEAD request failed with status: {(int)resp.StatusCode}");
                    return null;
                }

                var eTag = resp.Headers.ETag?.Tag;
                var lastModified = resp.Content.Headers.LastModified?.ToString("R"); // RFC 1123 format
                
                return (eTag, lastModified);
            }
            catch (Exception ex)
            {
                LogInfo($"CheckServerHeadersAsync error: {ex.Message}");
                return null;
            }
        }

        private static async Task<(object? Data, string? ETag, string? LastModified)?> DownloadRawAsync(Action<int, string>? progressCallback = null)
        {
            using var http = new HttpClient();
            http.Timeout = TimeSpan.FromSeconds(25); // Faster timeout to prevent UI hang

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
                
                using var stream = await resp.Content.ReadAsStreamAsync();
                
                // Optimasi: Download gzip file to memory dengan buffer yang lebih besar untuk performa lebih baik
                progressCallback?.Invoke(30, totalBytes > 0 ? $"Mengunduh file terkompresi {FormatBytes(totalBytes)}..." : "Mengunduh file terkompresi...");
                using var memoryStream = new MemoryStream();
                var buffer = new byte[65536]; // Optimasi: Buffer 64KB (lebih besar = lebih sedikit I/O calls)
                long totalRead = 0;
                int lastPercent = 30;

                while (true)
                {
                    var read = await stream.ReadAsync(buffer, 0, buffer.Length);
                    if (read == 0) break;
                    
                    await memoryStream.WriteAsync(buffer, 0, read);
                    totalRead += read;

                    if (totalBytes > 0)
                    {
                        var percent = 30 + (int)((totalRead * 50.0) / totalBytes); // 30-80% for download
                        if (percent > lastPercent + 10) // Optimasi: Update every 10% (kurangi frequency)
                        {
                            lastPercent = percent;
                            var msg = $"Mengunduh {FormatBytes(totalRead)} / {FormatBytes(totalBytes)} ({percent}%)";
                            progressCallback?.Invoke(percent, msg);
                        }
                    }
                    else
                    {
                        // Unknown size, show indeterminate progress
                        var percent = 30 + (int)Math.Min(50, (totalRead / 1000000.0) * 50); // Estimate based on MB downloaded
                        if (percent > lastPercent + 10) // Optimasi: Update every 10%
                        {
                            lastPercent = percent;
                            progressCallback?.Invoke(percent, $"Mengunduh {FormatBytes(totalRead)}...");
                        }
                    }
                }

                progressCallback?.Invoke(80, "Mendekompresi file...");
                memoryStream.Position = 0;
                
                // Optimasi: Decompress gzip dengan buffer yang lebih besar untuk performa lebih baik
                string json;
                using (var gzipStream = new GZipStream(memoryStream, CompressionMode.Decompress, leaveOpen: false))
                using (var reader = new StreamReader(gzipStream, System.Text.Encoding.UTF8, true, 8192)) // Buffer 8KB
                {
                    json = await reader.ReadToEndAsync();
                }

                progressCallback?.Invoke(90, "Memproses data...");
                // Optimasi: Parse JSON dengan options yang dioptimasi
                var raw = JsonSerializer.Deserialize<object>(json, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true,
                    MaxDepth = 64,
                    AllowTrailingCommas = true
                });

                progressCallback?.Invoke(95, "Menyimpan ke cache...");
                
                // Get ETag and LastModified from response (before disposing resp)
                string? eTag = resp.Headers.ETag?.Tag;
                string? lastModified = resp.Content.Headers.LastModified?.ToString("R");
                
                LogInfo($"Downloaded dataset successfully ({FormatBytes(json.Length)})");
                return (raw, eTag, lastModified);
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

