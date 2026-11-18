// Feeds the boot screen (ui/splash.html) the app's real startup stages. It runs
// in the app window for its whole life, so it only exposes anything on file pages.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('devoneSplash', {
    getStages: () => ipcRenderer.invoke('splash:stages'),
    onStage: (callback) => ipcRenderer.on('splash:stage', (_event, stage) => callback(stage))
  });
}
