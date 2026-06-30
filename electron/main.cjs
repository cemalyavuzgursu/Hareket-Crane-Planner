// Electron ana süreç — Hareket Crane Planner masaüstü uygulaması.
// Vite ile derlenmiş React arayüzünü (dist/) bir pencerede gösterir.
// Otomatik güncelleme: electron-updater ile GitHub release'lerinden kontrol eder.
const { app, BrowserWindow, Menu, shell, ipcMain } = require("electron");
const path = require("path");

// Geliştirme modunda Vite dev sunucusuna bağlan; aksi halde derlenmiş dosyayı yükle.
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// electron-updater yalnızca paketlenmiş üretim sürümünde anlamlıdır.
let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
  autoUpdater.autoDownload = false; // önce kullanıcıya sor
  autoUpdater.autoInstallOnAppQuit = true;
} catch {
  // electron-updater yoksa güncelleme özellikleri sessizce devre dışı.
}

/** @type {BrowserWindow | null} */
let mainWin = null;

/** Renderer'a güncelleme olayı gönder (pencere varsa). */
function sendToRenderer(channel, data) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, data);
}

function wireAutoUpdater() {
  if (!autoUpdater) return;
  autoUpdater.on("checking-for-update", () => sendToRenderer("updater:checking"));
  autoUpdater.on("update-available", (info) =>
    sendToRenderer("updater:available", { version: info?.version ?? "" }),
  );
  autoUpdater.on("update-not-available", () => sendToRenderer("updater:not-available"));
  autoUpdater.on("download-progress", (p) =>
    sendToRenderer("updater:progress", { percent: Math.round(p?.percent ?? 0) }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    sendToRenderer("updater:downloaded", { version: info?.version ?? "" }),
  );
  autoUpdater.on("error", (err) =>
    sendToRenderer("updater:error", { message: err == null ? "bilinmeyen hata" : String(err) }),
  );
}

function registerIpc() {
  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("updater:check", async () => {
    if (!autoUpdater || !app.isPackaged) {
      sendToRenderer("updater:not-available");
      return { ok: false, reason: "dev-or-unavailable" };
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (e) {
      sendToRenderer("updater:error", { message: String(e) });
      return { ok: false, reason: String(e) };
    }
  });
  ipcMain.handle("updater:download", async () => {
    if (!autoUpdater) return { ok: false };
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (e) {
      sendToRenderer("updater:error", { message: String(e) });
      return { ok: false, reason: String(e) };
    }
  });
  ipcMain.handle("updater:install", () => {
    if (!autoUpdater) return { ok: false };
    // Pencereleri kapatıp güncellemeyi kurar ve yeniden başlatır.
    setImmediate(() => autoUpdater.quitAndInstall());
    return { ok: true };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: "#111316",
    title: "Hareket Crane Planner",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWin = win;

  // Sade bir menü (Türkçe) — temel görünüm/pencere + güncelleme komutları.
  const menu = Menu.buildFromTemplate([
    {
      label: "Dosya",
      submenu: [{ role: "quit", label: "Çıkış" }],
    },
    {
      label: "Görünüm",
      submenu: [
        { role: "reload", label: "Yenile" },
        { role: "resetZoom", label: "Yakınlaştırmayı Sıfırla" },
        { role: "zoomIn", label: "Yakınlaştır" },
        { role: "zoomOut", label: "Uzaklaştır" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Tam Ekran" },
        { role: "toggleDevTools", label: "Geliştirici Araçları" },
      ],
    },
    {
      label: "Yardım",
      submenu: [
        {
          label: "Güncellemeleri Denetle",
          click: () => {
            if (autoUpdater && app.isPackaged) autoUpdater.checkForUpdates().catch(() => {});
            else sendToRenderer("updater:not-available");
          },
        },
        {
          label: "Sürüm: " + app.getVersion(),
          enabled: false,
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  // Pencere hazır olunca maksimize edip göster (beyaz titreme olmadan).
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
    // Açılışta sessizce güncelleme kontrolü (yalnızca paketlenmiş sürümde).
    if (autoUpdater && app.isPackaged) {
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);
    }
  });

  // Harici bağlantıları varsayılan tarayıcıda aç — yalnızca güvenli şemalara izin ver.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url);
      if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") {
        shell.openExternal(url);
      }
    } catch {
      // Geçersiz URL — yok say.
    }
    return { action: "deny" };
  });

  // Uygulama içinde güvenilir origin dışına gezinmeyi engelle.
  win.webContents.on("will-navigate", (event, url) => {
    const target = new URL(url);
    const allowed = DEV_URL ? new URL(DEV_URL).origin : "file://";
    if (DEV_URL ? target.origin !== allowed : target.protocol !== "file:") {
      event.preventDefault();
    }
  });

  win.on("closed", () => {
    if (mainWin === win) mainWin = null;
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  wireAutoUpdater();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
