# ============================================================
# SI-BVET IV Lab — Upload + redeploy dari Windows (PowerShell)
#
# Cara pakai:
#   1. Isi $VPS_USER dan $VPS_IP di bawah
#   2. Jalankan: powershell -ExecutionPolicy Bypass -File deploy\upload.ps1
# ============================================================

$VPS_USER = "root"          # ganti, misal: ubuntu
$VPS_IP   = "1.2.3.4"       # ganti dengan IP VPS Anda
$REMOTE_DIR = "/var/www/si-bvet"
$ZIP = "si-bvet.zip"

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "==> [1/4] Pack project (tanpa node_modules/dist/.env.local)..."
Remove-Item $ZIP -Force -ErrorAction SilentlyContinue
tar -a -c -f $ZIP --exclude=node_modules --exclude=dist --exclude=.git `
    --exclude=.env.local --exclude=tmp* `
    src server.js package.json package-lock.json vite.config.ts tsconfig.json `
    index.html database deploy
if ($LASTEXITCODE -ne 0) { throw "Gagal membuat arsip" }
Write-Host "    Ukuran: $([math]::Round((Get-Item $ZIP).Length/1MB, 1)) MB"

Write-Host "==> [2/4] Upload ke VPS..."
scp $ZIP "${VPS_USER}@${VPS_IP}:~/${ZIP}"
if ($LASTEXITCODE -ne 0) { throw "Gagal upload (cek IP/user/koneksi SSH)" }

Write-Host "==> [3/4] Jalankan redeploy di VPS..."
ssh "${VPS_USER}@${VPS_IP}" "cd ${REMOTE_DIR} && sudo bash deploy/redeploy.sh"
if ($LASTEXITCODE -ne 0) { throw "Redeploy gagal — cek log VPS: pm2 logs iv-lab" }

Write-Host "==> [4/4] Bersihkan arsip lokal..."
Remove-Item $ZIP -Force

Write-Host "`n✅ SELESAI! Buka http://${VPS_IP}"
