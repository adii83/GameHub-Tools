// Fix Games Detail Page Logic

let currentFixGame = null;
let currentAppId = null;
let currentAccountId = null;
let isProcessing = false;
let lastAntivirusResult = null;
const REPORT_LIMIT_STORAGE_KEY = 'steamAccountReportLimits';
const REPORT_LIMIT_MAX_PER_DAY = 2;
let reportLimitFallbackCache = {};

function readReportLimitMap() {
  try {
    if (typeof window.localStorage === 'undefined') {
      return reportLimitFallbackCache;
    }
    const raw = window.localStorage.getItem(REPORT_LIMIT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return {};
  } catch {
    return reportLimitFallbackCache;
  }
}

function writeReportLimitMap(map) {
  try {
    if (typeof window.localStorage === 'undefined') {
      reportLimitFallbackCache = map;
      return;
    }
    window.localStorage.setItem(REPORT_LIMIT_STORAGE_KEY, JSON.stringify(map));
  } catch {
    reportLimitFallbackCache = map;
  }
}

function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

function normalizeSteamAccountGames(games) {
  if (!Array.isArray(games)) return;
  games.forEach((game, index) => {
    if (!game || typeof game !== 'object') return;
    game.category = 'steam-account';
    if (game.premium === undefined) {
      game.premium = false;
    }
    const fallback = `${game.appid || 'steam'}-${index}`;
    game.accountId = String(game.accountId || game.username || fallback);
  });
}

function selectSteamAccountGame(games, appidNum, accountId) {
  if (!Array.isArray(games)) return null;
  const normalizedAccountId = accountId ? String(accountId) : null;
  for (const game of games) {
    if (!game) continue;
    const gAppid = typeof game.appid === 'string' ? parseInt(game.appid, 10) : game.appid;
    if (gAppid !== appidNum) continue;
    if (!normalizedAccountId) return game;
    const candidateId = String(game.accountId || game.username || '');
    if (candidateId === normalizedAccountId) {
      return game;
    }
  }
  return null;
}

// Initialize detail page
async function initFixGameDetailPage(appid, isSteamAccount = false, accountId = null) {
  currentAppId = appid;
  currentAccountId = accountId ? String(accountId) : null;
  isProcessing = false;
  
  try {
    // Normalize appid to number untuk comparison
    const appidNum = typeof appid === 'string' ? parseInt(appid, 10) : appid;
    
    if (isNaN(appidNum)) {
      alert('AppID tidak valid!');
      navigate('fix-games');
      return;
    }
    
    // Load game data
    let gameData = null;
    
    if (isSteamAccount) {
      // Load from steam_games.json
      let retryCount = 0;
      const maxRetries = 5;
      
      while (!gameData && retryCount < maxRetries) {
        if (typeof window.steamGamesData !== 'undefined' && Array.isArray(window.steamGamesData) && window.steamGamesData.length > 0) {
          gameData = selectSteamAccountGame(window.steamGamesData, appidNum, currentAccountId);
        }
        
        if (gameData) break;
        
        if (retryCount < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        retryCount++;
      }
      
      // Fallback: load from GitHub
      if (!gameData) {
        const STEAM_GAMES_URL = 'https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/steam_games/steam_games.json';
        try {
          const response = await fetch(STEAM_GAMES_URL, { cache: 'no-store' });
          if (response.ok) {
            const json = await response.json();
            if (Array.isArray(json)) {
              normalizeSteamAccountGames(json);
              window.steamGamesData = json;
              gameData = selectSteamAccountGame(json, appidNum, currentAccountId);
            }
          }
        } catch (e) {
          // Error loading game data - handled silently
        }
      }
    } else {
      // Load from fix_games.json (existing logic)
      let retryCount = 0;
      const maxRetries = 5;
      
      while (!gameData && retryCount < maxRetries) {
        if (typeof window.fixGamesData !== 'undefined' && Array.isArray(window.fixGamesData) && window.fixGamesData.length > 0) {
          gameData = window.fixGamesData.find(g => {
            const gAppid = typeof g.appid === 'string' ? parseInt(g.appid, 10) : g.appid;
            return gAppid === appidNum;
          });
        }
        
        if (gameData) break;
        
        if (retryCount < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        retryCount++;
      }
      
      // Fallback: load from GitHub
      if (!gameData) {
        const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/adii83/steam-metadata-archive/refs/heads/main/fix_games.json';
        try {
          const response = await fetch(GITHUB_RAW_URL, { cache: 'no-store' });
          if (response.ok) {
            const json = await response.json();
            if (json && json.games && Array.isArray(json.games)) {
              gameData = json.games.find(g => {
                const gAppid = typeof g.appid === 'string' ? parseInt(g.appid, 10) : g.appid;
                return gAppid === appidNum;
              });
            }
          }
        } catch (e) {
          // Error loading game data - handled silently
        }
      }
    }
    
    if (!gameData) {
      alert(`Game tidak ditemukan! AppID: ${appidNum}`);
      navigate('fix-games');
      return;
    }
    
    currentFixGame = gameData;
    
    // Render based on category
    if (isSteamAccount) {
      renderSteamAccountDetail(gameData);
    } else {
      renderFixGameDetail(gameData);
    }
  } catch (e) {
    alert('Gagal memuat detail game!');
    navigate('fix-games');
  }
}

// Render game detail info
function renderFixGameDetail(game) {
  // Poster
  const poster = document.getElementById('fix-detail-poster');
  if (poster) {
    poster.src = game.poster || '';
    poster.alt = game.title || '';
  }
  
  // Title
  const title = document.getElementById('fix-detail-title');
  if (title) {
    title.textContent = game.title || 'Unknown';
  }
  
  // Premium Badge
  const premiumBadge = document.getElementById('fix-detail-premium-badge');
  if (premiumBadge) {
    const isPremium = game.premium === true;
    if (isPremium) {
      premiumBadge.textContent = 'PREMIUM';
      premiumBadge.className = 'bg-yellow-500 text-black text-xs px-3 py-1 rounded font-semibold';
      premiumBadge.classList.remove('hidden');
    } else {
      premiumBadge.textContent = 'STANDARD';
      premiumBadge.className = 'bg-gray-600 text-white text-xs px-3 py-1 rounded font-semibold';
      premiumBadge.classList.remove('hidden');
    }
  }
  
  // Publisher
  const publisher = document.getElementById('fix-detail-publisher');
  if (publisher) {
    publisher.textContent = game.publisher || '';
  }
  
  // AppID
  const appid = document.getElementById('fix-detail-appid');
  if (appid) {
    appid.textContent = `AppID: ${game.appid}`;
  }
  
}

// Start fix game process (runs in background)
async function startFixGameProcess() {
  if (!currentFixGame) {
    alert('Game data tidak tersedia!');
    return;
  }
  
  if (isProcessing) {
    return; // Prevent multiple clicks
  }
  
  isProcessing = true;
  
  const startBtn = document.getElementById('fix-game-start-btn');
  const btnText = document.getElementById('fix-btn-text');
  const btnSpinner = document.getElementById('fix-btn-spinner');
  const progressContainer = document.getElementById('fix-progress-container');
  const progressBar = document.getElementById('fix-progress-bar');
  const progressText = document.getElementById('fix-progress-text');
  
  // Update button state
  if (startBtn) startBtn.disabled = true;
  if (btnText) btnText.textContent = 'Memproses...';
  if (btnSpinner) btnSpinner.classList.remove('hidden');
  if (progressContainer) progressContainer.classList.remove('hidden');
  
  try {
    // Step 1: Check Antivirus (background) - non-blocking, continue even if error
    updateProgress(10, 'Memeriksa antivirus...');
    try {
      await checkAntivirus();
    } catch (e) {
      if (e && (e.code === 'THIRD_PARTY_AV_BLOCKED' || e.message?.includes('antivirus pihak ketiga'))) {
        throw e;
      }
      // Antivirus check error (non-fatal) - lanjut jika hanya kegagalan teknis
    }
    
    // Step 2: Detect Path (background)
    updateProgress(20, 'Mencari lokasi instalasi game...');
    let gamePath;
    try {
      gamePath = await detectGamePath();
    } catch (e) {
      // Error sudah memiliki pesan yang jelas dari detectGamePath
      throw e;
    }
    
    if (!gamePath) {
      // Hapus error message - langsung buka modal manual path selection
      // throw new Error('Game mungkin belum Anda install atau tidak ditemukan di Steam library. Silakan cari folder game secara manual atau pastikan game sudah terinstall di Steam.');
      // Langsung buka modal untuk pilih folder manual
      const manualPath = await new Promise((resolve, reject) => {
        openManualPathModal('Game mungkin belum Anda install atau tidak ditemukan di Steam library. Silakan cari folder game secara manual atau pastikan game sudah terinstall di Steam.')
          .then(resolve)
          .catch(reject);
      });
      if (!manualPath) {
        throw new Error('Anda belum memilih folder game.');
      }
      return manualPath;
    }
    
    // Step 3: Auto-Exclude (background)
    updateProgress(30, 'Menambahkan ke exclusion list...');
    try {
      const excludeResult = await autoExcludePath(gamePath);
      const defenderMissing = excludeResult && excludeResult.defenderMissing === true;
      const needsAdmin = excludeResult && (excludeResult.needsAdmin === true || excludeResult.needsAdmin === 'true');

      if (defenderMissing) {
        updateProgress(40, 'Windows Defender tidak tersedia, melewati langkah exclusion...');
        alert(
          'ℹ️ Windows Defender tidak terpasang atau dinonaktifkan di perangkat ini sehingga langkah exclusion dilewati. Pastikan antivirus lain tidak menghapus file fix secara otomatis.'
        );
      } else {
        if (excludeResult && !excludeResult.success) {
          if (needsAdmin) {
            alert(
              '⚠️ Perhatian!\n\n' +
              'Aplikasi perlu dijalankan sebagai Administrator untuk menambahkan folder game ke Windows Defender exclusion list.\n\n' +
              'Tanpa ini, Windows Defender mungkin akan menghapus file game lagi setelah proses fix selesai.\n\n' +
              'Silakan tutup aplikasi ini, jalankan sebagai Administrator, dan mulai ulang proses fix.'
            );
            throw new Error('Jalankan Aplikasi dengan Run Administrator dan Mulai Ulang');
          } else {
            throw new Error(excludeResult.error || 'Gagal menambahkan ke exclusion list');
          }
        }

        if (!excludeResult || (excludeResult.success !== true && needsAdmin)) {
          if (needsAdmin) {
            alert(
              '⚠️ Perhatian!\n\n' +
              'Aplikasi perlu dijalankan sebagai Administrator untuk menambahkan folder game ke Windows Defender exclusion list.\n\n' +
              'Tanpa ini, Windows Defender mungkin akan menghapus file game lagi setelah proses fix selesai.\n\n' +
              'Silakan tutup aplikasi ini, jalankan sebagai Administrator, dan mulai ulang proses fix.'
            );
            throw new Error('Jalankan Aplikasi dengan Run Administrator dan Mulai Ulang');
          }
        }
      }
    } catch (e) {
      if (e.message && e.message.includes('Jalankan Aplikasi dengan Run Administrator')) {
        throw e;
      }

      if (e.message && (e.message.includes('Administrator') || e.message.includes('admin'))) {
        alert(
          '⚠️ Perhatian!\n\n' +
          'Aplikasi perlu dijalankan sebagai Administrator untuk menambahkan folder game ke Windows Defender exclusion list.\n\n' +
          'Tanpa ini, Windows Defender mungkin akan menghapus file game lagi setelah proses fix selesai.\n\n' +
          'Silakan tutup aplikasi ini, jalankan sebagai Administrator, dan mulai ulang proses fix.'
        );
        throw new Error('Jalankan Aplikasi dengan Run Administrator dan Mulai Ulang');
      } else {
        throw e;
      }
    }
    
    // Step 4: Download (background)
    updateProgress(40, 'Mengunduh file fix...');
    const downloadResult = await downloadFixFiles((progress) => {
      const percent = (progress && typeof progress.percent === 'number') ? progress.percent : 0;
      const currentFile = progress && typeof progress.currentFile === 'number' ? progress.currentFile : 0;
      const totalFiles = progress && typeof progress.totalFiles === 'number' ? progress.totalFiles : 0;
      const filename = progress && progress.filename ? String(progress.filename) : '';

      // Update progress: 40% - 70% untuk download
      const downloadProgress = 40 + (percent * 0.3);

      let label = 'Mengunduh file...';
      if (totalFiles > 0 && currentFile > 0) {
        label = `Mengunduh file ${currentFile}/${totalFiles}`;
      }
      // Jangan tampilkan nama file RAR untuk privasi
      // const detail = filename ? ` • ${filename}` : '';

      updateProgress(downloadProgress, `${label} • ${Math.round(percent)}%`);
    });
    
    // Step 5: Extract (background)
    updateProgress(70, 'Mengekstrak file...');
    const extractResult = await extractFiles(downloadResult.downloadPath, downloadResult.files, currentFixGame.password, gamePath, (percent) => {
      // Update progress: 70% - 85% untuk extract
      const extractProgress = 70 + (percent * 0.15);
      updateProgress(extractProgress, `Mengekstrak file... ${Math.round(percent)}%`);
    });
    
    // Step 6: Replace (background)
    updateProgress(85, 'Mengganti file game...');
    await replaceFiles(gamePath, extractResult.extractedPath, (percent) => {
      // Update progress: 85% - 100% untuk replace
      const replaceProgress = 85 + (percent * 0.15);
      updateProgress(replaceProgress, `Mengganti file... ${Math.round(percent)}%`);
    });
    
    // Step 7: Cleanup temporary files (download and extracted)
    updateProgress(98, 'Membersihkan file temporary...');
    try {
      await cleanupTempFiles(downloadResult.downloadPath, extractResult.extractedPath);
    } catch (e) {
      // Non-fatal error - continue
    }
    
    // Success
    updateProgress(100, 'Selesai!');
    setTimeout(() => {
      showSuccessMessage();
      resetButtonState();
    }, 500);
    
  } catch (e) {
    // Error handled by UI
    resetButtonState();
  }
}

// Update progress (simple UI)
function updateProgress(percent, message) {
  const progressBar = document.getElementById('fix-progress-bar');
  const progressText = document.getElementById('fix-progress-text');
  
  if (progressBar) {
    progressBar.style.width = Math.min(100, Math.max(0, percent)) + '%';
  }
  
  if (progressText) {
    progressText.textContent = message || 'Memproses...';
  }
}

// Reset button state
function resetButtonState() {
  isProcessing = false;
  
  const startBtn = document.getElementById('fix-game-start-btn');
  const btnText = document.getElementById('fix-btn-text');
  const btnSpinner = document.getElementById('fix-btn-spinner');
  const progressContainer = document.getElementById('fix-progress-container');
  
  if (startBtn) startBtn.disabled = false;
  if (btnText) btnText.textContent = '🛠️ Mulai Proses Fix';
  if (btnSpinner) btnSpinner.classList.add('hidden');
  if (progressContainer) progressContainer.classList.add('hidden');
  
  // Reset progress
  updateProgress(0, '');
}

// Step 1: Check Antivirus (background)
async function checkAntivirus() {
  lastAntivirusResult = null;
  try {
    if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout: Check antivirus tidak merespon'));
        }, 30000);

        const handler = async (msg) => {
          if (msg?.type === 'FixGamesAntivirusCheck') {
            clearTimeout(timeout);
            window.desktopBridge.offMessage(handler);

            if (!msg.success) {
              reject(new Error(msg.error || 'Gagal memeriksa antivirus'));
              return;
            }

            if (msg.hasOtherAntivirus) {
              const avList = Array.isArray(msg.otherAntivirus) && msg.otherAntivirus.length
                ? msg.otherAntivirus
                : ['antivirus pihak ketiga'];
              const allow = await confirmThirdPartyAntivirus(avList);
              if (!allow) {
                const err = new Error('Proses dihentikan karena antivirus pihak ketiga terdeteksi.');
                err.code = 'THIRD_PARTY_AV_BLOCKED';
                reject(err);
                return;
              }
            }
            lastAntivirusResult = msg;
            resolve(msg);
          }
        };

        window.desktopBridge.onMessage(handler);
        window.desktopBridge.send('FixGamesCheckAntivirus', {});
      });
    } else {
      // Fallback untuk testing
      await new Promise(resolve => setTimeout(resolve, 500));
      lastAntivirusResult = { hasWindowsDefender: true, hasOtherAntivirus: false };
    }
  } catch (e) {
    throw new Error('Gagal memeriksa antivirus: ' + e.message);
  }
}

