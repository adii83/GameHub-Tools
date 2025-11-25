let originalData = [];
let filteredData = [];
let currentPage = 1;
let remainingAppIds = [];
let buildingInProgress = false;
let maybeHasMore = true; // true if sampling from full app list may yield more ids
let searchCursor = 0; // offset for store search scraping
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

function savePageCache() {
  try {
    prunePageCache();
    localStorage.setItem(PAGE_CACHE_KEY, JSON.stringify(pageCache));
  } catch (e) {
    // ignore storage errors
  }
}
// Configuration / storage keys
const BUILD_CONCURRENCY = 3;
const REMAINING_KEY = 'gamehub_remaining_appids';
const BUILD_CACHE_KEY = 'gamehub_built_appids';
// Rate control
const INTER_REQUEST_DELAY_MS = 350; // delay between individual builds
const BACKOFF_BASE_MS = 1000; // base backoff multiplier when rate-limited
const RATE_LIMIT_THRESHOLD = 5; // consecutive rate-limited responses before pausing

function saveRemaining() {
  try { localStorage.setItem(REMAINING_KEY, JSON.stringify(remainingAppIds)); } catch(e) {}
}

// Small visual indicator shown while scraping/fetching additional appids
function showScrapeIndicator() {
  try {
    if (!document) return;
    if (!document.getElementById('gamehub-spinner-style')) {
      const s = document.createElement('style');
      s.id = 'gamehub-spinner-style';
      s.innerHTML = `@keyframes gamehub-spin{to{transform:rotate(360deg)}}`;
      document.head.appendChild(s);
    }
    let el = document.getElementById('scrape-indicator');
    if (!el) {
      el = document.createElement('div');
      el.id = 'scrape-indicator';
      el.style.cssText = 'position:fixed;right:16px;bottom:72px;background:rgba(17,17,17,0.95);padding:8px 12px;border-radius:10px;color:#fff;display:flex;align-items:center;gap:8px;z-index:9999;box-shadow:0 6px 24px rgba(0,0,0,0.6);font-size:12px';
      el.innerHTML = `<div style="width:14px;height:14px;border:2px solid rgba(255,255,255,0.12);border-top-color:#9b5cff;border-radius:50%;animation:gamehub-spin 1s linear infinite"></div><div>Mengumpulkan data…</div>`;
      document.body.appendChild(el);
    }
    el.style.display = 'flex';
  } catch (e) {}
}

