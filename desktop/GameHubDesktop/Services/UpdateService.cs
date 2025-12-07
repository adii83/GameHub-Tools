using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace GameHubDesktop.Services
{
    public class UpdateService
    {
        private const string METADATA_URL = "https://raw.githubusercontent.com/adii83/GameHub-Tools/main/public/update/latest.json";
        private const string USER_AGENT = "GameHub/1.0";
        private static readonly HttpClient Http = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(30)
        };

        private readonly string _statePath;
        private readonly string _downloadDir;
        private readonly JsonSerializerOptions _jsonOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            WriteIndented = false
        };

        private UpdateState? _stateCache;
        private readonly object _lock = new object();

        public Action<string>? Log { get; set; }

        public UpdateService()
        {
            var appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GameHub");
            if (!Directory.Exists(appData))
            {
                Directory.CreateDirectory(appData);
            }
            _statePath = Path.Combine(appData, "update_state.json");
            _downloadDir = Path.Combine(appData, "updates");
            if (!Directory.Exists(_downloadDir))
            {
                Directory.CreateDirectory(_downloadDir);
            }
        }

        public UpdateStateSnapshot GetStateSnapshot()
        {
            var state = LoadState();
            return new UpdateStateSnapshot
            {
                LastCheckedUtc = state.LastCheckedUtc,
                LastKnownRemoteVersion = state.LastKnownRemoteVersion,
                LastDownloadedInstallerPath = state.LastDownloadedInstallerPath,
                LastPromptUtc = state.LastPromptUtc
            };
        }

        public void RecordAutoPrompt(DateTime utc)
        {
            var state = LoadState();
            state.LastPromptUtc = utc;
            SaveState(state);
        }

        public async Task<UpdateCheckResult> CheckForUpdatesAsync(bool forceRefresh = false, CancellationToken cancellationToken = default)
        {
            var state = LoadState();
            UpdateMetadata? metadata = null;
            string? error = null;

            try
            {
                metadata = await FetchMetadataAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                LogInfo($"Fetch metadata failed: {ex.Message}");
                if (!forceRefresh && state.LastMetadata != null)
                {
                    metadata = state.LastMetadata;
                }
                else
                {
                    error = ex.Message;
                }
            }

            var currentVersion = GetCurrentVersion();
            bool updateAvailable = false;

            if (metadata != null)
            {
                updateAvailable = IsRemoteNewer(metadata.Version, currentVersion);
                state.LastKnownRemoteVersion = metadata.Version;
                state.LastMetadata = metadata;
            }

            state.LastCheckedUtc = DateTime.UtcNow;
            SaveState(state);

            return new UpdateCheckResult
            {
                Success = metadata != null,
                Error = error,
                CurrentVersion = currentVersion,
                LatestMetadata = metadata,
                UpdateAvailable = updateAvailable,
                CheckedAtUtc = state.LastCheckedUtc
            };
        }

        public async Task<UpdateDownloadResult> DownloadInstallerAsync(UpdateMetadata metadata, Func<UpdateDownloadProgress, Task>? progressCallback = null, CancellationToken cancellationToken = default)
        {
            if (metadata == null || string.IsNullOrWhiteSpace(metadata.DownloadUrl))
            {
                return new UpdateDownloadResult
                {
                    Success = false,
                    Error = "Metadata downloadUrl kosong"
                };
            }

            var uri = new Uri(metadata.DownloadUrl);
            var fileName = GetInstallerFileName(metadata, uri);
            var destinationPath = Path.Combine(_downloadDir, fileName);

            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, uri);
                request.Headers.UserAgent.ParseAdd(USER_AGENT);
                using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
                if (!response.IsSuccessStatusCode)
                {
                    return new UpdateDownloadResult
                    {
                        Success = false,
                        Error = $"HTTP {(int)response.StatusCode}"
                    };
                }

                var totalBytes = response.Content.Headers.ContentLength ?? -1;
                await using var network = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
                await using var file = new FileStream(destinationPath, FileMode.Create, FileAccess.Write, FileShare.Read);

                var buffer = new byte[81920];
                long totalRead = 0;
                int read;
                int lastPercent = -1;

                while ((read = await network.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken).ConfigureAwait(false)) > 0)
                {
                    await file.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
                    totalRead += read;
                    var percent = totalBytes > 0 ? (int)Math.Clamp((totalRead * 100L) / totalBytes, 0, 100) : -1;
                    if (progressCallback != null && percent != lastPercent)
                    {
                        await progressCallback(new UpdateDownloadProgress
                        {
                            BytesReceived = totalRead,
                            TotalBytes = totalBytes,
                            Percent = percent
                        }).ConfigureAwait(false);
                        lastPercent = percent;
                    }
                }

                // Verify hash if provided
                if (!string.IsNullOrWhiteSpace(metadata.Sha256))
                {
                    var hash = await ComputeSha256Async(destinationPath).ConfigureAwait(false);
                    if (!hash.Equals(metadata.Sha256, StringComparison.OrdinalIgnoreCase))
                    {
                        try { File.Delete(destinationPath); } catch { }
                        return new UpdateDownloadResult
                        {
                            Success = false,
                            Error = "Checksum SHA-256 tidak cocok"
                        };
                    }
                }

                var state = LoadState();
                state.LastDownloadedInstallerPath = destinationPath;
                SaveState(state);

                return new UpdateDownloadResult
                {
                    Success = true,
                    InstallerPath = destinationPath,
                    Metadata = metadata
                };
            }
            catch (OperationCanceledException)
            {
                try { if (File.Exists(destinationPath)) File.Delete(destinationPath); } catch { }
                return new UpdateDownloadResult { Success = false, Error = "Download dibatalkan" };
            }
            catch (Exception ex)
            {
                try { if (File.Exists(destinationPath)) File.Delete(destinationPath); } catch { }
                return new UpdateDownloadResult
                {
                    Success = false,
                    Error = ex.Message
                };
            }
        }

        public async Task<UpdateInstallResult> InstallUpdateAsync(UpdateMetadata metadata, Func<UpdateInstallProgress, Task>? progressCallback = null, CancellationToken cancellationToken = default)
        {
            if (metadata == null)
            {
                return new UpdateInstallResult
                {
                    Success = false,
                    Error = "Metadata update tidak tersedia"
                };
            }

            var downloadResult = await DownloadInstallerAsync(metadata, async progress =>
            {
                if (progressCallback != null)
                {
                    await progressCallback(new UpdateInstallProgress
                    {
                        Stage = UpdateInstallStage.Downloading,
                        Percent = progress.Percent,
                        BytesReceived = progress.BytesReceived,
                        TotalBytes = progress.TotalBytes,
                        Message = "Mengunduh installer..."
                    }).ConfigureAwait(false);
                }
            }, cancellationToken).ConfigureAwait(false);

            if (downloadResult == null || !downloadResult.Success || string.IsNullOrWhiteSpace(downloadResult.InstallerPath))
            {
                return new UpdateInstallResult
                {
                    Success = false,
                    Error = downloadResult?.Error ?? "Download installer gagal"
                };
            }

            if (progressCallback != null)
            {
                await progressCallback(new UpdateInstallProgress
                {
                    Stage = UpdateInstallStage.DownloadCompleted,
                    InstallerPath = downloadResult.InstallerPath,
                    Message = "Download selesai, menyiapkan installer..."
                }).ConfigureAwait(false);
            }

            var installResult = await RunInstallerAsync(downloadResult.InstallerPath, progressCallback, cancellationToken).ConfigureAwait(false);
            installResult.Metadata = metadata;
            return installResult;
        }

        private async Task<UpdateInstallResult> RunInstallerAsync(string installerPath, Func<UpdateInstallProgress, Task>? progressCallback, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(installerPath) || !File.Exists(installerPath))
            {
                return new UpdateInstallResult
                {
                    Success = false,
                    Error = "Installer tidak ditemukan",
                    InstallerPath = installerPath
                };
            }

            try
            {
                if (progressCallback != null)
                {
                    await progressCallback(new UpdateInstallProgress
                    {
                        Stage = UpdateInstallStage.Installing,
                        InstallerPath = installerPath,
                        Message = "Menjalankan installer..."
                    }).ConfigureAwait(false);
                }

                var psi = new ProcessStartInfo
                {
                    FileName = installerPath,
                    Arguments = "/VERYSILENT /NORESTART",
                    UseShellExecute = true,
                    WorkingDirectory = Path.GetDirectoryName(installerPath) ?? AppContext.BaseDirectory
                };

                try
                {
                    psi.Verb = "runas";
                }
                catch
                {
                    // Verb not supported - ignore
                }

                using var process = Process.Start(psi);
                if (process == null)
                {
                    return new UpdateInstallResult
                    {
                        Success = false,
                        Error = "Gagal menjalankan installer",
                        InstallerPath = installerPath
                    };
                }

                await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
                var exitCode = process.ExitCode;
                var success = exitCode == 0;

                if (progressCallback != null)
                {
                    await progressCallback(new UpdateInstallProgress
                    {
                        Stage = UpdateInstallStage.Completed,
                        InstallerPath = installerPath,
                        ExitCode = exitCode,
                        Message = success ? "Installer selesai" : $"Installer keluar dengan kode {exitCode}"
                    }).ConfigureAwait(false);
                }

                return new UpdateInstallResult
                {
                    Success = success,
                    InstallerPath = installerPath,
                    ExitCode = exitCode,
                    Error = success ? null : $"Installer keluar dengan kode {exitCode}"
                };
            }
            catch (OperationCanceledException)
            {
                return new UpdateInstallResult
                {
                    Success = false,
                    InstallerPath = installerPath,
                    Error = "Instalasi dibatalkan"
                };
            }
            catch (Exception ex)
            {
                return new UpdateInstallResult
                {
                    Success = false,
                    InstallerPath = installerPath,
                    Error = ex.Message
                };
            }
        }

        private async Task<UpdateMetadata> FetchMetadataAsync(CancellationToken cancellationToken)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, METADATA_URL);
            request.Headers.UserAgent.ParseAdd(USER_AGENT);
            using var response = await Http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            var metadata = JsonSerializer.Deserialize<UpdateMetadata>(json, _jsonOptions);
            if (metadata == null)
            {
                throw new InvalidOperationException("Metadata update tidak valid");
            }
            return metadata;
        }

        private UpdateState LoadState()
        {
            lock (_lock)
            {
                if (_stateCache != null) return _stateCache;
                try
                {
                    if (File.Exists(_statePath))
                    {
                        var json = File.ReadAllText(_statePath);
                        var state = JsonSerializer.Deserialize<UpdateState>(json, _jsonOptions);
                        if (state != null)
                        {
                            _stateCache = state;
                            return state;
                        }
                    }
                }
                catch (Exception ex)
                {
                    LogInfo($"LoadState error: {ex.Message}");
                }
                _stateCache = new UpdateState();
                return _stateCache;
            }
        }

        private void SaveState(UpdateState state)
        {
            lock (_lock)
            {
                try
                {
                    var json = JsonSerializer.Serialize(state, _jsonOptions);
                    File.WriteAllText(_statePath, json);
                    _stateCache = state;
                }
                catch (Exception ex)
                {
                    LogInfo($"SaveState error: {ex.Message}");
                }
            }
        }

        private static bool IsRemoteNewer(string? remote, string? current)
        {
            if (string.IsNullOrWhiteSpace(remote)) return false;
            if (string.IsNullOrWhiteSpace(current)) return true;

            Version? remoteVersion = null;
            Version? currentVersion = null;
            Version.TryParse(remote, out remoteVersion);
            Version.TryParse(current, out currentVersion);

            if (remoteVersion == null || currentVersion == null)
            {
                return !string.Equals(remote, current, StringComparison.OrdinalIgnoreCase);
            }
            return remoteVersion > currentVersion;
        }

        private static string GetCurrentVersion()
        {
            try
            {
                var asm = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;
                return asm?.ToString() ?? "0.0.0";
            }
            catch
            {
                return "0.0.0";
            }
        }

        private static string GetInstallerFileName(UpdateMetadata metadata, Uri uri)
        {
            var remoteName = Path.GetFileName(uri.LocalPath);
            if (!string.IsNullOrWhiteSpace(remoteName))
            {
                var timestampSuffix = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
                var baseName = Path.GetFileNameWithoutExtension(remoteName);
                var ext = Path.GetExtension(remoteName);
                return string.IsNullOrWhiteSpace(baseName)
                    ? $"GameHubSetup-{timestampSuffix}{ext}"
                    : $"{baseName}-{timestampSuffix}{ext}";
            }
            var versionPart = string.IsNullOrWhiteSpace(metadata.Version) ? DateTime.UtcNow.ToString("yyyyMMddHHmmss") : metadata.Version;
            return $"GameHubSetup-{versionPart}.exe";
        }

        private static async Task<string> ComputeSha256Async(string filePath)
        {
            await using var stream = File.OpenRead(filePath);
            using var sha = SHA256.Create();
            var hash = await sha.ComputeHashAsync(stream).ConfigureAwait(false);
            return Convert.ToHexString(hash);
        }

        private void LogInfo(string message)
        {
            try { Log?.Invoke($"[UpdateService] {message}"); } catch { }
        }
    }

    public class UpdateMetadata
    {
        [JsonPropertyName("version")]
        public string? Version { get; set; }

        [JsonPropertyName("publishedAt")]
        public DateTime? PublishedAt { get; set; }

        [JsonPropertyName("downloadUrl")]
        public string? DownloadUrl { get; set; }

        [JsonPropertyName("sha256")]
        public string? Sha256 { get; set; }

        [JsonPropertyName("mandatory")]
        public bool? Mandatory { get; set; }

        [JsonPropertyName("releaseNotes")]
        public string[]? ReleaseNotes { get; set; }
    }

    public class UpdateCheckResult
    {
        public bool Success { get; set; }
        public bool UpdateAvailable { get; set; }
        public string? Error { get; set; }
        public string? CurrentVersion { get; set; }
        public UpdateMetadata? LatestMetadata { get; set; }
        public DateTime? CheckedAtUtc { get; set; }
    }

    public class UpdateDownloadResult
    {
        public bool Success { get; set; }
        public string? Error { get; set; }
        public string? InstallerPath { get; set; }
        public UpdateMetadata? Metadata { get; set; }
    }

    public class UpdateDownloadProgress
    {
        public long BytesReceived { get; set; }
        public long TotalBytes { get; set; }
        public int Percent { get; set; }
    }

    public enum UpdateInstallStage
    {
        Downloading,
        DownloadCompleted,
        Installing,
        Completed
    }

    public class UpdateInstallProgress
    {
        public UpdateInstallStage Stage { get; set; }
        public int? Percent { get; set; }
        public long? BytesReceived { get; set; }
        public long? TotalBytes { get; set; }
        public string? Message { get; set; }
        public string? InstallerPath { get; set; }
        public int? ExitCode { get; set; }
    }

    public class UpdateInstallResult
    {
        public bool Success { get; set; }
        public string? Error { get; set; }
        public string? InstallerPath { get; set; }
        public int? ExitCode { get; set; }
        public UpdateMetadata? Metadata { get; set; }
    }

    public class UpdateState
    {
        public DateTime? LastCheckedUtc { get; set; }
        public string? LastKnownRemoteVersion { get; set; }
        public string? LastDownloadedInstallerPath { get; set; }
        public DateTime? LastPromptUtc { get; set; }
        public UpdateMetadata? LastMetadata { get; set; }
    }

    public class UpdateStateSnapshot
    {
        public DateTime? LastCheckedUtc { get; set; }
        public string? LastKnownRemoteVersion { get; set; }
        public string? LastDownloadedInstallerPath { get; set; }
        public DateTime? LastPromptUtc { get; set; }
    }
}
