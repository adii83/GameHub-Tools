window.toggleFilterPanel = function() {
  const logToTerminal = (msg) => {
    console.log(msg);
    try { if (window.desktopBridge && typeof window.desktopBridge.send === 'function') window.desktopBridge.send('AppLog', { message: msg }); } catch(e) {}
  };

  logToTerminal('[JS-LOG] [ui] Tombol toggleFilterPanel DITEKAN!');
  
  const w = document.getElementById("filter-panel-wrapper");
  if (!w) {
    logToTerminal('[JS-LOG] [ui] ERROR KRITIS: Elemen #filter-panel-wrapper TIDAK DITEMUKAN di DOM layar Games!');
    return;
  }
  
  const shown = w.classList.contains("panel-shown");
  logToTerminal(`[JS-LOG] [ui] Wrapper filter-panel ditemukan. Status panel-shown: ${shown}. Mengeksekusi slide...`);
  
  w.classList.toggle("panel-shown", !shown);
  w.classList.toggle("panel-hidden", shown);
  
  logToTerminal(`[JS-LOG] [ui] Animasi telah dipantik! Daftar class elemen w saat ini: ${w.className}`);
};

// --- Online-Fix global helpers (hoisted to avoid listener conflicts) ---
function hideOverlayById(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// Debounce & state for Online Fix checks per AppID (global)
window._ofx_checking = window._ofx_checking || new Map();
window._ofx_lastAvailability = window._ofx_lastAvailability || new Map();
window._ofx_cancelledChecking = window._ofx_cancelledChecking || new Map();
window._ofx_applying = window._ofx_applying || new Map();

function ensureOnlineFixCheckingPopup(appid) {
  let el = document.getElementById('online-fix-checking');
  if (el) el.remove();
  el = document.createElement('div');
  el.id = 'online-fix-checking';
  el.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50';
  el.innerHTML = `
    <div class="bg-neutral-900 text-white rounded-lg p-5 w-[380px] shadow-xl">
      <h2 class="text-base font-semibold mb-2">Memeriksa Ketersediaan</h2>
      <p class="text-sm mb-3">Sedang memeriksa Online-Fix untuk AppID ${appid}...</p>
      <div class="w-full h-1 bg-white/10 rounded"><div class="h-1 rounded bg-sky-600 shimmer" style="width: 45%"></div></div>
      <div class="flex justify-end gap-2 mt-4">
        <button id="ofx-check-cancel" class="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 rounded">Kembali</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  const cancelBtn = el.querySelector('#ofx-check-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      try {
        const key = String(appid);
        window._ofx_checking?.delete(key);
        window._ofx_cancelledChecking?.set(key, true);
        const btn = document.getElementById(`btn-onlinefix-${appid}`);
        if (btn) { btn.disabled = false; btn.textContent = 'Online-Fix'; }
        if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
          window.desktopBridge.send('CancelOnlineFix', { appid: String(appid) });
        }
      } catch (_) {}
      el.remove();
    });
  }
  return el;
}

function ensureOnlineFixUnavailablePopup() {
  let el = document.getElementById('online-fix-unavailable');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'online-fix-unavailable';
  el.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/70';
  el.innerHTML = `
    <div class="bg-neutral-900 text-white rounded-lg p-6 w-[420px] shadow-xl">
      <h2 class="text-lg font-semibold mb-3">Online-Fix</h2>
      <p class="text-sm mb-5">Online-Fix Pada Game ini Belum Tersedia</p>
      <div class="flex justify-end gap-2">
        <button id="ofx-close" class="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 rounded">Kembali</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('#ofx-close')?.addEventListener('click', () => el.remove());
  return el;
}

function ensureOnlineFixAvailablePopup(appid, url) {
  let el = document.getElementById('online-fix-available');
  if (el) el.remove();
  el = document.createElement('div');
  el.id = 'online-fix-available';
  el.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/70';
  el.innerHTML = `
    <div class="bg-neutral-900 text-white rounded-lg p-6 w-[480px] shadow-xl">
      <h2 class="text-lg font-semibold mb-3">Online-Fix Tersedia</h2>
      <p class="text-sm mb-2">Online-Fix untuk AppID ${appid} tersedia. Ingin menerapkan sekarang?</p>
      <div id="ofx-status" class="text-xs text-gray-400 mb-4"></div>
      <div class="flex justify-end gap-2">
        <button id="ofx-back" class="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 rounded">Kembali</button>
        <button id="ofx-apply" class="px-3 py-2 bg-sky-600 hover:bg-sky-500 rounded">Terapkan Online-Fix</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('#ofx-back')?.addEventListener('click', () => el.remove());
  el.querySelector('#ofx-apply')?.addEventListener('click', () => {
    const statusEl = el.querySelector('#ofx-status');
    const backBtn = el.querySelector('#ofx-back');
    const applyBtn = el.querySelector('#ofx-apply');
    if (statusEl) statusEl.textContent = 'Memulai...';
    if (backBtn) backBtn.disabled = true;
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Memulai...'; }
    setTimeout(() => {
      el.remove();
      ofxShowProgressOverlay('Mengecek dan Menerapkan Online-Fix...');
      window.ui.applyOnlineFix(appid, url);
    }, 250);
  });
  return el;
}

function showOnlineFixUnavailable() {
  hideOverlayById('online-fix-available');
  const el = ensureOnlineFixUnavailablePopup();
  el.style.display = 'flex';
}

function ensureGameNotInstalledPopup() {
  let el = document.getElementById('game-not-installed');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'game-not-installed';
  el.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/70';
  el.innerHTML = `
    <div class="bg-neutral-900 text-white rounded-lg p-6 w-[420px] shadow-xl">
      <h2 class="text-lg font-semibold mb-3">Game Tidak Terpasang</h2>
      <p class="text-sm mb-5">Game Belum Anda Download atau Pasang.</p>
      <div class="flex justify-end gap-2">
        <button id="gni-close" class="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 rounded">Kembali</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('#gni-close')?.addEventListener('click', () => el.remove());
  return el;
}

function showGameNotInstalled() {
  hideOverlayById('online-fix-available');
  const el = ensureGameNotInstalledPopup();
  el.style.display = 'flex';
}

// Reuse global overlay, customize cancel button to act as 'Kembali'
function ofxShowProgressOverlay(text) {
  try { window.showProgressOverlay?.(text); } catch (e) {}
  try {
    const btn = document.getElementById('gh-progress-cancel');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Kembali';
      btn.onclick = () => {
        try { window.hideProgressOverlay?.(); } catch (e) {}
        const drawer = document.getElementById('detail-drawer');
        const panel = document.getElementById('detail-drawer-panel');
        if (drawer && panel) {
          drawer.classList.remove('hidden');
          panel.style.opacity = '1';
          panel.style.transform = 'translate(-50%, -50%) scale(1)';
        }
      };
    }
  } catch (e) {}
}
function ofxUpdateProgressOverlay(text) {
  try {
    if (typeof text === 'string') window.updateProgressOverlay?.({ status: text });
    else window.updateProgressOverlay?.(text);
  } catch (e) {}
}
function ofxHideProgressOverlay() {
  try { window.hideProgressOverlay?.(); } catch (e) {}
}

