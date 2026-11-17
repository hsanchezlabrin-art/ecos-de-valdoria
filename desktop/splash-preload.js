const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splash', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  onProgress: (fn) => ipcRenderer.on('progress', (_e, data) => fn(data)),
  onUpdatePrompt: (fn) => ipcRenderer.on('update-prompt', (_e, data) => fn(data)),
  choose: (choice) => ipcRenderer.send('update-choice', choice),
});
