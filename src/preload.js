const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('netzwerkplan', {
  saveProject: (payload) => ipcRenderer.invoke('file:saveProject', payload),
  openProject: () => ipcRenderer.invoke('file:openProject'),
  exportText: (payload) => ipcRenderer.invoke('file:exportText', payload),
  exportPng: (payload) => ipcRenderer.invoke('file:exportPng', payload),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  onUpdateMessage: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('update:message', listener);
    return () => ipcRenderer.removeListener('update:message', listener);
  }
});
