// Electron ana süreç — Hareket Crane Planner masaüstü uygulaması.
// Vite ile derlenmiş React arayüzünü (dist/) bir pencerede gösterir.
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");

// Geliştirme modunda Vite dev sunucusuna bağlan; aksi halde derlenmiş dosyayı yükle.
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: "#0f172a",
    title: "Hareket Crane Planner",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Sade bir menü (Türkçe) — temel görünüm/pencere komutları.
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
  ]);
  Menu.setApplicationMenu(menu);

  // Pencere hazır olunca maksimize edip göster (beyaz titreme olmadan).
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  // Harici bağlantıları varsayılan tarayıcıda aç.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
