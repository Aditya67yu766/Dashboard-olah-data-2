# 🚀 Panduan Hosting SI-BVET IV Lab di VPS

Panduan langkah demi langkah (bahasa Indonesia) untuk Ubuntu 22.04/24.04 LTS.

---

## 0. Rekomendasi VPS (belum punya?)

| Provider | Paket | Kisaran Harga |
|---|---|---|
| **Hetzner** (SG) | CX22 (2 vCPU/4 GB) | ~Rp 50 rb/bln |
| **DigitalOcean** | Basic 2 vCPU/4 GB | ~Rp 60 rb/bln |
| **Vultr** | 2 vCPU/4 GB | ~Rp 60 rb/bln |
| **IDCloudHost / DomaiNesia** (lokal) | 2 vCPU/4 GB | Rp 60–100 rb/bln |

- Spek **minimum 2 vCPU / 4 GB RAM / 25 GB SSD**
- OS: **Ubuntu 22.04 atau 24.04 LTS**
- Domain opsional (bisa langsung pakai IP)

---

## 1. Upload project ke VPS

### Cara A — ZIP + SCP (paling mudah dari Windows)

Di PC lokal, buat arsip (**kecuali** `node_modules`):

```powershell
# PowerShell — jalankan di folder project
tar -a -c -f si-bvet.zip src server.js package.json package-lock.json vite.config.ts tsconfig.json index.html database deploy .env.local
```

Upload ke VPS:

```powershell
scp si-bvet.zip user@IP_VPS:~/
```

Di VPS:

```bash
ssh user@IP_VPS
sudo mkdir -p /var/www/si-bvet && sudo chown $USER /var/www/si-bvet
unzip ~/si-bvet.zip -d /var/www/si-bvet
```

### Cara B — Git

```bash
sudo git clone https://github.com/USERNAME/REPO.git /var/www/si-bvet
```

> ⚠️ **Jangan upload `node_modules`** (ratusan MB, tidak perlu — akan di-install di VPS).
> ⚠️ `.env.local` lokal memakai `root` MySQL kosong — biarkan, karena **setup.sh akan menimpanya** dengan kredensial produksi.

---

## 2. Jalankan setup otomatis (1 perintah)

```bash
cd /var/www/si-bvet
chmod +x deploy/setup.sh
sudo bash deploy/setup.sh
```

Script ini otomatis:
1. Install Node.js 20, Nginx, MySQL, PM2
2. Buat database `iv_lab` + user MySQL khusus (password acak)
3. Import skema `database/schema.sql`
4. Generate `.env.local` produksi (permission 600)
5. `npm install` + `npm run build` (frontend jadi statis)
6. Jalankan backend via PM2 (**auto-restart** saat crash/reboot)
7. Konfigurasi Nginx (reverse proxy + **upload 200 MB**)
8. Buka firewall & verifikasi health check

Selesai → tampil alamat `http://IP_VPS`.

---

## 3. Buat akun admin

Buka `http://IP_VPS` → menu daftar → masukkan email + password → **centang/tandai sebagai admin**.

(Atau lewat API:)
```bash
curl -X POST http://IP_VPS/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@domain.com","password":"rahasia123","isAdmin":true}'
```

---

## 4. Import data CSV

Login sebagai admin → halaman impor → pilih CSV (kolom wajib:
`registration_date, kode_sampel, nama_uji, metode_uji, provinsi`).

- Body limit sudah 50 MB, Nginx 200 MB → file 150 MB aman
- Timeout proxy 300 detik → import 155 ribu baris tetap selesai
- Baris provinsi kosong otomatis dilewati

---

## 5. (Opsional) HTTPS dengan domain + Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d domainanda.com
```

Certbot otomatis memperbarui sertifikat (auto-renew).

---

## 6. Redeploy Setelah Ada Perubahan Kode ⚡

### Cara paling mudah — dari Windows (1 perintah)
1. Buka `deploy/upload.ps1`, isi `$VPS_USER` dan `$VPS_IP`
2. Jalankan:
```powershell
powershell -ExecutionPolicy Bypass -File deploy\upload.ps1
```
Script otomatis: pack project → upload → build → restart → health check.

### Cara manual di VPS
```bash
# Jika pakai Git:
cd /var/www/si-bvet && git pull
sudo bash deploy/redeploy.sh

# Jika upload zip via SCP:
scp si-bvet.zip user@IP:~/
ssh user@IP "cd /var/www/si-bvet && sudo bash deploy/redeploy.sh"
```

### Yang terjadi saat redeploy
- Kode terbaru diambil (git pull / ekstrak zip)
- `npm install` + `npm run build` (frontend `dist/` diperbarui)
- `pm2 restart iv-lab` → **cache agregat otomatis ter-reset** (angka tetap akurat)
- Health check `/api/health` → gagal = script berhenti dengan pesan error

### Aman untuk data
- `.env.local` (kredensial DB) **tidak tertimpa** (backup/restore otomatis)
- Database & CSV yang sudah diimport **tidak berubah**

> ⚠️ Kalau ada perubahan struktur tabel (`database/schema.sql`), jalankan sekali sebelum redeploy:
> ```bash
> mysql -u ivlab -p iv_lab < database/schema.sql
> ```

---

## Perintah Harian

```bash
pm2 logs iv-lab          # lihat log aplikasi
pm2 restart iv-lab       # restart setelah update kode
pm2 monit                # monitor RAM/CPU

# Update kode terbaru
cd /var/www/si-bvet
# (upload/ pull perubahan), lalu:
npm run build && pm2 restart iv-lab
```

---

## 7. Backup Database

```bash
# Backup harian via cron (02:00 setiap hari)
sudo bash -c 'echo "0 2 * * * root mysqldump -u ivlab -p"$(grep DB_PASSWORD /var/www/si-bvet/.env.local | cut -d= -f2)" iv_lab | gzip > /root/iv_lab_\$(date +\%F).sql.gz"' > /etc/cron.d/iv-lab-backup
```

---

## 🔧 Troubleshooting

| Masalah | Solusi |
|---|---|
| `502 Bad Gateway` | `pm2 logs iv-lab` — biasanya DB belum jalan: `sudo systemctl start mysql` |
| Import gagal/timeout | Cek `client_max_body_size` di `deploy/nginx.conf` (sudah 200m) |
| `ECONNREFUSED` | `.env.local` salah → cocokkan dengan `deploy/.env.production.example` |
| Website lambat pertama kali | Normal — agregasi dihitung ~2 detik lalu di-cache |
| Lupa password DB | Lihat `/var/www/si-bvet/.env.local` |

---

## 📁 Struktur Setelah Deploy

```
/var/www/si-bvet/
├── server.js          # backend Express (port 3001, internal)
├── dist/              # hasil build frontend (disajikan Express)
├── src/               # sumber React (untuk build ulang)
├── database/schema.sql
├── deploy/            # file panduan ini
└── .env.local         # kredensial DB produksi (RAHASIA!)
```

Nginx (port 80) → Express (port 3001) → MySQL (localhost:3306).
