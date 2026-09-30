// Proje kütüphanesi — Belgeler\Hareket Crane Planner\Projeler altında gerçek
// klasör/dosya olarak saklanır (kullanıcı Gezgin'de de görür). Renderer yalnızca
// bu kök altında GÖRELİ yollarla işlem yapabilir (yol kaçışı engellenir);
// kök dışındaki dosyalara yalnızca kullanıcının dosya diyaloğunda seçtiği
// yollar üzerinden erişilir (allowlist).
const { app, ipcMain, dialog, shell } = require("electron");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const EXT = ".hcp.json";
/** Diyalogdan seçilen/ kaydedilen harici dosyalar (mutlak yol) — yalnız bunlara yazılabilir. */
const externalAllow = new Set();

function root() {
  const r = path.join(app.getPath("documents"), "Hareket Crane Planner", "Projeler");
  fs.mkdirSync(r, { recursive: true });
  return r;
}

/** Göreli yolu kök altında mutlak yola çevirir; kök dışına çıkarsa hata. */
function safe(rel) {
  const r = root();
  const abs = path.resolve(r, String(rel ?? ""));
  if (abs !== r && !abs.startsWith(r + path.sep)) throw new Error("Geçersiz yol");
  return abs;
}

function toRel(abs) {
  return path.relative(root(), abs).split(path.sep).join("/");
}

/** Dosya adı için yasak karakterleri temizler. */
function cleanName(name) {
  const n = String(name ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim();
  return n.slice(0, 120) || "Adsız proje";
}

async function uniquePath(dirAbs, base) {
  let p = path.join(dirAbs, base + EXT);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dirAbs, `${base} (${i})${EXT}`);
  return p;
}

/** Proje dosyasından liste özeti (bozuksa null alanlarla). */
async function summarize(abs) {
  const st = await fsp.stat(abs);
  let craneModel = null, projectName = null, siteLocation = null;
  try {
    const d = JSON.parse(await fsp.readFile(abs, "utf8"));
    craneModel = d?.state?.craneModel ?? null;
    projectName = d?.meta?.projectName || null;
    siteLocation = d?.meta?.siteLocation || null;
  } catch {
    /* bozuk dosya — yine listelenir */
  }
  const rel = toRel(abs);
  const folder = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
  return {
    id: rel,
    name: path.basename(abs).slice(0, -EXT.length),
    folder,
    updatedAt: st.mtime.toISOString(),
    craneModel,
    projectName,
    siteLocation,
  };
}

async function walk(dirAbs, out, folders) {
  const ents = await fsp.readdir(dirAbs, { withFileTypes: true });
  for (const e of ents) {
    const abs = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      folders.push(toRel(abs));
      await walk(abs, out, folders);
    } else if (e.isFile() && e.name.endsWith(EXT)) {
      out.push(await summarize(abs));
    }
  }
}

