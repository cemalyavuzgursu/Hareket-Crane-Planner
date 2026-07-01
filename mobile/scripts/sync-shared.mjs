// Paylaşılan hesap çekirdeğini (engine) ve vinç verisini ana repodan mobile'a kopyalar.
//
// Tek kaynak: ../../src/engine ve ../../src/data (masaüstü/web ile ortak).
// Metro (React Native paketleyici) TS dosyalarına yapılan `./x.js` biçimli
// ESM uzantılı importları çözemez; bu script kopyalarken `.js` uzantısını sıyırır.
//
// Çıktı: mobile/src/shared/{engine,data}  (git'e girmez; build öncesi üretilir)

import { readdir, readFile, writeFile, mkdir, rm, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const srcEngine = join(repoRoot, "src", "engine");
const srcData = join(repoRoot, "src", "data");
const outRoot = resolve(__dirname, "..", "src", "shared");
const outEngine = join(outRoot, "engine");
const outData = join(outRoot, "data");

const HEADER =
  "// OTOMATİK ÜRETİLDİ — elle düzenlemeyin. Kaynak: ../../../src/engine\n" +
  "// Güncelleme: mobile/ içinde `npm run sync` (veya `npm start`).\n\n";

/** Göreli import/export specifier'larındaki `.js` uzantısını kaldırır. */
function stripJsExtensions(code) {
  return code.replace(
    /(from\s+["']|import\s*\(\s*["'])(\.\.?\/[^"']+?)\.js(["'])/g,
    "$1$2$3",
  );
}

async function syncEngine() {
  await rm(outEngine, { recursive: true, force: true });
  await mkdir(outEngine, { recursive: true });
  const files = (await readdir(srcEngine)).filter((f) => f.endsWith(".ts"));
  for (const f of files) {
    const raw = await readFile(join(srcEngine, f), "utf8");
    await writeFile(join(outEngine, f), HEADER + stripJsExtensions(raw), "utf8");
  }
  return files.length;
}

async function syncData() {
  await rm(outData, { recursive: true, force: true });
  await mkdir(outData, { recursive: true });
  const files = (await readdir(srcData)).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    await copyFile(join(srcData, f), join(outData, f));
  }

  // Vinç kayıt defteri (uzantısız importlarla — Metro uyumlu).
  const imports = files
    .map((f, i) => `import c${i} from "./data/${f}";`)
    .join("\n");
  const list = files.map((_, i) => `  c${i} as unknown as CraneModel,`).join("\n");
  const cranesTs =
    HEADER +
    `import type { CraneModel } from "./engine/types";\n${imports}\n\n` +
    `export const CRANES: CraneModel[] = [\n${list}\n];\n\n` +
    `export function getCrane(model: string): CraneModel {\n` +
    `  const c = CRANES.find((c) => c.model === model);\n` +
    `  if (!c) throw new Error("Vinç bulunamadı: " + model);\n` +
    `  return c;\n}\n`;
  await writeFile(join(outRoot, "cranes.ts"), cranesTs, "utf8");
  return files.length;
}

await mkdir(outRoot, { recursive: true });
const nEngine = await syncEngine();
const nData = await syncData();
console.log(
  `[sync-shared] ${nEngine} engine dosyası + ${nData} vinç JSON kopyalandı → src/shared`,
);
