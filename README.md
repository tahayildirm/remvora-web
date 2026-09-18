<p align="center"><img src="public/branding/remvora-logo.png" alt="Remvora" width="440"></p>

# Remvora Web

Repositories / Depolar: [Server](https://github.com/tahayildirm/remvora-server) · [Web](https://github.com/tahayildirm/remvora-web) · [Agent](https://github.com/tahayildirm/remvora-agent)

[English guide](docs/GUIDE.en.md) · [Türkçe rehber](docs/GUIDE.tr.md) · [Release checklist / Yayın kontrolü](docs/PUBLIC_RELEASE.md)

**EN:** Self-hosted remote-device management from a browser. Angular panel for Remvora Server and Remvora Agent; desktop, tablet and phone controls. MIT-licensed pre-release software, with tested paths and remaining limitations documented below. Hosting is yours; there is no default public service or shared administrator account.

**TR:** Tarayıcı üzerinden, kendi sunucunuzda çalışan uzak cihaz yönetimi. Remvora Server ve Remvora Agent için Angular panel; bilgisayar, tablet ve telefon kontrolleri. MIT lisanslı ön sürüm; doğrulanan özellikler ve kalan sınırlar rehberde belirtilmiştir. Sunucu size aittir; ortak bir yönetici hesabı veya varsayılan genel hizmet yoktur.

## Start / Başlangıç

1. Install Remvora Server, choose the database, migrate and bootstrap your first Owner. / Sunucuyu kurun, veritabanını seçin, migration ve ilk Owner kurulumunu yapın.
2. Build this panel using Node.js 24: `npm ci`, `npm run build`. Serve `dist/remvora-web/browser` over HTTPS. / Derleme çıktısını HTTPS üzerinden sunun.
3. Enroll, approve and activate each Remvora Agent. / Her agenti kaydedin, onaylayın ve etkinleştirin.
4. Sign in with email/password; create additional users from Users. / E-posta ve parolayla giriş yapın; Kullanıcılar bölümünden yeni hesaplar oluşturun.

The Server repository owns installation/bootstrap and database instructions; the Agent repository owns device installation. Keep the three repositories separate. This repository never needs database credentials.

Sunucu deposu kurulum/ilk yönetici/veritabanı belgelerini, Agent deposu cihaz kurulumunu içerir. Üç depo ayrı tutulur. Bu panel veritabanı parolasına ihtiyaç duymaz.

## Validation / Doğrulama

`npm run lint` · `npm run format:check` · `npm test -- --watch=false` · `npm run build`

See [status](docs/STATUS.md), [security](SECURITY.md), [contributing](CONTRIBUTING.md), [third-party notices](THIRD_PARTY_NOTICES.md), [MIT license](LICENSE).
