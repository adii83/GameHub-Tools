const CC = "id"; // region Indonesia
const PAGE_SIZE = 20;
const PREMIUM_MIN = 325000;
// CORS proxy yang digunakan untuk pengembangan lokal.
// Setelah debug, set ke "" atau ke proxy yang Anda pilih.
// Default development proxy: simple-proxy pada port 8082
const API_PROXY = "http://localhost:8082/";

// Debug log: tunjukkan proxy yang dipakai saat runtime
try { console.log('[GameHub] Using API_PROXY =', API_PROXY); } catch (e) {}

// Proxy health detection and short-circuit behavior
const PROXY_STATUS_KEY = 'gamehub_proxy_status';
const PROXY_DOWN_TTL = 5 * 60 * 1000; // 5 minutes pause when proxy reported down
let _proxyDownUntil = 0;

function markProxyDown(reason) {
  try {
    const until = Date.now() + PROXY_DOWN_TTL;
    _proxyDownUntil = until;
    const obj = { ts: Date.now(), until, reason: (reason && reason.message) ? reason.message : String(reason || '') };
    localStorage.setItem(PROXY_STATUS_KEY, JSON.stringify(obj));
    console.warn('[GameHub] markProxyDown', obj);
    try { if (window && typeof window.showProxyBanner === 'function') window.showProxyBanner(); } catch (e) {}
  } catch (e) {}
}

function markProxyUp() {
  try {
    _proxyDownUntil = 0;
    localStorage.removeItem(PROXY_STATUS_KEY);
    console.log('[GameHub] markProxyUp');
    try { if (window && typeof window.hideProxyBanner === 'function') window.hideProxyBanner(); } catch (e) {}
    // Notify UI that proxy recovered so it may resume builds
    try { if (window && typeof window.onProxyUp === 'function') window.onProxyUp(); } catch (e) {}
  } catch (e) {}
}

function isProxyLikelyDown() {
  try {
    if (_proxyDownUntil && Date.now() < _proxyDownUntil) return true;
    const raw = localStorage.getItem(PROXY_STATUS_KEY);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (obj && obj.until && Date.now() < obj.until) {
      _proxyDownUntil = obj.until;
      return true;
    }
  } catch (e) {}
  return false;
}

// Expose helper globally for other modules (render.js) to check quickly
try { window.isProxyLikelyDown = isProxyLikelyDown; } catch (e) {}

// trending list (front store)
async function fetchTrendingAppIds() {
  const url = API_PROXY + `https://store.steampowered.com/api/featuredcategories/?cc=${CC}&l=en`;
  try {
    console.log('[GameHub] fetchTrendingAppIds request', url);
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await res.text().catch(() => '<no-body>');
      const msg = `Trending fetch failed: ${res.status} ${res.statusText} - ${txt}`;
      console.error('[GameHub] ' + msg, { url, status: res.status, statusText: res.statusText, body: txt });
      throw new Error(msg);
    }
    const json = await res.json();
    console.log('[GameHub] fetchTrendingAppIds got json keys', Object.keys(json || {}));

    // Flexible extractor: scan the JSON for numeric 'id' or arrays of appids.
    const found = new Set();
    function extractIds(obj) {
      if (!obj) return;
      if (Array.isArray(obj)) {
        for (const v of obj) extractIds(v);
        return;
      }
      if (typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          if (k === 'id' || k === 'appid') {
            if (typeof v === 'number' && Number.isFinite(v)) found.add(v);
            if (typeof v === 'string' && /^\d+$/.test(v)) found.add(parseInt(v, 10));
          } else if (k === 'appids' || k === 'apps') {
            if (Array.isArray(v)) v.forEach(x => { if (typeof x === 'number') found.add(x); if (typeof x === 'string' && /^\d+$/.test(x)) found.add(parseInt(x,10)); });
          } else if (k === 'items' && Array.isArray(v)) {
            // items often contain objects with id
            v.forEach(it => { if (it && (it.id || it.appid)) extractIds(it); else extractIds(it); });
          } else {
            extractIds(v);
          }
        }
      }
    }

    extractIds(json);
    const ids = [...found].slice(0, 200); // limit
    console.log('[GameHub] fetchTrendingAppIds extracted ids count', ids.length, ids.slice(0,10));
    if (ids.length === 0) {
      console.warn('[GameHub] No appids found in featured JSON, logging full JSON preview for inspection');
      try { console.log(JSON.stringify(json).slice(0, 2000)); } catch(e) {}
      return [];
    }
    return ids;
  } catch (err) {
    console.error('[GameHub] fetchTrendingAppIds error', { url, error: err && err.message });
    throw err;
  }
}