async function confirmThirdPartyAntivirus(avList) {
  const readableList = avList.join(', ');
  const message = `Antivirus pihak ketiga terdeteksi: ${readableList}.
Game mungkin tidak berjalan dengan benar selama antivirus ini aktif.

Sebaiknya uninstall dan gunakan Windows Defender saja.

Tetap lanjut?`;

  if (typeof premiumConfirm === 'function') {
    try {
      return await premiumConfirm(message, 'Antivirus Terdeteksi');
    } catch {
      return false;
    }
  }

  return window.confirm(message);
}

// Step 2: Auto-Exclude (background)
async function autoExcludePath(gamePath) {
  try {
    if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout: Auto-exclude tidak merespon'));
        }, 30000);

        const handler = (msg) => {
          if (msg.type === 'FixGamesAutoExclude') {
            clearTimeout(timeout);
            window.desktopBridge.offMessage(handler);
            
            // Return result object (bukan throw) agar caller bisa handle needsAdmin
            resolve(msg);
          }
        };

        window.desktopBridge.onMessage(handler);
        window.desktopBridge.send('FixGamesAutoExclude', { gamePath });
      });
    } else {
      // Fallback untuk testing
      return { success: true, isAdmin: false, needsAdmin: false, defenderMissing: false };
    }
  } catch (e) {
    throw new Error('Gagal menambahkan ke exclusion list: ' + e.message);
  }
}

