// Raw-only mode: remove Steam endpoints and proxy usage
const PAGE_SIZE = 20;
const PREMIUM_MIN = 130000; // price >= this is premium tier

// Removed: fetchAppDetails — not used in raw-only pipeline

// Removed: buildGame — per-app details are not fetched

// Removed: expose detectProtection

// Library-specific helper removed. Use general APIs in `api.js` if needed.

// per-app detail cache helpers
function getDetailCache(appid) {
  try {
    const raw = localStorage.getItem(`gamehub_detail_${appid}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function setDetailCache(appid, data) {
  try {
    localStorage.setItem(`gamehub_detail_${appid}`, JSON.stringify({ ts: Date.now(), data }));
  } catch (e) {}
}

// Removed: protection detection and caches — no Steam page fetches

// --- Genre mapping helpers ---
let _genreMap = null;
let _steamGenres = null;
let _githubAppList = null; // cache for GitHub raw appid list

// GITHUB_RAW_URL removed: semua fetch sekarang via C# bridge (disk cache), tidak ada fetch langsung dari JS
const GITHUB_CACHE_KEY = 'gamehub_github_appids';
const GITHUB_CACHE_META = 'gamehub_github_meta';
const GITHUB_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours
// Full raw cache keys (stores the entire GitHub raw JSON; large, cached)

const GITHUB_RAW_FULL_KEY = 'gamehub_github_raw_full';
const GITHUB_RAW_FULL_META = 'gamehub_github_raw_full_meta';
const GITHUB_RAW_FULL_TTL = 12 * 60 * 60 * 1000; // 12 hours


async function loadGenreMap() {
  if (_genreMap) return _genreMap;
  try {
    _genreMap = await fetch('/data/genre_map.json').then(r => r.json());
  } catch (e) {
    _genreMap = {};
  }
  return _genreMap;
}

async function loadSteamGenres() {
  if (_steamGenres) return _steamGenres;
  try {
    _steamGenres = await fetch('/data/steam_genres.json').then(r => r.json());
  } catch (e) {
    _steamGenres = [];
  }
  return _steamGenres;
}

async function mapGenres(rawGenres) {
  const map = await loadGenreMap();
  const global = new Set();

  rawGenres.forEach(g => {
    if (!g) return;
    let key = g.toLowerCase().trim();
    if (map[key]) {
      global.add(map[key]);
    } else {
      // partial match
      Object.keys(map).forEach(k => {
        if (key.includes(k)) global.add(map[k]);
      });
    }
  });

  return [...global];
}

function genreIdToName(id) {
  if (!_steamGenres) return id;
  const g = _steamGenres.find(x => x.id === id);
  return g ? g.name : id;
}

// Removed: loadAllAppList — no Steam API calls

// Extract compact app list (appid + name) from full raw dataset via bridge (no direct fetch)
async function fetchGithubAppList(force = false) {
  if (_githubAppList && _githubAppList.length && !force) return _githubAppList;
  try {
    // Check local cache first
    const cachedRaw = localStorage.getItem(GITHUB_CACHE_KEY);
    let cached = [];
    try { cached = cachedRaw ? JSON.parse(cachedRaw) : []; } catch(e) { cached = []; }
    const metaRaw = localStorage.getItem(GITHUB_CACHE_META);
    let meta = {};
    try { meta = metaRaw ? JSON.parse(metaRaw) : {}; } catch(e) { meta = {}; }

    if (!force && meta && meta.ts && (Date.now() - meta.ts) < GITHUB_CACHE_TTL && Array.isArray(cached) && cached.length) {
      _githubAppList = cached;
      try { if (window.desktopBridge && typeof window.desktopBridge.send === 'function') window.desktopBridge.send('AppLog', { message: '[fetchGithubAppList] menggunakan cache localStorage (tidak fetch)' }); } catch(_) {}
      return _githubAppList;
    }

    // Get full raw via bridge (disk cache), then extract compact list
    const full = await fetchGithubFullRaw(force);
    if (!full) {
      return cached || [];
    }

    // Extract appid + name from full raw
    let out = [];
    if (Array.isArray(full)) {
      for (const it of full) {
        if (typeof it === 'number') out.push({ appid: Number(it), name: '' });
        else if (it && typeof it === 'object') {
          const id = (it.appid || it.id);
          const name = (it.name || it.title || it.label || it.game || '');
          if (id !== undefined) out.push({ appid: Number(id), name: String(name || '') });
        }
      }
    } else if (full && typeof full === 'object') {
      // Object keyed by appid
      for (const [key, it] of Object.entries(full)) {
        if (it && typeof it === 'object') {
          const id = (it.appid || it.id || key);
          const name = (it.name || it.title || it.label || it.game || '');
          if (id !== undefined) out.push({ appid: Number(id), name: String(name || '') });
        }
      }
    }
    out = out.filter(x => x && Number.isFinite(x.appid)).map(x => ({ appid: Number(x.appid), name: String(x.name || '') }));
    
    // Cache compact list
    try {
      localStorage.setItem(GITHUB_CACHE_KEY, JSON.stringify(out));
      localStorage.setItem(GITHUB_CACHE_META, JSON.stringify({ ts: Date.now() }));
    } catch (e) {}
    _githubAppList = out;
    
    return _githubAppList;
  } catch (e) {
    return [];
  }
}

// DEPRECATED: Fetch and cache the full GitHub raw JSON (may be large).
// This function is kept for fallback compatibility but should use desktopBridge.getRawDataset() instead.
// The desktop bridge caches data on disk (not localStorage) which can handle large datasets.
async function fetchGithubFullRaw(force = false, customProgressCallback = null) {
  // Try desktop bridge first (preferred method)
  if (window.desktopBridge && typeof window.desktopBridge.getRawDataset === 'function') {
    try {
      // Setup progress callback if overlay is showing
      const overlay = document.getElementById('gamehub-block-overlay');
      const progressCb = (overlay || document.getElementById('gamehub-block-progress-container')) ? (percent, message) => {
        try {
          // Use custom callback if provided, otherwise use default
          if (customProgressCallback && typeof customProgressCallback === 'function') {
            customProgressCallback(percent, message);
          } else if (typeof updateBlockingOverlayProgress === 'function') {
            updateBlockingOverlayProgress(percent, message);
          }
        } catch (e) {}
      } : null;
      
      const raw = await window.desktopBridge.getRawDataset(force, progressCb);
      if (raw) return raw;
    } catch (e) {
      try { if (window.desktopBridge && typeof window.desktopBridge.send === 'function') window.desktopBridge.send('AppLog', { message: '[fetchGithubFullRaw] bridge error: ' + String(e && e.message) }); } catch(_) {}
      // Fall through to old localStorage method
    }
  }
  
  // No fallback: bridge is required. If bridge fails, return null.
  try { if (window.desktopBridge && typeof window.desktopBridge.send === 'function') window.desktopBridge.send('AppLog', { message: '[fetchGithubFullRaw] bridge tidak tersedia atau gagal, tidak ada fallback fetch langsung' }); } catch(_) {}
  return null;
}

// Return full metadata object for a single appid using desktop bridge (cached on disk)
async function getFullMetadataForAppid(appid) {
  try {
    if (!appid && appid !== 0) return null;
    const idStr = String(appid);
    
    // Try desktop bridge first (fast, cached on disk)
    if (window.desktopBridge && typeof window.desktopBridge.getMetadataForAppid === 'function') {
      try {
        try { if (window.desktopBridge && typeof window.desktopBridge.send === 'function') window.desktopBridge.send('AppLog', { message: '[getFullMetadataForAppid] menggunakan bridge untuk AppID ' + idStr }); } catch(_) {}
        const metadata = await window.desktopBridge.getMetadataForAppid(appid);
        if (metadata) {
          // Convert JsonElement to plain object if needed
          let result = metadata;
          if (metadata && typeof metadata === 'object' && 'GetRawText' in metadata) {
            // It's a JsonElement, parse it
            try {
              result = JSON.parse(metadata.GetRawText());
            } catch (e) {
              result = metadata;
            }
          }
          try { if (window.desktopBridge && typeof window.desktopBridge.send === 'function') window.desktopBridge.send('AppLog', { message: '[getFullMetadataForAppid] metadata ditemukan via bridge untuk AppID ' + idStr }); } catch(_) {}
          return result;
        }
      } catch (e) {
        try { if (window.desktopBridge && typeof window.desktopBridge.send === 'function') window.desktopBridge.send('AppLog', { message: '[getFullMetadataForAppid] bridge error: ' + String(e && e.message) }); } catch(_) {}
        // Fallback to old method
      }
    }
    
    // Fallback: try old fetchGithubFullRaw method (if bridge not available)
    // Note: This may fail for large datasets due to localStorage limits
    try {
      try { if (window.desktopBridge && typeof window.desktopBridge.send === 'function') window.desktopBridge.send('AppLog', { message: '[getFullMetadataForAppid] fallback ke fetchGithubFullRaw untuk AppID ' + idStr }); } catch(_) {}
      const raw = await fetchGithubFullRaw(false);
      if (!raw) {
        try { if (window.desktopBridge && typeof window.desktopBridge.send === 'function') window.desktopBridge.send('AppLog', { message: '[getFullMetadataForAppid] raw missing/null' }); } catch(_) {}
        return null;
      }
      // raw may be array or object keyed by appid
      if (Array.isArray(raw)) {
        for (const it of raw) {
          try {
            const id = String(it && (it.appid || it.id) || '');
            if (!id) continue;
            if (id === idStr) return it;
          } catch (e) {}
        }
      } else if (raw && typeof raw === 'object') {
        if (raw[idStr]) return raw[idStr];
        // sometimes keys are numeric strings; try numeric keys
        for (const k of Object.keys(raw)) {
          if (String(k) === idStr) return raw[k];
        }
      }
      try { if (window.desktopBridge && typeof window.desktopBridge.send === 'function') window.desktopBridge.send('AppLog', { message: '[getFullMetadataForAppid] tidak menemukan metadata untuk AppID ' + idStr }); } catch(_) {}
      return null;
    } catch (e) {
      return null;
    }
  } catch (e) { 
    return null; 
  }
}

// fetchGithubRawMetadataForIds removed (library-specific raw-mini helper)

// Return up to `count` appids sampled from the global app list, excluding ids in `excludeSet`.
// Removed: sampleAppIds — use GitHub raw list directly where needed

// Fallback: use Steam Store search results (JSON format) to gather appids when GetAppList is not available.
// Removed: searchStoreForAppids — no Steam store scraping

// Fetch a single search results page from Steam store and return appids found.
// Removed: fetchSearchPage — no Steam search usage

// Fetch search results and return array of { appid, title, thumb }
// Removed: fetchSearchResults — no Steam search usage

// Removed: parseResultsHtml — not needed

// Fuzzy normalizer (same logic as filter.js normalizeFuzzy)
function normalizeFuzzyAPI(s) {
  try {
    if (!s) return '';
    let t = String(s).toLowerCase();
    t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    t = t.replace(/[’'`´]/g, ' ');
    t = t.replace(/[®™©•··]/g, ' ');
    t = t.replace(/[^a-z0-9]+/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  } catch (e) { return ''; }
}