function registerProjectIpc() {
  ipcMain.handle("projects:root", () => root());

  ipcMain.handle("projects:list", async () => {
    const projects = [];
    const folders = [];
    await walk(root(), projects, folders);
    return { projects, folders: folders.sort((a, b) => a.localeCompare(b, "tr")) };
  });

  ipcMain.handle("projects:read", async (_e, id) => fsp.readFile(safe(id), "utf8"));

  /** id verilirse üzerine yazar; yoksa folder içinde name ile yeni (benzersiz) dosya oluşturur. */
  ipcMain.handle("projects:write", async (_e, { id, folder, name, content }) => {
    let abs;
    if (id) abs = safe(id);
    else {
      const dir = safe(folder ?? "");
      await fsp.mkdir(dir, { recursive: true });
      abs = await uniquePath(dir, cleanName(name));
    }
    await fsp.writeFile(abs, String(content), "utf8");
    return summarize(abs);
  });

  ipcMain.handle("projects:rename", async (_e, { id, name }) => {
    const src = safe(id);
    const dst = await uniquePath(path.dirname(src), cleanName(name));
    await fsp.rename(src, dst);
    return summarize(dst);
  });

  ipcMain.handle("projects:move", async (_e, { id, folder }) => {
    const src = safe(id);
    const dir = safe(folder ?? "");
    await fsp.mkdir(dir, { recursive: true });
    const dst = await uniquePath(dir, path.basename(src).slice(0, -EXT.length));
    await fsp.rename(src, dst);
    return summarize(dst);
  });

  ipcMain.handle("projects:duplicate", async (_e, id) => {
    const src = safe(id);
    const dst = await uniquePath(path.dirname(src), path.basename(src).slice(0, -EXT.length) + " - kopya");
    await fsp.copyFile(src, dst);
    return summarize(dst);
  });

  // Silme = Geri Dönüşüm Kutusu (geri alınabilir).
  ipcMain.handle("projects:delete", async (_e, id) => {
    await shell.trashItem(safe(id));
    return true;
  });

  ipcMain.handle("projects:mkdir", async (_e, folder) => {
    const parts = String(folder ?? "").split("/").map(cleanName).filter(Boolean);
    await fsp.mkdir(safe(parts.join("/")), { recursive: true });
    return parts.join("/");
  });

  ipcMain.handle("projects:renameFolder", async (_e, { folder, name }) => {
    const src = safe(folder);
    if (src === root()) throw new Error("Kök klasör yeniden adlandırılamaz");
    const dst = path.join(path.dirname(src), cleanName(name));
    if (fs.existsSync(dst)) throw new Error("Bu adda bir klasör zaten var");
    await fsp.rename(src, dst);
    return toRel(dst);
  });

  ipcMain.handle("projects:deleteFolder", async (_e, folder) => {
    const abs = safe(folder);
    if (abs === root()) throw new Error("Kök klasör silinemez");
    await shell.trashItem(abs);
    return true;
  });

  ipcMain.handle("projects:reveal", (_e, id) => {
    shell.showItemInFolder(id ? safe(id) : root());
    return true;
  });

  ipcMain.handle("projects:openRoot", () => shell.openPath(root()));

  /** Kütüphane dışından proje aç (dosya diyaloğu). */
  ipcMain.handle("projects:openDialog", async () => {
    const r = await dialog.showOpenDialog({
      title: "Proje Aç",
      properties: ["openFile"],
      filters: [{ name: "Hareket Crane Planner projesi", extensions: ["json"] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const abs = r.filePaths[0];
    externalAllow.add(abs);
    return { path: abs, name: path.basename(abs).replace(/\.hcp\.json$|\.json$/i, ""), content: await fsp.readFile(abs, "utf8") };
  });

  /** Harici (diyalogla açılmış) dosyaya geri yaz — yalnız allowlist'teki yollar. */
  ipcMain.handle("projects:writeExternal", async (_e, { path: abs, content }) => {
    if (!externalAllow.has(abs)) throw new Error("Bu dosyaya yazma izni yok");
    await fsp.writeFile(abs, String(content), "utf8");
    return true;
  });

  /** Farklı kaydet (diyalog) — seçilen yol allowlist'e eklenir. */
  ipcMain.handle("projects:saveAsDialog", async (_e, { name, content }) => {
    const r = await dialog.showSaveDialog({
      title: "Farklı Kaydet",
      defaultPath: path.join(app.getPath("documents"), cleanName(name) + EXT),
      filters: [{ name: "Hareket Crane Planner projesi", extensions: ["json"] }],
    });
    if (r.canceled || !r.filePath) return null;
    externalAllow.add(r.filePath);
    await fsp.writeFile(r.filePath, String(content), "utf8");
    return { path: r.filePath, name: path.basename(r.filePath).replace(/\.hcp\.json$|\.json$/i, "") };
  });
}

module.exports = { registerProjectIpc };
