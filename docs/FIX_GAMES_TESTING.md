# Dokumentasi Testing Fix Games Feature

## Overview
Fitur Fix Games memiliki 6 step utama yang perlu diuji secara terpisah untuk memastikan semua berfungsi dengan baik.

## Step-by-Step Testing

### Step 1: Check Antivirus ✅

**Tujuan:** Memeriksa apakah user menggunakan antivirus selain Windows Defender.

**Cara Uji:**
1. Buka aplikasi GameHub Desktop
2. Navigate ke "Fix Games" → Pilih game → Klik "Mulai Proses Fix"
3. **Expected Result:**
   - Jika hanya Windows Defender: Process lanjut ke step berikutnya
   - Jika ada antivirus lain (McAfee, Norton, dll): Muncul error popup dengan pesan untuk uninstall antivirus lain

**Test Cases:**
- ✅ Test dengan hanya Windows Defender aktif
- ✅ Test dengan antivirus lain terinstall (McAfee, Norton, Kaspersky, dll)
- ✅ Test dengan Windows Defender + antivirus lain (harus error)

**Cek Log:**
- Buka App Log di aplikasi
- Cari log: `[FixGamesService] Memeriksa antivirus yang terinstall...`
- Cek apakah antivirus terdeteksi dengan benar

---

### Step 2: Auto-Exclude from Windows Defender ✅

**Tujuan:** Menambahkan folder game ke Windows Defender exclusion list secara otomatis.

**Cara Uji:**
1. Pastikan Windows Defender aktif
2. Jalankan proses fix sampai step "Menambahkan ke exclusion list..."
3. **Expected Result:**
   - Folder game berhasil ditambahkan ke exclusion list
   - Process lanjut ke step berikutnya

**Test Cases:**
- ✅ Test dengan aplikasi dijalankan sebagai Administrator (harus berhasil)
- ✅ Test dengan aplikasi tanpa Administrator (mungkin gagal, harus ada error message)
- ✅ Verifikasi di Windows Security → Virus & threat protection → Manage settings → Exclusions

**Cek Log:**
- Cari log: `[FixGamesService] Menambahkan path ke Windows Defender exclusion: [nama_folder]`
- Cek apakah path berhasil ditambahkan

**Manual Verification:**
1. Buka Windows Security
2. Virus & threat protection → Manage settings
3. Scroll ke Exclusions → Add or remove exclusions
4. Pastikan path game ada di list

---

### Step 3: Detect Game Path ✅

**Tujuan:** Mencari lokasi instalasi game secara otomatis via Steam VDF files.

**Cara Uji:**
1. Pastikan game sudah terinstall di Steam
2. Jalankan proses fix sampai step "Mencari lokasi instalasi game..."
3. **Expected Result:**
   - Jika ditemukan via VDF: Path game ditemukan, process lanjut
   - Jika tidak ditemukan: Muncul error untuk manual selection (akan diimplementasikan nanti)

**Test Cases:**
- ✅ Test dengan game yang terinstall di default Steam folder
- ✅ Test dengan game yang terinstall di library folder lain
- ✅ Test dengan game yang tidak terinstall (harus error)

**Cek Log:**
- Cari log: `[FixGamesService] Mencari path instalasi game: [nama_game] (AppID: [appid])`
- Cek apakah path ditemukan atau tidak

**Manual Verification:**
- Path yang ditemukan harus sesuai dengan lokasi game di Steam
- Path harus dalam format: `[steam_library]/steamapps/common/[game_folder]`

---

### Step 4: Download Files ✅

**Tujuan:** Download file fix dari Google Drive public links.

**Cara Uji:**
1. Pilih game yang memiliki file fix
2. Jalankan proses fix sampai step "Mengunduh file fix..."
3. **Expected Result:**
   - Progress bar menunjukkan progress download (40% - 70%)
   - File berhasil di-download ke temp folder
   - Jika rate limit: Muncul error message yang jelas

**Test Cases:**
- ✅ Test dengan single file (1 part)
- ✅ Test dengan multi-part files (2+ parts)
- ✅ Test dengan rate limit (harus ada retry dan error message)
- ✅ Test dengan file yang sudah pernah di-download (harus skip)

