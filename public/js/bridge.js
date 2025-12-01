(function(){
  // Bridge for WebView2 desktop messaging
  const hasWebView = !!(window.chrome && window.chrome.webview);
  const api = {
    send(action, payload = {}) {
      try {
        if (hasWebView && window.chrome.webview.postMessage) {
          window.chrome.webview.postMessage({ action, payload });
        }
      } catch (e) {
        // silent
      }
    },
    onMessage(handler) {
      if (!hasWebView) return;
      try {
        window.chrome.webview.addEventListener('message', (evt) => {
          handler?.(evt?.data);
        });
      } catch (e) {
        // silent
      }
    },
    // Get raw dataset from C# (cached on disk)
    async getRawDataset(forceRefresh = false, progressCallback = null) {
      return new Promise((resolve, reject) => {
        if (!hasWebView) {
          reject(new Error('WebView2 not available'));
          return;
        }
        const timeout = setTimeout(() => {
          reject(new Error('getRawDataset timeout'));
        }, 300000); // 5 minutes timeout for large dataset
        
        let resolved = false;
        const handler = (evt) => {
          try {
            const msg = evt?.data || evt;
            const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
            
            if (data?.type === 'RawDatasetProgress') {
              if (progressCallback && typeof progressCallback === 'function') {
                try {
                  progressCallback(data.percent || 0, data.message || null);
                } catch (e) {}
              }
            } else if (data?.type === 'RawDataset') {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                try {
                  window.chrome.webview.removeEventListener('message', handler);
                } catch (e) {}
                resolve(data.data);
              }
            }
          } catch (e) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              try {
                window.chrome.webview.removeEventListener('message', handler);
              } catch (err) {}
              reject(e);
            }
          }
        };
        
        window.chrome.webview.addEventListener('message', handler);
        api.send('GetRawDataset', { forceRefresh });
      });
    },
    // Get metadata for specific appid from C#
    async getMetadataForAppid(appid) {
      return new Promise((resolve, reject) => {
        if (!hasWebView) {
          reject(new Error('WebView2 not available'));
          return;
        }
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            try {
              window.chrome.webview.removeEventListener('message', handler);
            } catch (e) {}
            reject(new Error('getMetadataForAppid timeout'));
          }
        }, 60000);
        
        const handler = (evt) => {
          try {
            const msg = evt?.data || evt;
            const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
            
            if (data?.type === 'MetadataForAppid' && String(data.appid) === String(appid)) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                try {
                  window.chrome.webview.removeEventListener('message', handler);
                } catch (e) {}
                resolve(data.data);
              }
            }
          } catch (e) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              try {
                window.chrome.webview.removeEventListener('message', handler);
              } catch (err) {}
              reject(e);
            }
          }
        };
        
        window.chrome.webview.addEventListener('message', handler);
        api.send('GetMetadataForAppid', { appid: String(appid) });
      });
    },
    // Clear all cache (disk + localStorage)
    async clearAllCache() {
      return new Promise((resolve, reject) => {
        if (!hasWebView) {
          reject(new Error('WebView2 not available'));
          return;
        }
        
        // Initialize resolver queue if not exists
        if (!window._clearAllCacheResolvers) {
          window._clearAllCacheResolvers = [];
        }
        
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            // Cleanup resolver from queue
            if (window._clearAllCacheResolvers) {
              const idx = window._clearAllCacheResolvers.findIndex(r => r === resolve);
              if (idx >= 0) {
                window._clearAllCacheResolvers.splice(idx, 1);
              }
            }
            reject(new Error('clearAllCache timeout'));
          }
        }, 15000); // Increased timeout to 15 seconds
        
        const resolver = (data) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            // Remove from queue
            if (window._clearAllCacheResolvers) {
              const idx = window._clearAllCacheResolvers.findIndex(r => r === resolve);
              if (idx >= 0) window._clearAllCacheResolvers.splice(idx, 1);
            }
            resolve(data);
          }
        };
        
        window._clearAllCacheResolvers.push(resolver);
        api.send('ClearAllCache', {});
      });
    },
    // Get global override data (from GitHub, cached on disk)
    async getGlobalOverride(forceRefresh = false) {
      return new Promise((resolve, reject) => {
        if (!hasWebView) {
          reject(new Error('WebView2 not available'));
          return;
        }
        const timeout = setTimeout(() => {
          reject(new Error('getGlobalOverride timeout'));
        }, 30000);
        
        let resolved = false;
        const handler = (evt) => {
          try {
            const msg = evt?.data || evt;
            const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
            
            if (data?.type === 'GlobalOverride') {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                try {
                  window.chrome.webview.removeEventListener('message', handler);
                } catch (e) {}
                resolve(data.data);
              }
            }
          } catch (e) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              try {
                window.chrome.webview.removeEventListener('message', handler);
              } catch (err) {}
              reject(e);
            }
          }
        };
        
        window.chrome.webview.addEventListener('message', handler);
        api.send('GetGlobalOverride', { forceRefresh });
      });
    },
    // Get user-specific override (from local file)
    async getUserOverride() {
      return new Promise((resolve, reject) => {
        if (!hasWebView) {
          reject(new Error('WebView2 not available'));
          return;
        }
        const timeout = setTimeout(() => {
          reject(new Error('getUserOverride timeout'));
        }, 5000);
        
        let resolved = false;
        const handler = (evt) => {
          try {
            const msg = evt?.data || evt;
            const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
            
            if (data?.type === 'UserOverride') {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                try {
                  window.chrome.webview.removeEventListener('message', handler);
                } catch (e) {}
                resolve(data.data);
              }
            }
          } catch (e) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              try {
                window.chrome.webview.removeEventListener('message', handler);
              } catch (err) {}
              reject(e);
            }
          }
        };
        
        window.chrome.webview.addEventListener('message', handler);
        api.send('GetUserOverride', {});
      });
    },
    // Get list of AppIDs from installed games (from steam\config\stplug-in\*.lua files)
    async getLibraryAppIds() {
      return new Promise((resolve, reject) => {
        if (!hasWebView) {
          reject(new Error('WebView2 not available'));
          return;
        }
        const timeout = setTimeout(() => {
          reject(new Error('getLibraryAppIds timeout'));
        }, 10000);
        
        let resolved = false;
        const handler = (evt) => {
          try {
            const msg = evt?.data || evt;
            const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
            
            if (data?.type === 'LibraryAppIds') {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                try {
                  window.chrome.webview.removeEventListener('message', handler);
                } catch (e) {}
                resolve(data.appids || []);
              }
            }
          } catch (e) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              try {
                window.chrome.webview.removeEventListener('message', handler);
              } catch (err) {}
              reject(e);
            }
          }
        };
        
        window.chrome.webview.addEventListener('message', handler);
        api.send('GetLibraryAppIds', {});
      });
    },
    // Check for override data update
    async checkOverrideUpdate() {
      return new Promise((resolve, reject) => {
        if (!hasWebView) {
          reject(new Error('WebView2 not available'));
          return;
        }
        const timeout = setTimeout(() => {
          reject(new Error('checkOverrideUpdate timeout'));
        }, 15000);
        
        let resolved = false;
        const handler = (evt) => {
          try {
            const msg = evt?.data || evt;
            const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
            
            if (data?.type === 'OverrideUpdateCheck') {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                try {
                  window.chrome.webview.removeEventListener('message', handler);
                } catch (e) {}
                resolve(data);
              }
            }
          } catch (e) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              try {
                window.chrome.webview.removeEventListener('message', handler);
              } catch (err) {}
              reject(e);
            }
          }
        };
        
        window.chrome.webview.addEventListener('message', handler);
        api.send('CheckOverrideUpdate', {});
      });
    },
    // Force update override data
    async forceUpdateOverride() {
      return new Promise((resolve, reject) => {
        if (!hasWebView) {
          reject(new Error('WebView2 not available'));
          return;
        }
        const timeout = setTimeout(() => {
          reject(new Error('forceUpdateOverride timeout'));
        }, 30000);
        
        let resolved = false;
        const handler = (evt) => {
          try {
            const msg = evt?.data || evt;
            const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
            
            if (data?.type === 'OverrideUpdateResult') {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                try {
                  window.chrome.webview.removeEventListener('message', handler);
                } catch (e) {}
                resolve(data);
              }
            }
          } catch (e) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              try {
                window.chrome.webview.removeEventListener('message', handler);
              } catch (err) {}
              reject(e);
            }
          }
        };
        
        window.chrome.webview.addEventListener('message', handler);
        api.send('ForceUpdateOverride', {});
      });
    },
    // Get license info
    async getLicenseInfo() {
      return new Promise((resolve, reject) => {
        if (!hasWebView) {
          reject(new Error('WebView2 not available'));
          return;
        }
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            try {
              window.chrome.webview.removeEventListener('message', handler);
            } catch (e) {}
            reject(new Error('getLicenseInfo timeout'));
          }
        }, 10000);
        
        const handler = (evt) => {
          try {
            const msg = evt?.data || evt;
            const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
            
            if (data?.type === 'LicenseInfo') {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                try {
                  window.chrome.webview.removeEventListener('message', handler);
                } catch (e) {}
                resolve({
                  plan: data.plan || 'standard',
                  isActive: data.isActive || false,
                  isValid: data.isValid || false,
                  licenseKey: data.licenseKey || '',
                  deviceId: data.deviceId || '',
                  errorMessage: data.errorMessage || ''
                });
              }
            }
          } catch (e) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              try {
                window.chrome.webview.removeEventListener('message', handler);
              } catch (err) {}
              reject(e);
            }
          }
        };
        
        window.chrome.webview.addEventListener('message', handler);
        api.send('GetLicenseInfo', {});
      });
    }
  };

  window.desktopBridge = api;
})();