// --- UnOnline-Fix custom overlay & success popup ---
function ensureUnfixOverlay() {
  if (document.getElementById('gh-unfix-overlay')) return;
  const el = document.createElement('div');
  el.id = 'gh-unfix-overlay';
  el.className = 'fixed inset-0 z-[61] hidden';
  el.innerHTML = `
    <div class="absolute inset-0 bg-black/60"></div>
    <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[26rem] max-w-[95vw] bg-[#151515] border border-white/10 rounded-xl shadow-2xl p-6">
      <h3 class="text-lg font-semibold mb-3">UnOnline-Fix</h3>
      <div id="gh-unfix-status" class="text-sm text-gray-300 mb-3">Menyiapkan...</div>
      <div class="w-full h-2 bg-white/10 rounded mb-2">
        <div id="gh-unfix-bar" class="h-2 rounded bg-rose-500" style="width:0%"></div>
      </div>
      <div class="flex justify-end">
        <button id="gh-unfix-cancel" class="px-3 py-1.5 text-sm rounded bg-slate-700 text-white hover:opacity-90">Tutup</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  const btn = el.querySelector('#gh-unfix-cancel');
  if (btn) btn.addEventListener('click', () => ofxHideUnfixOverlay());
}
function ofxShowUnfixOverlay(initialText) {
  ensureUnfixOverlay();
  const wrap = document.getElementById('gh-unfix-overlay');
  const status = document.getElementById('gh-unfix-status');
  const bar = document.getElementById('gh-unfix-bar');
  if (status) status.textContent = initialText || 'Menyiapkan...';
  if (bar) bar.style.width = '0%';
  if (wrap) wrap.classList.remove('hidden');
}
function ofxUpdateUnfixOverlay(text) {
  const status = document.getElementById('gh-unfix-status');
  if (status && text) status.textContent = text;
  // Try parse percent from text for simple bar update
  const bar = document.getElementById('gh-unfix-bar');
  if (bar) {
    const m = /([0-9]{1,3})%/.exec(text || '');
    if (m) {
      const pct = Math.min(100, parseInt(m[1], 10));
      bar.style.width = pct + '%';
    }
  }
}
function ofxHideUnfixOverlay() {
  const wrap = document.getElementById('gh-unfix-overlay');
  if (wrap) wrap.classList.add('hidden');
}
function showUnfixSuccessPopup(appid, filesRemoved) {
  let el = document.getElementById('unfix-success-popup');
  if (el) el.remove();
  el = document.createElement('div');
  el.id = 'unfix-success-popup';
  el.className = 'fixed inset-0 z-[62] flex items-center justify-center bg-black/70';
  el.innerHTML = `
    <div class="bg-neutral-900 text-white rounded-lg p-6 w-[430px] shadow-xl">
      <h2 class="text-lg font-semibold mb-2">UnOnline-Fix Selesai</h2>
      <p class="text-sm mb-4">Online-Fix untuk AppID ${appid} berhasil dihapus.${filesRemoved?`<br><span class='text-xs text-gray-400'>File dihapus: ${filesRemoved}</span>`:''}</p>
      <div class="flex justify-end gap-2">
        <button id="unfix-ok" class="px-3 py-2 bg-sky-600 hover:bg-sky-500 rounded text-sm">Kembali</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('#unfix-ok')?.addEventListener('click', () => el.remove());
}


