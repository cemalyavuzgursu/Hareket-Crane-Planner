// Kanca bloğu (hook block) kütüphanesi — vinç modeline göre.
// YALNIZCA üretici datasheet/broşür değerleri. Bilinmeyen değer UYDURULMAZ.

export interface HookBlock {
  id: string;
  label: string;
  /** Blok nominal kapasitesi (t). */
  capacity_t: number;
  /** Blok makara sayısı. */
  sheaves: number;
  /** Blok ağırlığı (t). */
  weight_t: number;
  /** Maks. halat donanım sayısı (parts of line) — broşürde yayınlanmışsa. Yoksa 2·makara varsayılır. */
  max_parts?: number;
  source: string;
}

const LTM1160_SRC = "Liebherr LTM 1160 datasheet (1986), TP 56 g — kanca blokları tablosu";
const LTM1250_SRC = "Liebherr LTM 1250/1 (Sarens broşürü) — LTM 1250 için doğrulanmış tablo yok";
const SAC2500E_SRC = "SANY SAC2500E broşürü, s.15 'Hook' tablosu (makara / halat donanımı / ağırlık kg)";

export const HOOK_BLOCKS: Record<string, HookBlock[]> = {
  "LIEBHERR LTM 1160": [
    { id: "ltm1160-160", label: "160 t — 8 makara", capacity_t: 160, sheaves: 8, weight_t: 1.98, source: LTM1160_SRC },
    { id: "ltm1160-130", label: "130 t — 7 makara", capacity_t: 130, sheaves: 7, weight_t: 1.51, source: LTM1160_SRC },
    { id: "ltm1160-100", label: "100 t — 5 makara", capacity_t: 100, sheaves: 5, weight_t: 1.25, source: LTM1160_SRC },
    { id: "ltm1160-65", label: "65 t — 3 makara", capacity_t: 65, sheaves: 3, weight_t: 0.93, source: LTM1160_SRC },
    { id: "ltm1160-30", label: "30 t — 1 makara", capacity_t: 30, sheaves: 1, weight_t: 0.59, source: LTM1160_SRC },
    { id: "ltm1160-10", label: "10 t — tek kanca", capacity_t: 10, sheaves: 0, weight_t: 0.26, source: LTM1160_SRC },
  ],
  "LIEBHERR LTM 1250": [
    { id: "ltm1250-108", label: "108 t — 5 makara (LTM 1250/1)", capacity_t: 108, sheaves: 5, weight_t: 1.45, source: LTM1250_SRC },
    { id: "ltm1250-32", label: "32 t — 1 makara (LTM 1250/1)", capacity_t: 32, sheaves: 1, weight_t: 0.87, source: LTM1250_SRC },
  ],
  // SANY broşür tablosu: kanca | (kapasite sütunu, anlamı belirsiz — alınmadı) | makara | donanım | ağırlık kg
  //   160t ramshorn 7 / 14 / 1538; 125t ramshorn 5 / 11 / 1122; 80t ramshorn 3 / 7 / 685;
  //   32t 1 / 3 / 487; 12.5t top kanca 0 / 1 / 270. (32t, 125t, 160t opsiyonel.)
  "SANY SAC2500E": [
    { id: "sac2500e-160", label: "160 t — 7 makara (opsiyonel)", capacity_t: 160, sheaves: 7, max_parts: 14, weight_t: 1.538, source: SAC2500E_SRC },
    { id: "sac2500e-125", label: "125 t — 5 makara (opsiyonel)", capacity_t: 125, sheaves: 5, max_parts: 11, weight_t: 1.122, source: SAC2500E_SRC },
    { id: "sac2500e-80", label: "80 t — 3 makara", capacity_t: 80, sheaves: 3, max_parts: 7, weight_t: 0.685, source: SAC2500E_SRC },
    { id: "sac2500e-32", label: "32 t — 1 makara (opsiyonel)", capacity_t: 32, sheaves: 1, max_parts: 3, weight_t: 0.487, source: SAC2500E_SRC },
    { id: "sac2500e-12.5", label: "12,5 t — top kanca", capacity_t: 12.5, sheaves: 0, max_parts: 1, weight_t: 0.27, source: SAC2500E_SRC },
  ],
};
