# Hareket Crane Planner — Saha Mobil Uygulaması

Saha personeli için sadeleştirilmiş mobil uygulama (Expo / React Native).
Crangle tarzı: hızlı, dokunmatik dostu, sahada gerekli olan üç şey:

- **2D yandan görünüş** — bom açısı, radius, engel klerensi
- **Ağırlık merkezi (CoG)** — 4 ayak yükü + devrilme kontrolü (üstten plan)
- **Çarpışma** — bom / yük klerens uyarıları

> Masaüstü ve web uygulamalarına dokunulmaz. Hesap çekirdeği (`../src/engine`)
> **tek kaynaktır** ve buraya kopyalanarak paylaşılır — hesaplar birebir aynıdır.

## Mimari

```
mobile/
├─ App.tsx                 Sekmeli arayüz (Girdiler · 2D · CoG · Çarpışma)
├─ src/
│  ├─ state.ts             Girdi durumu + varsayılanlar
│  ├─ theme.ts             Renk paleti (koyu CAD teması)
│  ├─ components/          RN-SVG çizimler + dokunmatik kontroller
│  │  ├─ SideView2D.tsx
│  │  ├─ GroundForceDiagram.tsx
│  │  └─ Controls.tsx
│  └─ shared/              ⚙ OTOMATİK ÜRETİLİR (git'e girmez)
│     ├─ engine/           ../../src/engine kopyası (.js uzantıları sıyrılmış)
│     ├─ data/             ../../src/data kopyası (vinç JSON'ları)
│     └─ cranes.ts         vinç kayıt defteri
└─ scripts/sync-shared.mjs Engine + veriyi ana repodan senkronlar
```

`src/shared/` her `npm start` / `npm run android` / `npm run typecheck` öncesi
otomatik üretilir (`pre*` script'leri). Elle güncellemek için: `npm run sync`.
Ana repodaki engine değişince tekrar sync yeter — mobilde kod tekrarı yok.

## Kurulum & test

```bash
cd mobile
npm install
npm start          # Metro başlar, QR kod verir
```

Telefonda **Expo Go** uygulamasını kur (App Store / Play Store), aynı Wi-Fi
ağında QR kodu okut → uygulama anında telefonda açılır. Kod değişince canlı yenilenir.

- Android emülatör: `npm run android`
- iOS simülatör (Mac): `npm run ios`

## Dağıtım (APK / IPA)

EAS Build ile bulutta derlenir (yerel Android Studio / Xcode gerekmez):

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform android --profile preview   # sahaya dağıtılabilir APK
eas build --platform ios --profile preview        # TestFlight için IPA
```

Android APK doğrudan paylaşılabilir (Play Store gerekmez). iOS için TestFlight
veya App Store gerekir.

## Doğrulama

- `npm run typecheck` — TypeScript (tsc) temiz
- `npm run export` — Metro production bundle'ı üretir (import çözümlemesi doğrulanır)
