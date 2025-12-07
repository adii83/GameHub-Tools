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
