(function(){
  async function ensureLogSidebarLoaded(){
    if (document.getElementById('log-sidebar')) return;
    try {
      const html = await fetch('/components/log-sidebar.html', { cache: 'no-cache' }).then(r => r.text());
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      document.body.appendChild(wrap.firstElementChild);
      wireLogSidebar();
    } catch (e) {}
  }

  function wireLogSidebar(){
    const sidebar = document.getElementById('log-sidebar');
    if (!sidebar) return;
    const btnClose = sidebar.querySelector('#log-close');
    const btnRefresh = sidebar.querySelector('#log-refresh');
    const btnSave = sidebar.querySelector('#log-save');

    btnClose?.addEventListener('click', () => window.ui.closeLogSidebar());
    btnRefresh?.addEventListener('click', () => window.ui.refreshLogSidebar());
    btnSave?.addEventListener('click', () => window.ui.saveAppLog());
  }

  function showLogSidebar(){
    const el = document.getElementById('log-sidebar');
    if (!el) return;
    el.classList.remove('translate-x-full');
    el.classList.remove('opacity-0');
    el.classList.add('opacity-100');
  }
  function hideLogSidebar(){
    const el = document.getElementById('log-sidebar');
    if (!el) return;
    el.classList.add('translate-x-full');
    el.classList.add('opacity-0');
    el.classList.remove('opacity-100');
  }
  function setLogBody(text){
    const body = document.getElementById('log-body');
    if (body) body.textContent = text || '';
  }

  function appendLogLine(line){
    const body = document.getElementById('log-body');
    if (!body) return;
    const nearBottom = (body.scrollHeight - body.scrollTop - body.clientHeight) < 40;
    if (body.textContent && body.textContent.length) body.textContent += '\n' + (line || '');
    else body.textContent = (line || '');
    if (nearBottom) body.scrollTop = body.scrollHeight;
  }

  window.ui = window.ui || {};
  window.ui.openLogSidebar = async () => {
    await ensureLogSidebarLoaded();
    showLogSidebar();
    // Manual mode: do not auto-fetch; user can press Segarkan
  };
  window.ui.closeLogSidebar = () => {
    // Manual mode: nothing to unsubscribe
    hideLogSidebar();
  };
  // Manual refresh still available if needed
  window.ui.refreshLogSidebar = () => {
    try { window.desktopBridge?.send('GetAppLog', {}); } catch (e) {}
  };
  window.ui.saveAppLog = () => {
    try { window.desktopBridge?.send('SaveAppLog', {}); } catch (e) {}
  };

  // Bridge responses for logs
  function onBridge(msg){
    try {
      const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
      if (data?.type === 'AppLog') {
        const lines = Array.isArray(data.lines) ? data.lines : [];
        setLogBody(lines.join('\n'));
        // auto-scroll to bottom on snapshot
        try { const body = document.getElementById('log-body'); if (body) body.scrollTop = body.scrollHeight; } catch (e) {}
      } else if (data?.type === 'AppLogSaved') {
        const ok = !!data.success; const p = data.path || '';
        if (ok) {
          // tiny toast inside sidebar header area
          const sidebar = document.getElementById('log-sidebar');
          if (sidebar) {
            const toast = document.createElement('div');
            toast.className = 'absolute top-2 right-[440px] bg-emerald-600/90 text-white text-xs px-3 py-1.5 rounded shadow';
            toast.textContent = 'Log disimpan: ' + p;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2000);
          }
        } else {
          alert('Gagal menyimpan log: ' + (data.error || 'Unknown'));
        }
      }
    } catch (e) {}
  }
  if (window.desktopBridge && typeof window.desktopBridge.onMessage === 'function') {
    window.desktopBridge.onMessage(onBridge);
  }
})();
