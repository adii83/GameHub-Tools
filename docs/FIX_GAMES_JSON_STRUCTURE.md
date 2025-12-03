# Struktur JSON Fix Games (Sederhana)

## Format JSON

```json
{
  "games": [
    {
      "appid": 1234567,
      "title": "Assassin's Creed Valhalla",
      "publisher": "Ubisoft",
      "category": "ubisoft",
      "poster": "https://example.com/poster-600x900.jpg",
      "password": "password_game_ini",
      "premium": false,
      "files": [
        {
          "part": 1,
          "filename": "acv_fix_part1.rar",
          "gdrive_id": "1a2b3c4d5e6f7g8h9i0j",
          "gdrive_url": "https://drive.google.com/uc?export=download&id=1a2b3c4d5e6f7g8h9i0j"
        },
        {
          "part": 2,
          "filename": "acv_fix_part2.rar",
          "gdrive_id": "2b3c4d5e6f7g8h9i0j1k",
          "gdrive_url": "https://drive.google.com/uc?export=download&id=2b3c4d5e6f7g8h9i0j1k"
        }
      ]
    },
    {
      "appid": 7654321,
      "title": "FIFA 24",
      "publisher": "EA",
      "category": "ea",
      "poster": "https://example.com/fifa24-poster-600x900.jpg",
      "password": "password_fifa24",
      "premium": false,
      "files": [
        {
          "part": 1,
          "filename": "fifa24_fix.rar",
          "gdrive_id": "3c4d5e6f7g8h9i0j1k2l",
          "gdrive_url": "https://drive.google.com/uc?export=download&id=3c4d5e6f7g8h9i0j1k2l"
        }
      ]
    }
  ]
}
```

## Aturan:

1. **Password**: Per-game (di dalam object game)
2. **Poster**: Link ke gambar poster ukuran 600x900 (wajib diisi)
3. **Premium**: `true` atau `false` (optional, default `false`). Jika `true`, hanya license premium yang bisa akses
4. **Part**: **WAJIB** untuk semua file (single atau multi-part). Single file tetap pakai `"part": 1`, multi-part pakai `"part": 1, 2, 3, dst.`
5. **install_hint**: **TIDAK PERLU** di JSON. Program akan generate otomatis: `"Biasanya terinstall di instalasi_game/steamapps/common/[nama_game]"`
6. **Category**: `ubisoft`, `ea`, `rockstar`, `playstation`, `other`

## Contoh Lengkap:

### Multi-part (beberapa part):
```json
{
  "appid": 1234567,
  "title": "Assassin's Creed Valhalla",
  "publisher": "Ubisoft",
  "category": "ubisoft",
  "poster": "https://example.com/acv-poster-600x900.jpg",
  "password": "acv2024",
  "files": [
    { "part": 1, "filename": "acv_part1.rar", "gdrive_id": "abc123", "gdrive_url": "https://drive.google.com/uc?export=download&id=abc123" },
    { "part": 2, "filename": "acv_part2.rar", "gdrive_id": "def456", "gdrive_url": "https://drive.google.com/uc?export=download&id=def456" }
  ]
}
```

### Single file (tetap pakai part: 1):
```json
{
  "appid": 7654321,
  "title": "FIFA 24",
  "publisher": "EA",
  "category": "ea",
  "poster": "https://example.com/fifa24-poster-600x900.jpg",
  "password": "fifa2024",
  "files": [
    { "part": 1, "filename": "fifa24_fix.rar", "gdrive_id": "xyz789", "gdrive_url": "https://drive.google.com/uc?export=download&id=xyz789" }
  ]
}
```

**Catatan Penting:**
- **install_hint TIDAK PERLU** di JSON, program akan generate otomatis
- **part WAJIB** untuk semua file (single atau multi-part), selalu mulai dari `"part": 1`
- **premium**: Optional (default `false`). Jika `true`, hanya license premium yang bisa akses. License standard akan melihat popup "Upgrade Ke Premium Dulu, Ya, Untuk Buka Fitur Ini 😁"

