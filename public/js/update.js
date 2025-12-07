// Load Games functionality - reload game data dari GitHub (raw data + override)
async function loadGames() {
  const btn = document.getElementById('btn-load-games-settings') || document.getElementById('btn-check-update');
  if (!btn) return;
  
  // Disable button during load
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span><span>Loading...</span>';
  
  try {
    // PERBAIKAN: Force refresh semua data (override, steam data, fix games)
    
    // 1. Force update override data
    if (window.desktopBridge && typeof window.desktopBridge.forceUpdateOverride === 'function') {
      try {
        const result = await window.desktopBridge.forceUpdateOverride();
        // Force update override - result handled silently
      } catch (e) {
        // Force update override error - non-critical
      }
    }
    
    // 2. Clear fix games cache dan force refresh
    if (window.FixGamesPageCache) {
      try {
        window.FixGamesPageCache.clear();
      } catch (e) {
        // Failed to clear cache - non-critical
      }
    }
    // Force refresh fix games data via bridge
    if (window.desktopBridge && typeof window.desktopBridge.getFixGamesData === 'function') {
      try {
        await window.desktopBridge.getFixGamesData(true); // forceRefresh = true
      } catch (e) {
        // Force refresh failed - non-critical
      }
    }
    
    // 2b. Force refresh steam games data via bridge
    if (window.desktopBridge && typeof window.desktopBridge.getSteamGamesData === 'function') {
      try {
        await window.desktopBridge.getSteamGamesData(true); // forceRefresh = true
      } catch (e) {
        // Force refresh failed - non-critical
      }
    }
    
    // 3. Steam data (raw dataset) - PERBAIKAN: Gunakan ETag check, tidak force refresh
    // Untuk steam_data.json.gz yang besar, kita cek ETag dulu
    // Hanya download jika file berubah di server
    // Clear JavaScript cache untuk memastikan data ter-reload
    if (window.GamesPageCache) {
      try {
        window.GamesPageCache.clear();
      } catch (e) {
        // Failed to clear cache - non-critical
      }
    }
    
    // Load steam data dengan ETag check (tidak force refresh)
    // Ini akan cek ETag dulu, jika tidak berubah, gunakan cache
    // Jika berubah, download fresh
    if (typeof refreshGithubRaw === 'function') {
      await refreshGithubRaw(false); // false = gunakan ETag check, tidak force refresh
      if (typeof premiumAlert === 'function') {
        premiumAlert('Game data berhasil dimuat ulang!', 'Berhasil');
      }
    } else if (typeof initGamesPage === 'function') {
      // Fallback: init dengan ETag check
      await initGamesPage();
      if (typeof premiumAlert === 'function') {
        premiumAlert('Game data berhasil dimuat ulang!', 'Berhasil');
      }
    } else {
      throw new Error('Fungsi load games tidak tersedia');
    }
  } catch (e) {
    if (typeof premiumAlert === 'function') {
      premiumAlert('Gagal memuat game data: ' + (e.message || 'Unknown error'), 'Error');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Keep old function name for backward compatibility
async function checkOverrideUpdate() {
  return loadGames();
}

async function forceUpdateOverride() {
  const btn = document.getElementById('btn-load-games-settings') || document.getElementById('btn-check-update');
  if (!btn) return;
  
  // Show loading
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span><span>Updating...</span>';
  
  try {
    if (!window.desktopBridge || typeof window.desktopBridge.forceUpdateOverride !== 'function') {
      if (typeof premiumAlert === 'function') {
        premiumAlert('Bridge tidak tersedia', 'Error');
      }
      return;
    }
    
    const result = await window.desktopBridge.forceUpdateOverride();
    
    if (result.success) {
      // Clear in-memory cache di JS (jika ada) dan reload dataset
      // refreshGithubRaw akan merge dengan override yang sudah ter-update dari disk
      if (typeof refreshGithubRaw === 'function') {
        try {
          // Force reload override dengan memanggil getGlobalOverride(true) via bridge
          // Tapi lebih baik langsung reload dataset karena override sudah ter-update di disk
          await refreshGithubRaw();
          if (typeof premiumAlert === 'function') {
            premiumAlert('Dataset berhasil di-update!', 'Berhasil');
          }
        } catch (e) {
          if (typeof premiumAlert === 'function') {
            premiumAlert('Data berhasil di-update! Aplikasi akan reload...', 'Berhasil');
          }
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        }
      } else {
        // Fallback: reload page
        if (typeof premiumAlert === 'function') {
          premiumAlert('Data berhasil di-update! Aplikasi akan reload...', 'Berhasil');
        }
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      }
    } else {
      if (typeof premiumAlert === 'function') {
        premiumAlert('Gagal update: ' + (result.error || 'Unknown error'), 'Error');
      }
    }
  } catch (e) {
    if (typeof premiumAlert === 'function') {
      premiumAlert('Gagal update: ' + (e.message || 'Unknown error'), 'Error');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Expose globally
window.loadGames = loadGames;
window.checkOverrideUpdate = checkOverrideUpdate; // Backward compatibility

// -----------------------------
// Update Panel (Settings Page)
// -----------------------------
const UpdatePanel = (() => {
  const state = {
    metadata: null,
    updateAvailable: false,
    lastCheckedUtc: null,
    currentVersion: null,
    latestVersion: null,
    lastInstallerPath: null,
    isInstalling: false,
    installStage: null,
    installPercent: null,
    installLabel: '',
    installMessage: '',
    lastError: null,
    autoChecked: false,
    snapshotHydrated: false,
    promptedVersion: null
  };

  const elements = {
    card: null,
    statusPill: null,
    statusText: null,
    currentVersion: null,
    latestVersion: null,
    lastChecked: null,
    releaseSection: null,
    releaseList: null,
    progressWrapper: null,
    progressBar: null,
    progressLabel: null,
    progressValue: null,
    installInfo: null,
    checkButton: null,
    installButton: null
  };

  function cacheElements() {
    const card = document.getElementById('update-card');
    if (!card) {
      elements.card = null;
      return false;
    }

    elements.card = card;
    elements.statusPill = document.getElementById('update-status-pill');
    elements.statusText = document.getElementById('update-status-text');
    elements.currentVersion = document.getElementById('update-current-version');
    elements.latestVersion = document.getElementById('update-latest-version');
    elements.lastChecked = document.getElementById('update-last-checked');
    elements.releaseSection = document.getElementById('update-release-notes');
    elements.releaseList = document.getElementById('update-release-notes-list');
    elements.progressWrapper = document.getElementById('update-progress-wrapper');
    elements.progressBar = document.getElementById('update-progress-bar');
    elements.progressLabel = document.getElementById('update-progress-label');
    elements.progressValue = document.getElementById('update-progress-value');
    elements.installInfo = document.getElementById('update-install-info');
    elements.checkButton = document.getElementById('btn-check-update');
    elements.installButton = document.getElementById('btn-install-update');
    captureButtonDefaults();
    return true;
  }

  function ensureElements() {
    if (elements.card && document.body.contains(elements.card)) {
      return true;
    }
    return cacheElements();
  }

  function captureButtonDefaults() {
    ['checkButton', 'installButton'].forEach((key) => {
      const btn = elements[key];
      if (!btn) return;
      const labelSpan = btn.querySelector('span:last-child');
      if (labelSpan && !btn.dataset.defaultLabel) {
        btn.dataset.defaultLabel = labelSpan.textContent || '';
      }
    });
  }

  function formatVersion(version) {
    if (!version) return '-';
    return version.startsWith('v') ? version : `v${version}`;
  }

  function formatDateTime(value) {
    if (!value) return 'Never';
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 'Never';
      return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) {
      return 'Never';
    }
  }

  function formatBytes(bytes) {
    const num = Number(bytes);
    if (!Number.isFinite(num) || num < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = num;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(precision)} ${units[unitIndex]}`;
  }

  function setStatus(label, variant) {
    if (!elements.statusPill) return;
    const base = 'px-3 py-1 rounded-full text-xs font-semibold border ';
    let theme = 'bg-neutral-700 border-white/10 text-gray-200';
    if (variant === 'success') {
      theme = 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200';
    } else if (variant === 'warning') {
      theme = 'bg-amber-500/20 border-amber-400/40 text-amber-100';
    } else if (variant === 'error') {
      theme = 'bg-red-500/20 border-red-400/40 text-red-100';
    }
    elements.statusPill.className = base + theme;
    elements.statusPill.textContent = label;
  }

  function renderReleaseNotes() {
    if (!elements.releaseSection || !elements.releaseList) return;
    elements.releaseList.innerHTML = '';
    const notes = state.metadata?.releaseNotes;
    if (Array.isArray(notes) && notes.length > 0) {
      elements.releaseSection.classList.remove('hidden');
      notes.forEach((note) => {
        const li = document.createElement('li');
        li.textContent = note;
        elements.releaseList.appendChild(li);
      });
    } else {
      elements.releaseSection.classList.add('hidden');
    }
  }

  function renderProgress() {
    if (!elements.progressWrapper || !elements.progressBar || !elements.progressLabel || !elements.progressValue) return;
    if (state.isInstalling) {
      elements.progressWrapper.classList.remove('hidden');
      const percent = typeof state.installPercent === 'number' && state.installPercent >= 0 ? Math.min(100, Math.max(0, state.installPercent)) : null;
      elements.progressBar.style.width = percent !== null ? `${percent}%` : '14%';
      elements.progressValue.textContent = percent !== null ? `${percent}%` : '...';
      elements.progressLabel.textContent = state.installLabel || 'Menyiapkan pembaruan...';
    } else {
      elements.progressWrapper.classList.add('hidden');
      elements.progressBar.style.width = '0%';
      elements.progressValue.textContent = '0%';
      elements.progressLabel.textContent = 'Ready';
    }
  }

  function renderButtons() {
    const bridgeReady = !!(window.desktopBridge && typeof window.desktopBridge.checkForUpdates === 'function');
    if (elements.checkButton) {
      const label = elements.checkButton.querySelector('span:last-child');
      if (!bridgeReady) {
        elements.checkButton.disabled = true;
      } else if (state.isChecking) {
        elements.checkButton.disabled = true;
        if (label) label.textContent = 'Checking...';
      } else {
        elements.checkButton.disabled = false;
        if (label) label.textContent = elements.checkButton.dataset.defaultLabel || 'Check for Updates';
      }
    }

    if (elements.installButton) {
      const canInstall = !!(window.desktopBridge && typeof window.desktopBridge.installLatestUpdate === 'function' && state.metadata && state.metadata.downloadUrl && state.updateAvailable);
      const label = elements.installButton.querySelector('span:last-child');
      if (!canInstall) {
        elements.installButton.disabled = true;
        if (label) label.textContent = elements.installButton.dataset.defaultLabel || 'Install Update';
      } else if (state.isInstalling) {
        elements.installButton.disabled = true;
        if (label) label.textContent = 'Installing...';
      } else {
        elements.installButton.disabled = false;
        if (label) label.textContent = elements.installButton.dataset.defaultLabel || 'Install Update';
      }
    }
  }

  function renderInstallInfo() {
    if (!elements.installInfo) return;
    const infoText = state.installMessage || (state.lastInstallerPath ? `Installer terakhir: ${state.lastInstallerPath}` : '');
    if (infoText) {
      elements.installInfo.textContent = infoText;
      elements.installInfo.classList.remove('hidden');
    } else {
      elements.installInfo.classList.add('hidden');
      elements.installInfo.textContent = '';
    }
  }

  function render() {
    if (!ensureElements()) return;
    if (elements.currentVersion) {
      elements.currentVersion.textContent = formatVersion(state.currentVersion);
    }
    if (elements.latestVersion) {
      elements.latestVersion.textContent = formatVersion(state.latestVersion || state.metadata?.version);
    }
    if (elements.lastChecked) {
      elements.lastChecked.textContent = formatDateTime(state.lastCheckedUtc);
    }

    if (state.lastError) {
      setStatus('Check failed', 'error');
      if (elements.statusText) {
        elements.statusText.textContent = `Gagal cek update: ${state.lastError}`;
      }
    } else if (state.updateAvailable && state.metadata?.version) {
      setStatus('Update available', 'warning');
      if (elements.statusText) {
        elements.statusText.textContent = `Versi ${formatVersion(state.metadata.version)} sudah tersedia. Klik "Install Update" untuk langsung memasang versi terbaru.`;
      }
    } else if (state.lastCheckedUtc) {
      setStatus('Up to date', 'success');
      if (elements.statusText) {
        elements.statusText.textContent = `Sudah menggunakan versi terbaru. Terakhir dicek pada ${formatDateTime(state.lastCheckedUtc)}.`;
      }
    } else {
      setStatus('Not checked', 'neutral');
      if (elements.statusText) {
        elements.statusText.textContent = 'Belum ada informasi update terbaru. Klik tombol di bawah untuk memulai pengecekan.';
      }
    }

    renderReleaseNotes();
    renderProgress();
    renderButtons();
    renderInstallInfo();
  }

  async function hydrateSnapshot() {
    if (!window.desktopBridge || typeof window.desktopBridge.getUpdateState !== 'function') {
      state.lastError = 'Bridge tidak tersedia';
      render();
      return;
    }
    try {
      const snapshot = await window.desktopBridge.getUpdateState();
      state.lastCheckedUtc = snapshot?.lastCheckedUtc || null;
      state.latestVersion = snapshot?.lastKnownRemoteVersion || state.latestVersion;
      state.lastInstallerPath = snapshot?.lastDownloadedInstallerPath || state.lastInstallerPath;
      state.snapshotHydrated = true;
      render();
    } catch (error) {
      state.lastError = error?.message || 'Gagal mengambil status update';
      render();
    }
  }

  async function checkForUpdates({ forceRefresh = true, silent = false } = {}) {
    if (!window.desktopBridge || typeof window.desktopBridge.checkForUpdates !== 'function') {
      if (!silent && typeof premiumAlert === 'function') {
        premiumAlert('Bridge tidak tersedia', 'Error');
      }
      return;
    }
    if (!ensureElements()) {
      mount();
    }
    state.isChecking = true;
    state.lastError = null;
    render();
    try {
      const result = await window.desktopBridge.checkForUpdates(forceRefresh);
      if (!result || result.success === false) {
        const errorMessage = result?.error || 'Unknown error';
        state.lastError = errorMessage;
        state.updateAvailable = false;
        if (!silent && typeof premiumAlert === 'function') {
          premiumAlert(`Gagal cek update: ${errorMessage}`, 'Error');
        }
      } else {
        state.currentVersion = result.currentVersion || state.currentVersion;
        state.latestVersion = result.latestVersion || result.metadata?.version || state.latestVersion;
        state.metadata = result.metadata || state.metadata;
        state.updateAvailable = !!(result.updateAvailable && state.metadata);
        state.lastCheckedUtc = result.checkedAtUtc || new Date().toISOString();
        state.lastError = null;
        if (!state.updateAvailable) {
          state.promptedVersion = null;
        }
        if (state.updateAvailable) {
          maybePromptInstall(silent);
        } else if (!silent && typeof premiumAlert === 'function') {
          premiumAlert('GameHub sudah versi terbaru.', 'Up to date');
        }
      }
    } catch (error) {
      state.lastError = error?.message || 'Gagal cek update';
      state.updateAvailable = false;
      if (!silent && typeof premiumAlert === 'function') {
        premiumAlert(`Gagal cek update: ${state.lastError}`, 'Error');
      }
    } finally {
      state.isChecking = false;
      render();
    }
  }

  function updateInstallProgress(progress) {
    if (!progress) return;
    const stage = (progress.stage || '').toLowerCase();
    if (stage === 'downloading') {
      state.installStage = 'downloading';
      state.installPercent = typeof progress.percent === 'number' ? progress.percent : null;
      const received = formatBytes(progress.bytesReceived || 0);
      const total = progress.totalBytes > 0 ? formatBytes(progress.totalBytes) : null;
      state.installLabel = total ? `Mengunduh ${received} / ${total}` : `Mengunduh ${received}`;
    } else if (stage === 'downloadcompleted') {
      state.installStage = 'verifying';
      state.installPercent = 100;
      state.installLabel = 'Download selesai, menyiapkan installer...';
    } else if (stage === 'installing') {
      state.installStage = 'installing';
      state.installPercent = null;
      state.installLabel = 'Menjalankan installer...';
    } else if (stage === 'completed') {
      state.installStage = 'completed';
      state.installPercent = progress.exitCode === 0 ? 100 : null;
      state.installLabel = progress.exitCode === 0 ? 'Installer selesai' : `Installer selesai dengan kode ${progress.exitCode}`;
    }

    if (progress.message) {
      state.installLabel = progress.message;
    }
    renderProgress();
  }

  function buildInstallPromptMessage() {
    if (!state.metadata) return 'Update tersedia.';
    const versionText = formatVersion(state.metadata.version || state.latestVersion);
    const lines = [`Versi ${versionText} siap dipasang.`];
    if (state.metadata.publishedAt) {
      try {
        const published = new Date(state.metadata.publishedAt);
        if (!Number.isNaN(published.getTime())) {
          lines.push(`Dirilis pada ${published.toLocaleString()}.`);
        }
      } catch (e) {
        // ignore
      }
    }
    if (Array.isArray(state.metadata.releaseNotes) && state.metadata.releaseNotes.length > 0) {
      const notes = state.metadata.releaseNotes.map((note) => `• ${note}`);
      lines.push('Catatan rilis:\n' + notes.join('\n'));
    }
    lines.push('GameHub akan mengunduh installer resmi dan menjalankannya secara otomatis. Simpan pekerjaan Anda sebelum melanjutkan.');
    return lines.join('\n\n');
  }

  async function performInstall() {
    if (!ensureElements()) {
      mount();
    }
    if (!window.desktopBridge || typeof window.desktopBridge.installLatestUpdate !== 'function') {
      if (typeof premiumAlert === 'function') {
        premiumAlert('Bridge tidak tersedia', 'Error');
      }
      return null;
    }
    if (!state.metadata || !state.metadata.downloadUrl) {
      if (typeof premiumAlert === 'function') {
        premiumAlert('Metadata update belum tersedia. Cek update terlebih dahulu.', 'Info');
      }
      return null;
    }

    state.isInstalling = true;
    state.lastError = null;
    state.installStage = 'downloading';
    state.installPercent = 0;
    state.installLabel = 'Mengunduh pembaruan...';
    state.installMessage = '';
    render();

    try {
      const result = await window.desktopBridge.installLatestUpdate(state.metadata, (progress) => {
        updateInstallProgress(progress);
      });

      if (!result || result.success === false) {
        const errorMessage = result?.error || 'Install gagal';
        state.lastError = errorMessage;
        state.installMessage = '';
        if (typeof premiumAlert === 'function') {
          premiumAlert(`Install gagal: ${errorMessage}`, 'Error');
        }
      } else {
        state.lastInstallerPath = result.installerPath || state.lastInstallerPath;
        state.installMessage = 'Update berhasil dipasang. Tutup dan buka ulang GameHub untuk memakai versi terbaru.';
        state.lastError = null;
        if (typeof premiumAlert === 'function') {
          premiumAlert('Update berhasil dipasang! GameHub akan tetap berjalan hingga Anda menutupnya.', 'Berhasil');
        }
      }

      return result;
    } catch (error) {
      state.lastError = error?.message || 'Install gagal';
      state.installMessage = '';
      if (typeof premiumAlert === 'function') {
        premiumAlert(`Install gagal: ${state.lastError}`, 'Error');
      }
      throw error;
    } finally {
      state.isInstalling = false;
      state.installStage = null;
      state.installPercent = null;
      state.installLabel = '';
      render();
    }
  }

  async function requestInstall({ skipConfirm = false, autoPrompt = false } = {}) {
    if (!state.metadata || !state.updateAvailable) {
      if (!autoPrompt && typeof premiumAlert === 'function') {
        premiumAlert('Belum ada update yang bisa dipasang.', 'Info');
      }
      return false;
    }
    if (state.isInstalling) {
      if (!autoPrompt && typeof premiumAlert === 'function') {
        premiumAlert('Update sedang diproses. Tunggu hingga selesai.', 'Info');
      }
      return false;
    }

    if (!skipConfirm) {
      const accepted = await premiumConfirm(buildInstallPromptMessage(), 'Update tersedia');
      if (!accepted) {
        return false;
      }
    }

    try {
      await performInstall();
      return true;
    } catch (e) {
      return false;
    }
  }

  function maybePromptInstall(silentMode) {
    if (!state.updateAvailable || !state.metadata?.version) return;
    if (silentMode) {
      if (typeof showPremiumToast === 'function') {
        showPremiumToast(`Versi ${formatVersion(state.metadata.version)} siap dipasang. Buka Settings untuk memasang.`, 0, 'info');
      }
      return;
    }

    if (state.promptedVersion === state.metadata.version) {
      return;
    }
    state.promptedVersion = state.metadata.version;
    requestInstall({ skipConfirm: false, autoPrompt: true });
  }

  function scheduleAutoCheck() {
    if (state.autoChecked) return;
    state.autoChecked = true;
    setTimeout(() => {
      checkForUpdates({ forceRefresh: false, silent: true });
    }, 800);
  }

  function mount() {
    if (!ensureElements()) {
      return false;
    }
    render();
    if (!state.snapshotHydrated) {
      hydrateSnapshot().then(() => {
        scheduleAutoCheck();
      });
    }
    return true;
  }

  function init(retry = 0) {
    if (mount()) return;
    if (retry < 5) {
      setTimeout(() => init(retry + 1), 200);
    }
  }

  return {
    init,
    mount,
    manualCheck: () => checkForUpdates({ forceRefresh: true, silent: false }),
    install: () => requestInstall({ skipConfirm: false })
  };
})();

function handleCheckUpdate() {
  if (UpdatePanel && typeof UpdatePanel.manualCheck === 'function') {
    UpdatePanel.manualCheck();
  }
}

function handleInstallUpdate() {
  if (UpdatePanel && typeof UpdatePanel.install === 'function') {
    UpdatePanel.install();
  }
}

window.handleCheckUpdate = handleCheckUpdate;
window.handleInstallUpdate = handleInstallUpdate;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => UpdatePanel.init());
} else {
  UpdatePanel.init();
}

window.GameHubUpdatePanel = UpdatePanel;
