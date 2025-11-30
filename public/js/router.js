async function navigate(page) {
  const container = document.getElementById("app-content");
  const sidebarDashboard = document.getElementById("nav-dashboard");
  const sidebarGames = document.getElementById("nav-games");

  // Load page
  const html = await fetch(`/app/${page}.html`).then((r) => r.text());
  // Inject HTML and ensure any inline <script> tags execute
  container.innerHTML = html;
  try {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const scripts = temp.querySelectorAll('script');
    scripts.forEach((old) => {
      const s = document.createElement('script');
      // Only execute inline scripts to avoid reloading global JS twice
      if (old.type) {
        s.type = old.type;
      }
      // Inline script content
      if (!old.src) {
        s.textContent = old.textContent || '';
        document.body.appendChild(s);
      }
    });
  } catch (e) {}

  // Active state
  sidebarDashboard?.classList.remove("bg-[#1f1f1f]", "text-white");
  sidebarGames?.classList.remove("bg-[#1f1f1f]", "text-white");
  // sidebarLibrary removed — Library page has been deleted

  if (page === "dashboard") {
    sidebarDashboard?.classList.add("bg-[#1f1f1f]", "text-white");
  } else if (page === "games") {
    sidebarGames?.classList.add("bg-[#1f1f1f]", "text-white");
  }

  // Jika halaman adalah Games → jalankan render
  if (page === "games") {
    // Load filter panel HTML into the filter-panel container (if present)
    const filterPanelHtml = await fetch("/components/filter-panel.html").then((r) => r.text());
    const filterPanelContainer = document.getElementById("filter-panel");
    if (filterPanelContainer) {
      filterPanelContainer.innerHTML = filterPanelHtml;
    }

    // Call whichever game loader is available (maintain compatibility)
    if (typeof loadGames === "function") {
      loadGames();
    } else if (typeof initGamesPage === "function") {
      initGamesPage();
    }
  }

  // Library page removed — no special actions required
}

// Load sidebar
async function loadSidebar() {
  const sidebar = await fetch("/components/sidebar.html").then((r) => r.text());
  document.getElementById("sidebar-container").innerHTML = sidebar;
}

// Start app
loadSidebar().then(() => navigate("games"));
