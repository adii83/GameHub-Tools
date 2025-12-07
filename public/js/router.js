// Store last navigate params
window._lastNavigateParams = {};

async function navigate(page, params = {}) {
  // Store params for detail pages
  window._lastNavigateParams = params;
  
  const container = document.getElementById("app-content");
  const sidebarDashboard = document.getElementById("nav-dashboard");
  const sidebarGames = document.getElementById("nav-games");
  const sidebarLibrary = document.getElementById("nav-library");
  const sidebarFixGames = document.getElementById("nav-fix-games");
  const sidebarSettings = document.getElementById("nav-settings");

  // Load page
  const html = await fetch(`/app/${page}.html`).then((r) => r.text());
  // Inject HTML and ensure any inline <script> tags execute
  container.innerHTML = html;
  try {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const scripts = temp.querySelectorAll('script');
    scripts.forEach((old) => {
      const s = document.createElement('script');
      // Only execute inline scripts to avoid reloading global JS twice
      if (old.type) {
        s.type = old.type;
      }
      // Handle both inline and external scripts for fix-games page
      if (old.src) {
        // For fix-games page, load external scripts
        if (page === 'fix-games' && old.src.includes('fix-games.js')) {
          // Check if script already loaded
          const existing = document.querySelector(`script[src="${old.src}"]`);
          if (!existing) {
            s.src = old.src;
            document.head.appendChild(s);
          }
        }
      } else {
        // Inline script content
        s.textContent = old.textContent || '';
        document.body.appendChild(s);
      }
    });
  } catch (e) {}

  // Active state
  sidebarDashboard?.classList.remove("bg-[#1f1f1f]", "text-white");
  sidebarGames?.classList.remove("bg-[#1f1f1f]", "text-white");
  sidebarLibrary?.classList.remove("bg-[#1f1f1f]", "text-white");
  sidebarFixGames?.classList.remove("bg-[#1f1f1f]", "text-white");
  sidebarSettings?.classList.remove("bg-[#1f1f1f]", "text-white");

  if (page === "dashboard") {
    sidebarDashboard?.classList.add("bg-[#1f1f1f]", "text-white");
  } else if (page === "games") {
    sidebarGames?.classList.add("bg-[#1f1f1f]", "text-white");
  } else if (page === "library") {
    sidebarLibrary?.classList.add("bg-[#1f1f1f]", "text-white");
  } else if (page === "fix-games") {
    sidebarFixGames?.classList.add("bg-[#1f1f1f]", "text-white");
  } else if (page === "settings") {
    sidebarSettings?.classList.add("bg-[#1f1f1f]", "text-white");
  }

  // Jika halaman adalah Games → jalankan render dengan filter normal
  if (page === "games") {
    // Load filter panel HTML into the filter-panel container (if present)
    const filterPanelHtml = await fetch("/components/filter-panel.html").then((r) => r.text());
    const filterPanelContainer = document.getElementById("filter-panel");
    if (filterPanelContainer) {
      filterPanelContainer.innerHTML = filterPanelHtml;
    }

    // PERBAIKAN: Reset library filter dengan benar saat kembali ke games page
    // Reset semua library filter state SEBELUM initGamesPage
    window.libraryFilterActive = false;
    // Reset local variable di filter.js scope (jika bisa diakses)
    try {
      if (typeof libraryFilterActive !== 'undefined') {
        libraryFilterActive = false;
      }
      // Reset libraryAppIds juga (optional, tapi lebih aman)
      if (typeof libraryAppIds !== 'undefined' && libraryAppIds instanceof Set) {
        libraryAppIds.clear();
      }
    } catch (e) {
      // Jika tidak bisa akses, tidak apa-apa, window.libraryFilterActive sudah di-reset
    }

    // Call initGamesPage untuk load games (loadGames hanya untuk settings page)
    if (typeof initGamesPage === "function") {
      await initGamesPage();
      // PERBAIKAN: Apply filters lagi setelah init untuk memastikan library filter tidak aktif
      // Defer untuk tidak block UI
      setTimeout(() => {
        try {
          if (typeof applyFilters === 'function') {
            applyFilters(true);
          }
        } catch (e) {
          // Error applying filters - non-critical
        }
      }, 150);
    } else if (typeof loadGames === "function") {
      // Fallback jika initGamesPage tidak ada
      await loadGames();
      // Apply filters juga
      setTimeout(() => {
        try {
          if (typeof applyFilters === 'function') {
            applyFilters(true);
          }
        } catch (e) {
          // Error applying filters - non-critical
        }
      }, 150);
    }
  }

  // Jika halaman adalah Library → jalankan render dengan filter Library aktif
  if (page === "library") {
    // Cleanup hidden cards (remove from DOM permanently)
    if (window.hiddenCards && window.hiddenCards.size > 0) {
      window.hiddenCards.forEach(appid => {
        const cardWrapper = document.getElementById(`game-card-wrapper-${appid}`);
        const card = document.getElementById(`game-${appid}`);
        const target = cardWrapper || card;
        if (target && target.parentNode) {
          target.remove();
        }
      });
      window.hiddenCards.clear();
    }
    
    // Aktifkan library filter dan load games
    if (typeof toggleLibraryFilter === "function") {
      // Load library games (akan otomatis filter berdasarkan .lua files)
      await toggleLibraryFilter();
    } else if (typeof initGamesPage === "function") {
      // Fallback: init games page lalu aktifkan library filter
      await initGamesPage();
      if (typeof toggleLibraryFilter === "function") {
        await toggleLibraryFilter();
      }
    }
  }

  // Jika halaman adalah Fix Games Detail → load detail page
  if (page === "fix-games-detail") {
    // Check if this is steam-account category
    const isSteamAccount = params.isSteamAccount === true;
    // Get appid from navigate params
    const navigateParams = window._lastNavigateParams || {};
    const appid = navigateParams.appid;
    
    if (!appid) {
      alert('AppID tidak ditemukan!');
      navigate('fix-games');
      return;
    }
    
    // Load script jika belum ter-load
    if (typeof initFixGameDetailPage !== 'function') {
      const script = document.createElement('script');
      script.src = '/js/fix-games-detail.js';
      script.onload = () => {
        setTimeout(() => {
          if (typeof initFixGameDetailPage === 'function') {
            initFixGameDetailPage(parseInt(appid), isSteamAccount);
          }
        }, 50);
      };
      document.head.appendChild(script);
    } else {
      setTimeout(() => {
        if (typeof initFixGameDetailPage === 'function') {
          initFixGameDetailPage(parseInt(appid), isSteamAccount);
        }
      }, 50);
    }
  }
  
  // Jika halaman adalah Fix Games → load fix games data
  if (page === "fix-games") {
    // OPTIMASI: Load page-cache.js dulu jika belum ter-load
    if (typeof window.FixGamesPageCache === 'undefined') {
      const cacheScript = document.createElement('script');
      cacheScript.src = '/js/page-cache.js';
      cacheScript.onload = () => {
        // Setelah cache script loaded, load fix-games.js
        loadFixGamesScript();
      };
      document.head.appendChild(cacheScript);
    } else {
      loadFixGamesScript();
    }
    
    function loadFixGamesScript() {
      // Load script jika belum ter-load
      if (typeof filterFixGamesByCategory !== 'function') {
        const script = document.createElement('script');
        script.src = '/js/fix-games.js';
        script.onload = () => {
          // Wait a bit untuk memastikan script sudah ter-execute
          setTimeout(() => {
            if (typeof initFixGamesPage === 'function') {
              initFixGamesPage();
            }
          }, 50);
        };
        document.head.appendChild(script);
      } else {
        // Script sudah ter-load, langsung init
        setTimeout(() => {
          if (typeof initFixGamesPage === 'function') {
            initFixGamesPage();
          }
        }, 50);
      }
    }
  }

  // Jika halaman adalah Settings → load license info dan subscribe logs
  if (page === "settings") {
    // Wait a bit untuk memastikan script di settings.html sudah ter-load
    setTimeout(() => {
      // Load license info (fungsi ada di settings.html)
      if (typeof loadSettingsLicenseInfo === 'function') {
        loadSettingsLicenseInfo();
      } else {
        // Fallback: load license info via bridge langsung
        if (window.desktopBridge && typeof window.desktopBridge.getLicenseInfo === 'function') {
          window.desktopBridge.getLicenseInfo().then(licenseInfo => {
            const planBadge = document.getElementById('settings-license-plan-badge');
            const keyDisplay = document.getElementById('settings-license-key');
            const deviceDisplay = document.getElementById('settings-device-id');
            
            if (planBadge) {
              if (licenseInfo.isValid && licenseInfo.isActive) {
                const planText = licenseInfo.plan === 'premium' ? 'Premium' : 'Standard';
                planBadge.textContent = planText;
                planBadge.className = licenseInfo.plan === 'premium' 
                  ? 'px-3 py-1 rounded text-sm font-medium bg-yellow-500/20 text-yellow-400'
                  : 'px-3 py-1 rounded text-sm font-medium bg-blue-500/20 text-blue-400';
              } else {
                planBadge.textContent = 'Tidak Aktif';
                planBadge.className = 'px-3 py-1 rounded text-sm font-medium bg-red-500/20 text-red-400';
              }
            }
            
            if (keyDisplay) keyDisplay.textContent = licenseInfo.licenseKey || '-';
            if (deviceDisplay) deviceDisplay.textContent = licenseInfo.deviceId || '-';
          }).catch(e => {
            // Failed to load license info - non-critical
          });
        }
      }
      
      // Subscribe to logs (hanya jika belum subscribe)
      if (window.desktopBridge && typeof window.desktopBridge.send === 'function' && !window._settingsLogSubscribed) {
        window._settingsLogSubscribed = true;
        window.desktopBridge.send('SubscribeAppLog', {});
        // Load initial logs
        window.desktopBridge.send('GetAppLog', {});
      }

      // Mount update panel DOM binding setelah page siap
      if (window.GameHubUpdatePanel && typeof window.GameHubUpdatePanel.mount === 'function') {
        window.GameHubUpdatePanel.mount();
      }
    }, 100);
  } else {
    // Unsubscribe dari logs saat keluar dari Settings page
    if (window._settingsLogSubscribed && window.desktopBridge && typeof window.desktopBridge.send === 'function') {
      window._settingsLogSubscribed = false;
      window.desktopBridge.send('UnsubscribeAppLog', {});
    }
  }
}

