// Exposes the database settings actions to settings.html and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('devone', {
  getDatabase: () => ipcRenderer.invoke('database:get'),
  testDatabase: (url) => ipcRenderer.invoke('database:test', url),
  saveDatabase: (settings) => ipcRenderer.invoke('database:save', settings)
});
