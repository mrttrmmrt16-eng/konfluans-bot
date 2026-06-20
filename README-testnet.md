# Testnet Botu — Adım Adım Kurulum (mobil/web, SSH yok)

**Ne kuracağız:** Konfluans sistemini Binance Futures **testnet**’inde (sahte para) gerçek emirlerle çalıştıran bir bot. Hiç gerçek para riski yok. Amaç: emir mekaniğinin (giriş, stop, iz-süren stop, dolum) doğru çalıştığını görmek.

**4 büyük adım:**

1. Binance testnet hesabı + API anahtarı
1. 3 dosyayı GitHub’a koy
1. Railway’e bağla (7/24 çalışsın)
1. Anahtarları gir → logu izle

Dosyalar: **engine.js**, **bot.js**, **package.json** (üçü bir arada).

> 💸 Not: Railway ~5$/ay (küçük deneme kredisi var). Testnet parası sahtedir, ücretsiz.

-----

## ADIM 1 — Binance testnet anahtarı (sahte para)

1. Telefon tarayıcısında **<https://testnet.binancefuture.com>** aç.
1. Sağ üstten **Log In** → GitHub veya e-posta ile kayıt ol (gerçek Binance hesabından **ayrıdır**, gerçek paranla ilgisi yok).
1. Girince hesabına otomatik **test USDT** gelir (gelmezse sayfadaki faucet/“Get assets” ile al — ~15.000 test USDT yeter).
1. Alt taraftaki **API Key** sekmesine gir → **Create API Key**.
1. Çıkan **API Key** ve **Secret Key**’i bir yere kopyala (Secret bir daha gösterilmez).
- İzinlerde **Enable Futures** açık olsun. (Testnet’te para çekme yok; gerçekte ise *withdrawals* hep KAPALI olmalı — alışkanlık.)

-----

## ADIM 2 — Dosyaları GitHub’a koy

1. **<https://github.com>** → ücretsiz hesap aç / giriş yap.
1. Sağ üst **+** → **New repository**.
1. İsim ver (örn. `konfluans-bot`), **Private** seç, **Create repository**.
1. Açılan sayfada **“uploading an existing file”** bağlantısına bas.
1. **engine.js**, **bot.js**, **package.json** dosyalarını sürükle/seç (üçünü birden).
1. Altta **Commit changes** ile yükle.

> Telefondan dosya yüklemek: dosyaları önce telefonuna indir (bu sohbetten), sonra GitHub’ın “choose your files” ile seç.

-----

## ADIM 3 — Railway’e bağla (7/24 çalışsın)

1. **<https://railway.app>** → **Login with GitHub**.
1. **New Project** → **Deploy from GitHub repo** → az önceki `konfluans-bot` repo’sunu seç.
- İlk kez bağlıyorsan Railway’e repo erişimi izni ver.
1. Railway otomatik Node algılar ve `npm start` ile **bot.js**’i başlatır. (Bu bir “worker”dır — web sitesi açmaz, port istemez; “no port” uyarısı görürsen sorun değil.)

-----

## ADIM 4 — Anahtarları gir (koda ASLA yazma)

1. Railway’de projeye gir → servise tıkla → **Variables** sekmesi.
1. İki değişken ekle:
- `API_KEY` = testnet API Key’in
- `API_SECRET` = testnet Secret Key’in
1. Kaydet. Railway otomatik yeniden başlatır.

> Anahtarlar yalnız burada (gizli ortam değişkeni) durur — kodda ve GitHub’da **yok**. Doğrusu budur.

-----

## Çalışıyor mu?

Railway’de servisin **Deploy Logs / Logs** sekmesini aç. Şunları görmelisin:

```
KONFLUANS TESTNET BOTU · setSandboxMode(true) · gerçek para YOK
✓ TESTNET bağlı · bakiye 15000.00 USDT
BTCUSDT BEKLE (net -3.5) — giriş yok
ETHUSDT BEKLE (net -1.5) — giriş yok
— tur bitti · ... · sonraki kontrol ~XXX dk sonra
```

Bir sinyal oluşunca:

```
BTCUSDT GİRİŞ LONG · testnet dolum 63500.00 · miktar 0.012 · risk %2 ($300) · net 4.5
BTCUSDT stop → 62600.00
```

Sonraki 4h mumlarda `2R→başabaş`, `stop → ...` (iz sürme) ve `ÇIKIŞ ... +X.XXR` satırlarını göreceksin.

-----

## Durdurma (kill-switch)

- Railway → **Variables** → `KILL` = `1` ekle (bot bir sonraki turda kapanır), **veya**
- Servisi **Remove / Pause** et.

## Ne izle

- Bot her 4 saatte bir karar verir; sabırlı ol, ilk gerçek emir günler sürebilir.
- **Testnet P&L’i ciddiye alma** — testnet fiyatı gerçeğinden sapar. Burada baktığımız tek şey: **emirler doğru gidiyor mu** (giriş açılıyor, stop konuyor, iz sürüyor, kapanış yakalanıyor). Edge’i zaten forward-test ölçüyor.
- `bot-trades.csv` ve loglar kayıt tutar.

## Güvenlik (alışkanlık)

- Kod **setSandboxMode(true)** ile kilitli — mainnet’e (gerçek para) gidemez.
- Buraya **asla gerçek Binance anahtarı** girme. Sadece testnet anahtarı.
- Gerçek aşamada anahtar izinleri: **Futures açık, withdrawals KAPALI**, mümkünse IP kısıtlı.

## Sırada ne var

Birkaç hafta testnet’te emir mekaniği sorunsuz dönerse → **mikro canlı** (gerçek ama en küçük boyut, %0.5 risk, tek sembol BTC). O aşamada anahtar güvenliği ve kill-switch’i birlikte sıkılaştırırız.