async function openDetail(appid) {
  // Helper untuk menentukan apakah game premium atau standard
  function isGamePremium(gameData) {
    if (!gameData) return false;
    const PREMIUM_MIN = 350000; // Threshold untuk premium game
    const price = gameData.price_normalized || gameData.price_initial || 0;
    return price >= PREMIUM_MIN;
  }

  // Helper logging sumber data ke AppLog (desktop)
  function logDetailSource(source) {
    try {
      if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
        window.desktopBridge.send('AppLog', { message: `[Detail] source=${source} appid=${String(appid)}` });
      }
    } catch (e) {}
  }

  // Helper: Merge dengan override terbaru (untuk memastikan override selalu diterapkan)
  async function mergeWithLatestOverride(gameData) {
    if (!gameData) return gameData;
    
    try {
      // Load override terbaru
      const overrideMap = await loadLocalSteamData();
      if (overrideMap && overrideMap.has(Number(appid))) {
        const overrideData = overrideMap.get(Number(appid));
        
        // Debug: Log override data untuk troubleshooting
        if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
          try {
            const overrideKeys = Object.keys(overrideData || {});
            const gameDataKeys = Object.keys(gameData || {});
            window.desktopBridge.send('AppLog', { 
              message: `[Detail] Merge override for appid ${appid} - override keys: [${overrideKeys.join(', ')}], gameData keys: [${gameDataKeys.slice(0, 5).join(', ')}...]` 
            });
          } catch (e) {}
        }
        
        // Apply override menggunakan fungsi yang sama dengan mergeWithLocalDataset
        if (typeof applyLocalOverridesToItem === 'function') {
          const merged = applyLocalOverridesToItem(gameData, overrideData);
          
          // Debug: Verifikasi merge result
          if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
            try {
              const hasTitle = !!merged.title;
              const hasHeader = !!merged.header;
              const hasDescription = !!merged.short_description;
              const mergedKeys = Object.keys(merged || {});
              if (!hasTitle || !hasHeader || !hasDescription) {
                window.desktopBridge.send('AppLog', { 
                  message: `[Detail] ERROR: Fields missing after applyLocalOverridesToItem - title:${hasTitle}, header:${hasHeader}, desc:${hasDescription}, merged keys: [${mergedKeys.slice(0, 10).join(', ')}...]` 
                });
              } else {
                window.desktopBridge.send('AppLog', { 
                  message: `[Detail] Merge successful - all fields present, merged keys: [${mergedKeys.slice(0, 10).join(', ')}...]` 
                });
              }
            } catch (e) {}
          }
          
          return merged;
        } else {
          // Fallback: manual merge
          // PERBAIKAN: Hanya override field yang benar-benar ada di override (tidak undefined)
          const merged = Object.assign({}, gameData);
          const keys = ['title','header','genre','genre_display','short_description',
            'developers','publishers','release_date','price_display','price_normalized','price_initial','protection','last_update'];
          for (const k of keys) {
            // PERBAIKAN: Cek apakah field ada DAN nilainya tidak undefined
            if (Object.prototype.hasOwnProperty.call(overrideData, k) && overrideData[k] !== undefined) {
              const overrideValue = overrideData[k];
              // Untuk protection, null adalah nilai valid
              if (k === 'protection') {
                merged[k] = overrideValue;
              } else {
                // Untuk field lain, langsung assign (sudah cek undefined di atas)
                merged[k] = overrideValue;
              }
            }
            // Jika field tidak ada di override ATAU nilainya undefined, skip (keep dari gameData)
          }
          return merged;
        }
      }
    } catch (e) {
      // Jika error, return data asli
      if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
        try {
          window.desktopBridge.send('AppLog', { 
            message: `[Detail] Error in mergeWithLatestOverride: ${e.message || 'Unknown'}` 
          });
        } catch (e2) {}
      }
    }
    return gameData;
  }

  // Cari di originalData (dataset utama)
  let g = (window.originalData||[]).find((x) => x.appid === appid);
  if (g) {
    logDetailSource('originalData');
    // IMPORTANT: Merge dengan override terbaru sebelum digunakan
    // PERBAIKAN: Clone dulu untuk memastikan tidak mengubah originalData
    const gameClone = Object.assign({}, g);
    g = await mergeWithLatestOverride(gameClone);
    
    // Debug: Log jika ada field yang hilang setelah merge
    if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
      try {
        const hasTitle = !!g.title;
        const hasHeader = !!g.header;
        const hasDescription = !!g.short_description;
        if (!hasTitle || !hasHeader || !hasDescription) {
          window.desktopBridge.send('AppLog', { 
            message: `[Detail] Warning: Missing fields after merge - title:${hasTitle}, header:${hasHeader}, desc:${hasDescription}, appid:${appid}` 
          });
        }
      } catch (e) {}
    }
  }
  // Jika tidak ada, coba fetch dari local_data_steam.json (built-in)
  if (!g) {
    try {
      const local = await fetch('/data/local_data_steam.json', {cache:'no-store'}).then(r=>r.json()).catch(()=>null);
      if (local && local[appid]) {
        g = Object.assign({appid: Number(appid)}, local[appid]);
        logDetailSource('local_data_steam');
        // Merge dengan override terbaru
        g = await mergeWithLatestOverride(g);
      }
    } catch(e) { g = null; }
  }
  
  // Jika tetap tidak ada, cek override data via bridge (untuk game baru dari override)
  // PERBAIKAN: Jika game hanya ada di override dengan partial data, coba fetch dari raw data dulu
  if (!g) {
    try {
      // Cek user override dulu (prioritas tertinggi)
      if (window.desktopBridge && typeof window.desktopBridge.getUserOverride === 'function') {
        const userOverride = await window.desktopBridge.getUserOverride().catch(() => null);
        if (userOverride && userOverride[appid]) {
          // Jika override hanya punya partial data, coba fetch dari raw data dulu
          let baseData = null;
          try {
            if (typeof getFullMetadataForAppid === 'function') {
              baseData = await getFullMetadataForAppid(appid).catch(() => null);
            }
          } catch (e) {}
          
          // Merge: raw data sebagai base, override sebagai update
          // PERBAIKAN: Gunakan applyLocalOverridesToItem untuk merge yang benar (hanya override field yang ada)
          if (baseData) {
            if (typeof applyLocalOverridesToItem === 'function') {
              g = applyLocalOverridesToItem(baseData, userOverride[appid]);
            } else {
              // Fallback: Object.assign (tapi ini bisa menghapus field yang tidak ada di override)
              g = Object.assign({ appid: Number(appid) }, baseData, userOverride[appid]);
            }
            logDetailSource('user_override + raw_data');
          } else {
            // Jika tidak ada raw data, coba fetch dari raw data via bridge
            try {
              if (typeof getFullMetadataForAppid === 'function') {
                const fallbackBaseData = await getFullMetadataForAppid(appid).catch(() => null);
                if (fallbackBaseData) {
                  if (typeof applyLocalOverridesToItem === 'function') {
                    g = applyLocalOverridesToItem(fallbackBaseData, userOverride[appid]);
                  } else {
                    g = Object.assign({ appid: Number(appid) }, fallbackBaseData, userOverride[appid]);
                  }
                  logDetailSource('user_override + raw_data (fallback)');
                } else {
                  // Jika tidak ada raw data sama sekali, gunakan override saja (partial data)
                  g = Object.assign({ appid: Number(appid) }, userOverride[appid]);
                  logDetailSource('user_override (partial only)');
                }
              } else {
                // Jika tidak ada raw data sama sekali, gunakan override saja (partial data)
                g = Object.assign({ appid: Number(appid) }, userOverride[appid]);
                logDetailSource('user_override (partial only)');
              }
            } catch (e) {
              // Jika error, gunakan override saja (partial data)
              g = Object.assign({ appid: Number(appid) }, userOverride[appid]);
              logDetailSource('user_override (partial only, error)');
            }
          }
        }
      }
    } catch (e) {}
  }
  
  // Jika masih tidak ada, cek global override
  if (!g) {
    try {
      if (window.desktopBridge && typeof window.desktopBridge.getGlobalOverride === 'function') {
        const globalOverride = await window.desktopBridge.getGlobalOverride(false).catch(() => null);
        if (globalOverride && globalOverride[appid]) {
          // Jika override hanya punya partial data, coba fetch dari raw data dulu
          let baseData = null;
          try {
            if (typeof getFullMetadataForAppid === 'function') {
              baseData = await getFullMetadataForAppid(appid).catch(() => null);
            }
          } catch (e) {}
          
          // Merge: raw data sebagai base, override sebagai update
          // PERBAIKAN: Gunakan applyLocalOverridesToItem untuk merge yang benar (hanya override field yang ada)
          if (baseData) {
            if (typeof applyLocalOverridesToItem === 'function') {
              g = applyLocalOverridesToItem(baseData, globalOverride[appid]);
            } else {
              // Fallback: Object.assign (tapi ini bisa menghapus field yang tidak ada di override)
              g = Object.assign({ appid: Number(appid) }, baseData, globalOverride[appid]);
            }
            logDetailSource('global_override + raw_data');
          } else {
            // Jika tidak ada raw data, coba fetch dari raw data via bridge
            try {
              if (typeof getFullMetadataForAppid === 'function') {
                const fallbackBaseData = await getFullMetadataForAppid(appid).catch(() => null);
                if (fallbackBaseData) {
                  if (typeof applyLocalOverridesToItem === 'function') {
                    g = applyLocalOverridesToItem(fallbackBaseData, globalOverride[appid]);
                  } else {
                    g = Object.assign({ appid: Number(appid) }, fallbackBaseData, globalOverride[appid]);
                  }
                  logDetailSource('global_override + raw_data (fallback)');
                } else {
                  // Jika tidak ada raw data sama sekali, gunakan override saja (partial data)
                  g = Object.assign({ appid: Number(appid) }, globalOverride[appid]);
                  logDetailSource('global_override (partial only)');
                }
              } else {
                // Jika tidak ada raw data sama sekali, gunakan override saja (partial data)
                g = Object.assign({ appid: Number(appid) }, globalOverride[appid]);
                logDetailSource('global_override (partial only)');
              }
            } catch (e) {
              // Jika error, gunakan override saja (partial data)
              g = Object.assign({ appid: Number(appid) }, globalOverride[appid]);
              logDetailSource('global_override (partial only, error)');
            }
          }
        }
      }
    } catch (e) {}
  }
  
  // Jika tetap tidak ada, coba full raw via bridge (raw data)
  if (!g) {
    // Last-resort: try fetching the full GitHub raw metadata for this AppID
    try {
      if (typeof getFullMetadataForAppid === 'function') {
        const full = await getFullMetadataForAppid(appid).catch(() => null);
        if (full) {
          // normalize some common fields and apply local overrides
          g = Object.assign({ appid: Number(appid) }, full);
          logDetailSource('full_raw_via_bridge');
          try {
            const local = await fetch('/data/local_data_steam.json', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
            if (local && local[appid]) {
              g = Object.assign({appid: Number(appid)}, local[appid], g);
            }
          } catch (e) {}
          // Merge dengan override terbaru
          g = await mergeWithLatestOverride(g);
        }
      }
    } catch (e) {}
    if (!g) {
      premiumAlert('Data game tidak ditemukan.', 'Game Tidak Ditemukan');
      return;
    }
  }

  // Check license setelah mendapatkan game data
  try {
    if (window.desktopBridge && typeof window.desktopBridge.getLicenseInfo === 'function') {
      const licenseInfo = await window.desktopBridge.getLicenseInfo();
      
      // Jika license tidak valid atau tidak aktif, block semua
      if (!licenseInfo.isValid || !licenseInfo.isActive) {
        premiumAlert(
          'License tidak valid. Silakan aktivasi license terlebih dahulu.',
          'License Tidak Valid'
        );
        return;
      }
      
      // Jika plan adalah "standard", cek apakah game premium
      if (licenseInfo.plan === 'standard') {
        const PREMIUM_MIN = 350000; // Threshold untuk premium game
        const price = g.price_normalized || g.price_initial || 0;
        const gameIsPremium = price >= PREMIUM_MIN;
        
        // Jika game premium, block untuk plan standard
        if (gameIsPremium) {
          premiumAlert(
            'Upgrade Ke Premium Dulu, Ya, Untuk Buka Fitur Ini 😁',
            'Fitur Premium'
          );
          return; // Jangan buka modal detail
        }
        // Jika game standard, lanjutkan (allow)
      }
      
      // Plan premium: allow semua game (tidak perlu cek)
    }
  } catch (e) {
    // License check error - non-critical
  }

  const drawer = document.getElementById('detail-drawer');
  const panel = document.getElementById('detail-drawer-panel');
  let card = document.getElementById('detail-card');
  // Ensure the panel/container exists; if not, try to create minimal structure to host detail
  if (!panel) {
    if (!drawer) {
      alert('Detail panel tidak tersedia saat ini. Silakan buka Games terlebih dahulu.');
      return;
    }
    // try to create a panel inside drawer
    try {
      const p = document.createElement('div');
      p.id = 'detail-drawer-panel';
      drawer.appendChild(p);
      card = null;
    } catch (e) { alert('Tidak dapat menampilkan detail.'); return; }
  }
  if (!card && panel) {
    // create a placeholder card container so subsequent code can safely write into it
      try { card = document.createElement('div'); card.id = 'detail-card'; panel.appendChild(card); } catch (e) {}
  }


    // Trigger check/apply from UI (minimal wiring)
    window.ui = window.ui || {};
    window.ui.checkOnlineFix = (appid) => {
      const btn = document.getElementById(`btn-onlinefix-${appid}`);
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Memeriksa...';
      }
      // Debounce: skip if already checking for this appid
      const key = String(appid);
      // Reset previous state for fresh session
      try {
        window._ofx_lastAvailability?.delete(key);
        window._ofx_cancelledChecking?.delete(key);
      } catch (_) {}
      if (window._ofx_checking.get(key) === true) {
        ensureOnlineFixCheckingPopup(appid);
        return;
      }
      window._ofx_checking.set(key, true);
      ensureOnlineFixCheckingPopup(appid);
      if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
        window.desktopBridge.send('CheckOnlineFix', { appid: String(appid) });
      } else {
      }
    };
    window.ui.applyOnlineFix = (appid, url) => {
      // Mark applying to allow handling results
      try { window._ofx_applying?.set(String(appid), true); } catch (_) {}
      if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
        window.desktopBridge.send('ApplyOnlineFix', { appid: String(appid), url });
      } else {
      }
    };
    window.ui.cancelOnlineFix = (appid) => {
      
      if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
        window.desktopBridge.send('CancelOnlineFix', { appid: String(appid) });
      } else {
      }
    };
    window.ui.unOnlineFix = (appid) => {
      // Mulai proses UnOnline-Fix dengan overlay progress
      ofxShowUnfixOverlay(`Menghapus Online-Fix untuk AppID ${appid}...`);
      if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
        window.desktopBridge.send('UnOnlineFix', { appid: String(appid) });
      } else {
      }
    };

    // Ensure AddGame overlay closes on cancel/failure
    if (window.desktopBridge && typeof window.desktopBridge.onMessage === 'function') {
      window.desktopBridge.onMessage((msg) => {
        try {
          const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
          if (data?.type === 'AddGameResult') {
            if (data.success === false || data.cancelled === true || data.error) {
              hideProgressOverlay();
            }
          } else if (data?.type === 'AddGameProgress') {
            const st = String(data.status || '').toLowerCase();
            if (st === 'cancelled' || st === 'failed' || st === 'done') {
              hideProgressOverlay();
            }
          }
        } catch (_) {}
      });
    }

    // Helper to toggle button text/handler
    window.ui.updateOnlineFixButton = (appid, { applied }) => {
      let btn = document.getElementById(`btn-onlinefix-${appid}`);
      if (!btn) return;
      // Replace with clone to strip any prior addEventListener handlers (availability check)
      const clone = btn.cloneNode(true);
      btn.parentNode?.replaceChild(clone, btn);
      btn = clone;
      if (applied) {
        btn.textContent = 'UnOnline-Fix';
        btn.disabled = false;
        btn.onclick = (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          window.ui.unOnlineFix(appid);
        };
      } else {
        btn.textContent = 'Online-Fix';
        btn.disabled = false;
        btn.onclick = (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          window.ui.checkOnlineFix(appid);
        };
      }
    };

    // Reuse global overlay, customize cancel button to act as 'Kembali'
    function ofxShowProgressOverlay(text) {
      try { window.showProgressOverlay?.(text); } catch (e) {}
      try {
        const btn = document.getElementById('gh-progress-cancel');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Kembali';
          btn.onclick = () => {
            try { window.hideProgressOverlay?.(); } catch (e) {}
            const drawer = document.getElementById('detail-drawer');
            const panel = document.getElementById('detail-drawer-panel');
            if (drawer && panel) {
              drawer.classList.remove('hidden');
              panel.style.opacity = '1';
              panel.style.transform = 'translate(-50%, -50%) scale(1)';
            }
          };
        }
      } catch (e) {}
    }
    function ofxUpdateProgressOverlay(text) {
      try {
        if (typeof text === 'string') window.updateProgressOverlay?.({ status: text });
        else window.updateProgressOverlay?.(text);
      } catch (e) {}
    }
    function ofxHideProgressOverlay() {
      try { window.hideProgressOverlay?.(); } catch (e) {}
    }

    // Initialize button binding in the detail drawer
    const btnOnlineFix = document.getElementById(`btn-onlinefix-${g.appid}`);
    if (btnOnlineFix) {
      btnOnlineFix.onclick = () => window.ui.checkOnlineFix(g.appid);
    }

    // Trigger an initial availability check when detail opens
    // Hapus auto-check pada saat detail dibuka; cek hanya saat tombol ditekan
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

  // Wire desktop actions
  try {
    const addBtn = document.getElementById(`btn-add-${g.appid}`);
    if (addBtn) addBtn.addEventListener('click', () => onAddGame(g.appid, g.title));

    const fixBtn = document.getElementById(`btn-onlinefix-${g.appid}`);
    if (fixBtn) fixBtn.addEventListener('click', () => window.ui?.checkOnlineFix?.(g.appid));

    const rsBtn = document.getElementById('btn-restart-steam');
    if (rsBtn) rsBtn.addEventListener('click', () => onRestartSteam());

    // Query installed state and toggle Add/Remove button
    window.desktopBridge?.send('CheckGameInstalled', { appid: String(g.appid) });
    // Query Online-Fix applied state to set initial button text
    window.desktopBridge?.send('CheckOnlineFixApplied', { appid: String(g.appid) });
  } catch (e) {}
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

