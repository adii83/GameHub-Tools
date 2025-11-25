async function navigate(page) {
  const container = document.getElementById("app-content");
  const sidebarDashboard = document.getElementById("nav-dashboard");
  const sidebarGames = document.getElementById("nav-games");

  // Load page
  const html = await fetch(`/app/${page}.html`).then((r) => r.text());
  container.innerHTML = html;

  // Active state
  sidebarDashboard.classList.remove("bg-[#1f1f1f]", "text-white");
  sidebarGames.classList.remove("bg-[#1f1f1f]", "text-white");

  if (page === "dashboard") {
    sidebarDashboard.classList.add("bg-[#1f1f1f]", "text-white");
  } else {
    sidebarGames.classList.add("bg-[#1f1f1f]", "text-white");
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
    } else {
      console.warn("No game loader function found (loadGames/initGamesPage)");
    }
  }
}

// Load sidebar
async function loadSidebar() {
  const sidebar = await fetch("/components/sidebar.html").then((r) => r.text());
  document.getElementById("sidebar-container").innerHTML = sidebar;
}

// Start app
loadSidebar().then(() => navigate("games"));
