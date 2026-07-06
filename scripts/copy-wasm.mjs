/**
 * copy-wasm.mjs — web-ifc'nin WASM ikililerini public/wasm/ altına kopyalar.
 *
 * Neden: IFC import sahada (internetsiz) çalışmalı. web-ifc varsayılan olarak
 * WASM'ı unpkg CDN'den çeker; bunun yerine paketlenmiş uygulamayla birlikte
 * giden yerel bir kopya kullanıyoruz (bkz. src/ui/bimImport.ts).
 *
 * public/wasm/ üretilmiş dosyalardan oluştuğu için repoya girmez (.gitignore);
 * bu script her dev/build öncesi (package.json "pre*" script'leri) çalışır.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(rootDir, "node_modules", "web-ifc");
const destDir = join(rootDir, "public", "wasm");

// web-ifc-node.wasm hariç: yalnızca tarayıcıda kullanılanlar.
const files = ["web-ifc.wasm", "web-ifc-mt.wasm"];

mkdirSync(destDir, { recursive: true });

for (const file of files) {
  const src = join(srcDir, file);
  if (!existsSync(src)) {
    console.warn(`[copy-wasm] atlandı (bulunamadı): ${src}`);
    continue;
  }
  copyFileSync(src, join(destDir, file));
}

console.log(`[copy-wasm] web-ifc WASM dosyaları public/wasm/ altına kopyalandı.`);
