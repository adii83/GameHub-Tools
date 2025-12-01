using System;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using GameHubLicensing;

namespace GameHubDesktop.Services
{
    public class LicenseInfo
    {
        public string Plan { get; set; } = "standard"; // "premium" | "standard"
        public bool IsActive { get; set; }
        public bool IsValid { get; set; }
        public string LicenseKey { get; set; } = "";
        public string ErrorMessage { get; set; } = "";
    }

    public static class LicenseService
    {
        private static LicenseInfo? _cachedLicense = null;
        private static readonly object _lock = new object();

        public static Action<string>? Log { get; set; }

        private static void LogInfo(string message)
        {
            try 
            { 
                Log?.Invoke($"[LicenseService] {message}");
            } 
            catch { }
        }

        /// <summary>
        /// Load license saat app start - validasi offline
        /// </summary>
        public static LicenseInfo LoadLicense()
        {
            lock (_lock)
            {
                if (_cachedLicense != null)
                    return _cachedLicense;

                try
                {
                    var localLicense = LicenseLoader.LoadLicense();

                    if (localLicense == null)
                    {
                        LogInfo("License file tidak ditemukan atau tidak valid");
                        return new LicenseInfo
                        {
                            IsActive = false,
                            IsValid = false,
                            ErrorMessage = "License tidak ditemukan"
                        };
                    }

                    // Validasi device binding sudah dilakukan di LicenseLoader
                    // Jika sampai sini, berarti license valid secara offline
                    _cachedLicense = new LicenseInfo
                    {
                        Plan = localLicense.plan?.ToLower() ?? "standard",
                        IsActive = true,
                        IsValid = true,
                        LicenseKey = localLicense.license_key ?? ""
                    };

                    LogInfo($"License loaded: Plan={_cachedLicense.Plan}, Key={_cachedLicense.LicenseKey.Substring(0, Math.Min(8, _cachedLicense.LicenseKey.Length))}...");
                    return _cachedLicense;
                }
                catch (Exception ex)
                {
                    LogInfo($"Error loading license: {ex.Message}");
                    return new LicenseInfo
                    {
                        IsActive = false,
                        IsValid = false,
                        ErrorMessage = $"Error: {ex.Message}"
                    };
                }
            }
        }

        /// <summary>
        /// Validasi online opsional (jika ada internet) - cek status di Supabase
        /// </summary>
        public static async Task<LicenseInfo> ValidateOnlineAsync()
        {
            var license = GetCurrentLicense();
            if (!license.IsValid || string.IsNullOrEmpty(license.LicenseKey))
            {
                LogInfo("ValidateOnlineAsync: License tidak valid, skip online validation");
                return license; // Tidak perlu validasi online jika license tidak valid
            }

            LogInfo("ValidateOnlineAsync: Starting online validation...");
            var startTime = DateTime.Now;
            
            // Timeout untuk seluruh validasi online (10 detik total)
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            
            try
            {
                LogInfo("ValidateOnlineAsync: Creating validation and delay tasks...");
                
                // Gunakan Task.WhenAny untuk timeout yang lebih reliable
                var validationTask = ValidateOnlineInternalAsync(license, cts.Token);
                var delayTask = Task.Delay(TimeSpan.FromSeconds(10), cts.Token);
                
                LogInfo("ValidateOnlineAsync: Waiting for Task.WhenAny...");
                
                // Log progress setiap detik untuk tracking
                _ = Task.Run(async () =>
                {
                    for (int i = 1; i <= 10; i++)
                    {
                        await Task.Delay(1000);
                        if (!cts.Token.IsCancellationRequested)
                        {
                            LogInfo($"ValidateOnlineAsync: Still waiting... {i}s elapsed");
                        }
                        else
                        {
                            break;
                        }
                    }
                });
                
                var completedTask = await Task.WhenAny(validationTask, delayTask);
                
                var elapsed = (DateTime.Now - startTime).TotalSeconds;
                LogInfo($"ValidateOnlineAsync: Task.WhenAny completed after {elapsed:F2}s");
                
                if (completedTask == delayTask)
                {
                    // Timeout terjadi - cancel validation task
                    LogInfo("ValidateOnlineAsync: Delay task completed first - TIMEOUT!");
                    cts.Cancel();
                    LogInfo("Online validation timeout (10s) - cancelling task");
                    throw new TimeoutException("Validasi license timeout. Pastikan koneksi internet Anda stabil dan coba tutup aplikasi lalu buka lagi.");
                }
                
                // Validation selesai - return hasilnya
                LogInfo("ValidateOnlineAsync: Validation task completed first - getting result...");
                var result = await validationTask;
                elapsed = (DateTime.Now - startTime).TotalSeconds;
                LogInfo($"ValidateOnlineAsync: Validation completed successfully after {elapsed:F2}s");
                return result;
            }
            catch (TimeoutException ex)
            {
                // Re-throw TimeoutException agar ditangani di MainWindow
                var elapsed = (DateTime.Now - startTime).TotalSeconds;
                LogInfo($"Online validation timeout (10s) after {elapsed:F2}s - throwing TimeoutException: {ex.Message}");
                throw;
            }
            catch (TaskCanceledException ex)
            {
                // TaskCanceledException adalah subclass dari OperationCanceledException, jadi harus di-catch dulu
                // Task dibatalkan karena timeout
                var elapsed = (DateTime.Now - startTime).TotalSeconds;
                LogInfo($"Online validation cancelled due to timeout (TaskCanceledException) after {elapsed:F2}s: {ex.Message}");
                throw new TimeoutException("Validasi license timeout. Pastikan koneksi internet Anda stabil dan coba tutup aplikasi lalu buka lagi.");
            }
            catch (OperationCanceledException ex)
            {
                // Task dibatalkan karena timeout atau cancellation (catch yang lebih umum)
                var elapsed = (DateTime.Now - startTime).TotalSeconds;
                LogInfo($"Online validation cancelled due to timeout (OperationCanceledException) after {elapsed:F2}s: {ex.Message}");
                throw new TimeoutException("Validasi license timeout. Pastikan koneksi internet Anda stabil dan coba tutup aplikasi lalu buka lagi.");
            }
            catch (Exception ex)
            {
                // Network error atau error lain - throw agar MainWindow bisa handle
                var elapsed = (DateTime.Now - startTime).TotalSeconds;
                LogInfo($"Online validation error after {elapsed:F2}s: {ex.GetType().Name} - {ex.Message}");
                LogInfo($"Stack trace: {ex.StackTrace}");
                throw;
            }
        }
        
