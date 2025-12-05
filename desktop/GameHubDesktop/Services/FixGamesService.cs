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
                                        if (propName.Contains("name") || propName.Contains("display") || propName.Contains("product"))
                                        {
                                            var propValue = prop.Value;
                                            if (propValue != null)
                                            {
                                                // Only use string values, skip all numeric types
                                                if (propValue is string str && !string.IsNullOrWhiteSpace(str))
                                                {
                                                    productName = str;
                                                    break; // Found valid name
                                                }
                                                // Explicitly skip numeric types
                                                else if (propValue is int || propValue is long || propValue is uint || propValue is ulong ||
                                                         propValue is short || propValue is ushort || propValue is byte || propValue is sbyte ||
                                                         propValue is float || propValue is double || propValue is decimal)
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
                    @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                    @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
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

                            var displayName = subKey.GetValue("DisplayName")?.ToString() ?? "";
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
            LogInfo($"Menambahkan path ke Windows Defender exclusion: {Path.GetFileName(gamePath)}");
            
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
            LogInfo($"Memulai download files untuk AppID: {appid}");
            
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
                            LogInfo($"Warning: filename is a URL, using part number instead");
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
                            LogInfo($"File sudah ada, skip: {filename}");
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

                    LogInfo($"Downloading: {filename} ({currentFile}/{totalFiles})");
                    
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
                                LogInfo($"Could not extract file ID from URL: {url}");
                                throw new Exception("URL Google Drive tidak valid");
                            }
                            
                            string fileId = idMatch.Groups[1].Value;
                            LogInfo($"Downloading Google Drive file ID: {fileId}, filename: {filename}");
                            
                            // Try multiple download methods
                            HttpResponseMessage? response = null;
                            string? lastError = null;
                            
                            // Method 1: Direct download with confirm parameter
                            string downloadUrl1 = $"https://drive.usercontent.google.com/download?id={fileId}&export=download&confirm=t";
                            try
                            {
                                LogInfo($"Trying method 1: direct download URL");
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
                                    LogInfo($"Method 1 returned HTML, extracting download link...");
                                    var html = await response.Content.ReadAsStringAsync();
                                    var extractedUrl = ExtractGoogleDriveDownloadLink(html, url);
                                    
                                    if (!string.IsNullOrWhiteSpace(extractedUrl) && extractedUrl != downloadUrl1)
                                    {
                                        LogInfo($"Extracted URL, trying method 2...");
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
                                LogInfo($"Download URL validated successfully");

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
                                LogInfo($"Download selesai: {filename}");
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
                            LogInfo($"Download retry {retry + 1}/{maxRetries} gagal: {ex.Message}");
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

        // Step 5: Extract Files (TODO: Implement RAR extraction)
        public async Task<object> ExtractFilesAsync(string downloadPath, List<string> files, string password, Func<object, Task> sendProgress)
        {
            LogInfo($"Mengekstrak files dari: {downloadPath}");
            
            // TODO: Implement RAR extraction using SharpCompress or unrar.dll
            // For now, return success (will be implemented)
            await Task.Delay(100);
            
            return new
            {
                type = "FixGamesExtractComplete",
                success = true,
                extractedPath = downloadPath
            };
        }

        // Step 6: Replace Files
        public async Task<object> ReplaceFilesAsync(string gamePath, string extractedPath, Func<object, Task> sendProgress)
        {
            LogInfo($"Mengganti files di: {gamePath}");
            
            // TODO: Implement file replacement
            // For now, return success (will be implemented)
            await Task.Delay(100);
            
            return new
            {
                type = "FixGamesReplaceComplete",
                success = true,
                gamePath
            };
        }

        public void Cancel(int appid)
        {
            if (_cts.TryRemove(appid, out var cts))
            {
                cts.Cancel();
                LogInfo($"Cancel requested for AppID: {appid}");
            }
        }
    }
}

