// Puente seguro entre el juego y la app de escritorio.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  progress: (text, pct) => ipcRenderer.send('progress', { text, pct }),
  ready: () => ipcRenderer.send('ready'),
  onBeforeQuit: (fn) => ipcRenderer.on('before-quit', () => fn()),
});
