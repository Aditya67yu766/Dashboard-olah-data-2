#!/usr/bin/env bash
# ============================================================
# SI-BVET IV Lab — Redeploy sekali jalan (dijalankan di VPS)
#
#   cd /var/www/si-bvet
#   chmod +x deploy/redeploy.sh
#   sudo bash deploy/redeploy.sh
#
# Aman untuk data: .env.local dan database TIDAK disentuh.
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_PORT="$(grep -E '^PORT=' "${APP_DIR}/.env.local" 2>/dev/null | cut -d= -f2 || echo 3001)"
cd "${APP_DIR}"

echo "==> [1/5] Ambil kode terbaru"

if [ -d .git ]; then
  echo "    Mode: git pull"
  git pull --ff-only
elif [ -f "$HOME/si-bvet.zip" ]; then
  echo "    Mode: ekstrak si-bvet.zip dari home directory"
  # Simpan file penting yang tidak boleh tertimpa
  cp .env.local /tmp/iv-lab-env-backup 2>/dev/null || true
  unzip -o -q "$HOME/si-bvet.zip" -d "${APP_DIR}"
  cp /tmp/iv-lab-env-backup .env.local 2>/dev/null || true
  chmod 600 .env.local
  rm -f "$HOME/si-bvet.zip"
else
  echo "    Tidak ada git/zip baru — pakai kode yang sudah ada."
fi

echo "==> [2/5] Install / update dependencies"
npm install --no-audit --no-fund

echo "==> [3/5] Build frontend (dist/)"
npm run build

echo "==> [4/5] Restart backend via PM2 (cache agregat ikut ter-reset otomatis)"
pm2 restart iv-lab --update-env

echo "==> [5/5] Verifikasi"
sleep 3
if curl -fsS "http://localhost:${APP_PORT}/api/health" >/dev/null; then
  echo "✅ REDEPLOY BERHASIL — http://IP_VPS"
  pm2 status iv-lab
else
  echo "❌ Health check gagal. Cek: pm2 logs iv-lab" >&2
  exit 1
fi
