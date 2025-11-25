function toggleFilterPanel() {
  const w = document.getElementById("filter-panel-wrapper");
  if (!w) return;
  const shown = w.classList.contains("panel-shown");
  w.classList.toggle("panel-shown", !shown);
  w.classList.toggle("panel-hidden", shown);
}

// close drawer when clicking overlay
document.addEventListener("click", (e) => {
  const drawer = document.getElementById("detail-drawer");
  if (!drawer || drawer.classList.contains("hidden")) return;
  if (e.target.id === "drawer-overlay") closeDetail();
});

function openDetail(appid) {
  const g = originalData.find((x) => x.appid === appid);
  if (!g) return;

  const drawer = document.getElementById("detail-drawer");
  const panel = document.getElementById("detail-drawer-panel");
  const card = document.getElementById("detail-card");

  const isPremium = g.price_initial >= PREMIUM_MIN;
  card.innerHTML = `
    <div class="flex flex-col gap-4 relative">
      <!-- Gallery full-width on top -->
      <div class="relative">
        <div class="bg-[#0b0b0b] rounded-lg overflow-hidden border border-white/5 h-64 md:h-72 w-full">
          <img id="gallery-main" src="${escapeHtml(g.header || '')}" class="w-full h-full object-cover" alt="${escapeHtml(g.title)}">
        </div>
        <!-- prev/next buttons (dark translucent background, white svg icons) -->
        <button id="gallery-prev" class="gallery-nav-btn absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full shadow-md" aria-label="Previous image">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 18l-6-6 6-6" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button id="gallery-next" class="gallery-nav-btn absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full shadow-md" aria-label="Next image">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 6l6 6-6 6" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <!-- close button top-right (single, elongated pill background like nav buttons, white X icon) -->
        <button id="detail-close-btn" class="absolute right-4 top-4 gallery-nav-btn px-3 py-2 rounded-full shadow-md" aria-label="Close detail">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6l12 12M18 6L6 18" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>

        <div id="gallery-thumbs" class="flex gap-2 mt-3 overflow-x-auto thumb-scroll py-1">
          <!-- thumbnails injected -->
        </div>
      </div>

      <!-- Content below gallery -->
      <div class="flex flex-col md:flex-row gap-6">
        <div class="flex-1">
          <div class="flex items-start justify-between">
            <div>
              <h2 class="text-2xl font-bold">${escapeHtml(g.title)}</h2>
              <p class="text-gray-400 mt-1 text-sm">${escapeHtml(g.genre || '')}</p>
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
            ${g.short_description || "No description."}
          </div>

          <div class="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-300">
            <div>
              <div class="text-gray-500 text-xs mb-1">Developers</div>
              ${Array.isArray(g.developers) ? (escapeHtml(g.developers.join(", ")) || "-") : (escapeHtml(g.developers || "-"))}
            </div>
            <div>
              <div class="text-gray-500 text-xs mb-1">Publishers</div>
              ${Array.isArray(g.publishers) ? (escapeHtml(g.publishers.join(", ")) || "-") : (escapeHtml(g.publishers || "-"))}
            </div>
            <div>
              <div class="text-gray-500 text-xs mb-1">Release date</div>
              ${escapeHtml(g.release_date || "-")}
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

    // Initialize gallery thumbnails with prev/next and keyboard support
  try {
    const thumbContainer = card.querySelector('#gallery-thumbs');
    const mainImg = card.querySelector('#gallery-main');
    const prevBtn = card.querySelector('#gallery-prev');
    const nextBtn = card.querySelector('#gallery-next');
    const closeBtn = card.querySelector('#detail-close-btn');
    const candidates = Array.isArray(g.header_candidates) && g.header_candidates.length ? g.header_candidates : [g.header].filter(Boolean);
    let currentIndex = 0;

    const updateGallery = (i) => {
      if (!candidates || !candidates.length) return;
      currentIndex = (i + candidates.length) % candidates.length;
      const src = candidates[currentIndex];
      try { mainImg.src = src; } catch (e) {}
      // mark active thumb
      Array.from(thumbContainer.children).forEach((c, idx) => {
        c.classList.toggle('selected', idx === currentIndex);
      });
      // scroll thumbnail into view
      try { const el = thumbContainer.children[currentIndex]; if (el) el.scrollIntoView({behavior:'smooth', inline:'center', block:'nearest'}); } catch(e){}
    };

    if (thumbContainer && mainImg && candidates && candidates.length) {
      thumbContainer.innerHTML = '';
      candidates.forEach((src, idx) => {
        try {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'gallery-thumb flex-none w-20 h-12 rounded overflow-hidden ring-1 ring-white/5 transition-transform duration-150';
          btn.style.padding = '0';
          const img = document.createElement('img');
          img.src = src;
          img.className = 'w-full h-full object-cover';
          img.alt = g.title + ' screenshot ' + (idx+1);
          btn.appendChild(img);
          btn.addEventListener('click', () => {
            updateGallery(idx);
          });
          thumbContainer.appendChild(btn);
        } catch(e){}
      });

      // set initial
      updateGallery(0);

      // prev/next handlers
      if (prevBtn) prevBtn.addEventListener('click', () => updateGallery(currentIndex - 1));
      if (nextBtn) nextBtn.addEventListener('click', () => updateGallery(currentIndex + 1));

      // close button wired to same closeDetail
      if (closeBtn) closeBtn.addEventListener('click', () => closeDetail());

      // keyboard navigation while drawer open
      const keyHandler = (ev) => {
        if (ev.key === 'ArrowLeft') { ev.preventDefault(); updateGallery(currentIndex - 1); }
        else if (ev.key === 'ArrowRight') { ev.preventDefault(); updateGallery(currentIndex + 1); }
        else if (ev.key === 'Escape') { closeDetail(); }
      };
      // attach and keep reference for cleanup
      window._gamehub_gallery_key_handler = keyHandler;
      document.addEventListener('keydown', keyHandler);
    }
  } catch (e) {}

  // show drawer container then slide panel in
  try {
    if (drawer) drawer.classList.remove('hidden');
    if (panel) {
      panel.classList.remove('panel-hidden');
      panel.classList.add('panel-shown');
    }
  } catch (e) {}

  // If protection state is unknown, fetch it on-demand and re-render modal when ready
  try {
    if (g.protection === undefined && typeof window.detectProtection === 'function') {
      (async () => {
        try {
          const has = await window.detectProtection(g.appid, g.title || '');
          g.protection = !!has;
          // re-open to refresh UI (will render with updated protection)
          try { openDetail(g.appid); } catch (e) {}
        } catch (e) {}
      })();
    }
  } catch (e) {}
}

function closeDetail() {
  const drawer = document.getElementById("detail-drawer");
  const panel = document.getElementById("detail-drawer-panel");
  try {
    if (panel) {
      panel.classList.remove('panel-shown');
      panel.classList.add('panel-hidden');
    }
    // hide container after transition (300ms)
    setTimeout(() => {
      try { if (drawer) drawer.classList.add('hidden'); } catch (e) {}
    }, 320);
  } catch (e) {
    try { if (drawer) drawer.classList.add('hidden'); } catch (e) {}
  }
  // cleanup keyboard handler if attached
  try {
    if (window._gamehub_gallery_key_handler) {
      document.removeEventListener('keydown', window._gamehub_gallery_key_handler);
      window._gamehub_gallery_key_handler = null;
    }
  } catch (e) {}
}