// Load sidebar
async function loadSidebar() {
  const sidebar = await fetch("/components/sidebar.html").then((r) => r.text());
  document.getElementById("sidebar-container").innerHTML = sidebar;
  
  // Load license info setelah sidebar dimuat
  await loadLicenseInfo();
}

// Load and display license info
async function loadLicenseInfo() {
  try {
    if (window.desktopBridge && typeof window.desktopBridge.getLicenseInfo === 'function') {
      const licenseInfo = await window.desktopBridge.getLicenseInfo();
      
      const planBadge = document.getElementById('license-plan-badge');
      const keyDisplay = document.getElementById('license-key-display');
      const deviceDisplay = document.getElementById('license-device-display');
      
      if (planBadge) {
        if (licenseInfo.isValid && licenseInfo.isActive) {
          const planText = licenseInfo.plan === 'premium' ? 'Premium' : 'Standard';
          planBadge.textContent = planText;
          planBadge.className = licenseInfo.plan === 'premium' 
            ? 'text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400'
            : 'text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400';
        } else {
          planBadge.textContent = 'Tidak Aktif';
          planBadge.className = 'text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400';
        }
      }
      
      if (keyDisplay) {
        keyDisplay.textContent = licenseInfo.licenseKey || '-';
      }
      
      if (deviceDisplay) {
        // Tampilkan 16 karakter pertama dan terakhir dari device ID
        if (licenseInfo.deviceId && licenseInfo.deviceId.length > 32) {
          deviceDisplay.textContent = licenseInfo.deviceId.substring(0, 16) + '...' + licenseInfo.deviceId.substring(licenseInfo.deviceId.length - 16);
        } else {
          deviceDisplay.textContent = licenseInfo.deviceId || '-';
        }
      }
    }
  } catch (e) {
    // Failed to load license info - set default values
    const planBadge = document.getElementById('license-plan-badge');
    const keyDisplay = document.getElementById('license-key-display');
    const deviceDisplay = document.getElementById('license-device-display');
    
    if (planBadge) planBadge.textContent = '-';
    if (keyDisplay) keyDisplay.textContent = '-';
    if (deviceDisplay) deviceDisplay.textContent = '-';
  }
}

// Expose globally
window.loadLicenseInfo = loadLicenseInfo;

// Start app
loadSidebar().then(() => navigate("games"));
