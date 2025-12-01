let originalData = [];
let filteredData = [];
let currentPage = 1;
// Track hidden cards (removed games that should stay hidden until library page reload)
let hiddenCards = new Set();
// Raw-only: tidak ada antrian appid atau proses build incremental
let buildingInProgress = false;
// Cache built pages so navigation back/forward shows the same items
const pageCache = {}; // pageNumber -> array of game objects
// Persisted page cache key and limits
const PAGE_CACHE_KEY = 'gamehub_page_cache';
const MAX_PAGE_CACHE = 5; // max pages to keep in localStorage

function loadPageCache() {
  try {
    const raw = localStorage.getItem(PAGE_CACHE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      Object.keys(pageCache).forEach(k => delete pageCache[k]);
      Object.keys(obj).forEach((k) => {
        // ensure we store arrays
        if (Array.isArray(obj[k])) pageCache[k] = obj[k];
      });
    }
  } catch (e) {
    // ignore
  }
}

function prunePageCache() {
  try {
    const keys = Object.keys(pageCache).map(k => parseInt(k,10)).filter(n => !isNaN(n)).sort((a,b) => b - a);
    if (keys.length <= MAX_PAGE_CACHE) return;
    const keep = new Set(keys.slice(0, MAX_PAGE_CACHE).map(String));
    Object.keys(pageCache).forEach(k => { if (!keep.has(k)) delete pageCache[k]; });
  } catch (e) {}
}

function savePageCache() {
  try {
    prunePageCache();
    localStorage.setItem(PAGE_CACHE_KEY, JSON.stringify(pageCache));
  } catch (e) {
    // ignore storage errors
  }
}
// --- Local Steam data merge helpers ---
// Load override data: combines built-in + global override (from GitHub) + user override (local)
// Priority: User Override > Global Override > Built-in Override > Raw Data
async function loadLocalSteamData() {
  try {
    const overrideMap = new Map();
    
    // 1. Load built-in local_data_steam.json (from app bundle) - PRIORITY 3 (terendah)
    // Opsional: bisa dihapus jika tidak digunakan, tidak akan error
    try {
      const res = await fetch('/data/local_data_steam.json', { cache: 'no-cache' });
      if (res.ok) {
        const obj = await res.json();
        if (obj && typeof obj === 'object') {
          for (const [k, v] of Object.entries(obj)) {
            const id = Number(k);
            if (!Number.isFinite(id)) continue;
            overrideMap.set(id, v || {});
          }
        }
      }
    } catch (e) {
      // File tidak ada? Tidak apa-apa, lanjut ke global override
    }
    
    // 2. Load global override from C# bridge (downloaded from GitHub, cached on disk) - PRIORITY 2
    // Global override OVERWRITES built-in (prioritas lebih tinggi)
    if (window.desktopBridge && typeof window.desktopBridge.getGlobalOverride === 'function') {
      try {
        // Load from disk (false = use cache, tapi setelah force update cache sudah ter-update)
        // Setelah force update, in-memory cache sudah di-clear di C#, jadi akan load dari disk yang baru
        const globalOverride = await window.desktopBridge.getGlobalOverride(false);
        if (globalOverride && typeof globalOverride === 'object') {
          const overrideCount = Object.keys(globalOverride).length;
          for (const [k, v] of Object.entries(globalOverride)) {
            const id = Number(k);
            if (!Number.isFinite(id)) continue;
            // Global override overwrites built-in (jika ada)
            overrideMap.set(id, v || {});
          }
          // Log untuk debug
          if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
            try {
              window.desktopBridge.send('AppLog', { message: `[LoadOverride] Loaded ${overrideCount} override entries from global override` });
            } catch (e) {}
          }
        }
      } catch (e) {
        if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
          try {
            window.desktopBridge.send('AppLog', { message: `[LoadOverride] Error loading global override: ${e.message || 'Unknown'}` });
          } catch (e2) {}
        }
      }
    }
    
    // 3. Load user override from C# bridge (user-specific) - PRIORITY 1 (TERTINGGI)
    // User override OVERWRITES semua (prioritas tertinggi)
    if (window.desktopBridge && typeof window.desktopBridge.getUserOverride === 'function') {
      try {
        const userOverride = await window.desktopBridge.getUserOverride();
        if (userOverride && typeof userOverride === 'object') {
          for (const [k, v] of Object.entries(userOverride)) {
            const id = Number(k);
            if (!Number.isFinite(id)) continue;
            // User override has highest priority (overwrites everything)
            overrideMap.set(id, v || {});
          }
        }
      } catch (e) {}
    }
    
    return overrideMap;
  } catch (e) { return new Map(); }
}

