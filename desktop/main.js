// App de escritorio de Ecos de Valdoria (Electron).
// Muestra un splash con el estilo del juego mientras la ventana principal genera el mundo,
// y la revela cuando el juego avisa que está listo.
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');

let splash = null;
let win = null;

function createSplash() {
  splash = new BrowserWindow({
    width: 560,
    height: 340,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    center: true,
    backgroundColor: '#0b0d10',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'splash-preload.js') },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', () => splash.show());
}

function createMain() {
  win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Ecos de Valdoria',
    backgroundColor: '#0e1013',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'app', 'index.html'));

  // F11 pantalla completa · Ctrl+Shift+I herramientas de desarrollo
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (input.key === 'I' && input.control && input.shift) {
      win.webContents.toggleDevTools();
    }
  });
  // Los enlaces externos se abren en el navegador del sistema
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Si algo falla, no dejar al jugador mirando el splash para siempre
  const fallback = setTimeout(reveal, 45000);
  win.once('closed', () => clearTimeout(fallback));
  win.on('close', () => win.webContents.send('before-quit'));
}

function reveal() {
  if (win && !win.isDestroyed() && !win.isVisible()) {
    win.maximize();
    win.show();
    win.focus();
  }
  if (splash && !splash.isDestroyed()) {
    splash.webContents.send('progress', { text: 'Todo listo', pct: 1 });
    setTimeout(() => splash && !splash.isDestroyed() && splash.close(), 250);
  }
}

ipcMain.handle('get-version', () => app.getVersion());
ipcMain.on('progress', (_e, data) => {
  if (splash && !splash.isDestroyed()) splash.webContents.send('progress', data);
});
ipcMain.on('ready', reveal);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    createSplash();
    createMain();
  });
  app.on('window-all-closed', () => app.quit());
}