// --- Desktop bridge bindings + progress UI ---
function ensureProgressOverlay() {
  if (document.getElementById('gh-progress-overlay')) return;
  const el = document.createElement('div');
  el.id = 'gh-progress-overlay';
  el.className = 'fixed inset-0 z-[60] hidden';
  el.innerHTML = `
    <div class="absolute inset-0 bg-black/60"></div>
    <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] max-w-[95vw] bg-[#151515] border border-white/10 rounded-xl shadow-2xl p-6">
      <h3 class="text-lg font-semibold mb-3">Mengunduh & Memasang</h3>
      <div id="gh-progress-status" class="text-sm text-gray-300 mb-3">Menyiapkan...</div>
      <div class="w-full h-2 bg-white/10 rounded">
        <div id="gh-progress-bar" class="h-2 rounded bg-emerald-500" style="width:0%"></div>
      </div>
      <div class="flex justify-between text-xs text-gray-400 mt-2">
        <span id="gh-progress-phase">download</span>
        <span id="gh-progress-percent">0%</span>
      </div>
      <div class="mt-4 flex justify-end">
        <button id="gh-progress-cancel" class="px-3 py-1.5 text-sm rounded bg-slate-700 text-white hover:opacity-90">Batalkan</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
}

// --- Unavailable popup ---
function ensureUnavailableOverlay() {
  if (document.getElementById('gh-unavail-overlay')) return;
  const el = document.createElement('div');
  el.id = 'gh-unavail-overlay';
  el.className = 'fixed inset-0 z-[60] hidden';
  el.innerHTML = `
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>
    <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[30rem] max-w-[95vw] bg-[#151515] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
      <div id="gh-unavail-banner" class="w-full h-1.5 bg-gradient-to-r from-red-700 via-red-500 to-red-700"></div>
      <div class="p-6">
        <div class="flex items-start gap-4 mb-4">
          <div class="shrink-0 w-10 h-10 rounded-full bg-red-600/20 border border-red-500/30 flex items-center justify-center">
            <svg class="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
          </div>
          <div>
            <h3 class="text-base font-bold text-white mb-1">Game Belum Dapat Dimainkan</h3>
            <span id="gh-unavail-badge" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold bg-red-600/80 text-white border border-red-500/30">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg>
              DENUVO
            </span>
          </div>
        </div>
        <p id="gh-unavail-desc" class="text-sm text-gray-300 mb-5 leading-relaxed">Game ini menggunakan proteksi Denuvo dan saat ini belum tersedia di daftar Fix Games maupun Steam Account kami.</p>
        <div class="text-xs text-gray-500 bg-white/5 rounded-lg px-4 py-3 mb-5 border border-white/5">
          💡 Game dengan proteksi Denuvo memerlukan patch khusus. Pantau terus halaman <strong class="text-gray-300">Fix Games</strong> untuk melihat update ketersediaannya.
        </div>
        <div class="flex justify-end">
          <button id="gh-unavail-back" class="px-4 py-2 text-sm rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors font-medium">Mengerti</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  const back = el.querySelector('#gh-unavail-back');
  if (back) back.addEventListener('click', () => hideUnavailableOverlay());
  // Close on backdrop click
  el.querySelector('.absolute.inset-0')?.addEventListener('click', () => hideUnavailableOverlay());
}
function showUnavailableOverlay(message) {
  ensureUnavailableOverlay();
  const wrap = document.getElementById('gh-unavail-overlay');
  const desc = document.getElementById('gh-unavail-desc');
  if (desc && message) desc.textContent = message;
  if (wrap) wrap.classList.remove('hidden');
}
function hideUnavailableOverlay() {
  const wrap = document.getElementById('gh-unavail-overlay');
  if (wrap) wrap.classList.add('hidden');
}

// --- Remove-Game popups ---
function ensureRemoveBlockedPopup() {
  let el = document.getElementById('gh-remove-blocked');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'gh-remove-blocked';
  el.className = 'fixed inset-0 z-[60] hidden';
  el.innerHTML = `
    <div class="absolute inset-0 bg-black/60"></div>
    <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] max-w-[95vw] bg-[#151515] border border-white/10 rounded-xl shadow-2xl p-6">
      <h3 class="text-lg font-semibold mb-3">Remove-Game Diblokir</h3>
      <div class="text-sm text-gray-300 mb-4">Uninstall Game di Steam terlebih dahulu sebelum Remove-Game.</div>
      <div class="flex justify-end gap-2">
        <button id="gh-remove-blocked-back" class="px-3 py-1.5 text-sm rounded bg-slate-700 text-white hover:opacity-90">Kembali</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  el.querySelector('#gh-remove-blocked-back')?.addEventListener('click', () => {
    el.classList.add('hidden');
  });
  return el;
}
function showRemoveBlockedPopup() {
  const el = ensureRemoveBlockedPopup();
  el.classList.remove('hidden');
}

function ensureRemoveSuccessPopup(removed) {
  let el = document.getElementById('gh-remove-success');
  if (el) el.remove();
  el = document.createElement('div');
  el.id = 'gh-remove-success';
  el.className = 'fixed inset-0 z-[60] flex items-center justify-center bg-black/70';
  el.innerHTML = `
    <div class="bg-neutral-900 text-white rounded-lg p-6 w-[430px] shadow-xl">
      <h2 class="text-lg font-semibold mb-2">Game Berhasil Dihapus</h2>
      <p class="text-sm mb-4">${removed ? `Menghapus ${removed} file skrip.` : 'File skrip tidak ditemukan, tidak ada yang dihapus.'}</p>
      <div class="flex justify-end gap-2">
        <button id="gh-remove-success-ok" class="px-3 py-2 bg-sky-600 hover:bg-sky-500 rounded text-sm">Kembali</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('#gh-remove-success-ok')?.addEventListener('click', () => el.remove());
  return el;
}
function showRemoveSuccessPopup(removed) {
  ensureRemoveSuccessPopup(removed);
}

function showProgressOverlay(initialText) {
  ensureProgressOverlay();
  const wrap = document.getElementById('gh-progress-overlay');
  const status = document.getElementById('gh-progress-status');
  const bar = document.getElementById('gh-progress-bar');
  const pct = document.getElementById('gh-progress-percent');
  const phase = document.getElementById('gh-progress-phase');
  if (status) status.textContent = initialText || 'Memulai...';
  if (bar) bar.style.width = '0%';
  if (pct) pct.textContent = '0%';
  if (phase) phase.textContent = 'download';
  if (wrap) wrap.classList.remove('hidden');
  const btn = document.getElementById('gh-progress-cancel');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Batalkan';
    btn.onclick = () => {
      try {
        btn.disabled = true;
        updateProgressOverlay({ phase: 'Membatalkan', percent: 0, status: 'Membatalkan...' });
        if (window._gh_current_appid) {
          window.desktopBridge?.send('AddGameCancel', { appid: String(window._gh_current_appid) });
        }
      } catch (e) {}
    };
  }
}