function applyLocalOverridesToItem(rawItem, localItem) {
  try {
    const merged = Object.assign({}, rawItem);
    const keys = [
      'title','header','genre','genre_display','short_description',
      'developers','publishers','release_date','price_display','price_normalized','price_initial','protection','last_update'
    ];
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(localItem, k)) {
        merged[k] = localItem[k];
      }
    }
    merged.appid = Number(merged.appid || localItem.appid || rawItem.appid || 0);
    const pn = Number(merged.price_normalized ?? merged.price_initial ?? 0) || 0;
    merged.price_normalized = pn;
    merged.price_initial = Number(merged.price_initial ?? pn) || pn;
    return merged;
  } catch (e) { return rawItem; }
}

function coerceLocalEntry(appid, local) {
  try {
    return {
      appid: Number(appid),
      title: String(local.title || ''),
      header: String(local.header || ''),
      genre: local.genre || local.genre_display || '',
      genre_display: local.genre_display || local.genre || '',
      short_description: String(local.short_description || ''),
      developers: Array.isArray(local.developers) ? local.developers : (local.developers ? [String(local.developers)] : []),
      publishers: Array.isArray(local.publishers) ? local.publishers : (local.publishers ? [String(local.publishers)] : []),
      release_date: String(local.release_date || ''),
      price_display: String(local.price_display || ''),
      price_normalized: Number(local.price_normalized ?? 0) || 0,
      price_initial: Number(local.price_initial ?? local.price_normalized ?? 0) || 0,
      protection: (local.protection === true) ? true : (local.protection === false ? false : null),
      last_update: local.last_update || ''
    };
  } catch (e) { return { appid: Number(appid) }; }
}

async function mergeWithLocalDataset(arr) {
  try {
    const localMap = await loadLocalSteamData();
    if (!(localMap && localMap.size)) return arr;
    const byId = new Map();
    const out = [];
    // First: process existing items from raw data and apply overrides
    for (const it of arr) {
      const id = Number(it.appid || it.id);
      byId.set(id, true);
      const local = localMap.get(id);
      out.push(local ? applyLocalOverridesToItem(it, local) : it);
    }
    // Then: add new items from override that don't exist in raw data
    let addedCount = 0;
    for (const [id, local] of localMap.entries()) {
      if (!byId.has(id)) {
        const newEntry = coerceLocalEntry(id, local);
        if (newEntry && newEntry.appid) {
          out.push(newEntry);
          addedCount++;
        }
      }
    }
    // Log jika ada game baru ditambahkan
    if (addedCount > 0 && window.desktopBridge && typeof window.desktopBridge.send === 'function') {
      try {
        window.desktopBridge.send('AppLog', { message: `[Merge] ${addedCount} game baru ditambahkan dari override` });
      } catch (e) {}
    }
    return out;
  } catch (e) { return arr; }
}
// Configuration / storage keys
// Raw-only: nonaktifkan builder dan storage terkait
const BUILD_CONCURRENCY = 0;
const REMAINING_KEY = 'gamehub_remaining_appids';
const BUILD_CACHE_KEY = 'gamehub_built_appids';

function saveRemaining() { /* raw-only: tidak digunakan */ }

// Raw-only: indikator scrape dihapus

// Raw-only: remove proxy banner and handlers

// Raw-only: indikator scrape dihapus