// Proxy banner UI: shown when local API proxy is unavailable
function showProxyBanner() {
  try {
    let el = document.getElementById('gamehub-proxy-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gamehub-proxy-banner';
      el.style.cssText = 'position:fixed;left:16px;bottom:16px;background:#b91c1c;color:#fff;padding:10px 14px;border-radius:10px;z-index:12000;box-shadow:0 8px 30px rgba(0,0,0,0.6);font-size:13px;max-width:420px;line-height:1.3';
      el.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:6px">
          <div><strong>Proxy offline</strong> — pengambilan detail ditunda.</div>
          <div style="font-size:12px;opacity:0.95">Untuk mengembalikan detail (harga, header, DRM), jalankan proxy lokal dari folder proyek:</div>
          <code style="background:#111;padding:6px;border-radius:6px;font-size:12px;color:#fff;display:inline-block">npm run proxy</code>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button id="gamehub-proxy-copy" style="padding:6px 10px;border-radius:6px;background:#111;border:1px solid rgba(255,255,255,0.06);color:#fff;">Salin perintah</button>
            <button id="gamehub-proxy-retry" style="padding:6px 10px;border-radius:6px;background:#0f172a;border:1px solid rgba(255,255,255,0.06);color:#fff;">Coba Sambungkan</button>
            <button id="gamehub-proxy-dismiss" style="padding:6px 10px;border-radius:6px;background:transparent;border:1px solid rgba(255,255,255,0.12);color:#fff;">Tutup</button>
          </div>
        </div>`;
      document.body.appendChild(el);
      document.getElementById('gamehub-proxy-copy').onclick = async () => {
        try {
          await navigator.clipboard.writeText('npm run proxy');
          showTransientMessage('Perintah disalin ke clipboard', 3000);
        } catch (e) { showTransientMessage('Gagal menyalin', 3000); }
      };
      document.getElementById('gamehub-proxy-retry').onclick = async () => {
        try {
          showBlockingOverlay('Mencoba menyambung ke proxy...');
          // Force a refresh of the GitHub raw (this will ping network and indirectly check proxy)
          try { await fetchGithubAppList(true); } catch (e) {}
          // also attempt to trigger any onProxyUp hook
          try { if (window && typeof window.onProxyUp === 'function') window.onProxyUp(); } catch (e) {}
        } catch (e) {}
        hideBlockingOverlay();
      };
      document.getElementById('gamehub-proxy-dismiss').onclick = () => { hideProxyBanner(); };
    }
    el.style.display = 'block';
  } catch (e) {}
}

function hideProxyBanner() {
  try {
    const el = document.getElementById('gamehub-proxy-banner');
    if (el) el.style.display = 'none';
  } catch (e) {}
}

// When proxy comes back, resume background building if paused
try {
  window.onProxyUp = async function() {
    try {
      hideProxyBanner();
      showTransientMessage('Proxy tersedia — melanjutkan pengambilan detail...', 3000);
      // If not currently building, kick off ensureGamesForPage for current page
      try {
        if (typeof ensureGamesForPage === 'function' && !buildingInProgress) {
          await ensureGamesForPage(currentPage || 1);
          // re-render current page to replace placeholders
          try { renderPage(currentPage || 1); } catch (e) {}
        }
      } catch (e) { console.warn('[GameHub] resume after proxy up failed', e && e.message); }
    } catch (e) {}
  };
} catch (e) {}

function hideScrapeIndicator() {
  try {
    const el = document.getElementById('scrape-indicator');
    if (el) el.style.display = 'none';
  } catch (e) {}
}

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

    // If retry option provided, show a 'Coba Lagi' button that triggers a retry of ensureGamesForPage
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
            showBlockingOverlay('Mengumpulkan data lagi...');
            await ensureGamesForPage(pageToRetry);
            hideBlockingOverlay();
            // re-render the page after retry
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

  let appids = [];
  try {
    console.log('[GameHub] initGamesPage: fetching trending app ids...');
    appids = await fetchTrendingAppIds();
    console.log('[GameHub] initGamesPage: got appids', appids?.length, appids?.slice?.(0,10));
  } catch (e) {
    console.warn("Trending fetch failed, attempting fallbacks", e && e.message);
    // First try GitHub raw app list as primary source
    try {
      const gh = await fetchGithubAppList();
      if (Array.isArray(gh) && gh.length) {
        // insert first PAGE_SIZE as placeholders and queue the rest
        const first = gh.slice(0, PAGE_SIZE);
        originalData = [];
        first.slice().reverse().forEach((it) => {
          originalData.unshift({ appid: it.appid, title: it.name || '', header: '', header_candidates: [], genre_display: '', _placeholder: true });
        });
        const rest = gh.slice(PAGE_SIZE).map(x => x.appid);
        remainingAppIds = rest.slice();
        saveRemaining();
        // render page with placeholders
        loadGenreList(originalData);
        await renderPage(1);
        return;
      }
    } catch (ghErr) {
      console.warn('[GameHub] fetchGithubAppList in init failed', ghErr && ghErr.message);
    }

    // Try sample_page.json first; if it contains normalized game objects use them,
    // otherwise treat it as array of appids. If that fails, use local popular_appids.json
    try {
      const sample = await fetch('/data/sample_page.json').then(r => r.json()).catch(() => null);
      if (Array.isArray(sample) && sample.length) {
        // detect if sample contains normalized game objects (has appid and title)
        if (typeof sample[0] === 'object' && (sample[0].appid || sample[0].title)) {
          originalData = sample;
          filteredData = sample;
          loadGenreList(originalData);
          await renderPage(1);
          return;
        }
        // if it's an array of numbers, use as remainingAppIds
        if (typeof sample[0] === 'number') {
          remainingAppIds = sample.slice();
          saveRemaining();
          // continue to normal flow which will build page 1
        }
      }
    } catch (se) {
      console.warn('[GameHub] sample_page.json fallback failed', se && se.message);
    }

    // final fallback: try local popular_appids.json
    try {
      const p = await fetch('/data/popular_appids.json').then(r => r.json()).catch(() => null);
      if (Array.isArray(p) && p.length) {
        remainingAppIds = p.slice();
        saveRemaining();
      }
    } catch (pe) {
      console.warn('[GameHub] popular_appids.json fallback failed', pe && pe.message);
    }
    // continue to building from remainingAppIds below
  }

  // Prepare for incremental loading: keep remaining appids and build only as needed
  originalData = [];
  filteredData = [];
    // attempt to restore remaining ids from previous session
    const saved = loadRemaining();
    if (saved && saved.length) {
      console.log('[GameHub] restored remainingAppIds from storage', saved.length);
      // merge saved + new trending but avoid duplicates
      const seen = new Set(saved);
      appids.forEach(a => { if (!seen.has(a)) saved.push(a); });
      remainingAppIds = saved;
    } else {
      remainingAppIds = [...appids];
    }
    saveRemaining();
  // restore search cursor if present
  try { const c = parseInt(localStorage.getItem('gamehub_search_cursor') || '0',10); if (!isNaN(c)) searchCursor = c; } catch(e) { searchCursor = 0; }
  // Preload the full Steam app list in background so sampling can succeed later
  // Do not preload the full app list to avoid unnecessary GetAppList requests (404).
  // We will call sampling (GetAppList) only as a fallback when search scraping yields no results.
  // ensure first page is loaded and then render
  await ensureGamesForPage(1);
  // set filteredData once after initial build (do not overwrite filteredData on every ensure)
  filteredData = originalData;
  loadGenreList(originalData);
  await renderPage(1);

  // Start background worker to fetch DRM/protection info slowly
  try { startProtectionWorker(); } catch (e) {}

  // Schedule periodic background refresh of the GitHub raw app list (12 hours)
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
          // If new ids appeared, notify user and queue them for build
          const beforeSet = new Set((before || []).map(x => (x && x.appid) ? Number(x.appid) : Number(x)).filter(Boolean));
          const newItems = (updated || []).filter(it => !beforeSet.has(Number(it.appid)));
          if (newItems && newItems.length) {
            console.log('[GameHub] background refresh found new items', newItems.length);
            // If user is viewing first page, insert placeholders immediately; otherwise show transient notice
            const newIds = newItems.map(x => Number(x.appid));
            // add new ids to front of remainingAppIds and persist
            remainingAppIds = newIds.concat(remainingAppIds.filter(id => !newIds.includes(id)));
            saveRemaining();
            // If on page 1, show placeholders
            if (currentPage === 1) {
              const list = document.getElementById('game-list');
              // insert up to PAGE_SIZE placeholders at the top
              const toShow = newItems.slice(0, PAGE_SIZE);
              toShow.reverse().forEach(it => {
                // ensure not already present
                const exists = originalData.find(x => x && x.appid === Number(it.appid));
                if (!exists) {
                  originalData.unshift({ appid: Number(it.appid), title: it.name || '', header: '', header_candidates: [], genre_display: '', _placeholder: true });
                }
              });
              try { renderPage(1); } catch (e) {}
            } else {
              showTransientMessage(`Daftar raw diperbarui: ${newItems.length} baru (klik Refresh)`, 7000);
            }
          }
        } catch (e) { console.warn('[GameHub] background refresh error', e && e.message); }
      }, 12 * 60 * 60 * 1000);
    }
  } catch (e) { console.warn('[GameHub] schedule refresh failed', e && e.message); }
}

// Manual refresh handler bound to the 'Refresh Raw' button
async function refreshGithubRaw() {
  try {
    showBlockingOverlay('Memeriksa pembaruan daftar raw...');
    // read previous cache before forcing a fetch
    const beforeRaw = localStorage.getItem('gamehub_github_appids') || '[]';
    let before = [];
    try { before = JSON.parse(beforeRaw); } catch (e) { before = []; }
    const beforeSet = new Set((before || []).map(x => (x && x.appid) ? Number(x.appid) : Number(x)).filter(Boolean));

    const updated = await fetchGithubAppList(true);
    hideBlockingOverlay();
    if (!updated || !updated.length) {
      showTransientMessage('Tidak ada daftar raw ditemukan.', 4000);
      return;
    }
    const newItems = (updated || []).filter(it => !beforeSet.has(Number(it.appid)));
    if (!newItems.length) {
      showTransientMessage('Daftar raw sudah terbaru.', 4000);
      return;
    }

    // Integrate new items: insert placeholders and queue remaining ids
    const newIds = newItems.map(x => Number(x.appid));
    // Insert placeholders at the top of originalData for immediate visibility
    const toShow = newItems.slice(0, PAGE_SIZE);
    toShow.reverse().forEach(it => {
      const exists = originalData.find(x => x && x.appid === Number(it.appid));
      if (!exists) {
        originalData.unshift({ appid: Number(it.appid), title: it.name || '', header: '', header_candidates: [], genre_display: '', _placeholder: true });
      }
    });
    // Merge new ids to remainingAppIds front, avoid duplicates
    remainingAppIds = newIds.concat(remainingAppIds.filter(id => !newIds.includes(id)));
    saveRemaining();
    showTransientMessage(`Daftar raw diperbarui: ${newItems.length} item baru.`, 6000);
    try { renderPage(1); } catch (e) { console.warn('[GameHub] render after refresh failed', e && e.message); }
  } catch (e) {
    hideBlockingOverlay();
    console.warn('[GameHub] refreshGithubRaw error', e && e.message);
    showTransientMessage('Gagal memuat pembaruan raw. Coba lagi nanti.', 5000);
  }
}

async function ensureGamesForPage(page) {
  // build until we have enough items for `page` or until no remaining ids
  const needed = page * PAGE_SIZE;
  if (buildingInProgress) return;
  buildingInProgress = true;
  // show skeletons only when list empty (showSkeleton respects that)
  showSkeleton();
  let idx = originalData.length;
  // if we ran out of remaining ids, try to sample more from global app list
  try {
    // Keep trying until we have enough built items for this page or no more sources
    // Keep trying until the filtered dataset has enough items for this page
    // This ensures that when filters are active we continue scraping/building
    // until `filteredData.length >= needed` or until no more sources exist.
    while ((filteredData && filteredData.length) ? filteredData.length < needed : originalData.length < needed) {
      // if we ran out of remaining ids, try to fetch more via search (on-demand)
      if (remainingAppIds.length === 0) {
        try {
          const existing = new Set(originalData.map(x => x.appid));
          let filled = false;
          // attempt multiple search pages before giving up
          for (let attempt = 0; attempt < 5 && !filled; attempt++) {
            console.log('[GameHub] fetching search page at cursor', searchCursor, 'attempt', attempt+1);
                // show scraping indicator when we actively fetch search pages
                showScrapeIndicator();
            const searchBatch = await fetchSearchPage(searchCursor, PAGE_SIZE);
            console.log('[GameHub] fetchSearchPage returned', searchBatch.length);
            if (searchBatch && searchBatch.length) {
              for (const id of searchBatch) {
                if (!existing.has(id)) remainingAppIds.push(id);
              }
              searchCursor += PAGE_SIZE;
              try { localStorage.setItem('gamehub_search_cursor', String(searchCursor)); } catch(e){}
              maybeHasMore = true;
              saveRemaining();
              filled = remainingAppIds.length > 0;
                    hideScrapeIndicator();
                    break;
            }
            // small pause before next attempt
            await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
          }
                  // hide indicator in case attempts exhausted without filled
                  hideScrapeIndicator();
          if (!filled) {
            // fallback to sampling the full app list once
                    // show indicator while sampling as well
                    showScrapeIndicator();
            const more = await sampleAppIds(new Set(originalData.map(x => x.appid)), 200);
            if (more && more.length) {
              remainingAppIds.push(...more);
              maybeHasMore = true;
              saveRemaining();
                    hideScrapeIndicator();
            } else {
              maybeHasMore = false;
                    hideScrapeIndicator();
                    // nothing more we can do — if user was blocked waiting, show message
                    if ((filteredData && filteredData.length) ? filteredData.length < needed : originalData.length < needed) {
                      showTransientMessage('Tidak cukup hasil untuk memenuhi page ini', 5000);
                    }
                  break; // nothing more we can do
            }
          }
        } catch (e) {
          console.warn('[GameHub] search/sample failed', e && e.message);
          maybeHasMore = false;
          break;
        }
      }

      // Build in batches with limited concurrency
        // If proxy is likely down, pause building details to avoid repeated errors
        try {
          if (typeof isProxyLikelyDown === 'function' && isProxyLikelyDown() && remainingAppIds.length > 0) {
            showTransientMessage('Proxy lokal tidak tersedia — menunda pengambilan detail sampai koneksi pulih.', 5000);
            break; // break out of building loop for now
          }
        } catch (e) {}

        if (remainingAppIds.length === 0) break; // nothing to build
      const batch = remainingAppIds.splice(0, BUILD_CONCURRENCY);
      saveRemaining();
      const startIdx = idx + 1;
      const promises = batch.map(async (id, i) => {
        const cur = startIdx + i;
        console.log('[GameHub] building game', cur, '/', (cur + remainingAppIds.length), 'appid=', id);
        try {
          const g = await buildGame(id);
          if (g) {
            originalData.push(g);
            addBuiltCache(id);
            console.log('[GameHub] built game ok', id, g.title);
            try { replacePlaceholderWithGame(id, g); } catch(e) {}
          } else {
            console.warn('[GameHub] buildGame returned null for', id);
          }
        } catch (e) {
          console.warn('[GameHub] buildGame threw for', id, e && e.message);
        }
      });
      await Promise.all(promises);
      idx = originalData.length;
      // reapply filters silently (don't force navigation)
      if (typeof applyFilters === 'function') applyFilters(false);
      renderPagination();
      // loop again until originalData.length >= needed or no more sources
    }
  } finally {
    buildingInProgress = false;
    renderPagination();
  }
}

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
    const dataSourceCheck = (filteredData && filteredData.length) ? filteredData : originalData;
    const haveNow = dataSourceCheck.length;
    const need = page * PAGE_SIZE;
    const filteringActive = !!window.filtersActive;
    const fillFiltered = !!window.fillFilteredPages;
    let blockingShown = false;

    if (!filteringActive) {
      // normal (no filters): allow building to fill the page
      if (haveNow < need && (remainingAppIds.length > 0 || maybeHasMore)) {
        showBlockingOverlay('Mengumpulkan lebih banyak game untuk mengisi halaman...');
        blockingShown = true;
      }
      await ensureGamesForPage(page);
      if (blockingShown) hideBlockingOverlay();
    } else {
      // filters active: If Premium/Standard is active we should attempt to
      // fill the page to PAGE_SIZE by building more items that match the
      // filters. For other filters, avoid network builds and show limited results.
      if (fillFiltered) {
        if (haveNow < need && (remainingAppIds.length > 0 || maybeHasMore)) {
          showBlockingOverlay('Mengumpulkan lebih banyak game untuk mengisi halaman filter...');
          blockingShown = true;
        }
        await ensureGamesForPage(page);
        if (blockingShown) hideBlockingOverlay();
      } else {
        if (haveNow < need) {
          showTransientMessage('Hanya menampilkan hasil yang sudah tersedia untuk filter ini.', 3000);
        }
      }
    }

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

  // Background prefetch: prepare the next page so navigation is faster.
  // Start asynchronously and don't block the UI. ensureGamesForPage will
  // return early if a build is already in progress.
  try {
    setTimeout(() => {
      // Only attempt prefetch if there may be more games to fetch or we have remaining ids
      if (remainingAppIds.length > 0 || maybeHasMore) {
        ensureGamesForPage(page + 1).catch(() => {});
      }
    }, 50);
  } catch (e) {}

  // Scroll to top so user sees the page head
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch(e) { window.scrollTo(0,0); }
}

function renderPagination() {
  const loadedPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE));
  // allow one more page if we have more ids to fetch
  const totalPages = Math.max(1, loadedPages + ((remainingAppIds.length > 0 || maybeHasMore) ? 1 : 0));
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
    (currentPage >= loadedPages && remainingAppIds.length === 0 && !maybeHasMore) || buildingInProgress
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

  const header_candidates = JSON.stringify(game.header_candidates || []);
  return `
  <button id="game-${game.appid}" onclick="openDetail(${game.appid})"
    class="fade-up text-left flex items-center gap-4 bg-[#151515] hover:bg-white/5 p-4 rounded-xl
           border border-white/5 transition">

    <div class="relative w-36 h-20 flex-shrink-0">
       <img src="${game.header}" class="w-full h-full object-cover rounded-lg shadow"
         data-candidates='${header_candidates}'
         onerror="(function(img){img.onerror=null;try{var list=JSON.parse(img.getAttribute('data-candidates')||'[]');var next=list.shift();img.setAttribute('data-candidates',JSON.stringify(list));if(next){img.src=next;console.warn('[GameHub] image fallback to', next);}else{img.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';console.warn('[GameHub] image fallback to placeholder');}}catch(e){img.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';}})(this);">
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
function startProtectionWorker() {
  if (_protectionWorker.running) return;
  _protectionWorker.running = true;
  // process one item every ~1500ms
  async function tick() {
    try {
      if (typeof isProxyLikelyDown === 'function' && isProxyLikelyDown()) {
        // pause and retry later
        _protectionWorker.timer = setTimeout(tick, 5000);
        return;
      }
      if (!Array.isArray(originalData) || originalData.length === 0) {
        _protectionWorker.timer = setTimeout(tick, 2000);
        return;
      }
      // find next game that does not have protection set and is not a placeholder
      const next = originalData.find(g => g && (g.protection === undefined || g.protection === null) && !g._placeholder);
      if (!next) {
        _protectionWorker.timer = setTimeout(tick, 2000);
        return;
      }
      // call global detectProtection (exposed by api.js)
      try {
        if (typeof window.detectProtection === 'function') {
          const has = await window.detectProtection(next.appid, next.title || '');
          next.protection = !!has;
          // update DOM card if visible
          try {
            const el = document.getElementById('game-' + next.appid);
            if (el) {
              el.outerHTML = renderGameCardHTML(next);
            }
          } catch (e) {}
        }
      } catch (e) {
        // ignore per-item errors
      }
    } catch (e) {}
    _protectionWorker.timer = setTimeout(tick, 1500);
  }
  tick();
}

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
          break;
        }
      }
    } catch (e) {}
  } catch (e) { console.warn('[GameHub] replacePlaceholderWithGame error', e && e.message); }
}

function loadGenreList(data) {
  // Render all genres from the canonical steam_genres.json so filters always show full list
  const container = document.getElementById("genreList");
  if (!container) return;
  container.innerHTML = "";
  fetch('/data/steam_genres.json')
    .then((r) => r.json())
    .then((genreMeta) => {
      genreMeta
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((meta) => {
          container.innerHTML += `
      <label class="flex items-center gap-2">
        <input type="checkbox" value="${meta.id}" onchange="applyFilters()" class="accent-purple-500 genreCheck">
        <span class="px-2 py-[3px] rounded-md text-sm text-white" style="background-color: ${meta.color};">${meta.icon || ''} ${meta.name}</span>
      </label>`;
        });
    })
    .catch(() => {
      // fallback: empty
      container.innerHTML = "";
    });
}
