# Araç Radar — Arka planda yerel tarama

Bu uygulama bu bilgisayarda çalışır. Üretim verisi yalnız gerçek kaynak sayfalarından alınır; örnek ilan eklenmez.

## Başlatma ve çalışma

1. `Baslat.cmd` dosyasını çalıştır. Yerel panel `http://127.0.0.1:8765` adresinde açılır.
2. Veri okuyucusu **Edge kullanmaz**. Uygulamaya ait ayrı Chromium motoru görünür pencere açmadan çalışır. JavaScript çalıştırır; yalnız bu okuyucuya ait geçici, bellek içi oturumu kullanır.
3. Chromium henüz kurulu değilse başlatıcı resmî Playwright indirmesiyle motoru `data/browser-runtime/` altına kurar. İlk indirme birkaç yüz MB alan ve internet bağlantısı gerektirir. Kurulum hatası `data/reader-setup.log` dosyasına yazılır. Mevcut tarayıcılar değiştirilmez.
4. İlk işlem gerçek kaynak sayfasını okumaktır. Tarama merkezi, **Tek sayfada gerçek veri kontrolü**, kaynak HTTP yanıtı ve okuyucu durumunu gösterir. Başarılı okuma doğrulanmadan genel tarama tamamlanmış sayılmaz.
5. Kaynak erişim verirse, gerçek kategori ve liste bağlantıları izlenir. İlan kimlikleri tekilleştirilir; bulunan ilanların detayları yerel veri tabanına kaydedilir. Kaynak yapısı okunamazsa hata gösterilir.
6. İlk genel tarama ve keşfedilen detay işleri bir kez tamamlanır. Kontrol noktaları yeniden açılışta korunur. Ardından 30 saniye beklenip bilinen liste sayfalarının ilan kimlikleri yeniden karşılaştırılır. Yalnız yeni veya detayı eksik ilanların detayları okunur. Aynı ilan ikinci kez yeni ilan bildirimi oluşturmaz.
7. Kontroller üst üste binmez. Her kontrol bitince 30 saniye sonra yenisi başlar. İstekler Tarama hızı alanındaki minimum aralıkla sırayla yapılır; çok sayfalı bir kontrol daha uzun sürebilir. Bütün sitedeki her yeni ilanın 30 saniyede bulunması garanti edilmez.
8. `Durdur.cmd` sunucuyu durdurur. Bilgisayar kapanırsa veya uykuya girerse tarama durur. Windows başlangıcına eklenmemiştir.

## Kaynak erişim sınırı

Kaynak giriş, tarayıcı doğrulaması veya erişim reddi bildirirse okuyucu durur; doğrulama kodu çalıştırılmaz ve çözülmez. Kaynağın bekleme süresi belirtilirse uygulanır. Bu durum ilanların kaldırıldığı veya ilk taramanın tamamlandığı anlamına gelmez. Tarama merkezi üzerinden **Arka plan okuyucusunu yeniden dene** ile yeni bir erişim kontrolü başlatılabilir.

JavaScript çalıştıran bir okuyucunun kurulmuş olması, kaynak sitenin otomatik erişime izin verdiğini kanıtlamaz. Önceki düz HTTP denemesinde kaynak 403 ve tarayıcı doğrulaması döndürmüştü. Arka plan motorunun canlı kaynak sonucu panelden ayrı doğrulanmalıdır.

Kapsam `/otomobil` sayfasından gerçek bağlantılarla keşfedilir; görünmeyen, bağlantısı verilmeyen veya erişimi sınırlandırılan sayfalar için bütün envanterin eksiksizliği garanti edilmez. HTTP hataları satış olarak kaydedilmez. Kaynağın bekleme veya erişim kuralları hız ayarıyla değiştirilmez.

## Dosyalar ve veri

- `data/radar.sqlite`: gerçek ilanlar, fiyat geçmişi, favoriler ve kuyruk kontrol noktaları.
- `data/browser-runtime/`: uygulamaya ait Chromium ve yardımcı motor dosyaları. Sürümü Playwright ile eşleşmelidir.
- `data/server.log`: sunucu çıktısı; `data/reader-setup.log`: ilk kurulum kaydı, kurulum gerekmişse oluşur.
- Eski `data/source-profile/` klasörü varsa bu sürüm tarafından kullanılmaz. Bu değişiklikte silinmedi.
- Okuyucu, kişisel Edge profilini, kaydedilmiş hesapları ve çerezleri kullanmaz. Kalıcı tarayıcı oturumu kaydetmez.
- Sunucu yalnız `127.0.0.1:8765` dinler. İnternete açılmamıştır.

## Teknik çalıştırma ve doğrulama

Node.js 24 veya üzeri ve Playwright 1.62.1 gerekir. Bu bilgisayardaki hazır çalışma zamanı Playwright paketini sağlar; normal kurulumda proje bağımlılıkları kurulmalıdır. `node reader-runtime.cjs` Chromium kurulumunu kontrol eder; `node server.mjs` sunucuyu çalıştırır. Başlatıcı kurulum kontrolünü kendisi yapar.

- `node --test tests.mjs`: ilk tarama, 30 saniyelik bekleme, yeni ilan tekilleştirme, kontrol noktası ve hata davranışları. Test verileri bellek içindedir.
- `node --test reader-tests.mjs`: gerçek Chromium ile yalnız geçici yerel sayfalarda JavaScript okuması, HTTP 403/200 doğrulama engeli ve giriş yönlendirmesinde durma. Üretim veri tabanı açılmaz; bu testler canlı kaynağa istek yapmaz.

Bu testlerin geçmesi sahibinden.com üzerinde canlı taramanın çalıştığı anlamına gelmez. Canlı doğrulama sonucu paneldeki HTTP yanıtı ve tek sayfa kontrolünde görülür.

## Piyasa değerlendirmesi

Fırsat ekranı en az 5 başka, aynı marka/model/vites ve yakın yıldaki gerçek ilanla basit ortanca karşılaştırma yapar. Elle değerleme de basit ortanca karşılaştırmadır. Bilinmeyen veri tahmin edilmez; yayından kalkma satış sayılmaz. OtoRadar'ın sunucu algoritması ve kaynak erişim yöntemi bu uygulamada kopyalanmış değildir.
