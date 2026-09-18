# Remvora Web — kullanım ve yayın rehberi

[Veritabanı ve ilk Owner kurulumu](https://github.com/tahayildirm/remvora-server/blob/main/docs/FIRST_INSTALL.tr.md)
[Türkçe](GUIDE.tr.md) · [English](GUIDE.en.md)

## Amaç ve bileşenler

Yetkili BT/destek ekipleri, okul/kiosk filoları, küçük işletmeler ve ev laboratuvarları için tarayıcıdan uzak yönetim. Kendi Remvora Server’ınızı ve her cihaz için Remvora Agent kurun. Web paneli tek başına cihaz yönetemez; içinde veritabanı veya varsayılan hesap yoktur. Üç ayrı depo kullanılır: [Server](https://github.com/tahayildirm/remvora-server) · [Web](https://github.com/tahayildirm/remvora-web) · [Agent](https://github.com/tahayildirm/remvora-agent).

API rehberi veritabanı seçimi, migration, şifreleme anahtarı, ilk Owner ve kurtarmayı; Agent rehberi cihaz kurulumunu açıklar. Bu rehber paneli anlatır. MIT kapsamında bildirimi koruyarak kullanabilir/değiştirebilir/dağıtabilirsiniz; hosting, trafik ve destek dahil değildir. Bağımlılıklar kendi lisansını korur.

## Derleme ve yayın

Node.js 24 ve npm kullanın:

```sh
npm ci
npm run lint
npm test -- --watch=false
npm run build
```

`dist/remvora-web/browser` içeriğini HTTPS üzerinden sunun. `ng serve` internete açılmaz. Aynı-origin yayında `/api/`, `/ws/` ve `/health` API’ye, kök dizin panel dosyalarına gider. `deploy/nginx.conf.example` içindeki alan adı, sertifika, dizin ve upstream’i uyarlayın. WSS için upgrade aktarımı/idle sınırı gerekir. Özel ayar, arşiv ve gizli klasörlere web erişimini kapatın. index yeniden doğrulanmalı, hash’li JS/CSS önbelleğe alınabilir. Kimlik doğrulanan API trafiğine caching service worker eklemeyin.

API ayrıysa derlenmiş index’e açık metadata ekleyin:

```html
<meta name="remvora-api-origin" content="https://api.example.com">
```

URL yalnız HTTPS origin olmalı; parola, query veya ek path içermemeli. API’de `Security__AllowedOrigin=https://rdp.example.com` ve uygun `AllowedHosts` ayarlayın. Strict cookie için aynı-site HTTPS subdomainleri veya aynı-origin proxy kullanın. Rastgele farklı siteler arasında cookie çalışması garanti değildir. İstekler cookie taşır; localStorage’da auth token tutulmaz. Veritabanı parolası frontend’e konmaz.

Windows paketi: derlemeden sonra `python3 scripts/package-windows.py --api-origin https://api.example.com`; aynı-origin için parametreyi vermeyin. Çıktı `dist/remvora-web-panel.zip`. Mevcut IIS web.config’i değiştirmeden inceleyin. Çıkartılan yayın ZIP’lerini herkese açık klasörde bırakmayın.

Yerel geliştirme: `npm start -- --host localhost --port 4200 --proxy-config proxy.conf.json`. Proxy özel geliştirme API’sinin 5187 portuna gider. Secure cookie ve browser API’leri için güvenilen yerel HTTPS/proxy düzenini kurun; HTTP sayfanın açılması tam giriş akışının çalıştığı anlamına gelmez.

## İlk giriş, kullanıcılar ve organizasyon

Varsayılan e-posta/parola yoktur. Sunucu yöneticisi önce migration, sonra boş veritabanında bir kez `--bootstrap` çalıştırır; `REMVORA_ADMIN_EMAIL`, `REMVORA_ADMIN_PASSWORD` (8–256) ve `REMVORA_ORGANIZATION` verilir. Bunlar **Remvora hesabıdır**, hosting/veritabanı/OS hesabı değildir.

E-posta/parola ve açıksa TOTP/kurtarma koduyla giriş yapılır; giriş formunda organizasyon ID’si gerekmez. **Profilim / Organizasyon** mevcut parolayla e-posta/parola değiştirmeyi ve doğrulama/MFA sonrasında mevcut uygun organizasyon hesaplarına geçmeyi sağlar. Yeni organizasyon oluşturmaz. Mevcut kurulum CLI’sı yalnız ilk organizasyonu açar.

Yetkili yönetici **Kullanıcılar → Ekle** ile e-posta, başlangıç parolası ve rol girer. Otomatik davet e-postası, genel kayıt veya e-posta reset akışı yoktur. Parolayı özel iletin; kullanıcı profilinden değiştirsin. Owner/Admin/Operator/Viewer ve özel roller izin tabanlıdır. Gereken kadar yetki verin. Cihaz grubu sınırı tam gruplardır, alt gruplar otomatik dahil değildir. Owner organizasyonun tüm cihazlarına erişir, son Owner korunur.

Owner kendi organizasyonundaki kullanıcı yönetim alanlarını görebilir; e-posta/yeni parola belirleyebilir, kilidi açabilir ve oturumları iptal edebilir. Mevcut parola ve MFA sırları okunamaz. Owner organizasyonlar arası superadmin değildir. **Güvenlik** bölümünde MFA/kurtarma ve tarayıcı oturumları yönetilir. Kurtarma kodlarını ekran görüntüsüne/issue’ya koymayın.

## Cihaz ve envanter

Cihaz oluştur → kısa süreli kayıt tokeni al → Agent `enroll` → panelden onayla → Agent `activate` → servisi başlat. Güncellemede kimlik state’ini koruyun. Kayıt durumu ile canlı bağlantı farklıdır: Çevrimiçi/Meşgul/Çevrimdışı/Bilinmiyor signaling’den gelir. Onaylı olmak çevrimiçi olmak değildir. Agent aynı anda tek uzak oturuma izin verebilir.

Ad/metadata düzenleyin; grup, etiket, yetkili ve lokasyon ilişkilendirin. Ülkeler ve Türkiye il/ilçeleri listelenir; diğer ülkelerin yerel alanları serbest metindir. Seçime göre bağlı alanlar dolabilir; tam otomatik coğrafi adres bulma veya kişinin adresini çıkarma garantisi yoktur.

Devre dışı bırakma kimliği korur ve geri alınabilir. İptal/revoke güveni kaldırır. Kalıcı silme ayrı işlemdir ve iki teyit ister; bağlantı tamiri için kullanılmaz. Yeniden başlatma, rol izni + tam cihaz kodu + agent yerel izni gerektirir. Komut kabulü, cihazın açılışının tamamlandığı anlamına gelmez.

## Bilgisayar, tablet ve telefondan masaüstü

**Masaüstü** seçin. İlerleme ve tanılama P2P/WSS relay türünü gösterir. Otomatik mod önce P2P, gerekirse relay dener. Sunucu üzerinden zorlanmış mod da vardır. NAT/ağ değişimi bağlantıyı etkileyebilir; ISP adı veya CGNAT etiketi tek başına kesin teşhis değildir.

Telefonda varsayılan doğrudan dokunmatiktir: hedefe dokunun, tek parmakla sürükleyin, sağ tık için basılı tutup bırakın. **Touchpad / imleç** göreli imleç kontrolünü seçilebilir yapar. İki parmakla açıp kapama 1–4× yakınlaştırır; iki parmağı birlikte hareket ettirme görüntüyü kaydırır. Bu yerel görünümü değiştirir, uzak çözünürlüğü değil. Girdi modu tarayıcıda saklanır. Otomatik seçim pointer/ekran ölçüsüne dayanır; hibrit cihazlarda Kontroller’den değiştirebilirsiniz.

Araçlar dokunmatik görünümde başlangıçta kapalıdır; dikeyde altta, yatayda sağdadır. Kalite, klavye/pano, dosya, bağlantı ve tam ekran için menüyü açın. Tam ekran araçları gizler ve destekleyen tarayıcıda adres çubuğunu gizlemeyi ister. Desteklenmezse Remvora’yı ana ekrana ekleyip simgeden açın; gerçek davranış tarayıcı/OS’a bağlıdır. Bu çevrimdışı uzak erişim değil, uygulama gibi açılma desteğidir.

Video ayarlarında otomatik/elle kalite, FPS, bitrate ve boyut sınırları bulunur; cihaz başına tarayıcıda saklanır. Tarayıcı verisi silinirse, başka tarayıcı/cihaz veya özel mod kullanılırsa yerel tercihler kaybolabilir. Düşük bantta kalite düşürmek gerekir; ayar ağ gecikmesini yok etmez.

Klavye kısayollarının bazıları tarayıcı/OS tarafından yakalanır; ekrandaki düğmeleri kullanın. Pano açık eylemli, yalnız metinlidir; agent ve bazen tarayıcı izni ister, arka planda okunmaz. Yapıştırılan/sürüklenen dosya paylaşılan klasöre aktarılır, OS dosya panosuna değil. Sistem sesi isteğe bağlıdır, ilk kullanımda sessiz başlar, sonraki ses tercihini bu tarayıcıda hatırlar ve platforma bağlıdır; mikrofon yakalama modu yoktur.

## Mobil terminal

**Terminal**, agent hesabının gerçek kabuğunu açar. Dizin/prompt kabuktan gelir; komutlar o hesabın yetkisiyle yürütülür. Terminal sandbox değildir.

Araçlardan klavye, tam ekran, girdi tercihi ve tanılamayı açın. Dikeyde altta, yatayda sağdadır; gizlenince terminal alanı büyür. Klavye açılınca viewport ve terminal satır/sütunları uyarlanır. **Gönder** metni gönderir; **↵** Enter yollar. Ctrl/Alt sonraki yardımcı tuşa uygulanır: Ctrl ardından c keser, Ctrl ardından d EOF yollar. Tab, Esc, oklar, Backspace vardır. Terminalin kendi girişini de kullanabilirsiniz. İş bitince oturumu kapatın.

## Dosya ve güvenlik sınırları

Agentte `--file-root` mevcut, korunan paylaşılan dizini göstermeli ve masaüstü açık olmalıdır. Yükleme/indirme SHA-256 doğrular; dosya başına 100 MiB, oturumda 500 MiB bütçe, aynı anda tek aktarım vardır. Düz klasör kullanılır; alt dizin/path kaçışı/symlink yoktur, mevcut ad ezilmez, yarım yükleme temizlenir. Tarayıcı sınırlı dosyayı bellekte tutar. Bu sınırsız dosya yöneticisi veya zararlı yazılım tarayıcısı değildir.

WSS relay her iki hopta TLS kullanır; sunucu içeriğe erişebilir. İşletmeci API/DB, kullanıcılar ve yedekleri korumalıdır. Özel terminal/ekran görüntülerini yayımlamayın. Taşıma protokolü değişikliği yalnız unit test değil, gerçek agent kabul testi ister.

## Sorun giderme, güncelleme, katkı

- Sunucu erişilmiyor: API DNS/TLS/health, origin metadata, allowed origin ve cookie.
- Hesap yok: ilk hesabı Server bootstrap; sonraki hesabı yönetici oluşturur.
- Cihaz çevrimdışı: agent servis/WSS kontrolü; kayıt Active olması yeterli değil.
- Siyah ekran/girdi yok: grafik oturumu, display, OS izinleri ve agent flag’leri.
- Relay yavaş: iki ağ ve hosting kapasitesi; adaptif kaliteyi düşürün.
- Pano/ses/dosya yok: agent opt-in ve tarayıcı desteği; kontrol gizlemek/açmak yetki vermez.
- Eski arayüz: yenileyin veya kapat/açın; hash’li paketi karşılaştırın. Geri dönüş için eski index ve varlıkları koruyun.

Uyumlu sürümü derleyin, mevcut giriş/ayarları yedekleyin, statik dosyaları yayınlayın; giriş ve gerçek oturumu deneyin. API/agent ayrı güncellenir. [Durum](STATUS.md), [yayın kontrolü](PUBLIC_RELEASE.md), SECURITY ve CONTRIBUTING’i okuyun. Seçilmiş Raspberry/macOS akışları test edilmiştir; tam Windows, fiziksel mobil IME, yük/dayanıklılık, bağımsız güvenlik ve imzalı yayın kontrolleri tamamlanmış değildir.


### Kaydedilen görüntüleme tercihleri

Terminal araçlarında 8–24 px yazı boyutu seçilebilir (varsayılan 14 px). Değişiklik terminali yeniden sığdırır ve uzak satır/sütun boyutlarını günceller. Yazı boyutu, sessiz/sesli seçimi ve ses seviyesi bu tarayıcının yerel depolamasında saklanır; yeniden bağlantıda ve sayfa yenilendiğinde korunur. Tarayıcılar arasında eşitlenmez; site verileri silinirse sıfırlanır. Tarayıcının otomatik oynatma kuralı sesi başlatmak için bir dokunuş gerektirebilir.
