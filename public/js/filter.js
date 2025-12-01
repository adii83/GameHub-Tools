// Normalize a string for fuzzy matching: lowercase, strip symbols/punctuation,
// remove diacritics, collapse whitespace, and normalize apostrophes.
function normalizeFuzzy(s) {
  try {
    if (!s) return '';
    let t = String(s).toLowerCase();
    // Normalize Unicode (remove diacritics)
    t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Replace various apostrophes and quotes with plain space
    t = t.replace(/[’'`´]/g, ' ');
    // Remove trademark/special symbols and general punctuation
    t = t.replace(/[®™©•··]/g, ' ');
    t = t.replace(/[^a-z0-9]+/g, ' ');
    // Collapse spaces
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  } catch (e) { return ''; }
}
function tokenizeAndStemLocal(s) {
  const tokens = (s || '').split(' ').filter(Boolean);
  const stem = (w) => (w.endsWith('s') ? w.slice(0, -1) : w);
  return tokens.map(stem);
}

// Library filter state (AppIDs from steam\config\stplug-in\*.lua files)
let libraryAppIds = new Set();
let libraryFilterActive = false;
// Expose to window for render.js
window.libraryFilterActive = false;

function applyFilters(render = true) {
  // Do not clear page cache on filter change; we avoid triggering rebuilds
  // so filtering operates only on already-fetched data.
  const standard = document.getElementById("chk-standard")?.checked;
  const premium = document.getElementById("chk-premium")?.checked;

  const denuvo = document.getElementById("chk-denuvo")?.checked;
  const nonDen = document.getElementById("chk-non-denuvo")?.checked;

  const genreChecks = [...document.querySelectorAll(".genreCheck:checked")].map(
    (x) => x.value.toLowerCase()
  );
  const search = document.getElementById("searchInput")?.value || "";
  const searchNorm = normalizeFuzzy(search);

  // Determine if any filters/search are active so render can avoid building
  // Also expose whether the active filters should force filling pages
  // (Premium/Standard should attempt to fill pages to PAGE_SIZE).
  try {
    window.filtersActive = !!(standard || premium || denuvo || nonDen || genreChecks.length > 0 || searchNorm || libraryFilterActive);
    window.fillFilteredPages = !!(standard || premium);
  } catch (e) {}

  // Special case: Library filter active but no games installed
  if (libraryFilterActive && libraryAppIds.size === 0) {
    filteredData = []; // Empty array - will show special empty state
  } else {
    filteredData = originalData.filter((game) => {
      // Library filter: only show games that have .lua file in stplug-in folder
      if (libraryFilterActive && libraryAppIds.size > 0) {
        if (!libraryAppIds.has(String(game.appid))) return false;
      }
    const isPremium = game.price_initial >= PREMIUM_MIN;

    // Search: fuzzy match normalized title or exact appid when numeric
    if (searchNorm) {
      const titleNorm = normalizeFuzzy(game.title || '');
      const numericSearch = /^\d+$/.test(search.trim());
      if (numericSearch) {
        if (String(game.appid) !== search.trim()) return false;
      } else {
        // token+stem match
        const qTokens = tokenizeAndStemLocal(searchNorm);
        const nTokens = tokenizeAndStemLocal(titleNorm);
        const set = new Set(nTokens);
        const allMatch = qTokens.every(t => set.has(t));
        if (!allMatch) return false;
      }
    }

    // Premium/Standard
    if (premium && !isPremium) return false;
    if (standard && isPremium) return false;

    // DRM
    // Treat unknown protection as non-Denuvo for filtering so filters do not
    // trigger network fetches. Only explicit Denuvo (true) counts as Denuvo.
    const isProtected = !!game.protection; // true only when explicitly true
    if (denuvo && !isProtected) return false;
    if (nonDen && isProtected) return false;

    // Genres (game.genre may be an array of canonical ids)
    if (genreChecks.length > 0) {
      let gameGenres = [];
      if (Array.isArray(game.genre)) {
        gameGenres = game.genre.map((x) => String(x).toLowerCase());
      } else if (typeof game.genre === "string") {
        gameGenres = game.genre.split(",").map((s) => s.trim().toLowerCase());
      }
      if (!genreChecks.some((g) => gameGenres.includes(g))) return false;
    }

      return true;
    });
  }

  // Update Library button visual state
  try {
    const libraryBtn = document.getElementById('nav-library');
    if (libraryBtn) {
      if (libraryFilterActive) {
        libraryBtn.classList.add('bg-blue-600/20', 'text-blue-300');
        libraryBtn.classList.remove('text-gray-300');
      } else {
        libraryBtn.classList.remove('bg-blue-600/20', 'text-blue-300');
        libraryBtn.classList.add('text-gray-300');
      }
    }
  } catch (e) {}

  if (render) {
    renderPage(1);
    // Friendly empty state if no results
    try {
      const list = document.getElementById('game-list');
      if (list && filteredData.length === 0) {
        // Special empty state for Library page when no games installed
        if (libraryFilterActive && libraryAppIds.size === 0) {
          list.innerHTML = `
            <div class="text-center py-16 px-4 border border-white/10 rounded-xl bg-gradient-to-br from-[#151515] to-[#0f0f0f]">
              <div class="max-w-md mx-auto">
                <div class="text-6xl mb-4">📚</div>
                <h3 class="text-xl font-semibold text-white mb-2">Tidak Ada Game di Library</h3>
                <p class="text-gray-400 text-sm mb-6 leading-relaxed">
                  Library Anda masih kosong. Tambahkan game kesukaan Anda dari halaman Games untuk memulai.
                </p>
                <button onclick="navigate('games')" 
                  class="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition shadow-lg hover:shadow-blue-500/50">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                  </svg>
                  Jelajahi Games
                </button>
              </div>
            </div>`;
        } else {
          // Generic empty state for other filters/search
          list.innerHTML = `
            <div class="text-center text-sm text-gray-400 py-10 border border-white/5 rounded-xl bg-[#151515]">
              Tidak ada game yang cocok dengan pencarian atau filter.
            </div>`;
        }
      }
    } catch (e) {}
  }
}

// Called when user presses Enter in the search box
function onSearchKeyDown(e) {
  try {
    if (e && (e.key === 'Enter' || e.keyCode === 13)) {
      e.preventDefault();
      performRemoteSearch();
    }
  } catch (err) {}
}

// Perform remote search (explicit user action). Merges results into remainingAppIds and
// triggers building for the current page. Shows blocking overlay while fetching/building.
async function performRemoteSearch() {
  try {
    const qRaw = document.getElementById('searchInput')?.value || '';
    const q = normalizeFuzzy(qRaw);
    if (!q) return;
    // Pencarian pada daftar data lokal (dari GitHub); buat placeholder tanpa build
    showBlockingOverlay('Mencari game di daftar data...', { closable: true });
    let metas = [];
    try {
      // Pass original raw query to remote search, but use fuzzy placement locally
      metas = await searchGithub(qRaw, PAGE_SIZE);
      
    } catch (e) { metas = []; }
    try {
      if (metas && metas.length) {
        const show = metas.slice(0, PAGE_SIZE);
        const existingIds = new Set(originalData.map(x => x.appid));
        for (let i = show.length - 1; i >= 0; i--) {
          const m = show[i];
          if (!existingIds.has(m.appid)) {
            const ph = { appid: m.appid, title: m.title || '', header: m.thumb || '', genre_display: '', _placeholder: true, price_initial: 0, price_normalized: 0, protection: false };
            originalData.unshift(ph);
            existingIds.add(m.appid);
          }
        }
        if (typeof applyFilters === 'function') applyFilters(true);
      } else {
        showTransientMessage('Tidak ada hasil ditemukan.', 4000, 'warning');
        // Also reflect in the list area for clarity
        try {
          const list = document.getElementById('game-list');
          if (list) {
            list.innerHTML = `
              <div class="text-center text-sm text-gray-400 py-10 border border-white/5 rounded-xl bg-[#151515]">
                Tidak ada game yang cocok dengan pencarian.
              </div>`;
          }
        } catch (e) {}
      }
    } catch (e) {}
  } catch (e) {
  } finally {
    hideBlockingOverlay();
  }
}

// Toggle exclusivity between two checkbox ids; allow unchecking both.
function exclusiveToggle(idA, idB, clickedEl) {
  try {
    const a = document.getElementById(idA);
    const b = document.getElementById(idB);
    if (!a || !b) return;
    // If the clicked element became checked, uncheck the other.
    if (clickedEl && clickedEl.checked) {
      if (clickedEl.id === idA) b.checked = false;
      else if (clickedEl.id === idB) a.checked = false;
    }
  } catch (e) {
    // ignore
  }
}

function resetFilters() {
  document.getElementById("chk-standard").checked = false;
  document.getElementById("chk-premium").checked = false;
  document.getElementById("chk-denuvo").checked = false;
  document.getElementById("chk-non-denuvo").checked = false;
  document.querySelectorAll(".genreCheck").forEach((x) => (x.checked = false));
  document.getElementById("searchInput").value = "";
  filteredData = originalData;
  renderPage(1);
}

// Debounce helper for local search input to reduce CPU/network churn
function debounce(fn, wait) {
  let t = null;
  return function(...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; try { fn.apply(this, args); } catch(e) {} }, wait);
  };
}

