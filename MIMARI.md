# Araç Radar — Yüksek Hızlı Tarama ve Emsal Mimarisi

Sahibinden.com'daki araç ilanlarını (Otomobil & Arazi/SUV/Pickup) arka planda gerçek tarayıcı motoruyla tarayan, IQR temizlemeli emsal fiyatına göre fırsatları bulan, 13 parça boya/değişen şemasını ve tramer/ağır hasar durumunu analiz eden yerel uygulama altyapısı.

## 1. Neden Eskiden Yavaştı ve Nasıl 25.000+ İlan/Gün Hızına Çıkarıldı?

| Darboğaz | Eski Yapı | Yeni Mimari (iPhone Avcısı Tarzı) | Hız Etkisi |
|---|---|---|---|
| **Sayfa Başı İlan Sayısı** | Varsayılan `20` ilan (`pagingOffset=20, 40...`) | `pagingSize=50&sorting=date_desc` (`offset=0, 50, 100...950`) | **2.5× daha fazla ilan / istek** |
| **1.000 İlan Sınırı** | Sadece düz kategori sayfalaması (~1.000 ilanda tıkanma) | **15 Fiyat Bandı (`price_min`/`price_max`) + İmleç (`deepCursor`)** | Tüm Türkiye piyasasını kesintisiz tarama |
| **Detay Kuyruğu Darboğazı** | Her ilanın detayını okumaya çalışma veya liste satırını tam detay sanma | **Seçici Detay Kuyruğu (`enqueueSelectiveDetails`)**: Sadece **fırsat adayları** (emsalin ≥%6 altı / alt çeyrek) ve **favoriler** için `/detay` açılır | Bant genişliğinin %80+'ı 50'li liste taramasına ayrılır |
| **Oturum & Çerez Yönetimi** | Her sayfa geçişinde `localStorage`/`indexedDB` siliniyordu | Kalıcı Chrome profili (`chrome-cdp-profile`) ve çerezler korunur; yalnız engel durumunda temizlik yapılır | Sayfa geçiş süresi kısaldı, bot şüphesi azaldı |
| **İnternet Kesintisi / Hata** | Tek bir `ERR_INTERNET_DISCONNECTED` hatasında `running=false` olup tamamen duruyordu | **`failStreak` Üstel Geri Çekilme (Auto-Recovery)**: Geçici ağ/zaman aşımı hatalarında tarama durmaz, otomatik devam eder | 7/24 kesintisiz çalışma |

## 2. Üç Aşamalı Tarama Döngüsü (`crawler.mjs`)

1. **Yeni İlan Taraması (Fresh Scan):**
   Her döngüde `/otomobil` ve `/arazi-suv-pickup` ana kategorilerinin ilk sayfaları (`sorting=date_desc&pagingSize=50`, `offset=0` ve `50`) + döner marka sayfaları taranarak yeni düşen ilanlar dakikalar içinde yakalanır.
2. **Derin Tarama (`advanceDeepScanBatch` & `DEEP_PRICE_BANDS`):**
   Sahibinden tek sorguda en fazla 1.000 sonuç (`pagingOffset=950`) gösterdiği için piyasa 15 fiyat bandına (`0–350B`, `350B–550B`, ..., `4.5M+ TL`) bölünür. İmleç (`deepCursor`: `catIdx`, `bandIdx`, `offset`, `fullSweeps`) SQLite `meta` tablosunda saklanır. Bir bantta 35'ten az ilan çıkarsa veya yeni ilan kalmazsa (`skipCurrentDeepBand`), kalan boş sayfalar atlanıp anında sonraki fiyat bandına geçilir.
3. **Seçici Detay Okuma (`enqueueSelectiveDetails` & `parseDetail`):**
   Liste sayfasından gelen 50 ilan anında SQLite'a (`listings`) yazılır ve çevrimdışı IQR emsal analizinden (`evaluateOpportunityCandidate`) geçirilir. Emsal medyanının en az **%6 altında** (veya alt çeyrekte `P25`) olan fırsat adayları ile favori ilanların `/ilan/.../detay` sayfası açılarak **13 parça görsel boya/değişen şeması** (`.car-parts`, `.car-damage-info-list`), **tramer**, **ağır hasar** ve **açıklama metni** okunur.

## 3. Çevrimdışı Emsal ve Ekspertiz (`parser.mjs` & `public/app.js`)

- **IQR (Çeyrekler Arası) Aykırı Değer Temizliği (`iqrStats` / `iqrClean`):** Tek bir hatalı/saçma fiyatlı ilanın ortancayı bozmaması için $Q_1 - 1.5 \times \text{IQR}$ ve $Q_3 + 1.5 \times \text{IQR}$ dışındaki uç fiyatlar elenir.
- **Bayat ve Kopya İlan Eleme:** 21 günden uzun süredir fiyat değiştirmeden bekleyen bayat ilanlar ve aynı başlık+fiyatlı kopya ilanlar emsal havuzunda tekilleştirilir.
- **13 Parça Şema & Hatasız Filtresi (`ilanBilgisineGoreHatasizMi`):** Şema ile açıklama metni arasındaki çelişkileri (`aciklama_uyumsuz`), ağır hasar/airbag/şase/çekme belgeli risk rozetlerini ve sıfır tramer şartını denetler.
