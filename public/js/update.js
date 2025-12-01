// Load Games functionality - reload game data dari GitHub (raw data + override)
async function loadGames() {
  const btn = document.getElementById('btn-load-games-settings') || document.getElementById('btn-check-update');
  if (!btn) return;
  
  // Disable button during load
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span><span>Loading...</span>';
  
  try {
    // Check update untuk override data dulu
    if (window.desktopBridge && typeof window.desktopBridge.checkOverrideUpdate === 'function') {
      const result = await window.desktopBridge.checkOverrideUpdate();
      
      if (result.hasUpdate) {
        // Ada update override tersedia
        const shouldUpdate = await premiumConfirm(
          `Ada update override data tersedia. Update sekarang?\n\nTerakhir update: ${result.lastUpdate || 'Tidak diketahui'}`,
          'Update Tersedia'
        );
        if (shouldUpdate) {
          await forceUpdateOverride();
        }
      }
    }
    
    // Reload game data (raw data + override)
    if (typeof refreshGithubRaw === 'function') {
      await refreshGithubRaw();
      // refreshGithubRaw sudah pakai showTransientMessage, tapi kita ganti dengan modal
      if (typeof premiumAlert === 'function') {
        premiumAlert('Game data berhasil dimuat ulang!', 'Berhasil');
      }
    } else if (typeof initGamesPage === 'function') {
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
            premiumAlert('Override data berhasil di-update! Aplikasi akan reload...', 'Berhasil');
          }
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        }
      } else {
        // Fallback: reload page
        if (typeof premiumAlert === 'function') {
          premiumAlert('Override data berhasil di-update! Aplikasi akan reload...', 'Berhasil');
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
