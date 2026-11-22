# SI-BVET IV Lab

Landing page, ringkasan grafik dan peta sebaran, serta panel admin untuk data IV Lab. Aplikasi menggunakan Vite di Vercel, backend Express, dan MySQL untuk autentikasi serta penyimpanan data.

## Menyiapkan MySQL

1. Buat database MySQL (misalnya `iv_lab`) melalui MySQL server / phpMyAdmin / XAMPP.
2. Jalankan isi [`database/schema.sql`](./database/schema.sql) agar tabel `iv_lab_users`, `iv_lab_admins`, `iv_lab_imports`, `iv_lab_records`, dan `iv_lab_sessions` tersedia.
3. Daftarkan admin melalui endpoint `POST /api/auth/register` dengan `isAdmin: true`, atau tambahkan langsung baris pada tabel `iv_lab_admins` (sesuai `user_id` di `iv_lab_users`).

## Menjalankan lokal dan deploy

```bash
npm install
npm run dev
npm run start
```

Untuk mode lokal, backend berjalan di `http://localhost:3001` dan Vite proxy `/api` ke backend tersebut. Salin `.env.example` menjadi `.env.local`, lalu isi variabel `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, dan `DB_PASSWORD` sesuai MySQL Anda. Jangan pernah meletakkan kata sandi database ke repo publik.

Di Vercel, impor repository ini dan tambahkan environment variables `VITE_API_URL`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, dan `DB_PASSWORD`, lalu deploy. Vercel akan menjalankan `npm run build` secara otomatis.

## Login admin dan sesi

Login admin menggunakan email dan kata sandi yang dikelola backend. Sesi disimpan sebagai token di tabel `iv_lab_sessions` dan tidak disimpan ke penyimpanan browser, sehingga halaman yang dimuat ulang akan meminta login kembali. Setiap penghapusan data juga meminta kata sandi admin lagi.

Gunakan tombol **Keluar** setelah selesai bekerja.

## Format impor CSV

Kolom wajib mengikuti dashboard IV Lab saat ini:

`registration_date`, `kode_sampel`, `nama_uji`, `metode_uji`, `provinsi`

Saat impor, baris dengan kolom `provinsi` kosong akan dilewati dan jumlahnya ditampilkan setelah proses. Kolom wajib lain yang kosong tetap menyebabkan impor berhenti dengan pesan kesalahan.

Kolom `interpretasi_hasil` boleh kosong (atau tidak disertakan jika hasil belum tersedia); data akan tersimpan tanpa hasil dan tidak dihitung sebagai positif. Kolom opsional lain: `kabupaten`, `kabupaten/kota`, `kecamatan`, `no_registrasi`, `sample_analysis_number`, `hewan`, dan `jenis_layanan`. Tanggal menerima format `YYYY-MM-DD` atau `DD/MM/YYYY`. Kolom kabupaten dan kecamatan dipakai untuk mencocokkan warna peta ke wilayahnya.

Setiap file CSV yang diimpor admin menambahkan baris ke tabel data yang sama. Gunakan satu file untuk satu tahun; data 2021, lalu 2022, dan seterusnya akan tampil bersama di dashboard. Daftar impor di Panel Admin mencatat nama file, tahun, dan jumlah baris; menghapus satu file menghapus hanya baris dari impor tersebut. Mengimpor file yang sama lagi akan menambahkan duplikat. Data yang sudah ada sebelum daftar impor tersedia ditampilkan sebagai **Data lama** per tahun karena nama file sumbernya tidak tercatat; menghapus entri lama menghapus data lama pada tahun itu. Panel Admin juga menyediakan **Hapus semua data**, dengan konfirmasi mengetik `HAPUS SEMUA DATA`.

## Dashboard Olah Data dan Dashboard Peta

Kedua dashboard adalah halaman React yang mengambil data agregat dari backend IV Lab:

- **Olah Data** (`src/pages/ChartsPage.tsx`): grafik dan tabel ringkasan sampel, positif, dan seropositif per metode uji, hari, bulan, tahun, dan provinsi. Dimensi **Per Metode Uji** dan **Per Penyakit** tersedia sebagai checkbox yang bisa dicentang keduanya; kedua grafik lalu ditampilkan bertumpuk ke bawah dengan tinggi baris yang longgar agar label tidak saling menimpa. Filter tahun/provinsi/penyakit juga berupa checkbox multi-select (AI/influenza digabung menjadi Influenza). Tersedia tab tabel dan cakupan data, pencarian, pengurutan, serta unduh CSV/PNG. Data per penyakit diambil dari baris `target` pada agregasi backend; angka positif pada tampilan ini sudah termasuk seropositif.
- **Peta Wilayah** (`src/pages/MapPage.tsx`): peta status wilayah per provinsi, kabupaten/kota, dan kecamatan dengan filter checkbox tahun, provinsi, kabupaten/kota, kecamatan, status, dan penyakit (bisa dipilih beberapa sekaligus). Tersedia mode presentasi, zoom/pan, sorotan batas wilayah beranimasi saat kursor melintas, label kecamatan kecil, grid koordinat di tepi peta, tabel wilayah, serta ekspor PNG, CSV, GeoJSON, cetak, dan **paket QGIS (.zip)**. Paket QGIS berisi `Peta_Sumbagsel.qgz` beserta layer GeoJSON dan atribut status; setelah diekstrak ke satu folder, project langsung menampilkan peta lengkap dengan warna status, batas, dan label sesuai level peta saat diekspor (EPSG:4326). Geometri batas wilayah (GADM 3.6 yang disederhanakan) tersimpan di `src/data/peta.json`. Komponen filter checkbox bersama ada di `src/components/MultiSelect.tsx` dengan gaya di `src/styles/multiselect.css`.

Impor CSV dan input manual hanya tersedia di **Panel Admin**. Dashboard publik tidak menerima file CSV; data grafik dan peta dikirim melalui fungsi agregasi backend tanpa membuka kode sampel atau data baris per baris. Navigasi menggunakan menu di header aplikasi.

Saat sesi admin aktif, menu dashboard disembunyikan; admin perlu **Keluar** terlebih dahulu untuk melihat dashboard publik.

## Struktur utama

```
src/
  App.tsx                 routing, tema, autentikasi, dan aksi admin
  api/client.ts           klien API backend IV Lab
  api/database.js         koneksi pool ke MySQL
  data/peta.json          geometri dan batas wilayah
  lib/
    constants.ts          konstanta dan normalisasi tanggal
    csv.ts                parsing CSV impor
    peta.ts               pencocokan wilayah, agregasi peta, dan geometri
    mapExport.ts          unduh PNG/CSV/GeoJSON
  pages/
    HomePage.tsx          beranda dan ringkasan publik
    LoginPage.tsx         login admin
    AdminPage.tsx         impor, input manual, dan tabel data
    ChartsPage.tsx        dashboard olah data
    MapPage.tsx           dashboard peta
    ReauthModal.tsx       verifikasi ulang kata sandi untuk aksi sensitif
  styles/                 stylesheet dashboard
  styles.css              stylesheet utama
```

Jika database diperbarui, perbarui struktur pada [`database/schema.sql`](./database/schema.sql) atau jalankan ulangnya melalui MySQL client / phpMyAdmin agar perubahan kolom tersedia. Untuk memperbarui geometri peta, perbarui `src/data/peta.json`; `scripts/prepare_gadm.py` hanya diperlukan jika ingin membuat ulang geometri dari GeoJSON sumber.