function updateProgressOverlay({ phase, percent, status }) {
  const bar = document.getElementById('gh-progress-bar');
  const pct = document.getElementById('gh-progress-percent');
  const ph = document.getElementById('gh-progress-phase');
  const st = document.getElementById('gh-progress-status');
  if (typeof percent === 'number' && percent >= 0) {
    const clamped = Math.max(0, Math.min(100, percent));
    if (bar) bar.style.width = clamped + '%';
    if (pct) pct.textContent = clamped + '%';
  } else {
    if (st && status) st.textContent = status;
  }
  if (ph && phase) ph.textContent = phase;
  if (st && status) st.textContent = status;
}

function hideProgressOverlay() {
  const wrap = document.getElementById('gh-progress-overlay');
  if (wrap) wrap.classList.add('hidden');
}

function onAddGame(appid, name) {
  // Verifikasi perlindungan Denuvo - cek ketersediaan di Fix Games & Steam Account
  // Gunakan processedOriginalData (setelah normalisasi + override) sebagai sumber utama
  // karena window.originalData adalah data RAW dari API sebelum override diterapkan
  const dataSource = window.processedOriginalData || window.originalData || [];
  const game = dataSource.find(g => String(g.appid) === String(appid));
  if (game && game.protection === true) {
    // window._fixGamesData adalah object { games: [...] } dari fix_games.json (di-cache saat initApp)
    const fixGames = Array.isArray(window._fixGamesData?.games) ? window._fixGamesData.games
                   : Array.isArray(window._fixGamesData) ? window._fixGamesData
                   : [];
    const isFixAvailable = fixGames.some(g => String(g.appid) === String(appid));

    // window.steamGamesData adalah array dari steam_games.json (di-cache saat initApp)
    const steamGames = Array.isArray(window.steamGamesData) ? window.steamGamesData : [];
    const isSteamAvailable = steamGames.some(g => String(g.appid) === String(appid));

    console.log(`[onAddGame] Denuvo check appid=${appid}: fixAvail=${isFixAvailable} steamAvail=${isSteamAvailable} (fixGames=${fixGames.length} steamGames=${steamGames.length} processedData=${window.processedOriginalData?.length || 0})`);
    
    if (!isFixAvailable && !isSteamAvailable) {
      showUnavailableOverlay('Game ini menggunakan proteksi Denuvo dan saat ini belum tersedia di daftar Fix Games maupun Steam Account kami.');
      return;
    }
  }

  showProgressOverlay(`Mengunduh untuk AppID ${appid}...`);
  window._gh_current_appid = String(appid);
  window.desktopBridge?.send('AddGame', { appid: String(appid), name: String(name || '') });
}

