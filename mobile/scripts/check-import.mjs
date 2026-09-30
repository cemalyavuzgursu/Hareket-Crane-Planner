// Masaüstü proje içe aktarma (src/projectImport.ts) için küçük öz-kontrol.
// Mobilde test koşucusu yok: TypeScript derleyicisiyle (devDependency) modülü
// geçici dizine CommonJS olarak derleyip gerçek vinç JSON'larıyla doğrular.
//
// Kullanım (mobile/ içinde): npm run check:import   (önce sync-shared çalışır)
import { readFile, writeFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const out = await mkdtemp(join(tmpdir(), "hcp-import-"));
for (const name of ["state", "projectImport"]) {
  const src = await readFile(join(root, "src", name + ".ts"), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  await writeFile(join(out, name + ".js"), js, "utf8");
}
const { parseDesktopProject, importDesktopProject, importParsedProject } = require(join(out, "projectImport.js"));

const dataDir = join(root, "src", "shared", "data");
const cranes = [];
for (const f of (await readdir(dataDir)).filter((f) => f.endsWith(".json"))) {
  cranes.push(JSON.parse(await readFile(join(dataDir, f), "utf8")));
}
assert.ok(cranes.length > 0, "vinç verisi yok — önce npm run sync");
const crane = cranes[0];

// Masaüstü serializeProject çıktısını taklit eden örnek.
const desktopState = {
  craneModel: crane.model,
  load_weight: 42,
  hook_weight: 1.1,
  rigging_weight: 9, // aparat listesi dolu → yok sayılmalı
  load_height: 3.5,
  load_diameter: 4,
  obstacle_height: 2,
  obstacle_distance: 1,
  obstacle_width: 3,
  boom_length: crane.boom_lengths[1] ?? crane.boom_lengths[0],
  radius: 12,
  counterweight: crane.counterweight_options[0],
  capacity_pct: (crane.capacity_pct_options ?? [75, 85])[0],
  outrigger_config: crane.outrigger_configs[crane.outrigger_configs.length - 1],
  slew_angle: 180,
  lift_config: "T",
  jib_length: 0,
  jib_offset: 0,
  pad_area_m2: 1,
  allowable_bearing_t_m2: 25,
  objects: [{ id: "b1", kind: "box" }],
  crane_heading: 30,
  rigging_items: [
    { id: "r1", kind: "sling4", label: "Sapan", weight_t: 0.3, height_m: 4, length_m: 3 },
    { id: "r2", kind: "shackle", label: "Kilit", weight_t: 0.05, height_m: 0.3, length_m: 0.2 },
  ],
  tandem: { enabled: true },
  futureField: { anything: 1 }, // bilinmeyen alan tolere edilmeli
};
const project = {
  version: 2,
  state: desktopState,
  steps: [
    { id: "s1", name: "Kaldırma", config: { ...desktopState, radius: 10 }, summary: {} },
    { id: "s2", name: "Yerleştirme", config: { ...desktopState, radius: 14, boom_length: 999 }, summary: {} },
  ],
  meta: { projectName: "Test Projesi", siteLocation: "" },
};
const json = JSON.stringify(project, null, 2);

// 1) Güncel plan
const r = importDesktopProject(json, cranes);
assert.equal(r.projectName, "Test Projesi");
assert.deepEqual(r.stepNames, ["Kaldırma", "Yerleştirme"]);
assert.equal(r.state.craneModel, crane.model);
assert.equal(r.state.load_weight, 42);
assert.equal(r.state.radius, 12);
assert.equal(r.state.slew_angle, 180);
assert.ok(Math.abs(r.state.rigging_weight - 0.35) < 1e-9, "rigging_weight aparat toplamı olmalı");
assert.ok(Math.abs(r.state.rigging_height - 4.3) < 1e-9, "rigging_height aparat toplamı olmalı");
assert.ok(r.warnings.some((w) => w.includes("çevre nesnesi")));
assert.ok(r.warnings.some((w) => w.includes("Tandem")));
assert.ok(r.warnings.some((w) => w.includes("saha konumu")));
assert.ok(!("futureField" in r.state), "bilinmeyen alan state'e sızmamalı");

// 2) Adım seçimi + vince uymayan bom → düzeltme uyarısı
const r2 = importDesktopProject(json, cranes, { stepIndex: 1 });
assert.equal(r2.state.radius, 14);
assert.ok(crane.boom_lengths.includes(r2.state.boom_length));
assert.ok(r2.warnings.some((w) => w.startsWith("Bom uzunluğu 999")));
assert.equal(r2.projectName, "Test Projesi — Yerleştirme");

// 3) Hatalar
assert.equal(parseDesktopProject("{bozuk").ok, false);
assert.equal(parseDesktopProject(JSON.stringify({ ...project, version: 99 })).ok, false);
assert.equal(parseDesktopProject(JSON.stringify({ version: 2, state: {}, steps: [] })).ok, false);
assert.throws(() => importDesktopProject(JSON.stringify({ ...project, state: { ...desktopState, craneModel: "YOK 999" } }), cranes), /mobil uygulamada yok/);
const p = parseDesktopProject("﻿" + json, "dosya.json");
assert.ok(p.ok, "BOM'lu dosya okunmalı");
assert.throws(() => importParsedProject(p.project, cranes, 5), /adımı bulunamadı/);

// 4) v1 (meta yok) → dosya adı proje adı olur
const v1 = parseDesktopProject(JSON.stringify({ version: 1, state: desktopState, steps: [] }), "saha-plan.json");
assert.ok(v1.ok && v1.project.projectName === "saha-plan");

await rm(out, { recursive: true, force: true });
console.log(`[check-import] OK — ${cranes.length} vinç, tüm içe aktarma kontrolleri geçti.`);
