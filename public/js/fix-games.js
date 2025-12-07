// Fix Games Page Logic

// Gunakan IIFE untuk menghindari duplikasi deklarasi
(function() {
  'use strict';
  
  // Deklarasi variabel lokal
  let fixGamesData = [];
  let filteredFixGames = [];
  let currentCategory = 'all';
  let currentSearch = '';
  let filterStandard = true;
  let filterPremium = true;

  // Filter by category
  async function filterFixGamesByCategory(category) {
    currentCategory = category;
    
    // Update active tab
    document.querySelectorAll('[id^="fix-category-"]').forEach(btn => {
      btn.classList.remove('active-category');
    });
    document.getElementById(`fix-category-${category}`)?.classList.add('active-category');
    
    // If switching to steam-account, reload data with fresh check
    if (category === 'steam-account') {
      document.getElementById('fix-games-loading').classList.remove('hidden');
      document.getElementById('fix-games-empty').classList.add('hidden');
      
      try {
        let json = null;
        // Always load fresh for steam-account (with expired check via service)
        if (window.desktopBridge && typeof window.desktopBridge.getSteamGamesData === 'function') {
          json = await window.desktopBridge.getSteamGamesData(false); // false = check expired, load fresh if needed
        } else {
          const STEAM_GAMES_URL = 'https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/steam_games/steam_games.json';
          const response = await fetch(STEAM_GAMES_URL, { cache: 'no-store' });
          if (response.ok) {
            json = await response.json();
          }
        }
        
        if (Array.isArray(json)) {
          // Validasi Steam Account games
          const validSteamGames = json.filter(game => {
            if (!game || typeof game !== 'object') return false;
            // Steam Account games harus punya: appid, title, poster, username, password
            return game.appid && game.title && game.poster && game.username && game.password;
          });
          
          validSteamGames.forEach(game => {
            if (game && typeof game === 'object') {
              game.category = 'steam-account';
              if (game.premium === undefined) {
                game.premium = false;
              }
            }
          });
          
          validSteamGames.sort((a, b) => {
            const titleA = (a.title || '').toUpperCase().replace(/[®™:]/g, '').trim();
            const titleB = (b.title || '').toUpperCase().replace(/[®™:]/g, '').trim();
            return titleA.localeCompare(titleB);
          });
          
          fixGamesData = validSteamGames;
          window.fixGamesData = validSteamGames;
          window.steamGamesData = validSteamGames;
          
          // Apply filters after loading
          applyFixGamesFilters();
        } else {
          showEmptyState();
        }
      } catch (e) {
        showEmptyState();
      } finally {
        document.getElementById('fix-games-loading').classList.add('hidden');
      }
    } else {
      // Reload fix_games.json for other categories (including 'all')
      // Untuk kategori 'all', SELALU reload untuk memastikan data fix_games.json ter-load
      // Jangan gunakan data Steam Account yang mungkin masih ada di memory
      const needsReload = category === 'all' || 
                         fixGamesData.length === 0 || 
                         !fixGamesData.some(game => game && game.files && Array.isArray(game.files));
      
      if (needsReload) {
        document.getElementById('fix-games-loading').classList.remove('hidden');
        try {
          let fixGamesJson = null;
          if (window.desktopBridge && typeof window.desktopBridge.getFixGamesData === 'function') {
            fixGamesJson = await window.desktopBridge.getFixGamesData(false); // false = check expired, load fresh if needed
          } else {
            const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/fix_games.json';
            const response = await fetch(GITHUB_RAW_URL, { cache: 'no-store' });
            if (response.ok) {
              fixGamesJson = await response.json();
            }
          }
          
          // Jika kategori "all", juga load steam_games.json dan merge
          let steamGamesJson = null;
          if (category === 'all') {
            try {
              if (window.desktopBridge && typeof window.desktopBridge.getSteamGamesData === 'function') {
                steamGamesJson = await window.desktopBridge.getSteamGamesData(false);
              } else {
                const STEAM_GAMES_URL = 'https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/steam_games/steam_games.json';
                const response = await fetch(STEAM_GAMES_URL, { cache: 'no-store' });
                if (response.ok) {
                  steamGamesJson = await response.json();
                }
              }
            } catch (e) {
              // Error loading steam games - non-critical, continue with fix_games.json only
            }
          }
          
          if (fixGamesJson && fixGamesJson.games && Array.isArray(fixGamesJson.games)) {
            const validGames = fixGamesJson.games.filter(game => {
              if (!game || typeof game !== 'object') return false;
              if (!game.appid || !game.title || !game.poster || !game.password || !game.category) {
                return false;
              }
              if (!game.files || !Array.isArray(game.files) || game.files.length === 0) {
                return false;
              }
              const allFilesValid = game.files.every(file => {
                return file && typeof file === 'object' &&
                       file.part !== undefined && 
                       file.filename && 
                       file.gdrive_id && 
                       file.gdrive_url;
              });
              return allFilesValid;
            });
            
            validGames.forEach(game => {
              if (game.premium === undefined) {
                game.premium = false;
              }
            });
            
            // Jika kategori "all" dan steam_games.json berhasil di-load, merge dengan validGames
            if (category === 'all' && steamGamesJson && Array.isArray(steamGamesJson)) {
              // Validasi Steam Account games
              const validSteamGames = steamGamesJson.filter(game => {
                if (!game || typeof game !== 'object') return false;
                // Steam Account games harus punya: appid, title, poster, username, password
                return game.appid && game.title && game.poster && game.username && game.password;
              });
              
              // Set category dan premium untuk Steam Account games
              validSteamGames.forEach(game => {
                if (game && typeof game === 'object') {
                  game.category = 'steam-account';
                  if (game.premium === undefined) {
                    game.premium = false;
                  }
                }
              });
              
              // Merge fix games dan steam account games
              validGames.push(...validSteamGames);
            }
            
            validGames.sort((a, b) => {
              const titleA = (a.title || '').toUpperCase().replace(/[®™:]/g, '').trim();
              const titleB = (b.title || '').toUpperCase().replace(/[®™:]/g, '').trim();
              return titleA.localeCompare(titleB);
            });
            
            fixGamesData = validGames;
            window.fixGamesData = validGames;
            
            // Apply filters after loading
            applyFixGamesFilters();
          } else {
            showEmptyState();
          }
        } catch (e) {
          showEmptyState();
        } finally {
          document.getElementById('fix-games-loading').classList.add('hidden');
        }
      } else {
        // If category is not 'all' and we have valid fix_games data, just apply filters
        applyFixGamesFilters();
      }
    }
  }

  // Handle search input
  function handleFixGamesSearch(event) {
    currentSearch = event.target.value.trim().toLowerCase();
    applyFixGamesFilters();
  }

  // Toggle premium/standard filter
  function toggleFixGamesFilter(type) {
    if (type === 'standard') {
      filterStandard = !filterStandard;
      const btn = document.getElementById('fix-filter-standard');
      if (btn) {
        if (filterStandard) {
          btn.classList.add('active-filter');
        } else {
          btn.classList.remove('active-filter');
        }
      }
    } else if (type === 'premium') {
      filterPremium = !filterPremium;
      const btn = document.getElementById('fix-filter-premium');
      if (btn) {
        if (filterPremium) {
          btn.classList.add('active-filter');
        } else {
          btn.classList.remove('active-filter');
        }
      }
    }
    
    // Ensure at least one filter is active
    if (!filterStandard && !filterPremium) {
      if (type === 'standard') {
        filterPremium = true;
        document.getElementById('fix-filter-premium')?.classList.add('active-filter');
      } else {
        filterStandard = true;
        document.getElementById('fix-filter-standard')?.classList.add('active-filter');
      }
    }
    
    applyFixGamesFilters();
  }

  // Initialize Fix Games page
  async function initFixGamesPage() {
    try {
      // OPTIMASI: Cek cache dulu sebelum load data
      // Untuk kategori "all", skip cache karena perlu merge dengan Steam Account data
      // Hanya gunakan cache jika kategori adalah kategori fix games lainnya (bukan steam-account dan bukan all)
      if (currentCategory !== 'steam-account' && currentCategory !== 'all' && window.FixGamesPageCache && window.FixGamesPageCache.isValid()) {
        const cached = window.FixGamesPageCache.get();
        // Pastikan cache berisi fix_games.json data (bukan steam_games.json)
        // Cek dengan melihat apakah ada game dengan category selain 'steam-account'
        if (cached && cached.fixGamesData && Array.isArray(cached.fixGamesData) && cached.fixGamesData.length > 0) {
          // Pastikan ini adalah data fix_games.json (punya files), bukan steam_games.json
          const hasFixGamesData = cached.fixGamesData.some(game => game && game.files && Array.isArray(game.files));
          if (hasFixGamesData) {
            // Restore dari cache (instant, tidak perlu loading)
            // Defer restore untuk tidak block UI
            if (window.requestIdleCallback) {
              await new Promise(resolve => window.requestIdleCallback(() => resolve(), { timeout: 100 }));
            } else {
              await new Promise(resolve => setTimeout(resolve, 0));
            }
            fixGamesData = cached.fixGamesData;
            window.fixGamesData = fixGamesData;
            // Apply filters untuk memastikan filteredFixGames ter-update sesuai kategori
            applyFixGamesFilters();
            document.getElementById('fix-games-loading').classList.add('hidden');
            return; // Skip loading, langsung render dari cache
          }
        }
      }
      
      document.getElementById('fix-games-loading').classList.remove('hidden');
      document.getElementById('fix-games-empty').classList.add('hidden');
      
      // Load data via desktop bridge (cached on disk with ETag check)
      let json = null;
      
      try {
        // Check if current category is steam-account
        // HANYA load steam_games.json jika kategori EXPLICITLY adalah 'steam-account'
        // Untuk kategori 'all' atau kategori lainnya, load fix_games.json
        if (currentCategory === 'steam-account') {
          // Load steam_games.json for Steam Account category
          if (window.desktopBridge && typeof window.desktopBridge.getSteamGamesData === 'function') {
            json = await window.desktopBridge.getSteamGamesData(false);
          } else {
            // Fallback: direct fetch
            const STEAM_GAMES_URL = 'https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/steam_games/steam_games.json';
            const response = await fetch(STEAM_GAMES_URL, { cache: 'no-store' });
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            json = await response.json();
          }
          
          // Steam games format: array langsung [ {...}, {...} ]
          if (Array.isArray(json)) {
            // Add category to each game
            json.forEach(game => {
              if (game && typeof game === 'object') {
                game.category = 'steam-account';
                // Set default premium: false jika tidak ada
                if (game.premium === undefined) {
                  game.premium = false;
                }
              }
            });
            
            // Sort games alphabetically
            json.sort((a, b) => {
              const titleA = (a.title || '').toUpperCase()
                .replace(/[®™:]/g, '')
                .trim();
              const titleB = (b.title || '').toUpperCase()
                .replace(/[®™:]/g, '')
                .trim();
              return titleA.localeCompare(titleB);
            });
            
            // Validasi Steam Account games
            const validSteamGames = json.filter(game => {
              if (!game || typeof game !== 'object') return false;
              // Steam Account games harus punya: appid, title, poster, username, password
              return game.appid && game.title && game.poster && game.username && game.password;
            });
            
            if (validSteamGames.length > 0) {
              fixGamesData = validSteamGames;
              window.fixGamesData = validSteamGames;
              window.steamGamesData = validSteamGames; // Store separately for detail page
              
              if (window.FixGamesPageCache) {
                setTimeout(() => {
                  try {
                    window.FixGamesPageCache.set(fixGamesData, filteredFixGames);
                  } catch (e) {
                    // Failed to save cache - non-critical
                  }
                }, 0);
              }
              
              // Apply filters untuk Steam Account
              applyFixGamesFilters();
            } else {
              showEmptyState();
            }
          } else {
            showEmptyState();
          }
        } else {
          // Load fix_games.json for other categories (always check expired, load fresh if needed)
          let fixGamesJson = null;
          if (window.desktopBridge && typeof window.desktopBridge.getFixGamesData === 'function') {
            fixGamesJson = await window.desktopBridge.getFixGamesData(false); // false = check expired, load fresh if needed
          } else {
            // Fallback: direct fetch (for development/testing)
            const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/fix_games.json';
            const response = await fetch(GITHUB_RAW_URL, { cache: 'no-store' });
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            fixGamesJson = await response.json();
          }
          
          // Jika kategori "all", juga load steam_games.json dan merge
          let steamGamesJson = null;
          if (currentCategory === 'all') {
            try {
              if (window.desktopBridge && typeof window.desktopBridge.getSteamGamesData === 'function') {
                steamGamesJson = await window.desktopBridge.getSteamGamesData(false);
              } else {
                const STEAM_GAMES_URL = 'https://raw.githubusercontent.com/adii83/steam-metadata-archive/main/steam_games/steam_games.json';
                const response = await fetch(STEAM_GAMES_URL, { cache: 'no-store' });
                if (response.ok) {
                  steamGamesJson = await response.json();
                }
              }
            } catch (e) {
              // Error loading steam games - non-critical, continue with fix_games.json only
            }
          }
          
          // Validasi struktur JSON yang benar: { "games": [...] }
          if (fixGamesJson && fixGamesJson.games && Array.isArray(fixGamesJson.games)) {
            // Validasi setiap game memiliki field wajib sesuai struktur JSON:
            // - appid, title, poster, password, category, files (array dengan part)
            // - premium (optional, default false jika tidak ada)
            const validGames = fixGamesJson.games.filter(game => {
              if (!game || typeof game !== 'object') return false;
              
              // Field wajib
              if (!game.appid || !game.title || !game.poster || !game.password || !game.category) {
                return false;
              }
              
              // Files harus array dan tidak kosong
              if (!game.files || !Array.isArray(game.files) || game.files.length === 0) {
                return false;
              }
              
              // Setiap file harus punya: part, filename, gdrive_id, gdrive_url
              const allFilesValid = game.files.every(file => {
                return file && 
                       typeof file === 'object' &&
                       file.part !== undefined && 
                       file.filename && 
                       file.gdrive_id && 
                       file.gdrive_url;
              });
              
              return allFilesValid;
            });
            
            // Set default premium: false jika tidak ada
            validGames.forEach(game => {
              if (game.premium === undefined) {
                game.premium = false;
              }
            });
            
            // Jika kategori "all" dan steam_games.json berhasil di-load, merge dengan validGames
            if (currentCategory === 'all' && steamGamesJson && Array.isArray(steamGamesJson)) {
              // Validasi Steam Account games
              const validSteamGames = steamGamesJson.filter(game => {
                if (!game || typeof game !== 'object') return false;
                // Steam Account games harus punya: appid, title, poster, username, password
                return game.appid && game.title && game.poster && game.username && game.password;
              });
              
              // Set category dan premium untuk Steam Account games
              validSteamGames.forEach(game => {
                if (game && typeof game === 'object') {
                  game.category = 'steam-account';
                  if (game.premium === undefined) {
                    game.premium = false;
                  }
                }
              });
              
              // Merge fix games dan steam account games
              validGames.push(...validSteamGames);
            }
            
            // Sort games alphabetically by title (ignore special characters)
            validGames.sort((a, b) => {
              const titleA = (a.title || '').toUpperCase()
                .replace(/[®™:]/g, '')
                .trim();
              const titleB = (b.title || '').toUpperCase()
                .replace(/[®™:]/g, '')
                .trim();
              return titleA.localeCompare(titleB);
            });
            
            if (validGames.length > 0) {
              fixGamesData = validGames;
              // Update window.fixGamesData untuk detail page
              window.fixGamesData = validGames;
              
              // OPTIMASI: Simpan ke cache setelah load (defer untuk tidak block UI)
              if (window.FixGamesPageCache) {
                setTimeout(() => {
                  try {
                    window.FixGamesPageCache.set(fixGamesData, filteredFixGames);
                  } catch (e) {
                    // Failed to save cache - non-critical
                  }
                }, 0);
              }
              
              // Apply filters untuk kategori "all" atau kategori lainnya
              applyFixGamesFilters();
            } else {
              showEmptyState();
            }
          } else {
            showEmptyState();
          }
        }
      } catch (e) {
        showEmptyState();
      }
    } catch (e) {
      showEmptyState();
    } finally {
      document.getElementById('fix-games-loading').classList.add('hidden');
    }
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
      
      // Premium/Standard filter
      const isPremium = game.premium === true;
      if (isPremium && !filterPremium) {
        return false;
      }
      if (!isPremium && !filterStandard) {
        return false;
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
    
    // Sort filtered games alphabetically by title (ignore special characters)
    filteredFixGames.sort((a, b) => {
      const titleA = (a.title || '').toUpperCase()
        .replace(/[®™:]/g, '')
        .trim();
      const titleB = (b.title || '').toUpperCase()
        .replace(/[®™:]/g, '')
        .trim();
      return titleA.localeCompare(titleB);
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
      
      // Check if this is Steam Account game (has username/password, no files)
      const isSteamAccount = game.category === 'steam-account' && game.username && game.password;
      
      // Validate required fields based on game type
      if (isSteamAccount) {
        // Steam Account games: appid, title, poster, username, password
        if (!game.appid || !game.title || !game.poster || !game.username || !game.password) {
          return ''; // Skip invalid Steam Account games
        }
      } else {
        // Regular Fix Games: appid, title, poster, password, files
        if (!game.appid || !game.title || !game.poster || !game.password || !game.files || !Array.isArray(game.files)) {
          return ''; // Skip invalid Fix Games
        }
      }
      
      // Determine premium label
      const isPremium = game.premium === true;
      const premiumLabel = isPremium ? 'PREMIUM' : 'STANDARD';
      const premiumColor = isPremium 
        ? 'bg-yellow-500 text-black' 
        : 'bg-gray-600 text-white';
      
      return `
        <div class="fix-game-card bg-[#151515] border border-white/5 cursor-pointer fade-up" 
             onclick="openFixGameDetail(${game.appid}, '${game.category || ''}')">
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
    // Cek apakah game dari kategori steam-account
    const game = fixGamesData.find(g => g.appid === appid);
    const isSteamAccount = game && game.category === 'steam-account';
    
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
        
        // Untuk kategori steam-account, cek premium status
        if (isSteamAccount) {
          // Jika game premium dan license masih standard, block akses Steam Account
          if (game && game.premium === true && licenseInfo.plan === 'standard') {
            if (typeof premiumAlert === 'function') {
              await premiumAlert(
                'Upgrade Ke Premium Dulu, Ya, Untuk Buka Fitur Ini 😁',
                'Fitur Premium'
              );
            }
            return;
          }
        } else {
          // Untuk kategori lain, cek premium seperti biasa
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
      }
    } catch (e) {
      // License check error - non-critical
    }
    
    // Navigate dengan flag untuk kategori steam-account
    navigate('fix-games-detail', { appid, isSteamAccount: isSteamAccount ? true : undefined });
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

  // Expose globally (WAJIB untuk onclick di HTML)
  window.initFixGamesPage = initFixGamesPage;
  window.filterFixGamesByCategory = filterFixGamesByCategory;
  window.handleFixGamesSearch = handleFixGamesSearch;
  window.openFixGameDetail = openFixGameDetail;
  window.toggleFixGamesFilter = toggleFixGamesFilter;
  
  // Expose fixGamesData untuk detail page
  // Update function untuk sync dengan window.fixGamesData
  const updateFixGamesData = () => {
    window.fixGamesData = fixGamesData;
  };
  
  // Initial update
  updateFixGamesData();
})();
