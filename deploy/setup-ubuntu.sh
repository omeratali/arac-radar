#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Hata: Bu kurulum betiği root/sudo yetkisiyle çalıştırılmalıdır."
  echo "Örnek: sudo bash deploy/setup-ubuntu.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

echo "=== Araç Radar Ubuntu/Debian 7/24 Kurulumu Başlatılıyor ==="

# 1. Düşük RAM'li (ör. Google Cloud e2-micro 1 GB) sunucularda Chrome OOM çökmesini önlemek için 2 GB Swap
MEM_MB="$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 4096)"
if [ "$MEM_MB" -le 2200 ] && ! swapon --show --noheadings | grep -q .; then
  if [ ! -f /swapfile ]; then
    echo "[1/5] Düşük bellek tespit edildi (${MEM_MB} MB). 2 GB Swap alanı oluşturuluyor..."
    (fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=progress)
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    if ! grep -q '^/swapfile ' /etc/fstab; then
      echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
  else
    swapon /swapfile || true
  fi
else
  echo "[1/5] Bellek yeterli (${MEM_MB} MB) veya Swap zaten aktif."
fi

# 2. Temel paketler ve Docker kurulumu
echo "[2/5] Sistem paketleri ve Docker kontrol ediliyor..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ca-certificates openssl

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker kuruluyor..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose eklentisi kuruluyor..."
  apt-get install -y docker-compose-v2 || apt-get install -y docker-compose-plugin
fi

if [ -n "${SUDO_USER:-}" ] && id "$SUDO_USER" >/dev/null 2>&1; then
  usermod -aG docker "$SUDO_USER" || true
fi

# 3. .env ve kalıcı data dizini hazırlığı
echo "[3/5] Yapılandırma (.env) ve kalıcı veri klasörü hazırlanıyor..."
mkdir -p "$APP_DIR/data"

if [ ! -f "$APP_DIR/.env" ]; then
  if [ -f "$APP_DIR/.env.example" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  else
    cat > "$APP_DIR/.env" <<'EOF'
PORT=8765
HOST=0.0.0.0
ALLOW_REMOTE=1
AUTH_USER=admin
AUTH_PASS=guclu_bir_sifre_belirleyin
PROXY_URL=
TZ=Europe/Istanbul
EOF
  fi
fi

# Örnek şifre değiştirilmemişse veya boşsa 12 karakterli güvenli şifre üret
CURRENT_PASS="$(grep -E '^AUTH_PASS=' "$APP_DIR/.env" | cut -d= -f2- | tr -d '[:space:]' || true)"
if [ -z "$CURRENT_PASS" ] || [ "$CURRENT_PASS" = "guclu_bir_sifre_belirleyin" ]; then
  GENERATED_PASS="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 12)"
  if grep -q '^AUTH_PASS=' "$APP_DIR/.env"; then
    sed -i "s|^AUTH_PASS=.*|AUTH_PASS=${GENERATED_PASS}|" "$APP_DIR/.env"
  else
    echo "AUTH_PASS=${GENERATED_PASS}" >> "$APP_DIR/.env"
  fi
fi

APP_PORT="$(grep -E '^PORT=' "$APP_DIR/.env" | cut -d= -f2- | tr -d '[:space:]' || echo 8765)"
APP_PORT="${APP_PORT:-8765}"
APP_USER="$(grep -E '^AUTH_USER=' "$APP_DIR/.env" | cut -d= -f2- | tr -d '[:space:]' || echo admin)"
APP_PASS="$(grep -E '^AUTH_PASS=' "$APP_DIR/.env" | cut -d= -f2- | tr -d '[:space:]' || true)"

# 4. UFW güvenlik duvarı açıksa porta izin ver
echo "[4/5] Güvenlik duvarı (UFW) kontrol ediliyor..."
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "${APP_PORT}/tcp" || true
fi

# 5. Docker konteynerini derle ve 7/24 başlat
echo "[5/5] Araç Radar derleniyor ve arka planda başlatılıyor..."
docker compose up -d --build

PUBLIC_IP="$(curl -fsS -4 --max-time 4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}' || echo '<SUNUCU-IP>')"

echo ""
echo "=========================================================="
echo " Araç Radar 7/24 Sunucusu Başarıyla Başlatıldı!"
echo "=========================================================="
echo " Erişim Adresi : http://${PUBLIC_IP}:${APP_PORT}"
if [ -n "$APP_PASS" ]; then
  echo " Kullanıcı Adı : ${APP_USER:-admin}"
  echo " Şifre         : ${APP_PASS}"
else
  echo " Şifre         : Kapalı (.env içinde AUTH_PASS tanımlayabilirsiniz)"
fi
echo ""
echo " Not: Oracle Cloud kullanıyorsanız Web Paneli -> VCN ->"
echo " Security Lists bölümünden TCP ${APP_PORT} portunu (Ingress) açmayı unutmayın."
echo ""
echo " Faydalı Komutlar:"
echo "  Canlı logları izle : docker compose logs -f"
echo "  Durumu kontrol et  : docker compose ps"
echo "  GitHub'dan güncelle: bash deploy/update.sh"
echo "=========================================================="