function onRemoveGame(appid) {
  showProgressOverlay(`Menghapus untuk AppID ${appid}...`);
  window._gh_current_appid = String(appid);
  window.desktopBridge?.send('RemoveGame', { appid: String(appid) });
}

function onApplyOnlineFix(appid) {
  window.desktopBridge?.send('ApplyOnlineFix', { appid: String(appid) });
}

function onRestartSteam() {
  try {
    const btn = document.getElementById('btn-restart-steam');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '🔄 Merestart Steam...';
    }
  } catch (e) {}
  if (window.desktopBridge && typeof window.desktopBridge.send === 'function') {
    window.desktopBridge.send('RestartSteam', {});
  } else {
    if (typeof showTransientMessage === 'function') {
      showTransientMessage('Bridge tidak tersedia', 3000, 'error');
    }
    const btn = document.getElementById('btn-restart-steam');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🔄 Restart Steam';
    }
  }
}

// Premium animation for removing game card
// Hide card instead of removing immediately (will be cleaned up when returning to library page)
function animateRemoveGameCard(appid, skipPopup = false) {
  try {
    const cardWrapper = document.getElementById(`game-card-wrapper-${appid}`);
    const card = document.getElementById(`game-${appid}`);
    if (!card && !cardWrapper) return;
    
    const target = cardWrapper || card;
    
    // Mark as hidden
    if (window.hiddenCards) {
      window.hiddenCards.add(String(appid));
    }
    
    // Add premium animation
    target.style.transition = 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
    target.style.opacity = '0';
    target.style.transform = 'translateX(-100%) scale(0.8)';
    target.style.filter = 'blur(8px)';
    target.style.pointerEvents = 'none';
    
    // Hide after animation (don't remove from DOM yet)
    setTimeout(() => {
      if (target) {
        target.style.display = 'none';
      }
    }, 500);
    
    // Don't update data or re-render immediately - wait until library page reload
    // This prevents the card from reappearing
  } catch (e) {
    // Fallback: just hide the card
    const cardWrapper = document.getElementById(`game-card-wrapper-${appid}`);
    const card = document.getElementById(`game-${appid}`);
    const target = cardWrapper || card;
    if (target) {
      target.style.display = 'none';
      if (window.hiddenCards) {
        window.hiddenCards.add(String(appid));
      }
    }
  }
}

