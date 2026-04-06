// Persistent Games page container — Games page dirender sekali, disimpan di div khusus
// sehingga event listener tetap aktif dan data tidak perlu di-load ulang
let _gamesPageLoaded = false;   // apakah games page sudah pernah dirender
let _currentPage = '';          // halaman yang sedang aktif

async function navigate(page, params = {}) {
  // Store params for detail pages
  window._lastNavigateParams = params;

  const container     = document.getElementById("app-content");
  const gamesPersist  = document.getElementById("games-page-persistent");
  const sidebarDashboard = document.getElementById("nav-dashboard");
  const sidebarGames     = document.getElementById("nav-games");
  const sidebarLibrary   = document.getElementById("nav-library");
  const sidebarFixGames  = document.getElementById("nav-fix-games");
  const sidebarSettings  = document.getElementById("nav-settings");

  // ----- GAMES PAGE: pakai persistent container -----
  if (page === "games" && !params.forceReload) {
    // Sembunyikan app-content, tampilkan games-page-persistent
    if (container)     container.style.display = "none";
    if (gamesPersist)  gamesPersist.style.display = "";

    // Update sidebar active state
    [sidebarDashboard, sidebarGames, sidebarLibrary, sidebarFixGames, sidebarSettings]
      .forEach(el => el?.classList.remove("bg-[#1f1f1f]", "text-white"));
    sidebarGames?.classList.add("bg-[#1f1f1f]", "text-white");

    // DESTROY app-content contents to REMOVE DUPLICATE IDs (like detail-drawer, searchInput)
    if (container) container.innerHTML = "";

    if (_gamesPageLoaded) {
      // Sudah dirender sebelumnya — langsung tampil, tidak perlu initGamesPage lagi
      console.log('[navigate] Games page restored from persistent DOM (instant)');
      _currentPage = "games";
      if (typeof window.resetLibraryFilter === 'function') window.resetLibraryFilter();
      else window.libraryFilterActive = false;
      // Re-apply filters agar state filter tetap sinkron
      try {
        if (typeof applyFilters === 'function') {
          setTimeout(() => { try { applyFilters(true); } catch(e) {} }, 100);
        }
      } catch(e) {}
      return;
    }

    // Pertama kali buka Games page — muat dan render ke persistent container
    console.log('[navigate] Games page first load into persistent container');
    _currentPage = "games";
    _gamesPageLoaded = false; // akan di-set true setelah selesai

    // Fetch games.html dan inject ke persistent container
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch("/app/games.html", { signal: ctrl.signal });
      clearTimeout(t);
      const html = await res.text();
      gamesPersist.innerHTML = html;
    } catch(e) {
      console.error('[navigate] Failed to load games.html:', e);
      if (container) container.style.display = "";
      if (gamesPersist) gamesPersist.style.display = "none";
      return;
    }

    // Inject scripts dari games.html
    try {
      const temp = document.createElement('div');
      temp.innerHTML = gamesPersist.innerHTML;
      const scripts = temp.querySelectorAll('script');
      scripts.forEach((old) => {
        const s = document.createElement('script');
        if (old.type) s.type = old.type;
        if (old.src) {
          const srcAttr = old.getAttribute('src');
          const existing = document.head.querySelector(`script[src="${srcAttr}"]`);
          if (!existing) {
            s.src = srcAttr;
            s.onload = () => console.log('[navigate] Games script loaded:', srcAttr);
            document.head.appendChild(s);
          }
        } else {
          s.textContent = old.textContent || '';
          document.body.appendChild(s);
        }
      });
    } catch(e) { console.error('[navigate] Games script inject error:', e); }

    // Jalankan initGamesPage
    try {
      if (typeof window.resetLibraryFilter === 'function') window.resetLibraryFilter(); else window.libraryFilterActive = false;
      
      // Load filter panel HTML into the filter-panel container
      const filterPanelHtml = await fetch("/components/filter-panel.html").then((r) => r.text());
      const filterPanelContainer = document.getElementById("filter-panel");
      if (filterPanelContainer) {
        filterPanelContainer.innerHTML = filterPanelHtml;
      }
      
      if (typeof initGamesPage === 'function') {
        await initGamesPage();
      }
      _gamesPageLoaded = true;
    } catch(e) { console.error('[navigate] initGamesPage error:', e); }
    return;
  }

  // ----- HALAMAN LAIN: tampilkan app-content, sembunyikan games-page-persistent -----
  _currentPage = page;
  if (container)    container.style.display = "";
  if (gamesPersist) gamesPersist.style.display = "none";

  // Load page HTML with timeout
  let html = '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`/app/${page}.html`, { signal: ctrl.signal });
    clearTimeout(t);
    html = await res.text();
  } catch(e) {
    console.error('[navigate] Failed to load page HTML:', page, e);
    return;
  }

  // Inject HTML
  container.innerHTML = html;

  // Process script tags from the loaded HTML
  try {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const scripts = temp.querySelectorAll('script');
    scripts.forEach((old) => {
      const s = document.createElement('script');
      if (old.type) s.type = old.type;

      if (old.src) {
        const srcAttr = old.getAttribute('src');
        const existing = document.head.querySelector(`script[src="${srcAttr}"]`);
        if (!existing) {
          // First load - attach onload to call page init
          s.src = srcAttr;
          s.onload = () => {
            console.log('[navigate] Script loaded:', srcAttr);
            if (srcAttr.includes('home.js') && typeof window.initHomePage === 'function') {
              console.log('[navigate] Calling initHomePage from onload');
              window.initHomePage();
            }
          };
          document.head.appendChild(s);
        } else {
          // Already in DOM - call init function directly with retry
          console.log('[navigate] Script already loaded:', srcAttr);
          if (srcAttr.includes('home.js')) {
            const tryInit = (attempt) => {
              if (typeof window.initHomePage === 'function') {
                console.log('[navigate] Calling initHomePage (attempt', attempt, ')');
                window.initHomePage();
              } else if (attempt < 10) {
                setTimeout(() => tryInit(attempt + 1), 200);
              } else {
                console.error('[navigate] initHomePage still not found after retries!');
              }
            };
            tryInit(1);
          }
        }
      } else {
        // Inline script
        s.textContent = old.textContent || '';
        document.body.appendChild(s);
      }
    });
  } catch (e) {
    console.error('[navigate] Script inject error:', e);
  }


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
      await toggleLibraryFilter(true);
    } else if (typeof initGamesPage === "function") {
      // Fallback: init games page lalu aktifkan library filter
      await initGamesPage();
      if (typeof toggleLibraryFilter === "function") {
        await toggleLibraryFilter(true);
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
    const category = navigateParams.category || params.category || null;
    const accountId = navigateParams.accountId || params.accountId;
    
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
            initFixGameDetailPage(parseInt(appid), isSteamAccount, accountId || null, category);
          }
        }, 50);
      };
      document.head.appendChild(script);
    } else {
      setTimeout(() => {
        if (typeof initFixGameDetailPage === 'function') {
          initFixGameDetailPage(parseInt(appid), isSteamAccount, accountId || null, category);
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
  console.log('[sidebar] Fetching sidebar.html...');
  const sidebar = await fetch("/components/sidebar.html").then((r) => r.text());
  document.getElementById("sidebar-container").innerHTML = sidebar;
  console.log('[sidebar] Sidebar loaded, loading license info...');
  // Load license info setelah sidebar dimuat
  try {
    await loadLicenseInfo();
    console.log('[sidebar] License info loaded.');
  } catch(e) {
    console.warn('[sidebar] loadLicenseInfo error (non-fatal):', e.message);
  }
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

// Helper: update teks status di loading screen
function setLoadingStatus(text) {
  try {
    const el = document.getElementById('global-loading-status');
    if (el) el.textContent = text;
  } catch(e) {}
}

async function loadSteamGamesLocalFirst() {
  const localCandidates = ['/data/steam_games.json', './data/steam_games.json', 'data/steam_games.json'];
  for (const path of localCandidates) {
    try {
      const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json)) return json;
      }
    } catch (e) {}
  }

  if (window.desktopBridge && typeof window.desktopBridge.getSteamGamesData === 'function') {
    try {
      const bridgeData = await window.desktopBridge.getSteamGamesData(false);
      if (Array.isArray(bridgeData)) return bridgeData;
    } catch (e) {}
  }

  try {
    const remoteRes = await fetch(`https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/steam_games/steam_games.json?t=${Date.now()}`, { cache: 'no-store' });
    if (remoteRes.ok) {
      const remoteJson = await remoteRes.json();
      if (Array.isArray(remoteJson)) return remoteJson;
    }
  } catch (e) {}

  return null;
}

// Initialize app and load essential data
async function initApp() {
  try {
    console.log('[initApp] Step 1: Fetching SteamGamesData (local-first)...');
    setLoadingStatus('Memuat data akun game...');
    // Predownload essential data caches
    try {
      const acc = await loadSteamGamesLocalFirst();
      if (acc && Array.isArray(acc)) {
        window.steamGamesData = acc;
        console.log('[initApp] SteamGamesData loaded, count:', window.steamGamesData?.length || 0);
      } else {
        console.log('[initApp] SteamGamesData unavailable during prefetch');
      }
    } catch (e) {
      console.warn('[initApp] Failed caching steam games data at startup:', e);
    }

    // Start background pre-fetch for games page data (RawDataset + FixGamesData)
    // These run in background - home.js will await window._precachePromise before hiding loading screen
    console.log('[initApp] Starting background pre-fetch for games page data...');
    setLoadingStatus('Mengunduh database seluruh game (147.000+ game)...');
    window._precachePromise = Promise.all([
      // Pre-fetch raw dataset (games page)
      (async () => {
        try {
          if (window.desktopBridge && typeof window.desktopBridge.getRawDataset === 'function') {
            console.log('[initApp] [bg] getRawDataset starting...');
            const raw = await window.desktopBridge.getRawDataset(false);
            if (raw) {
              window.originalData = Array.isArray(raw) ? raw : Object.values(raw);
              setLoadingStatus(`Database game siap (${window.originalData.length.toLocaleString()} game)`);
              console.log('[initApp] [bg] getRawDataset done, count:', window.originalData?.length || 0);
            }
          }
        } catch(e) { console.warn('[initApp] [bg] getRawDataset error:', e.message); }
      })(),
      // Pre-fetch fix games data
      (async () => {
        try {
          if (window.desktopBridge && typeof window.desktopBridge.getFixGamesData === 'function') {
            console.log('[initApp] [bg] getFixGamesData starting...');
            const fix = await window.desktopBridge.getFixGamesData(false);
            if (fix) {
              window._fixGamesData = fix;
              console.log('[initApp] [bg] getFixGamesData done');
            }
          }
        } catch(e) { console.warn('[initApp] [bg] getFixGamesData error:', e.message); }
      })()
    ]).catch(e => console.warn('[initApp] precache error:', e));

    console.log('[initApp] Step 2: Loading sidebar...');
    setLoadingStatus('Memuat tampilan sidebar...');
    await loadSidebar();

    // Start pre-rendering Games page into the hidden persistent container
    // This runs concurrently with loadSidebar and navigate('dashboard')
    // so by the time loading screen hides, Games page is already rendered!
    window._gamesPrerenderPromise = (async () => {
      try {
        // Wait for raw data first (needed by initGamesPage)
        await window._precachePromise;
        
        if (!window.originalData || window.originalData.length < 100) {
          console.log('[initApp] [games-prerender] No originalData, skipping prerender');
          return;
        }
        
        setLoadingStatus('Menyiapkan halaman Games...');
        console.log('[initApp] [games-prerender] Starting games page prerender...');
        
        const gamesPersist = document.getElementById('games-page-persistent');
        if (!gamesPersist) return;
        
        // Fetch and inject games.html into persistent container (hidden)
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch('/app/games.html', { signal: ctrl.signal });
        clearTimeout(t);
        const html = await res.text();
        gamesPersist.innerHTML = html;
        
        // Load filter panel HTML into the filter-panel container
        try {
          const logToTerm = (m) => { try { if (window.desktopBridge) window.desktopBridge.send('AppLog', { message: m }); } catch(ex){} };
          logToTerm('[games-prerender] Memuat filter-panel.html...');
          const filterPanelHtml = await fetch("/components/filter-panel.html").then((r) => r.text());
          const filterPanelContainer = gamesPersist.querySelector("#filter-panel");
          if (filterPanelContainer) {
            filterPanelContainer.innerHTML = filterPanelHtml;
            logToTerm(`[games-prerender] filter-panel berhasil diinjeksi! Panjang string HTML: ${filterPanelHtml.length}`);
          } else {
            logToTerm('[games-prerender] ERROR FATAL: elemen #filter-panel TIDAK DITEMUKAN di dalam gamesPersist!');
          }
        } catch(e) {
          console.warn('[initApp] [games-prerender] Failed to load filter panel:', e);
          try { if(window.desktopBridge) window.desktopBridge.send('AppLog', { message: `[games-prerender] ERROR memuat filter-panel: ${e.message}` }); } catch(ex){}
        }
        
        // Load scripts dari games.html yang belum ada di head
        await new Promise((resolve) => {
          const temp = document.createElement('div');
          temp.innerHTML = html;
          const scripts = Array.from(temp.querySelectorAll('script[src]'));
          let pending = 0;
          scripts.forEach((old) => {
            const srcAttr = old.getAttribute('src');
            if (!document.head.querySelector(`script[src="${srcAttr}"]`)) {
              pending++;
              const s = document.createElement('script');
              s.src = srcAttr;
              s.onload = () => { pending--; if (pending === 0) resolve(); };
              s.onerror = () => { pending--; if (pending === 0) resolve(); };
              document.head.appendChild(s);
            }
          });
          if (pending === 0) resolve();
        });
        
        // Small delay to let scripts initialize
        await new Promise(r => setTimeout(r, 100));
        
        // Run initGamesPage() to render games into the hidden container
        if (typeof initGamesPage === 'function') {
          console.log('[initApp] [games-prerender] Running initGamesPage()...');
          if (typeof window.resetLibraryFilter === 'function') window.resetLibraryFilter(); else window.libraryFilterActive = false;
          await initGamesPage();
          _gamesPageLoaded = true;
          console.log('[initApp] [games-prerender] Games page pre-rendered! Ready for instant display.');
          setLoadingStatus('Semua siap!');
        }
      } catch(e) {
        console.warn('[initApp] [games-prerender] Error:', e.message);
      }
    })();

    console.log('[initApp] Step 3: Navigating to dashboard...');
    navigate('dashboard');
    console.log('[initApp] Step 4: Navigate dispatched.');
    
  } catch (err) {
    console.error('[initApp] Critical error during app init:', err);
    // Hide loading screen anyway to show UI safely
    const loadingScreen = document.getElementById('global-loading-screen');
    if (loadingScreen) loadingScreen.classList.add('hidden');
  }
}

// Expose globally
window.loadLicenseInfo = loadLicenseInfo;
window.initApp = initApp;

// Start app
initApp();
