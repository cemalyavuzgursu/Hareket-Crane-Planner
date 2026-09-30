# Gerçekçi vinçler — veri, görsel ve hesap düzeltmeleri (2026-09-29)

Hedef: vinçler gerçekteki ölçülerle çizilsin ve hesaplansın; görünüm Liebherr
Crane Planner 2.0'a yakın olsun. Kullanıcı üç paketi (A/B/C) onayladı.

## Konvansiyon (kilitli)
- Dünya: slew merkezi orijin, +X = şasi ARKASI, +Z = yanal. Slew a → (r·cos a, r·sin a).
  0° = arka üzerinden (sol panel etiketiyle aynı, Liebherr konvansiyonu).
- Ayak köşeleri: sx=+1 arka, sx=−1 ön. Etiketler bu anlama göre düzeltilir
  (FR = ön-sağ vb.), testler yeni anlamla güncellenir; köşe yükü sayıları değişmez.
- Bom mafsalı = (−boom_offset, cribbing+machine_ground). Klerens formüllerine
  (golden) dokunulmaz; çizim bu noktadan türetilir.

## A. Veri
- `CraneDimensions` genişletilir: `slew_center_from_front_m`, `boom_sections`
  (teleskop bölüm sayısı), `boom_base_length_m`, `boom_head_height_m`,
  `outrigger_box_positions_m` (opsiyonel), `counterweight_max_t`, `color` (marka).
- LTM1250 ve LTM1160'a `dimensions` bloğu (kaynaklı; bulunamayan alan "TAHMİNİ").
- LTM'lerdeki SANY `datasheet_substitute` kopyası kaldırılır.
- Tutarlılık testleri: pivot yükseklik/konum = geometry_constants; CW yarıçapı <
  kuyruk yarıçapı; ayak açıklığı etiketi parse edilebilir; aks konumları şasi içinde.

## B. Görsel
- `src/ui/craneRig.ts`: saf fonksiyon; (CraneModel, durum, klerens) → çizim
  primitifleri (şasi, akslar, ayaklar/tablalar, üst yapı, kabin, CW plakaları,
  teleskop bom bölümleri, bom başı, kanca bloğu, halat sayısı). 2B ve 3B tek kaynak.
- `CraneSideView2D.tsx`: tüm vinçler için (SideView2D + SanySideView2D yerine).
  Slew açısına göre şasi yan/uç görünüşü, ayaklar açık (tekerlekler havada),
  arkada çalışma alanı diyagramı (radius×yükseklik ızgarası, seçili bom
  uzunluğunun ulaşım yayı, maks kanca yüksekliği eğrisi), ölçü çizgileri,
  klerens görselleştirmesi (mevcut güvenlik zarfı mantığı korunur), jib.
- `Crane3D.tsx`: craneRig'den; konik teleskop bom, kabin, CW plakaları, ayak
  kirişleri+silindir+tabla, kanca bloğu+makaralar, çoklu halat. Şasi +X=arka.
- Üstten görünüş: "ARKA ↑" etiketi, kuyruk yarıçapı dairesi.

## C. Hesap
- Kuyruk savrulma çarpışması tüm vinçlerde aktif (dimensions artık hepsinde var).
- Ayak köşe etiketleri konvansiyona göre düzeltilir.
- Denge ağırlığı yarıçapı / kuyruk yarıçapı gerçek veriden.

## Test
vitest (mevcut 879 + yeni veri/rig testleri), tsc, build, mobil sync+typecheck,
her vinç için 2B/3B tarayıcı ekran görüntüsü.
