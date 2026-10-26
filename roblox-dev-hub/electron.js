// Rovex Hub en vraie application Windows : une fenêtre, une icône dans la barre des tâches
// et la zone de notification, aucun terminal. Le serveur tourne à l'intérieur de l'app.
const { app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const APP_ID = 'com.rovexhub.app';
const ICON = path.join(__dirname, 'rovex.ico');
const BG = '#07050C';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
  start();
}

let main = null;
let splash = null;
let tray = null;
let quitting = false;
let url = '';

// Données dans %APPDATA%\Rovex Hub : elles survivent aux mises à jour et à la désinstallation.
function prepareData() {
  const base = app.getPath('userData');
  process.env.ROVEX_DATA = base;
  // Reprend la base de l'ancienne version (installée avec le .bat) au premier lancement.
  const old = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'RobloxDevHub');
  if (old && fs.existsSync(path.join(old, 'data', 'library.json')) && !fs.existsSync(path.join(base, 'data', 'library.json'))) {
    for (const dir of ['data', 'media']) {
      try { fs.cpSync(path.join(old, dir), path.join(base, dir), { recursive: true }); } catch {}
    }
  }
}

// Ferme l'ancienne version (node.exe) si elle occupe encore le port.
function freePort(port) {
  if (process.platform !== 'win32') return Promise.resolve();
  const ps = `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { if ($_.OwningProcess -ne ${process.pid}) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }`;
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000 }, () => resolve()));
}

function showSplash() {
  splash = new BrowserWindow({ width: 340, height: 360, frame: false, resizable: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, show: false, icon: ICON });
  splash.loadFile(path.join(__dirname, 'public', 'splash.html'));
  splash.once('ready-to-show', () => splash && splash.show());
}

function createMain(hidden) {
  main = new BrowserWindow({
    width: 1380, height: 880, minWidth: 980, minHeight: 640, show: false, backgroundColor: BG, icon: ICON,
    title: 'Rovex Hub', autoHideMenuBar: true,
    titleBarStyle: 'hidden', titleBarOverlay: { color: BG, symbolColor: '#C4B5FD', height: 34 },
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  main.removeMenu();
  main.loadURL(url + '/?app=1');
  main.once('ready-to-show', () => {
    if (!hidden) main.show();
    if (splash) { splash.destroy(); splash = null; }
  });
  // Les liens externes (YouTube, GitHub, docs…) s'ouvrent dans le navigateur, pas dans l'app.
  main.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(url)) shell.openExternal(target);
    return { action: 'deny' };
  });
  main.webContents.on('will-navigate', (e, target) => {
    if (!target.startsWith(url)) { e.preventDefault(); shell.openExternal(target); }
  });
  // Fermer la fenêtre garde Rovex Hub dans la zone de notification, pour que Claude reste connecté.
  main.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    main.hide();
    if (tray && !app.__hintShown && process.platform === 'win32') {
      app.__hintShown = true;
      tray.displayBalloon({ iconType: 'info', title: 'Rovex Hub', content: 'Rovex Hub continue en arrière-plan pour Claude. Clic droit sur l’icône pour quitter.' });
    }
  });
}

function showMain() {
  if (!main) return;
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.setToolTip('Rovex Hub');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Ouvrir Rovex Hub', click: showMain },
    { type: 'separator' },
    {
      label: 'Lancer au démarrage de Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }); },
    },
    { label: 'Rechercher une mise à jour', click: () => checkUpdates(true) },
    { label: 'Ouvrir le dossier des données', click: () => shell.openPath(process.env.ROVEX_DATA) },
    { type: 'separator' },
    { label: 'Quitter Rovex Hub', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu());
  tray.on('right-click', () => tray.setContextMenu(menu()));
  tray.on('click', showMain);
}

// Mises à jour automatiques depuis les releases GitHub (comme Discord).
global.rovexCheckUpdates = () => checkUpdates(false);
global.rovexInstallUpdate = () => { if (updater && global.rovexUpdate.state === 'ready') { quitting = true; updater.quitAndInstall(true, true); } };
let updater = null;
global.rovexUpdate = { state: 'idle' };
function checkUpdates(manual) {
  if (!app.isPackaged) { global.rovexUpdate = { state: 'dev' }; return; }
  try {
    if (!updater) {
      updater = require('electron-updater').autoUpdater;
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = true;
      const set = (state, extra = {}) => { global.rovexUpdate = { state, at: Date.now(), ...extra }; };
      updater.on('checking-for-update', () => set('checking'));
      updater.on('update-available', (i) => set('downloading', { version: i.version, percent: 0 }));
      updater.on('download-progress', (p) => set('downloading', { ...global.rovexUpdate, percent: Math.round(p.percent) }));
      updater.on('update-not-available', () => set('latest'));
      updater.on('update-downloaded', (i) => set('ready', { version: i.version }));
      updater.on('error', (e) => set('error', { message: String(e && e.message || e).slice(0, 200) }));
      updater.on('update-downloaded', async (info) => {
        const r = await dialog.showMessageBox(main, {
          type: 'info', buttons: ['Redémarrer maintenant', 'Plus tard'], defaultId: 0, cancelId: 1, title: 'Rovex Hub',
          message: `La version ${info.version} de Rovex Hub est prête.`, detail: 'Redémarre l’app pour l’installer (sinon elle s’installera à la prochaine fermeture).',
        });
        if (r.response === 0) { quitting = true; updater.quitAndInstall(true, true); }
      });
      if (manual) updater.once('update-not-available', () => dialog.showMessageBox(main, { type: 'info', title: 'Rovex Hub', message: 'Tu as déjà la dernière version.' }));
    }
    updater.checkForUpdates().catch(() => {});
  } catch {}
}

async function start() {
  app.setAppUserModelId(APP_ID);
  await app.whenReady();
  const hidden = process.argv.includes('--hidden');
  if (!hidden) showSplash();
  prepareData();
  await freePort(Number(process.env.PORT) || 4747);
  try {
    const srv = require('./server.js');
    const port = await srv.ready;
    url = `http://127.0.0.1:${port}`;
  } catch (e) {
    if (splash) splash.destroy();
    dialog.showErrorBox('Rovex Hub', `Rovex Hub n’a pas pu démarrer.\n\n${e.code === 'EADDRINUSE' ? 'Le port 4747 est déjà utilisé par un autre programme. Ferme-le puis relance Rovex Hub.' : e.message}`);
    quitting = true;
    app.quit();
    return;
  }
  buildTray();
  createMain(hidden);
  setTimeout(() => checkUpdates(false), 15e3);
  setInterval(() => checkUpdates(false), 3600e3);
}

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', (e) => e.preventDefault());
