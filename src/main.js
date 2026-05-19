const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const https = require('https');
const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');

let mainWindow;
let manualUpdateCheck = false;
let updateDialogOpen = false;
let updateInstallRequested = false;
let downloadedUpdateVersion = null;
let lastUpdateProgress = null;
let manualMacDownloadInProgress = false;
const githubOwner = 'indextorben';
const githubRepo = 'Netzwerkplan';

function formatMegabytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unbekannt';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sendUpdateMessage(type, payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('update:message', { type, ...payload });
}

function compareVersions(a, b) {
  const left = String(a).replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b).replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Netzwerkplan'
      }
    }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`GitHub antwortete mit Status ${response.statusCode}`));
        response.resume();
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, destination, version) {
  return new Promise((resolve, reject) => {
    const file = fsSync.createWriteStream(destination);
    let transferredBytes = 0;

    https.get(url, {
      headers: { 'User-Agent': 'Netzwerkplan' }
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        file.close();
        fs.unlink(destination).catch(() => {});
        downloadFile(response.headers.location, destination, version).then(resolve, reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        file.close();
        fs.unlink(destination).catch(() => {});
        reject(new Error(`Download antwortete mit Status ${response.statusCode}`));
        return;
      }

      const totalBytes = Number.parseInt(response.headers['content-length'] || '0', 10);
      sendUpdateMessage('available', { version, totalBytes });

      response.on('data', (chunk) => {
        transferredBytes += chunk.length;
        sendUpdateMessage('progress', {
          percent: totalBytes ? (transferredBytes / totalBytes) * 100 : 0,
          transferredBytes,
          totalBytes
        });
      });

      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve({ transferredBytes, totalBytes }));
      });
    }).on('error', (error) => {
      file.close();
      fs.unlink(destination).catch(() => {});
      reject(error);
    });
  });
}

async function checkForManualMacUpdate() {
  if (!app.isPackaged || manualMacDownloadInProgress) {
    return { status: app.isPackaged ? 'checking' : 'development', message: 'Update-Pruefung ist nur in der installierten App aktiv.' };
  }

  manualMacDownloadInProgress = true;
  try {
    const release = await requestJson(`https://api.github.com/repos/${githubOwner}/${githubRepo}/releases/latest`);
    const latestVersion = String(release.tag_name || '').replace(/^v/, '');
    if (!latestVersion || compareVersions(latestVersion, app.getVersion()) <= 0) {
      sendUpdateMessage('not-available');
      return { status: 'current' };
    }

    const dmg = release.assets?.find((asset) => asset.name.endsWith('.dmg'));
    if (!dmg) throw new Error('Im neuesten GitHub Release wurde keine DMG-Datei gefunden.');

    const destination = path.join(app.getPath('downloads'), dmg.name);
    await downloadFile(dmg.browser_download_url, destination, latestVersion);
    sendUpdateMessage('downloaded', { version: latestVersion, totalBytes: dmg.size || 0 });

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['DMG öffnen', 'Später'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update heruntergeladen',
      message: `Version ${latestVersion} wurde heruntergeladen.`,
      detail: `Groesse: ${formatMegabytes(dmg.size || 0)}\nDie DMG liegt in deinem Downloads-Ordner.`
    });

    if (response === 0) {
      await shell.openPath(destination);
    }
    return { status: 'downloaded', filePath: destination };
  } catch (error) {
    sendUpdateMessage('error', { message: error.message || String(error) });
    if (mainWindow) {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        buttons: ['OK'],
        title: 'Update-Pruefung fehlgeschlagen',
        message: 'Updates konnten gerade nicht geprueft werden.',
        detail: error.message || String(error)
      });
    }
    return { status: 'error', message: error.message || String(error) };
  } finally {
    manualMacDownloadInProgress = false;
  }
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('update-available', (info) => {
    sendUpdateMessage('available', {
      version: info.version,
      totalBytes: info.files?.[0]?.size || 0
    });
    if (!manualUpdateCheck || !mainWindow) return;

    dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['OK'],
      title: 'Update gefunden',
      message: `Version ${info.version} ist verfuegbar.`,
      detail: 'Das Update wird jetzt heruntergeladen.'
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdateMessage('not-available');
    if (!manualUpdateCheck || !mainWindow) return;
    manualUpdateCheck = false;

    dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['OK'],
      title: 'Keine Updates',
      message: 'Netzwerkplan ist aktuell.',
      detail: `Installierte Version: ${app.getVersion()}`
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    lastUpdateProgress = {
      percent: progress.percent || 0,
      transferredBytes: progress.transferred || 0,
      totalBytes: progress.total || 0,
      bytesPerSecond: progress.bytesPerSecond || 0
    };
    sendUpdateMessage('progress', lastUpdateProgress);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    if (!mainWindow || updateDialogOpen || updateInstallRequested || downloadedUpdateVersion === info.version) return;
    manualUpdateCheck = false;
    updateDialogOpen = true;
    downloadedUpdateVersion = info.version;
    sendUpdateMessage('downloaded', {
      version: info.version,
      totalBytes: lastUpdateProgress?.totalBytes || info.files?.[0]?.size || 0
    });

    const sizeLabel = formatMegabytes(lastUpdateProgress?.totalBytes || info.files?.[0]?.size || 0);

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Jetzt neu starten', 'Beim Beenden installieren'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update bereit',
      message: `Version ${info.version} wurde heruntergeladen.`,
      detail: `Groesse: ${sizeLabel}\nNetzwerkplan kann jetzt neu starten und die neue Version installieren.`
    });
    updateDialogOpen = false;

    if (response === 0) {
      updateInstallRequested = true;
      setImmediate(() => {
        autoUpdater.quitAndInstall(false, true);
      });
    }
  });

  autoUpdater.on('error', (error) => {
    console.warn('Update check failed:', error);
    sendUpdateMessage('error', { message: error.message || String(error) });
    if (!manualUpdateCheck || !mainWindow) return;
    manualUpdateCheck = false;

    dialog.showMessageBox(mainWindow, {
      type: 'error',
      buttons: ['OK'],
      title: 'Update-Pruefung fehlgeschlagen',
      message: 'Updates konnten gerade nicht geprueft werden.',
      detail: error.message || String(error)
    });
  });
}

function checkForUpdates() {
  if (!app.isPackaged) return;
  if (process.platform === 'darwin') {
    checkForManualMacUpdate();
    return;
  }
  if (updateDialogOpen || updateInstallRequested || downloadedUpdateVersion) return;

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

  const rendererPath = path.join(app.getAppPath(), 'src', 'index.html');
  mainWindow.loadFile(rendererPath).catch((error) => {
    console.error('Failed to load renderer:', error);
    dialog.showErrorBox('Netzwerkplan konnte nicht gestartet werden', error.message || String(error));
  });
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

ipcMain.handle('app:checkForUpdates', async () => {
  if (!app.isPackaged) {
    return {
      status: 'development',
      message: 'Update-Pruefung ist nur in der installierten App aktiv.'
    };
  }

  if (process.platform === 'darwin') {
    return checkForManualMacUpdate();
  }

  manualUpdateCheck = true;
  await autoUpdater.checkForUpdates();
  return { status: 'checking' };
});
