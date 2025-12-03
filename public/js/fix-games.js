// Fix Games Page Logic

let fixGamesData = [];
let filteredFixGames = [];
let currentCategory = 'all';
let currentSearch = '';

// Initialize Fix Games page
async function initFixGamesPage() {
  try {
    document.getElementById('fix-games-loading').classList.remove('hidden');
    document.getElementById('fix-games-empty').classList.add('hidden');
    
    // Load data from C# bridge
    if (window.desktopBridge && typeof window.desktopBridge.getFixGamesList === 'function') {
      const data = await window.desktopBridge.getFixGamesList();
      if (data && Array.isArray(data)) {
        fixGamesData = data;
        filteredFixGames = data;
        renderFixGames();
      } else {
        showEmptyState();
      }
    } else {
      // Fallback: try to load from JSON file directly (for development)
      try {
        const response = await fetch('/data/fix_games.json');
        const json = await response.json();
        // Validasi struktur JSON yang benar: { "games": [...] }
        if (json && json.games && Array.isArray(json.games)) {
          // Validasi setiap game memiliki field wajib sesuai struktur JSON:
          // - appid, title, poster, password, category, files (array dengan part)
          // - premium (optional, default false jika tidak ada)
          const validGames = json.games.filter(game => {
            return game &&
                   typeof game === 'object' &&
                   game.appid &&
                   game.title &&
                   game.poster &&
                   game.password &&
                   game.category &&
                   game.files &&
                   Array.isArray(game.files) &&
                   game.files.length > 0 &&
                   // Setiap file harus punya: part, filename, gdrive_id, gdrive_url
                   game.files.every(file => 
                     file && 
                     typeof file === 'object' &&
                     file.part && 
                     file.filename && 
                     file.gdrive_id && 
                     file.gdrive_url
                   );
          });
          
          // Set default premium: false jika tidak ada
          validGames.forEach(game => {
            if (game.premium === undefined) {
              game.premium = false;
            }
          });
          
          if (validGames.length > 0) {
            fixGamesData = validGames;
            filteredFixGames = validGames;
            renderFixGames();
          } else {
            console.warn('No valid games found in JSON - check structure');
            showEmptyState();
          }
        } else {
          console.warn('Invalid JSON structure: expected { "games": [...] }');
          showEmptyState();
        }
      } catch (e) {
        showEmptyState();
      }
    }
  } catch (e) {
    showEmptyState();
  } finally {
    document.getElementById('fix-games-loading').classList.add('hidden');
  }
}

// Filter by category
function filterFixGamesByCategory(category) {
  currentCategory = category;
  
  // Update active tab
  document.querySelectorAll('[id^="fix-category-"]').forEach(btn => {
    btn.classList.remove('active-category');
  });
  document.getElementById(`fix-category-${category}`)?.classList.add('active-category');
  
  // Apply filters
  applyFixGamesFilters();
}

// Handle search input
function handleFixGamesSearch(event) {
  currentSearch = event.target.value.trim().toLowerCase();
  applyFixGamesFilters();
}

// Apply all filters (category + search)
// Catatan: Premium filter TIDAK diterapkan di sini - semua game bisa dilihat
// Filter premium hanya diterapkan saat user klik card (di openFixGameDetail)
function applyFixGamesFilters() {
  filteredFixGames = fixGamesData.filter(game => {
    // Validate game structure sesuai JSON yang benar
    if (!game || typeof game !== 'object') {
      return false;
    }
    
    // Category filter
    if (currentCategory !== 'all') {
      if (!game.category || game.category !== currentCategory) {
        return false;
      }
    }
    
    // Search filter
    if (currentSearch) {
      const searchLower = currentSearch.toLowerCase();
      const titleMatch = (game.title || '').toLowerCase().includes(searchLower);
      const publisherMatch = (game.publisher || '').toLowerCase().includes(searchLower);
      const appidMatch = String(game.appid || '').includes(searchLower);
      
      if (!titleMatch && !publisherMatch && !appidMatch) {
        return false;
      }
    }
    
    return true;
  });
  
  renderFixGames();
}