// Step 3: Detect Game Path (background)
async function detectGamePath() {
  try {
    if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout: Detect path tidak merespon'));
        }, 30000);

        const handler = (data) => {
          try {
            // bridge.js passes evt.data directly to handler (see bridge.js line 18: handler?.(evt?.data))
            // data is already the parsed object from WebView2 message
            const msg = typeof data === 'string' ? JSON.parse(data) : data;
            
            // Check if this is the response we're waiting for
            if (msg && msg.type === 'FixGamesDetectPath') {
              clearTimeout(timeout);
              window.desktopBridge.offMessage(handler);
              
              if (!msg.success && (msg.needsManualSelection || msg.gameNotInstalled)) {
                // Game belum terinstall atau path tidak ditemukan → tawarkan pilih folder manual via modal
                const baseMessage = msg.message || 
                  'Game mungkin belum Anda install atau tidak ditemukan di Steam library. Silakan cari folder game secara manual atau pastikan game sudah terinstall di Steam.';
                
                openManualPathModal(baseMessage)
                  .then((manualPath) => {
                    resolve(manualPath);
                  })
                  .catch((err) => {
                    reject(err instanceof Error ? err : new Error(String(err || baseMessage)));
                  });
                return;
              }
              
              if (!msg.success) {
                reject(new Error(msg.error || 'Gagal mendeteksi path instalasi'));
                return;
              }

              if (msg.path) {
                resolve(msg.path);
              } else {
                reject(new Error('Path tidak ditemukan dalam response'));
              }
            }
          } catch (e) {
            // Don't reject here - let timeout handle it if message is wrong type
          }
        };

        // Register handler BEFORE sending request
        window.desktopBridge.onMessage(handler);
        
        // Send request
        try {
          window.desktopBridge.send('FixGamesDetectPath', {
            appid: currentAppId,
            gameTitle: currentFixGame?.title || ''
          });
        } catch (e) {
          clearTimeout(timeout);
          window.desktopBridge.offMessage(handler);
          reject(new Error('Gagal mengirim request: ' + e.message));
        }
      });
    } else {
      // Fallback untuk testing
      const gameName = currentFixGame.title || 'game';
      return `C:\\Program Files (x86)\\Steam\\steamapps\\common\\${gameName}`;
    }
  } catch (e) {
    throw new Error('Gagal mendeteksi path instalasi: ' + e.message);
  }
}

