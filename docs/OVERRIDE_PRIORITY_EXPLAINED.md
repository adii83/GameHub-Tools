# Penjelasan Prioritas Override Data

## 🎯 Prioritas (dari tertinggi ke terendah)

```
1. User Override      (user_override_data.json)     ← PRIORITAS TERTINGGI
2. Global Override    (override_data.json dari GitHub)
3. Built-in Override (local_data_steam.json)
4. Raw Data          (steam_data.json dari GitHub)  ← PRIORITAS TERENDAH
```

## 📋 Fungsi Masing-Masing Layer

### 1. **Raw Data** (`steam_data.json` dari GitHub)
- **Fungsi:** Data utama, sumber kebenaran
- **Update:** Via repository GitHub
- **Size:** Besar (MB)
- **TTL:** 12 jam

### 2. **Built-in Override** (`local_data_steam.json` di app bundle)
- **Fungsi:** 
  - Override default yang dibundel dengan aplikasi
  - Data yang HARUS ada di setiap install
  - Contoh: Fix critical bugs, default values
- **Update:** Via aplikasi update/install
- **Size:** Kecil (KB)
- **Bisa dihapus?** ✅ YA, tidak apa-apa jika sudah pakai Global Override

### 3. **Global Override** (`override_data.json` dari GitHub)
- **Fungsi:**
  - Override yang di-sync ke semua user
  - Fix data yang salah di raw
  - Tambah game baru
  - Update protection status
- **Update:** Auto-sync dari GitHub setiap 6 jam
- **Size:** Kecil (KB)
- **TTL:** 6 jam

### 4. **User Override** (`user_override_data.json` di %AppData%)
- **Fungsi:**
  - Override user-specific
  - Testing personal
  - Kustomisasi per-user
- **Update:** Manual edit oleh user
- **Size:** Kecil (KB)
- **Tidak pernah di-overwrite** oleh aplikasi

## ✅ Bisa Menambah Game Baru?

**YA!** Bisa di semua layer override (kecuali Raw Data).

### Format (sama seperti `local_data_steam.json`):

```json
{
  "1234567": {
    "appid": 1234567,
    "title": "Game Baru Saya",
    "header": "https://...",
    "genre": "Action, Adventure",
    "short_description": "Deskripsi game",
    "developers": ["Dev Studio"],
    "publishers": ["Pub Studio"],
    "release_date": "1 Dec, 2025",
    "price_display": "Rp 100.000",
    "price_normalized": 100000,
    "protection": null,
    "last_update": "2025-11-30T12:00:00.000Z"
  }
}
```

### Di mana menambah?

1. **Global Override** (`override_data.json` di GitHub)
   - ✅ Semua user dapat otomatis
   - ✅ Auto-sync setiap 6 jam
   - ✅ Recommended untuk game baru yang penting

2. **User Override** (`user_override_data.json`)
   - ✅ User-specific
   - ✅ Testing personal
   - ✅ Tidak di-sync

3. **Built-in Override** (`local_data_steam.json`)
   - ✅ Dibundel dengan aplikasi
   - ❌ Perlu update aplikasi untuk update data
   - ⚠️ Tidak recommended (lebih baik pakai Global Override)

## 🔄 Contoh Merge Process

### Scenario 1: Game ada di Raw Data
```
Raw Data: { "3949040": { "protection": true } }
Built-in: { "3949040": { "protection": null } }
Global:   { "3949040": { "protection": false } }
User:     { "3949040": { "protection": null } }

Result: { "3949040": { "protection": null } }  ← User override wins
```

### Scenario 2: Game baru (tidak ada di Raw Data)
```
Raw Data: (tidak ada)
Built-in: (tidak ada)
Global:   { "9999999": { "title": "Game Baru" } }
User:     (tidak ada)

Result: { "9999999": { "title": "Game Baru" } }  ← Game baru ditambahkan
```

### Scenario 3: Hapus local_data_steam.json
```
Raw Data: { "3949040": { "protection": true } }
Built-in: (file dihapus, tidak ada)
Global:   { "3949040": { "protection": null } }
User:     (tidak ada)

Result: { "3949040": { "protection": null } }  ← Global override wins
✅ Tidak apa-apa, aplikasi tetap berfungsi
```

## 💡 Rekomendasi Setup

### Opsi 1: Pakai Raw + Global Override saja (RECOMMENDED)
```
✅ Raw Data (steam_data.json)
✅ Global Override (override_data.json)
❌ Built-in Override (local_data_steam.json) - HAPUS
❌ User Override (opsional, untuk testing)
```

**Keuntungan:**
- Simple, hanya 2 layer
- Update data via GitHub (tidak perlu update aplikasi)
- Auto-sync untuk semua user

### Opsi 2: Pakai semua layer
```
✅ Raw Data
✅ Built-in Override (untuk critical fixes)
✅ Global Override (untuk regular updates)
✅ User Override (untuk testing)
```

**Keuntungan:**
- Fleksibel
- Built-in untuk data yang harus ada di setiap install

## 🎯 Kesimpulan

1. **Bisa menambah game baru?** ✅ YA, di Global Override atau User Override
2. **Fungsi local_data_steam.json?** Default override yang dibundel, bisa dihapus jika pakai Global Override
3. **Prioritas?** User > Global > Built-in > Raw
4. **Hapus local_data_steam.json?** ✅ YA, tidak apa-apa
5. **Pakai Raw + Override saja?** ✅ YA, recommended!