**Cek Log:**
- Cari log: `[FixGamesService] Memulai download files untuk AppID: [appid]`
- Cek progress: `Downloading: [filename] (1/2)`
- Cek completion: `Download selesai: [filename]`

**Manual Verification:**
- File harus ada di: `%TEMP%\GameHubFixGames\appid_[appid]\`
- File size harus sesuai (tidak 0 bytes)
- Semua part harus ter-download

---

### Step 5: Extract Files ⚠️ (TODO)

**Tujuan:** Mengekstrak file RAR (single/multi-part) dengan password.

**Status:** Belum diimplementasikan (TODO)

**Cara Uji (Setelah Implementasi):**
1. Pastikan file sudah ter-download
2. Jalankan proses fix sampai step "Mengekstrak file..."
3. **Expected Result:**
   - Progress bar menunjukkan progress extract (70% - 85%)
   - File berhasil di-extract dengan password yang benar
   - Multi-part RAR berhasil digabungkan

**Test Cases:**
- ✅ Test dengan single RAR file
- ✅ Test dengan multi-part RAR files
- ✅ Test dengan password yang benar
- ✅ Test dengan password yang salah (harus error)

**Library yang Diperlukan:**
- SharpCompress atau unrar.dll untuk extract RAR

---

### Step 6: Replace Files ⚠️ (TODO)

**Tujuan:** Mengganti file di folder game dengan file yang sudah di-extract.

**Status:** Belum diimplementasikan (TODO)

**Cara Uji (Setelah Implementasi):**
1. Pastikan file sudah di-extract
2. Jalankan proses fix sampai step "Mengganti file game..."
3. **Expected Result:**
   - Progress bar menunjukkan progress replace (85% - 100%)
   - Semua file berhasil di-replace di folder game
   - File lama di-backup (optional)

**Test Cases:**
- ✅ Test dengan file yang sudah ada (harus di-replace)
- ✅ Test dengan file baru (harus di-copy)
- ✅ Test dengan permission error (harus ada error message)
- ✅ Test dengan disk space tidak cukup (harus ada error message)

---

## Testing Checklist

### Pre-Testing Setup
- [ ] Aplikasi di-build tanpa error
- [ ] License sudah diaktivasi (premium untuk test premium games)
- [ ] Windows Defender aktif
- [ ] Game test sudah terinstall di Steam

### Step 1: Check Antivirus
- [ ] Test dengan Windows Defender saja
- [ ] Test dengan antivirus lain terinstall
- [ ] Error message muncul dengan benar

### Step 2: Auto-Exclude
- [ ] Test dengan Administrator
- [ ] Test tanpa Administrator
- [ ] Path berhasil ditambahkan ke exclusion list

### Step 3: Detect Path
- [ ] Path ditemukan via VDF
- [ ] Path tidak ditemukan (error message)
- [ ] Path yang ditemukan benar

### Step 4: Download
- [ ] Single file download
- [ ] Multi-part download
- [ ] Rate limit handling
- [ ] Retry mechanism

### Step 5: Extract (TODO)
- [ ] Single RAR extract
- [ ] Multi-part RAR extract
- [ ] Password handling

### Step 6: Replace (TODO)
- [ ] File replacement
- [ ] Error handling

---

## Error Handling Testing

### Rate Limit
1. Test dengan download yang terkena rate limit
2. **Expected:** Error message: "Rate limit tercapai. Silakan coba lagi nanti atau hubungi admin."

### Network Error
1. Test dengan internet terputus saat download
2. **Expected:** Retry mechanism aktif, atau error message yang jelas

### Permission Error
1. Test dengan folder game yang tidak bisa di-write
2. **Expected:** Error message yang jelas tentang permission

---

## Progress Reporting

Setiap step harus mengirim progress update ke frontend:
- **Step 1 (Check Antivirus):** 0% - 10%
- **Step 2 (Detect Path):** 10% - 20%
- **Step 3 (Auto-Exclude):** 20% - 30%
- **Step 4 (Download):** 30% - 70%
- **Step 5 (Extract):** 70% - 85%
- **Step 6 (Replace):** 85% - 100%

---

## Notes

- Semua step berjalan di background (tidak blocking UI)
- Progress bar di UI menunjukkan overall progress
- Error message harus jelas dan actionable
- Log harus detail untuk debugging

