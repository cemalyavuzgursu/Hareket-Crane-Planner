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
  /** Olay dinle; aboneliği kaldıran fonksiyon döner. */
  on: (channel, cb) => {
    if (!VALID_EVENTS.includes(channel)) return () => {};
    const listener = (_e, data) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