// appdetails by appid
async function fetchAppDetails(appid) {
  const url = API_PROXY + `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${CC}&l=en`;
  // Short-circuit fetch attempts when proxy has recently reported as down
  try {
    if (isProxyLikelyDown && isProxyLikelyDown()) {
      console.warn('[GameHub] fetchAppDetails short-circuited due to proxy down', appid);
      return null;
    }
  } catch (e) {}
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await res.text().catch(() => '<no-body>');
      console.error('[GameHub] fetchAppDetails non-ok', { appid, url, status: res.status, body: txt });
      // signal rate limit to caller so it can backoff
      if (res.status === 429) return { data: null, rateLimited: true, status: res.status };
      return { data: null, rateLimited: false, status: res.status };
    }
    // mark proxy as up on first successful response
    try { markProxyUp(); } catch (e) {}
    const obj = await res.json();
    const data = obj?.[appid]?.data;
    return { data: data || null, rateLimited: false, status: res.status };
  } catch (err) {
    console.error('[GameHub] fetchAppDetails error', { appid, url, error: err && err.message });
    // network-level errors likely mean proxy is not reachable — mark as down to avoid spamming
    try { markProxyDown(err); } catch (e) {}
    return { data: null, rateLimited: false, status: 0 };
  }
}

// build normalized game object
async function buildGame(appid) {
  // Check per-app detail cache first
  try {
    const cached = getDetailCache(appid);
    if (cached && cached.ts && (Date.now() - cached.ts) < DETAIL_CACHE_TTL && cached.data) {
      return cached.data;
    }
  } catch (e) {}

  // Fetch app details with awareness of rate-limited responses
  let resp = await fetchAppDetails(appid);
  // If rate-limited, signal caller so it can requeue/backoff
  if (resp && resp.rateLimited) return { rateLimited: true };
  let d = resp && resp.data ? resp.data : null;
  // If appdetails failed, retry a couple times with small backoff — network/proxy issues can be transient
  if (!d) {
    for (let attempt = 1; attempt <= 2 && !d; attempt++) {
      console.warn('[GameHub] fetchAppDetails returned null for', appid, ' — retry attempt', attempt);
      await new Promise(r => setTimeout(r, 250 * attempt));
      try {
        resp = await fetchAppDetails(appid);
      } catch (e) { resp = { data: null, rateLimited: false }; }
      if (resp && resp.rateLimited) return { rateLimited: true };
      d = resp && resp.data ? resp.data : null;
    }
  }
  if (!d) return null;

  const title = d.name || "Unknown";
  const rawGenres = (d.genres || []).map((g) => g.description || "");
  // map to global genres (ids)
  const mapped = await mapGenres(rawGenres);
  // Prefer header provided by the appdetails API (may include hashed CDN path),
  // otherwise fallback to legacy steam/apps/<appid>/header.jpg path.
  const candidates = [];
  // Prefer API-provided header_image (hashed fastly path)
  if (d.header_image) candidates.push(d.header_image);
  // background or background_raw
  if (d.background) candidates.push(d.background);
  if (d.background_raw) candidates.push(d.background_raw);
  // screenshots (use first full path)
  if (Array.isArray(d.screenshots) && d.screenshots.length) {
    const s = d.screenshots[0];
    if (s.path_full) candidates.push(s.path_full);
    if (s.path_thumbnail) candidates.push(s.path_thumbnail);
  }
  // movies thumbnails
  if (Array.isArray(d.movies) && d.movies.length) {
    const m = d.movies[0];
    if (m.thumbnail) candidates.push(m.thumbnail);
  }
  // legacy fallback path
  candidates.push(`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`);

  // unique and keep order
  const header_candidates = [...new Set(candidates.filter(Boolean))];
  const header = header_candidates[0] || '';

  // build display string from mapped ids (fallback to raw string)
  const steamGenres = await loadSteamGenres();
  const genre_display = mapped.length
    ? mapped.map(id => (steamGenres.find(x => x.id === id)?.name || id)).join(", ")
    : (rawGenres.join(", ") || "Unknown");
  const price = d.price_overview?.initial ?? 0; // original price
  // Prefer the current (final) price when available; keep original price as backup
  const price_current = d.price_overview?.final ?? d.price_overview?.initial ?? 0;
  // formatted display price (if available)
  const price_display = d.price_overview?.final_formatted || d.price_overview?.initial_formatted || (d.is_free ? 'Free' : '');
  // Perform protection detection now (immediate) per user's request.
  // This requires fetching the store page HTML; it may be rate-limited by Steam.
  let protection = false;
  try {
    const prot = await detectProtection(appid, title);
    protection = !!prot;
  } catch (e) {
    protection = false;
  }

  // Normalize numeric price into IDR units for comparisons. Steam sometimes returns
  // prices in 'cents' or multiplied units; detect large values and scale down.
  let price_normalized = Number(price_current || 0);
  if (!isFinite(price_normalized)) price_normalized = 0;
  // If value looks extremely large (likely cents or multiplied), divide by 100
  if (price_normalized > 1000000) {
    price_normalized = Math.round(price_normalized / 100);
  }

  const result = {
    appid,
    title,
    genre: mapped, // array of global genre ids
    genre_display: genre_display,
    header,
    header_candidates,
    price_initial: price_current,
    price_original: price,
    price_display: price_display,
    price_normalized: price_normalized,
    protection,
    short_description: d.short_description || "",
    developers: d.developers || [],
    publishers: d.publishers || [],
    release_date: d.release_date?.date || "",
  };
  try { setDetailCache(appid, result); } catch (e) {}
  return result;
}

