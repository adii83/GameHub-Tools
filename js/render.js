let originalData = [];
let filteredData = [];
let currentPage = 1;
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
      console.log('[GameHub] loaded pageCache from storage', Object.keys(pageCache));
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

  // Auto-load user's provided raw GitHub URL (once) — set by user in this session
  try {
    const provided = 'https://raw.githubusercontent.com/adii83/steam-metadata-archive/refs/heads/main/steam_data.json';
    const existing = localStorage.getItem('gamehub_manual_raw');
    if (!existing || String(existing).trim() !== provided) {
      console.log('[GameHub] auto-loading provided raw game list');
      // Use the public helper which persists the URL
      try { if (window && typeof window.useRawGameList === 'function') window.useRawGameList(provided); else { localStorage.setItem('gamehub_manual_raw', provided); window.GAMEHUB_RAW_URL = provided; } } catch (e) { localStorage.setItem('gamehub_manual_raw', provided); window.GAMEHUB_RAW_URL = provided; }
    }
  } catch (e) {}

function savePageCache() {
  try {
    prunePageCache();
    localStorage.setItem(PAGE_CACHE_KEY, JSON.stringify(pageCache));
  } catch (e) {
    // ignore storage errors
  }
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
      spinner.style.cssText = 'width:36px;height:36px;border-radius:50%;border:4px solid rgba(255,255,255,0.08);border-top-color:#9b5cff;animation:gamehub-spin 1s linear infinite';
      const text = document.createElement('div');
      text.id = 'gamehub-block-overlay-text';
      text.style.cssText = 'text-align:center;font-size:15px';
      box.appendChild(spinner);
      box.appendChild(text);
      overlay.appendChild(bg);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    }
    const textEl = document.getElementById('gamehub-block-overlay-text');
    if (textEl) textEl.textContent = message || 'Mohon tunggu — sedang mengumpulkan data...';
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
  } catch (e) {}
}

// Show short centered transient message (used when scraping cannot fill page)
function showTransientMessage(msg, ms = 4000) {
  try {
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
  } catch (e) { console.warn('[GameHub] normalizeAndPrepareGames error', e && e.message); return []; }
}

