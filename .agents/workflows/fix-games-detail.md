---
description: Panduan develop Fix Games Detail - proses fix, shortcut, dan integrasi bridge C#
---

# Fix Games Detail — Developer Shortcut

## 📁 File Utama

| File | Path | Keterangan |
|------|------|-----------|
| HTML (UI) | `public/app/fix-games-detail.html` | Layout halaman detail |
| JS (logic) | `public/js/fix-games-detail.js` | Semua logic: fix, shortcut, steam account |
| JS (list page) | `public/js/fix-games.js` | Halaman daftar fix games |
| Data JSON | `fix_games.json` (GitHub) | Daftar game yang punya fix |
| Docs | `docs/FIX_GAMES_JSON_STRUCTURE.md` | Struktur JSON detail |
| C# Bridge | `desktop/GameHubDesktop/MainWindow.xaml.cs` | Handler semua message dari JS |
| Services | `desktop/GameHubDesktop/Services/` | FixGamesService.cs, dll |

---

## 🔄 Alur Fix Process (7 Steps)

```
startFixGameProcess()
│
├─ Step 1: checkAntivirus()
│   Bridge: FixGamesCheckAntivirus → FixGamesAntivirusCheck
│   → Jika ada 3rd party AV: tampilkan konfirmasi
│
├─ Step 2: detectGamePath()
│   Bridge: FixGamesDetectPath → FixGamesDetectPath
│   → Jika path tidak ditemukan: openManualPathModal()
│
├─ Step 3: autoExcludePath(gamePath)
│   Bridge: FixGamesAutoExclude → FixGamesAutoExclude
│   → Jika needsAdmin: alert run as admin
│
├─ Step 4: downloadFixFiles(progressCb)
│   Bridge: FixGamesDownload → FixGamesDownloadProgress / Complete / Error
│   Data: currentFixGame.files (array dari fix_games.json)
│
├─ Step 5: extractFiles(downloadPath, files, password, gamePath, progressCb)
│   Bridge: FixGamesExtract → FixGamesExtractProgress / Complete / Error
│   Password: currentFixGame.password
│
├─ Step 6: replaceFiles(gamePath, extractedPath, progressCb)
│   Bridge: FixGamesReplace → FixGamesReplaceProgress / Complete / Error
│
└─ Step 7: cleanupTempFiles(downloadPath, extractedPath)
    Bridge: FixGamesCleanup → FixGamesCleanupComplete / Error (non-fatal)
```

---

## 🔗 Alur Add Shortcut

```
startAddShortcutProcess()
│
├─ Step 1: detectGamePath() [sama dengan fix process]
├─ Step 2: scanGameExecutables(gamePath, gameName)
│   Bridge: FixGamesScanExecutables → FixGamesScanExecutables
│   Returns: [ { name, path, relativePath, size, iconBase64, recommended, similarityScore } ]
│
├─ Step 3: showExecutableSelectionDialog(executables, gameName)
│   → UI modal pilih exe, ada "Direkomendasikan" label
│
└─ Step 4: createDesktopShortcut(exePath, shortcutName, gamePath)
    Bridge: FixGamesCreateShortcut → FixGamesCreateShortcut
    shortcutName: `${gameName} - FIX`
```

---

## 🗂️ Struktur fix_games.json

```json
{
  "games": [{
    "appid": 1234567,
    "title":     "Assassin's Creed Valhalla",
    "publisher": "Ubisoft",
    "category":  "ubisoft",          // ubisoft | ea | rockstar | playstation | other
    "poster":    "https://...",       // Gambar 600x900
    "password":  "acv2024",
    "premium":   false,               // true → hanya license premium
    "aktivasi_offline": false,        // true → tampilkan warning offline activation
    "files": [{
      "part":      1,                 // WAJIB mulai dari 1
      "filename":  "acv_part1.rar",
      "gdrive_id": "abc123",
      "gdrive_url":"https://drive.google.com/uc?export=download&id=abc123"
    }]
  }]
}
```

---

## 🏛️ State Variables (Global di fix-games-detail.js)

```javascript
let currentFixGame   = null;   // Object game yg sedang dibuka (dari fix_games.json)
let currentAppId     = null;   // AppID game saat ini
let currentAccountId = null;   // Hanya untuk Steam Account category
let isProcessing     = false;  // Mencegah double-click tombol fix
```

---

