// Page Cache System - Cache data per page untuk menghindari reload
(function() {
  'use strict';
  
  const CACHE_KEYS = {
    GAMES_DATA: 'gamehub_games_data_cache',
    GAMES_META: 'gamehub_games_meta_cache',
    FIX_GAMES_DATA: 'gamehub_fix_games_data_cache',
    FIX_GAMES_META: 'gamehub_fix_games_meta_cache',
    LIBRARY_DATA: 'gamehub_library_data_cache',
    LIBRARY_META: 'gamehub_library_meta_cache'
  };
  
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 jam
  
  // In-memory cache (lebih cepat dari localStorage)
  const memoryCache = {
    games: null,
    fixGames: null,
    library: null
  };
  
  // Check if cache is valid
  function isCacheValid(metaKey) {
    try {
      const metaRaw = localStorage.getItem(metaKey);
      if (!metaRaw) return false;
      
      const meta = JSON.parse(metaRaw);
      if (!meta || !meta.timestamp) return false;
      
      const age = Date.now() - meta.timestamp;
      return age < CACHE_TTL;
    } catch (e) {
      return false;
    }
  }
  
  // Save cache to localStorage (only meta for large data, data stays in memory)
  function saveCache(dataKey, metaKey, data) {
    try {
      // OPTIMASI: Untuk data besar (games), hanya simpan meta, data tetap di memory
      // localStorage punya limit ~5-10MB, data games bisa sangat besar
      const dataSize = JSON.stringify(data).length;
      const MAX_LOCALSTORAGE_SIZE = 2 * 1024 * 1024; // 2MB limit
      
      if (dataSize > MAX_LOCALSTORAGE_SIZE) {
        // Data terlalu besar, hanya simpan meta (timestamp untuk tracking)
        localStorage.setItem(metaKey, JSON.stringify({
          timestamp: Date.now(),
          version: '1.0',
          inMemoryOnly: true // Flag bahwa data hanya di memory
        }));
        // Jangan simpan data ke localStorage (akan tetap di memory cache)
      } else {
        // Data kecil, bisa simpan ke localStorage
        localStorage.setItem(dataKey, JSON.stringify(data));
        localStorage.setItem(metaKey, JSON.stringify({
          timestamp: Date.now(),
          version: '1.0',
          inMemoryOnly: false
        }));
      }
    } catch (e) {
      // Jika error (QuotaExceeded), hanya simpan meta
      try {
        localStorage.setItem(metaKey, JSON.stringify({
          timestamp: Date.now(),
          version: '1.0',
          inMemoryOnly: true
        }));
      } catch (e2) {
        console.warn('Failed to save cache meta:', e2);
      }
    }
  }
  
  // Load cache from localStorage
  function loadCache(dataKey) {
    try {
      const raw = localStorage.getItem(dataKey);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Check if data is too large (shouldn't be in localStorage)
      if (data && data.originalData && Array.isArray(data.originalData) && data.originalData.length > 10000) {
        // Data terlalu besar, skip (hanya di memory)
        return null;
      }
      return data;
    } catch (e) {
      console.warn('Failed to load cache:', e);
      return null;
    }
  }
  
  // Clear cache
  function clearCache(dataKey, metaKey) {
    try {
      localStorage.removeItem(dataKey);
      localStorage.removeItem(metaKey);
    } catch (e) {
      console.warn('Failed to clear cache:', e);
    }
  }
  
  // Games Page Cache
  window.GamesPageCache = {
    get() {
      // Check memory cache first
      if (memoryCache.games) {
        return memoryCache.games;
      }
      
      // Check localStorage cache
      if (isCacheValid(CACHE_KEYS.GAMES_META)) {
        const data = loadCache(CACHE_KEYS.GAMES_DATA);
        if (data) {
          memoryCache.games = data;
          return data;
        }
      }
      
      return null;
    },
    
    set(originalData, filteredData) {
      const cacheData = {
        originalData: originalData,
        filteredData: filteredData,
        timestamp: Date.now()
      };
      
      // Save to memory
      memoryCache.games = cacheData;
      
      // Save to localStorage
      saveCache(CACHE_KEYS.GAMES_DATA, CACHE_KEYS.GAMES_META, cacheData);
    },
    
    clear() {
      memoryCache.games = null;
      clearCache(CACHE_KEYS.GAMES_DATA, CACHE_KEYS.GAMES_META);
    },
    
    isValid() {
      // Untuk data besar, hanya cek memory cache (localStorage tidak digunakan)
      if (memoryCache.games) return true;
      
      // Cek meta untuk tahu apakah pernah load (tapi data hanya di memory)
      try {
        const metaRaw = localStorage.getItem(CACHE_KEYS.GAMES_META);
        if (metaRaw) {
          const meta = JSON.parse(metaRaw);
          if (meta && meta.timestamp) {
            const age = Date.now() - meta.timestamp;
            // Jika meta ada tapi data tidak di localStorage (inMemoryOnly), return false
            // karena data hilang setelah refresh (hanya di memory)
            return age < CACHE_TTL && !meta.inMemoryOnly;
          }
        }
      } catch (e) {}
      
      return false;
    }
  };
  
  // Fix Games Page Cache
  window.FixGamesPageCache = {
    get() {
      // Check memory cache first
      if (memoryCache.fixGames) {
        return memoryCache.fixGames;
      }
      
      // Check localStorage cache
      if (isCacheValid(CACHE_KEYS.FIX_GAMES_META)) {
        const data = loadCache(CACHE_KEYS.FIX_GAMES_DATA);
        if (data) {
          memoryCache.fixGames = data;
          return data;
        }
      }
      
      return null;
    },
    
    set(fixGamesData, filteredFixGames) {
      const cacheData = {
        fixGamesData: fixGamesData,
        filteredFixGames: filteredFixGames,
        timestamp: Date.now()
      };
      
      // Save to memory
      memoryCache.fixGames = cacheData;
      
      // Save to localStorage
      saveCache(CACHE_KEYS.FIX_GAMES_DATA, CACHE_KEYS.FIX_GAMES_META, cacheData);
    },
    
    clear() {
      memoryCache.fixGames = null;
      clearCache(CACHE_KEYS.FIX_GAMES_DATA, CACHE_KEYS.FIX_GAMES_META);
    },
    
    isValid() {
      // Untuk data besar, hanya cek memory cache (localStorage tidak digunakan)
      if (memoryCache.fixGames) return true;
      
      // Cek meta untuk tahu apakah pernah load (tapi data hanya di memory)
      try {
        const metaRaw = localStorage.getItem(CACHE_KEYS.FIX_GAMES_META);
        if (metaRaw) {
          const meta = JSON.parse(metaRaw);
          if (meta && meta.timestamp) {
            const age = Date.now() - meta.timestamp;
            // Jika meta ada tapi data tidak di localStorage (inMemoryOnly), return false
            // karena data hilang setelah refresh (hanya di memory)
            return age < CACHE_TTL && !meta.inMemoryOnly;
          }
        }
      } catch (e) {}
      
      return false;
    }
  };
  
  // Library Page Cache (uses same data as Games but with library filter)
  window.LibraryPageCache = {
    get() {
      // Library uses same data as Games, but with filter applied
      return window.GamesPageCache.get();
    },
    
    set(originalData, filteredData) {
      // Library uses same cache as Games
      window.GamesPageCache.set(originalData, filteredData);
    },
    
    clear() {
      // Library uses same cache as Games
      window.GamesPageCache.clear();
    },
    
    isValid() {
      return window.GamesPageCache.isValid();
    }
  };
  
  // Clear all caches
  window.clearAllPageCaches = function() {
    window.GamesPageCache.clear();
    window.FixGamesPageCache.clear();
    memoryCache.games = null;
    memoryCache.fixGames = null;
    memoryCache.library = null;
  };
})();