// ===== MANUAL PATH SELECTION MODAL =====

let _manualPathResolve = null;
let _manualPathReject = null;
let _manualPathMessage = '';

function openManualPathModal(message) {
  _manualPathMessage = message || 'Game mungkin belum Anda install atau tidak ditemukan di Steam library. Silakan cari folder game secara manual atau pastikan game sudah terinstall di Steam.';
  
  const modal = document.getElementById('fix-path-modal');
  const msgEl = document.getElementById('fix-path-modal-message');
  if (msgEl) {
    msgEl.textContent = _manualPathMessage;
  }
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  return new Promise((resolve, reject) => {
    _manualPathResolve = resolve;
    _manualPathReject = reject;
  });
}

function closeManualPathModal() {
  const modal = document.getElementById('fix-path-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

async function selectManualGamePath() {
  if (!window.desktopBridge || typeof window.desktopBridge.send !== 'function') {
    throw new Error('Desktop bridge tidak tersedia untuk memilih folder game.');
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (window.desktopBridge && typeof window.desktopBridge.offMessage === 'function') {
        window.desktopBridge.offMessage(handler);
      }
      reject(new Error('Timeout: Pemilihan folder game tidak merespon'));
    }, 60000);

    const handler = (msg) => {
      try {
        if (msg.type === 'FixGamesManualPathSelected') {
          clearTimeout(timeout);
          if (window.desktopBridge && typeof window.desktopBridge.offMessage === 'function') {
            window.desktopBridge.offMessage(handler);
          }

          if (!msg.success || !msg.path) {
            reject(new Error('Anda belum memilih folder game.'));
            return;
          }

          resolve(msg.path);
        }
      } catch (e) {
        clearTimeout(timeout);
        if (window.desktopBridge && typeof window.desktopBridge.offMessage === 'function') {
          window.desktopBridge.offMessage(handler);
        }
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };

    window.desktopBridge.onMessage(handler);
    try {
      window.desktopBridge.send('FixGamesSelectManualPath', {});
    } catch (e) {
      clearTimeout(timeout);
      if (window.desktopBridge && typeof window.desktopBridge.offMessage === 'function') {
        window.desktopBridge.offMessage(handler);
      }
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

async function onFixPathChooseManual() {
  const btnChoose = document.getElementById('fix-path-choose-btn');
  const btnCancel = document.getElementById('fix-path-cancel-btn');
  
  if (btnChoose) btnChoose.disabled = true;
  if (btnCancel) btnCancel.disabled = true;

  try {
    const manualPath = await selectManualGamePath();
    closeManualPathModal();
    if (_manualPathResolve) {
      _manualPathResolve(manualPath);
    }
  } catch (e) {
    closeManualPathModal();
    if (_manualPathReject) {
      _manualPathReject(e instanceof Error ? e : new Error(String(e)));
    }
  } finally {
    if (btnChoose) btnChoose.disabled = false;
    if (btnCancel) btnCancel.disabled = false;
    _manualPathResolve = null;
    _manualPathReject = null;
    _manualPathMessage = '';
  }
}

function onFixPathCancel() {
  closeManualPathModal();
  if (_manualPathReject) {
    // Hapus error message - hanya reject tanpa popup
    const err = new Error('Anda belum memilih folder game.');
    _manualPathReject(err);
  }
  _manualPathResolve = null;
  _manualPathReject = null;
  _manualPathMessage = '';
}

// Step 4: Download Files (background)
async function downloadFixFiles(progressCallback) {
  try {
    if (!currentFixGame.files || currentFixGame.files.length === 0) {
      throw new Error('Tidak ada file untuk di-download!');
    }
    
    if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout: Download tidak merespon'));
        }, 600000); // 10 minutes timeout

        let downloadResult = null;

        const handler = (msg) => {
          if (msg.type === 'FixGamesDownloadProgress') {
            if (progressCallback) {
              // Kirim seluruh objek progress agar UI bisa menampilkan info file/urutan
              progressCallback(msg);
            }
          } else if (msg.type === 'FixGamesDownloadComplete') {
            clearTimeout(timeout);
            window.desktopBridge.offMessage(handler);
            downloadResult = msg;
            resolve(msg);
          } else if (msg.type === 'FixGamesDownloadError') {
            clearTimeout(timeout);
            window.desktopBridge.offMessage(handler);
            reject(new Error(msg.error || 'Gagal mengunduh file'));
          }
        };

        window.desktopBridge.onMessage(handler);
        window.desktopBridge.send('FixGamesDownload', {
          appid: currentAppId,
          files: currentFixGame.files
        });
      });
    } else {
      // Fallback untuk testing - simulasi progress
      for (let i = 0; i <= 100; i += 10) {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (progressCallback) progressCallback(i);
      }
      return { success: true, files: [], downloadPath: '' };
    }
  } catch (e) {
    throw new Error('Gagal mengunduh file: ' + e.message);
  }
}

