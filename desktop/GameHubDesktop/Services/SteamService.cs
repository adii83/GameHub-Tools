using System;

namespace GameHubDesktop.Services
{
    public static class SteamService
    {
        public static Action<string>? Log { get; set; }
        private static void LogInfo(string message)
        {
            try { Log?.Invoke($"[SteamService] {message}"); } catch { }
        }
        public static void RestartSteam(Action<object> sendToJs)
        {
            try
            {
                LogInfo("Mulai restart/start Steam");
                var procs = System.Diagnostics.Process.GetProcessesByName("steam");
                if (procs != null && procs.Length > 0)
                {
                    foreach (var p in procs)
                    {
                        try
                        {
                            LogInfo($"Menutup proses steam pid={p.Id}");
                            p.CloseMainWindow();
                            p.WaitForExit(3000);
                            if (!p.HasExited) { LogInfo($"Kill proses steam pid={p.Id}"); p.Kill(); }
                        }
                        catch (Exception ex) { LogInfo($"Gagal menutup steam pid={p.Id}: {ex.Message}"); }
                    }
                }
                var steamExe = DetectSteamExePath();
                if (string.IsNullOrWhiteSpace(steamExe)) throw new InvalidOperationException("Steam tidak ditemukan");
                LogInfo("Menjalankan Steam (path disamarkan)");
                System.Diagnostics.Process.Start(steamExe);
                sendToJs(new { type = "RestartSteamResult", success = true });
                LogInfo("Restart Steam berhasil");
            }
            catch (Exception ex)
            {
                LogInfo($"Restart Steam gagal: {ex.Message}");
                sendToJs(new { type = "RestartSteamResult", success = false, error = ex.Message });
            }
        }

        private static string DetectSteamExePath()
        {
            try
            {
                // Coba dari registry
                string?[] candidates = new string?[] {
                    SafeRegGet(Microsoft.Win32.Registry.CurrentUser, "Software\\Valve\\Steam", "SteamPath"),
                    SafeRegGet(Microsoft.Win32.Registry.CurrentUser, "Software\\WOW6432Node\\Valve\\Steam", "SteamPath"),
                    SafeRegGet(Microsoft.Win32.Registry.LocalMachine, "Software\\Valve\\Steam", "InstallPath"),
                    SafeRegGet(Microsoft.Win32.Registry.LocalMachine, "Software\\WOW6432Node\\Valve\\Steam", "InstallPath"),
                    @"C:\\Program Files (x86)\\Steam",
                    @"C:\\Program Files\\Steam"
                };
                foreach (var dir in candidates)
                {
                    try
                    {
                        if (!string.IsNullOrWhiteSpace(dir))
                        {
                            var exe = System.IO.Path.Combine(dir!, "steam.exe");
                            if (System.IO.File.Exists(exe)) return exe;
                        }
                    }
                    catch { }
                }
                // Coba dari proses yang sedang berjalan
                var procs = System.Diagnostics.Process.GetProcessesByName("steam");
                foreach (var p in procs)
                {
                    try
                    {
                        var exe = p.MainModule?.FileName;
                        if (!string.IsNullOrWhiteSpace(exe) && System.IO.File.Exists(exe)) return exe!;
                    }
                    catch { }
                }
            }
            catch { }
            return string.Empty;
        }

        private static string? SafeRegGet(Microsoft.Win32.RegistryKey root, string subKey, string valueName)
        {
            try { using var k = root.OpenSubKey(subKey); return k?.GetValue(valueName) as string; } catch { return null; }
        }
    }
}