// Expose detectProtection so other modules (render/ui) can call it on-demand
try { window.detectProtection = detectProtection; } catch (e) {}


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

// Strong keywords (explicit DRM strings) and weak keywords (launchers/publishers)
// Weak keywords require contextual evidence (e.g. near words like DRM/protection)
const PROTECTION_STRONG = [
  "denuvo",
  "anti-tamper",
  "third-party drm",
  "3rd-party drm"
];
const PROTECTION_WEAK = [
  "ea app", "origin",
  "ubisoft connect", "uplay",
  "rockstar games launcher", "social club",
  "activision", "battle.net"
];

// localStorage cache
function getProtectionCache() {
  try { return JSON.parse(localStorage.getItem("protection_cache") || "{}"); }
  catch { return {}; }
}
function setProtectionCache(cache) {
  localStorage.setItem("protection_cache", JSON.stringify(cache));
}

async function detectProtection(appid, title = "") {
  const cache = getProtectionCache();
  if (cache[appid] !== undefined) return cache[appid];

  let has = false;
  try {
    const purl = API_PROXY + `https://store.steampowered.com/app/${appid}/?l=en`;
    const resp = await fetch(purl);
    if (!resp.ok) {
      const b = await resp.text().catch(() => '<no-body>');
      console.warn('[GameHub] detectProtection fetch non-ok', { appid, url: purl, status: resp.status, body: b });
    }
    const html = await resp.text().catch(() => '');
    const lower = html.toLowerCase();

    // Heuristic exclusion: pages that only mention a 3rd-party EULA or EULA
    // text but do NOT mention DRM/denuvo/anti-tamper should NOT be treated as DRM.
    // This avoids marking games as DENUVO just because they "require agreement
    // to a 3rd-party EULA".
    try {
      const mentionsEula = lower.includes('eula') || lower.includes('end user license') || lower.includes('end-user license');
      // Only consider explicit strong keywords as immediate deny. Avoid a generic
      // `lower.includes('drm')` check here because many pages mention 'drm' or
      // related words in unrelated contexts (e.g. store footers, third-party
      // policies) which produces false positives.
      const mentionsDeny = PROTECTION_STRONG.some(k => lower.includes(k));
      if (mentionsEula && !mentionsDeny) {
        cache[appid] = false;
        setProtectionCache(cache);
        return false;
      }
    } catch (e) {}

    // 1) Quick pass: explicit strong keywords
    for (const k of PROTECTION_STRONG) {
      if (lower.includes(k)) { has = true; break; }
    }

    // 2) Weak keywords only count if they appear near DRM/protection terms
    if (!has) {
      // build a regex that looks for weak keyword within 80 chars of drm/protection words
      const drmWords = '(drm|anti[- ]?tamper|protection|required|requires|third[- ]?party)';
      for (const wk of PROTECTION_WEAK) {
        // escape wk for regex
        const esc = wk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re1 = new RegExp(drmWords + '[\s\S]{0,80}' + esc, 'i');
        const re2 = new RegExp(esc + '[\s\S]{0,80}' + drmWords, 'i');
        if (re1.test(lower) || re2.test(lower)) { has = true; break; }
      }
    }

    // 3) As a final conservative check, look within the "about" section if present
    if (!has) {
      const aboutIdx = lower.indexOf('about this game');
      if (aboutIdx !== -1) {
        const snippet = lower.substring(aboutIdx, Math.min(lower.length, aboutIdx + 2000));
        for (const k of PROTECTION_STRONG) if (snippet.includes(k)) { has = true; break; }
        if (!has) {
          for (const wk of PROTECTION_WEAK) {
            const esc = wk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re1 = new RegExp(drmWords + '[\s\S]{0,120}' + esc, 'i');
            const re2 = new RegExp(esc + '[\s\S]{0,120}' + drmWords, 'i');
            if (re1.test(snippet) || re2.test(snippet)) { has = true; break; }
          }
        }
      }
    }
  } catch (e) {
    // fail silently
    has = false;
  }

  cache[appid] = !!has;
  setProtectionCache(cache);
  return !!has;
}