// Step 5: Extract Files (background)
async function extractFiles(downloadPath, files, password, gamePath, progressCallback) {
  try {
    if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout: Extract tidak merespon'));
        }, 600000); // 10 minutes timeout

        const handler = (msg) => {
          if (msg.type === 'FixGamesExtractProgress') {
            if (progressCallback) {
              progressCallback(msg.percent || 0);
            }
          } else if (msg.type === 'FixGamesExtractComplete') {
            clearTimeout(timeout);
            window.desktopBridge.offMessage(handler);
            resolve(msg);
          } else if (msg.type === 'FixGamesExtractError') {
            clearTimeout(timeout);
            window.desktopBridge.offMessage(handler);
            reject(new Error(msg.error || 'Gagal mengekstrak file'));
          }
        };

        window.desktopBridge.onMessage(handler);
        window.desktopBridge.send('FixGamesExtract', {
          downloadPath,
          files,
          password,
          gamePath: gamePath || null
        });
      });
    } else {
      // Fallback untuk testing - simulasi progress
      for (let i = 0; i <= 100; i += 10) {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (progressCallback) progressCallback(i);
      }
      return { success: true, extractedPath: downloadPath };
    }
  } catch (e) {
    throw new Error('Gagal mengekstrak file: ' + e.message);
  }
}

// Step 6: Replace Files (background)
async function replaceFiles(gamePath, extractedPath, progressCallback) {
  try {
    if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout: Replace tidak merespon'));
        }, 300000); // 5 minutes timeout

        const handler = (msg) => {
          if (msg.type === 'FixGamesReplaceProgress') {
            if (progressCallback) {
              progressCallback(msg.percent || 0);
            }
          } else if (msg.type === 'FixGamesReplaceComplete') {
            clearTimeout(timeout);
            window.desktopBridge.offMessage(handler);
            resolve(msg);
          } else if (msg.type === 'FixGamesReplaceError') {
            clearTimeout(timeout);
            window.desktopBridge.offMessage(handler);
            reject(new Error(msg.error || 'Gagal mengganti file'));
          }
        };

        window.desktopBridge.onMessage(handler);
        window.desktopBridge.send('FixGamesReplace', {
          gamePath,
          extractedPath
        });
      });
    } else {
      // Fallback untuk testing - simulasi progress
      for (let i = 0; i <= 100; i += 10) {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (progressCallback) progressCallback(i);
      }
      return { success: true, gamePath };
    }
  } catch (e) {
    throw new Error('Gagal mengganti file: ' + e.message);
  }
}

// Step 7: Cleanup Temporary Files (background)
async function cleanupTempFiles(downloadPath, extractedPath) {
  try {
    if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          // Non-fatal - resolve anyway
          resolve({ success: true, timeout: true });
        }, 30000); // 30 seconds timeout

        const handler = (msg) => {
          if (msg.type === 'FixGamesCleanupComplete') {
            clearTimeout(timeout);
            window.desktopBridge.offMessage(handler);
            resolve(msg);
          } else if (msg.type === 'FixGamesCleanupError') {
            clearTimeout(timeout);
            window.desktopBridge.offMessage(handler);
            // Non-fatal - resolve anyway
            resolve(msg);
          }
        };

        window.desktopBridge.onMessage(handler);
        window.desktopBridge.send('FixGamesCleanup', {
          downloadPath: downloadPath || '',
          extractedPath: extractedPath || ''
        });
      });
    } else {
      // Fallback untuk testing
      return { success: true };
    }
  } catch (e) {
    // Non-fatal - return success anyway
    return { success: true };
  }
}

// Show success message
function showSuccessMessage() {
  // Simple alert for now, bisa diganti dengan modal yang lebih elegan
  alert('✅ Proses fix game berhasil! File game telah diperbaiki.');
}

// Show error message
function showErrorMessage(message) {
  alert('❌ Error: ' + message);
}

