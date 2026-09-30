// Proje kütüphanesi (web / tarayıcı depolaması) + son açılanlar. Masaüstü
// (dosya sistemi) uygulaması aynı ProjectStore arayüzünü electron/projects.cjs
// üzerinden sunar; burada tarayıcı uygulaması test edilir.

import { describe, it, expect, beforeEach, vi } from "vitest";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const content = (crane = "SANY SAC2500E", projectName = "Çatı montajı") =>
  JSON.stringify({ version: 2, state: { craneModel: crane, objects: [] }, steps: [], meta: { projectName, siteLocation: "Gebze" } });

async function freshStore() {
  vi.resetModules();
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  return import("../ui/projectStore");
}

describe("tarayıcı proje kütüphanesi", () => {
  beforeEach(() => vi.resetModules());

  it("yeni proje oluşturur, özetini çıkarır ve okur", async () => {
    const { getProjectStore } = await freshStore();
    const s = getProjectStore();
    expect(s.kind).toBe("browser");
    const e = await s.write({ folder: "Şantiye A", name: "Kule vinç", content: content() });
    expect(e.folder).toBe("Şantiye A");
    expect(e.craneModel).toBe("SANY SAC2500E");
    expect(e.projectName).toBe("Çatı montajı");
    expect(await s.read(e.id)).toBe(content());
    const l = await s.list();
    expect(l.projects).toHaveLength(1);
    expect(l.folders).toContain("Şantiye A");
  });

  it("aynı klasörde ad çakışınca (2) ekler; yeniden adlandırma/taşıma/çoğaltma", async () => {
    const { getProjectStore } = await freshStore();
    const s = getProjectStore();
    const a = await s.write({ folder: "", name: "Plan", content: content() });
    const b = await s.write({ folder: "", name: "Plan", content: content() });
    expect(b.name).toBe("Plan (2)");
    const r = await s.rename(a.id, "Plan Rev B");
    expect(r.name).toBe("Plan Rev B");
    const m = await s.move(b.id, "Arşiv/2026");
    expect(m.folder).toBe("Arşiv/2026");
    const d = await s.duplicate(a.id);
    expect(d.name).toBe("Plan Rev B - kopya");
    const l = await s.list();
    expect(l.folders).toEqual(expect.arrayContaining(["Arşiv", "Arşiv/2026"]));
  });

  it("üzerine yazma içeriği ve özeti günceller", async () => {
    const { getProjectStore } = await freshStore();
    const s = getProjectStore();
    const e = await s.write({ folder: "", name: "P", content: content("LIEBHERR LTM 1160") });
    const u = await s.write({ id: e.id, name: e.name, content: content("LIEBHERR LTM 1250", "Yeni ad") });
    expect(u.id).toBe(e.id);
    expect(u.craneModel).toBe("LIEBHERR LTM 1250");
    expect((await s.list()).projects).toHaveLength(1);
  });

  it("klasör yeniden adlandırma alt klasör ve projeleri taşır; silme içindekileri siler", async () => {
    const { getProjectStore } = await freshStore();
    const s = getProjectStore();
    await s.createFolder("A/B");
    const e = await s.write({ folder: "A/B", name: "X", content: content() });
    const nf = await s.renameFolder("A", "Yeni");
    expect(nf).toBe("Yeni");
    const l = await s.list();
    expect(l.projects.find((p) => p.id === e.id)!.folder).toBe("Yeni/B");
    expect(l.folders).not.toContain("A");
    await s.removeFolder("Yeni");
    const l2 = await s.list();
    expect(l2.projects).toHaveLength(0);
    expect(l2.folders).toHaveLength(0);
  });

  it("geçersiz karakterler ad ve klasörden temizlenir", async () => {
    const { getProjectStore } = await freshStore();
    const s = getProjectStore();
    const e = await s.write({ folder: "a:b", name: 'x<y>"z', content: content() });
    expect(e.name).toBe("xyz");
    expect(e.folder).toBe("ab");
  });

  it("son açılanlar: en yeni üstte, tekrar açılan öne alınır, en fazla 12", async () => {
    const { addRecent, listRecent, removeRecent } = await freshStore();
    for (let i = 0; i < 15; i++) addRecent({ kind: "library", id: `p${i}`, name: `P${i}` });
    expect(listRecent()).toHaveLength(12);
    expect(listRecent()[0].id).toBe("p14");
    addRecent({ kind: "library", id: "p5", name: "P5" });
    expect(listRecent()[0].id).toBe("p5");
    removeRecent("library", "p5");
    expect(listRecent().some((r) => r.id === "p5")).toBe(false);
  });

  it("bozuk depolama boş kütüphane olarak okunur", async () => {
    const { getProjectStore } = await freshStore();
    localStorage.setItem("hareket_projects_v1", "{bozuk");
    const l = await getProjectStore().list();
    expect(l.projects).toEqual([]);
  });
});
