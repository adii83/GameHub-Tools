# Sistem Override Data - Auto-Sync untuk Semua User

## 📋 Overview

Sistem ini memungkinkan sinkronisasi otomatis data override (koreksi/kustomisasi) ke semua user aplikasi desktop, dengan tetap memungkinkan override lokal per-user.

## 🏗️ Arsitektur

### 3 Layer Priority (dari terendah ke tertinggi):

1. **Built-in Override** (`public/data/local_data_steam.json`)
   - Override yang dibundel dengan aplikasi
   - Update via aplikasi update/install

2. **Global Override** (dari GitHub, auto-sync)
   - File: `override_data.json` di repository GitHub
   - Auto-download setiap 6 jam
   - Sinkron untuk semua user
   - URL: `https://raw.githubusercontent.com/adii83/steam-metadata-archive/refs/heads/main/override_data.json`

3. **User Override** (lokal per-user)
   - File: `%AppData%\GameHub\user_override_data.json`
   - Prioritas tertinggi
   - User-specific, tidak di-sync

### Priority Merge Order:
```
User Override > Global Override > Built-in Override > Raw Data
```

## 📁 File Structure

### Di Repository GitHub:
```
steam-metadata-archive/
├── main/
│   ├── steam_data.json          # Raw data utama
│   └── override_data.json       # Global override (baru!)
```

### Di User's Disk:
```
%AppData%\GameHub\
├── github_raw_full.json         # Raw data cache
├── override_data.json           # Global override cache
├── override_data_meta.json      # Metadata cache
└── user_override_data.json      # User-specific override
```

## 🔄 Cara Kerja

### 1. Global Override (Auto-Sync)

**C# Service:** `OverrideDataService.cs`
- Download dari GitHub setiap 6 jam (TTL lebih pendek dari raw data)
- Cache di disk untuk offline access
- Auto-update saat aplikasi start atau saat diperlukan

**Flow:**
```
App Start → Check Cache → 
  ├─ Valid (< 6 jam) → Load from disk
  └─ Expired → Download from GitHub → Save to disk
```

### 2. User Override (Local)

**File:** `%AppData%\GameHub\user_override_data.json`
- User bisa edit manual
- Tidak pernah di-overwrite oleh aplikasi
- Prioritas tertinggi

### 3. Merge Process

**JavaScript:** `render.js` → `loadLocalSteamData()`

```javascript
1. Load built-in local_data_steam.json
2. Load global override (via bridge)
3. Load user override (via bridge)
4. Merge dengan priority: User > Global > Built-in
```

## 📝 Format Data

### Override File Format:
```json
{
  "APPID": {
    "appid": APPID,
    "title": "Nama Game (optional)",
    "protection": true/false/null,
    "price_display": "Rp XXX.XXX",
    "price_normalized": 123456,
    // ... field lainnya
  }
}
```

### Contoh `override_data.json` di GitHub:
```json
{
  "3949040": {
    "appid": 3949040,
    "protection": null
  },
  "1234567": {
    "appid": 1234567,
    "title": "Game Baru",
    "protection": true
  }
}
```

## 🚀 Setup untuk Production

### 1. Buat File `override_data.json` di GitHub

Di repository `steam-metadata-archive`, buat file:
```
main/override_data.json
```

Isi dengan override data yang ingin di-sync ke semua user.

### 2. Update URL di `OverrideDataService.cs`

Pastikan URL sesuai dengan repository Anda:
```csharp
private const string OVERRIDE_DATA_URL = "https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/refs/heads/main/override_data.json";
```

### 3. Deploy Aplikasi

Aplikasi akan otomatis:
- Download override data saat pertama kali run
- Auto-update setiap 6 jam
- Merge dengan user override (jika ada)

## 💡 Use Cases

### Use Case 1: Fix Protection Data
**Masalah:** Raw data salah, `protection: true` padahal seharusnya `null`

**Solusi:**
1. Tambahkan ke `override_data.json` di GitHub:
```json
{
  "3949040": {
    "appid": 3949040,
    "protection": null
  }
}
```
2. Commit & push ke GitHub
3. Semua user akan otomatis dapat update dalam 6 jam

### Use Case 2: Tambah Game Baru
**Masalah:** Game baru belum ada di raw data

**Solusi:**
1. Tambahkan ke `override_data.json`:
```json
{
  "9999999": {
    "appid": 9999999,
    "title": "Game Baru",
    "header": "https://...",
    "genre": "Action",
    "protection": null
  }
}
```
2. Semua user akan dapat game baru otomatis

### Use Case 3: User-Specific Override
**Masalah:** User ingin override sendiri untuk testing

**Solusi:**
1. Edit `%AppData%\GameHub\user_override_data.json`
2. User override akan selalu prioritas tertinggi
3. Tidak akan di-overwrite oleh global override

## 🔧 Maintenance

### Update Override Data:
1. Edit `override_data.json` di GitHub
2. Commit & push
3. User akan auto-update dalam 6 jam
4. Atau user bisa force refresh (jika ada fitur)

### Clear Override Cache:
- Clear cache akan menghapus global override cache
- User override tetap aman (tidak terhapus)

## 📊 Performance

- **TTL Global Override:** 6 jam (lebih sering update dari raw data)
- **Cache Size:** Kecil (~KB), tidak seperti raw data (MB)
- **Download Time:** < 1 detik (file kecil)
- **Merge Time:** < 10ms (in-memory merge)

## ✅ Benefits

1. **Auto-Sync:** Semua user selalu dapat update terbaru
2. **Flexible:** User masih bisa override sendiri
3. **Fast:** Cache di disk, tidak perlu download setiap kali
4. **Reliable:** Fallback ke stale cache jika download gagal
5. **Maintainable:** Update sekali di GitHub, semua user dapat

## 🎯 Best Practices

1. **Gunakan Global Override untuk:**
   - Fix data yang salah di raw
   - Tambah game baru yang penting
   - Update protection status

2. **Gunakan User Override untuk:**
   - Testing personal
   - Kustomisasi user-specific
   - Temporary fixes

3. **Jangan:**
   - Taruh data besar di override (gunakan raw data)
   - Override semua field (hanya field yang perlu)
   - Update terlalu sering (minimal 1x per hari)