## 🖥️ Elemen DOM Penting

| ID | Fungsi |
|----|--------|
| `fix-game-start-btn` | Tombol "Mulai Proses Fix" |
| `fix-game-add-shortcut-btn` | Tombol "Add Shortcut" |
| `fix-progress-container` | Container progress bar |
| `fix-progress-bar` | Bar progress |
| `fix-progress-text` | Teks keterangan progress |
| `fix-path-modal` | Modal manual path selection |
| `fix-detail-poster` | Gambar poster game |
| `fix-detail-title` | Judul game |
| `fix-detail-premium-badge` | Badge PREMIUM / STANDARD |
| `fix-important-info` | Section info penting (hidden di Steam Account) |
| `fix-action-button` | Section tombol aksi (hidden di Steam Account) |

---

## 🌉 Pattern Bridge JS→C# (Template)

```javascript
async function myBridgeFunction(params) {
  return new Promise((resolve, reject) => {
    if (!window.desktopBridge || typeof window.desktopBridge.send !== 'function') {
      // Fallback untuk testing (tanpa app)
      resolve({ success: true, data: 'mock' });
      return;
    }

    const timeout = setTimeout(() => {
      window.desktopBridge.offMessage(handler);
      reject(new Error('Timeout'));
    }, 30000);

    const handler = (data) => {
      try {
        const msg = typeof data === 'string' ? JSON.parse(data) : data;
        if (msg?.type === 'MyResponseType') {
          clearTimeout(timeout);
          window.desktopBridge.offMessage(handler);
          if (!msg.success) {
            reject(new Error(msg.error || 'Gagal'));
            return;
          }
          resolve(msg);
        }
      } catch (e) { /* ignore */ }
    };

    window.desktopBridge.onMessage(handler);
    window.desktopBridge.send('MyCommandType', { ...params });
  });
}
```

---

## 📡 Bridge Messages Fix Games (Semua)

| JS sends | C# responds | Keterangan |
|---------|-------------|-----------|
| `FixGamesCheckAntivirus` | `FixGamesAntivirusCheck` | Cek AV |
| `FixGamesDetectPath` | `FixGamesDetectPath` | Deteksi install path |
| `FixGamesAutoExclude` | `FixGamesAutoExclude` | Tambah ke WD exclusion |
| `FixGamesDownload` | `FixGamesDownloadProgress/Complete/Error` | Download file fix |
| `FixGamesExtract` | `FixGamesExtractProgress/Complete/Error` | Extract RAR |
| `FixGamesReplace` | `FixGamesReplaceProgress/Complete/Error` | Copy file ke game folder |
| `FixGamesCleanup` | `FixGamesCleanupComplete/Error` | Hapus temp files |
| `FixGamesScanExecutables` | `FixGamesScanExecutables` | Scan .exe files |
| `FixGamesSelectManualPath` | `FixGamesManualPathSelected` | Browse folder dialog |
| `FixGamesCreateShortcut` | `FixGamesCreateShortcut` | Buat shortcut desktop |
| `GetSteamGuardCode` | `SteamGuardCodeResult` | Ambil kode Steam Guard dari email |

---

## 🚀 Cara Navigate ke Detail Page

```javascript
// Dari fix-games.js atau halaman lain:
navigate('fix-games-detail', { appid: 12345, isSteamAccount: false });
navigate('fix-games-detail', { appid: 12345, isSteamAccount: true, accountId: 'acc-001' });
```

## Cara Init (dipanggil oleh router.js):
```javascript
// Dipanggil otomatis saat navigate ke 'fix-games-detail'
window.initFixGameDetailPage(appid, isSteamAccount, accountId);
```

---

## 💡 Tips Development

1. **Testing tanpa app:** Semua fungsi bridge punya fallback mock data kalau `window.desktopBridge` tidak tersedia
2. **Progress bar:** Gunakan `updateProgress(percent 0-100, 'teks')` untuk update UI
3. **Error handling:** Gunakan `premiumAlert(msg, title)` jika tersedia, fallback ke `alert()`
4. **Premium check:** Periksa `currentFixGame.premium === true` untuk unlock only premium
5. **Category handling:** `renderFixGameDetail()` untuk normal; `renderSteamAccountDetail()` untuk Steam Account
6. **Tambah field JSON:** Cukup tambahkan field baru di `fix_games.json` dan akses via `currentFixGame.fieldBaru`
