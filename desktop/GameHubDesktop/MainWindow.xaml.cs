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
        private readonly Services.FixGamesService _fixGames = new Services.FixGamesService();
        private readonly Services.UpdateService _updateService = new Services.UpdateService();
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
                
                // Initialize License Service
                Services.LicenseService.Log = (msg) => _appLog.Append(msg);
                
                var license = Services.LicenseService.LoadLicense();
                
                // Load persisted applied state
                Services.AppliedStateStore.Initialize();
                // Initialize GitHub Raw Service
                Services.GitHubRawService.Initialize();
                Services.GitHubRawService.Log = (msg) => _appLog.Append(msg);
                Services.OverrideDataService.Initialize();
                Services.OverrideDataService.Log = (msg) => _appLog.Append(msg);
                Services.FixGamesDataService.Initialize();
                Services.FixGamesDataService.Log = (msg) => _appLog.Append(msg);
                Services.SteamGamesDataService.Initialize();
                Services.SteamGamesDataService.Log = (msg) => _appLog.Append(msg);
                _onlineFix.Log = (msg) => _appLog.Append(msg);
                Services.AddGameService.Log = (msg) => _appLog.Append(msg);
                Services.SteamService.Log = (msg) => _appLog.Append(msg);
                _fixGames.Log = (msg) => _appLog.Append(msg);
                _updateService.Log = (msg) => _appLog.Append(msg);

                var userDataPath = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "GameHub",
                    "WebView2Cache");
                try
                {
                    System.IO.Directory.CreateDirectory(userDataPath);
                }
                catch (Exception dirEx)
                {
                    _appLog.Append($"Failed to create WebView2 cache directory: {dirEx.Message}");
                    throw;
                }

                var env = await CoreWebView2Environment.CreateAsync(null, userDataPath);
                await WebView.EnsureCoreWebView2Async(env);

                // Cari folder "public" secara fleksibel agar path publish/installer ikut terbaca
                var baseDir = AppContext.BaseDirectory;
                string? resolvedRoot = null;
                string? resolvedPublic = null;

                var directPublic = System.IO.Path.Combine(baseDir, "public");
                if (System.IO.Directory.Exists(directPublic))
                {
                    resolvedRoot = baseDir.TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar);
                    resolvedPublic = directPublic;
                }
                else
                {
                    var dirInfo = new System.IO.DirectoryInfo(baseDir);
                    while (dirInfo != null && !dirInfo.Name.Equals("gamehub", StringComparison.OrdinalIgnoreCase))
                    {
                        dirInfo = dirInfo.Parent;
                    }

                    if (dirInfo != null)
                    {
                        var fallbackPublic = System.IO.Path.Combine(dirInfo.FullName, "public");
                        if (System.IO.Directory.Exists(fallbackPublic))
                        {
                            resolvedRoot = dirInfo.FullName;
                            resolvedPublic = fallbackPublic;
                        }
                    }
                }

                if (string.IsNullOrWhiteSpace(resolvedPublic))
                {
                    System.Windows.MessageBox.Show("Folder 'public' tidak ditemukan dari base: " + baseDir, "Startup Error", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Error);
                    return;
                }

                _baseDir = resolvedRoot ?? baseDir;
                _appRoot = resolvedPublic;
                string appRoot = _appRoot;

                WebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "app.local", appRoot, CoreWebView2HostResourceAccessKind.Allow);

                // Setup WebMessageReceived handler SEBELUM navigasi
                WebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
                
                // Check license sebelum load aplikasi
                if (!license.IsValid || !license.IsActive)
                {
                    // License tidak valid - clear cache dan load halaman aktivasi
                    Services.LicenseService.ClearCache();
                    WebView.Source = new Uri("https://app.local/activate.html");
                    _appLog.Append("License tidak valid - menampilkan halaman aktivasi");
                }
                else
                {
                    // License valid offline - tampilkan halaman validating dulu
                    _appLog.Append($"License valid offline - Plan={license.Plan}, loading validating page...");
                    WebView.Source = new Uri("https://app.local/validating.html");
                    
                    // Tunggu WebView siap dulu sebelum mulai validasi (agar spinner terlihat)
                    _appLog.Append("Waiting 500ms for WebView to be ready...");
                    await Task.Delay(500);
                    
                    // Inject console.log helper ke validating.html
                    try
                    {
                        await WebView.CoreWebView2.ExecuteScriptAsync(@"
                            window.logToConsole = function(msg) {
                                console.log('[VALIDATING]', msg);
                            };
                        ");
                    }
                    catch { }
                    
                    // Validasi online WAJIB saat app start (jika ada internet)
                    // Jalankan di background thread agar tidak blocking UI
                    _appLog.Append("Starting online validation in background thread...");
                    var validationStartTime = DateTime.Now;
                    
                    // Jalankan validasi di background thread
                    var validationTask = Task.Run(async () =>
                    {
                        try
                        {
                            _appLog.Append("[Background] ValidateOnlineAsync starting...");
                            return await Services.LicenseService.ValidateOnlineAsync();
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"[Background] ValidateOnlineAsync exception: {ex.GetType().Name} - {ex.Message}");
                            throw;
                        }
                    });
                    
                    try
                    {
                        var validatedLicense = await validationTask;
                        var validationElapsed = (DateTime.Now - validationStartTime).TotalSeconds;
                        _appLog.Append($"Online validation completed in {validationElapsed:F2}s");
                        
                        if (!validatedLicense.IsActive || !validatedLicense.IsValid)
                        {
                            // License banned/reset - clear cache dan redirect ke aktivasi
                            _appLog.Append($"License banned/reset: {validatedLicense.ErrorMessage}");
                            Services.LicenseService.ClearCache();
                            WebView.Source = new Uri("https://app.local/activate.html");
                            return;
                        }
                        
                        _appLog.Append($"License validated online - Plan={validatedLicense.Plan}");
                        
                        // Tunggu sedikit agar spinner terlihat sebelum redirect
                        await Task.Delay(500);
                        WebView.Source = new Uri("https://app.local/index.html");
                    }
                    catch (TimeoutException ex)
                    {
                        // Timeout - redirect ke halaman error dengan parameter
                        var validationElapsed = (DateTime.Now - validationStartTime).TotalSeconds;
                        _appLog.Append($"Online validation TIMEOUT after {validationElapsed:F2}s: {ex.Message}");
                        _appLog.Append($"Exception type: {ex.GetType().Name}");
                        Services.LicenseService.ClearCache();
                        
                        // Redirect ke halaman error khusus (validating.html akan handle error via URL parameter)
                        _appLog.Append("Redirecting to validating.html?error=timeout");
                        WebView.Source = new Uri("https://app.local/validating.html?error=timeout");
                    }
                    catch (Exception ex)
                    {
                        // Network error atau error lain - redirect ke halaman error
                        var validationElapsed = (DateTime.Now - validationStartTime).TotalSeconds;
                        _appLog.Append($"Online validation FAILED after {validationElapsed:F2}s: {ex.GetType().Name} - {ex.Message}");
                        _appLog.Append($"Stack trace: {ex.StackTrace}");
                        Services.LicenseService.ClearCache();
                        
                        // Redirect ke halaman error khusus (validating.html akan handle error via URL parameter)
                        _appLog.Append("Redirecting to validating.html?error=network");
                        WebView.Source = new Uri("https://app.local/validating.html?error=network");
                    }
                }

                // Handler sudah di-attach sebelumnya
                _appLog.Append("WebView initialized");
                
                // Wire realtime log forwarding
                _appLog.Appended += line =>
                {
                    if (_logSubscribed)
                    {
                        try { SendToJs(new { type = "AppLogAppend", line }); } catch { }
                    }
                };


                Width = 1280; Height = 800; WindowState = WindowState.Normal;
                // Optional fullscreen setelah delay:
                // await Task.Delay(800); WindowState = WindowState.Maximized;
            }
            catch (Exception ex)
            {
                System.Windows.MessageBox.Show("Inisialisasi WebView2 gagal: " + ex.Message, "Error", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Error);
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
                
                // Hanya log action penting, skip action yang terlalu sering
                var importantActions = new[] { "ActivateLicense", "ForceUpdateOverride", "AddGame", "RemoveGame", "ApplyOnlineFix", "UnOnlineFix", "Error", "Exception" };
                bool isImportant = false;
                foreach (var action in importantActions)
                {
                    if (msg.action.Contains(action, StringComparison.OrdinalIgnoreCase))
                    {
                        isImportant = true;
                        break;
                    }
                }
                if (isImportant)
                {
                    _appLog.Append($"Action: {msg.action}");
                }

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
                    case "ClearRawCache":
                    {
                        try
                        {
                            _appLog.Append("Clearing raw dataset cache...");
                            Services.GitHubRawService.ClearCache();
                            _appLog.Append("Raw dataset cache cleared");
                            SendToJs(new { type = "RawCacheCleared", success = true });
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"ClearRawCache error: {ex.Message}");
                            SendToJs(new { type = "RawCacheCleared", success = false, error = ex.Message });
                        }
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
                    case "GetSteamGamesData":
                    {
                        try
                        {
                            _appLog.Append("GetSteamGamesData requested");
                            var forceRefresh = msg.payload.TryGetProperty("forceRefresh", out var fr) && fr.ValueKind == JsonValueKind.True;
                            var data = await Services.SteamGamesDataService.GetSteamGamesDataAsync(forceRefresh, (percent, message) =>
                            {
                                try
                                {
                                    SendToJs(new { type = "SteamGamesDataProgress", percent, message });
                                }
                                catch (Exception ex)
                                {
                                    _appLog.Append($"[GetSteamGamesData] Progress error: {ex.Message}");
                                }
                            });
                            _appLog.Append($"GetSteamGamesData completed, data: {(data != null ? "not null" : "null")}");
                            SendToJs(new { type = "SteamGamesData", data = data });
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"GetSteamGamesData error: {ex.Message}");
                            SendToJs(new { type = "SteamGamesData", data = (object?)null, error = ex.Message });
                        }
                        break;
                    }
                    case "GetFixGamesData":
                    {
                        try
                        {
                            _appLog.Append("GetFixGamesData requested");
                            var forceRefresh = msg.payload.TryGetProperty("forceRefresh", out var fr) && fr.ValueKind == JsonValueKind.True;
                            var data = await Services.FixGamesDataService.GetFixGamesDataAsync(forceRefresh, (percent, message) =>
                            {
                                try
                                {
                                    SendToJs(new { type = "FixGamesDataProgress", percent, message });
                                }
                                catch (Exception ex)
                                {
                                    _appLog.Append($"[GetFixGamesData] Progress error: {ex.Message}");
                                }
                            });
                            _appLog.Append($"GetFixGamesData completed, data: {(data != null ? "not null" : "null")}");
                            SendToJs(new { type = "FixGamesData", data = data });
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"GetFixGamesData error: {ex.Message}");
                            SendToJs(new { type = "FixGamesData", data = (object?)null, error = ex.Message });
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
                    case "GetLibraryAppIds":
                    {
                        try
                        {
                            var result = Services.AddGameService.ListLibraryGames();
                            // ListLibraryGames returns object with appids array
                            var appids = result.GetType().GetProperty("appids")?.GetValue(result) as string[] ?? Array.Empty<string>();
                            SendToJs(new { type = "LibraryAppIds", appids = appids });
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"GetLibraryAppIds error: {ex.Message}");
                            SendToJs(new { type = "LibraryAppIds", appids = Array.Empty<string>(), error = ex.Message });
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
                    case "GetLicenseInfo":
                    {
                        try
                        {
                            var license = Services.LicenseService.GetCurrentLicense();
                            // Get device ID async untuk menghindari blocking
                            string deviceId = await Task.Run(() => GameHubLicensing.DeviceIdHelper.GetDeviceId());
                            string licenseKeyDisplay = "";
                            
                            // Mask license key untuk keamanan (tampilkan 8 karakter pertama dan terakhir)
                            if (!string.IsNullOrEmpty(license.LicenseKey))
                            {
                                var key = license.LicenseKey;
                                if (key.Length > 16)
                                {
                                    licenseKeyDisplay = key.Substring(0, 8) + "..." + key.Substring(key.Length - 8);
                                }
                                else
                                {
                                    licenseKeyDisplay = key.Substring(0, Math.Min(8, key.Length)) + "...";
                                }
                            }
                            
                            SendToJs(new
                            {
                                type = "LicenseInfo",
                                plan = license.Plan,
                                isActive = license.IsActive,
                                isValid = license.IsValid,
                                licenseKey = licenseKeyDisplay,
                                deviceId = deviceId,
                                errorMessage = license.ErrorMessage
                            });
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"GetLicenseInfo error: {ex.Message}");
                            SendToJs(new
                            {
                                type = "LicenseInfo",
                                plan = "standard",
                                isActive = false,
                                isValid = false,
                                licenseKey = "",
                                deviceId = "",
                                errorMessage = ex.Message
                            });
                        }
                        break;
                    }
                    case "GetUpdateState":
                    {
                        var snapshot = _updateService.GetStateSnapshot();
                        SendToJs(new
                        {
                            type = "UpdateState",
                            lastCheckedUtc = snapshot.LastCheckedUtc,
                            lastKnownRemoteVersion = snapshot.LastKnownRemoteVersion,
                            lastDownloadedInstallerPath = snapshot.LastDownloadedInstallerPath,
                            lastPromptUtc = snapshot.LastPromptUtc
                        });
                        break;
                    }
                    case "CheckForUpdates":
                    {
                        var forceRefresh = msg.payload.TryGetProperty("forceRefresh", out var fr) && fr.ValueKind == JsonValueKind.True;
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                var result = await _updateService.CheckForUpdatesAsync(forceRefresh).ConfigureAwait(false);
                                await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                                {
                                    SendToJs(new
                                    {
                                        type = "UpdateCheckResult",
                                        success = result.Success,
                                        updateAvailable = result.UpdateAvailable,
                                        currentVersion = result.CurrentVersion,
                                        latestVersion = result.LatestMetadata?.Version,
                                        metadata = result.LatestMetadata,
                                        checkedAtUtc = result.CheckedAtUtc,
                                        error = result.Error
                                    });
                                });
                            }
                            catch (Exception ex)
                            {
                                await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                                {
                                    SendToJs(new
                                    {
                                        type = "UpdateCheckResult",
                                        success = false,
                                        error = ex.Message
                                    });
                                });
                            }
                        });
                        break;
                    }
                    case "DownloadUpdateInstaller":
                    {
                        if (!msg.payload.TryGetProperty("metadata", out var metadataElement) || metadataElement.ValueKind == JsonValueKind.Undefined || metadataElement.ValueKind == JsonValueKind.Null)
                        {
                            SendToJs(new { type = "UpdateDownloadComplete", success = false, error = "Metadata update tidak tersedia" });
                            break;
                        }

                        Services.UpdateMetadata? metadata = null;
                        try
                        {
                            metadata = JsonSerializer.Deserialize<Services.UpdateMetadata>(metadataElement.GetRawText(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"DownloadUpdateInstaller metadata parse error: {ex.Message}");
                        }

                        if (metadata == null)
                        {
                            SendToJs(new { type = "UpdateDownloadComplete", success = false, error = "Metadata update tidak valid" });
                            break;
                        }

                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                var result = await _updateService.DownloadInstallerAsync(metadata, async progress =>
                                {
                                    await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                                    {
                                        SendToJs(new
                                        {
                                            type = "UpdateDownloadProgress",
                                            percent = progress.Percent,
                                            bytesReceived = progress.BytesReceived,
                                            totalBytes = progress.TotalBytes
                                        });
                                    });
                                }).ConfigureAwait(false);

                                await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                                {
                                    SendToJs(new
                                    {
                                        type = "UpdateDownloadComplete",
                                        success = result.Success,
                                        error = result.Error,
                                        installerPath = result.InstallerPath,
                                        metadata = result.Metadata
                                    });
                                });
                            }
                            catch (Exception ex)
                            {
                                await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                                {
                                    SendToJs(new
                                    {
                                        type = "UpdateDownloadComplete",
                                        success = false,
                                        error = ex.Message
                                    });
                                });
                            }
                        });
                        break;
                    }
                    case "InstallLatestUpdate":
                    {
                        if (!msg.payload.TryGetProperty("metadata", out var metadataElement) || metadataElement.ValueKind == JsonValueKind.Undefined || metadataElement.ValueKind == JsonValueKind.Null)
                        {
                            SendToJs(new { type = "UpdateInstallComplete", success = false, error = "Metadata update tidak tersedia" });
                            break;
                        }

                        Services.UpdateMetadata? metadata = null;
                        try
                        {
                            metadata = JsonSerializer.Deserialize<Services.UpdateMetadata>(metadataElement.GetRawText(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"InstallLatestUpdate metadata parse error: {ex.Message}");
                        }

                        if (metadata == null)
                        {
                            SendToJs(new { type = "UpdateInstallComplete", success = false, error = "Metadata update tidak valid" });
                            break;
                        }

                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                var result = await _updateService.PrepareInstallerAsync(metadata, async progress =>
                                {
                                    await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                                    {
                                        SendToJs(new
                                        {
                                            type = "UpdateInstallProgress",
                                            stage = progress.Stage.ToString(),
                                            percent = progress.Percent,
                                            bytesReceived = progress.BytesReceived,
                                            totalBytes = progress.TotalBytes,
                                            message = progress.Message,
                                            installerPath = progress.InstallerPath,
                                            exitCode = progress.ExitCode
                                        });
                                    });
                                }).ConfigureAwait(false);

                                await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                                {
                                    SendToJs(new
                                    {
                                        type = "UpdateInstallComplete",
                                        success = result.Success,
                                        error = result.Error,
                                        installerPath = result.InstallerPath,
                                        exitCode = result.ExitCode
                                    });
                                });
                            }
                            catch (Exception ex)
                            {
                                await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                                {
                                    SendToJs(new
                                    {
                                        type = "UpdateInstallComplete",
                                        success = false,
                                        error = ex.Message
                                    });
                                });
                            }
                        });
                        break;
                    }
                    case "QuitAndInstallUpdate":
                    {
                        var installerPath = msg.payload.TryGetProperty("installerPath", out var ip) ? ip.GetString() : null;
                        bool launched = false;
                        try
                        {
                            launched = _updateService.LaunchInstallerInteractive(installerPath);
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"QuitAndInstallUpdate error: {ex.Message}");
                            launched = false;
                        }

                        if (!launched)
                        {
                            SendToJs(new { type = "QuitAndInstallResult", success = false, error = "Installer tidak dapat dijalankan. Pastikan file masih tersedia." });
                            break;
                        }

                        SendToJs(new { type = "QuitAndInstallResult", success = true });

                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                await Task.Delay(500);
                                await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                                {
                                    try { Close(); } catch { }
                                    try { System.Windows.Application.Current?.Shutdown(); } catch { }
                                });
                            }
                            catch
                            {
                                // ignore
                            }
                        });
                        break;
                    }
                    case "FixGamesCheckAntivirus":
                    {
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                var result = await _fixGames.CheckAntivirusAsync();
                                System.Windows.Application.Current?.Dispatcher?.Invoke(() => SendToJs(result), System.Windows.Threading.DispatcherPriority.Normal);
                            }
                            catch (Exception ex)
                            {
                                _appLog.Append($"FixGamesCheckAntivirus error: {ex.Message}");
                                // Send error response instead of throwing
                                var errorResponse = new
                                {
                                    type = "FixGamesAntivirusCheck",
                                    success = false,
                                    error = ex.Message,
                                    hasWindowsDefender = false,
                                    hasOtherAntivirus = false
                                };
                                System.Windows.Application.Current?.Dispatcher?.Invoke(() => SendToJs(errorResponse), System.Windows.Threading.DispatcherPriority.Normal);
                            }
                        });
                        break;
                    }
                    case "FixGamesAutoExclude":
                    {
                        var gamePath = msg.payload.TryGetProperty("gamePath", out var gp) ? gp.GetString() : string.Empty;
                        if (string.IsNullOrWhiteSpace(gamePath))
                        {
                            SendToJs(new { type = "FixGamesAutoExclude", success = false, error = "Path tidak valid" });
                            break;
                        }
                        _ = Task.Run(async () =>
                        {
                            var result = await _fixGames.AutoExcludePathAsync(gamePath);
                            await System.Windows.Application.Current.Dispatcher.InvokeAsync(() => SendToJs(result));
                        });
                        break;
                    }
                    case "FixGamesSelectManualPath":
                    {
                        string? selectedPath = null;
                        try
                        {
                            // Buka dialog pemilihan folder di UI thread
                            System.Windows.Application.Current?.Dispatcher?.Invoke(() =>
                            {
                                try
                                {
                                    using (var dlg = new System.Windows.Forms.FolderBrowserDialog())
                                    {
                                        dlg.Description = "Pilih folder instalasi game (steamapps\\common\\NamaGame)";
                                        dlg.ShowNewFolderButton = false;
                                        if (dlg.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                                        {
                                            selectedPath = dlg.SelectedPath;
                                        }
                                    }
                                }
                                catch (Exception ex2)
                                {
                                    _appLog.Append($"FixGamesSelectManualPath dialog error: {ex2.Message}");
                                }
                            }, System.Windows.Threading.DispatcherPriority.Normal);
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"FixGamesSelectManualPath error: {ex.Message}");
                        }

                        if (!string.IsNullOrWhiteSpace(selectedPath))
                        {
                            SendToJs(new
                            {
                                type = "FixGamesManualPathSelected",
                                success = true,
                                path = selectedPath
                            });
                        }
                        else
                        {
                            SendToJs(new
                            {
                                type = "FixGamesManualPathSelected",
                                success = false,
                                error = "Pemilihan folder dibatalkan atau tidak ada folder yang dipilih."
                            });
                        }
                        break;
                    }
                    case "FixGamesDetectPath":
                    {
                        // Robust parsing untuk appid: bisa dikirim sebagai number atau string dari JS
                        int appid = 0;
                        if (msg.payload.TryGetProperty("appid", out var a))
                        {
                            try
                            {
                                if (a.ValueKind == JsonValueKind.Number && a.TryGetInt32(out var num))
                                {
                                    appid = num;
                                }
                                else if (a.ValueKind == JsonValueKind.String)
                                {
                                    var s = a.GetString();
                                    _ = int.TryParse(s, out appid);
                                }
                            }
                            catch (Exception ex)
                            {
                                _appLog.Append($"FixGamesDetectPath appid parse error: {ex.Message}");
                                appid = 0;
                            }
                        }

                        var gameTitle = msg.payload.TryGetProperty("gameTitle", out var gt) ? gt.GetString() ?? string.Empty : string.Empty;

                        if (appid <= 0)
                        {
                            SendToJs(new
                            {
                                type = "FixGamesDetectPath",
                                success = false,
                                error = "AppID tidak valid",
                                gameNotInstalled = true,
                                message = "Game mungkin belum Anda install atau tidak ditemukan di Steam library. Silakan cari folder game secara manual atau pastikan game sudah terinstall di Steam."
                            });
                            break;
                        }

                        _appLog.Append($"FixGamesDetectPath mulai appid={appid}");
                        try
                        {
                            // Panggil service secara async, lanjutannya tetap di UI thread (seperti CheckOnlineFix)
                            var result = await _fixGames.DetectGamePathAsync(appid, gameTitle ?? "");

                            // Log hasil success/fail untuk debugging
                            try
                            {
                                var resultType = result.GetType();
                                var successProp = resultType.GetProperty("success");
                                var successValue = successProp?.GetValue(result) ?? false;
                                _appLog.Append($"FixGamesDetectPath result: success={successValue}");
                            }
                            catch { }

                            // Kirim ke JS dari UI thread
                            SendToJs(result);
                        }
                        catch (Exception ex)
                        {
                            _appLog.Append($"FixGamesDetectPath error: {ex.Message}");
                            var errorResponse = new
                            {
                                type = "FixGamesDetectPath",
                                success = false,
                                gameNotInstalled = true,
                                error = ex.Message,
                                message = "Game mungkin belum Anda install atau tidak ditemukan di Steam library. Silakan cari folder game secara manual atau pastikan game sudah terinstall di Steam."
                            };
                            SendToJs(errorResponse);
                        }
                        break;
                    }
                    case "FixGamesDownload":
                    {
                        // appid bisa dikirim sebagai number atau string
                        int appid = 0;
                        if (msg.payload.TryGetProperty("appid", out var a))
                        {
                            try
                            {
                                if (a.ValueKind == JsonValueKind.Number && a.TryGetInt32(out var num))
                                {
                                    appid = num;
                                }
                                else if (a.ValueKind == JsonValueKind.String)
                                {
                                    var s = a.GetString();
                                    _ = int.TryParse(s, out appid);
                                }
                            }
                            catch (Exception ex)
                            {
                                _appLog.Append($"FixGamesDownload appid parse error: {ex.Message}");
                                appid = 0;
                            }
                        }

                        var files = msg.payload.TryGetProperty("files", out var f) ? f : default;
                        if (appid <= 0 || files.ValueKind != JsonValueKind.Array)
                        {
                            SendToJs(new { type = "FixGamesDownloadError", error = "Parameter tidak valid" });
                            break;
                        }
                        _ = Task.Run(async () =>
                        {
                            Func<object, Task> sendProgress = async (obj) =>
                            {
                                await System.Windows.Application.Current.Dispatcher.InvokeAsync(() => SendToJs(obj));
                            };
                            var result = await _fixGames.DownloadFilesAsync(appid, files, sendProgress);
                            await System.Windows.Application.Current.Dispatcher.InvokeAsync(() => SendToJs(result));
                        });
                        break;
                    }
                    case "FixGamesExtract":
                    {
                        var downloadPath = msg.payload.TryGetProperty("downloadPath", out var dp) ? dp.GetString() : string.Empty;
                        var filesJson = msg.payload.TryGetProperty("files", out var f) ? f : default;
                        var password = msg.payload.TryGetProperty("password", out var p) ? p.GetString() : string.Empty;
                        var gamePath = msg.payload.TryGetProperty("gamePath", out var gp) ? gp.GetString() : null;
                        
                        var files = new List<string>();
                        if (filesJson.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var file in filesJson.EnumerateArray())
                            {
                                if (file.ValueKind == JsonValueKind.String)
                                {
                                    files.Add(file.GetString() ?? "");
                                }
                            }
                        }
                        
                        _ = Task.Run(async () =>
                        {
                            Func<object, Task> sendProgress = async (obj) =>
                            {
                                await System.Windows.Application.Current.Dispatcher.InvokeAsync(() => SendToJs(obj));
                            };
                            var result = await _fixGames.ExtractFilesAsync(downloadPath ?? "", files, password ?? "", sendProgress, gamePath);
                            await System.Windows.Application.Current.Dispatcher.InvokeAsync(() => SendToJs(result));
                        });
                        break;
                    }
                    case "FixGamesReplace":
                    {
                        var gamePath = msg.payload.TryGetProperty("gamePath", out var gp) ? gp.GetString() : string.Empty;
                        var extractedPath = msg.payload.TryGetProperty("extractedPath", out var ep) ? ep.GetString() : string.Empty;
                        
                        _ = Task.Run(async () =>
                        {
                            Func<object, Task> sendProgress = async (obj) =>
                            {
                                await System.Windows.Application.Current.Dispatcher.InvokeAsync(() => SendToJs(obj));
                            };
                            var result = await _fixGames.ReplaceFilesAsync(gamePath ?? "", extractedPath ?? "", sendProgress);
                            await System.Windows.Application.Current.Dispatcher.InvokeAsync(() => SendToJs(result));
                        });
                        break;
                    }
                    case "FixGamesCleanup":
                    {
                        var downloadPath = msg.payload.TryGetProperty("downloadPath", out var dp) ? dp.GetString() : string.Empty;
                        var extractedPath = msg.payload.TryGetProperty("extractedPath", out var ep) ? ep.GetString() : string.Empty;
                        
                        _ = Task.Run(async () =>
                        {
                            var result = await _fixGames.CleanupTempFilesAsync(downloadPath ?? "", extractedPath ?? "");
                            await System.Windows.Application.Current.Dispatcher.InvokeAsync(() => SendToJs(result));
                        });
                        break;
                    }
                    case "FixGamesCancel":
                    {
                        // appid bisa dikirim sebagai number atau string
                        int appid = 0;
                        if (msg.payload.TryGetProperty("appid", out var a))
                        {
                            try
                            {
                                if (a.ValueKind == JsonValueKind.Number && a.TryGetInt32(out var num))
                                {
                                    appid = num;
                                }
                                else if (a.ValueKind == JsonValueKind.String)
                                {
                                    var s = a.GetString();
                                    _ = int.TryParse(s, out appid);
                                }
                            }
                            catch (Exception ex)
                            {
                                _appLog.Append($"FixGamesCancel appid parse error: {ex.Message}");
                                appid = 0;
                            }
                        }

                        if (appid > 0)
                        {
                            _fixGames.Cancel(appid);
                        }
                        break;
                    }
                    case "FixGamesScanExecutables":
                    {
                        var gamePath = msg.payload.TryGetProperty("gamePath", out var gp) ? gp.GetString() : string.Empty;
                        var gameTitle = msg.payload.TryGetProperty("gameTitle", out var gt) ? gt.GetString() : null;
                        if (string.IsNullOrWhiteSpace(gamePath))
                        {
                            SendToJs(new { type = "FixGamesScanExecutables", success = false, error = "Game path tidak valid" });
                            break;
                        }
                        _ = Task.Run(async () =>
                        {
                            var result = await _fixGames.ScanExecutablesAsync(gamePath, gameTitle);
                            await System.Windows.Application.Current.Dispatcher.InvokeAsync(() => SendToJs(result));
                        });
                        break;
                    }
                    case "FixGamesCreateShortcut":
                    {
                        var exePath = msg.payload.TryGetProperty("exePath", out var ep) ? ep.GetString() : string.Empty;
                        var shortcutName = msg.payload.TryGetProperty("shortcutName", out var sn) ? sn.GetString() : string.Empty;
                        var gamePath = msg.payload.TryGetProperty("gamePath", out var gp) ? gp.GetString() : string.Empty;
                        
                        if (string.IsNullOrWhiteSpace(exePath))
                        {
                            SendToJs(new { type = "FixGamesCreateShortcut", success = false, error = "Executable path tidak valid" });
                            break;
                        }
                        
                        _ = Task.Run(async () =>
                        {
                            var result = await _fixGames.CreateDesktopShortcutAsync(exePath, shortcutName ?? "", gamePath ?? "");
                            await System.Windows.Application.Current.Dispatcher.InvokeAsync(() => SendToJs(result));
                        });
                        break;
                    }
                    case "ActivateLicense":
                    {
                        var licenseKey = msg.payload.TryGetProperty("licenseKey", out var lk) ? (lk.GetString() ?? string.Empty) : string.Empty;
                        
                        if (string.IsNullOrWhiteSpace(licenseKey))
                        {
                            SendToJs(new
                            {
                                type = "LicenseActivationResult",
                                success = false,
                                error = "License key tidak boleh kosong"
                            });
                            break;
                        }
                        
                        _appLog.Append($"Activating license: {licenseKey.Substring(0, Math.Min(8, licenseKey.Length))}...");
                        
                        // Jalankan aktivasi di background thread agar tidak blocking UI
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                Services.LicenseService.ClearCache();
                                var result = await Services.LicenseService.ActivateAsync(licenseKey).ConfigureAwait(false);
                                
                                // Deteksi status error untuk pesan yang lebih spesifik
                                bool isBanned = false;
                                bool isNotFound = false;
                                bool isWrongDevice = false;
                                
                                if (!result.IsActive && !string.IsNullOrEmpty(result.ErrorMessage))
                                {
                                    var errorLower = result.ErrorMessage.ToLower();
                                    isBanned = errorLower.Contains("banned") || errorLower.Contains("dibanned");
                                    isNotFound = errorLower.Contains("tidak ditemukan") || errorLower.Contains("not_found") || errorLower.Contains("not found");
                                    isWrongDevice = errorLower.Contains("perangkat lain") || errorLower.Contains("wrong_device") || errorLower.Contains("device berbeda");
                                }
                                
                                // Gunakan Dispatcher untuk memastikan SendToJs dipanggil di UI thread
                                await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                                {
                                    try
                                    {
                                        SendToJs(new
                                        {
                                            type = "LicenseActivationResult",
                                            success = result.IsActive && result.IsValid,
                                            plan = result.Plan,
                                            message = result.ErrorMessage ?? (result.IsActive ? "License berhasil diaktivasi!" : "License gagal diaktivasi"),
                                            error = result.ErrorMessage,
                                            isBanned = isBanned,
                                            isNotFound = isNotFound,
                                            isWrongDevice = isWrongDevice,
                                            licenseKey = result.LicenseKey
                                        });
                                    }
                                    catch (Exception sendEx)
                                    {
                                        _appLog.Append($"Error sending activation response: {sendEx.Message}");
                                    }
                                }, System.Windows.Threading.DispatcherPriority.Normal);
                            }
                            catch (Exception ex)
                            {
                                _appLog.Append($"License activation error: {ex.Message}");
                                
                                await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                                {
                                    SendToJs(new
                                    {
                                        type = "LicenseActivationResult",
                                        success = false,
                                        message = $"Error: {ex.Message}"
                                    });
                                }, System.Windows.Threading.DispatcherPriority.Normal);
                            }
                        });
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                _appLog.Append($"Exception: {ex.Message}");
                // Don't send error message to JS - it interferes with other handlers
                // Only log to app log for debugging
                // SendToJs(new { type = "error", message = ex.Message });
            }
        }

        private void SendToJs(object obj)
        {
            string? json = null;
            try
            {
                json = JsonSerializer.Serialize(obj);
            }
            catch (Exception ex)
            {
                _appLog.Append($"[SendToJs] Serialize error: {ex.Message}");
                return;
            }

            if (string.IsNullOrEmpty(json)) return;

            // Pastikan PostWebMessageAsJson selalu dipanggil dari UI thread
            try
            {
                if (WebView?.CoreWebView2 == null)
                {
                    _appLog.Append("[SendToJs] WebView.CoreWebView2 is null, cannot send message to JS.");
                }
                else if (System.Windows.Application.Current?.Dispatcher != null)
                {
                    if (System.Windows.Application.Current.Dispatcher.CheckAccess())
                    {
            WebView.CoreWebView2.PostWebMessageAsJson(json);
                    }
                    else
                    {
                        System.Windows.Application.Current.Dispatcher.Invoke(() =>
                        {
                            try
                            {
                                WebView.CoreWebView2.PostWebMessageAsJson(json);
                            }
                            catch (Exception ex)
                            {
                                _appLog.Append($"[SendToJs] Dispatcher PostWebMessage error: {ex.Message}");
                            }
                        }, System.Windows.Threading.DispatcherPriority.Normal);
                    }
                }
                else
                {
                    // Fallback: coba kirim langsung (tidak ideal, tapi lebih baik daripada diam)
                    WebView.CoreWebView2.PostWebMessageAsJson(json);
                }
            }
            catch (Exception ex)
            {
                _appLog.Append($"[SendToJs] PostWebMessage error: {ex.Message}");
                return;
            }

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
                // Hanya log event penting, skip event yang terlalu sering
                if (!string.IsNullOrWhiteSpace(type) && 
                    !string.Equals(type, "RawDatasetProgress", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(type, "AppLogAppend", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(type, "AppLog", StringComparison.OrdinalIgnoreCase))
                {
                    // Skip logging untuk event yang terlalu sering atau tidak penting
                    var importantEvents = new[] { "Error", "Exception", "LicenseActivationResult", "OverrideUpdateResult" };
                    bool isImportantEvent = false;
                    foreach (var evt in importantEvents)
                    {
                        if (type.Contains(evt, StringComparison.OrdinalIgnoreCase))
                        {
                            isImportantEvent = true;
                            break;
                        }
                    }
                    if (isImportantEvent)
                    {
                        _appLog.Append($"Event: {type}");
                    }
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
