#!/usr/bin/env bash
# ============================================================
# SI-BVET IV Lab — Setup otomatis untuk VPS Ubuntu 22.04/24.04
# Jalankan SEBAGAI ROOT di folder project yang sudah di-upload:
#   chmod +x deploy/setup.sh
#   sudo bash deploy/setup.sh
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="ivlab"
APP_PORT=3001
DB_NAME="iv_lab"
DB_USER="ivlab"
DB_PASS="$(openssl rand -hex 16)"

echo "==> [1/8] Install paket dasar (Node.js 20, Nginx, MySQL, PM2)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl gnupg ca-certificates unzip nginx mysql-server ufw

# Node.js 20 LTS via NodeSource
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

echo "==> [2/8] Buat database & user MySQL"
systemctl enable --now mysql
mysql -u root <<SQL
CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
mysql -u root "${DB_NAME}" < "${APP_DIR}/database/schema.sql"
echo "    Database ${DB_NAME} + skema siap."

echo "==> [3/8] Buat file .env.local untuk produksi"
cat > "${APP_DIR}/.env.local" <<EOF
DB_HOST=localhost
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
DB_DATABASE=${DB_NAME}
PORT=${APP_PORT}
EOF
chmod 600 "${APP_DIR}/.env.local"
echo "    Kredensial tersimpan di .env.local (permission 600)."

echo "==> [4/8] Install dependencies & build frontend"
cd "${APP_DIR}"
npm install
npm run build
echo "    Build selesai -> dist/"

echo "==> [5/8] Jalankan aplikasi dengan PM2 (auto-restart)"
pm2 delete iv-lab 2>/dev/null || true
pm2 start server.js --name iv-lab --cwd "${APP_DIR}"
pm2 save
pm2 startup systemd -u root --hp root >/dev/null 2>&1 || true

echo "==> [6/8] Konfigurasi Nginx (reverse proxy + upload 200m)"
rm -f /etc/nginx/sites-enabled/default
cp "${APP_DIR}/deploy/nginx.conf" /etc/nginx/sites-available/iv-lab
ln -sf /etc/nginx/sites-available/iv-lab /etc/nginx/sites-enabled/iv-lab
nginx -t
systemctl reload nginx

echo "==> [7/8] Firewall (izin port 80/443)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "==> [8/8] Verifikasi"
sleep 3
if curl -fsS "http://localhost:${APP_PORT}/api/health" >/dev/null; then
  echo "    Health check: OK"
else
  echo "    Health check GAGAL — cek log: pm2 logs iv-lab" >&2
  exit 1
fi

PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org || echo 'IP-VPS-ANDA')"
cat <<EOF

============================================================
✅ SETUP SELESAI!

 Aplikasi   : http://${PUBLIC_IP}
 Health     : http://${PUBLIC_IP}/api/health
 Admin      : buka http://${PUBLIC_IP} lalu daftar akun
             (email + password, tandai sebagai admin)

 Perintah berguna:
   pm2 logs iv-lab        # lihat log
   pm2 restart iv-lab     # restart aplikasi
   pm2 monit              # monitor RAM/CPU

 Database   : ${DB_NAME} (user: ${DB_USER}, pass di .env.local)
============================================================
EOF