// Load remote canonical JSON (GitHub raw or other raw URL) and prepare dataset
async function loadRemoteGameList(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('failed to fetch remote game list: ' + res.status);
    const raw = await res.json();
    // raw may be object keyed by appid or array
    const arr = Array.isArray(raw) ? raw : Object.values(raw || {});
    const prepared = normalizeAndPrepareGames(arr, true);
    // persist the manual url so future visits load the same
    try { localStorage.setItem('gamehub_manual_raw', url); } catch (e) {}

    // Render first page from cache (pageCache was prepared)
    try { await renderPage(1); } catch (e) { console.warn('[GameHub] renderPage after loadRemoteGameList failed', e && e.message); }
    // start protection worker if any
    try { if (typeof startProtectionWorker === 'function') startProtectionWorker(); } catch (e) {}
    return prepared;
  } catch (e) { console.warn('[GameHub] loadRemoteGameList failed', e && e.message); throw e; }
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

  // Jika user sudah set URL RAW GitHub, muat langsung
  try {
    const manualUrl = window.GAMEHUB_RAW_URL || localStorage.getItem('gamehub_manual_raw');
    if (manualUrl) {
      try {
        console.log('[GameHub] initGamesPage: loading manual game list from', manualUrl);
        await loadRemoteGameList(manualUrl);
        try { if (typeof updateLastUpdatedLabel === 'function') updateLastUpdatedLabel(); } catch (e) {}
        // We already rendered page 1 inside loader
        return;
      } catch (e) {
        console.warn('[GameHub] loadRemoteGameList failed', e && e.message);
      }
    }
  } catch (e) {}

  // Raw-only init: muat daftar RAW GitHub sebagai data awal
  try {
    const gh = await fetchGithubAppList();
    if (Array.isArray(gh) && gh.length) {
      // RAW lengkap: jika format berisi objek dengan field lengkap, normalisasi langsung.
      originalData = gh.map(it => ({
        appid: Number(it.appid || it.id || 0),
        title: String(it.name || it.title || ''),
        header: String(it.header || ''),
        genre: it.genre || it.genre_display || '',
        genre_display: it.genre_display || it.genre || '',
        short_description: it.short_description || '',
        developers: Array.isArray(it.developers) ? it.developers : (it.developers ? [String(it.developers)] : []),
        publishers: Array.isArray(it.publishers) ? it.publishers : (it.publishers ? [String(it.publishers)] : []),
        release_date: String(it.release_date || ''),
        price_display: String(it.price_display || ''),
        price_normalized: Number(it.price_normalized || 0),
        price_initial: Number(it.price_initial || it.price_normalized || 0),
        protection: it.protection === true ? true : false
      }));
      filteredData = originalData.slice();
      loadGenreList(originalData);
      await renderPage(1);
      try { if (typeof updateLastUpdatedLabel === 'function') updateLastUpdatedLabel(); } catch (e) {}
      return;
    }
  } catch (e) { console.warn('[GameHub] initGamesPage GitHub raw init failed', e && e.message); }

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
  } catch (se) { console.warn('[GameHub] sample_page.json fallback failed', se && se.message); }

  // Penyegaran berkala data (12 jam)
  try {
    if (!window._gamehub_github_refresh_scheduled) {
      window._gamehub_github_refresh_scheduled = true;
      // Use the same TTL as fetchGithubAppList GITHUB_CACHE_TTL (12h)
      const intervalMs = 12 * 60 * 60 * 1000;
      setInterval(async () => {
        try {
          console.log('[GameHub] background fetchGithubAppList tick');
          // fetch without forcing (uses conditional GET) to update local cache/meta
          const beforeRaw = localStorage.getItem('gamehub_github_appids') || '[]';
          let before = [];
          try { before = JSON.parse(beforeRaw); } catch (e) { before = []; }
          const updated = await fetchGithubAppList(false);
          // Bandingkan dan tampilkan notifikasi singkat jika ada item baru
          const beforeSet = new Set((before || []).map(x => Number(x.appid || x)).filter(Boolean));
          const updatedSet = new Set((updated || []).map(x => Number(x.appid || x)).filter(Boolean));
          const newCount = [...updatedSet].filter(id => !beforeSet.has(id)).length;
          // Perbarui label "Terakhir diperbarui" setiap tick (fungsi didefinisikan di filter.js)
          try { if (typeof updateLastUpdatedLabel === 'function') updateLastUpdatedLabel(); } catch (e) {}
          if (newCount > 0) {
            // Pesan netral tanpa menyebut RAW atau tombol
            showTransientMessage(`Data diperbarui: ${newCount} entri baru.`, 6000);
          }
        } catch (e) { console.warn('[GameHub] background refresh error', e && e.message); }
      }, 12 * 60 * 60 * 1000);
      // Trigger saat tab kembali aktif jika TTL lewat
      document.addEventListener('visibilitychange', async () => {
        try {
          if (document.visibilityState === 'visible') {
            const metaRaw = localStorage.getItem('gamehub_github_meta');
            let meta = {};
            try { meta = metaRaw ? JSON.parse(metaRaw) : {}; } catch(e) { meta = {}; }
            const ts = meta && meta.ts ? meta.ts : 0;
            if (Date.now() - ts > (12 * 60 * 60 * 1000)) {
              console.log('[GameHub] visibility trigger fetchGithubAppList');
              await fetchGithubAppList(false);
              try { if (typeof updateLastUpdatedLabel === 'function') updateLastUpdatedLabel(); } catch (e) {}
            }
          }
        } catch (e) {}
      });

      // Trigger saat kembali online
      window.addEventListener('online', async () => {
        try {
          console.log('[GameHub] online trigger fetchGithubAppList');
          await fetchGithubAppList(false);
          try { if (typeof updateLastUpdatedLabel === 'function') updateLastUpdatedLabel(); } catch (e) {}
        } catch (e) {}
      });
    }
  } catch (e) { console.warn('[GameHub] schedule refresh failed', e && e.message); }
}