// Expose a 250ms debounced wrapper for the search input to call
window.debouncedApplyFilters = debounce(() => {
  try { applyFilters(true); } catch(e) {}
}, 250);

// Perbarui label "Terakhir diperbarui" secara netral dari meta cache
function updateLastUpdatedLabel() {
  try {
    const el = document.getElementById('last-updated');
    if (!el) return;
    const metaRaw = localStorage.getItem('gamehub_github_meta');
    let meta = {};
    try { meta = metaRaw ? JSON.parse(metaRaw) : {}; } catch(e) { meta = {}; }
    const ts = meta && meta.ts ? new Date(meta.ts) : null;
    if (ts) {
      const locale = navigator.language || 'id-ID';
      const fmt = ts.toLocaleString(locale, { hour12: false });
      el.textContent = `Terakhir diperbarui: ${fmt}`;
    } else {
      el.textContent = 'Terakhir diperbarui: —';
    }
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  try { updateLastUpdatedLabel(); } catch (e) {}
  // Populate genre list with full catalog
  try { loadGenreListCatalog(); } catch (e) {}
});

// Load and render the full genre catalog into the filter panel.
async function loadGenreListCatalog() {
  try {
    const container = document.getElementById('genreList');
    if (!container) return;
    // Fetch local catalog; if fails, derive from current data
    let catalog = [];
    try {
      const res = await fetch('/data/steam_genres.json', { cache: 'no-cache' });
      if (res.ok) catalog = await res.json();
    } catch (e) { catalog = []; }
    const names = new Map();
    // seed with catalog ids -> names
    (catalog || []).forEach(g => {
      if (g && g.id) names.set(String(g.id).toLowerCase(), g.name || g.id);
    });
    // also include any genres found in data set so nothing is missed
    try {
      (originalData || []).forEach(game => {
        if (!game) return;
        let gs = [];
        if (Array.isArray(game.genre)) gs = game.genre;
        else if (typeof game.genre === 'string') gs = (game.genre || '').split(',');
        gs.forEach(x => {
          const key = String(x || '').trim().toLowerCase();
          if (key) names.set(key, x);
        });
        const disp = game.genre_display || '';
        if (disp && !names.has(String(disp).toLowerCase())) names.set(String(disp).toLowerCase(), disp);
      });
    } catch (e) {}

    const entries = [...names.entries()].sort((a,b) => a[1].localeCompare(b[1]));
    container.innerHTML = '';
    for (const [val, label] of entries) {
      container.innerHTML += `
        <label class="flex items-center gap-2">
          <input type="checkbox" value="${val}" class="genreCheck accent-green-500" onchange="applyFilters()">
          <span>${label}</span>
        </label>`;
    }
  } catch (e) {}
}