// --- Genre mapping helpers ---
let _genreMap = null;
let _steamGenres = null;
let _allApps = null; // cache for ISteamApps/GetAppList
let _githubAppList = null; // cache for GitHub raw appid list

const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/jsnli/steamappidlist/refs/heads/master/data/games_appid.json';
const GITHUB_CACHE_KEY = 'gamehub_github_appids';
const GITHUB_CACHE_META = 'gamehub_github_meta';
const GITHUB_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours
const DETAIL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours for per-app details

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

// --- Helpers to sample more appids from the full Steam app list ---
async function loadAllAppList() {
  if (_allApps) return _allApps;
  try {
    const candidates = [
      'https://api.steampowered.com/ISteamApps/GetAppList/v2/',
      'https://api.steampowered.com/ISteamApps/GetAppList/v0002/',
      'https://api.steampowered.com/ISteamApps/GetAppList/v1/',
      'https://api.steampowered.com/ISteamApps/GetAppList/v0001/'
    ];

    let lastError = null;
    for (const c of candidates) {
      const url = API_PROXY + c;
      console.log('[GameHub] loadAllAppList trying', url);
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          console.warn('[GameHub] loadAllAppList non-ok', res.status, body && body.slice(0,200));
          lastError = new Error('Non-ok ' + res.status);
          continue;
        }
        const js = await res.json();
        const apps = js?.applist?.apps || [];
        if (apps && apps.length) {
          _allApps = apps.map(a => a.appid).filter(Boolean);
          console.log('[GameHub] loadAllAppList success, count=', _allApps.length);
          return _allApps;
        } else {
          console.warn('[GameHub] loadAllAppList response did not contain applist.apps');
          lastError = new Error('No apps in response');
        }
      } catch (e) {
        console.warn('[GameHub] loadAllAppList fetch failed for', c, e && e.message);
        lastError = e;
        continue;
      }
    }

    console.warn('[GameHub] loadAllAppList all candidates failed');
    if (lastError) console.warn(lastError && lastError.message);
    _allApps = [];
    return _allApps;
  } catch (e) {
    console.error('[GameHub] loadAllAppList error', e && e.message);
    _allApps = [];
  }
  return _allApps;
}

