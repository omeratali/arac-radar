# Araç Radar — Ücretsiz Bulut Kurulum Rehberi

Bu projeyi kredi kartı veya faturalandırma hesabı gerektirmeden tamamen **GitHub** üzerinde çalıştırabilir (Bölüm 1), ya da kendi ücretsiz Linux VPS sunucunuzda 7/24 canlı tutabilirsiniz (Bölüm 2).

---

## Bölüm 1: %100 Kartsız & Faturalandırmasız GitHub Sistemi (GitHub Actions + Releases + Pages)

Hiçbir kredi kartı, faturalandırma hesabı veya harici sunucu gerekmez.
- **GitHub Actions (`.github/workflows/github-crawler.yml`)** her 30 dakikada bir (veya manuel tetiklendiğinde) otomatik uyanır, Chrome taramasını yapar.
- **GitHub Releases (`db-snapshot`)** 145.000+ ilanlık `radar.sqlite.gz` veritabanını güvenle saklar ve günceller.
- **GitHub Pages** güncel ilanları, fırsatları, değerlemeyi ve canlı akışı internet tarayıcınızdan / telefonunuzdan görüntüleyebileceğiniz web paneli olarak yayınlar.

> **Not:** GitHub Actions zamanlanmış görevlerinin sınırsız çalışması için GitHub deponuzun **Public (Herkese Açık)** olması önerilir (Private depolarda ücretsiz kota ayda 2.000 dakikadır). Veri tabanı özel kalması gerekiyorsa Private depo kullanıp `workflow_dispatch` ile istediğiniz zaman çalıştırabilirsiniz.

### Adım 1: Mevcut 145.000+ İlanlık Veritabanını Tek Komutla Sıkıştırın
Önce yerel sunucunun kapalı olduğundan emin olun (`Durdur.cmd`), ardından PowerShell'de:
```powershell
cd C:\Users\Asus\Desktop\caner\arac-radar
npm run db:compress
```
Bu komut `data/radar.sqlite` dosyasındaki bekleyen WAL kayıtlarını birleştirip sıkıştırarak `data/radar.sqlite.gz` dosyasını üretir.

### Adım 2: Kodu GitHub'a Yükleyin
GitHub'da yeni bir depo oluşturun (ör. `arac-radar`). `.gitignore` dosyası `data/`, `dist-pages/`, `node_modules/` ve `.env` klasörlerini otomatik hariç tutar:
```powershell
cd C:\Users\Asus\Desktop\caner\arac-radar
git add .
git commit -m "Arac Radar kartsiz GitHub tarayici ve Pages yayini"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADINIZ/arac-radar.git
git push -u origin main
```

### Adım 3: GitHub Pages Ayarını Açın
GitHub deponuzda şu menüye gidin:
**Settings → Pages → Build and deployment → Source** açılır menüsünden **`GitHub Actions`** seçin.

### Adım 4: Mevcut `data/radar.sqlite.gz` Yedeğini `db-snapshot` Release'ine Yükleyin
* **Tarayıcıdan (en kolayı):** GitHub deponuzda sağ menüden **Releases → Create a new release** tıklayın:
  1. **Choose a tag** kutusuna `db-snapshot` yazıp *"Create new tag: db-snapshot"* deyin.
  2. **Attach binaries** alanına bilgisayarınızdaki `arac-radar\data\radar.sqlite.gz` dosyasını sürükleyip bırakın.
  3. **Publish release** butonuna basın.
* **Veya GitHub CLI (`gh`) ile tek komutla:**
  ```powershell
  gh release create db-snapshot data/radar.sqlite.gz --title "Araç Radar Canlı Veritabanı"
  ```

### Adım 5: İlk Taramayı ve Yayını Başlatın
1. GitHub deponuzda **Actions** sekmesine girin.
2. Sol menüden **`Araç Radar 7/24 Otomatik Tarayıcı (Kartsız)`** iş akışını seçin.
3. Sağdaki **`Run workflow`** butonuna tıklayıp başlatın.
4. İş tamamlandığında (yaklaşık 13–15 dk) **Deploy** adımının altındaki `https://KULLANICI_ADINIZ.github.io/arac-radar/` bağlantısından panelinizi açabilirsiniz. Bundan sonra her 30 dakikada bir otomatik taranıp güncellenecektir.

> **Eğer GitHub Azure IP'si Sahibinden.com engeline takılırsa:**
> GitHub deponuzda **Settings → Secrets and variables → Actions → New repository secret** bölümüne `PROXY_URL` adıyla bir gizli değişken ekleyebilirsiniz (ör. `http://kullanici:sifre@ev-ip:port` veya `socks5://...`). Workflow bu adresi otomatik olarak Chromium'a bağlar.

---

## Bölüm 2: Alternatif — Kendi Linux VPS / Oracle Cloud Sunucunuzda 7/24 Canlı Sunucu (Docker)

Eğer doğrudan API üzerinden canlı yenileme ve şifreli web sunucusu kullanmak isterseniz (ör. Oracle Cloud Always Free 24 GB RAM ARM sunucusu veya evdeki eski bir Ubuntu bilgisayar):

### Adım 1: Sunucu Seçimi ve Port İzni
- **Oracle Cloud Always Free:** `Ubuntu 24.04 Minimal` (ARM64 veya AMD64). **Networking → VCN → Security Lists** bölümünden TCP `8765` portunu (Ingress) açın.
- **Google Cloud (`e2-micro` — Cloud Billing gerektirir):** `us-central1` / `us-east1` / `us-west1` bölgesinde `Ubuntu 24.04 LTS` + `30 GB Standard persistent disk`.

### Adım 2: Sunucuda Tek Komutla Kurulum
```bash
git clone https://github.com/KULLANICI_ADINIZ/arac-radar.git
cd arac-radar
sudo bash deploy/setup-ubuntu.sh
```
Kurulum betiği düşük RAM'li makinelerde otomatik **2 GB Swap** oluşturur, Docker + Chromium + Xvfb kurar, `.env` için rastgele yönetici şifresi üretir ve konteyneri başlatır.

### Adım 3: Kodu Güncelleme
```bash
cd arac-radar
sudo bash deploy/update.sh
```

### Adım 4: Mevcut `radar.sqlite` Veritabanını VPS'e Aktarma
```powershell
cd C:\Users\Asus\Desktop\caner\arac-radar
tar -czf data-yedek.tar.gz data/radar.sqlite
scp data-yedek.tar.gz KULLANICI@SUNUCU_IP:~/arac-radar/
```
Sunucu tarafında:
```bash
cd ~/arac-radar
docker compose down
tar -xzf data-yedek.tar.gz
rm -f data-yedek.tar.gz
docker compose up -d
```

### Adım 5: Cloudflare Tunnel ile Port Açmadan HTTPS Erişim
```bash
cloudflared tunnel --url http://127.0.0.1:8765
```

### Adım 6: Tailscale Exit Node veya Proxy ile Ev IP'sinden Tarama
`arac-radar/.env` dosyasına `PROXY_URL=socks5://127.0.0.1:1055` veya `PROXY_URL=http://kullanici:sifre@ip:port` ekleyip `docker compose up -d` çalıştırın.
