// Raw-only mode: remove Steam endpoints and proxy usage
const PAGE_SIZE = 20;
const PREMIUM_MIN = 350000; // price >= this is premium tier

// Removed: fetchAppDetails — not used in raw-only pipeline

// Removed: buildGame — per-app details are not fetched

// Removed: expose detectProtection


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

const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/adii83/steam-metadata-archive/refs/heads/main/steam_data.json';
const GITHUB_CACHE_KEY = 'gamehub_github_appids';
const GITHUB_CACHE_META = 'gamehub_github_meta';
const GITHUB_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours
// Removed: DETAIL_CACHE_TTL — not used without per-app fetch

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


// Search the cached GitHub app list for matching titles (fuzzy substring).
async function searchGithub(query = '', limit = 50) {
  if (!query || !query.trim()) return [];
  const qnorm = normalizeFuzzyAPI(query);
  if (!qnorm) return [];
  const list = await fetchGithubAppList();
  if (!list || !list.length) return [];
  const out = [];
  for (const item of list) {
    try {
      const name = (item.name || '').toString();
      const nnorm = normalizeFuzzyAPI(name);
      // match numeric appid as well
      if (/^\d+$/.test(query.trim())) {
        if (String(item.appid) === query.trim()) out.push({ appid: item.appid, title: name, thumb: '' });
      } else {
        // token + stemming match: all query tokens (stemmed) must appear in title tokens (stemmed)
        const qTokens = tokenizeAndStem(qnorm);
        const nTokens = tokenizeAndStem(nnorm);
        const set = new Set(nTokens);
        const allMatch = qTokens.every(t => set.has(t));
        if (allMatch) out.push({ appid: item.appid, title: name, thumb: '' });
      }
    } catch (e) {}
    if (out.length >= limit) break;
  }
  return out;
}

// Remote search with query string. Returns array of appids found.
// Removed: remoteSearch — no Steam search usage