// Try fetching a maintained appid list from a GitHub raw URL. Cache in localStorage for TTL.
async function fetchGithubAppList(force = false) {
  if (_githubAppList && _githubAppList.length && !force) return _githubAppList;
  try {
    // check local cache and meta
    const cachedRaw = localStorage.getItem(GITHUB_CACHE_KEY);
    let cached = [];
    try { cached = cachedRaw ? JSON.parse(cachedRaw) : []; } catch(e) { cached = []; }
    const metaRaw = localStorage.getItem(GITHUB_CACHE_META);
    let meta = {};
    try { meta = metaRaw ? JSON.parse(metaRaw) : {}; } catch(e) { meta = {}; }

    if (!force && meta && meta.ts && (Date.now() - meta.ts) < GITHUB_CACHE_TTL && Array.isArray(cached) && cached.length) {
      _githubAppList = cached;
      console.log('[GameHub] fetchGithubAppList loaded from cache', _githubAppList.length);
      return _githubAppList;
    }

    console.log('[GameHub] fetching GitHub raw appid list', GITHUB_RAW_URL, 'force=', !!force);
    const headers = {};
    if (!force) {
      if (meta && meta.etag) headers['If-None-Match'] = meta.etag;
      if (meta && meta.lastModified) headers['If-Modified-Since'] = meta.lastModified;
    }
    const res = await fetch(GITHUB_RAW_URL, { cache: 'no-store', headers });
    if (res.status === 304) {
      // Not modified
      _githubAppList = cached;
      try { localStorage.setItem(GITHUB_CACHE_META, JSON.stringify(Object.assign({}, meta, { ts: Date.now() }))); } catch(e) {}
      console.log('[GameHub] fetchGithubAppList not modified, using cache', _githubAppList.length);
      return _githubAppList;
    }
    if (!res.ok) {
      console.warn('[GameHub] fetchGithubAppList non-ok', res.status);
      return cached || [];
    }
    const js = await res.json();
    let out = [];
    if (Array.isArray(js)) {
      for (const it of js) {
        if (typeof it === 'number') out.push({ appid: Number(it), name: '' });
        else if (it && typeof it === 'object') {
          const id = (it.appid || it.id);
          const name = (it.name || it.title || it.label || it.game || '');
          if (id !== undefined) out.push({ appid: Number(id), name: String(name || '') });
        }
      }
    }
    out = out.filter(x => x && Number.isFinite(x.appid)).map(x => ({ appid: Number(x.appid), name: String(x.name || '') }));
    // persist cache and meta
    try {
      localStorage.setItem(GITHUB_CACHE_KEY, JSON.stringify(out));
      const etag = res.headers.get('ETag');
      const last = res.headers.get('Last-Modified');
      localStorage.setItem(GITHUB_CACHE_META, JSON.stringify({ ts: Date.now(), etag: etag, lastModified: last }));
    } catch (e) {}
    _githubAppList = out;
    console.log('[GameHub] fetchGithubAppList fetched count', out.length);
    return _githubAppList;
  } catch (e) {
    console.warn('[GameHub] fetchGithubAppList error', e && e.message);
    return [];
  }
}