// Render Steam Account detail (special layout)
function renderSteamAccountDetail(game) {
  // Hide important info section
  const importantInfo = document.getElementById('fix-important-info');
  if (importantInfo) {
    importantInfo.style.display = 'none';
  }
  
  // Hide action button section
  const actionSection = document.getElementById('fix-action-button');
  if (actionSection) {
    actionSection.style.display = 'none';
  }
  
  // Hide progress container
  const progressContainer = document.getElementById('fix-progress-container');
  if (progressContainer) {
    progressContainer.style.display = 'none';
  }
  
  // Update poster
  const poster = document.getElementById('fix-detail-poster');
  if (poster) {
    poster.src = game.poster || '';
    poster.alt = game.title || '';
  }
  
  // Update title
  const title = document.getElementById('fix-detail-title');
  if (title) {
    title.textContent = game.title || 'Unknown';
  }
  
  // Update premium badge
  const premiumBadge = document.getElementById('fix-detail-premium-badge');
  if (premiumBadge) {
    const isPremium = game.premium === true;
    if (isPremium) {
      premiumBadge.textContent = 'PREMIUM';
      premiumBadge.className = 'bg-yellow-500 text-black text-xs px-3 py-1 rounded font-semibold';
      premiumBadge.classList.remove('hidden');
    } else {
      premiumBadge.textContent = 'STANDARD';
      premiumBadge.className = 'bg-gray-600 text-white text-xs px-3 py-1 rounded font-semibold';
      premiumBadge.classList.remove('hidden');
    }
  }
  
  // Update publisher
  const publisher = document.getElementById('fix-detail-publisher');
  if (publisher) {
    publisher.textContent = game.publisher || '';
  }
  
  // Update AppID
  const appid = document.getElementById('fix-detail-appid');
  if (appid) {
    appid.textContent = `AppID: ${game.appid}`;
  }
  
  // Create account info section
  const infoContainer = document.querySelector('.flex-1.space-y-6');
  if (infoContainer) {
    // Remove existing important info and action button sections
    const existingImportant = infoContainer.querySelector('.space-y-3');
    if (existingImportant) {
      existingImportant.remove();
    }
    const existingAction = infoContainer.querySelector('.pt-4.border-t');
    if (existingAction) {
      existingAction.remove();
    }
    
    // Add account info section
    const accountSection = document.createElement('div');
    accountSection.className = 'space-y-4';
    accountSection.innerHTML = `
      <div>
        <h3 class="text-lg font-semibold mb-3">Account</h3>
        <div class="space-y-3">
          <div class="bg-[#1a1a1a] border border-white/5 rounded-lg p-4">
            <div class="flex items-center justify-between">
              <div class="flex-1">
                <p class="text-xs text-gray-400 mb-1">Username</p>
                <p id="steam-account-username" class="text-white font-mono text-sm">${escapeHtml(game.username || '')}</p>
              </div>
              <button onclick="copyToClipboard('steam-account-username')" 
                      class="ml-4 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition">
                Copy
              </button>
            </div>
          </div>
          <div class="bg-[#1a1a1a] border border-white/5 rounded-lg p-4">
            <div class="flex items-center justify-between">
              <div class="flex-1">
                <p class="text-xs text-gray-400 mb-1">Password</p>
                <p id="steam-account-password" class="text-white font-mono text-sm">${escapeHtml(game.password || '')}</p>
              </div>
              <button onclick="copyToClipboard('steam-account-password')" 
                      class="ml-4 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition">
                Copy
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div>
        <h3 class="text-lg font-semibold mb-3">Instruksi Penggunaan</h3>
        <div class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p class="text-gray-300 text-sm leading-relaxed">
              Jika akun tidak berhasil login harap segera hubungi admin!!
            </p>
            <button onclick="reportSteamAccountIssue()"
                    class="px-4 py-2 rounded-lg bg-blue-500/20 border border-blue-400/30 text-sm font-semibold text-blue-200 hover:bg-blue-500/30 transition">
              Laporkan Akun
            </button>
          </div>
        </div>
        <div class="bg-green-500/10 border border-green-500/20 rounded-lg p-4 mb-4">
          <p class="text-green-400 font-semibold mb-3">Jika berhasil Login ikuti instruksi dibawah ini:</p>
          <ol class="text-gray-300 text-sm space-y-2.5 list-decimal list-inside leading-relaxed">
            <li>Login ke akun Steam tersebut menggunakan username dan password yang sudah di-copy.</li>
            <li>Cek apakah ada game yang sesuai di library akun tersebut.</li>
            <li>Jika ada game, logout dan kembali ke akun pribadi kalian.</li>
            <li>Add game tersebut ke library akun pribadi kalian terlebih dahulu.</li>
            <li>Download game seperti biasa di akun pribadi kalian.</li>
            <li>Setelah download selesai, login kembali ke akun Steam tersebut.</li>
            <li class="font-bold text-yellow-400 text-base mt-3 mb-3 bg-yellow-500/20 px-3 py-2 rounded border border-yellow-500/40">
              ⚠️ PENTING: Setelah login, pastikan Steam kalian dalam mode <span class="bg-yellow-500/30 px-2 py-1 rounded font-bold">OFFLINE MODE (WAJIB!!!)</span>
            </li>
            <li>Jalankan game dari akun tersebut.</li>
            <li>Biarkan game berjalan sampai masuk ke menu utama game.</li>
            <li>Setelah masuk menu utama, tutup game dengan menekan <span class="font-mono bg-white/10 px-2 py-0.5 rounded">Alt + F4</span>.</li>
            <li>Logout dari akun tersebut dan kembali ke akun pribadi kalian.</li>
            <li>Mainkan game dari akun pribadi kalian seperti biasa.</li>
          </ol>
        </div>
      </div>
    `;
    
    infoContainer.appendChild(accountSection);
  }
}

// Copy to clipboard helper
function copyToClipboard(elementId) {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  const text = element.textContent.trim();
  if (!text) return;
  
  // Use Clipboard API if available
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showCopySuccess(elementId);
    }).catch(() => {
      // Fallback to old method
      fallbackCopyToClipboard(text, elementId);
    });
  } else {
    // Fallback to old method
    fallbackCopyToClipboard(text, elementId);
  }
}

function fallbackCopyToClipboard(text, elementId) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    document.execCommand('copy');
    showCopySuccess(elementId);
  } catch (err) {
    // Copy failed
  }
  
  document.body.removeChild(textArea);
}

function showCopySuccess(elementId) {
  const button = document.querySelector(`button[onclick="copyToClipboard('${elementId}')"]`);
  if (button) {
    const originalText = button.textContent;
    button.textContent = 'Copied!';
    button.classList.add('bg-green-600', 'hover:bg-green-700');
    button.classList.remove('bg-blue-600', 'hover:bg-blue-700');
    
    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('bg-green-600', 'hover:bg-green-700');
      button.classList.add('bg-blue-600', 'hover:bg-blue-700');
    }, 2000);
  }
}

// Expose copyToClipboard globally
window.copyToClipboard = copyToClipboard;

