using System;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace GameHubDesktop.Services
{
    public static class AddGameService
    {
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, System.Threading.CancellationTokenSource> _running = new();
        public static Action<string>? Log { get; set; }
        private static void LogInfo(string message)
        {
            try { Log?.Invoke($"[AddGame] {message}"); } catch { }
        }

        private static string RedactUrl(string url)
        {
            try { var u = new Uri(url); return $"{u.Scheme}://{u.Host}/(disamarkan)"; } catch { return "(url disamarkan)"; }
        }
        private static string RedactPath(string path)
        {
            try {
                if (string.IsNullOrWhiteSpace(path)) return "";
                var name = System.IO.Path.GetFileName(path);
                var root = System.IO.Path.GetPathRoot(path);
                var rootSafe = string.IsNullOrEmpty(root) ? "" : root + "...\\";
                return string.IsNullOrEmpty(name) ? "(path disamarkan)" : rootSafe + name;
            } catch { return "(path disamarkan)"; }
        }

        public static bool IsGameInstalled(string appid)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(appid)) return false;
                var steam = DetectSteamInstallPath(); if (string.IsNullOrEmpty(steam)) return false;
                var dir = Path.Combine(steam, "config", "stplug-in");
                var p1 = Path.Combine(dir, appid + ".lua");
                var p2 = Path.Combine(dir, appid + ".lua.disabled");
                return File.Exists(p1) || File.Exists(p2);
            }
            catch { return false; }
        }

        public static void CancelAdd(string appid, Action<object>? sendToJs = null)
        {
            if (string.IsNullOrWhiteSpace(appid)) return;
            if (_running.TryRemove(appid, out var cts))
            {
                try { cts.Cancel(); } catch { }
                try { cts.Dispose(); } catch { }
                LogInfo($"Pembatalan Add-Game diminta appid={appid}");
                sendToJs?.Invoke(new { type = "AddGameResult", success = false, cancelled = true, error = "Dibatalkan" });
            }
        }

        public static async Task RemoveGameAsync(string appid, Action<object> sendToJs)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(appid))
                {
                    sendToJs(new { type = "RemoveGameResult", success = false, error = "AppID kosong" });
                    return;
                }
                LogInfo($"Mulai Remove-Game appid={appid}");
                var steam = DetectSteamInstallPath();
                if (string.IsNullOrEmpty(steam))
                {
                    LogInfo("Steam tidak ditemukan saat Remove-Game");
                    sendToJs(new { type = "RemoveGameResult", success = false, error = "Steam tidak ditemukan" });
                    return;
                }
                // Cek apakah game terinstall via keberadaan appmanifest_<appid>.acf di salah satu library
                if (IsAppManifestPresent(steam, appid))
                {
                    LogInfo($"Remove-Game diblokir: appmanifest ditemukan untuk appid={appid}");
                    sendToJs(new { type = "RemoveGameResult", success = false, error = "Game masih terinstall", installed = true });
                    return;
                }
                var dir = Path.Combine(steam, "config", "stplug-in");
                int removed = 0;
                foreach (var fn in new[] { appid + ".lua", appid + ".lua.disabled" })
                {
                    var p = Path.Combine(dir, fn);
                    try { if (File.Exists(p)) { File.Delete(p); removed++; LogInfo($"Menghapus {fn} sukses"); } else { LogInfo($"File tidak ditemukan: {fn}"); } } catch (Exception ex) { LogInfo($"Gagal hapus {fn}: {ex.Message}"); }
                }
                sendToJs(new { type = "RemoveGameResult", success = true, removed });
                LogInfo($"Remove-Game selesai removed={removed}");
            }
            catch (Exception ex)
            {
                LogInfo($"Remove-Game gagal: {ex.Message}");
                sendToJs(new { type = "RemoveGameResult", success = false, error = ex.Message });
            }
        }

        public static object ListLibraryGames()
        {
            try
            {
                var steam = DetectSteamInstallPath();
                if (string.IsNullOrEmpty(steam)) return new { type = "LibraryGames", success = false, error = "Steam tidak ditemukan", appids = Array.Empty<string>() };
                var dir = Path.Combine(steam, "config", "stplug-in");
                if (!Directory.Exists(dir)) return new { type = "LibraryGames", success = true, appids = Array.Empty<string>() };
                var list = new System.Collections.Generic.List<string>();
                foreach (var file in Directory.GetFiles(dir, "*.lua", SearchOption.TopDirectoryOnly))
                {
                    var bn = Path.GetFileName(file);
                    var name = Path.GetFileNameWithoutExtension(bn);
                    if (!string.IsNullOrWhiteSpace(name)) list.Add(name);
                }
                LogInfo($"ListLibraryGames menemukan {list.Count} skrip LUA");
                return new { type = "LibraryGames", success = true, appids = list.ToArray() };
            }
            catch (Exception ex)
            {
                LogInfo($"ListLibraryGames gagal: {ex.Message}");
                return new { type = "LibraryGames", success = false, error = ex.Message, appids = Array.Empty<string>() };
            }
        }

        private static bool IsAppManifestPresent(string steamBasePath, string appid)
        {
            try
            {
                // libraryfolders.vdf parsing sederhana: ambil "path" entries; sertakan base path
                var libs = new System.Collections.Generic.List<string>();
                libs.Add(steamBasePath);
                var vdf = Path.Combine(steamBasePath, "steamapps", "libraryfolders.vdf");
                if (File.Exists(vdf))
                {
                    foreach (var raw in File.ReadAllLines(vdf))
                    {
                        var line = raw.Trim();
                        if (line.StartsWith("\"path\"", StringComparison.OrdinalIgnoreCase))
                        {
                            var parts = line.Split('"', StringSplitOptions.RemoveEmptyEntries);
                            if (parts.Length >= 2)
                            {
                                var path = parts[^1].Replace("\\\\", "\\").Trim();
                                try { if (Directory.Exists(path)) libs.Add(path); } catch { }
                            }
                        }
                    }
                }
                foreach (var lib in libs)
                {
                    var manifest = Path.Combine(lib, "steamapps", $"appmanifest_{appid}.acf");
                    if (File.Exists(manifest)) return true;
                }
            }
            catch { }
            return false;
        }

        public static async Task AddGameAsync(string appid, string appRoot, Action<object> sendToJs)
        {
            // variables that must be visible to catch/finally
            string? downloadedZipPath = null;
            string? downloadedProviderDir = null;
            string? partialPath = null;
            var cts = new System.Threading.CancellationTokenSource();
            try
            {
                if (string.IsNullOrWhiteSpace(appid))
                {
                    sendToJs(new { type = "AddGameResult", success = false, error = "AppID kosong" });
                    return;
                }
                LogInfo($"Mulai Add-Game appid={appid}");

                // setup cancellation per appid
                if (_running.ContainsKey(appid))
                {
                    sendToJs(new { type = "AddGameResult", success = false, error = "Proses sedang berjalan" });
                    return;
                }
                if (!_running.TryAdd(appid, cts))
                {
                    sendToJs(new { type = "AddGameResult", success = false, error = "Tidak dapat memulai proses" });
                    try { cts.Dispose(); } catch { }
                    return;
                }

                // api.json di public/data
                string apiJsonPath = Path.Combine(appRoot, "data", "api.json");
                if (!File.Exists(apiJsonPath))
                {
                    LogInfo("api.json tidak ditemukan");
                    sendToJs(new { type = "AddGameResult", success = false, error = "api.json tidak ditemukan" });
                    _running.TryRemove(appid, out _);
                    return;
                }

                using var fs = File.OpenRead(apiJsonPath);
                using var doc = await JsonDocument.ParseAsync(fs);
                var list = doc.RootElement.TryGetProperty("api_list", out var apiList) ? apiList : default;
                if (list.ValueKind != JsonValueKind.Array)
                {
                    LogInfo("Format api.json tidak valid");
                    sendToJs(new { type = "AddGameResult", success = false, error = "Format api.json tidak valid" });
                    _running.TryRemove(appid, out _);
                    return;
                }
                int providerCount = 0; foreach (var _ in list.EnumerateArray()) providerCount++; LogInfo($"Jumlah penyedia API: {providerCount}");

                using var http = new HttpClient();
                http.Timeout = TimeSpan.FromSeconds(30);

                string downloadsRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GameHub", "downloads");
                Directory.CreateDirectory(downloadsRoot);

                foreach (var entry in list.EnumerateArray())
                {
                    if (cts.IsCancellationRequested) throw new OperationCanceledException();
                    string name = entry.TryGetProperty("name", out var nm) ? nm.GetString() ?? "unknown" : "unknown";
                    string urlTmpl = entry.TryGetProperty("url", out var ut) ? ut.GetString() ?? string.Empty : string.Empty;
                    int successCode = entry.TryGetProperty("success_code", out var sc) && sc.TryGetInt32(out var sci) ? sci : 200;
                    int unavailableCode = entry.TryGetProperty("unavailable_code", out var uc) && uc.TryGetInt32(out var uci) ? uci : 404;
                    bool enabled = entry.TryGetProperty("enabled", out var en) && en.ValueKind == JsonValueKind.True;
                    if (!enabled) continue;

                    string url = urlTmpl.Replace("<appid>", appid);
                    LogInfo($"Coba unduh dari penyedia='{name}' url={RedactUrl(url)}");
                    try
                    {
                        using var req = new HttpRequestMessage(HttpMethod.Get, url);
                        req.Headers.UserAgent.ParseAdd("luatools-v61-stplugin-hoe");
                        using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                        LogInfo($"Respon penyedia='{name}' status={(int)resp.StatusCode}");
                        if ((int)resp.StatusCode == successCode)
                        {
                            string safeName = SafeName(name);
                            string targetDir = Path.Combine(downloadsRoot, safeName);
                            Directory.CreateDirectory(targetDir);

                            string ext = GuessExtension(resp, url);
                            string filename = appid + ext;
                            string outPath = Path.Combine(targetDir, filename);
                            partialPath = outPath;

                            using var body = await resp.Content.ReadAsStreamAsync(cts.Token);
                            long? total = resp.Content.Headers.ContentLength;
                            long totalBytes = total ?? 0L;
                            long readBytes = 0L;
                            var buffer = new byte[81920];
                            int lastPct = -1;
                            using (var outFs = File.Create(outPath))
                            {
                                int n;
                                while ((n = await body.ReadAsync(buffer.AsMemory(0, buffer.Length), cts.Token)) > 0)
                                {
                                    await outFs.WriteAsync(buffer, 0, n);
                                    readBytes += n;
                                    if (totalBytes > 0)
                                    {
                                        int pct = (int)Math.Clamp(readBytes * 100.0 / totalBytes, 0, 100);
                                        sendToJs(new { type = "AddGameProgress", phase = "download", percent = pct, appid, provider = name });
                                        if (pct >= lastPct + 10) { lastPct = pct; LogInfo($"Mengunduh {pct}% dari penyedia='{name}'"); }
                                    }
                                    else
                                    {
                                        sendToJs(new { type = "AddGameProgress", phase = "download", percent = -1, appid, provider = name });
                                    }
                                    if (cts.IsCancellationRequested) throw new OperationCanceledException();
                                }
                            }

                            downloadedZipPath = outPath;
                            downloadedProviderDir = targetDir;
                            LogInfo($"Unduhan selesai dari penyedia='{name}' file={RedactPath(downloadedZipPath)}");
                            break;
                            // lanjut ke berikutnya
                        }
                        else
                        {
                            // status lain, lanjut ke berikutnya
                            if ((int)resp.StatusCode == unavailableCode) LogInfo($"Penyedia '{name}' melaporkan tidak tersedia");
                        }
                    }
                    catch (Exception ex) { LogInfo($"Gagal unduh dari penyedia='{name}': {ex.Message}"); }
                }

                if (string.IsNullOrEmpty(downloadedZipPath) || !File.Exists(downloadedZipPath))
                {
                    LogInfo("Semua API gagal atau tidak tersedia");
                    sendToJs(new { type = "AddGameResult", success = false, error = "Semua API gagal atau tidak tersedia" });
                    _running.TryRemove(appid, out _);
                    return;
                }

                // Validasi ZIP
                LogInfo("Memvalidasi file unduhan (cek ZIP)");
                sendToJs(new { type = "AddGameProgress", phase = "validate", percent = 100, appid });
                using (var fh = File.OpenRead(downloadedZipPath))
                {
                    byte[] magic = new byte[4];
                    await fh.ReadAsync(magic, 0, 4, cts.Token);
                    if (!(magic[0] == (byte)'P' && magic[1] == (byte)'K'))
                    {
                        LogInfo("File bukan ZIP yang valid");
                        sendToJs(new { type = "AddGameResult", success = false, error = "File unduhan bukan ZIP" });
                        _running.TryRemove(appid, out _);
                        return;
                    }
                }

                // Install ke Steam
                string steamPath = DetectSteamInstallPath();
                if (string.IsNullOrEmpty(steamPath))
                {
                    LogInfo("Steam tidak ditemukan saat instalasi");
                    sendToJs(new { type = "AddGameResult", success = false, error = "Steam tidak ditemukan" });
                    _running.TryRemove(appid, out _);
                    return;
                }

                sendToJs(new { type = "AddGameProgress", phase = "install", percent = 0, appid });
                if (cts.IsCancellationRequested) throw new OperationCanceledException();
                LogInfo("Menginstal skrip LUA ke folder stplug-in (lokasi disamarkan)");
                string installedPath = InstallLuaFromZip(appid, downloadedZipPath, steamPath);
                LogInfo($"Instalasi selesai untuk appid={appid} file={RedactPath(installedPath)}");
                sendToJs(new { type = "AddGameProgress", phase = "install", percent = 100, appid });

                // Cleanup unduhan
                try
                {
                    if (!string.IsNullOrEmpty(downloadedZipPath) && File.Exists(downloadedZipPath)) File.Delete(downloadedZipPath);
                    if (!string.IsNullOrEmpty(downloadedProviderDir) && Directory.Exists(downloadedProviderDir))
                    {
                        if (Directory.GetFiles(downloadedProviderDir).Length == 0 && Directory.GetDirectories(downloadedProviderDir).Length == 0)
                            Directory.Delete(downloadedProviderDir, false);
                    }
                }
                catch { }

                sendToJs(new { type = "AddGameResult", success = true, path = installedPath });
                LogInfo("Add-Game selesai sukses");
            }
            catch (OperationCanceledException)
            {
                LogInfo("Add-Game dibatalkan oleh pengguna");
                sendToJs(new { type = "AddGameResult", success = false, cancelled = true, error = "Dibatalkan" });
                try
                {
                    if (!string.IsNullOrEmpty(partialPath) && File.Exists(partialPath)) File.Delete(partialPath);
                    if (!string.IsNullOrEmpty(downloadedProviderDir) && Directory.Exists(downloadedProviderDir))
                    {
                        if (Directory.GetFiles(downloadedProviderDir).Length == 0 && Directory.GetDirectories(downloadedProviderDir).Length == 0)
                            Directory.Delete(downloadedProviderDir, false);
                    }
                }
                catch { }
            }
            catch (Exception ex)
            {
                LogInfo($"Add-Game gagal: {ex.Message}");
                sendToJs(new { type = "AddGameResult", success = false, error = ex.Message });
            }
            finally
            {
                // ensure remove token entry and dispose
                if (_running.TryRemove(appid, out var removedCts))
                {
                    try { removedCts?.Dispose(); } catch { }
                }
                else
                {
                    try { cts?.Dispose(); } catch { }
                }
            }
        }

        private static string SafeName(string name)
        {
            var arr = name.ToCharArray();
            var list = new System.Collections.Generic.List<char>(arr.Length);
            foreach (var c in arr)
            {
                if (char.IsLetterOrDigit(c) || c == '-' || c == '_' || c == '.') list.Add(c);
            }
            return new string(list.ToArray()).TrimEnd();
        }

        private static string GuessExtension(HttpResponseMessage resp, string url)
        {
            if (resp.Content.Headers.ContentDisposition?.FileNameStar != null)
            {
                return Path.GetExtension(resp.Content.Headers.ContentDisposition.FileNameStar);
            }
            if (resp.Content.Headers.ContentDisposition?.FileName != null)
            {
                return Path.GetExtension(resp.Content.Headers.ContentDisposition.FileName);
            }
            var ct = resp.Content.Headers.ContentType?.MediaType;
            if (!string.IsNullOrEmpty(ct))
            {
                if (ct.Equals("application/zip", StringComparison.OrdinalIgnoreCase)) return ".zip";
            }
            var ext = Path.GetExtension(url);
            if (!string.IsNullOrEmpty(ext)) return ext;
            return ".bin";
        }

        private static string DetectSteamInstallPath()
        {
            // Try multiple registry views and env variables; cover 32-bit keys
            string?[] candidates = new string?[] {
                // HKCU
                SafeRegGet(Registry.CurrentUser, "Software\\Valve\\Steam", "SteamPath"),
                SafeRegGet(Registry.CurrentUser, "Software\\WOW6432Node\\Valve\\Steam", "SteamPath"),
                // HKLM
                SafeRegGet(Registry.LocalMachine, "Software\\Valve\\Steam", "InstallPath"),
                SafeRegGet(Registry.LocalMachine, "Software\\WOW6432Node\\Valve\\Steam", "InstallPath"),
                // ENV
                Environment.GetEnvironmentVariable("STEAMPATH"),
                Environment.GetEnvironmentVariable("STEAM_PATH"),
                Environment.GetEnvironmentVariable("SteamPath"),
                // Common defaults
                @"C:\\Program Files (x86)\\Steam",
                @"C:\\Program Files\\Steam"
            };
            foreach (var p in candidates)
            {
                try { if (!string.IsNullOrWhiteSpace(p) && Directory.Exists(p)) return p!; } catch { }
            }

            // Try to infer from running process
            try
            {
                var procs = System.Diagnostics.Process.GetProcessesByName("steam");
                foreach (var proc in procs)
                {
                    try
                    {
                        var exe = proc.MainModule?.FileName;
                        if (!string.IsNullOrEmpty(exe))
                        {
                            var dir = Path.GetDirectoryName(exe);
                            if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir)) return dir;
                        }
                    }
                    catch { }
                }
            }
            catch { }
            return string.Empty;
        }

        private static string? SafeRegGet(RegistryKey root, string subKey, string valueName)
        {
            try
            {
                using var k = root.OpenSubKey(subKey);
                var val = k?.GetValue(valueName) as string;
                return val;
            }
            catch { return null; }
        }

        private static string InstallLuaFromZip(string appid, string zipPath, string steamPath)
        {
            if (!File.Exists(zipPath)) throw new FileNotFoundException(zipPath);
            if (string.IsNullOrEmpty(steamPath)) throw new InvalidOperationException("Steam path kosong");

            var targetDir = Path.Combine(steamPath, "config", "stplug-in");
            Directory.CreateDirectory(targetDir);

            var depotcacheDir = Path.Combine(steamPath, "depotcache");
            Directory.CreateDirectory(depotcacheDir);

            using var zf = ZipFile.OpenRead(zipPath);
            int manifestCount = 0;
            foreach (var entry in zf.Entries)
            {
                if (entry.FullName.EndsWith(".manifest", StringComparison.OrdinalIgnoreCase))
                {
                    var outPath = Path.Combine(depotcacheDir, Path.GetFileName(entry.FullName));
                    entry.ExtractToFile(outPath, overwrite: true);
                    manifestCount++;
                }
            }
            LogInfo($"Menyalin manifest: {manifestCount} file");

            System.IO.Compression.ZipArchiveEntry? chosen = null;
            string preferred = appid + ".lua";
            foreach (var e in zf.Entries)
            {
                var bn = Path.GetFileName(e.FullName);
                if (Regex.IsMatch(bn ?? string.Empty, "^\\d+\\.lua$") && bn == preferred)
                { chosen = e; break; }
            }
            if (chosen == null)
            {
                foreach (var e in zf.Entries)
                {
                    var bn = Path.GetFileName(e.FullName);
                    if (Regex.IsMatch(bn ?? string.Empty, "^\\d+\\.lua$"))
                    { chosen = e; break; }
                }
            }
            if (chosen == null) throw new InvalidOperationException("Tidak ada file .lua numerik dalam ZIP");

            using var ms = new MemoryStream();
            using (var s = chosen.Open()) s.CopyTo(ms);
            ms.Position = 0;
            string text;
            using (var sr = new StreamReader(ms, Encoding.UTF8, detectEncodingFromByteOrderMarks: true))
            { text = sr.ReadToEnd(); }

            var sb = new StringBuilder(text.Length + 64);
            using (var reader = new StringReader(text))
            {
                string? line;
                while ((line = reader.ReadLine()) != null)
                {
                    if (Regex.IsMatch(line, "^\\s*setManifestid\\(") && !Regex.IsMatch(line, "^\\s*--"))
                    { sb.Append("--"); sb.AppendLine(line); }
                    else { sb.AppendLine(line); }
                }
            }
            var processed = sb.ToString();
            // Ensure Windows line endings and no UTF-8 BOM
            processed = processed.Replace("\r\n", "\n").Replace("\n", "\r\n");
            LogInfo("Menulis skrip LUA (tanpa BOM, baris Windows)");

            var destFile = Path.Combine(targetDir, appid + ".lua");
            var utf8NoBom = new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
            File.WriteAllText(destFile, processed, utf8NoBom);
            return destFile;
        }
    }
}