// Search the full raw dataset via bridge for matching titles (fuzzy substring).
async function searchGithub(query = '', limit = 50) {
  if (!query || !query.trim()) return [];
  const qnorm = normalizeFuzzyAPI(query);
  if (!qnorm) return [];
  const full = await fetchGithubFullRaw(false);
  if (!full || (!Array.isArray(full) && typeof full !== 'object')) return [];
  // Convert to array for search
  const list = Array.isArray(full) ? full : Object.values(full || {});
  if (!list || !list.length) return [];
  const out = [];
  for (const item of list) {
    try {
      const appid = Number(item.appid || item.id || 0);
      const name = String(item.name || item.title || '').toString();
      const nnorm = normalizeFuzzyAPI(name);
      // match numeric appid as well
      if (/^\d+$/.test(query.trim())) {
        if (String(appid) === query.trim()) out.push({ appid, title: name, thumb: item.header || item.thumb || '' });
      } else {
        // token + stemming match: all query tokens (stemmed) must appear in title tokens (stemmed)
        // Use simple tokenize (split by space) since tokenizeAndStem is in filter.js
        const qTokens = qnorm.split(' ').filter(Boolean);
        const nTokens = nnorm.split(' ').filter(Boolean);
        const set = new Set(nTokens);
        const allMatch = qTokens.every(t => set.has(t));
        if (allMatch) out.push({ appid, title: name, thumb: item.header || item.thumb || '' });
      }
    } catch (e) {}
    if (out.length >= limit) break;
  }
  return out;
}

// Remote search with query string. Returns array of appids found.
// Removed: remoteSearch — no Steam search usage



