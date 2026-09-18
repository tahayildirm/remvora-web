<p align="center"><img src="public/branding/remvora-logo.png" alt="Remvora" width="440"></p>

# Remvora Web — tarayıcıdan uzak masaüstü / remote desktop in your browser

**TR:** Bilgisayar, tablet veya telefonunuzdan uzak cihazın ekranını açın, terminal kullanın, dosya aktarın ve ekibinizin erişimini yönetin. MIT lisanslı Remvora'nın mobil uyumlu Angular paneli; **uygun paylaşımlı hosting üzerinde de kullanılabilir**.

**EN:** Open a remote device's desktop, use its terminal, transfer files and manage team access from your computer, tablet or phone. The mobile-friendly Angular panel for MIT-licensed Remvora, **deployable with compatible shared hosting**.

[Server / API](https://github.com/tahayildirm/remvora-server) · [Web](https://github.com/tahayildirm/remvora-web) · [Agent](https://github.com/tahayildirm/remvora-agent)

| Rehber / Guide | Türkçe | English |
|---|---|---|
| Panel kurulumu ve kullanımı / Panel setup and usage | [Türkçe rehber](docs/GUIDE.tr.md) | [English guide](docs/GUIDE.en.md) |
| DB ve ilk hesap / Database and first account | [İlk kurulum](https://github.com/tahayildirm/remvora-server/blob/main/docs/FIRST_INSTALL.tr.md) | [First installation](https://github.com/tahayildirm/remvora-server/blob/main/docs/FIRST_INSTALL.en.md) |

## Türkçe

### Nedir, kim kullanır?

Remvora; BT/destek ekipleri, okullar, kiosk yöneticileri, şubeli işletmeler ve Raspberry Pi kullanıcıları için kendi sunucunuzda çalışan uzak masaüstü ve cihaz yönetimidir. Operatörün ayrı masaüstü uygulaması kurması gerekmez; tarayıcı yeterlidir. Yönetilen cihazda Remvora Agent gerekir.

RDP benzeri kullanım sunar; **Microsoft RDP protokolü veya mstsc istemcisiyle uyumlu bir RDP sunucusu değildir**. Bağlantı WebRTC P2P'yi önce dener; mümkün değilse Remvora API üzerinden WSS relay kullanır. Ekranda bağlantı türünü ve kurulma ilerlemesini görebilirsiniz.

### Panelde neler var?

| Alan | Özellikler |
|---|---|
| Masaüstü | Görüntü, fare/klavye, kısayollar, desteklenen ekran seçimi, açılır araçlar ve tam ekran |
| Görüntü kalitesi | Bağlantıya uyarlanan FPS/bitrate/çözünürlük ve elle seçim; cihaz bazında hatırlanan tercihler |
| Mobil kullanım | Varsayılan doğrudan dokunma, isteğe bağlı touchpad, iki parmak yakınlaştırma/kaydırma; dikeyde altta, yatayda yanda araçlar |
| Terminal | Gerçek uzak shell, dizin istemi, yardımcı Ctrl/Alt/Tab/Esc/yön tuşları, 8–24 px yazı boyutu (varsayılan 14) |
| Ses | Desteklenen cihazdan sistem sesi, ses seviyesi; sessiz/sesli tercihini tarayıcıda saklama |
| Pano ve dosyalar | Açık izinle metin okuma/yapıştırma; paylaşılan klasöre iki yönlü dosya aktarımı ve uygun tarayıcıda sürükleme/dosya yapıştırma |
| Cihazlar | Kayıt/onay, gerçek çevrimiçi durum, etiket/grup/konum bilgileri, revoke ve iki teyitli kalıcı silme |
| Kullanıcılar | Organizasyon seçimi, rol ve grup kapsamı, kullanıcı yönetimi, profil ve parola değişikliği |
| Güvenlik | TOTP, kurtarma kodları, API anahtarları ve işlem geçmişi |
| Tercihler | Türkçe/İngilizce, terminal yazı boyutu, ses ve cihaz görüntü ayarlarının aynı tarayıcıda korunması |

Ses ilk kullanımda sessizdir; sonrasında tercihiniz hatırlanır. Tarayıcı otomatik ses için dokunma isteyebilir. Dosya yapıştırma OS dosya panosu eşitlemesi değildir; izinli klasöre transferdir. Bazı klavye kombinasyonları ve tam ekran/adres çubuğu davranışı tarayıcı/işletim sistemi tarafından belirlenir. Tercihler farklı tarayıcılar arasında eşitlenmez.

### Paylaşımlı hosting ve kurulum

Bu depo statik HTML/JS/CSS üretir; paneli HTTPS sağlayan statik hostingde sunabilirsiniz. Node.js **yalnız derleme için** gerekir. API ayrı uygulamadır: uygun .NET 10, WebSocket, veritabanı ve ilk kurulum komutlarını çalıştırma desteği olan Windows IIS/Plesk paylaşımlı hostingde barındırılabilir. VPS zorunlu değildir; her hosting paketi uygun değildir.

1. [Server ilk kurulumunu](https://github.com/tahayildirm/remvora-server/blob/main/docs/FIRST_INSTALL.tr.md) tamamlayın: boş DB → ayarlar → migration → ilk Owner.
2. Node.js 24/npm ile aşağıdaki komutları çalıştırın; gerçek API adresinizi verin.
3. `dist/remvora-web-panel.zip` içeriğini yalnız panel sitesine yükleyin. DB şifresi veya API gizli ayarlarını bu depoya/panele koymayın.
4. Owner e-posta/parolasıyla giriş yapın. Sonraki hesapları **Kullanıcılar** bölümünde oluşturun; mevcut organizasyonu panel içinde seçin.
5. [Agent rehberiyle](https://github.com/tahayildirm/remvora-agent/blob/main/docs/GUIDE.tr.md) cihazı kaydedin/onaylayın/etkinleştirin. Masaüstü veya Terminal açın.

```sh
git clone https://github.com/tahayildirm/remvora-web.git
cd remvora-web
npm ci
npm run build
python3 scripts/package-windows.py --api-origin https://api.example.com
```

Paketleme Python 3 ister. IIS dışındaki statik sunucular için `dist/remvora-web/browser` çıktısını sunun; API origin metadata ve SPA fallback ayarlarını [rehbere](docs/GUIDE.tr.md) göre yapın. Yalnız paneli yüklemek API'yi veya ilk hesabı oluşturmaz.

## English

### Who is it for?

Remvora is self-hosted remote desktop and device management for IT/support teams, schools, kiosk operators, distributed businesses and Raspberry Pi users. Operators need only a browser; managed devices run Remvora Agent.

It serves an RDP-style use case but **does not implement Microsoft's RDP protocol or provide an mstsc endpoint**. WebRTC P2P is attempted first, with WSS relay through your API when direct connectivity fails. Connection progress and the current transport are visible.

### Features

| Area | Capabilities |
|---|---|
| Desktop | Video, mouse/keyboard, shortcuts, supported monitor selection, collapsible tools and fullscreen |
| Video quality | Adaptive FPS/bitrate/resolution or manual controls; remembered per-device choices |
| Phone/tablet | Direct touch by default, optional touchpad, pinch zoom/pan; bottom tools in portrait and side tools in landscape |
| Terminal | Real remote shell, directory prompt, Ctrl/Alt/Tab/Esc/arrow helpers and 8–24 px font (14 by default) |
| Audio | Supported-device system sound, volume control and remembered mute/unmute preference |
| Clipboard/files | Explicit text read/paste; two-way shared-folder file transfer and supported browser drop/file-paste |
| Devices | Enrollment/approval, actual online presence, tags/groups/location, revocation and twice-confirmed permanent deletion |
| Accounts | In-panel organization selection, roles/group scope, user administration and profile/password changes |
| Security | TOTP, recovery codes, API keys and audit history |
| Preferences | Turkish/English, terminal font, audio and device video settings retained in the same browser |

Audio starts muted on first use; later choices persist, subject to browser playback gestures. File paste transfers to an allowed directory rather than synchronizing the OS file clipboard. Browser/OS policies govern reserved shortcuts, fullscreen and address-bar behavior. Preferences do not sync across browsers.

### Shared hosting and installation

This repository produces static HTML/JS/CSS for HTTPS hosting. Node.js is required **at build time only**. The separate API can run on compatible Windows IIS/Plesk shared hosting with .NET 10, WebSockets, a supported database and permission to execute initial setup commands. A VPS is not mandatory; not every hosting plan qualifies.

1. Complete [Server installation](https://github.com/tahayildirm/remvora-server/blob/main/docs/FIRST_INSTALL.en.md): empty database → configuration → migration → first Owner.
2. Run the build commands above with Node.js 24/npm and Python 3; replace the API origin.
3. Upload `dist/remvora-web-panel.zip` contents only to the panel site. Never include database credentials or API secrets.
4. Sign in with your Owner email/password. Add later accounts through **Users** and select your existing organization inside the panel.
5. Follow the [Agent guide](https://github.com/tahayildirm/remvora-agent/blob/main/docs/GUIDE.en.md) to enroll/approve/activate a device, then open Desktop or Terminal.

For non-IIS static hosting, serve `dist/remvora-web/browser` and configure API-origin metadata and SPA fallback as described in the [guide](docs/GUIDE.en.md). Uploading the panel alone does not create the API or first account.

## Status, limits and validation / Durum, sınırlar ve doğrulama

**TR:** MIT lisanslı ön sürüm. Özellikler agent işletim sistemi/yerel izinlerine bağlıdır. Her ağda P2P garantisi yoktur; relay performansı hosting ve ağ kapasitesine bağlıdır. WSS relay sunucunun göremediği uçtan uca şifreleme değildir. Ayrıntılar [durum belgesinde](docs/STATUS.md).

**EN:** MIT-licensed pre-release. Capabilities depend on agent OS support/local permissions. P2P is not guaranteed across every network; relay performance depends on hosting and access links. WSS relay is not server-blind end-to-end encryption. See [status](docs/STATUS.md).

`npm run lint` · `npm run format:check` · `npm test -- --watch=false` · `npm run build`

[Release checklist](docs/PUBLIC_RELEASE.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Third-party notices](THIRD_PARTY_NOTICES.md) · [MIT](LICENSE)
