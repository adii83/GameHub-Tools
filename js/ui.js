function toggleFilterPanel() {
  const w = document.getElementById("filter-panel-wrapper");
  if (!w) return;
  const shown = w.classList.contains("panel-shown");
  w.classList.toggle("panel-shown", !shown);
  w.classList.toggle("panel-hidden", shown);
}

function openDetail(appid) {
  const g = originalData.find((x) => x.appid === appid);
  if (!g) return;

  const drawer = document.getElementById('detail-drawer');
  const panel = document.getElementById('detail-drawer-panel');
  const card = document.getElementById('detail-card');

  const isPremium = g.price_initial >= PREMIUM_MIN;
  // Build genre badges using local catalog (cached)
  function getGenreCatalogSync() { return (window._genreCatalog || []); }
  async function ensureGenreCatalog() {
    if (Array.isArray(window._genreCatalog) && window._genreCatalog.length) return window._genreCatalog;
    try {
      const res = await fetch('/data/steam_genres.json', { cache: 'force-cache' });
      if (res.ok) {
        const data = await res.json();
        window._genreCatalog = Array.isArray(data) ? data : [];
      }
    } catch (e) { window._genreCatalog = []; }
    return window._genreCatalog;
  }
  function renderGenreBadges() {
    try {
      const catalog = getGenreCatalogSync();
      const byId = new Map();
      (catalog || []).forEach(g => byId.set(String(g.id).toLowerCase(), g));
      // collect from game
      let gs = [];
      if (Array.isArray(g.genre)) gs = g.genre;
      else if (typeof g.genre === 'string') gs = g.genre.split(',');
      const display = g.genre_display ? String(g.genre_display).split(',') : [];
      const unique = new Set();
      const items = [];
      [...gs, ...display].forEach(x => {
        const key = String(x || '').trim(); if (!key) return;
        const id = key.toLowerCase(); if (unique.has(id)) return;
        unique.add(id);
        const meta = byId.get(id) || { name: key, icon: '', color: '#374151' };
        const icon = meta.icon ? `<span class="mr-1">${meta.icon}</span>` : '';
        const name = meta.name || key;
        const color = meta.color || '#374151';
        items.push(`<span class="inline-flex items-center px-2 py-[3px] text-xs rounded-md" style="background:${color}20;border:1px solid ${color}40;color:#fff;">${icon}${name}</span>`);
      });
      if (!items.length) return '';
      return `<div class="flex flex-wrap gap-2 mt-2">${items.join('')}</div>`;
    } catch (e) { return ''; }
  }
  card.innerHTML = `
    <div class="flex flex-col gap-5 relative">
      <div class="relative flex items-center justify-center">
        <!-- blurred backdrop using header thumbnail -->
        <div class="absolute inset-0 rounded-xl" style="filter: blur(18px); opacity: 0.35; background: #0b0b0b;
             background-image: url('${escapeHtml(g.header || '')}'); background-size: cover; background-position: center;">
        </div>
        <div class="relative bg-[#0b0b0b] rounded-xl overflow-hidden border border-white/10 shadow-lg" style="width:460px;height:215px;">
          <img id="detail-header" src="${escapeHtml(g.header || '')}" class="w-full h-full object-contain" alt="${escapeHtml(g.title)}">
        </div>
        <button id="detail-close-btn" class="absolute right-4 top-4 gallery-nav-btn px-3 py-2 rounded-full shadow-md" aria-label="Close detail">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6l12 12M18 6L6 18" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>

      <div class="flex flex-col md:flex-row gap-6">
        <div class="flex-1">
          <div class="flex items-start justify-between">
            <div>
              <h2 class="text-2xl font-bold">${escapeHtml(g.title)}</h2>
              <p class="text-gray-400 mt-1 text-sm">${escapeHtml(g.genre_display || (Array.isArray(g.genre) ? g.genre.join(', ') : g.genre || ''))}</p>
              ${renderGenreBadges()}
            </div>
          </div>

          <div class="flex items-center gap-3 mt-4">
            <span class="inline-flex items-center gap-2 px-3 py-1 rounded bg-white/5 border border-white/10 text-sm font-medium">
              ${isPremium ? 'PREMIUM' : 'STANDAR'}
            </span>
            ${g.protection ? `<span class="inline-flex items-center gap-2 px-3 py-1 rounded bg-red-600/80 border border-red-400/30 text-sm font-medium">DENUVO</span>` : ``}
            <span class="inline-flex items-center gap-2 px-3 py-1 rounded bg-white/5 border border-white/10 text-sm">AppID: ${g.appid}</span>
          </div>

          <div class="mt-4 text-sm text-gray-200 leading-relaxed">
            ${g.short_description || 'No description.'}
          </div>

          <div class="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-300">
            <div>
              <div class="text-gray-500 text-xs mb-1">Developers</div>
              ${Array.isArray(g.developers) ? (escapeHtml(g.developers.join(', ')) || '-') : (escapeHtml(g.developers || '-'))}
            </div>
            <div>
              <div class="text-gray-500 text-xs mb-1">Publishers</div>
              ${Array.isArray(g.publishers) ? (escapeHtml(g.publishers.join(', ')) || '-') : (escapeHtml(g.publishers || '-'))}
            </div>
            <div>
              <div class="text-gray-500 text-xs mb-1">Release date</div>
              ${escapeHtml(g.release_date || '-')}
            </div>
            <div>
              <div class="text-gray-500 text-xs mb-1">Original price (IDR)</div>
              ${(() => {
                try {
                  if (g.price_display && typeof g.price_display === 'string' && g.price_display.trim()) return g.price_display;
                  const pn = Number(g.price_normalized ?? g.price_initial ?? 0);
                  if (!isFinite(pn) || pn <= 0) return '0';
                  return pn.toLocaleString('id-ID');
                } catch (e) { return '0'; }
              })()}
            </div>
          </div>
        </div>

        <div class="w-full md:w-64 flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <button id="btn-add-${g.appid}" class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:opacity-90">Add-Game</button>
            <button id="btn-onlinefix-${g.appid}" class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-sky-600 text-white text-sm font-medium hover:opacity-90">Online-Fix</button>
          </div>

          <div class="mt-auto">
            <button id="btn-restart-steam" class="w-full px-3 py-2 bg-slate-700 text-white rounded-md text-sm hover:opacity-90">Restart Steam</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // ensure catalog loaded (non-blocking for first render)
  try { ensureGenreCatalog().then(() => {
    try {
      const updated = renderGenreBadges();
      if (updated) {
        const container = card.querySelector('.flex.items-start .mt-1 + div') || card.querySelector('.flex.flex-wrap');
        // Best-effort: if found genre badges container position, refresh it
      }
    } catch (e) {}
  }); } catch (e) {}

  // wire up close button and simple keyboard close
  try {
    const closeBtn = card.querySelector('#detail-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => closeDetail());
    const keyHandler = (ev) => { if (ev.key === 'Escape') closeDetail(); };
    window._gamehub_gallery_key_handler = keyHandler;
    document.addEventListener('keydown', keyHandler);
  } catch (e) {}

  // tampilkan modal: fade + scale
  try {
    if (drawer) drawer.classList.remove('hidden');
    if (panel) {
      panel.style.opacity = '0';
      panel.style.transform = 'translate(-50%, -50%) scale(0.95)';
      requestAnimationFrame(() => {
        panel.style.opacity = '1';
        panel.style.transform = 'translate(-50%, -50%) scale(1)';
      });
    }
  } catch (e) {}

  // Raw-only: no on-demand protection fetching
}


function closeDetail() {
  const drawer = document.getElementById("detail-drawer");
  const panel = document.getElementById("detail-drawer-panel");
  try {
    if (panel) {
      panel.style.opacity = '0';
      panel.style.transform = 'translate(-50%, -50%) scale(0.95)';
    }
    // hide container after transition (200ms)
    setTimeout(() => {
      try { if (drawer) drawer.classList.add('hidden'); } catch (e) {}
    }, 220);
  } catch (e) {
    try { if (drawer) drawer.classList.add('hidden'); } catch (e) {}
  }
  // overlay click closes
  try {
    const overlay = document.getElementById('drawer-overlay');
    if (overlay) overlay.onclick = () => closeDetail();
  } catch (e) {}
  // cleanup keyboard handler if attached
  try {
    if (window._gamehub_gallery_key_handler) {
      document.removeEventListener('keydown', window._gamehub_gallery_key_handler);
      window._gamehub_gallery_key_handler = null;
    }
  } catch (e) {}
  // no video/hover listeners to clean up (gallery removed)
}
