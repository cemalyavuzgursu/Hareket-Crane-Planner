/**
 * projectStore — proje kütüphanesi (klasörler + projeler + son açılanlar).
 *  - Masaüstü (Electron): Belgeler\Hareket Crane Planner\Projeler altında gerçek
 *    klasör/dosyalar (*.hcp.json) — preload'daki window.hareketDesktop.projects.
 *  - Web: tarayıcı depolaması (localStorage) — sanal klasörler.
 * İki uygulama da aynı ProjectStore arayüzünü sunar; UI hangisi olduğunu bilmez.
 * Proje içeriği persistence.ts serializeProject() çıktısıdır (JSON metni).
 */

/** Kütüphanedeki bir proje. id: masaüstünde kök-göreli yol, web'de benzersiz anahtar. */
export interface ProjectEntry {
  id: string;
  name: string;
  /** "" = kök; alt klasörler "/" ile ("Şantiye A/Kule"). */
  folder: string;
  updatedAt: string; // ISO
  craneModel: string | null;
  projectName: string | null;
  siteLocation: string | null;
}

export interface ProjectListing {
  projects: ProjectEntry[];
  folders: string[];
}

/** Kütüphane dışından açılan dosya (yalnız masaüstü: dosya diyaloğu). */
export interface ExternalFile {
  path: string;
  name: string;
  content: string;
}

export interface ProjectStore {
  kind: "fs" | "browser";
  list(): Promise<ProjectListing>;
  read(id: string): Promise<string>;
  /** id verilirse üzerine yazar; yoksa folder içinde name ile YENİ proje oluşturur (ad çakışırsa "(2)"). */
  write(args: { id?: string | null; folder?: string; name: string; content: string }): Promise<ProjectEntry>;
  rename(id: string, name: string): Promise<ProjectEntry>;
  move(id: string, folder: string): Promise<ProjectEntry>;
  duplicate(id: string): Promise<ProjectEntry>;
  /** Masaüstü: Geri Dönüşüm Kutusu'na taşır. */
  remove(id: string): Promise<void>;
  createFolder(folder: string): Promise<string>;
  renameFolder(folder: string, name: string): Promise<string>;
  /** Klasörü içindekilerle birlikte siler (masaüstü: Geri Dönüşüm Kutusu). */
  removeFolder(folder: string): Promise<void>;
  /** Kök konumunun kullanıcıya gösterilecek açıklaması. */
  rootLabel(): Promise<string>;
  /** Yalnız masaüstü: dosyayı/kökü Gezgin'de göster. */
  reveal?(id?: string): Promise<void>;
  /** Yalnız masaüstü: kütüphane dışından dosya aç (diyalog). */
  openDialog?(): Promise<ExternalFile | null>;
  /** Yalnız masaüstü: diyalogla açılmış harici dosyaya geri yaz. */
  writeExternal?(path: string, content: string): Promise<void>;
  /** Yalnız masaüstü: farklı kaydet (diyalog). */
  saveAsDialog?(name: string, content: string): Promise<{ path: string; name: string } | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Masaüstü (Electron) — IPC köprüsü
// ─────────────────────────────────────────────────────────────────────────────
interface DesktopProjectsApi {
  root(): Promise<string>;
  list(): Promise<ProjectListing>;
  read(id: string): Promise<string>;
  write(a: { id?: string | null; folder?: string; name: string; content: string }): Promise<ProjectEntry>;
  rename(a: { id: string; name: string }): Promise<ProjectEntry>;
  move(a: { id: string; folder: string }): Promise<ProjectEntry>;
  duplicate(id: string): Promise<ProjectEntry>;
  remove(id: string): Promise<boolean>;
  mkdir(folder: string): Promise<string>;
  renameFolder(a: { folder: string; name: string }): Promise<string>;
  removeFolder(folder: string): Promise<boolean>;
  reveal(id?: string): Promise<boolean>;
  openRoot(): Promise<string>;
  openDialog(): Promise<ExternalFile | null>;
  writeExternal(a: { path: string; content: string }): Promise<boolean>;
  saveAsDialog(a: { name: string; content: string }): Promise<{ path: string; name: string } | null>;
}

function desktopApi(): DesktopProjectsApi | null {
  const w = typeof window !== "undefined" ? (window as unknown as { hareketDesktop?: { projects?: DesktopProjectsApi } }) : null;
  return w?.hareketDesktop?.projects ?? null;
}

function fsStore(api: DesktopProjectsApi): ProjectStore {
  return {
    kind: "fs",
    list: () => api.list(),
    read: (id) => api.read(id),
    write: (a) => api.write(a),
    rename: (id, name) => api.rename({ id, name }),
    move: (id, folder) => api.move({ id, folder }),
    duplicate: (id) => api.duplicate(id),
    remove: async (id) => {
      await api.remove(id);
    },
    createFolder: (f) => api.mkdir(f),
    renameFolder: (folder, name) => api.renameFolder({ folder, name }),
    removeFolder: async (f) => {
      await api.removeFolder(f);
    },
    rootLabel: () => api.root(),
    reveal: async (id) => {
      await api.reveal(id);
    },
    openDialog: () => api.openDialog(),
    writeExternal: async (path, content) => {
      await api.writeExternal({ path, content });
    },
    saveAsDialog: (name, content) => api.saveAsDialog({ name, content }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Web — localStorage
// ─────────────────────────────────────────────────────────────────────────────
const LS_KEY = "hareket_projects_v1";

interface BrowserDb {
  folders: string[];
  projects: Array<ProjectEntry & { content: string }>;
}

function loadDb(): BrowserDb {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const d = JSON.parse(raw) as BrowserDb;
      if (Array.isArray(d.folders) && Array.isArray(d.projects)) return d;
    }
  } catch {
    /* bozuk/erişilemez depolama → boş */
  }
  return { folders: [], projects: [] };
}

function saveDb(db: BrowserDb): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch (e) {
    throw new Error("Tarayıcı depolaması dolu veya erişilemiyor: " + (e instanceof Error ? e.message : String(e)));
  }
}

function cleanName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "Adsız proje";
}

