const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splash', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  onProgress: (fn) => ipcRenderer.on('progress', (_e, data) => fn(data)),
});
