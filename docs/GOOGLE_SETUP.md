# GOOGLE & FIREBASE CONFIGURATION GUIDE
## GMAHK Galilea Digital Archive

Dokumen panduan integrasi ekosistem Google untuk GMAHK Galilea Digital Archive.

### Koneksi utama production: User OAuth

Untuk penyimpanan My Drive, backend menggunakan `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, dan `GOOGLE_DRIVE_REFRESH_TOKEN`. Konfigurasi service
account di bawah hanya merupakan fallback eksplisit, bukan pengganti token
OAuth yang kedaluwarsa.

Jika API mengembalikan `503` / `DRIVE_AUTH_ERROR`:

1. Buka Google Auth Platform → Audience pada project pemilik OAuth client.
   Jika aplikasi External masih berstatus Testing, ubah ke In production.
2. Otorisasi ulang akun pemilik arsip menggunakan OAuth client yang sama
   (`npm run drive:connect`), lalu perbarui `GOOGLE_DRIVE_REFRESH_TOKEN` langsung
   di Environment Variables proyek Vercel yang melayani `drive-galilea.vercel.app`.
   Pilih environment Production; jangan kirim token lewat chat atau commit.
3. Redeploy setelah variabel berubah. Periksa `/api/archive/tree` dan
   `/api/archive/random`, lalu buka foto, putar dan seek video, buka PDF, serta
   coba unduh file asli.

Status Testing untuk aplikasi External yang meminta scope Drive menghasilkan
refresh token dengan masa berlaku 7 hari. Production menghilangkan batas khusus
Testing tersebut; token masih dapat dicabut atau tidak berlaku karena kondisi
lain. Lihat [ketentuan OAuth Google](https://developers.google.com/identity/protocols/oauth2#expiration).

### URL media dan thumbnail

Browser menggunakan `/api/archive/media?fileId=...` untuk foto asli, video
(termasuk Range request), dan PDF. Galeri dan filmstrip menggunakan
`/api/archive/thumbnail?fileId=...`. Endpoint thumbnail memvalidasi batas arsip,
mengambil `thumbnailLink` terbaru dari Drive, dan mengambil gambar dengan
autentikasi server. Link tersebut tidak dikirim ke browser atau disimpan di
Firestore. Data indeks lama dinormalisasi saat dibaca, sehingga tidak perlu
menghapus atau mengunggah ulang arsip.

Respons gambar berhasil dapat dicache selama 5 menit, dengan revalidasi sampai
1 jam. Respons gagal memakai `no-store`. Jika thumbnail foto belum tersedia,
server mengarahkan ke endpoint media internal; video/dokumen tanpa thumbnail
menampilkan placeholder. Unduhan tetap menggunakan file asli.

Referensi: [metadata dan thumbnail Google Drive](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).

---

### 1. Project Identification
- **Firebase Project ID**: `gmahk-galilea-archive`
- **Google Cloud Project**: Terhubung langsung dengan project Firebase di atas.

---

### 2. Required Google Cloud APIs
Pastikan API berikut aktif di Google Cloud Console (project `gmahk-galilea-archive`):
1. **Google Drive API** (Penyimpanan utama file dan direktori)
2. **Cloud Firestore API** (Penyimpanan metadata, index, dan log)
3. **Identity Toolkit API / Firebase Authentication** (Autentikasi Google Sign-In)

---

### 3. Google Drive Structure Setup
Root folder di Google Drive utama gereja:
```
GMAHK Galilea/
├── Dokumentasi/
│   └── 2026/
│       ├── Triwulan I/
│       ├── Triwulan II/
│       ├── Triwulan III/
│       └── Triwulan IV/
│           └── 12 September 2026/
└── File Ibadah/
    └── 2026/
        ├── Triwulan I/
        └── ...
```

Folder di-share dengan Service Account Google (dengan role *Editor*) agar backend API dapat membuat folder, mengunggah file, dan memindahkan file ke trash.

---

### 4. Service Account & Credentials
- Buat Service Account di Google Cloud Console dengan role:
  - **Firebase Admin SDK Administrator Service Agent**
  - **Cloud Datastore User**
- Buat Service Account Key (JSON) dan simpan dengan aman.
- **PENTING**: Jangan pernah commit file JSON Service Account ke repository GitHub.
- Bagikan (Share) folder root `GMAHK Galilea` di Google Drive kepada email Service Account dengan akses *Editor*.

---

### 5. Environment Variables Template (`.env.local`)
Lihat file `.env.example` untuk daftar lengkap variabel yang diperlukan:
```env
# Client-side Firebase Config
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=gmahk-galilea-archive.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=gmahk-galilea-archive
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=gmahk-galilea-archive.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Server-side Firebase Admin & Google Cloud
FIREBASE_PROJECT_ID=gmahk-galilea-archive
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Google Drive Storage Config
GOOGLE_DRIVE_ROOT_FOLDER_ID=
GOOGLE_DRIVE_DOKUMENTASI_FOLDER_ID=
GOOGLE_DRIVE_FILE_IBADAH_FOLDER_ID=

# Application Super Admin
SUPER_ADMIN_EMAIL=
```

---

### 6. Security Boundary Check
1. Validasi server-side memastikan API upload dan delete hanya dapat beroperasi di dalam subtree `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
2. Role `viewer` hanya diizinkan untuk melihat arsip dan mengunggah file ke folder Sabat aktif.
3. Operasi penghapusan (`trash`) hanya diperbolehkan untuk user dengan role `admin`.