// Handle trash button click (direct remove without modal)
async function handleTrashClick(appid, gameTitle) {
  try {
    if (!window.desktopBridge || typeof window.desktopBridge.send !== 'function') {
      if (typeof showPremiumToast === 'function') {
        showPremiumToast('Bridge tidak tersedia', 3000, 'error');
      }
      return;
    }
    
    // Confirm with premium modal (non-blocking)
    if (typeof premiumConfirm === 'function') {
      const confirmed = await premiumConfirm(
        `Hapus "${gameTitle}" dari Library?`,
        'Hapus Game'
      );
      if (!confirmed) return;
    }
    
    // Set flag to skip popup
    window._skipRemovePopup = true;
    window._gh_current_appid = String(appid);
    
    // Show progress overlay
    showProgressOverlay(`Menghapus untuk AppID ${appid}...`);
    
    // DON'T hide card yet - wait for success result
    // Card will be hidden in RemoveGameResult handler only if success = true
    
    // Send remove request
    window.desktopBridge.send('RemoveGame', { appid: String(appid) });
  } catch (e) {
    // Restore card on error
    const cardWrapper = document.getElementById(`game-card-wrapper-${appid}`);
    const card = document.getElementById(`game-${appid}`);
    const target = cardWrapper || card;
    if (target) {
      target.style.display = '';
      target.style.opacity = '1';
      target.style.transform = '';
      target.style.filter = '';
      target.style.pointerEvents = '';
      target.style.transition = '';
      if (window.hiddenCards) {
        window.hiddenCards.delete(String(appid));
      }
    }
    
    if (typeof showPremiumToast === 'function') {
      showPremiumToast('Error: ' + (e.message || 'Unknown error'), 4000, 'error');
    }
  }
}

// Expose globally
window.handleTrashClick = handleTrashClick;

