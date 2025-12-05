using System;
using System.Collections.Concurrent;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Text.Json;
using System.Diagnostics;
using Microsoft.Win32;
using System.Windows; // for Application.Current.Dispatcher marshaling

namespace GameHubDesktop.Services
{
    public class OnlineFixService
    {
        private readonly HttpClient _http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = true })
        {
            Timeout = TimeSpan.FromSeconds(60)
        };

        private readonly ConcurrentDictionary<int, CancellationTokenSource> _cts = new();
        private readonly ConcurrentDictionary<int, OnlineFixState> _states = new();

        public Action<string>? Log { get; set; }
        private void LogInfo(string message)
        {
            try { Log?.Invoke($"[OnlineFixService] {message}"); } catch { }
        }
        private static string RedactUrl(string url)
        {
            try { var u = new Uri(url); return $"{u.Scheme}://{u.Host}/(disamarkan)"; } catch { return "(url disamarkan)"; }
        }
        private static string RedactPath(string? path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path)) return "";
                var name = Path.GetFileName(path);
                var root = Path.GetPathRoot(path);
                var rootSafe = string.IsNullOrEmpty(root) ? "" : root + "...\\";
                return string.IsNullOrEmpty(name) ? "(path disamarkan)" : rootSafe + name;
            }
            catch { return "(path disamarkan)"; }
        }

        public async Task<object> CheckAvailabilityAsync(int appid)
        {
            LogInfo($"CheckAvailability mulai appid={appid}");
            var url = $"https://files.luatools.work/OnlineFix1/{appid}.zip";
            var ok = await HeadOrProbeAsync(url);
            if (ok)
            {
                LogInfo($"CheckAvailability tersedia appid={appid} url={RedactUrl(url)}");
                return new { type = "OnlineFixAvailability", appid, available = true, url };
            }
            LogInfo($"CheckAvailability tidak ditemukan appid={appid}");
            return new { type = "OnlineFixAvailability", appid, available = false };
        }

        private async Task<bool> HeadOrProbeAsync(string url)
        {
            // Robust probe with retries and UA
            const int maxAttempts = 3;
            for (int i = 0; i < maxAttempts; i++)
            {
                try
                {
                    using var req = new HttpRequestMessage(HttpMethod.Head, url);
                    req.Headers.UserAgent.ParseAdd("LuaTools/1.0 (+ST-Steam_Plugin)");
                    using var resp = await _http.SendAsync(req);
                    LogInfo($"HEAD percobaan #{i+1} status={(int)resp.StatusCode}");
                    if ((int)resp.StatusCode == 200) return true;
                }
                catch (Exception ex) { LogInfo($"HEAD percobaan #{i+1} error={ex.Message}"); }
                await Task.Delay(200);
                try
                {
                    using var req = new HttpRequestMessage(HttpMethod.Get, url);
                    req.Headers.UserAgent.ParseAdd("LuaTools/1.0 (+ST-Steam_Plugin)");
                    req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(0, 0);
                    using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
                    LogInfo($"GET probe percobaan #{i+1} status={(int)resp.StatusCode}");
                    if ((int)resp.StatusCode == 200) return true;
                }
                catch (Exception ex) { LogInfo($"GET probe percobaan #{i+1} error={ex.Message}"); }
                await Task.Delay(300);
            }
            return false;
        }

        public async Task ApplyAsync(int appid, string url, Func<object, Task> sendToJs, Func<int, string?> resolveInstallPath)
        {
            LogInfo($"Apply mulai appid={appid} url={RedactUrl(url)}");
            // Resolve install path via provided resolver first; fallback to Steam manifests
            var installPath = resolveInstallPath(appid);
            string? gameName = null;
            if (string.IsNullOrWhiteSpace(installPath) || !Directory.Exists(installPath))
            {
                var resolved = ResolveInstallFromSteam(appid);
                installPath = resolved.installPath;
                gameName = resolved.gameName;
            }
            LogInfo($"Resolusi installPath='{RedactPath(installPath)}' gameName='{gameName ?? ""}'");
            if (string.IsNullOrWhiteSpace(installPath) || !Directory.Exists(installPath))
            {
                LogInfo($"Install path not found for appid={appid}");
                await sendToJs(new { type = "OnlineFixResult", appid, success = false, error = "game-not-installed" });
                return;
            }

            var cts = new CancellationTokenSource();
            _cts[appid] = cts;
            var state = new OnlineFixState { Status = "queued", BytesRead = 0, TotalBytes = 0 };
            _states[appid] = state;

            try
            {
                await sendToJs(new { type = "OnlineFixProgress", appid, status = "queued" });
                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.UserAgent.ParseAdd("LuaTools/1.0 (+ST-Steam_Plugin)");
                using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                if (!resp.IsSuccessStatusCode)
                {
                    LogInfo($"Unduh gagal status={(int)resp.StatusCode} appid={appid}");
                    await sendToJs(new { type = "OnlineFixResult", appid, success = false, error = "unavailable" });
                    return;
                }
                var total = resp.Content.Headers.ContentLength ?? 0;
                LogInfo($"Mengunduh ukuran={total} byte appid={appid}");
                state.Status = "downloading"; state.TotalBytes = total; state.BytesRead = 0;
                await sendToJs(new { type = "OnlineFixProgress", appid, status = state.Status, bytesRead = state.BytesRead, totalBytes = state.TotalBytes });

                var tempDir = Path.Combine(Path.GetTempPath(), "gamehub-onlinefix");
                Directory.CreateDirectory(tempDir);
                var zipPath = Path.Combine(tempDir, $"fix_{appid}.zip");

                using (var input = await resp.Content.ReadAsStreamAsync(cts.Token))
                using (var output = File.Create(zipPath))
                {
                    var buffer = new byte[81920];
                    int read;
                    int lastLogPct = -1;
                    int lastSentPct = -1;
                    var lastTick = DateTime.UtcNow;
                    while ((read = await input.ReadAsync(buffer.AsMemory(0, buffer.Length), cts.Token)) > 0)
                    {
                        await output.WriteAsync(buffer.AsMemory(0, read), cts.Token);
                        state.BytesRead += read;
                        int pct = -1;
                        if (total > 0) pct = (int)Math.Floor((state.BytesRead * 100.0) / total);
                        // Throttle UI events: send only when pct increased or 250ms passed
                        var now = DateTime.UtcNow;
                        if ((pct >= 0 && pct >= lastSentPct + 1) || (now - lastTick).TotalMilliseconds > 250)
                        {
                            await sendToJs(new { type = "OnlineFixProgress", appid, status = state.Status, bytesRead = state.BytesRead, totalBytes = state.TotalBytes });
                            lastTick = now;
                            if (pct >= 0) lastSentPct = pct;
                        }
                        // Log every 10% only
                        if (pct >= 0 && pct >= lastLogPct + 10) { lastLogPct = pct; LogInfo($"Mengunduh {pct}% appid={appid}"); }
                        if (cts.IsCancellationRequested) throw new OperationCanceledException();
                    }
                }

                state.Status = "extracting";
                await sendToJs(new { type = "OnlineFixProgress", appid, status = state.Status });

                var extracted = new System.Collections.Generic.List<string>();
                bool isUnsteam = false;
                try
                {
                    using (var za = ZipFile.OpenRead(zipPath))
                    {
                        bool allUnderAppId = true;
                        foreach (var entry in za.Entries)
                        {
                            if (entry.FullName.EndsWith("/")) continue;
                            if (!entry.FullName.StartsWith(appid + "/", StringComparison.Ordinal)) { allUnderAppId = false; break; }
                        }
                        LogInfo($"Mengekstrak {za.Entries.Count} entri allUnderAppId={allUnderAppId} appid={appid}");

                        foreach (var entry in za.Entries)
                        {
                            if (entry.FullName.EndsWith("/")) continue;
                            var rel = allUnderAppId && entry.FullName.StartsWith(appid + "/")
                                ? entry.FullName.Substring(appid.ToString().Length + 1)
                                : entry.FullName;
                            var target = Path.Combine(installPath, rel.Replace('/', Path.DirectorySeparatorChar));
                            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                            entry.ExtractToFile(target, true);
                            extracted.Add(rel.Replace("\\", "/"));
                            if (!isUnsteam && rel.Replace("\\", "/").EndsWith("unsteam.ini", StringComparison.OrdinalIgnoreCase)) isUnsteam = true;
                            if (cts.IsCancellationRequested) throw new OperationCanceledException();
                        }
                    }
                }
                catch (InvalidDataException ex) when (ex.Message.Contains("LZMA", StringComparison.OrdinalIgnoreCase))
                {
                    // Fallback: use SharpCompress for ZIPs that use LZMA/PPMd
                    LogInfo($"Ekstraksi ZIP memakai SharpCompress (LZMA) appid={appid}");
                    using var stream = File.OpenRead(zipPath);
                    using var archive = SharpCompress.Archives.Zip.ZipArchive.Open(stream);
                    // Detect appid/ prefix
                    bool allUnderAppId = true;
                    foreach (var entry in archive.Entries)
                    {
                        if (entry.IsDirectory) continue;
                        var name = entry.Key.Replace("\\", "/");
                        if (!name.StartsWith(appid + "/", StringComparison.Ordinal)) { allUnderAppId = false; break; }
                    }
                    LogInfo($"Mengekstrak {archive.Entries.Count} entri (SharpCompress) allUnderAppId={allUnderAppId} appid={appid}");
                    foreach (var entry in archive.Entries)
                    {
                        if (entry.IsDirectory) continue;
                        var name = entry.Key.Replace("\\", "/");
                        var rel = allUnderAppId && name.StartsWith(appid + "/") ? name.Substring(appid.ToString().Length + 1) : name;
                        var target = Path.Combine(installPath, rel.Replace('/', Path.DirectorySeparatorChar));
                        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                        using var es = entry.OpenEntryStream();
                        using var fs = File.Create(target);
                        es.CopyTo(fs);
                        extracted.Add(rel.Replace("\\", "/"));
                        if (!isUnsteam && rel.EndsWith("unsteam.ini", StringComparison.OrdinalIgnoreCase)) isUnsteam = true;
                        if (cts.IsCancellationRequested) throw new OperationCanceledException();
                    }
                }
                LogInfo($"Ekstraksi selesai jumlahFile={extracted.Count} appid={appid}");

                // Optional Unsteam edit
                if (isUnsteam)
                {
                    var relIni = extracted.Find(x => x.EndsWith("unsteam.ini", StringComparison.OrdinalIgnoreCase));
                    if (!string.IsNullOrEmpty(relIni))
                    {
                        var iniPath = Path.Combine(installPath, relIni.Replace('/', Path.DirectorySeparatorChar));
                        try
                        {
                            var contents = await File.ReadAllTextAsync(iniPath, cts.Token);
                            var updated = contents.Replace("<appid>", appid.ToString());
                            if (!string.Equals(contents, updated, StringComparison.Ordinal))
                            {
                                await File.WriteAllTextAsync(iniPath, updated, cts.Token);
                                LogInfo($"Memperbarui unsteam.ini (appid) appid={appid}");
                            }
                        }
                        catch (Exception ex) { LogInfo($"Gagal ubah unsteam.ini: {ex.Message}"); }
                    }
                }

                // Write log (new filename scheme)
                gameName ??= TryGetSteamAppName(appid, installPath);
                var logPath = Path.Combine(installPath, $"gamehub-fix-log-{appid}.log");
                using (var w = new StreamWriter(logPath, File.Exists(logPath)))
                {
                    if (File.Exists(logPath)) w.WriteLine("---");
                    w.WriteLine("[FIX]");
                    w.WriteLine($"Date: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
                    if (!string.IsNullOrWhiteSpace(gameName)) w.WriteLine($"Game: {gameName}");
                    else w.WriteLine($"Game: Unknown Game ({appid})");
                    w.WriteLine($"Fix Type: {(isUnsteam ? "Online Fix (Unsteam)" : "Online Fix")}");
                    w.WriteLine($"Download URL: https://files.luatools.work/OnlineFix1/{appid}.zip");
                    w.WriteLine("Files:");
                    foreach (var rel in extracted) w.WriteLine(rel);
                    w.WriteLine("[/FIX]");
                }
                LogInfo($"Menulis FIX log di '{RedactPath(logPath)}' appid={appid}");

                state.Status = "done";
                // Persist applied state
                try { AppliedStateStore.SetApplied(appid, true); } catch { }
                // Emit applied-state immediately to keep UI consistent even if later checks miss
                await sendToJs(new { type = "OnlineFixAppliedState", appid = appid.ToString(), applied = true });
                await sendToJs(new { type = "OnlineFixResult", appid, success = true });
                LogInfo($"Apply selesai appid={appid}");

                try { File.Delete(zipPath); } catch { }
            }
            catch (OperationCanceledException)
            {
                _states[appid] = new OnlineFixState { Status = "cancelled" };
                LogInfo($"Apply dibatalkan appid={appid}");
                await sendToJs(new { type = "OnlineFixResult", appid, success = false, error = "cancelled" });
            }
            catch (Exception ex)
            {
                _states[appid] = new OnlineFixState { Status = "failed", Error = ex.Message };
                LogInfo($"Apply gagal appid={appid} err={ex.Message}");
                await sendToJs(new { type = "OnlineFixResult", appid, success = false, error = ex.Message });
            }
        }

        public object GetStatus(int appid)
        {
            _states.TryGetValue(appid, out var s);
            return new { type = "OnlineFixStatus", appid, status = s?.Status ?? "", bytesRead = s?.BytesRead ?? 0, totalBytes = s?.TotalBytes ?? 0, error = s?.Error };
        }

        public void Cancel(int appid)
        {
            if (_cts.TryRemove(appid, out var c))
            {
                try { c.Cancel(); } catch { }
            }
            LogInfo($"Permintaan batal appid={appid}");
        }

        // Unfix: remove files from log and delete log
        private readonly ConcurrentDictionary<int, UnfixState> _unfixStates = new();

        public Task<object> UnfixAsync(int appid, Func<int, string?> resolveInstallPath, DateTime? fixDate, Func<object, Task> sendToJs)
        {
            var installPath = resolveInstallPath(appid);
            if (string.IsNullOrWhiteSpace(installPath) || !Directory.Exists(installPath))
            {
                // Send immediate failure (marshal if needed)
                _ = SafeSend(sendToJs, new { type = "UnfixResult", appid, success = false, error = "install-path-not-found" });
                return Task.FromResult<object>(new { type = "UnfixResult", appid, success = false, error = "install-path-not-found" });
            }
            _unfixStates[appid] = new UnfixState { Status = "queued" };
            // Jalankan worker di thread pool, semua sendToJs akan dibungkus SafeSend.
            _ = Task.Run(async () => await UnfixWorker(appid, installPath, fixDate, sendToJs));
            _ = SafeSend(sendToJs, new { type = "UnfixQueued", appid });
            return Task.FromResult<object>(new { type = "UnfixQueued", appid });
        }

        private async Task UnfixWorker(int appid, string installPath, DateTime? fixDate, Func<object, Task> sendToJs)
        {
            try
            {
                // Prefer new filename; fallback to legacy
                var newLog = Path.Combine(installPath, $"gamehub-fix-log-{appid}.log");
                var legacyLog = Path.Combine(installPath, $"luatools-fix-log-{appid}.log");
                var logPath = File.Exists(newLog) ? newLog : legacyLog;
                if (string.IsNullOrWhiteSpace(logPath) || !File.Exists(logPath))
                {
                    _unfixStates[appid] = new UnfixState { Status = "failed", Error = "No fix log found. Cannot un-fix." };
                    LogInfo($"Unfix gagal: log tidak ditemukan appid={appid}");
                    await SafeSend(sendToJs, new { type = "UnfixResult", appid, success = false, error = "log-not-found" });
                    return;
                }
                _unfixStates[appid] = new UnfixState { Status = "removing", Progress = "Reading log file..." };
                LogInfo($"Unfix membaca log '{RedactPath(logPath)}' appid={appid}");
                var content = File.ReadAllText(logPath);
                var blocks = ParseFixBlocks(content);
                var legacyFiles = blocks == null ? ParseLegacyFiles(content) : null;
                var deleteList = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
                System.Collections.Generic.List<FixBlock>? remainingBlocks = null;
                if (blocks != null)
                {
                    if (fixDate.HasValue)
                    {
                        // Target only the specific block by Date
                        var target = blocks.Find(b => b.Date.HasValue && b.Date.Value == fixDate.Value);
                        if (target != null)
                        {
                            foreach (var f in target.Files) if (!string.IsNullOrWhiteSpace(f)) deleteList.Add(f);
                            // Keep other blocks
                            remainingBlocks = new System.Collections.Generic.List<FixBlock>();
                            foreach (var b in blocks) if (!object.ReferenceEquals(b, target)) remainingBlocks.Add(b);
                        }
                        else
                        {
                            // If not found, nothing to remove
                            _unfixStates[appid] = new UnfixState { Status = "failed", Error = "Requested fix date not found in log." };
                            LogInfo($"Unfix gagal: fixDate tidak ditemukan appid={appid}");
                            return;
                        }
                    }
                    else
                    {
                        // Remove all files from all blocks
                        foreach (var b in blocks) foreach (var f in b.Files) if (!string.IsNullOrWhiteSpace(f)) deleteList.Add(f);
                        remainingBlocks = null; // delete entire log afterwards
                    }
                }
                else if (legacyFiles != null)
                {
                    foreach (var f in legacyFiles) if (!string.IsNullOrWhiteSpace(f)) deleteList.Add(f);
                    remainingBlocks = null;
                }
                LogInfo($"Unfix menghapus file jumlah={deleteList.Count} appid={appid}");
                _unfixStates[appid] = new UnfixState { Status = "removing", Progress = $"Removing {deleteList.Count} files..." };
                int total = deleteList.Count;
                await SafeSend(sendToJs, new { type = "UnfixProgress", appid, phase = "start", totalFiles = total, removedFiles = 0 });
                int deleted = 0;
                foreach (var rel in deleteList)
                {
                    var full = Path.Combine(installPath, rel.Replace('/', Path.DirectorySeparatorChar));
                    try { if (File.Exists(full)) { File.Delete(full); deleted++; } else { LogInfo($"Unfix lewati tidak ada: '{rel}'"); } }
                    catch (Exception ex) { LogInfo($"Unfix gagal hapus '{rel}' err={ex.Message}"); }
                    if (total > 0 && deleted % 5 == 0) // throttle progress updates every 5 deletions
                    {
                        await SafeSend(sendToJs, new { type = "UnfixProgress", appid, phase = "removing", totalFiles = total, removedFiles = deleted });
                    }
                }
                await SafeSend(sendToJs, new { type = "UnfixProgress", appid, phase = "removing", totalFiles = total, removedFiles = deleted });
                // Rewrite or delete log
                try
                {
                  if (blocks != null)
                  {
                      if (remainingBlocks == null || remainingBlocks.Count == 0)
                      {
                          // All entries removed → delete log
                          File.Delete(logPath);
                          try { AppliedStateStore.SetApplied(appid, false); } catch { }
                      }
                      else
                      {
                          using var w = new StreamWriter(logPath, false);
                          for (int i = 0; i < remainingBlocks.Count; i++)
                          {
                              var b = remainingBlocks[i];
                              if (i > 0) w.WriteLine("---");
                              w.WriteLine("[FIX]");
                              if (b.Date.HasValue) w.WriteLine($"Date: {b.Date:yyyy-MM-dd HH:mm:ss}");
                              w.WriteLine("Files:");
                              foreach (var f in b.Files) w.WriteLine(f);
                              w.WriteLine("[/FIX]");
                          }
                          // Still have remaining blocks → still applied
                          try { AppliedStateStore.SetApplied(appid, true); } catch { }
                      }
                  }
                  else if (legacyFiles != null)
                  {
                      // Legacy: after removal of all listed files, delete the log
                      File.Delete(logPath);
                      try { AppliedStateStore.SetApplied(appid, false); } catch { }
                  }
                }
                catch { }
                _unfixStates[appid] = new UnfixState { Status = "done", FilesRemoved = deleted };
                LogInfo($"Unfix selesai dihapus={deleted} appid={appid}");
                await SafeSend(sendToJs, new { type = "UnfixResult", appid, success = true, filesRemoved = deleted });

                // Try to trigger Steam validation automatically via steamcmd if available
                TryRunSteamValidation(appid);
            }
            catch (Exception ex)
            {
                _unfixStates[appid] = new UnfixState { Status = "failed", Error = ex.Message };
                LogInfo($"Unfix gagal appid={appid} err={ex.Message}");
                try { await SafeSend(sendToJs, new { type = "UnfixResult", appid, success = false, error = ex.Message }); } catch { }
            }
        }

        // Helper to marshal JS event ke UI thread jika diperlukan
        private Task SafeSend(Func<object, Task> originalSend, object payload)
        {
            try
            {
                // Coba kirim langsung
                var t = originalSend(payload);
                if (t.IsCompletedSuccessfully) return t;
                return t.ContinueWith(ct =>
                {
                    if (ct.IsFaulted && ct.Exception != null)
                    {
                        HandleSendException(originalSend, payload, ct.Exception.GetBaseException());
                    }
                });
            }
            catch (Exception ex)
            {
                return HandleSendException(originalSend, payload, ex);
            }
        }

        private Task HandleSendException(Func<object, Task> originalSend, object payload, Exception ex)
        {
            // Thread ownership typical InvalidOperationException dari WPF
            if (ex is InvalidOperationException && ex.Message.Contains("different thread", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    System.Windows.Application.Current?.Dispatcher?.Invoke(() =>
                    {
                        try { originalSend(payload).GetAwaiter().GetResult(); }
                        catch (Exception inner) { LogInfo($"SafeSend dispatcher gagal: {inner.Message}"); }
                    });
                }
                catch (Exception dEx)
                {
                    LogInfo($"SafeSend marshal gagal: {dEx.Message}");
                }
                return Task.CompletedTask;
            }
            LogInfo($"SafeSend error langsung: {ex.Message}");
            return Task.CompletedTask;
        }

        public object GetUnfixStatus(int appid)
        {
            _unfixStates.TryGetValue(appid, out var s);
            return new { type = "UnfixStatus", appid, status = s?.Status ?? "", progress = s?.Progress, filesRemoved = s?.FilesRemoved ?? 0, error = s?.Error };
        }

        private class OnlineFixState
        {
            public string Status { get; set; } = "";
            public long BytesRead { get; set; }
            public long TotalBytes { get; set; }
            public string? Error { get; set; }
        }

        private class UnfixState
        {
            public string Status { get; set; } = "";
            public string? Progress { get; set; }
            public int FilesRemoved { get; set; }
            public string? Error { get; set; }
        }

        private static string? TryGetSteamAppName(int appid, string installPath)
        {
            try
            {
                // Typical Steam structure: .../steamapps/common/<GameName>
                // We need steamapps/appmanifest_<appid>.acf
                var dir = new DirectoryInfo(installPath);
                DirectoryInfo? steamAppsDir = null;
                var current = dir;
                while (current != null)
                {
                    if (string.Equals(current.Name, "common", StringComparison.OrdinalIgnoreCase) && current.Parent != null)
                    {
                        steamAppsDir = current.Parent; // parent of 'common' should be steamapps
                        break;
                    }
                    current = current.Parent;
                }
                if (steamAppsDir == null) return null;
                var manifestPath = Path.Combine(steamAppsDir.FullName, $"appmanifest_{appid}.acf");
                if (!File.Exists(manifestPath)) return null;

                // Minimal ACF parsing: find line with "name" "..."
                using var r = new StreamReader(manifestPath);
                string? line;
                while ((line = r.ReadLine()) != null)
                {
                    line = line.Trim();
                    // Expect patterns like: "name"\t"Game Name"
                    if (line.StartsWith("\"name\"", StringComparison.Ordinal))
                    {
                        var parts = line.Split('"', StringSplitOptions.RemoveEmptyEntries);
                        // parts expected: [name, \\t, Game Name]
                        if (parts.Length >= 2)
                        {
                            var value = parts[^1].Trim();
                            if (!string.IsNullOrWhiteSpace(value)) return value;
                        }
                    }
                }
                return null;
            }
            catch { return null; }
        }

        private (string? installPath, string? gameName) ResolveInstallFromSteam(int appid)
        {
            try
            {
                var baseSteam = GetSteamBasePath();
                if (string.IsNullOrWhiteSpace(baseSteam)) return (null, null);
                LogInfo($"Steam base path='{RedactPath(baseSteam)}'");
                // First, try find the exact library via 'apps' mapping in libraryfolders.vdf
                var libraryWithApp = SteamVdfUtils.FindLibraryPathForApp(baseSteam, appid);
                LogInfo($"libraryWithApp='{RedactPath(libraryWithApp)}' (apps map) appid={appid}");
                if (!string.IsNullOrWhiteSpace(libraryWithApp))
                {
                    var sa = Path.Combine(libraryWithApp!, "steamapps");
                    var manifest = Path.Combine(sa, $"appmanifest_{appid}.acf");
                    if (File.Exists(manifest))
                    {
                        var (installdir, name) = ParseManifestInstalldirAndName(manifest);
                        LogInfo($"Menemukan manifest (apps map) installdir='{installdir}' name='{name}'");
                        if (!string.IsNullOrWhiteSpace(installdir))
                        {
                            var path = Path.Combine(sa, "common", installdir);
                            if (Directory.Exists(path)) { LogInfo($"Install path terdeteksi='{RedactPath(path)}'"); return (path, string.IsNullOrWhiteSpace(name) ? null : name); }
                        }
                    }
                }
                // Fallback: scan all libraries for the manifest
                var libraries = GetSteamLibraries(baseSteam);
                LogInfo($"Memindai libraries jumlah={libraries.Count}");
                foreach (var lib in libraries)
                {
                    var steamapps = Path.Combine(lib, "steamapps");
                    var manifest = Path.Combine(steamapps, $"appmanifest_{appid}.acf");
                    if (!File.Exists(manifest)) continue;
                    var (installdir, name) = ParseManifestInstalldirAndName(manifest);
                    LogInfo($"Menemukan manifest di '{RedactPath(manifest)}' installdir='{installdir}' name='{name}'");
                    if (string.IsNullOrWhiteSpace(installdir)) continue;
                    var path = Path.Combine(steamapps, "common", installdir);
                    if (Directory.Exists(path)) { LogInfo($"Install path terdeteksi='{RedactPath(path)}'"); return (path, string.IsNullOrWhiteSpace(name) ? null : name); }
                }
                return (null, null);
            }
            catch { return (null, null); }
        }

        private static string? GetSteamBasePath()
        {
            try
            {
                // Registry HKCU for SteamPath
                using var k1 = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam");
                var p1 = k1?.GetValue("SteamPath") as string;
                if (!string.IsNullOrWhiteSpace(p1) && Directory.Exists(p1)) return p1;
                using var k2 = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\WOW6432Node\Valve\Steam");
                var p2 = k2?.GetValue("InstallPath") as string;
                if (!string.IsNullOrWhiteSpace(p2) && Directory.Exists(p2)) return p2;
                var defaultPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Steam");
                if (Directory.Exists(defaultPath)) return defaultPath;
                return null;
            }
            catch { return null; }
        }

        private static System.Collections.Generic.List<string> GetSteamLibraries(string baseSteamPath)
        {
            var libs = new System.Collections.Generic.List<string>();
            try
            {
                // Primary library (base steam path)
                libs.Add(baseSteamPath);
                var libraryVdf = Path.Combine(baseSteamPath, "steamapps", "libraryfolders.vdf");
                if (!File.Exists(libraryVdf)) return libs;
                var lines = File.ReadAllLines(libraryVdf);
                foreach (var raw in lines)
                {
                    var line = raw.Trim();
                    if (line.StartsWith("\"path\"", StringComparison.OrdinalIgnoreCase))
                    {
                        var parts = line.Split('"', StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length >= 2)
                        {
                            var path = parts[^1].Replace("\\\\", "\\").Trim();
                            if (Directory.Exists(path)) libs.Add(path);
                        }
                    }
                }
            }
            catch { }
            return libs;
        }

        private static (string? installdir, string? name) ParseManifestInstalldirAndName(string manifestPath)
        {
            try
            {
                string? installdir = null; string? name = null;
                foreach (var raw in File.ReadAllLines(manifestPath))
                {
                    var line = raw.Trim();
                    if (line.StartsWith("\"installdir\""))
                    {
                        var parts = line.Split('"', StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length >= 2) installdir = parts[^1];
                    }
                    else if (line.StartsWith("\"name\""))
                    {
                        var parts = line.Split('"', StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length >= 2) name = parts[^1];
                    }
                }
                return (installdir, name);
            }
            catch { return (null, null); }
        }

        private class FixBlock
        {
            public DateTime? Date { get; set; }
            public System.Collections.Generic.List<string> Files { get; set; } = new();
        }

        private static System.Collections.Generic.List<FixBlock>? ParseFixBlocks(string content)
        {
            if (string.IsNullOrWhiteSpace(content)) return null;
            var blocks = new System.Collections.Generic.List<FixBlock>();
            using var sr = new StringReader(content);
            string? line; FixBlock? cur = null; bool inFiles = false;
            while ((line = sr.ReadLine()) != null)
            {
                line = line.Trim();
                if (line == "[FIX]") { cur = new FixBlock(); inFiles = false; continue; }
                if (line == "[/FIX]") { if (cur != null) blocks.Add(cur); cur = null; inFiles = false; continue; }
                if (cur == null) continue;
                if (line.StartsWith("Date:"))
                {
                    var dtStr = line.Substring(5).Trim();
                    if (DateTime.TryParse(dtStr, out var dt)) cur.Date = dt;
                }
                else if (line.Equals("Files:", StringComparison.Ordinal))
                {
                    inFiles = true;
                }
                else if (inFiles && !string.IsNullOrWhiteSpace(line) && line != "---")
                {
                    cur.Files.Add(line);
                }
            }
            return blocks.Count > 0 ? blocks : null;
        }

        private static System.Collections.Generic.List<string>? ParseLegacyFiles(string content)
        {
            try
            {
                var list = new System.Collections.Generic.List<string>();
                using var sr = new StringReader(content);
                string? line; bool inFiles = false;
                while ((line = sr.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (line == "Files:") { inFiles = true; continue; }
                    if (inFiles && !string.IsNullOrWhiteSpace(line) && line != "---") list.Add(line);
                }
                return list.Count > 0 ? list : null;
            }
            catch { return null; }
        }

        private void TryRunSteamValidation(int appid)
        {
            try
            {
                var steamBase = GetSteamBasePath();
                if (!string.IsNullOrWhiteSpace(steamBase))
                {
                    var steamcmd = Path.Combine(steamBase, "steamcmd.exe");
                    if (File.Exists(steamcmd))
                    {
                        var psi = new ProcessStartInfo
                        {
                            FileName = steamcmd,
                            Arguments = $"+login anonymous +app_update {appid} -validate +quit",
                            UseShellExecute = false,
                            CreateNoWindow = true,
                        };
                        Process.Start(psi);
                        LogInfo($"Steam validation via steamcmd started appid={appid}");
                        return;
                    }
                }
                // Fallback chain: attempt direct Steam validate protocol then game page.
                try
                {
                    Process.Start(new ProcessStartInfo("steam://validate/" + appid) { UseShellExecute = true });
                    LogInfo($"Steam URI opened steam://validate/{appid}");
                }
                catch (Exception ex)
                {
                    LogInfo($"Steam validate URI error={ex.Message}; mencoba rungameid sebagai fallback");
                    try { Process.Start(new ProcessStartInfo("steam://rungameid/" + appid) { UseShellExecute = true }); LogInfo($"Steam URI opened steam://rungameid/{appid}"); }
                    catch (Exception ex2) { LogInfo($"Steam rungameid URI error={ex2.Message}"); }
                }
            }
            catch { }
        }
    }
}