async function reportSteamAccountIssue() {
  if (!currentFixGame || currentFixGame.category !== 'steam-account') {
    const fallbackMsg = 'Data akun Steam tidak ditemukan. Coba buka ulang halaman ini.';
    if (typeof premiumAlert === 'function') {
      await premiumAlert(fallbackMsg, 'Laporkan Akun');
    } else {
      alert(fallbackMsg);
    }
    return;
  }

  const limits = readReportLimitMap();
  const todayKey = getTodayKey();
  const appKey = String(currentFixGame.appid || '');
  let appLimit = limits[appKey];

  if (appLimit && appLimit.date === todayKey && appLimit.count >= REPORT_LIMIT_MAX_PER_DAY) {
    const limitMsg = 'Anda sudah mengirim 2 laporan untuk akun ini dalam 24 jam terakhir. Tunggu hingga besok untuk mengirim laporan baru.';
    if (typeof premiumAlert === 'function') {
      await premiumAlert(limitMsg, 'Batas Laporan Tercapai');
    } else {
      alert(limitMsg);
    }
    return;
  }

  if (!appLimit || appLimit.date !== todayKey) {
    appLimit = { date: todayKey, count: 0 };
    limits[appKey] = appLimit;
  }

  const chatId = '8491267458';
  const botToken = '8122332462:AAFwFdGrIA2w5WaEOWetf-bCSkz0luJ_KSo';
  const reportText = [
    '🚨 Laporan Akun Steam',
    `AppID : ${currentFixGame.appid || '-'} `,
    `Game  : ${currentFixGame.title || '-'} `,
    `User  : ${currentFixGame.username || '-'} `,
    `Pass  : ${currentFixGame.password || '-'} `,
    'Status: Tidak bisa login (dilaporkan user)'
  ].join('\n');

  const encodedText = encodeURIComponent(reportText);
  const url = `https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${chatId}&text=${encodedText}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const successMsg = 'Laporan akun sudah dikirim. Admin akan segera memeriksa.';
    appLimit.count = Math.min(appLimit.count + 1, REPORT_LIMIT_MAX_PER_DAY);
    writeReportLimitMap(limits);
    if (typeof premiumAlert === 'function') {
      await premiumAlert(successMsg, 'Laporan Terkirim');
    } else {
      alert(successMsg);
    }
  } catch (error) {
    const errorMsg = 'Gagal mengirim laporan. Mohon coba lagi beberapa saat.';
    if (typeof premiumAlert === 'function') {
      await premiumAlert(`${errorMsg}\n\nDetail: ${error.message || error}`, 'Laporan Gagal');
    } else {
      alert(`${errorMsg}\n\nDetail: ${error.message || error}`);
    }
  }
}

window.reportSteamAccountIssue = reportSteamAccountIssue;

// Escape HTML helper
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Add Shortcut Process
async function startAddShortcutProcess() {
  if (!currentFixGame) {
    alert('Game data tidak tersedia!');
    return;
  }
  
  const addShortcutBtn = document.getElementById('fix-game-add-shortcut-btn');
  const btnText = document.getElementById('fix-shortcut-btn-text');
  const btnSpinner = document.getElementById('fix-shortcut-btn-spinner');
  
  // Update button state
  if (addShortcutBtn) addShortcutBtn.disabled = true;
  if (btnText) btnText.textContent = 'Mencari game...';
  if (btnSpinner) btnSpinner.classList.remove('hidden');
  
  try {
    // Step 1: Detect Path (sama seperti startFixGameProcess)
    let gamePath;
    try {
      gamePath = await detectGamePath();
    } catch (e) {
      // Error sudah memiliki pesan yang jelas dari detectGamePath
      throw e;
    }
    
    if (!gamePath) {
      // Game belum terinstall → buka modal manual path selection
      const manualPath = await new Promise((resolve, reject) => {
        openManualPathModal('Game mungkin belum Anda install atau tidak ditemukan di Steam library. Silakan cari folder game secara manual atau pastikan game sudah terinstall di Steam.')
          .then(resolve)
          .catch(reject);
      });
      if (!manualPath) {
        throw new Error('Anda belum memilih folder game.');
      }
      gamePath = manualPath;
    }
    
    // Step 2: Scan executables
    if (btnText) btnText.textContent = 'Memindai executable...';
    
    const gameName = currentFixGame.title || 'Game';
    const executables = await scanGameExecutables(gamePath, gameName);
    
    if (!executables || executables.length === 0) {
      alert('Tidak ada executable (.exe) ditemukan di folder game ini.');
      return;
    }
    
    // Step 3: Show dialog untuk user pilih executable
    const selectedExe = await showExecutableSelectionDialog(executables, gameName);
    
    if (!selectedExe) {
      // User cancel
      return;
    }
    
    // Step 4: Create desktop shortcut
    if (btnText) btnText.textContent = 'Membuat shortcut...';
    
    const shortcutName = `${gameName} - FIX`;
    
    const result = await createDesktopShortcut(selectedExe.path, shortcutName, gamePath);
    
    if (result && result.success) {
      if (typeof premiumAlert === 'function') {
        await premiumAlert(
          `Shortcut berhasil dibuat di Desktop!\n\nNama: ${shortcutName}\n\nAnda dapat menambahkan shortcut ini ke Steam library secara manual melalui:\nSteam → Games → Add a Non-Steam Game to My Library`,
          'Shortcut Berhasil Dibuat'
        );
      } else {
        alert(`Shortcut berhasil dibuat di Desktop!\n\nNama: ${shortcutName}\n\nAnda dapat menambahkan shortcut ini ke Steam library secara manual.`);
      }
    } else {
      throw new Error(result?.error || 'Gagal membuat shortcut');
    }
  } catch (e) {
    if (typeof premiumAlert === 'function') {
      await premiumAlert('Gagal membuat shortcut: ' + (e.message || 'Unknown error'), 'Error');
    } else {
      alert('Gagal membuat shortcut: ' + (e.message || 'Unknown error'));
    }
  } finally {
    // Reset button state
    if (addShortcutBtn) addShortcutBtn.disabled = false;
    if (btnText) btnText.textContent = '📌 Add Shortcut';
    if (btnSpinner) btnSpinner.classList.add('hidden');
  }
}

// Scan executables in game folder
async function scanGameExecutables(gamePath, gameTitle) {
  return new Promise((resolve, reject) => {
    if (!window.desktopBridge || typeof window.desktopBridge.send !== 'function') {
      reject(new Error('Desktop bridge tidak tersedia'));
      return;
    }
    
    const timeout = setTimeout(() => {
      window.desktopBridge.offMessage(handler);
      reject(new Error('Timeout: Gagal memindai executable'));
    }, 30000); // 30 seconds timeout
    
    const handler = (data) => {
      try {
        const msg = typeof data === 'string' ? JSON.parse(data) : data;
        
        if (msg && msg.type === 'FixGamesScanExecutables') {
          clearTimeout(timeout);
          window.desktopBridge.offMessage(handler);
          
          if (!msg.success) {
            reject(new Error(msg.error || 'Gagal memindai executable'));
            return;
          }
          
          resolve(msg.executables || []);
        }
      } catch (e) {
        // Don't reject here - let timeout handle it
      }
    };
    
    window.desktopBridge.onMessage(handler);
    
    try {
      window.desktopBridge.send('FixGamesScanExecutables', {
        gamePath: gamePath,
        gameTitle: gameTitle || ''
      });
    } catch (e) {
      clearTimeout(timeout);
      window.desktopBridge.offMessage(handler);
      reject(new Error('Gagal mengirim request: ' + e.message));
    }
  });
}

// Show dialog untuk user pilih executable
async function showExecutableSelectionDialog(executables, gameName) {
  return new Promise((resolve) => {
    // Find recommended exe (highest similarity or score)
    const recommended = executables.find(exe => exe.recommended === true) || executables[0];
    const recommendedName = recommended ? recommended.name : '';
    
    // Create modal HTML
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60';
    modal.innerHTML = `
      <div class="bg-[#151515] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        <div class="p-6 border-b border-white/5">
          <h3 class="text-xl font-semibold text-white">Pilih Executable</h3>
          <p class="text-sm text-gray-400 mt-1">Pilih executable yang ingin dibuat shortcut untuk ${escapeHtml(gameName)}</p>
          ${recommendedName ? `<p class="text-xs text-blue-400 mt-2">💡 Launcher yang paling cocok kemungkinan <span class="font-mono font-semibold">${escapeHtml(recommendedName)}</span></p>` : ''}
        </div>
        <div class="flex-1 overflow-y-auto p-6">
          <div class="space-y-2" id="exe-list-container">
            ${executables.map((exe, index) => `
              <label class="block cursor-pointer">
                <div class="bg-[#1a1a1a] border ${exe.recommended ? 'border-green-500/50 bg-green-500/5' : 'border-white/5'} rounded-lg p-4 hover:bg-white/5 transition">
                  <div class="flex items-start gap-3">
                    <input type="radio" name="exe-selection" value="${index}" class="mt-1">
                    ${exe.iconBase64 ? `<img src="data:image/png;base64,${exe.iconBase64}" alt="${escapeHtml(exe.name)}" class="w-8 h-8 flex-shrink-0 object-contain" />` : '<div class="w-8 h-8 flex-shrink-0 bg-gray-700 rounded flex items-center justify-center"><span class="text-xs text-gray-400">.exe</span></div>'}
                    <div class="flex-1">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="font-mono text-sm text-white">${escapeHtml(exe.name)}</span>
                        ${exe.recommended ? '<span class="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">Direkomendasikan</span>' : ''}
                      </div>
                      <div class="text-xs text-gray-400">
                        <div>Lokasi: <span class="font-mono text-gray-300">${escapeHtml(exe.relativePath || exe.path)}</span></div>
                        ${exe.size ? `<div>Ukuran: ${formatFileSize(exe.size)}</div>` : ''}
                        ${exe.similarityScore !== undefined ? `<div>Kemiripan dengan nama game: ${exe.similarityScore}%</div>` : ''}
                        ${exe.score !== undefined ? `<div>Skor: ${exe.score}/100</div>` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="p-6 border-t border-white/5 flex gap-3 justify-end">
          <button onclick="this.closest('.fixed').remove(); window._exeSelectionResolve(null);" 
                  class="px-5 py-2.5 rounded-lg border border-white/10 text-sm font-medium text-gray-300 hover:bg-white/5 transition">
            Batal
          </button>
          <button id="exe-create-shortcut-btn" onclick="const selected = document.querySelector('input[name=exe-selection]:checked'); if (selected) { const index = parseInt(selected.value); window._exeSelectionResolve(window._exeSelectionList[index]); this.closest('.fixed').remove(); } else { alert('Silakan pilih executable terlebih dahulu!'); }" 
                  class="px-5 py-2.5 rounded-lg bg-gradient-to-r from-green-500 to-green-600 text-sm font-semibold text-white shadow-lg hover:from-green-400 hover:to-green-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled>
            Buat Shortcut
          </button>
        </div>
      </div>
    `;
    
    // Store executables and resolve function globally for onclick handlers
    window._exeSelectionList = executables;
    window._exeSelectionResolve = resolve;
    
    document.body.appendChild(modal);
    
    // Enable/disable button based on selection
    const createBtn = modal.querySelector('#exe-create-shortcut-btn');
    const radioButtons = modal.querySelectorAll('input[name="exe-selection"]');
    
    radioButtons.forEach(radio => {
      radio.addEventListener('change', () => {
        if (createBtn) {
          createBtn.disabled = !document.querySelector('input[name="exe-selection"]:checked');
        }
      });
    });
    
    // Close on outside click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        resolve(null);
      }
    });
  });
}

