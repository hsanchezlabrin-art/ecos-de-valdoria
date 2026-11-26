// App de escritorio de Ecos de Valdoria (Electron).
//
// Al abrirse muestra un splash con el estilo del juego que:
//  1. Revisa si cambió la app en sí (la «carcasa»: ventana, arranque, splash). Solo entonces se
//     actualiza: en Windows se descarga e instala sola; en macOS (sin firma de Apple) avisa y
//     descarga el instalador .dmg directamente.
//  2. Carga el juego DESDE LA WEB (igual que el navegador), así cada versión nueva del juego llega
//     al instante en Windows y en Mac sin reinstalar nada. Sin internet usa la copia interna.
const { app, BrowserWindow, ipcMain, Menu, shell, net } = require('electron');
const path = require('path');

const REPO = 'hsanchezlabrin-art/ecos-de-valdoria';
const MAC_DMG_URL = `https://github.com/${REPO}/releases/latest/download/EcosDeValdoria-Mac.dmg`;
const WEB = 'https://ecos-de-valdoria.vercel.app';
const GAME_URL = `${WEB}/juego/`;
const CHECK_TIMEOUT = 8000;
// Versión de la carcasa de escritorio: subirla SOLO cuando cambie algo de desktop/ (main.js,
// preload, splash, instalador). El sitio publica la vigente en /escritorio.json.
const SHELL = 3;

let splash = null;
let win = null;

const toSplash = (channel, data) => splash && !splash.isDestroyed() && splash.webContents.send(channel, data);
const status = (text, pct) => toSplash('progress', { text, pct });

function createSplash() {
  splash = new BrowserWindow({
    width: 560,
    height: 340,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    center: true,
    backgroundColor: '#7fd3ff',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'splash-preload.js') },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  return new Promise((resolve) =>
    splash.once('ready-to-show', () => {
      splash.show();
      resolve();
    })
  );
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
  if (process.platform === 'darwin') {
    // macOS necesita un menú para Cmd+Q, copiar/pegar en el chat y pantalla completa
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { label: 'Ver', submenu: [{ role: 'togglefullscreen', label: 'Pantalla completa' }] },
        { role: 'windowMenu' },
      ])
    );
  } else {
    Menu.setApplicationMenu(null);
  }
  loadGame();

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
  // La ventana del juego solo navega dentro del juego; lo demás va al navegador del sistema
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(GAME_URL) || url.startsWith('file:')) return;
    e.preventDefault();
    shell.openExternal(url);
  });

  // Si algo falla, no dejar al jugador mirando el splash para siempre
  const fallback = setTimeout(reveal, 45000);
  win.once('closed', () => clearTimeout(fallback));
  win.on('close', () => win.webContents.send('before-quit'));
}

// El juego se carga desde la web; si no hay conexión o el sitio no responde, se usa la copia
// interna que trae la app (sirve para mostrar el aviso de «sin conexión» del propio juego).
function loadGame() {
  let local = false;
  const useLocal = () => {
    if (local || !win || win.isDestroyed()) return;
    local = true;
    clearTimeout(slow);
    win.loadFile(path.join(__dirname, 'app', 'index.html'));
  };
  const slow = setTimeout(useLocal, 15000);
  win.webContents.once('dom-ready', () => clearTimeout(slow));
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3 && !local && String(url).startsWith(WEB)) useLocal();
  });
  status('Conectando con Valdoria…', 0.06);
  win.loadURL(GAME_URL).catch(useLocal);
}

function reveal() {
  if (win && !win.isDestroyed() && !win.isVisible()) {
    win.maximize();
    win.show();
    win.focus();
  }
  if (splash && !splash.isDestroyed()) {
    status('Todo listo', 1);
    setTimeout(() => splash && !splash.isDestroyed() && splash.close(), 250);
  }
}

// ---------- Actualizaciones ----------

// Versión vigente de la carcasa según el sitio (null si no se pudo consultar)
function remoteShell() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), CHECK_TIMEOUT);
    let body = '';
    const req = net.request({ url: `${WEB}/escritorio.json?t=${Date.now()}` });
    req.on('response', (res) => {
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        clearTimeout(timer);
        try {
          resolve(Number(JSON.parse(body).shell) || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    req.end();
  });
}

const newer = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

// Windows: electron-updater descarga el instalador nuevo y lo aplica al reiniciar.
// Devuelve true si la app se está reiniciando para actualizarse.
function updateWindows() {
  return new Promise((resolve) => {
    let autoUpdater;
    try {
      ({ autoUpdater } = require('electron-updater'));
    } catch {
      return resolve(false);
    }
    let settled = false;
    const done = (restarting) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(restarting);
    };
    const timer = setTimeout(() => done(false), CHECK_TIMEOUT);
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (info) => {
      clearTimeout(timer); // hay versión nueva: esperar la descarga aunque tarde
      status(`Descargando la versión ${info.version}…`, 0.05);
    });
    autoUpdater.on('download-progress', (p) => status(`Descargando actualización… ${Math.round(p.percent)}%`, Math.max(0.05, p.percent / 100)));
    autoUpdater.on('update-downloaded', (info) => {
      status(`Instalando la versión ${info.version}…`, 1);
      settled = true;
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 900);
      resolve(true);
    });
    autoUpdater.on('update-not-available', () => done(false));
    autoUpdater.on('error', () => done(false));
    autoUpdater.checkForUpdates().catch(() => done(false));
  });
}

// macOS: sin firma de Apple no se puede instalar sola. Si la carcasa cambió, el splash ofrece
// descargar el instalador .dmg (directo, sin abrir páginas) o jugar igual.
function checkMac() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), CHECK_TIMEOUT);
    const req = net.request({ url: `https://api.github.com/repos/${REPO}/releases/latest`, headers: { 'User-Agent': 'EcosDeValdoria', Accept: 'application/vnd.github+json' } });
    let body = '';
    req.on('response', (res) => {
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const tag = JSON.parse(body).tag_name;
          if (tag && newer(tag, app.getVersion())) {
            toSplash('update-prompt', { version: tag.replace(/^v/, '') });
            ipcMain.once('update-choice', (_e, choice) => {
              if (choice === 'download') {
                shell.openExternal(MAC_DMG_URL);
                app.quit();
              } else resolve();
            });
            return;
          }
        } catch {
          /* respuesta inesperada */
        }
        resolve();
      });
    });
    req.on('error', () => {
      clearTimeout(timer);
      resolve();
    });
    req.end();
  });
}

async function checkForUpdates() {
  if (!app.isPackaged) return false;
  status('Buscando actualizaciones…', 0.04);
  // El juego se actualiza solo (se carga desde la web): la app solo se reinstala si su carcasa cambió
  const shellNow = await remoteShell();
  if (shellNow == null || shellNow <= SHELL) return false;
  if (process.platform === 'win32') return updateWindows();
  if (process.platform === 'darwin') await checkMac();
  return false;
}

// ---------- Arranque ----------

ipcMain.handle('get-version', () => app.getVersion());
ipcMain.on('progress', (_e, data) => toSplash('progress', data));
ipcMain.on('ready', reveal);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = win && win.isVisible() ? win : splash;
    if (w && !w.isDestroyed()) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  app.whenReady().then(async () => {
    await createSplash();
    const restarting = await checkForUpdates();
    if (restarting) return;
    status('Abriendo las puertas de Brezal…', 0.06);
    createMain();
  });
  app.on('window-all-closed', () => app.quit());
}
