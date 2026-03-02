// Logic for the newly redesigned Home (Dashboard)

let homePageData = {
  newFixGames: [],
  popularGames: [],
  popularGamesFull: [],
  popularGamesLimit: 24
};

// Initialize the Home page
async function initHomePage() {
  console.log('[Home] initHomePage started');

  // Tunggu: home data + games page pre-cache + games page pre-render
  // Semua berjalan bersamaan → loading screen hilang hanya setelah semua siap
  const precacheWait  = window._precachePromise       || Promise.resolve();
  const prerenderWait = window._gamesPrerenderPromise || Promise.resolve();

  await Promise.all([
    loadNewFixGames(),
    loadPopularGames(),
    precacheWait,    // data (RawDataset + FixGamesData)
    prerenderWait    // Games page pre-rendered ke persistent div
  ]);

  console.log('[Home] all data loaded + games pre-rendered, hiding loading screen...');

  // Hide loading screen
  const loadingScreen = document.getElementById('global-loading-screen');
  if (loadingScreen && !loadingScreen.classList.contains('hidden')) {
    loadingScreen.classList.add('opacity-0');
    setTimeout(() => loadingScreen.classList.add('hidden'), 500);
  }
  console.log('[Home] done.');
}


// Helper: fetch with AbortController timeout (default 15s)
async function fetchWithTimeout(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return res;
  } catch(e) {
    clearTimeout(timer);
    return null;
  }
}

/**
 * 1. MENGAMBIL NEW FIX GAMES (SLIDER)
 * Membaca new_fix_games.json lalu mencocokannya dengan fix_games.json / steam_games.json
 */
async function loadNewFixGames() {
  const container = document.getElementById('home-new-fixes');
  if (!container) return;

  try {
    let newFixAppIds = window._newFixGamesIds;
    if (!newFixAppIds || newFixAppIds.length === 0) {
      if (window.desktopBridge && typeof window.desktopBridge.getNewFixGamesData === 'function') {
        newFixAppIds = await window.desktopBridge.getNewFixGamesData(false);
      } else {
        const resList = await fetchWithTimeout('https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/new_fix_games.json');
        if (resList && resList.ok) newFixAppIds = await resList.json();
      }
      window._newFixGamesIds = newFixAppIds;
    }

    let fixGamesJson = window._fixGamesData;
    // Unpack object { games: [] } if it comes from router's raw dump
    if (fixGamesJson && !Array.isArray(fixGamesJson) && fixGamesJson.games) {
      fixGamesJson = fixGamesJson.games;
    }

    if (!fixGamesJson || !Array.isArray(fixGamesJson) || fixGamesJson.length === 0) {
      if (window.desktopBridge && typeof window.desktopBridge.getFixGamesData === 'function') {
        const fix = await window.desktopBridge.getFixGamesData(false);
        fixGamesJson = Array.isArray(fix) ? fix : (fix?.games || []);
      } else {
        const fixGamesRes = await fetchWithTimeout('https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/fix_games.json');
        if (fixGamesRes && fixGamesRes.ok) {
           const fix = await fixGamesRes.json();
           fixGamesJson = Array.isArray(fix) ? fix : (fix?.games || []);
        }
      }
      window._fixGamesData = fixGamesJson;
    }

    let steamGamesJson = window.steamGamesData;
    if (!steamGamesJson) {
      if (window.desktopBridge && typeof window.desktopBridge.getSteamGamesData === 'function') {
        steamGamesJson = await window.desktopBridge.getSteamGamesData(false);
      } else {
      try {
        const steamGamesRes = await fetchWithTimeout(`https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/steam_games/steam_games.json?t=${Date.now()}`);
        if (steamGamesRes && steamGamesRes.ok) {
          steamGamesJson = await steamGamesRes.json();
        }
      } catch (error) { console.error('Error fetching steam_games.json:', error); }
      }
      window.steamGamesData = steamGamesJson;
    }

    const compiledGames = [];
    if (newFixAppIds) {
      newFixAppIds.forEach(appid => {
        let game = Array.isArray(fixGamesJson) ? fixGamesJson.find(g => Number(g.appid) === Number(appid)) : null;
        if (!game && Array.isArray(steamGamesJson)) {
          game = steamGamesJson.find(g => Number(g.appid) === Number(appid));
        }
        if (game) {
          if (!game.category && Array.isArray(steamGamesJson) && steamGamesJson.includes(game)) {
            game.category = 'steam-account'; 
          }
          compiledGames.push(game);
        }
      });
    }

    homePageData.newFixGames = compiledGames;
    renderNewFixGames(compiledGames);

  } catch (error) {
    container.innerHTML = `<div class="w-full text-center p-8 text-red-400">Gagal memuat New Fix Games: ${error.message}</div>`;
  }
}

