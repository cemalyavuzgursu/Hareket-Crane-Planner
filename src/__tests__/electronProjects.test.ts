// Masaüstü proje kütüphanesi (electron/projects.cjs) — IPC işleyicileri sahte
// bir "electron" modülüyle geçici klasörde çalıştırılır. Özellikle kök dışına
// yol kaçışının (../) engellendiği doğrulanır.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require_ = createRequire(import.meta.url);
type Handler = (e: unknown, arg?: unknown) => Promise<unknown> | unknown;
const handlers: Record<string, Handler> = {};
let docs = "";
const trashed: string[] = [];

beforeAll(() => {
  docs = fs.mkdtempSync(path.join(os.tmpdir(), "hcp-"));
  const fake = {
    app: { getPath: () => docs },
    ipcMain: { handle: (ch: string, fn: Handler) => (handlers[ch] = fn) },
    dialog: {},
    shell: {
      trashItem: async (p: string) => {
        trashed.push(p);
        fs.rmSync(p, { recursive: true, force: true });
      },
      showItemInFolder: () => {},
      openPath: async () => "",
    },
  };
  const electronPath = require_.resolve("electron");
  require_.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  const mod = require_("../../electron/projects.cjs") as { registerProjectIpc: () => void };
  mod.registerProjectIpc();
});

afterAll(() => fs.rmSync(docs, { recursive: true, force: true }));

const call = (ch: string, arg?: unknown) => Promise.resolve(handlers[ch]({}, arg));
const content = JSON.stringify({ version: 2, state: { craneModel: "SANY SAC2500E", objects: [] }, steps: [], meta: { projectName: "Test" } });

describe("masaüstü proje kütüphanesi (dosya sistemi)", () => {
  it("kök Belgeler\\Hareket Crane Planner\\Projeler altında oluşturulur", async () => {
    const root = (await call("projects:root")) as string;
    expect(root).toBe(path.join(docs, "Hareket Crane Planner", "Projeler"));
    expect(fs.existsSync(root)).toBe(true);
  });

  it("klasörde proje yazar, listeler, okur; ad çakışmasında (2)", async () => {
    await call("projects:mkdir", "Şantiye A");
    const a = (await call("projects:write", { folder: "Şantiye A", name: "Plan", content })) as { id: string; folder: string; craneModel: string };
    const b = (await call("projects:write", { folder: "Şantiye A", name: "Plan", content })) as { id: string };
    expect(a.id).toBe("Şantiye A/Plan.hcp.json");
    expect(b.id).toBe("Şantiye A/Plan (2).hcp.json");
    expect(a.craneModel).toBe("SANY SAC2500E");
    const l = (await call("projects:list")) as { projects: unknown[]; folders: string[] };
    expect(l.projects.length).toBe(2);
    expect(l.folders).toContain("Şantiye A");
    expect(await call("projects:read", a.id)).toBe(content);
  });

  it("yeniden adlandırır, taşır, çoğaltır; silme Geri Dönüşüm Kutusu'na gider", async () => {
    const r = (await call("projects:rename", { id: "Şantiye A/Plan.hcp.json", name: "Plan Rev B" })) as { id: string };
    expect(r.id).toBe("Şantiye A/Plan Rev B.hcp.json");
    const m = (await call("projects:move", { id: r.id, folder: "Arşiv" })) as { id: string; folder: string };
    expect(m.folder).toBe("Arşiv");
    const d = (await call("projects:duplicate", m.id)) as { id: string };
    expect(d.id).toBe("Arşiv/Plan Rev B - kopya.hcp.json");
    await call("projects:delete", d.id);
    expect(trashed.some((p) => p.endsWith("Plan Rev B - kopya.hcp.json"))).toBe(true);
  });

  it("kök dışına yol kaçışı reddedilir", async () => {
    await expect(call("projects:read", "../../../Windows/win.ini")).rejects.toThrow(/Geçersiz yol/);
    await expect(call("projects:write", { id: "../evil.hcp.json", name: "x", content: "x" })).rejects.toThrow(/Geçersiz yol/);
    await expect(call("projects:write", { folder: "../..", name: "x", content: "x" })).rejects.toThrow(/Geçersiz yol/);
    await expect(call("projects:deleteFolder", "")).rejects.toThrow(/Kök klasör silinemez/);
  });

  it("dosya adındaki yasak karakterler temizlenir", async () => {
    const e = (await call("projects:write", { folder: "", name: 'a<b>:c"d', content })) as { id: string };
    expect(e.id).toBe("abcd.hcp.json");
  });

  it("diyalogla açılmamış harici dosyaya yazılamaz", async () => {
    await expect(call("projects:writeExternal", { path: path.join(docs, "x.json"), content: "x" })).rejects.toThrow(/izni yok/);
  });
});
