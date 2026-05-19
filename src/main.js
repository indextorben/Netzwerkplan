const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs/promises');
const path = require('path');

let mainWindow;

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('update-downloaded', async (info) => {
    if (!mainWindow) return;

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Jetzt neu starten', 'Beim Beenden installieren'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update bereit',
      message: `Version ${info.version} wurde heruntergeladen.`,
      detail: 'Netzwerkplan kann jetzt neu starten und die neue Version installieren.'
    });

    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (error) => {
    console.warn('Update check failed:', error);
  });
}

function checkForUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.checkForUpdates().catch((error) => {
    console.warn('Update check failed:', error);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1080,
    minHeight: 700,
    title: 'Netzwerkplan',
    backgroundColor: '#111416',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  setupAutoUpdater();
  createWindow();
  checkForUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      checkForUpdates();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('file:saveProject', async (_event, payload) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Netzwerkplan speichern',
    defaultPath: payload.currentPath || 'netzwerkplan.nplan',
    filters: [
      { name: 'Netzwerkplan', extensions: ['nplan'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  });

  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, JSON.stringify(payload.project, null, 2), 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('file:openProject', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Netzwerkplan öffnen',
    properties: ['openFile'],
    filters: [
      { name: 'Netzwerkplan', extensions: ['nplan', 'json'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  const filePath = result.filePaths[0];
  const raw = await fs.readFile(filePath, 'utf8');
  return { canceled: false, filePath, project: JSON.parse(raw) };
});

ipcMain.handle('file:exportText', async (_event, payload) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: payload.title,
    defaultPath: payload.defaultPath,
    filters: payload.filters
  });

  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, payload.contents, 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('file:exportPng', async (_event, payload) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Als PNG exportieren',
    defaultPath: 'netzwerkplan.png',
    filters: [{ name: 'PNG', extensions: ['png'] }]
  });

  if (result.canceled || !result.filePath) return { canceled: true };
  const data = payload.dataUrl.replace(/^data:image\/png;base64,/, '');
  await fs.writeFile(result.filePath, Buffer.from(data, 'base64'));
  return { canceled: false, filePath: result.filePath };
});