// Return up to `count` appids sampled from the global app list, excluding ids in `excludeSet`.
async function sampleAppIds(excludeSet = new Set(), count = 200) {
  await loadAllAppList();
  if (_allApps && _allApps.length) {
    const pool = [];
    for (const id of _allApps) {
      if (!excludeSet.has(id)) pool.push(id);
    }
    // shuffle (Fisher-Yates) but only up to needed
    for (let i = pool.length - 1; i > 0 && pool.length - 1 - i < count; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    return pool.slice(0, count);
  }
  // Fallback: try fetching appids from Steam store search results
  // Try maintained GitHub raw list first (kept up-to-date). This reduces need to scrape.
  try {
    const gh = await fetchGithubAppList();
    if (Array.isArray(gh) && gh.length) {
      const ghIds = gh.map(x => (typeof x === 'number' ? x : x.appid)).filter(Boolean);
      const outgh = ghIds.filter(id => !excludeSet.has(id)).slice(0, count);
      if (outgh && outgh.length) {
        console.log('[GameHub] sampleAppIds using GitHub raw fallback, count=', outgh.length);
        return outgh;
      }
    }
  } catch (e) {}

  const fromSearch = await searchStoreForAppids(excludeSet, count);
  if (fromSearch && fromSearch.length) return fromSearch;
  // Last-resort: use local popular_appids.json file if present
  try {
    const raw = await fetch('/data/popular_appids.json').then(r => r.json()).catch(() => null);
    if (Array.isArray(raw) && raw.length) {
      const out = raw.filter(id => !excludeSet.has(id)).slice(0, count);
      if (out && out.length) {
        console.log('[GameHub] sampleAppIds using local popular_appids.json fallback, count=', out.length);
        return out;
      }
    }
  } catch (e) {
    // ignore
  }
  return [];
}

// Fallback: use Steam Store search results (JSON format) to gather appids when GetAppList is not available.
async function searchStoreForAppids(excludeSet = new Set(), needed = 200) {
  const collected = [];
  let start = 0;
  const pageSize = 50;
  let attempts = 0;
  while (collected.length < needed && attempts < 20) {
    attempts++;
    const url = API_PROXY + `https://store.steampowered.com/search/results/?query&start=${start}&count=${pageSize}&format=json&cc=US&l=en`;
    console.log('[GameHub] searchStoreForAppids fetch', url);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn('[GameHub] searchStoreForAppids non-ok', res.status);
        break;
      }
      const js = await res.json();
      const html = js && js.results_html;
      if (!html) {
        console.warn('[GameHub] searchStoreForAppids no results_html');
        break;
      }
      // extract appids from hrefs like /app/<appid>/ or /sub/<id>/, prefer /app/
      const re = /\/app\/(\d+)\//g;
      let m;
      const found = [];
      while ((m = re.exec(html)) !== null) {
        const id = parseInt(m[1], 10);
        if (!isNaN(id) && !excludeSet.has(id) && !collected.includes(id)) found.push(id);
      }
      // append uniques
      for (const id of found) {
        if (collected.length >= needed) break;
        collected.push(id);
      }
      // if we found fewer than pageSize, assume we've reached end
      if (found.length < pageSize) break;
      start += pageSize;
      // small delay to be polite
      await new Promise(r => setTimeout(r, 150));
    } catch (e) {
      console.warn('[GameHub] searchStoreForAppids error', e && e.message);
      break;
    }
  }
  console.log('[GameHub] searchStoreForAppids collected', collected.length);
  return collected;
}

