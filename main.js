const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const BASE_DIR = app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname;
const GAME_DIR = path.join(BASE_DIR, 'game');
const DATA_DIR = path.join(BASE_DIR, 'data');

if (!fs.existsSync(GAME_DIR)) fs.mkdirSync(GAME_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

process.env.KERNEL_GAME_DIR = GAME_DIR;
process.env.KERNEL_DATA_DIR = DATA_DIR;

const { launchGame } = require('./src/launcher');
const { authMicrosoft, authEly, authOffline } = require('./src/auth');
const { installVersion, installLoader } = require('./src/installers');
const {
  searchModrinth, installFromModrinth, searchCurseForge, installFromCurseForge,
  importMrpack, importZipArchive, deleteMod
} = require('./src/mods');
const {
  listInstances, createInstance, updateInstance, deleteInstance, INSTANCES_DIR
} = require('./src/instances');
const { installLiteLoader } = require('./src/loaders');
const { getVersionList } = require('./src/versions');

let win;
let gameProcess = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 750, minWidth: 900, minHeight: 600,
    frame: false, backgroundColor: '#14161c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

ipcMain.handle('win:minimize', () => win.minimize());
ipcMain.handle('win:close', () => win.close());

ipcMain.handle('auth:microsoft', () => authMicrosoft(win));
ipcMain.handle('auth:ely', (_, login, pass) => authEly(login, pass));
ipcMain.handle('auth:offline', (_, nick) => authOffline(nick));

ipcMain.handle('versions:install', async (_, versionId) => {
  try {
    const vjson = await installVersion(versionId, (progress) => {
      if (win && !win.isDestroyed()) win.webContents.send('progress', progress);
    });
    return { ok: true, version: vjson.id };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('versions:list', async () => {
  try { return { ok: true, versions: await getVersionList() }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('loader:install', async (_, args) => {
  try {
    let res;
    if (args.loader === 'liteloader') res = await installLiteLoader(args.mcVersion);
    else res = await installLoader(args);
    return { ok: true, ...res };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('modrinth:search', (_, q, type, loader, mcVersion, page, limit) =>
  searchModrinth(q, type, loader, mcVersion, page, limit));
ipcMain.handle('modrinth:install', (_, args) => installFromModrinth(args));
ipcMain.handle('mrpack:import', (_, file, name) => importMrpack(file, name));

ipcMain.handle('cf:search', (_, q, type, mcVersion, loader, page, limit) =>
  searchCurseForge(q, type, mcVersion, loader, page, limit));
ipcMain.handle('cf:install', (_, args) => installFromCurseForge(args));
ipcMain.handle('zip:import', (_, file, name) => importZipArchive(file, name));
ipcMain.handle('mods:delete', (_, instance, filename, type) => deleteMod(instance, filename, type));

ipcMain.handle('instances:list', () => listInstances());
ipcMain.handle('instances:create', (_, opts) => createInstance(opts));
ipcMain.handle('instances:update', (_, name, patch) => updateInstance(name, patch));
ipcMain.handle('instances:delete', (_, name) => deleteInstance(name));

ipcMain.handle('game:launch', async (_, opts) => {
  try {
    if (gameProcess) return { ok: false, error: 'Игра уже запущена' };
    const res = await launchGame({
      ...opts,
      onProgress: (progress) => {
        if (win && !win.isDestroyed()) win.webContents.send('progress', progress);
      }
    });
    gameProcess = res.proc;
    gameProcess.on('close', () => {
      gameProcess = null;
      if (win && !win.isDestroyed()) win.webContents.send('game:closed');
    });
    return { ok: true, pid: res.pid };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('game:kill', () => {
  if (gameProcess) {
    gameProcess.kill();
    gameProcess = null;
    return { ok: true };
  }
  return { ok: false, error: 'Игра не запущена' };
});

ipcMain.handle('dialog:openFile', async (_, filters) => {
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  return res.filePaths[0];
});

ipcMain.handle('shell:openFolder', (_, instance) => {
  const folder = path.join(INSTANCES_DIR, instance, '.minecraft');
  shell.openPath(folder);
});