// Blocking centered overlay for explicit waits (e.g., user clicked Next and page
// must be filled). Can be closable or show a final message.
function showBlockingOverlay(message, options = {}) {
  try {
    let overlay = document.getElementById('gamehub-block-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'gamehub-block-overlay';
      overlay.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:10000';
      const bg = document.createElement('div');
      bg.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.6)';
      const box = document.createElement('div');
      box.style.cssText = 'position:relative;min-width:320px;max-width:90%;background:#101010;padding:20px;border-radius:12px;color:#fff;display:flex;flex-direction:column;align-items:center;gap:12px;box-shadow:0 10px 40px rgba(0,0,0,0.6)';
      const spinner = document.createElement('div');
      spinner.id = 'gamehub-block-spinner';
      spinner.style.cssText = 'width:36px;height:36px;border-radius:50%;border:4px solid rgba(255,255,255,0.08);border-top-color:#9b5cff;animation:gamehub-spin 1s linear infinite';
      const text = document.createElement('div');
      text.id = 'gamehub-block-overlay-text';
      text.style.cssText = 'text-align:center;font-size:15px';
      // Progress bar container
      const progressContainer = document.createElement('div');
      progressContainer.id = 'gamehub-block-progress-container';
      progressContainer.style.cssText = 'width:100%;display:none;flex-direction:column;gap:8px;margin-top:4px';
      const progressBarBg = document.createElement('div');
      progressBarBg.style.cssText = 'width:100%;height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden';
      const progressBar = document.createElement('div');
      progressBar.id = 'gamehub-block-progress-bar';
      progressBar.style.cssText = 'height:100%;background:linear-gradient(90deg,#9b5cff,#6d28d9);border-radius:4px;width:0%;transition:width 0.3s ease';
      const progressText = document.createElement('div');
      progressText.id = 'gamehub-block-progress-text';
      progressText.style.cssText = 'text-align:center;font-size:13px;color:#9b5cff;font-weight:500';
      progressBarBg.appendChild(progressBar);
      progressContainer.appendChild(progressBarBg);
      progressContainer.appendChild(progressText);
      box.appendChild(spinner);
      box.appendChild(text);
      box.appendChild(progressContainer);
      overlay.appendChild(bg);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    }
    const textEl = document.getElementById('gamehub-block-overlay-text');
    if (textEl) textEl.textContent = message || 'Mohon tunggu — sedang mengumpulkan data...';
    
    // Show/hide progress bar based on options
    const progressContainer = document.getElementById('gamehub-block-progress-container');
    const spinner = document.getElementById('gamehub-block-spinner');
    if (options.showProgress) {
      if (progressContainer) progressContainer.style.display = 'flex';
      if (spinner) spinner.style.display = 'none';
      updateBlockingOverlayProgress(0);
    } else {
      if (progressContainer) progressContainer.style.display = 'none';
      if (spinner) spinner.style.display = 'block';
    }
    
    overlay.style.display = 'flex';
    // If closable option provided, show a small dismiss button
    if (options.closable) {
      if (!document.getElementById('gamehub-block-dismiss')) {
        const btn = document.createElement('button');
        btn.id = 'gamehub-block-dismiss';
        btn.textContent = options.dismissLabel || 'Tutup';
        btn.style.cssText = 'margin-top:6px;padding:6px 10px;border-radius:8px;background:#222;border:1px solid rgba(255,255,255,0.06);color:#fff;cursor:pointer';
        btn.onclick = () => hideBlockingOverlay();
        const box = overlay.querySelector('div:nth-child(2)');
        if (box) box.appendChild(btn);
      }
      document.getElementById('gamehub-block-dismiss').style.display = 'inline-block';
    } else {
      if (document.getElementById('gamehub-block-dismiss')) document.getElementById('gamehub-block-dismiss').style.display = 'none';
    }

    // If retry option provided, show a 'Coba Lagi' button (raw-only: no builder)
    if (options.retry) {
      if (!document.getElementById('gamehub-block-retry')) {
        const r = document.createElement('button');
        r.id = 'gamehub-block-retry';
        r.textContent = options.retryLabel || 'Coba Lagi';
        r.style.cssText = 'margin-top:6px;padding:6px 10px;border-radius:8px;background:#5b21b6;border:1px solid rgba(255,255,255,0.06);color:#fff;cursor:pointer';
        r.onclick = async () => {
          try {
            // Use provided retryPage or the global currentPage
            const pageToRetry = options.retryPage || window.currentPage || 1;
            showBlockingOverlay('Memuat ulang halaman...');
            hideBlockingOverlay();
            try { renderPage(pageToRetry); } catch(e) {}
          } catch (e) {
            hideBlockingOverlay();
          }
        };
        const box2 = overlay.querySelector('div:nth-child(2)');
        if (box2) box2.appendChild(r);
      }
      document.getElementById('gamehub-block-retry').style.display = 'inline-block';
    } else {
      if (document.getElementById('gamehub-block-retry')) document.getElementById('gamehub-block-retry').style.display = 'none';
    }
  } catch (e) {}
}

function hideBlockingOverlay() {
  try {
    const overlay = document.getElementById('gamehub-block-overlay');
    if (overlay) overlay.style.display = 'none';
    // Reset progress
    updateBlockingOverlayProgress(0);
  } catch (e) {}
}

