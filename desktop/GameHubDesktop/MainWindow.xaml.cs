using Microsoft.Web.WebView2.Core;
using System;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;

namespace GameHubDesktop
{
    public partial class MainWindow : Window
    {
        private string _appRoot = string.Empty;
        private string _baseDir = string.Empty;
        private readonly Services.OnlineFixService _onlineFix = new Services.OnlineFixService();
        private readonly Services.AppLogService _appLog = new Services.AppLogService();
        private bool _logSubscribed = false;
        private readonly System.Collections.Concurrent.ConcurrentDictionary<int, bool> _appliedCache = new System.Collections.Concurrent.ConcurrentDictionary<int, bool>();

        public MainWindow()
        {
            InitializeComponent();
            Loaded += async (_, __) => await InitializeAsync();
        }

        private async Task InitializeAsync()
        {
            try
            {
                _appLog.Append("App start");
                // Load persisted applied state
                Services.AppliedStateStore.Initialize();
                // Initialize GitHub Raw Service
                Services.GitHubRawService.Initialize();
                Services.GitHubRawService.Log = (msg) => _appLog.Append(msg);
                Services.OverrideDataService.Initialize();
                Services.OverrideDataService.Log = (msg) => _appLog.Append(msg);
                _onlineFix.Log = (msg) => _appLog.Append(msg);
                Services.AddGameService.Log = (msg) => _appLog.Append(msg);
                Services.SteamService.Log = (msg) => _appLog.Append(msg);
                var env = await CoreWebView2Environment.CreateAsync();
                await WebView.EnsureCoreWebView2Async(env);

                // Cari folder "gamehub" secara dinamis agar tidak tergantung jumlah ".."
                var baseDir = AppContext.BaseDirectory; // bin/Debug/net8.0-windows
                var dirInfo = new System.IO.DirectoryInfo(baseDir);
                while (dirInfo != null && dirInfo.Name.ToLower() != "gamehub")
                {
                    dirInfo = dirInfo.Parent;
                }
                if (dirInfo == null)
                {
                    MessageBox.Show("Folder 'gamehub' tidak ditemukan dari base: " + baseDir, "Startup Error", MessageBoxButton.OK, MessageBoxImage.Error);
                    return;
                }
                _baseDir = dirInfo.FullName; // .../gamehub
                _appRoot = System.IO.Path.Combine(dirInfo.FullName, "public");
                string appRoot = _appRoot;
                if (!System.IO.Directory.Exists(appRoot))
                {
                    MessageBox.Show("Folder 'public' tidak ditemukan: " + appRoot, "Startup Error", MessageBoxButton.OK, MessageBoxImage.Error);
                    return;
                }

                WebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "app.local", appRoot, CoreWebView2HostResourceAccessKind.Allow);
                WebView.Source = new Uri("https://app.local/index.html");

                WebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
                _appLog.Append("WebView initialized");
                // Wire realtime log forwarding
                _appLog.Appended += line =>
                {
                    if (_logSubscribed)
                    {
                        try { SendToJs(new { type = "AppLogAppend", line }); } catch { }
                    }
                };

                // Buka DevTools untuk melihat error jika ada
                WebView.CoreWebView2.OpenDevToolsWindow();

                Width = 1280; Height = 800; WindowState = WindowState.Normal;
                // Optional fullscreen setelah delay:
                // await Task.Delay(800); WindowState = WindowState.Maximized;
            }
            catch (Exception ex)
            {
                MessageBox.Show("Inisialisasi WebView2 gagal: " + ex.Message, "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var json = e.WebMessageAsJson;
                var msg = JsonSerializer.Deserialize<DesktopMessage>(json);
                if (msg == null || string.IsNullOrWhiteSpace(msg.action)) return;
                // Special-case AppLog messages sent from the web UI: append the payload.message
                // directly to the AppLogService and do not emit the generic "Action received: AppLog" entry.
                if (string.Equals(msg.action, "AppLog", StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        var text = msg.payload.TryGetProperty("message", out var m) ? (m.GetString() ?? m.ToString()) : null;
                        if (!string.IsNullOrWhiteSpace(text)) _appLog.Append(text);
                    }
                    catch { }
                    return;
                }
                _appLog.Append($"Action received: {msg.action}");

                switch (msg.action)
                {
                    case "AddGame":
                    {
                        var appid = msg.payload.TryGetProperty("appid", out var v) ? (v.GetString() ?? v.ToString()) : string.Empty;
                        _appLog.Append($"AddGame requested appid={appid}");
                        _ = Services.AddGameService.AddGameAsync(appid, _appRoot, SendToJs);
                        break;
                    }
                    case "AddGameCancel":
                    {
                        var appid = msg.payload.TryGetProperty("appid", out var v) ? (v.GetString() ?? v.ToString()) : string.Empty;
                        _appLog.Append($"AddGameCancel appid={appid}");
                        Services.AddGameService.CancelAdd(appid, SendToJs);
                        break;
                    }
                    case "RemoveGame":
                    {
                        var appid = msg.payload.TryGetProperty("appid", out var v) ? (v.GetString() ?? v.ToString()) : string.Empty;
                        _appLog.Append($"RemoveGame appid={appid}");
                        _ = Services.AddGameService.RemoveGameAsync(appid, SendToJs);
                        break;
                    }
                    case "CheckGameInstalled":
                    {
                        var appid = msg.payload.TryGetProperty("appid", out var v) ? (v.GetString() ?? v.ToString()) : string.Empty;
                        bool installed = Services.AddGameService.IsGameInstalled(appid);
                        SendToJs(new { type = "GameInstalledState", appid, installed });
                        _appLog.Append($"CheckGameInstalled appid={appid} installed={installed}");
                        break;
                    }
                    case "CheckOnlineFixApplied":
                    {
                        var appidStr = msg.payload.TryGetProperty("appid", out var v) ? (v.GetString() ?? v.ToString()) : string.Empty;
                        int appidInt = 0; int.TryParse(appidStr, out appidInt);
                        var installPath = DetectGameInstallPath(appidInt);
                        bool applied = false;
                        if (!string.IsNullOrWhiteSpace(installPath) && System.IO.Directory.Exists(installPath))
                        {
                            var newLog = System.IO.Path.Combine(installPath, $"gamehub-fix-log-{appidInt}.log");
                            var legacyLog = System.IO.Path.Combine(installPath, $"luatools-fix-log-{appidInt}.log");
                            applied = System.IO.File.Exists(newLog) || System.IO.File.Exists(legacyLog);
                            _appLog.Append($"CheckOnlineFixApplied appid={appidInt} path='{installPath}' applied={applied}");
                            if (!applied)
                            {
                                // If logs missing but persisted state says applied, perform a deeper re-scan under installPath.
                                // If still not found, clear persisted state (handles manual deletion of log file).
                                bool storedApplied = Services.AppliedStateStore.TryGet(appidInt, out var stored) && stored;
                                if (storedApplied)
                                {
                                    bool found = false;
                                    try
                                    {
                                        var patterns = new[] { $"gamehub-fix-log-{appidInt}.log", $"luatools-fix-log-{appidInt}.log" };
                                        foreach (var pat in patterns)
                                        {
                                            foreach (var f in System.IO.Directory.EnumerateFiles(installPath!, pat, System.IO.SearchOption.AllDirectories))
                                            {
                                                if (System.IO.Path.GetFileName(f).Equals(pat, StringComparison.OrdinalIgnoreCase)) { found = true; break; }
                                            }
                                            if (found) break;
                                        }
                                    }
                                    catch { }
                                    if (found)
                                    {
                                        applied = true;
                                        _appLog.Append($"CheckOnlineFixApplied deep-scan found log appid={appidInt}");
                                    }
                                    else
                                    {
                                        try { Services.AppliedStateStore.SetApplied(appidInt, false); } catch { }
                                        _appLog.Append($"CheckOnlineFixApplied log missing after deep-scan; clearing persisted state appid={appidInt}");
                                    }
                                }
                            }
                        }
                        else
                        {
                            // Fallback: search all Steam libraries for the FIX log
                            _appLog.Append($"CheckOnlineFixApplied appid={appidInt} install path not found");
                            try
                            {
                                string? foundLog = null;
                                var steamRootCandidates = new[]
                                {
                                    System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Steam"),
                                    System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Steam")
                                };
                                foreach (var root in steamRootCandidates)
                                {
                                    var steamapps = System.IO.Path.Combine(root, "steamapps");
                                    var libVdf = System.IO.Path.Combine(steamapps, "libraryfolders.vdf");
                                    if (!System.IO.File.Exists(libVdf)) continue;
                                    var libraries = Services.SteamVdfUtils.ParseLibraryFolders(libVdf);
                                    foreach (var lib in libraries)
                                    {
                                        try
                                        {
                                            var common = System.IO.Path.Combine(lib, "steamapps", "common");
                                            var rootsToSearch = new System.Collections.Generic.List<string>();
                                            if (System.IO.Directory.Exists(common)) rootsToSearch.Add(common);
                                            if (System.IO.Directory.Exists(lib)) rootsToSearch.Add(lib);
                                            // recursive search for new or legacy log filename
                                            var patterns = new[] { $"gamehub-fix-log-{appidInt}.log", $"luatools-fix-log-{appidInt}.log" };
                                            foreach (var baseDir in rootsToSearch)
                                            {
                                                foreach (var pat in patterns)
                                                {
                                                    foreach (var file in System.IO.Directory.EnumerateFiles(baseDir, pat, System.IO.SearchOption.AllDirectories))
                                                    {
                                                        if (System.IO.Path.GetFileName(file).Equals(pat, StringComparison.OrdinalIgnoreCase))
                                                        {
                                                            foundLog = file; break;
                                                        }
                                                    }
                                                    if (foundLog != null) break;
                                                }
                                                if (foundLog != null) break;
                                            }
                                            if (foundLog != null) break;
                                        }
                                        catch { }
                                    }
                                    if (foundLog != null) break;
                                }
                                if (!string.IsNullOrWhiteSpace(foundLog) && System.IO.File.Exists(foundLog))
                                {
                                    applied = true;
                                    _appLog.Append($"CheckOnlineFixApplied fallback found log at '{foundLog}' appid={appidInt}");
                                }
                                else
                                {
                                    // Tidak ada log ditemukan secara global: bersihkan cache & persisted state
                                    try { _appliedCache.TryRemove(appidInt, out _); } catch { }
                                    try { Services.AppliedStateStore.SetApplied(appidInt, false); } catch { }
                                    applied = false;
                                    _appLog.Append($"CheckOnlineFixApplied global search found no log; cleared state appid={appidInt}");
                                }
                            }
                            catch { }
                        }
                        SendToJs(new { type = "OnlineFixAppliedState", appid = appidStr, applied });
                        break;
                    }
                    case "CheckOnlineFix":
                    {
                        var appidInt = msg.payload.TryGetProperty("appid", out var v) && int.TryParse(v.GetString(), out var ai) ? ai : 0;
                        _appLog.Append($"CheckOnlineFix appid={appidInt}");
                        var res = await _onlineFix.CheckAvailabilityAsync(appidInt);
                        SendToJs(res);
                        break;
                    }
                    case "ApplyOnlineFix":
                    {
                        var appidInt = msg.payload.TryGetProperty("appid", out var v) && int.TryParse(v.GetString(), out var ai) ? ai : 0;
                        var url = msg.payload.TryGetProperty("url", out var u) ? (u.GetString() ?? string.Empty) : string.Empty;
                        _appLog.Append($"ApplyOnlineFix appid={appidInt} url={url}");
                        await _onlineFix.ApplyAsync(appidInt, url, async o => SendToJs(o), DetectGameInstallPath);
                        break;
                    }
                    case "CancelOnlineFix":
                    {
                        var appidInt = msg.payload.TryGetProperty("appid", out var v) && int.TryParse(v.GetString(), out var ai) ? ai : 0;
                        _appLog.Append($"CancelOnlineFix appid={appidInt}");
                        _onlineFix.Cancel(appidInt);
                        break;
                    }
                    case "UnOnlineFix":
                    {
                        var appidInt = msg.payload.TryGetProperty("appid", out var v) && int.TryParse(v.GetString(), out var ai) ? ai : 0;
                        // Optional: parse fixDate (format yyyy-MM-dd HH:mm:ss) if provided
                        DateTime? fixDate = null;
                        if (msg.payload.TryGetProperty("fixDate", out var fd))
                        {
                            var s = fd.GetString();
                            if (!string.IsNullOrWhiteSpace(s) && DateTime.TryParse(s, out var dt)) fixDate = dt;
                        }
                        _appLog.Append($"UnOnlineFix appid={appidInt}");
                        var res = await _onlineFix.UnfixAsync(appidInt, DetectGameInstallPath, fixDate, async o => SendToJs(o));
                        // 'res' already sent inside service; keep for compatibility

                        // Setelah unfix selesai (atau gagal menemukan path), paksa evaluasi ulang status applied.
                        try
                        {
                            var installPath = DetectGameInstallPath(appidInt);
                            bool stillApplied = false;
                            if (!string.IsNullOrWhiteSpace(installPath) && System.IO.Directory.Exists(installPath))
                            {
                                var newLog = System.IO.Path.Combine(installPath, $"gamehub-fix-log-{appidInt}.log");
                                var legacyLog = System.IO.Path.Combine(installPath, $"luatools-fix-log-{appidInt}.log");
                                stillApplied = System.IO.File.Exists(newLog) || System.IO.File.Exists(legacyLog);
                                _appLog.Append($"Post-Unfix recheck appid={appidInt} installPathFound applied(logsExist)={stillApplied}");
                            }
                            else
                            {
                                _appLog.Append($"Post-Unfix recheck appid={appidInt} installPathMissing");
                            }
                            if (!stillApplied)
                            {
                                // Bersihkan cache & persisted state karena log hilang
                                try { _appliedCache.TryRemove(appidInt, out _); } catch { }
                                try { Services.AppliedStateStore.SetApplied(appidInt, false); } catch { }
                                SendToJs(new { type = "OnlineFixAppliedState", appid = appidInt.ToString(), applied = false });
                                _appLog.Append($"Post-Unfix applied state cleared & event sent appid={appidInt}");
                            }
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"Post-Unfix recheck exception appid={appidInt} err={ex.Message}");
                        }
                        break;
                    }
                    case "GetUnOnlineFixStatus":
                    {
                        var appidInt = msg.payload.TryGetProperty("appid", out var v) && int.TryParse(v.GetString(), out var ai) ? ai : 0;
                        SendToJs(_onlineFix.GetUnfixStatus(appidInt));
                        break;
                    }
                    case "GetAppLog":
                    {
                        var lines = _appLog.GetAll();
                        SendToJs(new { type = "AppLog", lines });
                        break;
                    }
                    case "SubscribeAppLog":
                    {
                        _logSubscribed = true;
                        // send current snapshot immediately as well
                        var lines = _appLog.GetAll();
                        SendToJs(new { type = "AppLog", lines });
                        break;
                    }
                    case "UnsubscribeAppLog":
                    {
                        _logSubscribed = false;
                        break;
                    }
                    case "SaveAppLog":
                    {
                        var (ok, path, error) = _appLog.SaveToDefault();
                        SendToJs(new { type = "AppLogSaved", success = ok, path = path ?? string.Empty, error = error ?? string.Empty });
                        if (ok) _appLog.Append($"Saved log to {path}");
                        break;
                    }
                    case "RestartSteam":
                    {
                        Services.SteamService.RestartSteam(SendToJs);
                        break;
                    }
                    case "ListLibraryGames":
                    {
                        var res = Services.AddGameService.ListLibraryGames();
                        SendToJs(res);
                        break;
                    }
                    case "GetRawDataset":
                    {
                        var forceRefresh = msg.payload.TryGetProperty("forceRefresh", out var fr) && fr.ValueKind == JsonValueKind.True;
                        var raw = await Services.GitHubRawService.GetRawDatasetAsync(forceRefresh, (percent, message) =>
                        {
                            try
                            {
                                SendToJs(new { type = "RawDatasetProgress", percent, message });
                            }
                            catch (Exception ex)
                            {
                                _appLog.Append($"[GetRawDataset] Progress error: {ex.Message}");
                            }
                        });
                        SendToJs(new { type = "RawDataset", data = raw });
                        break;
                    }
                    case "GetMetadataForAppid":
                    {
                        var appidStr = msg.payload.TryGetProperty("appid", out var v) ? (v.GetString() ?? v.ToString()) : string.Empty;
                        if (int.TryParse(appidStr, out var appidInt))
                        {
                            try
                            {
                                var metadata = await Services.GitHubRawService.GetMetadataForAppidAsync(appidInt);
                                SendToJs(new { type = "MetadataForAppid", appid = appidStr, data = metadata });
                            }
                            catch (Exception ex)
                            {
                                _appLog.Append($"GetMetadataForAppid error for appid={appidInt}: {ex.Message}");
                                SendToJs(new { type = "MetadataForAppid", appid = appidStr, data = (object?)null, error = ex.Message });
                            }
                        }
                        else
                        {
                            SendToJs(new { type = "MetadataForAppid", appid = appidStr, data = (object?)null, error = "Invalid appid" });
                        }
                        break;
                    }
                    case "ClearAllCache":
                    {
                        _appLog.Append("ClearAllCache requested");
                        try
                        {
                            Services.GitHubRawService.ClearCache();
                            Services.AppliedStateStore.ClearAll();
                            _appLog.Append("Cache cleared");
                            SendToJs(new { type = "ClearAllCacheResult", success = true, message = "Semua cache berhasil dihapus" });
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"ClearAllCache error: {ex.Message}");
                            SendToJs(new { type = "ClearAllCacheResult", success = false, error = ex.Message });
                        }
                        break;
                    }
                    case "GetGlobalOverride":
                    {
                        var forceRefresh = msg.payload.TryGetProperty("forceRefresh", out var fr) && fr.ValueKind == JsonValueKind.True;
                        try
                        {
                            var overrideData = await Services.OverrideDataService.GetGlobalOverrideAsync(forceRefresh);
                            SendToJs(new { type = "GlobalOverride", data = overrideData });
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"GetGlobalOverride error: {ex.Message}");
                            SendToJs(new { type = "GlobalOverride", data = (object?)null, error = ex.Message });
                        }
                        break;
                    }
                    case "GetUserOverride":
                    {
                        try
                        {
                            var userOverride = Services.OverrideDataService.GetUserOverride();
                            SendToJs(new { type = "UserOverride", data = userOverride });
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"GetUserOverride error: {ex.Message}");
                            SendToJs(new { type = "UserOverride", data = (object?)null, error = ex.Message });
                        }
                        break;
                    }
                    case "CheckOverrideUpdate":
                    {
                        try
                        {
                            var hasUpdate = await Services.OverrideDataService.CheckForUpdateAsync();
                            var lastUpdate = Services.OverrideDataService.GetLastUpdateTime();
                            SendToJs(new { 
                                type = "OverrideUpdateCheck", 
                                hasUpdate = hasUpdate,
                                lastUpdate = lastUpdate?.ToString("yyyy-MM-dd HH:mm:ss UTC")
                            });
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"CheckOverrideUpdate error: {ex.Message}");
                            SendToJs(new { 
                                type = "OverrideUpdateCheck", 
                                hasUpdate = false,
                                error = ex.Message 
                            });
                        }
                        break;
                    }
                    case "ForceUpdateOverride":
                    {
                        try
                        {
                            _appLog.Append("Force updating override data...");
                            // Clear memory cache dulu untuk force reload
                            Services.OverrideDataService.ClearMemoryCache();
                            var overrideData = await Services.OverrideDataService.GetGlobalOverrideAsync(true);
                            if (overrideData != null)
                            {
                                _appLog.Append("Override data updated successfully");
                                SendToJs(new { 
                                    type = "OverrideUpdateResult", 
                                    success = true,
                                    message = "Override data berhasil di-update"
                                });
                            }
                            else
                            {
                                _appLog.Append("Failed to update override data");
                                SendToJs(new { 
                                    type = "OverrideUpdateResult", 
                                    success = false,
                                    error = "Gagal download override data"
                                });
                            }
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"ForceUpdateOverride error: {ex.Message}");
                            SendToJs(new { 
                                type = "OverrideUpdateResult", 
                                success = false,
                                error = ex.Message 
                            });
                        }
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                _appLog.Append($"Exception: {ex.Message}");
                SendToJs(new { type = "error", message = ex.Message });
            }
        }

        private void SendToJs(object obj)
        {
            var json = JsonSerializer.Serialize(obj);
            WebView.CoreWebView2.PostWebMessageAsJson(json);
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
                
                if (string.Equals(type, "RawDatasetProgress", StringComparison.OrdinalIgnoreCase))
                {
                    // Progress updates are sent to UI, no need to log
                }
                
                if (string.Equals(type, "OnlineFixAppliedState", StringComparison.OrdinalIgnoreCase))
                {
                    var appidStr = root.TryGetProperty("appid", out var a) ? a.GetString() : null;
                    var applied = root.TryGetProperty("applied", out var ap) && ap.ValueKind == JsonValueKind.True;
                    if (applied && int.TryParse(appidStr, out var appidInt))
                    {
                        _appliedCache[appidInt] = true;
                    }
                }
                if (!string.IsNullOrWhiteSpace(type) && !string.Equals(type, "RawDatasetProgress", StringComparison.OrdinalIgnoreCase))
                {
                    _appLog.Append($"Event sent: {type}");
                }
            }
            catch (Exception ex)
            {
                _appLog.Append($"[SendToJs] Error: {ex.Message}");
            }
        }

        private string? DetectGameInstallPath(int appid)
        {
            try
            {
                _appLog.Append($"DetectGameInstallPath start appid={appid}");
                var steamRootCandidates = new[]
                {
                    System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Steam"),
                    System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Steam")
                };
                foreach (var root in steamRootCandidates)
                {
                    var steamapps = System.IO.Path.Combine(root, "steamapps");
                    var libVdf = System.IO.Path.Combine(steamapps, "libraryfolders.vdf");
                    if (!System.IO.File.Exists(libVdf)) continue;
                    _appLog.Append($"libraryfolders.vdf found at '{libVdf}'");
                    // Prefer using 'apps' mapping to locate the correct library quickly
                    var libWithApp = Services.SteamVdfUtils.FindLibraryPathForApp(root, appid);
                    _appLog.Append($"FindLibraryPathForApp -> '{libWithApp}'");
                    if (!string.IsNullOrWhiteSpace(libWithApp))
                    {
                        var sa = System.IO.Path.Combine(libWithApp, "steamapps");
                        var manifest = System.IO.Path.Combine(sa, $"appmanifest_{appid}.acf");
                        if (System.IO.File.Exists(manifest))
                        {
                            _appLog.Append($"appmanifest found '{manifest}'");
                            var installDir = Services.SteamVdfUtils.ParseInstallDir(manifest);
                            if (string.IsNullOrWhiteSpace(installDir))
                            {
                                installDir = ManualParseInstalldir(manifest);
                                if (!string.IsNullOrWhiteSpace(installDir)) _appLog.Append($"ManualParseInstalldir success installdir='{installDir}' appid={appid}");
                            }
                            if (!string.IsNullOrWhiteSpace(installDir))
                            {
                                var common = System.IO.Path.Combine(sa, "common", installDir);
                                if (System.IO.Directory.Exists(common)) return common; else _appLog.Append($"InstallDir directory not found '{common}'");
                            }
                        }
                    }
                    // Fallback: scan all libraries for the manifest
                    var libraries = Services.SteamVdfUtils.ParseLibraryFolders(libVdf);
                    _appLog.Append($"Fallback scan libraries count={libraries.Count}");
                    foreach (var lib in libraries)
                    {
                        var sa = System.IO.Path.Combine(lib, "steamapps");
                        var manifest = System.IO.Path.Combine(sa, $"appmanifest_{appid}.acf");
                        if (!System.IO.File.Exists(manifest)) continue;
                        _appLog.Append($"appmanifest found at '{manifest}'");
                        var installDir = Services.SteamVdfUtils.ParseInstallDir(manifest);
                        if (string.IsNullOrWhiteSpace(installDir))
                        {
                            installDir = ManualParseInstalldir(manifest);
                            if (!string.IsNullOrWhiteSpace(installDir)) _appLog.Append($"ManualParseInstalldir success (fallback) installdir='{installDir}' appid={appid}");
                        }
                        if (string.IsNullOrWhiteSpace(installDir)) continue;
                        var common = System.IO.Path.Combine(sa, "common", installDir);
                        if (System.IO.Directory.Exists(common)) return common; else _appLog.Append($"InstallDir directory not found (fallback) '{common}'");
                    }
                }
            }
            catch (Exception ex)
            {
                _appLog.Append($"DetectGameInstallPath exception appid={appid} err={ex.Message}");
            }
            // Global recovery: search for fix log inside any game directory
            try
            {
                foreach (var root in new[]
                {
                    System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Steam"),
                    System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Steam")
                })
                {
                    var steamapps = System.IO.Path.Combine(root, "steamapps");
                    var common = System.IO.Path.Combine(steamapps, "common");
                    if (!System.IO.Directory.Exists(common)) continue;
                    foreach (var dir in System.IO.Directory.EnumerateDirectories(common))
                    {
                        try
                        {
                            var log1 = System.IO.Path.Combine(dir, $"gamehub-fix-log-{appid}.log");
                            var log2 = System.IO.Path.Combine(dir, $"luatools-fix-log-{appid}.log");
                            if (System.IO.File.Exists(log1) || System.IO.File.Exists(log2))
                            {
                                _appLog.Append($"Global log-based path recovery success dir='{dir}' appid={appid}");
                                return dir;
                            }
                        }
                        catch { }
                    }
                }
            }
            catch { }
            _appLog.Append($"DetectGameInstallPath miss appid={appid}");
            return null;
        }

        private static string? ManualParseInstalldir(string manifestPath)
        {
            try
            {
                foreach (var raw in System.IO.File.ReadAllLines(manifestPath))
                {
                    var line = raw.Trim();
                    if (line.StartsWith("\"installdir\"", StringComparison.OrdinalIgnoreCase))
                    {
                        var parts = line.Split('"', StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length >= 2)
                        {
                            var value = parts[^1].Trim();
                            if (!string.IsNullOrWhiteSpace(value)) return value;
                        }
                    }
                }
            }
            catch { }
            return null;
        }
    }

    public class DesktopMessage
    {
        public string? action { get; set; }
        public JsonElement payload { get; set; }
    }
}
