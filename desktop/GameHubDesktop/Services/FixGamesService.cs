using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Management;
using Microsoft.Win32;
using System.Text.Json;
using System.Security.Principal;
using System.Net;
using System.Text.RegularExpressions;
using SharpCompress.Archives;
using SharpCompress.Archives.Rar;
using SharpCompress.Archives.Zip;
using SharpCompress.Common;
using SharpCompress.Readers;
using System.Drawing;
using System.Drawing.Imaging;

namespace GameHubDesktop.Services
{
    public class FixGamesService
    {
        private readonly HttpClient _http = new HttpClient(new HttpClientHandler 
        { 
            AllowAutoRedirect = true,
            UseCookies = true,
            CookieContainer = new CookieContainer()
        })
        {
            Timeout = TimeSpan.FromMinutes(30) // Longer timeout for large downloads
        };

        private readonly ConcurrentDictionary<int, CancellationTokenSource> _cts = new();
        private string? _tempDownloadPath;

        public Action<string>? Log { get; set; }
        
        private void LogInfo(string message)
        {
            try { Log?.Invoke($"[FixGamesService] {message}"); } catch { }
        }

        public FixGamesService()
        {
            _tempDownloadPath = Path.Combine(Path.GetTempPath(), "GameHubFixGames");
            if (!Directory.Exists(_tempDownloadPath))
            {
                Directory.CreateDirectory(_tempDownloadPath);
            }
        }

        // Step 1: Check Antivirus
        public async Task<object> CheckAntivirusAsync()
        {
            LogInfo("Memeriksa antivirus yang terinstall...");

            try
            {
                var antivirusList = new List<string>();

                // Check Windows Security Center via WMI
                try
                {
                    using var searcher = new ManagementObjectSearcher(
                        "SELECT * FROM AntiVirusProduct",
                        "root\\SecurityCenter2"
                    );

                    foreach (ManagementObject obj in searcher.Get())
                    {
                        try
                        {
                            // Try to get displayName property safely
                            string? productName = null;

                            // Try to get product name using PropertyData collection (safer)
                            try
                            {
                                // Use Properties collection to safely enumerate all properties
                                foreach (PropertyData prop in obj.Properties)
                                {
                                    try
                                    {
                                        // Only check properties that might contain name
                                        var propName = prop.Name.ToLowerInvariant();
                                        if (propName.Contains("name") ||
                                            propName.Contains("display") ||
                                            propName.Contains("product"))
                                        {
                                            var propValue = prop.Value;
                                            if (propValue != null)
                                            {
                                                // Only use string values, skip all numeric types
                                                if (propValue is string str &&
                                                    !string.IsNullOrWhiteSpace(str))
                                                {
                                                    productName = str;
                                                    break; // Found valid name
                                                }
                                                // Explicitly skip numeric types
                                                else if (propValue is int || propValue is long ||
                                                         propValue is uint || propValue is ulong ||
                                                         propValue is short || propValue is ushort ||
                                                         propValue is byte || propValue is sbyte ||
                                                         propValue is float || propValue is double ||
                                                         propValue is decimal)
                                                {
                                                    // Skip numeric values completely
                                                    continue;
                                                }
                                            }
                                        }
                                    }
                                    catch
                                    {
                                        // Skip this property, try next
                                        continue;
                                    }
                                }
                            }
                            catch
                            {
                                // If Properties enumeration fails, try direct access as fallback
                                try
                                {
                                    var propertyNames = new[] { "displayName", "DisplayName", "name", "Name" };
                                    foreach (var propName in propertyNames)
                                    {
                                        try
                                        {
                                            var propValue = obj[propName];
                                            if (propValue != null && propValue is string str && !string.IsNullOrWhiteSpace(str))
                                            {
                                                productName = str;
                                                break;
                                            }
                                        }
                                        catch
                                        {
                                            continue;
                                        }
                                    }
                                }
                                catch
                                {
                                    // All methods failed, skip this object
                                }
                            }

                            if (!string.IsNullOrWhiteSpace(productName))
                            {
                                antivirusList.Add(productName);
                                LogInfo($"Ditemukan antivirus: {productName}");
                            }
                        }
                        catch (Exception propEx)
                        {
                            LogInfo($"Error reading antivirus property: {propEx.Message}");
                            // Continue to next object - don't fail entire check
                        }
                    }
                }
                catch (Exception ex)
                {
                    // WMI query failed - log but don't fail entire antivirus check
                    LogInfo($"WMI query error (non-fatal): {ex.Message}");
                    // Continue with registry check
                }

                // Check Registry for common antivirus
                var registryKeys = new[]
                {
                    @"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
                    @"SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
                };

                var commonAntivirus = new[]
                {
                    "McAfee", "Norton", "Kaspersky", "Avast", "AVG", "Bitdefender",
                    "ESET", "Trend Micro", "Sophos", "Malwarebytes", "Avira"
                };

                foreach (var regKey in registryKeys)
                {
                    try
                    {
                        using var key = Registry.LocalMachine.OpenSubKey(regKey);
                        if (key == null) continue;

                        foreach (var subKeyName in key.GetSubKeyNames())
                        {
                            using var subKey = key.OpenSubKey(subKeyName);
                            if (subKey == null) continue;

                            var displayName = subKey.GetValue("DisplayName")?.ToString() ?? string.Empty;
                            foreach (var av in commonAntivirus)
                            {
                                if (displayName.Contains(av, StringComparison.OrdinalIgnoreCase))
                                {
                                    if (!antivirusList.Any(a => a.Contains(av, StringComparison.OrdinalIgnoreCase)))
                                    {
                                        antivirusList.Add(displayName);
                                        LogInfo($"Ditemukan antivirus (Registry): {displayName}");
                                    }
                                }
                            }
                        }
                    }
                    catch { }
                }

                // Filter out Windows Defender
                var nonDefenderAntivirus = antivirusList
                    .Where(av => !av.Contains("Windows Defender", StringComparison.OrdinalIgnoreCase) &&
                                 !av.Contains("Microsoft Defender", StringComparison.OrdinalIgnoreCase))
                    .ToList();

                bool hasNonDefender = nonDefenderAntivirus.Any();
                
                LogInfo($"Hasil scan: Windows Defender={(antivirusList.Any(a => a.Contains("Windows Defender", StringComparison.OrdinalIgnoreCase)) ? "Ya" : "Tidak")}, Antivirus Lain={(hasNonDefender ? "Ya" : "Tidak")}");

                return new
                {
                    type = "FixGamesAntivirusCheck",
                    hasWindowsDefender = antivirusList.Any(a => a.Contains("Windows Defender", StringComparison.OrdinalIgnoreCase)),
                    hasOtherAntivirus = hasNonDefender,
                    otherAntivirus = nonDefenderAntivirus,
                    success = true
                };
            }
            catch (Exception ex)
            {
                // Log error but return success=false instead of throwing
                LogInfo($"Error checking antivirus (non-fatal): {ex.Message}");
                // Return error response but don't throw - let caller continue
                return new
                {
                    type = "FixGamesAntivirusCheck",
                    success = false,
                    error = ex.Message,
                    hasWindowsDefender = false,
                    hasOtherAntivirus = false,
                    otherAntivirus = new List<string>()
                };
            }
        }

        // Helper: Check if running as Administrator
        public static bool IsRunningAsAdministrator()
        {
            try
            {
                var identity = WindowsIdentity.GetCurrent();
                var principal = new WindowsPrincipal(identity);
                return principal.IsInRole(WindowsBuiltInRole.Administrator);
            }
            catch
            {
                return false;
            }
        }

