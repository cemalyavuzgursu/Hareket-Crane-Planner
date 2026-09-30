// Preload — renderer'a güvenli, sınırlı bir güncelleme API'si açar.
// contextIsolation açık olduğu için yalnızca contextBridge ile expose edilir.
const { contextBridge, ipcRenderer } = require("electron");

const VALID_EVENTS = [
  "updater:checking",
  "updater:available",
  "updater:not-available",
  "updater:progress",
  "updater:downloaded",
  "updater:error",
];

contextBridge.exposeInMainWorld("hareketDesktop", {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  // Güncelleme kontrolleri (main süreçteki electron-updater'a köprü)
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  downloadUpdate: () => ipcRenderer.invoke("updater:download"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  // Proje kütüphanesi (Belgeler\Hareket Crane Planner\Projeler) — yalnız bu kök
  // altında göreli yollar; kök dışı yalnız dosya diyaloğuyla seçilen yollar.
  projects: {
    root: () => ipcRenderer.invoke("projects:root"),
    list: () => ipcRenderer.invoke("projects:list"),
    read: (id) => ipcRenderer.invoke("projects:read", id),
    write: (args) => ipcRenderer.invoke("projects:write", args),
    rename: (args) => ipcRenderer.invoke("projects:rename", args),
    move: (args) => ipcRenderer.invoke("projects:move", args),
    duplicate: (id) => ipcRenderer.invoke("projects:duplicate", id),
    remove: (id) => ipcRenderer.invoke("projects:delete", id),
    mkdir: (folder) => ipcRenderer.invoke("projects:mkdir", folder),
    renameFolder: (args) => ipcRenderer.invoke("projects:renameFolder", args),
    removeFolder: (folder) => ipcRenderer.invoke("projects:deleteFolder", folder),
    reveal: (id) => ipcRenderer.invoke("projects:reveal", id),
    openRoot: () => ipcRenderer.invoke("projects:openRoot"),
    openDialog: () => ipcRenderer.invoke("projects:openDialog"),
    writeExternal: (args) => ipcRenderer.invoke("projects:writeExternal", args),
    saveAsDialog: (args) => ipcRenderer.invoke("projects:saveAsDialog", args),
  },
  /** Olay dinle; aboneliği kaldıran fonksiyon döner. */
  on: (channel, cb) => {
    if (!VALID_EVENTS.includes(channel)) return () => {};
    const listener = (_e, data) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
