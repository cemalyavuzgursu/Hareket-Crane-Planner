// Kanca bloğu seçimi — kapasite + halat donanımı (reeving) kontrolü.
import { HOOK_BLOCKS, type HookBlock } from "../data/hookBlocks.js";
import { computeReeving } from "./capacity.js";

export type { HookBlock };

/** Vinç modeline ait kanca blokları (kapasiteye göre artan). Tanımsızsa boş dizi. */
export function hookBlocksFor(craneModel: string): HookBlock[] {
  return [...(HOOK_BLOCKS[craneModel] ?? [])].sort((a, b) => a.capacity_t - b.capacity_t);
}

/**
 * Bloğun alabileceği maks. halat donanım sayısı (parts of line).
 * Broşürde yayınlanmışsa (max_parts) o kullanılır. Aksi halde VARSAYIM:
 * 2 · makara sayısı (halat ucu bom başında sabitlenen çift donanım; ucu blokta
 * sabitlenen tek donanımla 2n+1 mümkün olabilir — muhafazakâr taraf 2n seçildi).
 * Makarasız tek kanca → 1 donanım.
 */
export function maxPartsFor(block: HookBlock): number {
  if (block.max_parts != null && block.max_parts > 0) return block.max_parts;
  return block.sheaves > 0 ? 2 * block.sheaves : 1;
}

export interface HookBlockSelection {
  block: HookBlock | null;
  /** Gerekli donanım sayısı = ceil(toplam yük / tek halat çekişi). */
  required_parts: number;
  /** Seçilen bloğun maks. donanımı. */
  max_parts: number | null;
  reason: string;
}

/**
 * Yeterli en küçük kanca bloğunu seç: kapasite ≥ toplam yük VE maks. donanım ≥ gerekli donanım.
 * single_line_pull_t ≤ 0 veya bilinmiyorsa donanım kontrolü yapılmaz (yalnız kapasite).
 */
export function selectHookBlock(
  craneModel: string,
  total_load_t: number,
  single_line_pull_t: number | undefined | null,
): HookBlockSelection {
  const blocks = hookBlocksFor(craneModel);
  const load = Number.isFinite(total_load_t) ? Math.max(0, total_load_t) : 0;
  const hasPull = single_line_pull_t != null && single_line_pull_t > 0;
  const required_parts = hasPull ? computeReeving(single_line_pull_t!, load, Infinity).required_parts : 1;

  if (blocks.length === 0) {
    return { block: null, required_parts, max_parts: null, reason: "Bu vinç için kanca bloğu verisi yok (broşürde bulunamadı)." };
  }
  for (const b of blocks) {
    const mp = maxPartsFor(b);
    if (b.capacity_t >= load && mp >= required_parts) {
      return {
        block: b,
        required_parts,
        max_parts: mp,
        reason: hasPull
          ? `${b.label}: kapasite ${b.capacity_t} t ≥ ${load.toFixed(1)} t; gerekli donanım ${required_parts} ≤ maks. ${mp}.`
          : `${b.label}: kapasite ${b.capacity_t} t ≥ ${load.toFixed(1)} t (tek halat çekişi bilinmiyor — donanım kontrol edilmedi).`,
      };
    }
  }
  const biggest = blocks[blocks.length - 1];
  return {
    block: null,
    required_parts,
    max_parts: maxPartsFor(biggest),
    reason: `Uygun kanca bloğu yok: yük ${load.toFixed(1)} t, gerekli donanım ${required_parts}; en büyük blok ${biggest.capacity_t} t / ${maxPartsFor(biggest)} donanım.`,
  };
}