function updateBlockingOverlayProgress(percent, message = null) {
  try {
    const progressBar = document.getElementById('gamehub-block-progress-bar');
    const progressText = document.getElementById('gamehub-block-progress-text');
    if (progressBar) {
      const clamped = Math.max(0, Math.min(100, percent));
      progressBar.style.width = clamped + '%';
    }
    if (progressText) {
      if (message) {
        progressText.textContent = message;
      } else {
        const percentText = `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
        progressText.textContent = percentText;
      }
    }
  } catch (e) {}
}

// Show short centered transient message (replaced with premium modal)
function showTransientMessage(msg, ms = 4000, type = 'info') {
  try {
    if (typeof showPremiumToast === 'function') {
      showPremiumToast(msg, ms, type);
    } else {
      // Fallback to old method if modal.js not loaded
      let t = document.getElementById('gamehub-transient');
      if (!t) {
        t = document.createElement('div');
        t.id = 'gamehub-transient';
        t.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);background:#111;padding:12px 18px;border-radius:10px;color:#fff;z-index:11000;box-shadow:0 8px 30px rgba(0,0,0,0.6);font-size:14px;';
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.style.opacity = '1';
      t.style.display = 'block';
      setTimeout(() => {
        try { t.style.opacity = '0'; setTimeout(() => { t.style.display = 'none'; }, 300); } catch(e){}
      }, ms);
    }
  } catch (e) {}
}

function loadRemaining() {
  try { const raw = localStorage.getItem(REMAINING_KEY); if (!raw) return null; const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : null; } catch(e) { return null; }
}

function getBuiltCache() {
  try {
    const raw = localStorage.getItem(BUILD_CACHE_KEY) || '[]';
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) { return new Set(); }
}

// Normalize games array and prepare originalData + pageCache
function normalizeAndPrepareGames(arr, shuffle = true) {
  try {
    if (!Array.isArray(arr)) return [];
    // normalize entries
    const out = arr.map((g) => {
      const copy = Object.assign({}, g);
      copy.appid = Number(copy.appid || copy.id || 0);
      copy.title = String(copy.title || copy.name || '');
      // normalize header candidates
        // header_candidates no longer used; ensure header exists only
      // normalize price
      copy.price_normalized = Number(copy.price_normalized ?? copy.price_initial ?? 0) || 0;
      // keep price_initial for compatibility with other modules
      copy.price_initial = Number(copy.price_initial ?? copy.price_normalized) || copy.price_normalized;
      // protection: per user, true => denuvo, null => non-denuvo
      copy.protection = (copy.protection === true) ? true : false;
      // tier based on price threshold 350000
      copy.tier = (copy.price_normalized >= 350000) ? 'premium' : 'standard';
      return copy;
    });

    // shuffle once for randomized presentation but keep pages stable afterwards
    if (shuffle) {
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
    }

    // assign to originalData and filteredData
    originalData = out.slice();
    filteredData = originalData;

    // prefill pageCache for stable paging (PAGE_SIZE per page)
    try {
      Object.keys(pageCache).forEach(k => delete pageCache[k]);
      const totalPages = Math.ceil(originalData.length / PAGE_SIZE) || 0;
      for (let p = 1; p <= totalPages; p++) {
        const start = (p - 1) * PAGE_SIZE;
        pageCache[p] = originalData.slice(start, start + PAGE_SIZE);
      }
      savePageCache();
    } catch (e) {}

    loadGenreList(originalData);
    return out;
  } catch (e) { return []; }
}

// Load remote canonical JSON (GitHub raw or other raw URL) and prepare dataset
async function loadRemoteGameList(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('failed to fetch remote game list: ' + res.status);
    const raw = await res.json();
    // raw may be object keyed by appid or array
    let arr = Array.isArray(raw) ? raw : Object.values(raw || {});
    // Merge local overrides/additions
    arr = await mergeWithLocalDataset(arr);
    const prepared = normalizeAndPrepareGames(arr, true);
    // persist the manual url so future visits load the same
    try { localStorage.setItem('gamehub_manual_raw', url); } catch (e) {}

    // Render first page from cache (pageCache was prepared)
    try { await renderPage(1); } catch (e) {}
    // start protection worker if any
    try { if (typeof startProtectionWorker === 'function') startProtectionWorker(); } catch (e) {}
    return prepared;
  } catch (e) { throw e; }
}

// Expose helper for users to set raw URL at runtime
try {
  window.useRawGameList = async function(url) {
    if (!url) return;
    try {
      localStorage.setItem('gamehub_manual_raw', url);
    } catch (e) {}
    // set global var too
    try { window.GAMEHUB_RAW_URL = url; } catch (e) {}
    await loadRemoteGameList(url);
  };
  window.clearRawGameList = function() {
    try { localStorage.removeItem('gamehub_manual_raw'); } catch (e) {}
    try { delete window.GAMEHUB_RAW_URL; } catch (e) {}
    // clear page cache so app resumes sampling behaviour
    try { Object.keys(pageCache).forEach(k => delete pageCache[k]); savePageCache(); } catch (e) {}
    // reload initial flow
    try { initGamesPage(); } catch (e) {}
  };
} catch (e) {}

function addBuiltCache(id) {
  try {
    const s = getBuiltCache();
    s.add(id);
    localStorage.setItem(BUILD_CACHE_KEY, JSON.stringify([...s]));
  } catch (e) {}
}

async function initGamesPage() {
  // Load persisted page cache (if any) so navigation can be instant
  try { loadPageCache(); } catch(e) {}
  showSkeleton();

  // Raw-only init: muat daftar RAW GitHub sebagai data awal via desktop bridge
  try {
    // Default text (akan di-update berdasarkan source data)
    let overlayText = 'Memuat seluruh game. Ini hanya terjadi saat pertama kali membuka/menghapus data aplikasi...';
    let isFromCache = false;
    
    showBlockingOverlay(overlayText, { showProgress: true });

    // Attempt to fetch full raw (via desktop bridge when available).
    // Progress callback akan update overlay text berdasarkan source
    const progressWrapper = (percent, message) => {
      if (message) {
        // Deteksi jika dari cache (cek dulu sebelum download)
        if (message.includes('cache') || message.includes('memori') || 
            message.includes('Data dimuat dari cache') || 
            message.includes('Data dari memori') ||
            message.includes('Memuat dari cache')) {
          if (!isFromCache) {
            isFromCache = true;
            overlayText = 'Memuat seluruh games';
            const textEl = document.getElementById('gamehub-block-overlay-text');
            if (textEl) textEl.textContent = overlayText;
          }
        } else if (message.includes('download') || message.includes('Mengunduh') || 
                   message.includes('Memulai download')) {
          // Pastikan teks download ditampilkan
          if (isFromCache) {
            isFromCache = false;
            overlayText = 'Memuat seluruh game. Ini hanya terjadi saat pertama kali membuka/menghapus data aplikasi...';
            const textEl = document.getElementById('gamehub-block-overlay-text');
            if (textEl) textEl.textContent = overlayText;
          }
        }
      }
      // Update progress
      if (typeof updateBlockingOverlayProgress === 'function') {
        updateBlockingOverlayProgress(percent, message);
      }
    };
    
    const full = await fetchGithubFullRaw(false, progressWrapper);
    if (full && (Array.isArray(full) || (full && typeof full === 'object'))) {
      let arr = Array.isArray(full) ? full : Object.values(full || {});
      arr = await mergeWithLocalDataset(arr);
      const prepared = normalizeAndPrepareGames(arr, true);
      // Log sumber dataset ke AppLog (jelas bahwa ini dari bridge/disk)
      try {
        if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
          window.desktopBridge.send('AppLog', { message: '[UI] initGamesPage: dataset loaded via full raw (bridge/disk or download once)' });
        }
      } catch (e) {}
      try { hideBlockingOverlay(); } catch (e) {}
      try { await renderPage(1); } catch (e) {}
      try { if (typeof updateLastUpdatedLabel === 'function') updateLastUpdatedLabel(); } catch (e) {}
      return;
    }
  } catch (e) {}

  // Fallback: try sample_page.json containing normalized objects
  try {
    const sample = await fetch('/data/sample_page.json').then(r => r.json()).catch(() => null);
    if (Array.isArray(sample) && sample.length) {
      originalData = sample;
      filteredData = sample;
      loadGenreList(originalData);
      await renderPage(1);
      try { if (typeof updateLastUpdatedLabel === 'function') updateLastUpdatedLabel(); } catch (e) {}
      return;
    }
  } catch (se) {}

  // Background refresh dihapus: semua data sekarang via bridge (disk cache), tidak perlu refresh berkala dari JS
}

// Refresh manual: force reload dari bridge (disk cache akan di-update jika expired)
// Juga digunakan setelah update override data untuk reload dataset dengan override baru
async function refreshGithubRaw() {
  try {
    showBlockingOverlay('Memeriksa pembaruan data...', { showProgress: true });
    // Force refresh via bridge (akan download jika cache expired)
    // Tapi untuk override, kita tidak perlu force refresh raw data
    // Cukup reload dengan override yang sudah ter-update
    const full = await fetchGithubFullRaw(false); // false = gunakan cache, tapi override sudah ter-update
    hideBlockingOverlay();
    if (!full || (!Array.isArray(full) && typeof full !== 'object')) {
      showTransientMessage('Data tidak tersedia.', 4000, 'error');
      return;
    }
    // Normalize dan update dataset (akan merge dengan override yang baru)
    let arr = Array.isArray(full) ? full : Object.values(full || {});
    arr = await mergeWithLocalDataset(arr); // Ini akan load override yang baru
    const prepared = normalizeAndPrepareGames(arr, true);
    
    // Update global data
    originalData = prepared;
    filteredData = prepared;
    
    // Clear page cache
    Object.keys(pageCache).forEach(k => delete pageCache[k]);
    
    // Load genre list
    if (typeof loadGenreList === 'function') {
      loadGenreList(originalData);
    }
    
    try { if (typeof updateLastUpdatedLabel === 'function') updateLastUpdatedLabel(); } catch (e) {}
    // Tidak perlu show message di sini, sudah di-handle di loadGames()
    try { await renderPage(1); } catch (e) {}
  } catch (e) {
    hideBlockingOverlay();
    if (typeof premiumAlert === 'function') {
      premiumAlert('Gagal memuat pembaruan. Coba lagi nanti.', 'Error');
    }
  }
}

async function ensureGamesForPage(page) { /* raw-only: disabled */ }

function showSkeleton() {
  const list = document.getElementById("game-list");
  if (!list) return;
  // Only show skeleton placeholders when the list is currently empty.
  // This avoids flicker or persistent skeletons above loaded cards.
  if (list.children && list.children.length > 0) return;
  for (let i = 0; i < PAGE_SIZE; i++) {
    list.innerHTML += `
      <div class="flex items-center gap-4 bg-[#151515] p-4 rounded-xl border border-white/5">
        <div class="w-36 h-20 rounded-lg shimmer"></div>
        <div class="flex-1 space-y-2">
          <div class="h-4 w-1/2 rounded shimmer"></div>
          <div class="h-3 w-1/3 rounded shimmer"></div>
        </div>
        <div class="w-14 h-5 rounded shimmer"></div>
      </div>
    `;
  }
}

// Remove any skeleton placeholders from the list while keeping loaded items
function clearSkeletons(list) {
  try {
    const children = Array.from(list.children);
    children.forEach((child) => {
      if (child.querySelector && child.querySelector('.shimmer')) {
        child.remove();
      }
    });
  } catch (e) {
    // ignore
  }
}

async function renderPage(page) {
  currentPage = page;
  // If we have a cached page, render it immediately (stable navigation)
  const list = document.getElementById("game-list");
  list.innerHTML = "";
    if (pageCache[page]) {
      // Remove any leftover skeleton placeholders before appending cached cards
      clearSkeletons(list);
      pageCache[page].forEach((g) => appendGameCard(list, g));
      renderPagination();
      return;
    }

  // ensure we have enough games for this page (build if necessary)
    // If the user requested a page that currently lacks enough filtered items,
    // we should NOT start building additional items when filters are active.
    // Raw-only: tidak ada proses build tambahan saat render

  // Choose source data according to current filters so render respects filters
  const dataSource = (filteredData && filteredData.length) ? filteredData : originalData;
  const start = (page - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  // Build slice from the current (possibly filtered) dataset
  const slice = dataSource.slice(start, end);
  // Cache the page if we have any items (prefer full PAGE_SIZE when possible)
  if (slice && slice.length) pageCache[page] = slice.slice();
  try { savePageCache(); } catch (e) {}

  // remove any lingering skeletons before adding real cards
  clearSkeletons(list);
  slice.forEach((g) => appendGameCard(list, g));
  renderPagination();

  // Raw-only: tidak ada prefetch latar belakang

  // Scroll to top so user sees the page head
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(e) { window.scrollTo(0,0); }
}

function renderPagination() {
  const loadedPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE));
  const totalPages = loadedPages; // Raw-only: tidak ada halaman ekstra
  const p = document.getElementById("pagination");
  if (!p) return;
  p.innerHTML = "";

  const btn = (label, page, disabled = false) => `
    <button
      ${disabled ? "disabled" : ""}
      onclick="renderPage(${page})"
      class="px-3 py-1 rounded-md text-sm border border-white/10
             ${disabled ? "opacity-40" : "hover:bg-white/5"}">
      ${label}
    </button>`;

  p.innerHTML += btn("Prev", Math.max(1, currentPage - 1), currentPage === 1);

  // show up to 3 pages around current
  const start = Math.max(1, currentPage - 1);
  const end = Math.min(totalPages, start + 2);
  for (let i = start; i <= end; i++) {
    p.innerHTML += `
      <button onclick="renderPage(${i})"
        class="px-3 py-1 rounded-md text-sm border border-white/10
               ${i === currentPage ? "bg-white/10" : "hover:bg-white/5"}">
        ${i}
      </button>`;
  }

  p.innerHTML += btn(
    "Next",
    Math.min(totalPages, currentPage + 1),
    // disable Next if we're on last loaded page and no remaining ids, or if a build is in progress
    currentPage >= loadedPages || buildingInProgress
  );
  // show loading state on Next if building
  const nextBtn = p.querySelector('button:last-child');
  if (nextBtn) {
    if (buildingInProgress) {
      nextBtn.innerHTML = 'Next …';
      nextBtn.disabled = true;
    } else {
      nextBtn.innerHTML = 'Next';
    }
  }
}

// Update status display near pagination (shows loaded / filtered counts)
// Status text removed per user request.

function appendGameCard(list, game) {
  list.innerHTML += renderGameCardHTML(game);
}

function renderGameCardHTML(game) {
  // Use normalized price for premium detection when available
  const isPremium = (game.price_normalized || game.price_initial || 0) >= PREMIUM_MIN;
  const premiumLabel = isPremium ? "PREMIUM" : "STANDAR";
  const premiumColor = isPremium
    ? "bg-yellow-500 text-black"
    : "bg-gray-600 text-white";

  let protection = '';
  if (game.protection === true) {
    protection = `<span class="bg-red-600 text-white text-xs px-2 py-[3px] rounded-md">DENUVO</span>`;
  } else {
    protection = ``;
  }

  // Check if we're on library page (by checking if library filter is active or page title)
  const isLibraryPage = window.libraryFilterActive || 
    (document.querySelector('h1')?.textContent?.trim() === 'Library Games');
  
  // Trash button for library page
  const trashButton = isLibraryPage ? `
    <button onclick="event.stopPropagation(); handleTrashClick(${game.appid}, '${escapeHtml(game.title)}');" 
      class="absolute top-2 right-2 w-8 h-8 flex items-center justify-center bg-red-600/90 hover:bg-red-500 rounded-full transition shadow-lg hover:shadow-red-500/50 z-10"
      title="Hapus Game">
      <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
      </svg>
    </button>
  ` : '';

  return `
  <div id="game-card-wrapper-${game.appid}" class="relative fade-up">
    <button id="game-${game.appid}" onclick="openDetail(${game.appid})"
      class="w-full text-left flex items-center gap-4 bg-[#151515] hover:bg-white/5 p-4 rounded-xl
             border border-white/5 transition relative">

      <div class="relative w-36 h-20 flex-shrink-0">
         <img src="${game.header || ''}" class="w-full h-full object-cover rounded-lg shadow"
           onerror="(function(img){img.onerror=null;img.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';})(this);">
        <div class="absolute top-1 left-1 ${premiumColor} text-[10px] px-2 py-[2px] rounded-md font-semibold shadow">
          ${premiumLabel}
        </div>
      </div>

      <div class="flex flex-col justify-center flex-grow">
        <div class="flex items-center justify-between">
          <h2 class="text-white font-semibold text-lg truncate">${escapeHtml(game.title)}</h2>
          ${protection}
        </div>

        <div class="flex items-center justify-between mt-1">
          <p class="text-gray-400 text-sm truncate">${escapeHtml(game.genre_display || (Array.isArray(game.genre) ? game.genre.join(', ') : game.genre || ''))}</p>
          <p class="text-gray-500 text-xs">AppID: ${game.appid}</p>
        </div>
      </div>
      
      ${trashButton}
    </button>
  </div>`;
}

// Protection worker: scan originalData for items missing protection and fetch slowly
let _protectionWorker = { running: false, timer: null };
function startProtectionWorker() { /* raw-only: disabled */ }

function stopProtectionWorker() {
  _protectionWorker.running = false;
  if (_protectionWorker.timer) clearTimeout(_protectionWorker.timer);
  _protectionWorker.timer = null;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function (m) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[m]; });
}

// Append a lightweight placeholder card (title + appid + thumbnail) shown immediately
function appendPlaceholderCard(list, meta) {
  try {
    if (!list) list = document.getElementById('game-list');
    if (!list) return;
    const id = meta.appid;
    if (document.getElementById('ph-' + id)) return;
    const thumb = meta.thumb || '';
    const title = meta.title || '';
    const markup = `
      <div id="ph-${id}" class="fade-up text-left flex items-center gap-4 bg-[#151515] p-4 rounded-xl border border-white/5">
        <div class="relative w-36 h-20 flex-shrink-0">
          <img src="${thumb}" class="w-full h-full object-cover rounded-lg shadow" onerror="this.onerror=null;this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='">
        </div>
        <div class="flex flex-col justify-center flex-grow">
          <div class="flex items-center justify-between">
            <h2 class="text-white font-semibold text-lg truncate">${escapeHtml(title)}</h2>
            <span class="text-xs text-gray-400">Memuat detail…</span>
          </div>
          <div class="flex items-center justify-between mt-1">
            <p class="text-gray-400 text-sm truncate"></p>
            <p class="text-gray-500 text-xs">AppID: ${id}</p>
          </div>
        </div>
      </div>`;
    list.insertAdjacentHTML('afterbegin', markup);
  } catch (e) {}
}

function replacePlaceholderWithGame(appid, game) {
  try {
    // Replace in DOM if placeholder element exists.
    // Some placeholders are rendered with id="ph-<appid>", others were
    // rendered directly as the normal card id="game-<appid>" (when the
    // placeholder object was present in `originalData`). Try both so the
    // visible card updates reliably.
    const ph = document.getElementById('ph-' + appid);
    if (ph) {
      const html = renderGameCardHTML(game);
      ph.outerHTML = html;
    } else {
      const gEl = document.getElementById('game-' + appid);
      if (gEl) {
        try {
          gEl.outerHTML = renderGameCardHTML(game);
        } catch (e) {}
      }
    }
    // Replace placeholder object in originalData with full game object
    try {
      for (let i = 0; i < originalData.length; i++) {
        if (originalData[i] && originalData[i].appid === appid && originalData[i]._placeholder) {
          originalData[i] = game;
        }
      }
    } catch (e) {}
  } catch (e) {}
}

// Clear UI cache only (ringan): tidak menyentuh dataset utama GitHub
async function clearUiCacheOnly() {
  try {
    // Hapus page cache & detail cache di localStorage
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key === 'gamehub_page_cache' || key.startsWith('gamehub_detail_')) {
        try {
          localStorage.removeItem(key);
        } catch (e) {}
      }
    }

    // Reset cache di memori (supaya list dibangun ulang dari dataset yang sama)
    originalData = [];
    filteredData = [];
    Object.keys(pageCache).forEach(k => delete pageCache[k]);

    showTransientMessage('Cache tampilan dihapus. Data utama tetap disimpan.', 3000, 'success');
  } catch (e) {
    showTransientMessage('Gagal menghapus cache tampilan.', 3000, 'error');
  }
}

// Clear all cache (localStorage + disk cache via bridge) — berat, buat fresh seperti baru
async function clearAllCache() {
  try {
    // Clear localStorage
    const keysToRemove = [
      'gamehub_page_cache',
      'gamehub_manual_raw',
      'gamehub_github_appids',
      'gamehub_github_meta',
      'gamehub_github_raw_full',
      'gamehub_github_raw_full_meta',
      'gamehub_built_appids',
      'gamehub_remaining_appids'
    ];
    
    // Remove all gamehub_detail_* keys
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('gamehub_detail_') || keysToRemove.includes(key))) {
        try {
          localStorage.removeItem(key);
        } catch (e) {}
      }
    }
    
    // Clear in-memory cache
    originalData = [];
    filteredData = [];
    Object.keys(pageCache).forEach(k => delete pageCache[k]);
    if (window._githubAppList) window._githubAppList = null;
    if (window._genreMap) window._genreMap = null;
    if (window._steamGenres) window._steamGenres = null;
    if (window.GAMEHUB_RAW_URL) delete window.GAMEHUB_RAW_URL;
    
    // Clear disk cache via bridge
    if (window.desktopBridge && typeof window.desktopBridge.clearAllCache === 'function') {
      try {
        const result = await window.desktopBridge.clearAllCache();
        if (result && result.success) {
          showTransientMessage('Semua data & cache dihapus. Aplikasi akan dimuat ulang...', 3000, 'success');
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } else {
          const errorMsg = result?.error || result?.message || 'Unknown error';
          showTransientMessage('Sebagian cache dihapus. ' + errorMsg, 4000, 'warning');
        }
      } catch (e) {
        showTransientMessage('Cache localStorage dihapus. Restart aplikasi untuk menghapus cache disk.', 4000, 'info');
      }
    } else {
      showTransientMessage('Cache localStorage dihapus. Restart aplikasi untuk menghapus cache disk.', 4000);
    }
  } catch (e) {
    showTransientMessage('Gagal menghapus cache: ' + (e.message || 'Unknown error'), 4000, 'error');
  }
}

// Expose globally for console access
window.clearAllCache = clearAllCache;

// Handler functions for sidebar buttons (async confirm)
async function handleClearCache() {
  try {
    if (typeof premiumConfirm === 'function') {
      const result = await premiumConfirm('Hapus cache tampilan? Data game utama tetap disimpan.', 'Hapus Cache');
      if (result && typeof clearUiCacheOnly === 'function') {
        clearUiCacheOnly();
      }
    } else if (typeof clearUiCacheOnly === 'function') {
      clearUiCacheOnly();
    }
  } catch (e) {
    if (typeof showTransientMessage === 'function') {
      showTransientMessage('Error: ' + (e.message || 'Unknown error'), 4000, 'error');
    }
  }
}

async function handleClearData() {
  try {
    if (typeof premiumConfirm === 'function') {
      const result = await premiumConfirm('Hapus semua data & cache? Dataset akan di-download ulang seperti pertama kali.', 'Hapus Semua Data');
      if (result && typeof clearAllCache === 'function') {
        clearAllCache();
      }
    } else if (typeof clearAllCache === 'function') {
      clearAllCache();
    }
  } catch (e) {
    if (typeof showTransientMessage === 'function') {
      showTransientMessage('Error: ' + (e.message || 'Unknown error'), 4000, 'error');
    }
  }
}

// Expose globally
window.handleClearCache = handleClearCache;
window.handleClearData = handleClearData;
window.clearUiCacheOnly = clearUiCacheOnly;
window.clearUiCacheOnly = clearUiCacheOnly;