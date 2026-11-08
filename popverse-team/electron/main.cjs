// Popverse Team pour Windows : une fenêtre qui charge l'app (www/), mises à jour automatiques depuis GitHub.
const { app, BrowserWindow, shell, Menu, dialog, nativeImage } = require('electron');
const path = require('node:path');

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('com.popversestudio.team');

let win = null;
function create() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 380, minHeight: 600,
    backgroundColor: '#0A0805',
    title: 'Popverse Team',
    icon: nativeImage.createFromPath(path.join(__dirname, '..', 'www', 'assets', 'icon-512.png')),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // Les liens externes (Roblox, GitHub…) s'ouvrent dans le navigateur.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r'))) win.reload();
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  create();
  if (app.isPackaged) setupUpdates();
});
app.on('window-all-closed', () => app.quit());

function setupUpdates() {
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', info => {
    dialog.showMessageBox(win, {
      type: 'info', buttons: ['Redémarrer maintenant', 'Plus tard'], defaultId: 0,
      title: 'Mise à jour', message: `Popverse Team ${info.version} est prête.`, detail: 'Redémarre pour l\'installer (sinon elle s\'installera à la fermeture).',
    }).then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on('error', e => console.warn('Mise à jour :', e?.message));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 60 * 60 * 1000);
}