// Fetch a single search results page from Steam store and return appids found.
async function fetchSearchPage(start = 0, count = 50, cc = 'US') {
  const url = API_PROXY + `https://store.steampowered.com/search/results/?query&start=${start}&count=${count}&format=json&cc=${cc}&l=en`;
  console.log('[GameHub] fetchSearchPage', url);
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Add headers to mimic a browser XHR request — helps avoid some agecheck/redirect responses
      const hdrs = {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://store.steampowered.com/',
      };
      try { hdrs['User-Agent'] = navigator.userAgent; } catch(e) {}
      const res = await fetch(url, { cache: 'no-store', headers: hdrs });
      if (!res.ok) {
        console.warn('[GameHub] fetchSearchPage non-ok', res.status, 'attempt', attempt);
        // if client error, don't retry too much
        if (res.status >= 400 && res.status < 500) break;
        await new Promise(r => setTimeout(r, 200 * attempt));
        continue;
      }

      // Try parse as JSON first (normal response)
      try {
        const js = await res.clone().json();
        const html = js && js.results_html;
        if (html) {
          const re = /\/app\/(\d+)\//g;
          const out = new Set();
          let m;
          while ((m = re.exec(html)) !== null) {
            const id = parseInt(m[1], 10);
            if (!isNaN(id)) out.add(id);
          }
          return [...out];
        }
      } catch (jsonErr) {
        // Not JSON — fallback to parsing text/html body
        try {
          const text = await res.text();
          // If the response contains a script/html (redirect/agecheck/page), still try to extract /app/<id>/ links
          const re = /\/app\/(\d+)\//g;
          const out = new Set();
          let m;
          while ((m = re.exec(text)) !== null) {
            const id = parseInt(m[1], 10);
            if (!isNaN(id)) out.add(id);
          }
          if (out.size) return [...out];
          // nothing found — try fetching the non-json search page (HTML) as a last resort for this attempt
          try {
            const altUrl = API_PROXY + `https://store.steampowered.com/search/?query&start=${start}&count=${count}&cc=${cc}&l=en`;
            console.log('[GameHub] fetchSearchPage trying HTML fallback', altUrl);
            const res2 = await fetch(altUrl, { cache: 'no-store', headers: hdrs });
            if (res2 && res2.ok) {
              const t2 = await res2.text();
              const out2 = new Set();
              let mm;
              while ((mm = re.exec(t2)) !== null) {
                const id = parseInt(mm[1], 10);
                if (!isNaN(id)) out2.add(id);
              }
              if (out2.size) return [...out2];
            }
          } catch (altErr) {
            console.warn('[GameHub] fetchSearchPage HTML fallback error', altErr && altErr.message);
          }
          // nothing found, maybe blocked — retry a few times
          console.warn('[GameHub] fetchSearchPage parse fallback found 0 ids, attempt', attempt);
        } catch (tErr) {
          console.warn('[GameHub] fetchSearchPage text parse error', tErr && tErr.message);
        }
      }
    } catch (e) {
      console.warn('[GameHub] fetchSearchPage error', e && e.message, 'attempt', attempt);
    }
    // backoff
    await new Promise(r => setTimeout(r, 250 * attempt));
  }
  return [];
}

// Fetch search results and return array of { appid, title, thumb }
async function fetchSearchResults(query = '', start = 0, count = 50, cc = 'US') {
  const url = API_PROXY + `https://store.steampowered.com/search/results/?query=${encodeURIComponent(query)}&start=${start}&count=${count}&format=json&cc=${cc}&l=en`;
  console.log('[GameHub] fetchSearchResults', url);
  const hdrs = {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': 'https://store.steampowered.com/',
  };
  try { hdrs['User-Agent'] = navigator.userAgent; } catch(e) {}

  try {
    const res = await fetch(url, { cache: 'no-store', headers: hdrs });
    if (!res.ok) {
      console.warn('[GameHub] fetchSearchResults non-ok', res.status);
      return [];
    }
    // try JSON first
    try {
      const js = await res.clone().json();
      const html = js && js.results_html;
      if (html) {
        return parseResultsHtml(html);
      }
    } catch (je) {
      // fall through to text
    }
    const text = await res.text();
    if (text) {
      return parseResultsHtml(text);
    }
  } catch (e) {
    console.warn('[GameHub] fetchSearchResults error', e && e.message);
  }
  return [];
}

