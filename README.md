# Hareket Crane Planner

Ağır nakliyat firması için vinç kaldırma planlama uygulaması. Mevcut Excel
("VN PROGRAMI" / `Autocrane.xls`) hesaplarını birebir yapan, tarayıcıda çalışan
masaüstü/web uygulaması.

> ⚠ Bu plan üreticinin gerçek load chart'ına dayanır ancak **yetkili kaldırma
> mühendisi tarafından manuel olarak doğrulanmalıdır**. Uygulama karar otoritesi değildir.

## Çalıştırma

```bash
npm install
npm run dev        # tarayıcıda http://localhost:5173
npm test           # hesap çekirdeği testleri (35 test)
npm run build      # production build
npm run typecheck  # tip kontrolü
```

## Mimari

```
src/
  engine/          # Saf, UI'dan bağımsız hesap çekirdeği (test edilebilir)
    capacity.ts    # (A) load_chart_lookup + doğrusal interpolasyon + kapasite kontrolü
    clearance.ts   # (B) 2D geometri/klerens (Excel formülleriyle birebir)
    outrigger.ts   # (C) ayak reaksiyonu (slew taraması) + zemin basıncı
    index.ts       # computeLift / computeLiftFull
    types.ts
  data/            # Vinç JSON'ları (Excel'den çıkarıldı) + kayıt defteri
    ltm1250.json   # LIEBHERR LTM 1250  ('LT 1250' sayfası)
    ltm1160.json   # LIEBHERR LTM 1160  ('LT 1160' sayfası, sheave_offset=1.321)
  ui/              # React arayüzü
    ConfigSidebar  # vinç/denge/bom/ayak/% seçimi
    InputForm      # yük + geometri girdileri
    ResultsPanel   # kapasite gauge, klerens, geometri, ayak yükleri, PDF butonu
    SideView2D     # 2D yandan görünüş (SVG)
    Crane3D        # 3D parametrik vinç (three.js / react-three-fiber)
    report.ts      # jsPDF lift plan raporu
  __tests__/       # golden (1250 + 1160), interpolasyon, outrigger testleri
```

## Doğrulama (GOLDEN TEST)

Çekirdek, Excel'in kendi hücre çıktılarına karşı doğrulanmıştır. Değerler
±0.01 toleransı çok aşan biçimde **~15 hane tam** örtüşür (örn. utilization
104.65346534653466). İki vinç senaryosu test edilir:

| Büyüklük | LTM 1250 | LTM 1160 |
|---|---|---|
| total_load | 105.70 | 96.70 |
| rated_capacity | 101.00 | 125.00 |
| utilization_pct | 104.65 (AŞIM) | 77.36 (UYGUN) |
| max_hook_height | 13.4104 | 14.1583 |
| clearance_to_obstacle | 8.7339 | 6.3470 |
| clearance_to_load | 1.2198 | -1.2313 (negatif → çarpma) |

## Veri kaynakları

- **Load chart + geometri:** `Autocrane.xls` ('LT 1250' ve 'LT 1160' sayfaları).
  85% tablo tüm bomlar için çıkarıldı; radius ara değerleri kod interpolasyonu.
- **Eksik değerler (self_weight):** `Sany_crane-brochure_SAC2500E.pdf` (sınıf olarak
  en yakın 250t vinç) brüt ağırlığından 60t — ayak reaksiyonu hesabı için. Her vinç
  JSON'unda `datasheet_substitute` alanında kaynak belirtilir.

## Fazlar (tamamı tamam)

- ✅ Faz 1 — Hesap çekirdeği + golden test
- ✅ Faz 2 — Load chart interpolasyonu + 2. vinç (LTM 1160)
- ✅ Faz 3 — Web UI + 2D SVG yandan çizim + PDF rapor
- ✅ Faz 4 — Ayak (outrigger) reaksiyonu + zemin basıncı
- ✅ Faz 5 — three.js ile 3D görselleştirme

## Tasarım

UI tasarımı Stitch ile üretildi (`design/stitch/`); palet (amber/turuncu, koyu slate),
Hanken Grotesk font ve dashboard düzeni oradan alındı.