// Listen results from desktop
(function setupDesktopBridgeListener(){
  if (!window._gh_bridge_hooked && window.desktopBridge) {
    // Initialize resolver queues
    if (!window._clearAllCacheResolvers) {
      window._clearAllCacheResolvers = [];
    }
    
    window.desktopBridge.onMessage((msg) => {
      try {
        if (!msg) return;
        const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
        if (data?.type === 'OnlineFixAvailability') {
          const available = !!data.available;
          const btn = document.getElementById(`btn-onlinefix-${data.appid}`);
          const key = String(data.appid);
          if (window._ofx_checking?.get(key) !== true && window._ofx_cancelledChecking?.get(key) !== true) {
            return;
          }
          if (window._ofx_cancelledChecking?.get(key) === true) {
            hideOverlayById('online-fix-checking');
            window._ofx_checking?.delete(key);
            window._ofx_cancelledChecking?.delete(key);
            if (btn) { btn.disabled = false; btn.textContent = 'Online-Fix'; }
            return;
          }
          const prev = window._ofx_lastAvailability.get(String(data.appid));
          const currentKey = `${available ? '1' : '0'}:${data.url || ''}`;
          if (prev === currentKey) {
            hideOverlayById('online-fix-checking');
            return;
          }
          window._ofx_lastAvailability.set(String(data.appid), currentKey);
          hideOverlayById('online-fix-checking');
          window._ofx_checking.delete(String(data.appid));
          if (available && data.url) {
            ensureOnlineFixAvailablePopup(data.appid, data.url);
            if (btn) { btn.disabled = false; btn.textContent = 'Online-Fix'; }
          } else {
            showOnlineFixUnavailable();
            if (btn) { btn.disabled = false; btn.textContent = 'Online-Fix'; }
          }
          return;
        } else if (data?.type === 'OnlineFixResult') {
          const key = String(data.appid);
          const wasApplying = window._ofx_applying?.get(key) === true;
          const wasCancelledCheck = window._ofx_cancelledChecking?.get(key) === true;
          if (!wasApplying && wasCancelledCheck) {
            window._ofx_cancelledChecking?.delete(key);
            return;
          }
          window._ofx_applying?.delete(key);
          if (data.success === true) {
            try { updateProgressOverlay({ phase: 'Selesai', percent: 100, status: 'Online-Fix berhasil diterapkan' }); } catch (e) {}
            try {
              const btn = document.getElementById('gh-progress-cancel');
              if (btn) { btn.disabled = false; btn.textContent = 'Kembali'; btn.onclick = () => hideProgressOverlay(); }
            } catch (e) {}
            window.ui?.updateOnlineFixButton?.(String(data.appid), { applied: true });
          } else {
            const err = String(data.error || 'Online-Fix gagal diterapkan');
            try { updateProgressOverlay({ phase: 'Gagal', percent: 0, status: err }); } catch (e) {}
            try {
              const btn = document.getElementById('gh-progress-cancel');
              if (btn) { btn.disabled = false; btn.textContent = 'Kembali'; btn.onclick = () => hideProgressOverlay(); }
            } catch (e) {}
            if (data.error === 'unavailable') showOnlineFixUnavailable();
            if (data.error === 'game-not-installed') showGameNotInstalled();
          }
          return;
        } else if (data?.type === 'OnlineFixProgress') {
          const { status, bytesRead, totalBytes } = data;
          if (status === 'downloading' && typeof bytesRead === 'number') {
            const pct = totalBytes ? Math.floor((bytesRead / totalBytes) * 100) : 0;
            updateProgressOverlay(`Mengunduh Online Fix... ${pct}%`);
          } else if (status === 'extracting') {
            updateProgressOverlay('Mengekstrak Online Fix...');
          }
          return;
        }
        if (msg.type === 'AddGameProgress') {
          const phaseMap = { download: 'Mengunduh', validate: 'Validasi', install: 'Memasang' };
          updateProgressOverlay({ phase: phaseMap[msg.phase] || msg.phase, percent: msg.percent, status: phaseMap[msg.phase] || msg.phase });
        } else if (msg.type === 'AddGameResult') {
          if (msg.cancelled) {
            updateProgressOverlay({
              phase: "Dibatalkan",
              percent: 0,
              status: "Dibatalkan",
            });
            // Ubah tombol menjadi 'Kembali' dan izinkan menutup overlay
            const btn = document.getElementById("gh-progress-cancel");
            if (btn) {
              btn.disabled = false;
              btn.textContent = "Kembali";
              btn.onclick = () => hideProgressOverlay();
            }
            // Otomatis Kembali setelah sedikit jeda
            setTimeout(() => hideProgressOverlay(), 600);
          } else if (msg.success) {
            updateProgressOverlay({ phase: 'Selesai', percent: 100, status: 'Berhasil dipasang' });
            if (window._gh_current_appid) updateAddRemoveButton(String(window._gh_current_appid), true);
          } else {
            const err = String(msg.error || 'Gagal');
            const isUnavailable = /semua api gagal|tidak tersedia|not available|unavailable/i.test(err);
            if (isUnavailable) {
              hideProgressOverlay();
              showUnavailableOverlay('Game Masih Belum Tersedia.');
            } else {
              updateProgressOverlay({ phase: 'Gagal', percent: 0, status: err });
              setTimeout(() => hideProgressOverlay(), 900);
            }
          }
          if (msg.success) setTimeout(() => hideProgressOverlay(), 900);
        } else if (msg.type === 'GameInstalledState') {
          updateAddRemoveButton(String(msg.appid), !!msg.installed);
        } else if (msg.type === 'RestartSteamResult') {
          // Restore button state and show status
          try {
            const btn = document.getElementById('btn-restart-steam');
            if (btn) {
              btn.disabled = false;
              btn.innerHTML = '🔄 Restart Steam';
            }
          } catch (e) {}
          if (msg.success) {
            if (typeof showTransientMessage === 'function') {
              showTransientMessage('Steam berhasil direstart', 3000, 'success');
            }
          } else {
            if (typeof showTransientMessage === 'function') {
              showTransientMessage('Gagal restart Steam: ' + (msg.error || 'Unknown error'), 4000, 'error');
            }
          }
        } else if (msg.type === 'OnlineFixAppliedState') {
          const applied = !!msg.applied;
          window.ui?.updateOnlineFixButton?.(String(msg.appid), { applied });
        } else if (msg.type === 'UnfixQueued') {
          ofxUpdateUnfixOverlay('Menyiapkan penghapusan...');
        } else if (msg.type === 'UnfixProgress') {
          const total = msg.totalFiles || 0;
          const removed = msg.removedFiles || 0;
          let percent = 0;
          if (total > 0) percent = Math.min(100, Math.floor((removed / total) * 100));
          ofxUpdateUnfixOverlay(`Menghapus file (${removed}/${total})... ${percent}%`);
        } else if (msg.type === 'UnfixResult') {
          if (msg.success) {
            ofxUpdateUnfixOverlay('UnOnline-Fix selesai.');
            setTimeout(() => {
              ofxHideUnfixOverlay();
              showUnfixSuccessPopup(String(msg.appid), msg.filesRemoved || 0);
              window.ui?.updateOnlineFixButton?.(String(msg.appid), { applied: false });
            }, 350);
          } else {
            ofxUpdateUnfixOverlay(`Gagal: ${msg.error || 'Tidak diketahui'}`);
            setTimeout(() => ofxHideUnfixOverlay(), 900);
          }
        } else if (msg.type === 'RawDatasetProgress') {
          // Handle raw dataset download progress
          try {
            if (typeof updateBlockingOverlayProgress === 'function') {
              updateBlockingOverlayProgress(msg.percent || 0, msg.message || null);
            }
          } catch (e) {}
        } else if (msg.type === 'RemoveGameResult') {
          // Handle remove game result
          try {
            const appid = String(msg.appid || window._gh_current_appid || '');
            const skipPopup = window._skipRemovePopup === true;
            
            // Check if we're on Library page
            const isLibraryPage = window.libraryFilterActive === true || 
              (document.querySelector('h1')?.textContent?.trim() === 'Library Games');
            
            // Clear flag
            window._skipRemovePopup = false;
            
            if (msg.success) {
              // SUCCESS: Hide progress overlay
              hideProgressOverlay();
              
              // Only hide card if we're on Library page (both trash button and modal detail)
              if (isLibraryPage && typeof animateRemoveGameCard === 'function') {
                // Hide card with animation (only on Library page)
                animateRemoveGameCard(appid, skipPopup);
              }
              
              // Show success message (only if not from trash button)
              if (!skipPopup) {
                if (typeof showPremiumToast === 'function') {
                  showPremiumToast('Game berhasil dihapus', 3000, 'success');
                }
              }
              // If from trash button, no popup needed (card disappearing is the feedback)
              
              // Update button state
              if (typeof updateAddRemoveButton === 'function') {
                updateAddRemoveButton(appid, false);
              }
            } else {
              // ERROR: Remove failed - DO NOT hide card
              hideProgressOverlay();
              
              // Restore card visibility if it was already hidden (shouldn't happen, but safety check)
              const cardWrapper = document.getElementById(`game-card-wrapper-${appid}`);
              const card = document.getElementById(`game-${appid}`);
              const target = cardWrapper || card;
              if (target) {
                // Ensure card is visible (restore if hidden)
                if (target.style.display === 'none' || window.hiddenCards?.has(String(appid))) {
                  target.style.display = '';
                  target.style.opacity = '1';
                  target.style.transform = '';
                  target.style.filter = '';
                  target.style.pointerEvents = '';
                  target.style.transition = '';
                  // Remove from hiddenCards
                  if (window.hiddenCards) {
                    window.hiddenCards.delete(String(appid));
                  }
                }
              }
              
              // Show error message
              const errorMsg = msg.error || 'Gagal menghapus game';
              if (typeof showPremiumToast === 'function') {
                showPremiumToast(errorMsg, 4000, 'error');
              }
            }
          } catch (e) {
            // Error handling result - non-critical
          }
        } else if (msg.type === 'ClearAllCacheResult') {
          // Handle clear cache result - forward to any waiting promises
          try {
            if (!window._clearAllCacheResolvers) {
              window._clearAllCacheResolvers = [];
            }
            if (window._clearAllCacheResolvers && Array.isArray(window._clearAllCacheResolvers) && window._clearAllCacheResolvers.length > 0) {
              const resolver = window._clearAllCacheResolvers.shift();
              if (resolver && typeof resolver === 'function') {
                try {
                  resolver(msg);
                } catch (resolverError) {}
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    });
    window._gh_bridge_hooked = true;
  }
})();

// Toggle Add/Remove button state inside detail panel
function updateAddRemoveButton(appid, installed) {
  try {
    const addBtn = document.getElementById(`btn-add-${appid}`);
    if (!addBtn) return;
    addBtn.replaceWith(addBtn.cloneNode(true)); // remove previous listeners
    const btn = document.getElementById(`btn-add-${appid}`);
    if (!btn) return;
    if (installed) {
      btn.textContent = 'Remove-Game';
      btn.className = 'w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-rose-600 text-white text-sm font-medium hover:opacity-90';
      btn.onclick = () => onRemoveGame(appid);
    } else {
      btn.textContent = 'Add-Game';
      btn.className = 'w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:opacity-90';
      // Gunakan processedOriginalData agar nama game dan protection dari override ikut terbaca
      const dataSource = window.processedOriginalData || window.originalData || [];
      const g = dataSource.find(x => String(x.appid) === String(appid));
      const name = g?.title || '';
      btn.onclick = () => onAddGame(appid, name);
    }
  } catch (e) {}
}

// When opening detail, query installed state and set initial button
// (inject near end of openDetail)