// Render game cards
function renderFixGames() {
  const grid = document.getElementById('fix-games-grid');
  const emptyState = document.getElementById('fix-games-empty');
  
  if (!grid) return;
  
  if (filteredFixGames.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }
  
  emptyState.classList.add('hidden');
  
  grid.innerHTML = filteredFixGames.map(game => {
    // Struktur JSON yang benar:
    // - game.poster (wajib, link ke gambar 600x900)
    // - game.title (wajib)
    // - game.publisher (wajib)
    // - game.category (wajib)
    // - game.password (wajib, per-game)
    // - game.premium (optional, default false)
    // - game.files (wajib, array dengan part: 1, 2, 3, dst.)
    // - install_hint TIDAK ADA di JSON (generate otomatis oleh program)
    
    // Get poster image (600x900) - wajib dari game.poster field
    const posterUrl = game.poster || `https://steamcdn-a.akamaihd.net/steam/apps/${game.appid}/library_600x900.jpg`;
    
    // Validate required fields
    if (!game.appid || !game.title || !game.poster || !game.password || !game.files || !Array.isArray(game.files)) {
      console.warn('Invalid game data:', game);
      return ''; // Skip invalid games
    }
    
    // Determine premium label
    const isPremium = game.premium === true;
    const premiumLabel = isPremium ? 'PREMIUM' : 'STANDARD';
    const premiumColor = isPremium 
      ? 'bg-yellow-500 text-black' 
      : 'bg-gray-600 text-white';
    
    return `
      <div class="fix-game-card bg-[#151515] border border-white/5 cursor-pointer fade-up" 
           onclick="openFixGameDetail(${game.appid})">
        <img src="${escapeHtml(posterUrl)}" 
             alt="${escapeHtml(game.title)}"
             style="width: 100%; height: 100%; object-fit: cover;"
             onerror="this.onerror=null;this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';">
        <div class="absolute top-2 left-2 ${premiumColor} text-[10px] px-2 py-[2px] rounded-md font-semibold shadow z-10">
          ${premiumLabel}
        </div>
        <div class="fix-game-card-overlay">
          <div class="fix-game-card-title text-white">${escapeHtml(game.title || 'Unknown')}</div>
          <div class="fix-game-card-publisher">${escapeHtml(game.publisher || '')}</div>
        </div>
      </div>
    `;
  }).join('');
}

// Open fix game detail page
async function openFixGameDetail(appid) {
  // Cek license dan premium status sebelum buka detail
  try {
    if (window.desktopBridge && typeof window.desktopBridge.getLicenseInfo === 'function') {
      const licenseInfo = await window.desktopBridge.getLicenseInfo();
      
      // Jika license tidak valid atau tidak aktif, block
      if (!licenseInfo.isValid || !licenseInfo.isActive) {
        if (typeof premiumAlert === 'function') {
          await premiumAlert(
            'License tidak valid. Silakan aktivasi license terlebih dahulu.',
            'License Tidak Valid'
          );
        }
        return;
      }
      
      // Cari game data untuk cek premium status
      const game = fixGamesData.find(g => g.appid === appid);
      
      // Jika game premium dan license standard, block
      if (game && game.premium === true && licenseInfo.plan === 'standard') {
        if (typeof premiumAlert === 'function') {
          await premiumAlert(
            'Upgrade Ke Premium Dulu, Ya, Untuk Buka Fitur Ini 😁',
            'Fitur Premium'
          );
        }
        return;
      }
    }
  } catch (e) {
    // Jika error, tetap lanjutkan (fallback untuk development)
    console.warn('License check error:', e);
  }
  
  navigate('fix-games-detail', { appid });
}

// Show empty state
function showEmptyState() {
  document.getElementById('fix-games-loading').classList.add('hidden');
  document.getElementById('fix-games-empty').classList.remove('hidden');
}

// Escape HTML helper
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Expose globally
window.initFixGamesPage = initFixGamesPage;
window.filterFixGamesByCategory = filterFixGamesByCategory;
window.handleFixGamesSearch = handleFixGamesSearch;
window.openFixGameDetail = openFixGameDetail;