        private static async Task<LicenseInfo> ValidateOnlineInternalAsync(LicenseInfo license, CancellationToken cancellationToken)
        {
            try
            {
                cancellationToken.ThrowIfCancellationRequested();
                
                string deviceId;
                try
                {
                    deviceId = await Task.Run(() => DeviceIdHelper.GetDeviceId(), cancellationToken)
                        .WaitAsync(TimeSpan.FromSeconds(5), cancellationToken);
                }
                catch (TimeoutException)
                {
                    deviceId = "timeout_fallback";
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                
                cancellationToken.ThrowIfCancellationRequested();
                
                var response = await LicenseActivator.ActivateAsync(license.LicenseKey, deviceId, cancellationToken);

                if (response.status == "success")
                {
                    lock (_lock)
                    {
                        if (_cachedLicense != null)
                        {
                            _cachedLicense.Plan = response.plan?.ToLower() ?? "standard";
                            _cachedLicense.IsActive = true;
                        }
                    }
                    return _cachedLicense ?? license;
                }
                else if (response.status == "error")
                {
                    lock (_lock)
                    {
                        if (_cachedLicense != null)
                        {
                            _cachedLicense.IsActive = false;
                            _cachedLicense.IsValid = false; // Mark as invalid jika banned/reset
                            _cachedLicense.ErrorMessage = response.message ?? "License tidak valid";
                            
                            // Jika banned/reset, hapus license file dan clear cache
                            if (response.message != null && 
                                (response.message.Contains("banned", StringComparison.OrdinalIgnoreCase) ||
                                 response.message.Contains("reset", StringComparison.OrdinalIgnoreCase) ||
                                 response.message.Contains("not_found", StringComparison.OrdinalIgnoreCase)))
                            {
                                try
                                {
                                    var licenseFile = System.IO.Path.Combine(
                                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                                        "GameHub", "license.dat");
                                    if (System.IO.File.Exists(licenseFile))
                                    {
                                        System.IO.File.Delete(licenseFile);
                                    }
                                    
                                    ClearCache();
                                }
                                catch { }
                            }
                        }
                    }
                    return _cachedLicense ?? license;
                }
            }
            catch
            {
                // Network error - tetap gunakan license offline
                return license;
            }

            return license;
        }

        /// <summary>
        /// Aktivasi license baru
        /// </summary>
        public static async Task<LicenseInfo> ActivateAsync(string licenseKey)
        {
            try
            {
                // Get device ID async untuk menghindari blocking (WMI bisa lambat)
                string deviceId;
                try
                {
                    using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
                    {
                        deviceId = await Task.Run(() => DeviceIdHelper.GetDeviceId(), cts.Token);
                    }
                }
                catch (OperationCanceledException)
                {
                    deviceId = "timeout_fallback";
                }
                catch (Exception)
                {
                    deviceId = "error_fallback";
                }
                
                using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8)))
                {
                    var response = await LicenseActivator.ActivateAsync(licenseKey, deviceId, cts.Token);

                    if (response.status == "success")
                {
                    // Simpan license ke file (async untuk menghindari blocking)
                    var localLicense = new LocalLicense
                    {
                        license_key = licenseKey,
                        device_id = deviceId,
                        plan = response.plan ?? "standard",
                        activated_at = DateTime.UtcNow.ToString("o")
                    };

                    try
                    {
                        await LicenseLoader.SaveLicenseAsync(localLicense);
                    }
                    catch (Exception saveEx)
                    {
                        LogInfo($"Error saving license file: {saveEx.Message}");
                        // Tetap lanjutkan karena license sudah valid di server
                    }

                    // Update cache
                    lock (_lock)
                    {
                        _cachedLicense = new LicenseInfo
                        {
                            Plan = response.plan?.ToLower() ?? "standard",
                            IsActive = true,
                            IsValid = true,
                            LicenseKey = licenseKey
                        };
                    }

                    LogInfo($"License activated: Plan={response.plan}");
                    return _cachedLicense;
                    }
                    else
                    {
                        LogInfo($"License activation failed: {response.message}");
                        
                        // Deteksi banned dan berikan pesan yang jelas
                        string errorMessage = response.message ?? "Aktivasi gagal";
                        bool isBanned = false;
                        
                        if (!string.IsNullOrEmpty(response.message))
                        {
                            string msgLower = response.message.ToLower();
                            if (msgLower.Contains("banned") || 
                                msgLower.Contains("dibanned") ||
                                (!string.IsNullOrEmpty(response.reason) && response.reason.ToLower().Contains("banned")))
                            {
                                isBanned = true;
                                errorMessage = "LicenseKey dibanned. Silakan hubungi admin untuk bantuan lebih lanjut.";
                            }
                            else if (msgLower.Contains("not_found") || msgLower.Contains("license tidak ditemukan"))
                            {
                                errorMessage = "LicenseKey tidak ditemukan. Periksa kembali license key Anda.";
                            }
                            else if (msgLower.Contains("wrong_device") || msgLower.Contains("device berbeda"))
                            {
                                errorMessage = "LicenseKey sudah digunakan di perangkat lain. Satu license key hanya bisa digunakan di satu perangkat.";
                            }
                        }
                        
                        return new LicenseInfo
                        {
                            IsActive = false,
                            IsValid = false,
                            ErrorMessage = errorMessage,
                            LicenseKey = isBanned ? licenseKey : null // Jangan simpan license key jika banned
                        };
                    }
                }
            }
            catch (Exception ex)
            {
                LogInfo($"License activation error: {ex.Message}");
                return new LicenseInfo
                {
                    IsActive = false,
                    IsValid = false,
                    ErrorMessage = $"Network error: {ex.Message}"
                };
            }
        }

        /// <summary>
        /// Get current license info (from cache)
        /// </summary>
        public static LicenseInfo GetCurrentLicense()
        {
            lock (_lock)
            {
                if (_cachedLicense == null)
                {
                    _cachedLicense = LoadLicense();
                }
                return _cachedLicense;
            }
        }

        /// <summary>
        /// Clear license cache (untuk reload)
        /// </summary>
        public static void ClearCache()
        {
            lock (_lock)
            {
                _cachedLicense = null;
            }
        }

        /// <summary>
        /// Check if license is premium
        /// </summary>
        public static bool IsPremium()
        {
            var license = GetCurrentLicense();
            return license.IsValid && license.IsActive && license.Plan == "premium";
        }

        /// <summary>
        /// Check if license is valid (ada dan valid)
        /// </summary>
        public static bool IsValid()
        {
            var license = GetCurrentLicense();
            return license.IsValid && license.IsActive;
        }
    }
}