// Format file size helper
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Create desktop shortcut
async function createDesktopShortcut(exePath, shortcutName, gamePath) {
  return new Promise((resolve, reject) => {
    if (!window.desktopBridge || typeof window.desktopBridge.send !== 'function') {
      reject(new Error('Desktop bridge tidak tersedia'));
      return;
    }
    
    const timeout = setTimeout(() => {
      window.desktopBridge.offMessage(handler);
      reject(new Error('Timeout: Gagal membuat shortcut'));
    }, 30000);
    
    const handler = (data) => {
      try {
        const msg = typeof data === 'string' ? JSON.parse(data) : data;
        
        if (msg && msg.type === 'FixGamesCreateShortcut') {
          clearTimeout(timeout);
          window.desktopBridge.offMessage(handler);
          
          if (!msg.success) {
            reject(new Error(msg.error || 'Gagal membuat shortcut'));
            return;
          }
          
          resolve(msg);
        }
      } catch (e) {
        // Don't reject here
      }
    };
    
    window.desktopBridge.onMessage(handler);
    
    try {
      window.desktopBridge.send('FixGamesCreateShortcut', {
        exePath: exePath,
        shortcutName: shortcutName,
        gamePath: gamePath
      });
    } catch (e) {
      clearTimeout(timeout);
      window.desktopBridge.offMessage(handler);
      reject(new Error('Gagal mengirim request: ' + e.message));
    }
  });
}

// Expose globally
window.initFixGameDetailPage = initFixGameDetailPage;
window.startFixGameProcess = startFixGameProcess;
window.startAddShortcutProcess = startAddShortcutProcess;
window.onFixPathChooseManual = onFixPathChooseManual;
window.onFixPathCancel = onFixPathCancel;