/**
 * Render the Slider Cards
 */
function renderNewFixGames(games) {
  const container = document.getElementById('home-new-fixes');
  if (!container) return;

  if (games.length === 0) {
    container.innerHTML = `<div class="w-full text-center p-8 text-white/50">Belum ada game terbaru.</div>`;
    return;
  }

  container.innerHTML = '';
  games.forEach(game => {
    const isPremium = game.premium === true;
    const premiumLabel = isPremium ? "PREMIUM" : "STANDARD";
    const premiumColor = isPremium ? "bg-yellow-500 text-black px-2 py-[2px]" : "bg-gray-600 text-white px-2 py-[2px]";
    
    // Explicitly mirror Fix Games class names and padding
    const offlineBadgeHtml = game.aktivasi_offline 
      ? `<div class="absolute top-2 left-20 bg-blue-600 text-white text-[10px] px-2 py-[2px] rounded-md font-semibold shadow z-10">AKTIVASI OFFLINE</div>` 
      : (game.dapatkan_kode === true ? `<div class="absolute top-2 left-20 bg-purple-600 text-white text-[10px] px-2 py-[2px] rounded-md font-semibold shadow z-10">STEAM GUARD</div>` : '');

    const numericAppId = Number(game.appid) || 0;
    const accountIdentifier = (game.category === 'steam-account') ? (game.accountId || game.username || `${game.appid || ''}`) : '';
    const encodedCategory = encodeURIComponent(String(game.category || ''));
    const encodedAccountId = encodeURIComponent(String(accountIdentifier || ''));

    const html = `
      <div class="snap-start shrink-0 home-card-hover fix-game-card bg-[#151515] border border-white/5 cursor-pointer fade-up" 
            onclick="navigate('fix-games-detail', { appid: ${numericAppId}, isSteamAccount: ${game.category === 'steam-account'}, accountId: '${encodedAccountId}' })"
            style="min-width: 200px; width: 200px; height: 300px; position: relative;">
        <img src="${escapeHtml(game.poster || '')}" 
             alt="${escapeHtml(game.title)}"
             style="width: 100%; height: 100%; object-fit: cover;"
             onerror="this.onerror=null;this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';">
        <div class="absolute top-2 left-2 ${premiumColor} text-[10px] rounded-md font-semibold shadow z-10">
          ${premiumLabel}
        </div>
        ${offlineBadgeHtml}
        <div class="fix-game-card-overlay">
          <div class="fix-game-card-title text-white">${escapeHtml(game.title || 'Unknown')}</div>
          <div class="fix-game-card-publisher">${escapeHtml(game.publisher || '')}</div>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
  });

  setTimeout(updateHomeSliderButtons, 100);
}


/**
 * 2. MENGAMBIL MOST POPULAR GAMES (GRID)
 * Membaca appid_populer.json dan merge objectnya dengan main steam database
 */
async function loadPopularGames() {
  const container = document.getElementById('home-popular-games');
  if (!container) return;

  try {
    let popularAppIds = window._popularGamesIds;
    if (!popularAppIds || popularAppIds.length === 0) {
      if (window.desktopBridge && typeof window.desktopBridge.getPopularGamesData === 'function') {
        popularAppIds = await window.desktopBridge.getPopularGamesData(false);
      } else {
        const resList = await fetchWithTimeout('https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/appid_populer.json');
        if (resList && resList.ok) popularAppIds = await resList.json();
      }
      window._popularGamesIds = popularAppIds;
    }

    let arrDb = window.originalData;
    if (!arrDb || arrDb.length <= 10) {
      if (window.desktopBridge && typeof window.desktopBridge.getRawDataset === 'function') {
        const fullRaw = await window.desktopBridge.getRawDataset(false);
        arrDb = Array.isArray(fullRaw) ? fullRaw : Object.values(fullRaw || {});
      } else {
        const response = await fetchWithTimeout('https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/games_list.json');
        if (response && response.ok) arrDb = await response.json();
      }
      window.originalData = arrDb;
    }

    const compiledPopular = [];
    if (popularAppIds && arrDb) {
      popularAppIds.forEach(appid => {
        const game = arrDb.find(g => Number(g.appid || g.id) === Number(appid));
        if (game) compiledPopular.push(game);
      });
    }

    homePageData.popularGamesFull = compiledPopular;
    homePageData.popularGamesLimit = 24;
    renderPopularGames();

  } catch (error) {
    container.innerHTML = `<div class="w-full text-center col-span-full p-8 text-red-400">Gagal memuat Popular Games: ${error.message}</div>`;
  }
}

/**
 * Render Grid Popular
 */
function renderPopularGames() {
  const container = document.getElementById('home-popular-games');
  const btnContainer = document.getElementById('home-popular-load-more-container');
  if (!container) return;

  const games = homePageData.popularGamesFull || [];
  if (games.length === 0) {
    container.innerHTML = `<div class="w-full text-center col-span-full p-8 text-white/50">Belum ada game populer. Data sedang sinkronisasi?</div>`;
    if (btnContainer) btnContainer.classList.add('hidden');
    return;
  }

  container.innerHTML = '';
  // Limit games up to popularGamesLimit
  const toRender = games.slice(0, homePageData.popularGamesLimit);
  
  // Reuse local custom html builder for popular cards
  toRender.forEach(game => {
     if (typeof renderPopularCardHTML === 'function') {
        const rawHtml = renderPopularCardHTML(game);
        container.innerHTML += rawHtml;
     }
  });

  // Toggle load more button visibility logic
  if (btnContainer) {
    if (homePageData.popularGamesLimit >= games.length) {
      btnContainer.classList.add('hidden');
    } else {
      btnContainer.classList.remove('hidden');
    }
  }
}

function loadMorePopularGames() {
  homePageData.popularGamesLimit += 24;
  renderPopularGames();
}

/**
 * Custom Popular Card renderer for grid layout (portrait style)
 */
function renderPopularCardHTML(game) {
  // Use normalized price for premium detection when available
  const isPremium = (game.price_normalized || game.price_initial || 0) >= PREMIUM_MIN;
  const premiumLabel = isPremium ? "PREMIUM" : "STANDAR";
  const premiumColor = isPremium
    ? "bg-yellow-500 text-black"
    : "bg-gray-600 text-white";

  let protection = '';
  if (game.protection === true) {
    protection = `<span class="bg-red-600 text-white text-[10px] px-2 py-[2px] rounded-md shadow z-10">DENUVO</span>`;
  }

  const appidNum = Number(game.appid);
  const title = escapeHtml(game.title || 'Unknown');
  const genre = escapeHtml(game.genre_display || (Array.isArray(game.genre) ? game.genre.join(', ') : game.genre || ''));
  const headerImg = escapeHtml(game.header || '');

  // Portrait Grid Card Design
  return `
    <div class="home-card-hover bg-[#151515] border border-white/5 rounded-xl cursor-pointer fade-up overflow-hidden flex flex-col" 
         onclick="typeof openDetail === 'function' ? openDetail(${appidNum}) : null">
      
      <!-- Top Image Section -->
      <div class="relative w-full aspect-video bg-black flex-shrink-0">
        <img src="${headerImg}" class="w-full h-full object-cover"
             onerror="(function(img){img.onerror=null;img.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';})(this);">
        
        <!-- Premium Badge -->
        <div class="absolute top-2 left-2 ${premiumColor} text-[10px] px-2 py-[2px] rounded-md font-semibold shadow z-10">
          ${premiumLabel}
        </div>
        
        <!-- Denuvo Badge -->
        <div class="absolute top-2 right-2 flex gap-1">
          ${protection}
        </div>
      </div>

      <!-- Bottom Info Section -->
      <div class="p-4 flex flex-col flex-grow justify-between">
        <div>
          <h3 class="text-white font-semibold text-[15px] leading-tight line-clamp-2" title="${title}">${title}</h3>
        </div>
        <div class="mt-3 flex items-center justify-between text-gray-500 text-[11px] border-t border-white/5 pt-2">
          <span>AppID:</span>
          <span class="font-mono text-gray-400">${appidNum}</span>
        </div>
      </div>
    </div>
  `;
}

// ------------- UTILS --------------
function scrollHomeSlider(direction) {
  const container = document.getElementById('home-new-fixes');
  if (!container) return;
  const scrollAmount = Math.max(container.clientWidth * 0.8, 300); // geser 80% dari lebar layar
  
  if (direction === 'left') {
    container.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
  } else {
    container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  }
}

function updateHomeSliderButtons() {
  const container = document.getElementById('home-new-fixes');
  const btnLeft = document.getElementById('home-slider-left');
  const btnRight = document.getElementById('home-slider-right');
  if (!container || !btnLeft || !btnRight) return;

  const isAtStart = container.scrollLeft <= 10;
  const isAtEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 10;

  btnLeft.disabled = isAtStart;
  btnRight.disabled = isAtEnd;
}

// Bootstrap
// We wait for router or direct load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHomePage);
} else {
  initHomePage();
}

window.loadMorePopularGames = loadMorePopularGames;

