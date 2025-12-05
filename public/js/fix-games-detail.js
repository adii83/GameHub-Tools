// Fix Games Detail Page Logic

let currentFixGame = null;
let currentAppId = null;
let isProcessing = false;

// Initialize detail page
async function initFixGameDetailPage(appid) {
  currentAppId = appid;
  isProcessing = false;
  
  try {
    // Normalize appid to number untuk comparison
    const appidNum = typeof appid === 'string' ? parseInt(appid, 10) : appid;
    
    if (isNaN(appidNum)) {
      alert('AppID tidak valid!');
      navigate('fix-games');
      return;
    }
    
    // Load game data dari fixGamesData (harus sudah ter-load di fix-games.js)
    let gameData = null;
    
    // Cek dari window.fixGamesData (dari fix-games.js) - retry beberapa kali jika belum ter-load
    let retryCount = 0;
    const maxRetries = 5;
    
    while (!gameData && retryCount < maxRetries) {
      // Cek dari window.fixGamesData
      if (typeof window.fixGamesData !== 'undefined' && Array.isArray(window.fixGamesData) && window.fixGamesData.length > 0) {
        gameData = window.fixGamesData.find(g => {
          const gAppid = typeof g.appid === 'string' ? parseInt(g.appid, 10) : g.appid;
          return gAppid === appidNum;
        });
      }
      
      if (gameData) break;
      
      // Tunggu sebentar sebelum retry (jika data belum ter-load)
      if (retryCount < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      retryCount++;
    }
    
    // Jika tidak ditemukan, coba load dari GitHub raw
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
        console.error('Failed to load game data:', e);
      }
    }
    
    if (!gameData) {
      alert(`Game tidak ditemukan! AppID: ${appidNum}\n\nPastikan game ada di fix_games.json.`);
      navigate('fix-games');
      return;
    }
    
    currentFixGame = gameData;
    renderFixGameDetail(gameData);
  } catch (e) {
    console.error('initFixGameDetailPage error:', e);
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
      // Log error but continue - antivirus check is not critical
      console.warn('[FixGames] Antivirus check error (non-fatal):', e);
      // Continue to next step
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
      
      // Log untuk debugging
      console.log('[FixGames] AutoExclude result received:', excludeResult);
      
      // PERBAIKAN: Cek needsAdmin bahkan jika success = false atau undefined
      // Check needsAdmin flag (bisa boolean atau string)
      const needsAdmin = excludeResult && (excludeResult.needsAdmin === true || excludeResult.needsAdmin === 'true');
      
      // Jika auto-exclude gagal atau butuh admin, handle dengan benar
      if (excludeResult && !excludeResult.success) {
        if (needsAdmin) {
          // Tampilkan alert dan hentikan proses
          alert(
            '⚠️ Perhatian!\n\n' +
            'Aplikasi perlu dijalankan sebagai Administrator untuk menambahkan folder game ke Windows Defender exclusion list.\n\n' +
            'Tanpa ini, Windows Defender mungkin akan menghapus file game lagi setelah proses fix selesai.\n\n' +
            'Silakan tutup aplikasi ini, jalankan sebagai Administrator, dan mulai ulang proses fix.'
          );
          // PERBAIKAN: Throw error yang jelas untuk menghentikan proses
          throw new Error('Jalankan Aplikasi dengan Run Administrator dan Mulai Ulang');
        } else {
          // Jika gagal tapi bukan karena admin, throw error biasa
          throw new Error(excludeResult.error || 'Gagal menambahkan ke exclusion list');
        }
      }
      
      // PERBAIKAN: Cek juga jika excludeResult null/undefined atau tidak ada success flag
      if (!excludeResult || (excludeResult.success !== true && needsAdmin)) {
        // Jika butuh admin tapi tidak ada success flag, juga tampilkan alert
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
    } catch (e) {
      // Jika error sudah jelas tentang admin, throw langsung
      if (e.message && e.message.includes('Jalankan Aplikasi dengan Run Administrator')) {
        throw e;
      }
      
      // Jika auto-exclude gagal karena butuh admin, tampilkan alert khusus
      if (e.message && (e.message.includes('Administrator') || e.message.includes('admin'))) {
        alert(
          '⚠️ Perhatian!\n\n' +
          'Aplikasi perlu dijalankan sebagai Administrator untuk menambahkan folder game ke Windows Defender exclusion list.\n\n' +
          'Tanpa ini, Windows Defender mungkin akan menghapus file game lagi setelah proses fix selesai.\n\n' +
          'Silakan tutup aplikasi ini, jalankan sebagai Administrator, dan mulai ulang proses fix.'
        );
        throw new Error('Jalankan Aplikasi dengan Run Administrator dan Mulai Ulang');
      } else {
        // Error lain, throw seperti biasa
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
    const extractResult = await extractFiles(downloadResult.downloadPath, downloadResult.files, currentFixGame.password, (percent) => {
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
    
    // Success
    updateProgress(100, 'Selesai!');
    setTimeout(() => {
      showSuccessMessage();
      resetButtonState();
    }, 500);
    
  } catch (e) {
    console.error('Fix process error:', e);
    // Hapus popup error - hanya log ke console
    // showErrorMessage(e.message || 'Terjadi kesalahan saat proses fix!');
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
  try {
    if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout: Check antivirus tidak merespon'));
        }, 30000);

        const handler = (msg) => {
          if (msg.type === 'FixGamesAntivirusCheck') {
            clearTimeout(timeout);
            window.desktopBridge.offMessage(handler);
            
            if (!msg.success) {
              reject(new Error(msg.error || 'Gagal memeriksa antivirus'));
              return;
            }

            if (msg.hasOtherAntivirus) {
              const avList = msg.otherAntivirus.join(', ');
              throw new Error(`Deteksi antivirus selain Windows Defender: ${avList}. Silakan uninstall dan gunakan Windows Defender saja.`);
            }

            resolve(msg);
          }
        };

        window.desktopBridge.onMessage(handler);
        window.desktopBridge.send('FixGamesCheckAntivirus', {});
      });
    } else {
      // Fallback untuk testing
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (e) {
    throw new Error('Gagal memeriksa antivirus: ' + e.message);
  }
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
            
            // Log untuk debugging
            console.log('[FixGames] AutoExclude result:', msg);
            
            // Return result object (bukan throw) agar caller bisa handle needsAdmin
            resolve(msg);
          }
        };

        window.desktopBridge.onMessage(handler);
        window.desktopBridge.send('FixGamesAutoExclude', { gamePath });
      });
    } else {
      // Fallback untuk testing
      return { success: true, isAdmin: false, needsAdmin: false };
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
            
            // Debug logging - log ALL messages to see what we're receiving
            console.log('[FixGames] Handler received:', typeof data, data);
            if (msg && msg.type) {
              console.log('[FixGames] Message type:', msg.type, 'full data:', JSON.stringify(msg));
            }
            
            // Check if this is the response we're waiting for
            if (msg && msg.type === 'FixGamesDetectPath') {
              console.log('[FixGames] FixGamesDetectPath response received!', msg);
              clearTimeout(timeout);
              window.desktopBridge.offMessage(handler);
              
              if (!msg.success && (msg.needsManualSelection || msg.gameNotInstalled)) {
                // Game belum terinstall atau path tidak ditemukan → tawarkan pilih folder manual via modal
                const baseMessage = msg.message || 
                  'Game mungkin belum Anda install atau tidak ditemukan di Steam library. Silakan cari folder game secara manual atau pastikan game sudah terinstall di Steam.';
                
                openManualPathModal(baseMessage)
                  .then((manualPath) => {
                    console.log('[FixGames] Manual path selected:', manualPath);
                    resolve(manualPath);
                  })
                  .catch((err) => {
                    console.warn('[FixGames] Manual path selection cancelled or failed:', err);
                    reject(err instanceof Error ? err : new Error(String(err || baseMessage)));
                  });
                return;
              }
              
              if (!msg.success) {
                reject(new Error(msg.error || 'Gagal mendeteksi path instalasi'));
                return;
              }

              if (msg.path) {
                console.log('[FixGames] Path found:', msg.path);
                resolve(msg.path);
              } else {
                reject(new Error('Path tidak ditemukan dalam response'));
              }
            } else {
              console.log('[FixGames] Ignoring message type:', msg?.type || 'unknown');
            }
          } catch (e) {
            // Log all errors for debugging
            console.error('[FixGames] Error in handler:', e, 'data type:', typeof data, 'data:', data);
            // Don't reject here - let timeout handle it if message is wrong type
          }
        };

        // Register handler BEFORE sending request
        window.desktopBridge.onMessage(handler);
        
        // Send request
        try {
          console.log('[FixGames] Sending FixGamesDetectPath request for appid:', currentAppId);
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
async function extractFiles(downloadPath, files, password, progressCallback) {
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
          password
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

// Show success message
function showSuccessMessage() {
  // Simple alert for now, bisa diganti dengan modal yang lebih elegan
  alert('✅ Proses fix game berhasil! File game telah diperbaiki.');
}

// Show error message
function showErrorMessage(message) {
  alert('❌ Error: ' + message);
}

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

// Expose globally
window.initFixGameDetailPage = initFixGameDetailPage;
window.startFixGameProcess = startFixGameProcess;
window.onFixPathChooseManual = onFixPathChooseManual;
window.onFixPathCancel = onFixPathCancel;
