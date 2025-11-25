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
  const search =
    document.getElementById("searchInput")?.value?.toLowerCase() || "";
  // normalize search token: remove non-alphanumeric and collapse spaces
  const normalize = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const searchNorm = normalize(search);

  // Determine if any filters/search are active so render can avoid building
  // Also expose whether the active filters should force filling pages
  // (Premium/Standard should attempt to fill pages to PAGE_SIZE).
  try {
    window.filtersActive = !!(standard || premium || denuvo || nonDen || genreChecks.length > 0 || searchNorm);
    window.fillFilteredPages = !!(standard || premium);
  } catch (e) {}

  filteredData = originalData.filter((game) => {
    const isPremium = game.price_initial >= PREMIUM_MIN;

    // Search: match normalized title or appid when numeric
    if (searchNorm) {
      const titleNorm = normalize(game.title || '');
      const numericSearch = /^\d+$/.test(search);
      if (numericSearch) {
        if (String(game.appid) !== search) return false;
      } else {
        if (!titleNorm.includes(searchNorm)) return false;
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

  if (render) renderPage(1);
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
    const q = document.getElementById('searchInput')?.value?.trim();
    if (!q) return;
    // If the user typed numeric appid(s) (e.g. "216150" or "216150, 440"), treat as direct appid lookup
    const numericListMatch = q.match(/^(\d+)([,\s]+\d+)*$/);
    if (numericListMatch) {
      const parts = q.split(/[,\s]+/).map(s => parseInt(s,10)).filter(n => !isNaN(n));
      if (parts.length) {
        showBlockingOverlay('Mencari appid dan membangun detail...', { closable: true });
        const seen = new Set(remainingAppIds.concat(originalData.map(x=>x.appid)));
        const toQueue = [];
        let builtCount = 0;
        // Try to build each requested appid immediately so it appears right away
        const buildPromises = parts.map(async (id) => {
          try {
            // If already present in originalData, skip building
            if (originalData.find(g => g.appid === id)) return { id, built: false, reason: 'already_built' };
            const g = await buildGame(id);
            if (g) {
              originalData.push(g);
              try { addBuiltCache(id); } catch(e) {}
              builtCount++;
              return { id, built: true };
            } else {
              // couldn't build now, queue for later
              return { id, built: false, reason: 'no_details' };
            }
          } catch (e) {
            return { id, built: false, reason: e && e.message };
          }
        });
        const results = await Promise.all(buildPromises);
        // For any that failed to build, add to remainingAppIds if not already present
        const existing = new Set(remainingAppIds.concat(originalData.map(x=>x.appid)));
        for (const r of results) {
          if (!r.built) {
            if (!existing.has(r.id)) { toQueue.push(r.id); existing.add(r.id); }
          }
        }
        if (toQueue.length) {
          // add to front so they're built sooner
          for (let i = toQueue.length - 1; i >= 0; i--) remainingAppIds.unshift(toQueue[i]);
          saveRemaining();
        }
        // reapply filters and render so built games show immediately
        if (typeof applyFilters === 'function') applyFilters(true);
        hideBlockingOverlay();
        showTransientMessage(`Mencoba ${parts.length} appid — berhasil: ${builtCount}, antrian: ${toQueue.length}`, 4000);
        return;
      }
    }
    // show blocking overlay with retry button
    showBlockingOverlay('Mencari game secara online...', { retry: true, retryPage: currentPage, closable: true });
    // fetch remote appids (first page)
    // Try to get search results with metadata (title/thumb)
    let metas = [];
    try {
      // Try GitHub raw list first
      try {
        metas = await searchGithub(q, PAGE_SIZE);
        if (metas && metas.length) console.log('[GameHub] performRemoteSearch found results from GitHub raw', metas.length);
      } catch (ghErr) {
        metas = [];
      }
      // If none found in GitHub raw, fall back to Steam search parsing
      if (!metas || metas.length === 0) {
        try {
          metas = await fetchSearchResults(q, 0, 50);
        } catch (e) {
          console.warn('[GameHub] fetchSearchResults threw', e && e.message);
          metas = [];
        }
      }
    } catch (e) {
      console.warn('[GameHub] performRemoteSearch search error', e && e.message);
      metas = [];
    }
    const ids = metas.map(m => m.appid);
    console.log('[GameHub] performRemoteSearch got', ids?.length || 0, 'ids (from fetchSearchResults)');
    // Create placeholder entries in originalData for immediate display (first page worth)
    try {
      if (metas && metas.length) {
        const show = metas.slice(0, PAGE_SIZE);
        const existingIds = new Set(originalData.map(x => x.appid));
        // insert placeholders at front in original order
        for (let i = show.length - 1; i >= 0; i--) {
          const m = show[i];
          if (!existingIds.has(m.appid)) {
            const ph = {
              appid: m.appid,
              title: m.title || '',
              header: m.thumb || '',
              header_candidates: [],
              genre_display: '',
              _placeholder: true
            };
            originalData.unshift(ph);
            existingIds.add(m.appid);
          }
        }
        // render page so placeholders appear immediately
        if (typeof applyFilters === 'function') applyFilters(true);
      }
    } catch (e) { console.warn('[GameHub] create placeholders failed', e && e.message); }
    // If remoteSearch returned nothing, attempt an HTML fallback to the regular search page
    if ((!ids || ids.length === 0) && typeof API_PROXY !== 'undefined') {
      try {
        const altUrl = API_PROXY + `https://store.steampowered.com/search/?term=${encodeURIComponent(q)}&cc=US&l=en`;
        console.log('[GameHub] performRemoteSearch trying HTML fallback', altUrl);
        const hdrs = { 'Referer': 'https://store.steampowered.com/' };
        try { hdrs['User-Agent'] = navigator.userAgent; } catch(e) {}
        const r2 = await fetch(altUrl, { cache: 'no-store', headers: hdrs });
        if (r2 && r2.ok) {
          const txt = await r2.text();
          const re = /\/app\/(\d+)\//g;
          const out = new Set();
          let m;
          while ((m = re.exec(txt)) !== null) {
            const id = parseInt(m[1], 10);
            if (!isNaN(id)) out.add(id);
          }
          const found = [...out];
          if (found.length) {
            console.log('[GameHub] performRemoteSearch HTML fallback found', found.length, 'ids');
            ids = found;
          } else {
            console.log('[GameHub] performRemoteSearch HTML fallback found 0 ids');
          }
        } else {
          console.warn('[GameHub] performRemoteSearch HTML fallback fetch non-ok', r2 && r2.status);
        }
      } catch (e) {
        console.warn('[GameHub] performRemoteSearch HTML fallback error', e && e.message);
      }
    }

    if (ids && ids.length) {
      // merge unique ids into remainingAppIds (avoid duplicates)
      const seen = new Set(remainingAppIds.concat(originalData.map(x=>x.appid)));
      const toAdd = [];
      for (const id of ids) {
        if (!seen.has(id)) {
          toAdd.push(id);
          seen.add(id);
        }
      }
      // Prioritize found ids by adding them to the front of the queue in original order
      if (toAdd.length) {
        for (let i = toAdd.length - 1; i >= 0; i--) remainingAppIds.unshift(toAdd[i]);
        saveRemaining();
      }
      console.log('[GameHub] performRemoteSearch merged', ids.length, 'found, added=', toAdd.length);
      // ensure page builds using the existing builder and report built count
      const before = originalData.length;
      await ensureGamesForPage(currentPage);
      const built = Math.max(0, originalData.length - before);
      // reapply filters and render
      if (typeof applyFilters === 'function') applyFilters(true);
      showTransientMessage(`Ditemukan ${ids.length} id, ditambahkan ${toAdd.length}, dibangun ${built}`, 4000);
    } else {
      showTransientMessage('Pencarian tidak menemukan hasil tambahan', 4000);
    }
  } catch (e) {
    console.warn('[GameHub] performRemoteSearch error', e && e.message);
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
