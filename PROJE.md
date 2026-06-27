# Vinç Kaldırma Planlama Uygulaması — Proje Brief'i (Claude Code için)

> Bu dosya Claude Code'a verilecek başlangıç talimatıdır. Amaç: ağır nakliyat
> firmasının mevcut Excel ("VN PROGRAMI") ile yaptığı vinç kaldırma
> hesaplarını yapan bir **masaüstü uygulaması** geliştirmek.
> Kullanıcılar: sahada personel + ofiste mühendisler.

---

## 0. Çalışma sırası (ÖNEMLİ)

1. Önce **hesap çekirdeğini** (saf fonksiyonlar, UI yok) yaz.
2. Çekirdeği aşağıdaki **GOLDEN TEST** değerlerine karşı doğrula. Geçmeden UI'a geçme.
3. Sonra **veri katmanı** (vinç JSON'ları) + datasheet → JSON dönüşümü.
4. En son **masaüstü UI** + 2D yandan çizim + PDF rapor.

Güvenlik kritik bir hesap olduğu için: uygulama üreticinin gerçek load chart'ını
kullanır, çıktı **yetkili kaldırma mühendisinin doğrulayacağı** bir plandır,
karar otoritesi değildir. Her raporda "manuel doğrulama gerekir" notu olmalı.

---

## 1. Teknoloji

- **Tauri + React + TypeScript** (ileride three.js ile 3D görselleştirme eklenebilir).
- Alternatif kabul edilir: Python + PySide6 + PyInstaller. Ama tek stack seç, sonradan değiştirme.
- Hesap motoru tamamen UI'dan bağımsız, saf/test edilebilir modüller olsun.
- PDF rapor üretimi (lift plan çıktısı).

---

## 2. HESAP MANTIĞI (mevcut Excel'den çözüldü — birebir uygula)

İki ana iş var: **(A) Kapasite kontrolü** ve **(B) Klerens/geometri**.
Ayrıca Excel'de OLMAYAN ama istenen **(C) Ayak (outrigger) reaksiyonu** eklenecek.

### Girdiler

```
load_weight        # yük ağırlığı (t)
hook_weight        # koça/hook block (t)
rigging_weight     # kaldırma ekipmanı (t)
load_height        # yükün yüksekliği (m)
load_diameter      # yükün çapı (m)
obstacle_height    # engel yüksekliği (m)
obstacle_distance  # engel üzerindeki yatay uzaklık (m)
boom_length        # bom uzunluğu (m)
radius             # radius (m)
counterweight      # denge ağırlığı (t) — bu vinçte 0 veya 40
capacity_pct       # kapasite oranı (%) — 75 veya 85
outrigger_config   # ayak açıklığı (ör. "10,2x10,6")
slew_angle         # dönme açısı (°), 0=arka
```

### Vinçe özgü geometri sabitleri (datasheet'ten gelir; bu vinç için örnek)

```
cribbing_height      = 0.30   # takoz yüksekliği
machine_ground_height= 3.475  # makinenin yerden yüksekliği
boom_offset          = 3.33   # bomun yatay ofseti (slew merkezi → bom dibi)
sheave_diameter      = 0.417  # makara çapı
hook_height          = 1.00   # koça yüksekliği
sheave_offset        = 1.391  # makara ofseti
boom_thickness       = 1.25   # bom kalınlığı (klerens payı)
```

### (A) KAPASİTE KONTROLÜ

```
total_load = load_weight + hook_weight + rigging_weight

# Load chart'tan izin verilen kapasite okunur:
#   - counterweight'e göre tablo seçilir (0t tablosu / 40t tablosu)
#   - boom_length'e göre sütun (kapasite eğrisi) seçilir
#   - capacity_pct varyantı (75% / 85%) seçilir
#   - radius değerine göre kapasite okunur, ARA DEĞERLER DOĞRUSAL İNTERPOLE edilir
rated_capacity = load_chart_lookup(counterweight, boom_length, capacity_pct, radius)

utilization_pct = total_load / rated_capacity * 100
status = "KAPASİTE AŞIMI" if utilization_pct > 100 else "UYGUN"
```

> Not: Excel bunu VLOOKUP + sütun indeksiyle yapıyor ama o yapı kırılgan.
> Sen load chart'ı temiz veri modeliyle (aşağıdaki JSON) sakla ve interpolasyonu
> kendin yap. Mantık yukarıdaki gibi olmalı.

### (B) KLERENS / GEOMETRİ (2D yandan görünüş, trigonometri)

Açılar radyan. Excel formülleriyle birebir aynı:

```
alfa  = atan(sheave_offset / boom_length)
z     = boom_length / cos(alfa)
gama  = acos((radius + boom_offset) / z)          # bom yükselme açısı

# Maksimum koça yüksekliği:
max_hook_height = z*sin(gama) + cribbing_height + machine_ground_height
                  - sheave_diameter - hook_height

# Maksimum sapan aralığı (yük üstü dikey boşluk):
max_sling_spread = z*sin(gama) - sheave_diameter - hook_height
                   - load_height - obstacle_height
                   + machine_ground_height + cribbing_height

# Boma ENGEL klerensi:
beta = atan((obstacle_height - machine_ground_height - cribbing_height)
            / (boom_offset + radius - obstacle_distance))
L    = (radius + boom_offset - obstacle_distance) / cos(beta)
clearance_to_obstacle = L*sin(alfa + gama - beta) - boom_thickness

# Boma YÜK klerensi:
teta = atan((load_height + obstacle_height - cribbing_height - machine_ground_height)
            / (radius - load_diameter + boom_offset))
k    = (load_height + obstacle_height - machine_ground_height - cribbing_height) / sin(teta)
clearance_to_load = k*sin(alfa + gama - teta) - boom_thickness

# Excel kuralı: load_height 0 ise yük klerensi = engel klerensi
final_clearance_to_load = clearance_to_obstacle if load_height == 0 else clearance_to_load
```

**Yorum:** Klerens değeri pozitifse bom geçer, **negatif/0'a yakınsa çarpar**.
UI'da klerens < 0 ise kırmızı uyarı ver.

### (C) AYAK (OUTRIGGER) REAKSİYONU — YENİ, Excel'de yok

Babanın istediği "her ayağa düşen maks yük, açıya göre" hesabı. Standart statik:

```
# Bileşke düşey kuvvet:
V = crane_self_weight + counterweight + total_load     # (datasheet'ten self weight)

# Üst yapı slew_angle kadar döndükçe yükün yatay konumu ayak dikdörtgeni içinde
# döner; bileşke ağırlık merkezi (e_x, e_y) kayar. Eksantrik yüklü temel mantığı:
P_corner = V/4 * (1 ± 2*e_x/Lx ± 2*e_y/Ly)

# Lx, Ly = ayak açıklıkları (outrigger_config'ten).
# e_x, e_y = bileşke CoG'nin merkeze göre kayması; yükün katkısı:
#   load_offset_x = radius * cos(slew_angle)
#   load_offset_y = radius * sin(slew_angle)
# Her ayak için 4 kombinasyon hesaplanır, en büyük P bulunur.
# 0–360° taranıp en kritik açı/ayak raporlanır.
# Sonuç ayrıca zemin taşıma gücü (takoz altı basınç = P / takoz_alanı) ile kıyaslanır.
```

> Bunun için datasheet'ten **crane_self_weight**, **counterweight CoG konumu** ve
> **slew merkezi** verileri gerekir. Bu verileri vinç JSON'una ekle (aşağıya alan açtım).

---

## 3. VERİ MODELİ (her vinç bir JSON)

```jsonc
{
  "model": "LIEBHERR LTM 1250",
  "geometry_constants": {
    "cribbing_height": 0.30,
    "machine_ground_height": 3.475,
    "boom_offset": 3.33,
    "sheave_diameter": 0.417,
    "hook_height": 1.00,
    "sheave_offset": 1.391,
    "boom_thickness": 1.25
  },
  "self_weight": null,              // datasheet'ten doldurulacak (ayak hesabı için)
  "counterweight_options": [0, 40], // t
  "boom_lengths": [16.5, 29.4, 29.41, 42.2, 48.6, 55.0],
  "outrigger_configs": ["10,2x10,6"],
  "load_chart": {
    // counterweight -> capacity_pct -> boom_length -> [ [radius, capacity], ... ]
    "40": {
      "85": {
        "16.5": [[3,275],[4,220],[5,176],[6,148], "..."]
        // ÜRETİCİ DATASHEET'İNDEN doldurulacak
      },
      "75": { "...": "..." }
    },
    "0": { "...": "..." }
  }
}
```

Datasheet PDF'leri repoda `/datasheets/` altında olacak. Görevin: her datasheet'ten
load chart'ı yukarıdaki şemaya çıkarmak. Üreticinin yayınladığı radius noktalarını
gir; ara değerleri kod interpolasyonla bulacak (sen tabloya ara değer yazma).

---

## 4. MODÜLLER

1. `engine/capacity.ts` — load_chart_lookup + interpolasyon + kapasite kontrolü
2. `engine/clearance.ts` — yukarıdaki 2D geometri
3. `engine/outrigger.ts` — ayak reaksiyonu (slew taraması) + zemin basıncı
4. `engine/report.ts` — PDF lift plan
5. `data/` — vinç JSON'ları + datasheet → JSON dönüştürücü
6. `ui/` — vinç/konfig seçimi, girdi formu, sonuç paneli, 2D yandan çizim (SVG)

---

## 5. UI AKIŞI

Vinç seç → denge ağırlığı → bom konfig → ayak açıklığı →
yük gir (ağırlık + koça + rigging + boyutlar) → radius + engel gir →
**SONUÇ PANELİ**:
- Kapasite kullanım % (geç/kaldı, renkli)
- Maks koça yüksekliği, maks sapan aralığı
- Boma engel klerensi, boma yük klerensi (negatifse kırmızı)
- Her ayağa düşen maks yük + kritik slew açısı
- 2D yandan görünüş çizimi (bom açısı, engel, yük, klerenslar)
- "PDF rapor oluştur" butonu

---

## 6. GOLDEN TEST (çekirdeği bununla doğrula)

Girdi: load=105, hook=0.5, rigging=0.2, load_height=4.25, load_diameter=6.32,
obstacle_height=2.3, obstacle_distance=0, boom_length=16.5, radius=9,
counterweight=40, capacity_pct=85, sabitler yukarıdaki gibi.

Beklenen sonuçlar (Excel'in kendi çıktısı, tolerans ±0.01):

| Büyüklük                       | Beklenen   |
|--------------------------------|------------|
| total_load                     | 105.7      |
| rated_capacity                 | 101.0      |
| utilization_pct                | 104.65     |
| status                         | KAPASİTE AŞIMI |
| alfa (rad)                     | 0.08410    |
| gama (rad)                     | 0.73081    |
| max_hook_height (m)            | 13.4104    |
| max_sling_spread (m)           | 6.8604     |
| clearance_to_obstacle (m)      | 8.7339     |
| clearance_to_load (m)          | 1.2198     |

Bu sayılar tutmadan UI'a geçme.

---

## 7. Fazlar

- **Faz 1:** Çekirdek + golden test geçer (tek vinç, tek konfig).
- **Faz 2:** Load chart interpolasyonu + tüm bom/denge/% kombinasyonları + 2. vinç (LTM 1160).
- **Faz 3:** Masaüstü UI + 2D çizim + PDF rapor.
- **Faz 4:** Ayak reaksiyonu + zemin basıncı.
- **Faz 5 (opsiyonel):** three.js ile 3D görselleştirme.
