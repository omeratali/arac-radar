#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

echo "[1/3] GitHub'dan son değişiklikler çekiliyor (data/radar.sqlite korunur)..."
git pull --ff-only

echo "[2/3] Konteyner yeniden derleniyor ve başlatılıyor..."
docker compose up -d --build

echo "[3/3] Eski imaj artıkları temizleniyor..."
docker image prune -f >/dev/null 2>&1 || true

echo "Güncelleme tamamlandı! Güncel durum:"
docker compose ps