// Compatibility function used from render.js: populate genre list based on
// provided data (usually originalData). If `data` is not provided we still
// load the canonical catalog so the UI shows all genres.
async function loadGenreList(data) {
  try {
    const container = document.getElementById('genreList');
    if (!container) return;

    // Try load canonical catalog first
    let catalog = [];
    try {
      const res = await fetch('/data/steam_genres.json', { cache: 'no-cache' });
      if (res.ok) catalog = await res.json();
    } catch (e) { catalog = []; }

    const names = new Map();
    // prefer canonical ordering from catalog
    (catalog || []).forEach(g => {
      const id = String(g.id || g.name || '').trim().toLowerCase();
      if (id) names.set(id, g.name || g.id);
    });

    // Also include genres found in the provided data so nothing is missed
    try {
      const src = Array.isArray(data) && data.length ? data : (Array.isArray(originalData) ? originalData : []);
      src.forEach(game => {
        if (!game) return;
        // game.genre can be array or comma-separated string
        let gs = [];
        if (Array.isArray(game.genre)) gs = game.genre;
        else if (typeof game.genre === 'string' && game.genre.trim()) gs = game.genre.split(',');
        gs.forEach(x => {
          const key = String(x || '').trim().toLowerCase();
          const label = String(x || '').trim();
          if (key && !names.has(key)) names.set(key, label || key);
        });
        // also add genre_display
        const disp = game.genre_display || '';
        if (disp) {
          const key = String(disp).trim().toLowerCase();
          if (key && !names.has(key)) names.set(key, disp);
        }
      });
    } catch (e) {}

    // Render checkboxes preserving any previously checked values
    const prevChecked = new Set([...document.querySelectorAll('.genreCheck:checked')].map(x => String(x.value)));
    const entries = [...names.entries()].sort((a,b) => a[1].localeCompare(b[1]));
    container.innerHTML = '';
    for (const [val, label] of entries) {
      const checked = prevChecked.has(val) ? 'checked' : '';
      container.innerHTML += `\n        <label class="flex items-center gap-2">\n          <input type="checkbox" value="${val}" class="genreCheck accent-green-500" onchange="applyFilters()" ${checked}>\n          <span>${label}</span>\n        </label>`;
    }
  } catch (e) {}
}

