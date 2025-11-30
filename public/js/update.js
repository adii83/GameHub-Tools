// Check Update functionality for override data
async function checkOverrideUpdate() {
  const btn = document.getElementById('btn-check-update');
  if (!btn) return;
  
  // Disable button during check
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span><span>Checking...</span>';
  
  try {
    if (!window.desktopBridge || typeof window.desktopBridge.checkOverrideUpdate !== 'function') {
      showTransientMessage('Bridge tidak tersedia', 3000);
      return;
    }
    
    const result = await window.desktopBridge.checkOverrideUpdate();
    
    if (result.hasUpdate) {
      // Ada update tersedia
      const updateMsg = `Update tersedia! Terakhir update: ${result.lastUpdate || 'Tidak diketahui'}`;
      showTransientMessage(updateMsg, 5000);
      
      // Tanya user apakah ingin update sekarang
      if (confirm('Ada update override data tersedia. Update sekarang?')) {
        await forceUpdateOverride();
      }
    } else {
      // Tidak ada update
      const lastUpdate = result.lastUpdate ? `Terakhir update: ${result.lastUpdate}` : 'Belum pernah di-update';
      showTransientMessage(`Sudah up-to-date. ${lastUpdate}`, 3000);
    }
  } catch (e) {
    showTransientMessage('Gagal cek update: ' + (e.message || 'Unknown error'), 4000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function forceUpdateOverride() {
  const btn = document.getElementById('btn-check-update');
  if (!btn) return;
  
  // Show loading
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span><span>Updating...</span>';
  
  try {
    if (!window.desktopBridge || typeof window.desktopBridge.forceUpdateOverride !== 'function') {
      showTransientMessage('Bridge tidak tersedia', 3000);
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
          showTransientMessage('Dataset berhasil di-update!', 4000);
        } catch (e) {
          showTransientMessage('Override data berhasil di-update! Aplikasi akan reload...', 3000);
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        }
      } else {
        // Fallback: reload page
        showTransientMessage('Override data berhasil di-update! Aplikasi akan reload...', 3000);
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      }
    } else {
      showTransientMessage('Gagal update: ' + (result.error || 'Unknown error'), 4000);
    }
  } catch (e) {
    showTransientMessage('Gagal update: ' + (e.message || 'Unknown error'), 4000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Expose globally
window.checkOverrideUpdate = checkOverrideUpdate;