// Handler refresh manual dihapus dari UI; fungsi dipertahankan jika dipanggil internal
async function refreshGithubRaw() {
  try {
    showBlockingOverlay('Memeriksa pembaruan data...');
    // read previous cache before forcing a fetch
    const beforeRaw = localStorage.getItem('gamehub_github_appids') || '[]';
    let before = [];
    try { before = JSON.parse(beforeRaw); } catch (e) { before = []; }
    const beforeSet = new Set((before || []).map(x => (x && x.appid) ? Number(x.appid) : Number(x)).filter(Boolean));

    const updated = await fetchGithubAppList(true);
    hideBlockingOverlay();
    if (!updated || !updated.length) {
      showTransientMessage('Data tidak tersedia.', 4000);
      return;
    }
    const newItems = (updated || []).filter(it => !beforeSet.has(Number(it.appid)));
    if (!newItems.length) {
      showTransientMessage('Data sudah terbaru.', 4000);
      return;
    }
    // Raw-only: gantikan dataset penuh dengan versi terbaru, lalu render
    originalData = updated.map(it => ({
      appid: Number(it.appid || it.id || 0),
      title: String(it.name || it.title || ''),
      header: String(it.header || ''),
      genre: it.genre || it.genre_display || '',
      genre_display: it.genre_display || it.genre || '',
      short_description: it.short_description || '',
      developers: Array.isArray(it.developers) ? it.developers : (it.developers ? [String(it.developers)] : []),
      publishers: Array.isArray(it.publishers) ? it.publishers : (it.publishers ? [String(it.publishers)] : []),
      release_date: String(it.release_date || ''),
      price_display: String(it.price_display || ''),
      price_normalized: Number(it.price_normalized || 0),
      price_initial: Number(it.price_initial || it.price_normalized || 0),
      protection: it.protection === true ? true : false
    }));
    filteredData = originalData.slice();
    // rebuild pageCache untuk pagination stabil
    try {
      Object.keys(pageCache).forEach(k => delete pageCache[k]);
      const total = Math.ceil(originalData.length / PAGE_SIZE) || 0;
      for (let p = 1; p <= total; p++) {
        const start = (p - 1) * PAGE_SIZE;
        pageCache[p] = originalData.slice(start, start + PAGE_SIZE);
      }
      savePageCache();
    } catch (e) {}
    // Sinkronkan label setelah pembaruan manual
    try { if (typeof updateLastUpdatedLabel === 'function') updateLastUpdatedLabel(); } catch (e) {}
    showTransientMessage(`Data diperbarui: ${newItems.length} entri baru.`, 6000);
    try { renderPage(1); } catch (e) { console.warn('[GameHub] render after refresh failed', e && e.message); }
  } catch (e) {
    hideBlockingOverlay();
    console.warn('[GameHub] refreshGithubRaw error', e && e.message);
    showTransientMessage('Gagal memuat pembaruan raw. Coba lagi nanti.', 5000);
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

  return `
  <button id="game-${game.appid}" onclick="openDetail(${game.appid})"
    class="fade-up text-left flex items-center gap-4 bg-[#151515] hover:bg-white/5 p-4 rounded-xl
           border border-white/5 transition">

    <div class="relative w-36 h-20 flex-shrink-0">
       <img src="${game.header}" class="w-full h-full object-cover rounded-lg shadow"
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
  </button>`;
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
  } catch (e) { console.warn('[GameHub] appendPlaceholderCard error', e && e.message); }
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