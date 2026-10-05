// Bridge for the database setup screen (setup.html): the only things it can ask
// the main process for. The window is sandboxed, without Node.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('devoneSetup', {
  load: () => ipcRenderer.invoke('setup:load'),
  test: (input) => ipcRenderer.invoke('setup:test', input),
  save: (input) => ipcRenderer.invoke('setup:save', input),
  copyKey: () => ipcRenderer.invoke('setup:copy-key'),
  cancel: () => ipcRenderer.invoke('setup:cancel')
});