// Toggle Library filter (show only games with .lua files in stplug-in)
// Used for Library page - automatically activates filter and loads games
async function toggleLibraryFilter() {
  try {
    if (!window.desktopBridge || typeof window.desktopBridge.getLibraryAppIds !== 'function') {
      if (typeof showTransientMessage === 'function') {
        showTransientMessage('Bridge tidak tersedia', 3000, 'error');
      }
      // Fallback: init games page without filter
      if (typeof initGamesPage === 'function') {
        await initGamesPage();
      }
      return;
    }

    // Always activate library filter for Library page
    // Load AppIDs from C# bridge
    try {
      const appids = await window.desktopBridge.getLibraryAppIds();
      libraryAppIds = new Set(appids || []);
      
      // Initialize games page first if not already loaded
      if (!window.originalData || window.originalData.length === 0) {
        if (typeof initGamesPage === 'function') {
          await initGamesPage();
        }
      }
      
      if (libraryAppIds.size === 0) {
        if (typeof showTransientMessage === 'function') {
          showTransientMessage('Tidak ada game terinstall ditemukan', 3000, 'warning');
        }
        // Still show empty list
        libraryFilterActive = true;
        window.libraryFilterActive = true;
        applyFilters(true);
        return;
      }

      libraryFilterActive = true;
      window.libraryFilterActive = true;
      applyFilters(true);
      
      if (typeof showTransientMessage === 'function') {
        showTransientMessage(`Menampilkan ${libraryAppIds.size} game dari Library`, 3000, 'success');
      }
    } catch (e) {
      if (typeof showTransientMessage === 'function') {
        showTransientMessage('Gagal memuat Library: ' + (e.message || 'Unknown error'), 4000, 'error');
      }
      // Fallback: init games page without filter
      if (typeof initGamesPage === 'function') {
        await initGamesPage();
      }
    }
  } catch (e) {
    if (typeof showTransientMessage === 'function') {
      showTransientMessage('Error: ' + (e.message || 'Unknown error'), 4000, 'error');
    }
    // Fallback: init games page without filter
    if (typeof initGamesPage === 'function') {
      await initGamesPage();
    }
  }
}

// Expose to window
try {
  window.toggleLibraryFilter = toggleLibraryFilter;
} catch (e) {}
