// Fenêtre de bureau. Fermer la fenêtre la cache dans la barre des tâches :
// l'app continue à monter et publier les Shorts du planning en arrière-plan.
// Elle se lance aussi au démarrage de Windows et se met à jour toute seule
// (release GitHub « shorts-studio », voir .github/workflows/shorts-studio-desktop.yml).
const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog } = require('electron');
const path = require('path');

const APP_ID = 'com.rovex.shortsstudio';
const ICON = path.join(__dirname, 'shorts.ico');
let win, tray, quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
  start();
}

function showMain() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(url, hidden) {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600, show: !hidden,
    title: 'Roblox Shorts Studio', icon: ICON, backgroundColor: '#0b0f17', autoHideMenuBar: true,
  });
  win.loadURL(url);
  // Liens externes (connexion YouTube, vidéos publiées) dans le navigateur.
  win.webContents.setWindowOpenHandler(({ url: link }) => { shell.openExternal(link); return { action: 'deny' }; });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.setToolTip('Roblox Shorts Studio');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir', click: showMain },
    { label: 'Vérifier les mises à jour', click: () => checkUpdates(true) },
    { type: 'separator' },
    { label: 'Quitter', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showMain);
}

// Mises à jour automatiques (electron-updater, fournisseur « generic » qui pointe
// sur la release fixe shorts-studio : jamais mélangée avec celles de Rovex Hub).
let updater = null;
global.rssUpdate = { state: 'idle' };
global.rssCheckUpdates = (manual) => checkUpdates(manual);
global.rssInstallUpdate = () => {
  if (updater && global.rssUpdate.state === 'ready') { quitting = true; updater.quitAndInstall(true, true); }
};
function checkUpdates(manual) {
  if (!app.isPackaged) { global.rssUpdate = { state: 'dev' }; return; }
  try {
    if (!updater) {
      updater = require('electron-updater').autoUpdater;
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = true;
      const set = (state, extra = {}) => { global.rssUpdate = { state, at: Date.now(), ...extra }; };
      updater.on('checking-for-update', () => set('checking'));
      updater.on('update-available', (i) => set('downloading', { version: i.version, percent: 0 }));
      updater.on('download-progress', (p) => set('downloading', { ...global.rssUpdate, percent: Math.round(p.percent) }));
      updater.on('update-not-available', () => set('latest'));
      updater.on('error', (e) => set('error', { message: String((e && e.message) || e).slice(0, 200) }));
      updater.on('update-downloaded', async (info) => {
        set('ready', { version: info.version });
        const r = await dialog.showMessageBox(win, {
          type: 'info', buttons: ['Redémarrer maintenant', 'Plus tard'], defaultId: 0, cancelId: 1, title: 'Roblox Shorts Studio',
          message: `La version ${info.version} est prête.`,
          detail: 'Redémarre l’app pour l’installer (sinon elle s’installera à la prochaine fermeture).',
        });
        if (r.response === 0) global.rssInstallUpdate();
      });
    }
    if (manual) {
      updater.once('update-not-available', () =>
        dialog.showMessageBox(win, { type: 'info', title: 'Roblox Shorts Studio', message: 'Tu as déjà la dernière version.' }));
    }
    updater.checkForUpdates().catch(() => {});
  } catch {}
}

async function start() {
  app.setAppUserModelId(APP_ID);
  await app.whenReady();
  // Données dans %APPDATA%\Roblox Shorts Studio\data (gameplay, Shorts, réglages).
  process.env.RSS_DATA ||= path.join(app.getPath('userData'), 'data');
  const hidden = process.argv.includes('--hidden');

  let port;
  try {
    port = await require('./server').ready;
  } catch (e) {
    dialog.showErrorBox('Roblox Shorts Studio', e.code === 'EADDRINUSE'
      ? 'Le port 4800 est déjà utilisé par un autre programme. Ferme-le puis relance Roblox Shorts Studio.'
      : `Roblox Shorts Studio n’a pas pu démarrer.\n\n${e.message}`);
    quitting = true;
    app.quit();
    return;
  }

  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
  buildTray();
  createWindow(`http://127.0.0.1:${port}`, hidden);
  setTimeout(() => checkUpdates(false), 15e3);
  setInterval(() => checkUpdates(false), 3600e3);
}

app.on('before-quit', () => { quitting = true; });
// Rester ouvert dans la barre des tâches quand la fenêtre est cachée.
app.on('window-all-closed', () => {});
