// Fenêtre de bureau. Fermer la fenêtre la cache dans la barre des tâches :
// l'app continue à monter et publier les Shorts du planning en arrière-plan.
// Elle se lance aussi au démarrage de Windows.
const { app, BrowserWindow, Tray, Menu, shell, nativeImage } = require('electron');
const path = require('path');

process.env.RSS_DATA ||= path.join(app.getPath('userData'), 'data');
const { PORT } = require('./server');

let win, tray, quitting = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    title: 'Roblox Shorts Studio', backgroundColor: '#0b0f17', autoHideMenuBar: true,
  });
  win.loadURL(`http://localhost:${PORT}`);
  // Liens externes (connexion YouTube, vidéos publiées) dans le navigateur.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { win?.show(); win?.focus(); });

app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
  createWindow();
  if (process.argv.includes('--hidden')) win.hide();

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Roblox Shorts Studio');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir', click: () => win.show() },
    { type: 'separator' },
    { label: 'Quitter', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => win.show());
});

app.on('before-quit', () => { quitting = true; });