function cleanFolder(folder: string): string {
  return folder
    .split("/")
    .map((p) => cleanName(p))
    .filter((p) => p && p !== "Adsız proje")
    .join("/");
}

/** Proje JSON'undan liste özeti. */
export function summarizeContent(content: string): Pick<ProjectEntry, "craneModel" | "projectName" | "siteLocation"> {
  try {
    const d = JSON.parse(content) as { state?: { craneModel?: string }; meta?: { projectName?: string; siteLocation?: string } };
    return {
      craneModel: d.state?.craneModel ?? null,
      projectName: d.meta?.projectName || null,
      siteLocation: d.meta?.siteLocation || null,
    };
  } catch {
    return { craneModel: null, projectName: null, siteLocation: null };
  }
}

function uniqueName(db: BrowserDb, folder: string, base: string, exceptId?: string): string {
  const taken = new Set(db.projects.filter((p) => p.folder === folder && p.id !== exceptId).map((p) => p.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} (${i})`)) return `${base} (${i})`;
}

const strip = ({ content: _c, ...e }: ProjectEntry & { content: string }): ProjectEntry => e;

function browserStore(): ProjectStore {
  const find = (db: BrowserDb, id: string) => {
    const p = db.projects.find((x) => x.id === id);
    if (!p) throw new Error("Proje bulunamadı");
    return p;
  };
  return {
    kind: "browser",
    list: async () => {
      const db = loadDb();
      // Projelerin bulunduğu ama listede olmayan klasörleri de göster.
      const folders = new Set(db.folders);
      for (const p of db.projects) {
        const parts = p.folder.split("/").filter(Boolean);
        for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/"));
      }
      return { projects: db.projects.map(strip), folders: [...folders].sort((a, b) => a.localeCompare(b, "tr")) };
    },
    read: async (id) => find(loadDb(), id).content,
    write: async ({ id, folder = "", name, content }) => {
      const db = loadDb();
      const now = new Date().toISOString();
      let p: ProjectEntry & { content: string };
      if (id) {
        p = find(db, id);
        Object.assign(p, { content, updatedAt: now, ...summarizeContent(content) });
      } else {
        const f = cleanFolder(folder);
        p = {
          id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          name: uniqueName(db, f, cleanName(name)),
          folder: f,
          updatedAt: now,
          content,
          ...summarizeContent(content),
        };
        db.projects.push(p);
      }
      saveDb(db);
      return strip(p);
    },
    rename: async (id, name) => {
      const db = loadDb();
      const p = find(db, id);
      p.name = uniqueName(db, p.folder, cleanName(name), id);
      p.updatedAt = new Date().toISOString();
      saveDb(db);
      return strip(p);
    },
    move: async (id, folder) => {
      const db = loadDb();
      const p = find(db, id);
      p.folder = cleanFolder(folder);
      p.name = uniqueName(db, p.folder, p.name, id);
      saveDb(db);
      return strip(p);
    },
    duplicate: async (id) => {
      const db = loadDb();
      const src = find(db, id);
      const now = new Date().toISOString();
      const p = {
        ...src,
        id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        name: uniqueName(db, src.folder, src.name + " - kopya"),
        updatedAt: now,
      };
      db.projects.push(p);
      saveDb(db);
      return strip(p);
    },
    remove: async (id) => {
      const db = loadDb();
      db.projects = db.projects.filter((p) => p.id !== id);
      saveDb(db);
    },
    createFolder: async (folder) => {
      const db = loadDb();
      const f = cleanFolder(folder);
      if (f && !db.folders.includes(f)) db.folders.push(f);
      saveDb(db);
      return f;
    },
    renameFolder: async (folder, name) => {
      const db = loadDb();
      const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
      const next = (parent ? parent + "/" : "") + cleanName(name);
      const re = (f: string) => (f === folder ? next : f.startsWith(folder + "/") ? next + f.slice(folder.length) : f);
      db.folders = db.folders.map(re);
      for (const p of db.projects) p.folder = re(p.folder);
      saveDb(db);
      return next;
    },
    removeFolder: async (folder) => {
      const db = loadDb();
      const inside = (f: string) => f === folder || f.startsWith(folder + "/");
      db.folders = db.folders.filter((f) => !inside(f));
      db.projects = db.projects.filter((p) => !inside(p.folder));
      saveDb(db);
    },
    rootLabel: async () => "Tarayıcı depolaması (bu tarayıcıya özel)",
  };
}

let cached: ProjectStore | null = null;
export function getProjectStore(): ProjectStore {
  if (!cached) {
    const api = desktopApi();
    cached = api ? fsStore(api) : browserStore();
  }
  return cached;
}

// ─────────────────────────────────────────────────────────────────────────────
// Son açılan projeler (her iki ortamda da localStorage)
// ─────────────────────────────────────────────────────────────────────────────
const RECENT_KEY = "hareket_recent_projects";
const RECENT_MAX = 12;

/** Son açılan kayıt: kütüphane projesi (id) ya da harici dosya (path). */
export interface RecentEntry {
  kind: "library" | "external";
  id: string; // library: ProjectEntry.id, external: mutlak yol
  name: string;
  openedAt: string;
  craneModel?: string | null;
}

export function listRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const d = raw ? (JSON.parse(raw) as RecentEntry[]) : [];
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

export function addRecent(e: Omit<RecentEntry, "openedAt">): RecentEntry[] {
  const list = listRecent().filter((r) => !(r.kind === e.kind && r.id === e.id));
  const next = [{ ...e, openedAt: new Date().toISOString() }, ...list].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* depolama yok — sessizce geç */
  }
  return next;
}

export function removeRecent(kind: RecentEntry["kind"], id: string): RecentEntry[] {
  const next = listRecent().filter((r) => !(r.kind === kind && r.id === id));
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* yok say */
  }
  return next;
}

/** Kütüphane projesi yeniden adlandırıldı/taşındı → son açılanlar kaydını güncelle. */
export function updateRecentId(oldId: string, entry: ProjectEntry): void {
  const next = listRecent().map((r) => (r.kind === "library" && r.id === oldId ? { ...r, id: entry.id, name: entry.name } : r));
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* yok say */
  }
}