        // Step 2: Auto-Exclude from Windows Defender
        public async Task<object> AutoExcludePathAsync(string gamePath)
        {
            LogInfo($"Menambahkan path ke Windows Defender exclusion");
            
            bool isAdmin = IsRunningAsAdministrator();
            LogInfo($"Running as Administrator: {isAdmin}");
            
            try
            {
                if (string.IsNullOrWhiteSpace(gamePath) || !Directory.Exists(gamePath))
                {
                    return new
                    {
                        type = "FixGamesAutoExclude",
                        success = false,
                        error = "Path tidak valid atau tidak ditemukan",
                        needsAdmin = !isAdmin
                    };
                }

                // Step 1: Try to add exclusion
                // PERBAIKAN: Normalize path dan improve error handling
                var normalizedPath = gamePath.Replace("'", "''").TrimEnd('\\');
                var addScript = $@"
                    $path = '{normalizedPath}'
                    $pathNormalized = $path.TrimEnd('\')
                    try {{
                        # Cek dulu apakah path sudah ada di exclusion
                        $existing = Get-MpPreference -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ExclusionPath
                        if ($null -ne $existing) {{
                            foreach ($excl in $existing) {{
                                $exclNormalized = $excl.TrimEnd('\')
                                if ($exclNormalized -eq $pathNormalized -or $exclNormalized -ieq $pathNormalized) {{
                                    Write-Output 'ALREADY_EXISTS'
                                    exit
                                }}
                            }}
                        }}
                        # Jika belum ada, tambahkan
                        Add-MpPreference -ExclusionPath $pathNormalized -ErrorAction Stop
                        Write-Output 'SUCCESS'
                    }} catch {{
                        $errorMsg = $_.Exception.Message
                        Write-Output 'ERROR:' + $errorMsg
                        Write-Error $errorMsg
                    }}
                ";

                var addProcessInfo = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -ExecutionPolicy Bypass -Command \"{addScript}\"",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };

                using var addProcess = Process.Start(addProcessInfo);
                if (addProcess != null)
                {
                    await addProcess.WaitForExitAsync();
                    var addOutput = await addProcess.StandardOutput.ReadToEndAsync();
                    var addError = await addProcess.StandardError.ReadToEndAsync();
                    
                    LogInfo($"Add exclusion output: {addOutput.Trim()}");
                    if (!string.IsNullOrWhiteSpace(addError))
                    {
                        LogInfo($"Add exclusion error: {addError.Trim()}");
                    }
                    
                    // PERBAIKAN: Cek error SEBELUM verifikasi
                    // Check for errors in addOutput or addError first
                    // PERBAIKAN: Normalize output untuk menangkap format error yang aneh ("ERROR:\n+\n...")
                    var normalizedAddOutput = addOutput?.Replace("\r", "").Replace("\n", " ").Trim() ?? string.Empty;
                    var normalizedAddError = addError?.Replace("\r", "").Replace("\n", " ").Trim() ?? string.Empty;
                    
                    bool hasErrorInAdd = !string.IsNullOrWhiteSpace(normalizedAddOutput) && 
                        normalizedAddOutput.Contains("ERROR:", StringComparison.OrdinalIgnoreCase);
                    
                    bool hasAdminErrorInAdd = (!string.IsNullOrWhiteSpace(normalizedAddOutput) && 
                        (normalizedAddOutput.Contains("permission", StringComparison.OrdinalIgnoreCase) ||
                         normalizedAddOutput.Contains("enough permissions", StringComparison.OrdinalIgnoreCase) ||
                         normalizedAddOutput.Contains("access", StringComparison.OrdinalIgnoreCase) ||
                         normalizedAddOutput.Contains("denied", StringComparison.OrdinalIgnoreCase) ||
                         normalizedAddOutput.Contains("unauthorized", StringComparison.OrdinalIgnoreCase) ||
                         normalizedAddOutput.Contains("requires elevation", StringComparison.OrdinalIgnoreCase) ||
                         normalizedAddOutput.Contains("run as administrator", StringComparison.OrdinalIgnoreCase) ||
                         normalizedAddOutput.Contains("administrator", StringComparison.OrdinalIgnoreCase))) ||
                        (!string.IsNullOrWhiteSpace(normalizedAddError) && 
                        (normalizedAddError.Contains("access", StringComparison.OrdinalIgnoreCase) || 
                         normalizedAddError.Contains("denied", StringComparison.OrdinalIgnoreCase) ||
                         normalizedAddError.Contains("permission", StringComparison.OrdinalIgnoreCase) ||
                         normalizedAddError.Contains("unauthorized", StringComparison.OrdinalIgnoreCase) ||
                         normalizedAddError.Contains("requires elevation", StringComparison.OrdinalIgnoreCase) ||
                         normalizedAddError.Contains("run as administrator", StringComparison.OrdinalIgnoreCase) ||
                         normalizedAddError.Contains("administrator", StringComparison.OrdinalIgnoreCase) ||
                         normalizedAddError.Contains("enough permissions", StringComparison.OrdinalIgnoreCase)));
                    
                    // Jika ada error, langsung return tanpa verifikasi
                    if (hasErrorInAdd || hasAdminErrorInAdd)
                    {
                        LogInfo($"Gagal menambahkan exclusion - ada error di add process (hasErrorInAdd={hasErrorInAdd}, hasAdminErrorInAdd={hasAdminErrorInAdd}, isAdmin={isAdmin})");
                        LogInfo($"Add output: {addOutput?.Trim()}");
                        LogInfo($"Add error: {addError?.Trim()}");
                        return new
                        {
                            type = "FixGamesAutoExclude",
                            success = false,
                            error = "Gagal menambahkan exclusion. Pastikan aplikasi dijalankan sebagai Administrator.",
                            needsAdmin = true,
                            isAdmin = isAdmin
                        };
                    }
                    
                    // Check if already exists
                    if (!string.IsNullOrWhiteSpace(addOutput) && addOutput.Contains("ALREADY_EXISTS", StringComparison.OrdinalIgnoreCase))
                    {
                        LogInfo($"Path sudah ada di exclusion list: {gamePath}");
                        return new
                        {
                            type = "FixGamesAutoExclude",
                            success = true,
                            path = gamePath,
                            isAdmin = isAdmin,
                            alreadyExists = true
                        };
                    }
                    
                    // Check if SUCCESS was returned
                    if (string.IsNullOrWhiteSpace(addOutput) || !addOutput.Contains("SUCCESS", StringComparison.OrdinalIgnoreCase))
                    {
                        // If no SUCCESS and no error detected above, still treat as failure
                        LogInfo($"Add exclusion tidak mengembalikan SUCCESS atau ALREADY_EXISTS (output: {addOutput?.Trim()})");
                        return new
                        {
                            type = "FixGamesAutoExclude",
                            success = false,
                            error = "Gagal menambahkan exclusion. Pastikan aplikasi dijalankan sebagai Administrator.",
                            needsAdmin = true,
                            isAdmin = isAdmin
                        };
                    }
                    
                    // Step 2: Verify that exclusion was actually added
                    // PERBAIKAN: Normalize path dan gunakan case-insensitive comparison
                    // Note: normalizedPath sudah didefinisikan di atas
                    var verifyScript = $@"
                        $path = '{normalizedPath}'
                        $pathNormalized = $path.TrimEnd('\')
                        try {{
                            $exclusions = Get-MpPreference -ErrorAction Stop | Select-Object -ExpandProperty ExclusionPath
                            if ($null -eq $exclusions) {{
                                Write-Output 'NOT_FOUND'
                                exit
                            }}
                            $found = $false
                            foreach ($excl in $exclusions) {{
                                $exclNormalized = $excl.TrimEnd('\')
                                if ($exclNormalized -eq $pathNormalized -or 
                                    $exclNormalized -ieq $pathNormalized) {{
                                    $found = $true
                                    break
                                }}
                            }}
                            if ($found) {{
                                Write-Output 'FOUND'
                            }} else {{
                                Write-Output 'NOT_FOUND'
                            }}
                        }} catch {{
                            Write-Output 'ERROR:' + $_.Exception.Message
                        }}
                    ";

                    var verifyProcessInfo = new ProcessStartInfo
                    {
                        FileName = "powershell.exe",
                        Arguments = $"-NoProfile -ExecutionPolicy Bypass -Command \"{verifyScript}\"",
                        UseShellExecute = false,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        CreateNoWindow = true
                    };

                    string verifyOutput = string.Empty;
                    string verifyError = string.Empty;
                    
                    using var verifyProcess = Process.Start(verifyProcessInfo);
                    if (verifyProcess != null)
                    {
                        await verifyProcess.WaitForExitAsync();
                        verifyOutput = await verifyProcess.StandardOutput.ReadToEndAsync();
                        verifyError = await verifyProcess.StandardError.ReadToEndAsync();
                        
                        LogInfo($"Verify exclusion output: {verifyOutput.Trim()}");
                        if (!string.IsNullOrWhiteSpace(verifyError))
                        {
                            LogInfo($"Verify exclusion error: {verifyError.Trim()}");
                        }
                        
                        // Only return success if path is actually found in exclusion list
                        if (verifyOutput.Contains("FOUND", StringComparison.OrdinalIgnoreCase))
                        {
                            LogInfo($"Path berhasil ditambahkan dan diverifikasi di exclusion: {gamePath}");
                            return new
                            {
                                type = "FixGamesAutoExclude",
                                success = true,
                                path = gamePath,
                                isAdmin = isAdmin
                            };
                        }
                        
                        // If verification returned NOT_FOUND, exclusion was not added
                        if (verifyOutput.Contains("NOT_FOUND", StringComparison.OrdinalIgnoreCase))
                        {
                            LogInfo($"Path tidak ditemukan di exclusion list setelah penambahan - verifikasi gagal");
                            // If NOT_FOUND, it means exclusion was not added - need admin
                            LogInfo($"Gagal menambahkan exclusion - verifikasi NOT_FOUND (isAdmin={isAdmin})");
                            return new
                            {
                                type = "FixGamesAutoExclude",
                                success = false,
                                error = "Gagal menambahkan exclusion. Pastikan aplikasi dijalankan sebagai Administrator.",
                                needsAdmin = true,
                                isAdmin = isAdmin
                            };
                        }
                    }
                    
                    // If verification process failed or returned unexpected result, check for errors
                    // PERBAIKAN: Enhanced error detection untuk permission/access issues
                    bool hasAdminError = (!string.IsNullOrWhiteSpace(addOutput) && 
                        (addOutput.Contains("permission", StringComparison.OrdinalIgnoreCase) ||
                         addOutput.Contains("enough permissions", StringComparison.OrdinalIgnoreCase) ||
                         addOutput.Contains("access", StringComparison.OrdinalIgnoreCase) ||
                         addOutput.Contains("denied", StringComparison.OrdinalIgnoreCase) ||
                         addOutput.Contains("unauthorized", StringComparison.OrdinalIgnoreCase) ||
                         addOutput.Contains("requires elevation", StringComparison.OrdinalIgnoreCase) ||
                         addOutput.Contains("run as administrator", StringComparison.OrdinalIgnoreCase) ||
                         addOutput.Contains("administrator", StringComparison.OrdinalIgnoreCase))) ||
                        (!string.IsNullOrWhiteSpace(addError) && 
                        (addError.Contains("access", StringComparison.OrdinalIgnoreCase) || 
                         addError.Contains("denied", StringComparison.OrdinalIgnoreCase) ||
                         addError.Contains("permission", StringComparison.OrdinalIgnoreCase) ||
                         addError.Contains("unauthorized", StringComparison.OrdinalIgnoreCase) ||
                         addError.Contains("requires elevation", StringComparison.OrdinalIgnoreCase) ||
                         addError.Contains("run as administrator", StringComparison.OrdinalIgnoreCase) ||
                         addError.Contains("administrator", StringComparison.OrdinalIgnoreCase)));
                    
                    // Also check if addOutput contains "ERROR:" which indicates failure
                    bool hasError = !string.IsNullOrWhiteSpace(addOutput) && 
                        addOutput.Contains("ERROR:", StringComparison.OrdinalIgnoreCase);
                    
                    // Check verify output for errors too
                    bool verifyHasError = !string.IsNullOrWhiteSpace(verifyOutput) && 
                        verifyOutput.Contains("ERROR:", StringComparison.OrdinalIgnoreCase);
                    
                    // PERBAIKAN: Enhanced error handling dengan verifikasi yang lebih baik
                    if (hasError || hasAdminError || verifyHasError)
                    {
                        LogInfo($"Gagal menambahkan exclusion - ada error (hasError={hasError}, hasAdminError={hasAdminError}, verifyHasError={verifyHasError}, isAdmin={isAdmin})");
                        LogInfo($"Add output: {addOutput?.Trim()}");
                        LogInfo($"Add error: {addError?.Trim()}");
                        LogInfo($"Verify output: {verifyOutput?.Trim()}");
                        LogInfo($"Verify error: {verifyError?.Trim()}");
                        return new
                        {
                            type = "FixGamesAutoExclude",
                            success = false,
                            error = "Gagal menambahkan exclusion. Pastikan aplikasi dijalankan sebagai Administrator.",
                            needsAdmin = true,
                            isAdmin = isAdmin
                        };
                    }
                    
                    // If no clear error but verification didn't find it, assume need admin
                    // PERBAIKAN: Log lebih detail untuk troubleshooting
                    LogInfo($"Gagal menambahkan exclusion - verifikasi tidak berhasil (isAdmin={isAdmin})");
                    LogInfo($"Add output: {addOutput?.Trim()}");
                    LogInfo($"Add error: {addError?.Trim()}");
                    LogInfo($"Verify output: {verifyOutput?.Trim()}");
                    LogInfo($"Verify error: {verifyError?.Trim()}");
                    LogInfo($"Path yang dicoba: {gamePath}");
                    return new
                    {
                        type = "FixGamesAutoExclude",
                        success = false,
                        error = "Gagal menambahkan exclusion. Pastikan aplikasi dijalankan sebagai Administrator.",
                        needsAdmin = true,
                        isAdmin = isAdmin
                    };
                }

                LogInfo($"Gagal menambahkan exclusion (mungkin perlu admin)");
                return new
                {
                    type = "FixGamesAutoExclude",
                    success = false,
                    error = "Gagal menambahkan exclusion. Pastikan aplikasi dijalankan sebagai Administrator.",
                    needsAdmin = !isAdmin,
                    isAdmin = isAdmin
                };
            }
            catch (Exception ex)
            {
                LogInfo($"Error auto-exclude: {ex.Message}");
                return new
                {
                    type = "FixGamesAutoExclude",
                    success = false,
                    error = ex.Message,
                    needsAdmin = !isAdmin,
                    isAdmin = isAdmin
                };
            }
        }

        // Step 3: Detect Game Path (menggunakan pendekatan yang sama seperti OnlineFixService)
        public Task<object> DetectGamePathAsync(int appid, string gameTitle)
        {
            return Task.Run(() =>
            {
                LogInfo($"Mencari path instalasi game: {gameTitle} (AppID: {appid})");
                
                try
                {
                    // Gunakan pendekatan yang sama seperti OnlineFixService.ResolveInstallFromSteam
                    var baseSteam = GetSteamBasePath();
                    if (string.IsNullOrWhiteSpace(baseSteam))
                    {
                        LogInfo($"Steam base path tidak ditemukan untuk AppID {appid}");
                        return (object)new
                        {
                            type = "FixGamesDetectPath",
                            success = false,
                            needsManualSelection = true,
                            gameNotInstalled = true,
                            message = "Game mungkin belum Anda install atau tidak ditemukan di Steam library. Silakan cari folder game secara manual atau pastikan game sudah terinstall di Steam."
                        };
                    }

                    LogInfo($"Steam base path ditemukan: {baseSteam}");
                    
                    // First, try find the exact library via 'apps' mapping in libraryfolders.vdf
                    var libraryWithApp = SteamVdfUtils.FindLibraryPathForApp(baseSteam, appid);
                    LogInfo($"Library dengan AppID {appid}: {libraryWithApp ?? "tidak ditemukan"}");
                    
                    if (!string.IsNullOrWhiteSpace(libraryWithApp))
                    {
                        var sa = Path.Combine(libraryWithApp, "steamapps");
                        var manifest = Path.Combine(sa, $"appmanifest_{appid}.acf");
                        if (File.Exists(manifest))
                        {
                            var (installdir, name) = ParseManifestInstalldirAndName(manifest);
                            LogInfo($"Manifest ditemukan: installdir='{installdir}' name='{name}'");
                            if (!string.IsNullOrWhiteSpace(installdir))
                            {
                                var path = Path.Combine(sa, "common", installdir);
                                if (Directory.Exists(path))
                                {
                                    LogInfo($"Path instalasi ditemukan: {path}");
                                    return (object)new
                                    {
                                        type = "FixGamesDetectPath",
                                        success = true,
                                        path = path,
                                        method = "manifest"
                                    };
                                }
                            }
                        }
                    }

                    // Fallback: scan all libraries for the manifest
                    var libraries = GetSteamLibraries(baseSteam);
                    LogInfo($"Memindai {libraries.Count} library folders");
                    
                    foreach (var lib in libraries)
                    {
                        var steamapps = Path.Combine(lib, "steamapps");
                        var manifest = Path.Combine(steamapps, $"appmanifest_{appid}.acf");
                        if (!File.Exists(manifest)) continue;
                        
                        var (installdir, name) = ParseManifestInstalldirAndName(manifest);
                        LogInfo($"Manifest ditemukan di library: installdir='{installdir}' name='{name}'");
                        if (string.IsNullOrWhiteSpace(installdir)) continue;
                        
                        var path = Path.Combine(steamapps, "common", installdir);
                        if (Directory.Exists(path))
                        {
                            LogInfo($"Path instalasi ditemukan: {path}");
                            return (object)new
                            {
                                type = "FixGamesDetectPath",
                                success = true,
                                path = path,
                                method = "manifest"
                            };
                        }
                    }

                    // Game tidak ditemukan
                    LogInfo($"Path tidak ditemukan untuk AppID {appid} - Game mungkin belum terinstall");
                    return (object)new
                    {
                        type = "FixGamesDetectPath",
                        success = false,
                        needsManualSelection = true,
                        gameNotInstalled = true,
                        message = "Game mungkin belum Anda install atau tidak ditemukan di Steam library. Silakan cari folder game secara manual atau pastikan game sudah terinstall di Steam."
                    };
                }
                catch (Exception ex)
                {
                    LogInfo($"Error detect path: {ex.Message}");
                    return (object)new
                    {
                        type = "FixGamesDetectPath",
                        success = false,
                        gameNotInstalled = true,
                        error = ex.Message,
                        message = "Game mungkin belum Anda install atau tidak ditemukan di Steam library. Silakan cari folder game secara manual atau pastikan game sudah terinstall di Steam."
                    };
                }
            });
        }

        // Helper methods (sama seperti OnlineFixService)
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

        private static List<string> GetSteamLibraries(string baseSteamPath)
        {
            var libs = new List<string>();
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
                string? installdir = null;
                string? name = null;
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

        // Step 4: Download Files
        public async Task<object> DownloadFilesAsync(int appid, JsonElement filesArray, Func<object, Task> sendProgress)
        {
            LogInfo($"Memulai download untuk AppID: {appid}");
            
            try
            {
                if (filesArray.ValueKind != JsonValueKind.Array)
                {
                    return new { type = "FixGamesDownloadError", error = "Invalid files array" };
                }

                var files = new List<(int part, string filename, string url)>();
                foreach (var file in filesArray.EnumerateArray())
                {
                    var part = file.TryGetProperty("part", out var p) ? p.GetInt32() : 1;
                    
                    // Get filename from "filename" property first, fallback to part number
                    var filename = file.TryGetProperty("filename", out var f) ? f.GetString() : "";
                    if (string.IsNullOrWhiteSpace(filename))
                    {
                        filename = $"part{part}.rar";
                    }
                    
                    // Get URL from "gdrive_url" property
                    var url = file.TryGetProperty("gdrive_url", out var urlProp) ? urlProp.GetString() : "";
                    
                    // Validate: filename should not be a URL, and URL should be valid
                    if (!string.IsNullOrWhiteSpace(url) && !string.IsNullOrWhiteSpace(filename))
                    {
                        // Sanitize filename: remove any URL-like patterns
                        if (filename.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || 
                            filename.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                        {
                            // If filename is actually a URL, extract just the filename from URL or use part number
                            // Filename is URL, using part number instead
                            filename = $"part{part}.rar";
                        }
                        
                        files.Add((part, filename!, url));
                    }
                }

                if (files.Count == 0)
                {
                    return new { type = "FixGamesDownloadError", error = "Tidak ada file untuk di-download" };
                }

                var downloadPath = Path.Combine(_tempDownloadPath!, $"appid_{appid}");
                if (!Directory.Exists(downloadPath))
                {
                    Directory.CreateDirectory(downloadPath);
                }

                var downloadedFiles = new List<string>();
                int totalFiles = files.Count;
                int currentFile = 0;

                foreach (var (part, filename, url) in files.OrderBy(f => f.part))
                {
                    currentFile++;
                    var filePath = Path.Combine(downloadPath, filename);
                    
                    // Skip if already downloaded
                    if (File.Exists(filePath))
                    {
                        var fileInfo = new FileInfo(filePath);
                        if (fileInfo.Length > 0)
                        {
                            // File already exists, skip download
                            downloadedFiles.Add(filePath);
                            await sendProgress(new
                            {
                                type = "FixGamesDownloadProgress",
                                currentFile,
                                totalFiles,
                                filename,
                                percent = (int)((currentFile * 100.0) / totalFiles)
                            });
                            continue;
                        }
                    }

                    LogInfo($"Downloading file {currentFile}/{totalFiles}");
                    
                    // Download with retry
                    bool success = false;
                    int maxRetries = 3;
                    for (int retry = 0; retry < maxRetries; retry++)
                    {
                        try
                        {
                            // Extract file ID from URL
                            var idMatch = Regex.Match(url, @"[?&]id=([^&]+)");
                            if (!idMatch.Success)
                            {
                                LogInfo($"Could not extract file ID from URL");
                                throw new Exception("URL Google Drive tidak valid");
                            }
                            
                            string fileId = idMatch.Groups[1].Value;
                            LogInfo($"Downloading Google Drive file");
                            
                            // Try multiple download methods
                            HttpResponseMessage? response = null;
                            string? lastError = null;
                            
                            // Method 1: Direct download with confirm parameter
                            string downloadUrl1 = $"https://drive.usercontent.google.com/download?id={fileId}&export=download&confirm=t";
                            try
                            {
                                // Trying method 1: direct download
                                response = await _http.GetAsync(downloadUrl1, HttpCompletionOption.ResponseHeadersRead);
                                
                                if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
                                {
                                    await sendProgress(new
                                    {
                                        type = "FixGamesDownloadError",
                                        error = "Rate limit tercapai. Silakan coba lagi nanti atau hubungi admin."
                                    });
                                    return new { type = "FixGamesDownloadError", error = "Rate limit" };
                                }

                                var contentType = response.Content.Headers.ContentType?.MediaType ?? "";
                                LogInfo($"Method 1 response: Status={response.StatusCode}, ContentType={contentType}");
                                
                                if (!contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase))
                                {
                                    // Success! It's the actual file
                                    LogInfo($"Method 1 successful - got file content");
                                }
                                else
                                {
                                    // HTML response, try to extract link
                                    // Method 1 returned HTML, extracting download link
                                    var html = await response.Content.ReadAsStringAsync();
                                    var extractedUrl = ExtractGoogleDriveDownloadLink(html, url);
                                    
                                    if (!string.IsNullOrWhiteSpace(extractedUrl) && extractedUrl != downloadUrl1)
                                    {
                                        // Extracted URL, trying method 2
                                        response.Dispose();
                                        response = await _http.GetAsync(extractedUrl, HttpCompletionOption.ResponseHeadersRead);
                                        
                                        var newContentType = response.Content.Headers.ContentType?.MediaType ?? "";
                                        if (newContentType.Contains("text/html", StringComparison.OrdinalIgnoreCase))
                                        {
                                            LogInfo($"Method 2 still HTML, trying method 3...");
                                            // Method 3: Alternative URL format
                                            string downloadUrl3 = $"https://drive.google.com/uc?export=download&id={fileId}&confirm=t";
                                            response.Dispose();
                                            response = await _http.GetAsync(downloadUrl3, HttpCompletionOption.ResponseHeadersRead);
                                            
                                            var finalContentType = response.Content.Headers.ContentType?.MediaType ?? "";
                                            if (finalContentType.Contains("text/html", StringComparison.OrdinalIgnoreCase))
                                            {
                                                lastError = "Google Drive memerlukan konfirmasi manual. File mungkin terlalu besar atau memerlukan akses khusus.";
                                                throw new Exception(lastError);
                                            }
                                        }
                                    }
                                    else
                                    {
                                        lastError = "Tidak dapat mengekstrak link download dari Google Drive.";
                                        throw new Exception(lastError);
                                    }
                                }
                                
                                response.EnsureSuccessStatusCode();
                                // Download URL validated

                                // Now download the file
                                using var fileStream = new FileStream(filePath, FileMode.Create, FileAccess.Write, FileShare.None);
                                using var httpStream = await response.Content.ReadAsStreamAsync();
                            
                                var totalBytes = response.Content.Headers.ContentLength ?? 0;
                                var buffer = new byte[8192];
                                long bytesRead = 0;
                                int bytesReadThisChunk;
                                DateTime lastProgressUpdate = DateTime.Now;
                                const int progressUpdateIntervalMs = 500; // Update setiap 500ms

                                while ((bytesReadThisChunk = await httpStream.ReadAsync(buffer, 0, buffer.Length)) > 0)
                                {
                                    await fileStream.WriteAsync(buffer, 0, bytesReadThisChunk);
                                    bytesRead += bytesReadThisChunk;

                                    // Update progress setiap interval atau jika totalBytes tidak diketahui
                                    var timeSinceLastUpdate = (DateTime.Now - lastProgressUpdate).TotalMilliseconds;
                                    if (timeSinceLastUpdate >= progressUpdateIntervalMs || totalBytes == 0)
                                    {
                                        int filePercent = 0;
                                        int overallPercent = 0;

                                        if (totalBytes > 0)
                                        {
                                            filePercent = (int)((bytesRead * 100.0) / totalBytes);
                                            overallPercent = (int)(((currentFile - 1) * 100.0 + filePercent) / totalFiles);
                                        }
                                        else
                                        {
                                            // Jika totalBytes tidak diketahui, gunakan perkiraan berdasarkan file yang sudah di-download
                                            // Asumsikan progress file saat ini sekitar 50% (karena kita tidak tahu totalnya)
                                            filePercent = 50; // Placeholder
                                            overallPercent = (int)(((currentFile - 1) * 100.0 + 50) / totalFiles);
                                        }

                                        await sendProgress(new
                                        {
                                            type = "FixGamesDownloadProgress",
                                            currentFile,
                                            totalFiles,
                                            filename,
                                            percent = overallPercent,
                                            filePercent = filePercent,
                                            bytesRead,
                                            totalBytes
                                        });

                                        lastProgressUpdate = DateTime.Now;
                                    }
                                }

                                // Final progress update untuk file ini
                                await sendProgress(new
                                {
                                    type = "FixGamesDownloadProgress",
                                    currentFile,
                                    totalFiles,
                                    filename,
                                    percent = (int)((currentFile * 100.0) / totalFiles),
                                    filePercent = 100,
                                    bytesRead,
                                    totalBytes
                                });

                                success = true;
                                downloadedFiles.Add(filePath);
                                // Download completed
                                break;
                            }
                            catch (Exception ex)
                            {
                                if (response != null)
                                {
                                    response.Dispose();
                                    response = null;
                                }
                                
                                if (lastError != null)
                                {
                                    throw new Exception(lastError);
                                }
                                
                                LogInfo($"Download attempt failed: {ex.Message}");
                                throw;
                            }
                            finally
                            {
                                response?.Dispose();
                            }
                        }
                        catch (Exception ex)
                        {
                            LogInfo($"Download retry {retry + 1}/{maxRetries} failed");
                            if (retry < maxRetries - 1)
                            {
                                await Task.Delay(2000 * (retry + 1)); // Exponential backoff
                            }
                        }
                    }

                    if (!success)
                    {
                        return new { type = "FixGamesDownloadError", error = $"Gagal download: {filename}" };
                    }
                }

                LogInfo($"Semua file berhasil di-download: {downloadedFiles.Count} files");
                return new
                {
                    type = "FixGamesDownloadComplete",
                    success = true,
                    files = downloadedFiles,
                    downloadPath
                };
            }
            catch (Exception ex)
            {
                LogInfo($"Error download files: {ex.Message}");
                return new { type = "FixGamesDownloadError", error = ex.Message };
            }
        }

        // Helper: Extract download link from Google Drive virus warning HTML
        private string ExtractGoogleDriveDownloadLink(string html, string originalUrl)
        {
            try
            {
                // Method 1: Look for direct download link in HTML
                // Pattern: href="/uc?export=download&id=..."
                var hrefMatch = Regex.Match(html, @"href=[""']([^""']*uc\?export=download[^""']*)[""']", RegexOptions.IgnoreCase);
                if (hrefMatch.Success)
                {
                    string href = hrefMatch.Groups[1].Value;
                    if (href.StartsWith("/"))
                    {
                        return "https://drive.google.com" + href;
                    }
                    else if (href.StartsWith("http"))
                    {
                        return href;
                    }
                }

                // Method 2: Look for form action with download link
                var formMatch = Regex.Match(html, @"<form[^>]*action=[""']([^""']*)[""']", RegexOptions.IgnoreCase);
                if (formMatch.Success)
                {
                    string action = formMatch.Groups[1].Value;
                    if (action.Contains("export=download", StringComparison.OrdinalIgnoreCase))
                    {
                        if (action.StartsWith("/"))
                        {
                            return "https://drive.google.com" + action;
                        }
                        else if (action.StartsWith("http"))
                        {
                            return action;
                        }
                    }
                }

                // Method 3: Extract file ID and construct direct download URL
                var idMatch = Regex.Match(originalUrl, @"[?&]id=([^&]+)");
                if (idMatch.Success)
                {
                    string fileId = idMatch.Groups[1].Value;
                    // Try with confirm parameter
                    return $"https://drive.usercontent.google.com/download?id={fileId}&export=download&confirm=t&uuid=";
                }

                return string.Empty;
            }
            catch (Exception ex)
            {
                LogInfo($"Error extracting download link: {ex.Message}");
                return string.Empty;
            }
        }

        // Step 5: Extract Files
        public async Task<object> ExtractFilesAsync(string downloadPath, List<string> files, string password, Func<object, Task> sendProgress, string? gamePath = null)
        {
            LogInfo($"Mengekstrak {files.Count} files");

            // Pastikan setiap file hasil unduhan valid sebelum lanjut
            foreach (var file in files)
            {
                var filePath = Path.Combine(downloadPath, file);
                if (!File.Exists(filePath))
                {
                    throw new Exception($"File tidak ditemukan sebelum ekstraksi: {file}");
                }
                var info = new FileInfo(filePath);
                if (info.Length == 0)
                {
                    throw new Exception($"File kosong sebelum ekstraksi: {file}");
                }
                LogInfo($"File validated sebelum ekstraksi: {file} ({info.Length} bytes)");
            }

            try
            {
                string extractedFolder = string.Empty;

                // Coba pakai temp folder default terlebih dahulu
                try
                {
                    if (string.IsNullOrWhiteSpace(_tempDownloadPath))
                    {
                        throw new Exception("Temporary download path tidak tersedia");
                    }

                    extractedFolder = Path.Combine(_tempDownloadPath, "extracted");
                    if (Directory.Exists(extractedFolder))
                    {
                        try { Directory.Delete(extractedFolder, true); } catch { }
                    }

                    Directory.CreateDirectory(extractedFolder);
                }
                catch (Exception ex)
                {
                    LogInfo($"Gagal menggunakan temp folder default: {ex.Message}");

                    extractedFolder = Path.Combine(downloadPath, "extracted");
                    if (Directory.Exists(extractedFolder))
                    {
                        try { Directory.Delete(extractedFolder, true); } catch { }
                    }
                    Directory.CreateDirectory(extractedFolder);
                    LogInfo("Fallback extracted folder ke downloadPath");
                }

                string GetArchiveKey(string fileName)
                {
                    if (fileName.EndsWith(".rar", StringComparison.OrdinalIgnoreCase))
                    {
                        var match = Regex.Match(fileName, @"^(.*?)(?:\.part\d+)?\.rar$", RegexOptions.IgnoreCase);
                        if (match.Success)
                        {
                            return match.Groups[1].Value;
                        }
                    }
                    return fileName;
                }

                var archiveKeySet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var file in files)
                {
                    var key = GetArchiveKey(file);
                    archiveKeySet.Add(key);
                }
                var totalArchives = archiveKeySet.Count;
                var processedArchives = 0;
                var processedKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                foreach (var file in files)
                {
                    var archiveKey = GetArchiveKey(file);
                    if (!processedKeys.Add(archiveKey))
                    {
                        LogInfo($"Skip {file} karena sudah diekstrak sebagai bagian dari {archiveKey}");
                        continue;
                    }

                    var archivePath = Path.Combine(downloadPath, file);
                    var extension = Path.GetExtension(file)?.ToLowerInvariant();
                    var isRar = string.Equals(extension, ".rar", StringComparison.OrdinalIgnoreCase);
                    var isZip = string.Equals(extension, ".zip", StringComparison.OrdinalIgnoreCase);

                    if (!isRar && !isZip)
                    {
                        LogInfo($"Lewati {file} - bukan archive RAR/ZIP");
                        continue;
                    }

                    try
                    {
                        if (isRar)
                        {
                            var partFiles = files
                                .Where(f => f.EndsWith(".rar", StringComparison.OrdinalIgnoreCase))
                                .Where(f => Regex.IsMatch(f, $"^{Regex.Escape(archiveKey)}(?:\\.part\\d+)?\\.rar$", RegexOptions.IgnoreCase))
                                .Distinct(StringComparer.OrdinalIgnoreCase)
                                .ToList();

                            if (partFiles.Count == 0)
                            {
                                partFiles.Add(file);
                            }

                            ValidatePartFiles(partFiles, downloadPath);
                            var orderedParts = partFiles.OrderBy(f => f, StringComparer.OrdinalIgnoreCase).ToList();
                            var firstPart = DetermineFirstPartFile(orderedParts);
                            var firstPartPath = Path.Combine(downloadPath, firstPart);
                            var absolutePartPaths = orderedParts
                                .Select(part => Path.Combine(downloadPath, part))
                                .ToList();

                            var extractResult = await ExtractWithExternalToolAsync(firstPartPath, extractedFolder, password, absolutePartPaths);
                            if (!extractResult.success)
                            {
                                var errorMessage = extractResult.error ?? "Tidak ada pesan error";
                                throw new Exception($"WinRAR/7-Zip gagal mengekstrak {file}: {errorMessage}");
                            }

                            LogInfo($"RAR diekstrak dengan WinRAR/7-Zip: {file}");
                        }
                        else if (isZip)
                        {
                            try
                            {
                                using var stream = File.OpenRead(archivePath);
                                var options = new ReaderOptions();
                                if (!string.IsNullOrWhiteSpace(password))
                                {
                                    options.Password = password;
                                }

                                using var archive = ZipArchive.Open(stream, options);
                                foreach (var entry in archive.Entries)
                                {
                                    if (entry.IsDirectory) continue;

                                    var entryPath = Path.Combine(extractedFolder, entry.Key.Replace('/', Path.DirectorySeparatorChar));
                                    var entryDir = Path.GetDirectoryName(entryPath);
                                    if (!string.IsNullOrWhiteSpace(entryDir) && !Directory.Exists(entryDir))
                                    {
                                        Directory.CreateDirectory(entryDir);
                                    }

                                    using var entryStream = entry.OpenEntryStream();
                                    using var fileStream = File.Create(entryPath);
                                    await entryStream.CopyToAsync(fileStream);
                                }
                            }
                            catch (Exception zipEx)
                            {
                                throw new Exception($"Gagal membuka file ZIP {file}: {zipEx.Message}");
                            }
                        }

                        processedArchives++;
                        var progressPercent = totalArchives > 0 ? (int)((processedArchives * 100.0) / totalArchives) : 0;
                        if (sendProgress != null)
                        {
                            await sendProgress(new
                            {
                                type = "FixGamesExtractProgress",
                                percent = progressPercent,
                                currentFile = processedArchives,
                                totalFiles = totalArchives,
                                currentArchive = file
                            });
                        }
                    }
                    catch (Exception ex)
                    {
                        throw new Exception($"Gagal mengekstrak {file}: {ex.Message}");
                    }
                }

                LogInfo($"Ekstraksi selesai. Total {processedArchives}/{totalArchives} archive diekstrak ke: {extractedFolder}");

                return new
                {
                    type = "FixGamesExtractComplete",
                    success = true,
                    extractedPath = extractedFolder,
                    filesExtracted = processedArchives,
                    totalFiles = totalArchives
                };
            }
            catch (Exception ex)
            {
                LogInfo($"Error dalam ExtractFilesAsync: {ex.Message}");
                return new
                {
                    type = "FixGamesExtractError",
                    success = false,
                    error = ex.Message
                };
            }
        }

        private static string DetermineFirstPartFile(List<string> fileNames)
        {
            if (fileNames == null || fileNames.Count == 0)
            {
                throw new Exception("Daftar file untuk ekstraksi kosong");
            }

            // Prioritas: file dengan nama .part1.rar
            var candidate = fileNames.FirstOrDefault(f => f.EndsWith(".part1.rar", StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrEmpty(candidate)) return candidate;

            // Fallback: file .rar tanpa embel-embel .part
            candidate = fileNames.FirstOrDefault(f =>
                Path.GetExtension(f).Equals(".rar", StringComparison.OrdinalIgnoreCase) &&
                !f.Contains(".part", StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrEmpty(candidate)) return candidate;

            if (fileNames.Count > 1)
            {
                int PartNumber(string name)
                {
                    var match = Regex.Match(name, @"\.part(\d+)\.rar", RegexOptions.IgnoreCase);
                    if (match.Success && int.TryParse(match.Groups[1].Value, out var value)) return value;
                    return int.MaxValue;
                }

                var ordered = fileNames
                    .OrderBy(n => PartNumber(n))
                    .ToList();
                if (ordered.Count > 0)
                {
                    return ordered[0];
                }
            }

            return fileNames[0];
        }

        private static void ValidatePartFiles(List<string> fileNames, string rootPath)
        {
            foreach (var partFile in fileNames)
            {
                var partPath = Path.Combine(rootPath, partFile);
                if (!File.Exists(partPath))
                {
                    throw new Exception($"Part file tidak ditemukan: {partFile}");
                }
                var info = new FileInfo(partPath);
                if (info.Length < 20)
                {
                    throw new Exception($"Part file terlalu kecil atau corrupt: {partFile} (size: {info.Length} bytes)");
                }
            }
        }

        // Step 6: Replace Files
        public async Task<object> ReplaceFilesAsync(string gamePath, string extractedPath, Func<object, Task> sendProgress)
        {
            LogInfo($"Mengganti files di: {gamePath} dari: {extractedPath}");
            
            try
            {
                // Validate paths
                if (string.IsNullOrWhiteSpace(gamePath) || !Directory.Exists(gamePath))
                {
                    throw new Exception($"Game path tidak valid atau tidak ditemukan: {gamePath}");
                }
                
                if (string.IsNullOrWhiteSpace(extractedPath) || !Directory.Exists(extractedPath))
                {
                    throw new Exception($"Extracted path tidak valid atau tidak ditemukan: {extractedPath}");
                }
                
                // Collect all files from extracted folder (recursive)
                var filesToCopy = new List<(string source, string destination)>();
                var extractedDir = new DirectoryInfo(extractedPath);
                
                foreach (var file in extractedDir.GetFiles("*", SearchOption.AllDirectories))
                {
                    // Calculate relative path from extracted folder
                    var relativePath = Path.GetRelativePath(extractedPath, file.FullName);
                    var destinationPath = Path.Combine(gamePath, relativePath);
                    
                    filesToCopy.Add((file.FullName, destinationPath));
                }
                
                int totalFiles = filesToCopy.Count;
                int copiedFiles = 0;
                int replacedFiles = 0;
                int skippedFiles = 0;
                var errors = new List<string>();
                
                LogInfo($"Menemukan {totalFiles} files untuk di-copy");
                
                // Copy all files
                foreach (var (source, destination) in filesToCopy)
                {
                    try
                    {
                        // Create destination directory if needed
                        var destDir = Path.GetDirectoryName(destination);
                        if (!string.IsNullOrWhiteSpace(destDir))
                        {
                            if (!Directory.Exists(destDir))
                            {
                                Directory.CreateDirectory(destDir);
                            }
                        }
                        
                        // Check if destination file exists (duplicate)
                        bool fileExists = File.Exists(destination);
                        
                        // Copy file (replace if exists)
                        try
                        {
                            File.Copy(source, destination, overwrite: true);
                            
                            if (fileExists)
                            {
                                replacedFiles++;
                                // File replaced
                            }
                            else
                            {
                                copiedFiles++;
                            }
                        }
                        catch (UnauthorizedAccessException ex)
                        {
                            // File mungkin sedang digunakan atau tidak ada permission
                            skippedFiles++;
                            var errorMsg = $"Tidak ada permission untuk menulis file: {Path.GetRelativePath(gamePath, destination)}";
                            errors.Add(errorMsg);
                            LogInfo($"{errorMsg} - {ex.Message}");
                        }
                        catch (IOException ex)
                        {
                            // File mungkin sedang digunakan (locked)
                            skippedFiles++;
                            var errorMsg = $"File sedang digunakan atau locked: {Path.GetRelativePath(gamePath, destination)}";
                            errors.Add(errorMsg);
                            LogInfo($"{errorMsg} - {ex.Message}");
                        }
                        catch (Exception ex)
                        {
                            skippedFiles++;
                            var errorMsg = $"Error copying file: {Path.GetRelativePath(gamePath, destination)}";
                            errors.Add(errorMsg);
                            LogInfo($"{errorMsg} - {ex.Message}");
                        }
                        
                        // Update progress
                        var processed = copiedFiles + replacedFiles + skippedFiles;
                        var progressPercent = totalFiles > 0 ? (int)((processed * 100.0) / totalFiles) : 0;
                        
                        if (sendProgress != null)
                        {
                            await sendProgress(new
                            {
                                type = "FixGamesReplaceProgress",
                                percent = progressPercent,
                                currentFile = processed,
                                totalFiles = totalFiles,
                                copied = copiedFiles,
                                replaced = replacedFiles,
                                skipped = skippedFiles
                            });
                        }
                    }
                    catch (Exception ex)
                    {
                        skippedFiles++;
                        var errorMsg = $"Unexpected error processing file: {Path.GetRelativePath(gamePath, destination)}";
                        errors.Add($"{errorMsg} - {ex.Message}");
                        LogInfo($"{errorMsg}: {ex.Message}");
                    }
                }
                
                LogInfo($"Copy selesai: {copiedFiles} copied, {replacedFiles} replaced, {skippedFiles} skipped");
                
                // Return result
                var result = new
                {
                    type = "FixGamesReplaceComplete",
                    success = true,
                    gamePath = gamePath,
                    totalFiles = totalFiles,
                    copiedFiles = copiedFiles,
                    replacedFiles = replacedFiles,
                    skippedFiles = skippedFiles,
                    errors = errors.Count > 0 ? errors : null
                };
                
                // If there are errors but some files were copied, still return success but with warnings
                if (errors.Count > 0 && (copiedFiles + replacedFiles) == 0)
                {
                    // All files failed - return error
                    return new
                    {
                        type = "FixGamesReplaceError",
                        success = false,
                        error = $"Gagal menyalin semua file. {errors.Count} file error. Detail: {string.Join("; ", errors.Take(3))}",
                        errors = errors
                    };
                }
                
                return result;
            }
            catch (Exception ex)
            {
                LogInfo($"Error dalam ReplaceFilesAsync: {ex.Message}");
                return new
                {
                    type = "FixGamesReplaceError",
                    success = false,
                    error = ex.Message
                };
            }
        }

        // Helper: Extract RAR using WinRAR/7-Zip command line (fallback)
        private async Task<(bool success, string? error)> ExtractWithExternalToolAsync(string archivePath, string extractTo, string? password, List<string> allPartFiles)
        {
            try
            {
                // Try WinRAR first
                string? winrarPath = DetectWinRARPath();
                
                if (!string.IsNullOrWhiteSpace(winrarPath) && File.Exists(winrarPath))
                {
                    return await ExtractWithWinRARAsync(winrarPath, archivePath, extractTo, password, allPartFiles);
                }
                
                // Try 7-Zip as fallback
                string? sevenZipPath = Detect7ZipPath();
                
                if (!string.IsNullOrWhiteSpace(sevenZipPath) && File.Exists(sevenZipPath))
                {
                    return await ExtractWith7ZipAsync(sevenZipPath, archivePath, extractTo, password, allPartFiles);
                }
                
                return (false, "WinRAR atau 7-Zip tidak ditemukan. Silakan install WinRAR atau 7-Zip.");
            }
            catch (Exception ex)
            {
                return (false, ex.Message);
            }
        }
        
        // Detect WinRAR installation path
        private string? DetectWinRARPath()
        {
            var possiblePaths = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WinRAR", "WinRAR.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "WinRAR", "WinRAR.exe"),
                @"C:\Program Files\WinRAR\WinRAR.exe",
                @"C:\Program Files (x86)\WinRAR\WinRAR.exe"
            };
            
            foreach (var path in possiblePaths)
            {
                if (File.Exists(path))
                {
                    return path;
                }
            }
            
            // Try registry
            try
            {
                using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\WinRAR");
                var path = key?.GetValue("exe64") as string ?? key?.GetValue("exe32") as string;
                if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
                {
                    return path;
                }
            }
            catch { }
            
            return null;
        }
        
        // Detect 7-Zip installation path
        private string? Detect7ZipPath()
        {
            var possiblePaths = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "7-Zip", "7z.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "7-Zip", "7z.exe"),
                @"C:\Program Files\7-Zip\7z.exe",
                @"C:\Program Files (x86)\7-Zip\7z.exe"
            };
            
            foreach (var path in possiblePaths)
            {
                if (File.Exists(path))
                {
                    return path;
                }
            }
            
            return null;
        }
        
        // Extract using WinRAR command line
        private async Task<(bool success, string? error)> ExtractWithWinRARAsync(string winrarPath, string archivePath, string extractTo, string? password, List<string> allPartFiles)
        {
            try
            {
                // WinRAR command: WinRAR.exe x -o+ -p<password> <archive> <extract_to>
                // x = extract with full paths
                // -o+ = overwrite without prompt
                // -p<password> = password (if provided)
                
                var args = new System.Text.StringBuilder();
                args.Append("x "); // Extract with full paths
                args.Append("-ibck "); // Run in background (hide GUI)
                args.Append("-inul "); // Suppress message boxes
                args.Append("-o+ "); // Overwrite without prompt
                
                if (!string.IsNullOrWhiteSpace(password))
                {
                    args.Append($"-p{password} "); // Password
                }
                else
                {
                    args.Append("-p "); // No password
                }
                
                args.Append($"\"{archivePath}\" "); // Archive path
                args.Append($"\"{extractTo}\""); // Extract to
                
                var processInfo = new ProcessStartInfo
                {
                    FileName = winrarPath,
                    Arguments = args.ToString(),
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    WorkingDirectory = Path.GetDirectoryName(archivePath) ?? ""
                };
                
                using var process = Process.Start(processInfo);
                if (process == null)
                {
                    return (false, "Gagal memulai proses WinRAR");
                }
                
                await process.WaitForExitAsync();
                
                var output = await process.StandardOutput.ReadToEndAsync();
                var error = await process.StandardError.ReadToEndAsync();
                
                // WinRAR process completed
                
                // WinRAR exit codes: 0 = success, 1 = warning, 2 = fatal error
                if (process.ExitCode == 0 || process.ExitCode == 1)
                {
                    return (true, null);
                }
                else
                {
                    return (false, $"WinRAR exit code: {process.ExitCode}. Output: {output}. Error: {error}");
                }
            }
            catch (Exception ex)
            {
                return (false, $"Error menjalankan WinRAR: {ex.Message}");
            }
        }
        
        // Extract using 7-Zip command line
        private async Task<(bool success, string? error)> ExtractWith7ZipAsync(string sevenZipPath, string archivePath, string extractTo, string? password, List<string> allPartFiles)
        {
            try
            {
                // 7-Zip command: 7z.exe x -o<extract_to> -p<password> <archive>
                // x = extract with full paths
                // -o<path> = output directory (no space after -o)
                // -p<password> = password (if provided)
                // -y = assume yes on all queries
                
                var args = new System.Text.StringBuilder();
                args.Append("x "); // Extract with full paths
                args.Append($"-o\"{extractTo}\" "); // Output directory (no space after -o)
                args.Append("-y "); // Assume yes on all queries
                
                if (!string.IsNullOrWhiteSpace(password))
                {
                    args.Append($"-p{password} "); // Password
                }
                
                args.Append($"\"{archivePath}\""); // Archive path
                
                var processInfo = new ProcessStartInfo
                {
                    FileName = sevenZipPath,
                    Arguments = args.ToString(),
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    WorkingDirectory = Path.GetDirectoryName(archivePath) ?? ""
                };
                
                using var process = Process.Start(processInfo);
                if (process == null)
                {
                    return (false, "Gagal memulai proses 7-Zip");
                }
                
                await process.WaitForExitAsync();
                
                var output = await process.StandardOutput.ReadToEndAsync();
                var error = await process.StandardError.ReadToEndAsync();
                
                // 7-Zip process completed
                
                // 7-Zip exit codes: 0 = success, 1 = warning, 2 = fatal error
                if (process.ExitCode == 0 || process.ExitCode == 1)
                {
                    return (true, null);
                }
                else
                {
                    return (false, $"7-Zip exit code: {process.ExitCode}");
                }
            }
            catch (Exception ex)
            {
                return (false, $"Error menjalankan 7-Zip: {ex.Message}");
            }
        }

        // Cleanup temporary files (download and extracted)
        public async Task<object> CleanupTempFilesAsync(string downloadPath, string extractedPath)
        {
            // Wait a bit to ensure all file handles are released (SharpCompress, WinRAR, etc.)
            await Task.Delay(2000);
            
            int deletedFiles = 0;
            int deletedDirs = 0;
            var errors = new List<string>();
            
            try
            {
                // Cleanup extracted folder
                if (!string.IsNullOrWhiteSpace(extractedPath) && Directory.Exists(extractedPath))
                {
                    try
                    {
                        Directory.Delete(extractedPath, true);
                        deletedDirs++;
                    }
                    catch (Exception ex)
                    {
                        var errorMsg = $"Gagal menghapus extracted folder: {ex.Message}";
                        errors.Add(errorMsg);
                        LogInfo(errorMsg);
                    }
                }
                
                // Cleanup download folder (folder yang berisi file RAR/ZIP)
                if (!string.IsNullOrWhiteSpace(downloadPath) && Directory.Exists(downloadPath))
                {
                    try
                    {
                        // Delete all files recursively (including in subdirectories)
                        var allFiles = Directory.GetFiles(downloadPath, "*", SearchOption.AllDirectories);
                        
                        foreach (var file in allFiles)
                        {
                            bool deleted = false;
                            int maxRetries = 3;
                            int retryDelay = 1000; // 1 second
                            
                            for (int retry = 0; retry < maxRetries && !deleted; retry++)
                            {
                                try
                                {
                                    if (retry > 0)
                                    {
                                        await Task.Delay(retryDelay * retry); // Exponential backoff
                                    }
                                    
                                    // Set file attributes to normal before deleting (in case it's read-only)
                                    var fileInfo = new FileInfo(file);
                                    if (fileInfo.Exists)
                                    {
                                        // Try to remove read-only attribute
                                        fileInfo.Attributes = FileAttributes.Normal;
                                        
                                        // Force garbage collection to release any managed handles
                                        if (retry > 0)
                                        {
                                            GC.Collect();
                                            GC.WaitForPendingFinalizers();
                                            GC.Collect();
                                        }
                                        
                                        File.Delete(file);
                                        deletedFiles++;
                                        deleted = true;
                                        // File deleted successfully
                                    }
                                    else
                                    {
                                        deleted = true; // File already doesn't exist
                                        LogInfo($"[CLEANUP] File sudah tidak ada: {Path.GetRelativePath(downloadPath, file)}");
                                    }
                                }
                                catch (IOException ioEx) when (ioEx.Message.Contains("being used by another process") || ioEx.Message.Contains("cannot access"))
                                {
                                    if (retry < maxRetries - 1)
                                    {
                                        // File still in use, will retry
                                        // Continue to retry
                                    }
                                    else
                                    {
                                        // Last retry failed
                                        var errorMsg = $"Gagal menghapus file setelah {maxRetries} attempts: {Path.GetRelativePath(downloadPath, file)} - {ioEx.Message}";
                                        errors.Add(errorMsg);
                                        LogInfo($"[CLEANUP] ✗ {errorMsg}");
                                        LogInfo($"[CLEANUP] Exception type: {ioEx.GetType().Name}, HResult: {ioEx.HResult}");
                                        LogInfo($"[CLEANUP] File mungkin masih digunakan oleh proses lain (WinRAR, antivirus, dll). File akan tetap ada.");
                                    }
                                }
                                catch (Exception ex)
                                {
                                    if (retry < maxRetries - 1)
                                    {
                                        // Error, will retry
                                    }
                                    else
                                    {
                                        var errorMsg = $"Gagal menghapus file setelah {maxRetries} attempts: {Path.GetRelativePath(downloadPath, file)} - {ex.Message}";
                                        errors.Add(errorMsg);
                                        LogInfo($"[CLEANUP] ✗ {errorMsg}");
                                        LogInfo($"[CLEANUP] Exception type: {ex.GetType().Name}, HResult: {ex.HResult}");
                                    }
                                }
                            }
                        }
                        
                        // Delete all subdirectories recursively
                        var allDirs = Directory.GetDirectories(downloadPath, "*", SearchOption.AllDirectories)
                            .OrderByDescending(d => d.Length); // Delete deepest directories first
                        
                        foreach (var dir in allDirs)
                        {
                            try
                            {
                                if (Directory.Exists(dir))
                                {
                                    Directory.Delete(dir, true);
                                    deletedDirs++;
                                }
                            }
                            catch (Exception ex)
                            {
                                var errorMsg = $"Gagal menghapus subdirectory: {ex.Message}";
                                errors.Add(errorMsg);
                            }
                        }
                        
                        // Finally, delete the download folder itself
                        try
                        {
                            if (Directory.Exists(downloadPath))
                            {
                                // Force delete: try to delete folder even if not completely empty
                                // This handles cases where some files might be locked or hidden
                                // Try to delete folder with retries
                                bool folderDeleted = false;
                                int folderMaxRetries = 3;
                                
                                for (int folderRetry = 0; folderRetry < folderMaxRetries && !folderDeleted; folderRetry++)
                                {
                                    try
                                    {
                                        if (folderRetry > 0)
                                        {
                                            await Task.Delay(2000 * folderRetry); // Wait longer between retries
                                            
                                            // Force GC before retry
                                            GC.Collect();
                                            GC.WaitForPendingFinalizers();
                                            GC.Collect();
                                        }
                                        
                                        Directory.Delete(downloadPath, true);
                                        deletedDirs++;
                                        folderDeleted = true;
                                    }
                                    catch (Exception deleteEx)
                                    {
                                        if (folderRetry < folderMaxRetries - 1)
                                        {
                                            // Continue to retry
                                        }
                                        else
                                        {
                                            // Last retry failed
                                            var remainingFiles = Directory.GetFiles(downloadPath, "*", SearchOption.AllDirectories);
                                            var remainingDirs = Directory.GetDirectories(downloadPath, "*", SearchOption.AllDirectories);
                                            
                                            if (remainingFiles.Length > 0 || remainingDirs.Length > 0)
                                            {
                                                // Try to delete remaining files one more time
                                                foreach (var remainingFile in remainingFiles)
                                                {
                                                    try
                                                    {
                                                        var fileInfo = new FileInfo(remainingFile);
                                                        fileInfo.Attributes = FileAttributes.Normal;
                                                        File.Delete(remainingFile);
                                                        deletedFiles++;
                                                    }
                                                    catch { }
                                                }
                                                
                                                // Try to delete folder again after cleaning remaining files
                                                try
                                                {
                                                    Directory.Delete(downloadPath, true);
                                                    deletedDirs++;
                                                    folderDeleted = true;
                                                }
                                                catch (Exception retryEx)
                                                {
                                                    var errorMsg = $"Gagal menghapus download folder: {retryEx.Message}";
                                                    errors.Add(errorMsg);
                                                }
                                            }
                                            else
                                            {
                                                var errorMsg = $"Gagal menghapus download folder: {deleteEx.Message}";
                                                errors.Add(errorMsg);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            var errorMsg = $"Error saat menghapus download folder: {ex.Message}";
                            errors.Add(errorMsg);
                            LogInfo(errorMsg);
                        }
                    }
                    catch (Exception ex)
                    {
                        var errorMsg = $"Gagal membersihkan download folder: {ex.Message}";
                        errors.Add(errorMsg);
                        LogInfo(errorMsg);
                    }
                }
                else
                {
                    // Download folder tidak ditemukan atau path kosong
                }
                
                if (errors.Count > 0)
                {
                    LogInfo($"Cleanup selesai dengan {errors.Count} error(s)");
                }
                
                return new
                {
                    type = "FixGamesCleanupComplete",
                    success = true,
                    deletedFiles = deletedFiles,
                    deletedDirs = deletedDirs,
                    errors = errors.Count > 0 ? errors : null
                };
            }
            catch (Exception ex)
            {
                LogInfo($"Error dalam CleanupTempFilesAsync: {ex.Message}");
                return new
                {
                    type = "FixGamesCleanupError",
                    success = false,
                    error = ex.Message,
                    deletedFiles = deletedFiles,
                    deletedDirs = deletedDirs
                };
            }
        }

        public void Cancel(int appid)
        {
            if (_cts.TryRemove(appid, out var cts))
            {
                cts.Cancel();
                LogInfo($"Cancel requested for AppID: {appid}");
            }
        }

        // Scan executables in game folder
        public Task<object> ScanExecutablesAsync(string gamePath, string? gameTitle = null)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(gamePath) || !Directory.Exists(gamePath))
                {
                    return Task.FromResult<object>(new
                    {
                        type = "FixGamesScanExecutables",
                        success = false,
                        error = "Game path tidak valid atau tidak ditemukan"
                    });
                }

                LogInfo($"Memindai executable di: {RedactPath(gamePath)}");

                var executables = new List<object>();
                var exeFiles = Directory.GetFiles(gamePath, "*.exe", SearchOption.AllDirectories);

                // Normalize game title untuk similarity comparison
                string? normalizedGameTitle = null;
                if (!string.IsNullOrWhiteSpace(gameTitle))
                {
                    // Remove special characters, convert to lowercase untuk comparison
                    normalizedGameTitle = System.Text.RegularExpressions.Regex.Replace(gameTitle, @"[^a-zA-Z0-9]", "").ToLowerInvariant();
                }

                foreach (var exePath in exeFiles)
                {
                    try
                    {
                        var fileName = Path.GetFileName(exePath);
                        var fileNameWithoutExt = Path.GetFileNameWithoutExtension(exePath);
                        var relativePath = Path.GetRelativePath(gamePath, exePath);
                        var fileInfo = new FileInfo(exePath);
                        var size = fileInfo.Length;
                        var directory = Path.GetDirectoryName(exePath);
                        var relativeDir = !string.IsNullOrEmpty(directory) ? Path.GetRelativePath(gamePath, directory) : "";

                        // Score executable berdasarkan heuristik
                        int score = 0;
                        int similarityScore = 0; // Similarity dengan nama game (0-100)

                        // 1. Lokasi (root folder = +20, subfolder tertentu = +10)
                        if (relativeDir == "" || relativeDir == ".")
                        {
                            score += 20; // Root folder
                        }
                        else
                        {
                            var dirLower = relativeDir.ToLowerInvariant();
                            if (dirLower.Contains("bin") || dirLower.Contains("binaries") || 
                                dirLower.Contains("game") || dirLower.Contains("win64") || 
                                dirLower.Contains("win32") || dirLower == ".")
                            {
                                score += 10; // Subfolder yang umum untuk game exe
                            }
                        }

                        // 2. Nama (hindari: uninstaller, setup, updater = -20)
                        var nameLower = fileName.ToLowerInvariant();
                        var nameWithoutExtLower = fileNameWithoutExt.ToLowerInvariant();
                        if (nameLower.Contains("uninstall") || nameLower.Contains("setup") || 
                            nameLower.Contains("updater") || nameLower.Contains("patcher") ||
                            nameLower.Contains("launcher") || nameLower.Contains("installer") ||
                            nameLower.Contains("dll") || nameLower.Contains("injector"))
                        {
                            score -= 20; // Bukan game exe
                        }

                        // 3. Ukuran (game exe biasanya > 1MB = +10)
                        if (size > 1024 * 1024) // > 1MB
                        {
                            score += 10;
                        }
                        else if (size < 100 * 1024) // < 100KB
                        {
                            score -= 10; // Terlalu kecil, mungkin helper
                        }

                        // 4. Similarity dengan nama game (PRIORITAS UTAMA)
                        if (!string.IsNullOrWhiteSpace(normalizedGameTitle) && !string.IsNullOrWhiteSpace(fileNameWithoutExt))
                        {
                            var normalizedExeName = System.Text.RegularExpressions.Regex.Replace(fileNameWithoutExt, @"[^a-zA-Z0-9]", "").ToLowerInvariant();
                            
                            // Check exact match atau substring
                            if (normalizedExeName == normalizedGameTitle)
                            {
                                similarityScore = 100; // Exact match
                            }
                            else if (normalizedGameTitle.Contains(normalizedExeName) || normalizedExeName.Contains(normalizedGameTitle))
                            {
                                similarityScore = 80; // Contains match
                            }
                            else
                            {
                                // Calculate similarity using improved fuzzy matching
                                similarityScore = CalculateFuzzySimilarity(normalizedGameTitle, normalizedExeName);
                            }
                        }

                        // Set recommended jika similarity score tinggi ATAU score tinggi
                        bool recommended = similarityScore >= 50 || score >= 30;

                        // Extract icon from executable
                        string? iconBase64 = null;
                        try
                        {
                            iconBase64 = ExtractIconAsBase64(exePath);
                        }
                        catch (Exception iconEx)
                        {
                            // Icon extraction failed - continue without icon
                            LogInfo($"Failed to extract icon from {RedactPath(exePath)}: {iconEx.Message}");
                        }

                        executables.Add(new
                        {
                            path = exePath,
                            name = fileName,
                            relativePath = relativePath.Replace('\\', '/'),
                            size = size,
                            score = score,
                            similarityScore = similarityScore,
                            recommended = recommended,
                            iconBase64 = iconBase64
                        });
                    }
                    catch (Exception ex)
                    {
                        LogInfo($"Error processing exe {RedactPath(exePath)}: {ex.Message}");
                    }
                }

                // Sort by recommended first (true first), then by similarity score, then by score, then by name
                var sorted = executables.OrderByDescending(e => 
                {
                    var recommended = e.GetType().GetProperty("recommended")?.GetValue(e);
                    return recommended is bool b && b;
                }).ThenByDescending(e => 
                {
                    var simScore = e.GetType().GetProperty("similarityScore")?.GetValue(e) ?? 0;
                    return simScore;
                }).ThenByDescending(e => 
                {
                    var score = e.GetType().GetProperty("score")?.GetValue(e) ?? 0;
                    return score;
                }).ThenBy(e => 
                {
                    var name = e.GetType().GetProperty("name")?.GetValue(e)?.ToString() ?? "";
                    return name;
                }).ToList();

                LogInfo($"Ditemukan {sorted.Count} executable");

                return Task.FromResult<object>(new
                {
                    type = "FixGamesScanExecutables",
                    success = true,
                    executables = sorted
                });
            }
            catch (Exception ex)
            {
                LogInfo($"Error scanning executables: {ex.Message}");
                return Task.FromResult<object>(new
                {
                    type = "FixGamesScanExecutables",
                    success = false,
                    error = ex.Message
                });
            }
        }

        // Calculate similarity between two strings using improved fuzzy matching (0-100)
        private int CalculateFuzzySimilarity(string gameTitle, string exeName)
        {
            if (string.IsNullOrEmpty(gameTitle) || string.IsNullOrEmpty(exeName)) return 0;
            if (gameTitle == exeName) return 100;

            // 1. Levenshtein Distance (weighted: 40%)
            int levenshteinScore = CalculateLevenshteinSimilarity(gameTitle, exeName);

            // 2. Acronym/Abbreviation matching (weighted: 30%)
            // Check if exe name could be an acronym of game title (e.g., "re4" from "residentevil4")
            int acronymScore = CalculateAcronymSimilarity(gameTitle, exeName);

            // 3. Token-based matching (weighted: 20%)
            // Split into tokens and match (e.g., "resident" "evil" "4" vs "re" "4")
            int tokenScore = CalculateTokenSimilarity(gameTitle, exeName);

            // 4. Common substring matching (weighted: 10%)
            int substringScore = CalculateSubstringSimilarity(gameTitle, exeName);

            // Weighted combination
            int finalScore = (int)(
                (levenshteinScore * 0.40) +
                (acronymScore * 0.30) +
                (tokenScore * 0.20) +
                (substringScore * 0.10)
            );

            return Math.Min(100, Math.Max(0, finalScore));
        }

        // Levenshtein Distance similarity (0-100)
        private int CalculateLevenshteinSimilarity(string s1, string s2)
        {
            if (string.IsNullOrEmpty(s1) || string.IsNullOrEmpty(s2)) return 0;
            if (s1 == s2) return 100;

            int maxLen = Math.Max(s1.Length, s2.Length);
            if (maxLen == 0) return 100;

            int distance = LevenshteinDistance(s1, s2);
            int similarity = (int)((1.0 - (double)distance / maxLen) * 100);
            return Math.Max(0, similarity);
        }

        // Levenshtein Distance algorithm
        private int LevenshteinDistance(string s1, string s2)
        {
            int n = s1.Length;
            int m = s2.Length;
            int[,] d = new int[n + 1, m + 1];

            if (n == 0) return m;
            if (m == 0) return n;

            for (int i = 0; i <= n; d[i, 0] = i++) { }
            for (int j = 0; j <= m; d[0, j] = j++) { }

            for (int i = 1; i <= n; i++)
            {
                for (int j = 1; j <= m; j++)
                {
                    int cost = (s2[j - 1] == s1[i - 1]) ? 0 : 1;
                    d[i, j] = Math.Min(
                        Math.Min(d[i - 1, j] + 1, d[i, j - 1] + 1),
                        d[i - 1, j - 1] + cost);
                }
            }

            return d[n, m];
        }

        // Acronym/Abbreviation similarity (e.g., "re4" matches "residentevil4")
        private int CalculateAcronymSimilarity(string gameTitle, string exeName)
        {
            if (string.IsNullOrEmpty(gameTitle) || string.IsNullOrEmpty(exeName)) return 0;

            // If exe name is shorter, it might be an acronym
            if (exeName.Length >= gameTitle.Length) return 0;

            // Extract potential acronym from game title (first letters of words or consecutive letters)
            // For "residentevil4" -> could match "re4" if we check if exeName appears as pattern
            int matchCount = 0;
            int exeIndex = 0;

            // Try to match exeName characters in order within gameTitle
            for (int i = 0; i < gameTitle.Length && exeIndex < exeName.Length; i++)
            {
                if (gameTitle[i] == exeName[exeIndex])
                {
                    matchCount++;
                    exeIndex++;
                }
            }

            // If all characters of exeName were found in order in gameTitle
            if (exeIndex == exeName.Length)
            {
                // Calculate score based on how much of exeName matches
                return (int)((matchCount * 100.0) / exeName.Length);
            }

            // Also check reverse: if gameTitle characters appear in exeName in order
            int gameIndex = 0;
            matchCount = 0;
            for (int i = 0; i < exeName.Length && gameIndex < gameTitle.Length; i++)
            {
                if (exeName[i] == gameTitle[gameIndex])
                {
                    matchCount++;
                    gameIndex++;
                }
            }

            if (gameIndex > 0)
            {
                return (int)((matchCount * 100.0) / Math.Min(gameTitle.Length, exeName.Length));
            }

            return 0;
        }

        // Token-based similarity (split by numbers and check word matches)
        private int CalculateTokenSimilarity(string gameTitle, string exeName)
        {
            if (string.IsNullOrEmpty(gameTitle) || string.IsNullOrEmpty(exeName)) return 0;

            // Split by numbers and extract tokens
            var gameTokens = System.Text.RegularExpressions.Regex.Split(gameTitle, @"(\d+)")
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Select(t => t.ToLowerInvariant())
                .ToList();

            var exeTokens = System.Text.RegularExpressions.Regex.Split(exeName, @"(\d+)")
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Select(t => t.ToLowerInvariant())
                .ToList();

            if (gameTokens.Count == 0 || exeTokens.Count == 0) return 0;

            // Check if exe tokens appear in game tokens (as substrings or exact)
            int matchedTokens = 0;
            foreach (var exeToken in exeTokens)
            {
                foreach (var gameToken in gameTokens)
                {
                    if (gameToken.Contains(exeToken) || exeToken.Contains(gameToken))
                    {
                        matchedTokens++;
                        break;
                    }
                }
            }

            return (int)((matchedTokens * 100.0) / Math.Max(gameTokens.Count, exeTokens.Count));
        }

        // Common substring similarity
        private int CalculateSubstringSimilarity(string s1, string s2)
        {
            if (string.IsNullOrEmpty(s1) || string.IsNullOrEmpty(s2)) return 0;

            int maxLen = 0;
            string longer = s1.Length > s2.Length ? s1 : s2;
            string shorter = s1.Length > s2.Length ? s2 : s1;

            // Find longest common substring
            for (int i = 0; i < shorter.Length; i++)
            {
                for (int j = i + 1; j <= shorter.Length; j++)
                {
                    string substr = shorter.Substring(i, j - i);
                    if (longer.Contains(substr) && substr.Length > maxLen)
                    {
                        maxLen = substr.Length;
                    }
                }
            }

            if (maxLen == 0) return 0;
            return (int)((maxLen * 100.0) / Math.Max(s1.Length, s2.Length));
        }

        // Extract icon from executable and convert to base64 PNG
        private string? ExtractIconAsBase64(string exePath)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(exePath) || !File.Exists(exePath))
                {
                    return null;
                }

                // Extract icon from executable
                Icon? icon = Icon.ExtractAssociatedIcon(exePath);
                if (icon == null)
                {
                    return null;
                }

                // Convert icon to bitmap
                using (icon)
                using (Bitmap bitmap = icon.ToBitmap())
                {
                    // Resize to 32x32 for consistency and smaller size
                    int size = 32;
                    using (Bitmap resized = new Bitmap(bitmap, new Size(size, size)))
                    {
                        // Convert to PNG and then to base64
                        using (MemoryStream ms = new MemoryStream())
                        {
                            resized.Save(ms, ImageFormat.Png);
                            byte[] imageBytes = ms.ToArray();
                            return Convert.ToBase64String(imageBytes);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                // Return null if extraction fails
                return null;
            }
        }

        // Create desktop shortcut
        public Task<object> CreateDesktopShortcutAsync(string exePath, string shortcutName, string gamePath)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(exePath) || !File.Exists(exePath))
                {
                    return Task.FromResult<object>(new
                    {
                        type = "FixGamesCreateShortcut",
                        success = false,
                        error = "Executable tidak ditemukan"
                    });
                }

                if (string.IsNullOrWhiteSpace(shortcutName))
                {
                    shortcutName = Path.GetFileNameWithoutExtension(exePath);
                }

                // Get desktop path
                var desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
                var shortcutPath = Path.Combine(desktopPath, $"{shortcutName}.lnk");

                // Create shortcut using COM (Windows Script Host)
                try
                {
                    // Create WScript.Shell COM object
                    Type? shellType = Type.GetTypeFromProgID("WScript.Shell");
                    if (shellType == null)
                    {
                        throw new Exception("Tidak dapat membuat WScript.Shell COM object");
                    }
                    
                    object? shellObj = Activator.CreateInstance(shellType);
                    if (shellObj == null)
                    {
                        throw new Exception("Gagal membuat instance WScript.Shell");
                    }
                    
                    dynamic shell = shellObj;
                    dynamic shortcut = shell.CreateShortcut(shortcutPath);

                    shortcut.TargetPath = exePath;
                    shortcut.WorkingDirectory = !string.IsNullOrWhiteSpace(gamePath) ? gamePath : Path.GetDirectoryName(exePath);
                    shortcut.Description = $"Shortcut untuk {shortcutName}";
                    shortcut.Save();

                    LogInfo($"Shortcut berhasil dibuat: {RedactPath(shortcutPath)}");

                    return Task.FromResult<object>(new
                    {
                        type = "FixGamesCreateShortcut",
                        success = true,
                        shortcutPath = shortcutPath
                    });
                }
                catch (Exception ex)
                {
                    LogInfo($"Error creating shortcut via COM: {ex.Message}");
                    throw;
                }
            }
            catch (Exception ex)
            {
                LogInfo($"Error creating desktop shortcut: {ex.Message}");
                return Task.FromResult<object>(new
                {
                    type = "FixGamesCreateShortcut",
                    success = false,
                    error = ex.Message
                });
            }
        }

        private string RedactPath(string path)
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
    }
}