function parseResultsHtml(html) {
  const out = [];
  // find each search_result_row anchor
  const re = /<a[^>]*href="\/app\/(\d+)\/[^\"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const id = parseInt(m[1], 10);
      const block = m[2];
      // title
      let title = '';
      const tmatch = /class="title">([^<]+)</i.exec(block);
      if (tmatch && tmatch[1]) title = tmatch[1].trim();
      // thumbnail
      let thumb = '';
      const im = /<img[^>]*src="([^"]+)"/i.exec(block);
      if (im && im[1]) thumb = im[1];
      if (id) out.push({ appid: id, title: title || '', thumb: thumb || '' });
    } catch (e) { continue; }
  }
  // de-duplicate by appid preserving order
  const seen = new Set();
  const uniq = [];
  for (const r of out) {
    if (!seen.has(r.appid)) { seen.add(r.appid); uniq.push(r); }
  }
  return uniq;
}

// Search the cached GitHub app list for matching titles (fuzzy substring).
async function searchGithub(query = '', limit = 50) {
  if (!query || !query.trim()) return [];
  const qnorm = (query || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!qnorm) return [];
  const list = await fetchGithubAppList();
  if (!list || !list.length) return [];
  const out = [];
  for (const item of list) {
    try {
      const name = (item.name || '').toString();
      const nnorm = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      // match numeric appid as well
      if (/^\d+$/.test(query)) {
        if (String(item.appid) === query) out.push({ appid: item.appid, title: name, thumb: '' });
      } else {
        if (nnorm.includes(qnorm)) out.push({ appid: item.appid, title: name, thumb: '' });
      }
    } catch (e) {}
    if (out.length >= limit) break;
  }
  return out;
}

// Remote search with query string. Returns array of appids found.
async function remoteSearch(query = '', start = 0, count = 50, cc = 'US') {
  if (!query || !query.trim()) return [];
  const url = API_PROXY + `https://store.steampowered.com/search/results/?query=${encodeURIComponent(query)}&start=${start}&count=${count}&format=json&cc=${cc}&l=en`;
  console.log('[GameHub] remoteSearch', url);
  // Reuse fetchSearchPage logic but with custom URL building
  const maxAttempts = 3;
  const hdrs = {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': 'https://store.steampowered.com/',
  };
  try { hdrs['User-Agent'] = navigator.userAgent; } catch (e) {}

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store', headers: hdrs });
      if (!res.ok) {
        console.warn('[GameHub] remoteSearch non-ok', res.status, 'attempt', attempt);
        if (res.status >= 400 && res.status < 500) break;
        await new Promise(r => setTimeout(r, 200 * attempt));
        continue;
      }

      try {
        const js = await res.clone().json();
        const html = js && js.results_html;
        if (html) {
          const re = /\/app\/(\d+)\//g;
          const out = new Set();
          let m;
          while ((m = re.exec(html)) !== null) {
            const id = parseInt(m[1], 10);
            if (!isNaN(id)) out.add(id);
          }
          return [...out];
        }
      } catch (jsonErr) {
        try {
          const text = await res.text();
          const re = /\/app\/(\d+)\//g;
          const out = new Set();
          let m;
          while ((m = re.exec(text)) !== null) {
            const id = parseInt(m[1], 10);
            if (!isNaN(id)) out.add(id);
          }
          if (out.size) return [...out];
        } catch (tErr) {
          console.warn('[GameHub] remoteSearch text parse error', tErr && tErr.message);
        }
      }
    } catch (e) {
      console.warn('[GameHub] remoteSearch error', e && e.message, 'attempt', attempt);
    }
    await new Promise(r => setTimeout(r, 250 * attempt));
  }
  return [];
}



