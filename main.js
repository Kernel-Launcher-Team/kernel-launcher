const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

let BASE_DIR;
if (!app.isPackaged) {
  BASE_DIR = __dirname;
} else if (process.env.PORTABLE_EXECUTABLE_DIR) {
  BASE_DIR = process.env.PORTABLE_EXECUTABLE_DIR;
} else {
  BASE_DIR = path.dirname(app.getPath('exe'));
}

const GAME_DIR = path.join(BASE_DIR, 'game');
const DATA_DIR = path.join(BASE_DIR, 'data');

if (!fs.existsSync(GAME_DIR)) fs.mkdirSync(GAME_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

process.env.KERNEL_GAME_DIR = GAME_DIR;
process.env.KERNEL_DATA_DIR = DATA_DIR;

const { launchGame } = require('./src/launcher');
const { authMicrosoft, authEly, authOffline } = require('./src/auth');
const { installVersion, installLoader, getLoaderVersions } = require('./src/installers');
const {
  searchModrinth, installFromModrinth, searchCurseForge, installFromCurseForge,
  importMrpack, importZipArchive, deleteMod, removeProject, getModrinthDetails, getCurseForgeDetails,
  listLocalMods, toggleLocalMod
} = require('./src/mods');
const {
  listInstances, createInstance, updateInstance, deleteInstance, INSTANCES_DIR
} = require('./src/instances');
const { getVersionList, repairAssets } = require('./src/versions');
const { loadConfig, saveConfig } = require('./src/config');

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

  global.mainWindow = win;
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

ipcMain.handle('win:minimize', () => win.minimize());
ipcMain.handle('win:close', () => win.close());

ipcMain.handle('auth:microsoft', () => authMicrosoft(win));
ipcMain.handle('auth:ely', (_, login, pass) => authEly(login, pass));
ipcMain.handle('auth:offline', (_, nick) => authOffline(nick));

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_, patch) => saveConfig(patch));

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

ipcMain.handle('assets:repair', async (_, versionId) => {
  try {
    const res = await repairAssets(versionId, (progress) => {
      if (win && !win.isDestroyed()) win.webContents.send('progress', progress);
    });
    return { ok: res.ok, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('loader:install', async (_, args) => {
  try {
    const res = await installLoader({
      loader: args.loader,
      mcVersion: args.mcVersion,
      version: args.version,
      onProgress: (progress) => {
        if (win && !win.isDestroyed()) win.webContents.send('progress', progress);
      }
    });

    if (args.instance && res.versionId) {
      updateInstance(args.instance, { versionId: res.versionId, loaderVersion: res.loaderVersion });
    }

    return { ok: true, ...res };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('loader:versions', async (_, loader, mcVersion) => {
  try { return { ok: true, versions: await getLoaderVersions(loader, mcVersion) }; }
  catch (e) { return { ok: false, error: e.message, versions: [] }; }
});

ipcMain.handle('modrinth:search', (_, q, type, loader, mcVersion, page, limit) =>
  searchModrinth(q, type, loader, mcVersion, page, limit));
ipcMain.handle('modrinth:install', (_, args) => installFromModrinth(args));
ipcMain.handle('modrinth:details', (_, id) => getModrinthDetails(id));

ipcMain.handle('cf:search', (_, q, type, mcVersion, loader, page, limit) =>
  searchCurseForge(q, type, mcVersion, loader, page, limit));
ipcMain.handle('cf:install', (_, args) => installFromCurseForge(args));
ipcMain.handle('cf:details', (_, id) => getCurseForgeDetails(id));

ipcMain.handle('mrpack:import', (_, file, name) => importMrpack(file, name));
ipcMain.handle('zip:import', (_, file, name, kind) => importZipArchive(file, name, kind));

ipcMain.handle('instances:list', () => listInstances());
ipcMain.handle('instances:create', (_, opts) => createInstance(opts));
ipcMain.handle('instances:update', (_, name, patch) => updateInstance(name, patch));
ipcMain.handle('instances:delete', (_, name) => deleteInstance(name));

ipcMain.handle('mods:delete', (_, instance, filename, type) => deleteMod(instance, filename, type));
ipcMain.handle('mods:listLocal', (_, instance, type) => listLocalMods(instance, type));
ipcMain.handle('mods:toggleLocal', (_, instance, filename, type) => toggleLocalMod(instance, filename, type));

ipcMain.handle('mods:deleteByProjectId', (_, instance, projectId, type) => removeProject(instance, projectId, type));

ipcMain.handle('mods:importLocal', async (_, instance, filePath, type) => {
  const destMap = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks', world: 'saves' };
  const subdir = destMap[type] || 'mods';
  const base = path.join(INSTANCES_DIR, instance, '.minecraft', subdir);
  const fileName = path.basename(filePath);
  const dest = path.join(base, fileName);
  try {
    fs.mkdirSync(base, { recursive: true });
    fs.copyFileSync(filePath, dest);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('export:mrpack', async (_, instance) => {
  const instDir = path.join(INSTANCES_DIR, instance);
  const meta = JSON.parse(fs.readFileSync(path.join(instDir, 'instance.json'), 'utf8'));
  const { filePath } = await dialog.showSaveDialog(win, {
    title: 'Export .mrpack',
    defaultPath: `${instance}.mrpack`,
    filters: [{ name: 'Modrinth Pack', extensions: ['mrpack'] }]
  });
  if (!filePath) return { ok: false, error: 'Cancelled' };

  const zip = new AdmZip();
  const manifest = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0.0',
    name: instance,
    summary: '',
    files: [],
    dependencies: { minecraft: meta.mcVersion }
  };
  if (meta.loader === 'fabric') manifest.dependencies['fabric-loader'] = meta.loaderVersion || '0.15.0';
  else if (meta.loader === 'quilt') manifest.dependencies['quilt-loader'] = meta.loaderVersion || '0.20.0';
  else if (meta.loader === 'forge') manifest.dependencies['forge'] = meta.loaderVersion || '47.1.0';
  else if (meta.loader === 'neoforge') manifest.dependencies['neoforge'] = meta.loaderVersion || '20.4.0';

  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(manifest, null, 2)));

  const mcDir = path.join(instDir, '.minecraft');
  if (fs.existsSync(mcDir)) {
    zip.addLocalFolder(mcDir, 'overrides');
  }

  zip.writeZip(filePath);
  return { ok: true };
});

ipcMain.handle('export:zip', async (_, instance) => {
  const instDir = path.join(INSTANCES_DIR, instance);
  const { filePath } = await dialog.showSaveDialog(win, {
    title: 'Export .zip',
    defaultPath: `${instance}.zip`,
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
  });
  if (!filePath) return { ok: false, error: 'Cancelled' };

  const zip = new AdmZip();
  const mcDir = path.join(instDir, '.minecraft');
  if (fs.existsSync(mcDir)) {
    zip.addLocalFolder(mcDir, '.minecraft');
  }
  zip.writeZip(filePath);
  return { ok: true };
});

ipcMain.handle('game:launch', async (_, opts) => {
  try {
    if (gameProcess) return { ok: false, error: 'Game is already running' };
    const res = await launchGame({
      ...opts,
      onProgress: (progress) => {
        if (win && !win.isDestroyed()) win.webContents.send('progress', progress);
      }
    });
    gameProcess = res.proc;

    gameProcess.on('close', (code, signal) => {
      console.log('[game] closed, code =', code, 'signal =', signal);
      gameProcess = null;

      const killedByUser = signal === 'SIGTERM' || signal === 'SIGKILL';
      const isCrash = !killedByUser && code !== 0 && code !== null;

      let reason = '';
      if (isCrash) {
        reason = `Minecraft closed with exit code ${code}. Check logs/latest.log and crash-reports/.`;
      }

      if (win && !win.isDestroyed()) win.webContents.send('game:closed', { isCrash, reason, code });
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
  return { ok: false, error: 'Game is not running' };
});

ipcMain.handle('dialog:openFile', async (_, filters) => {
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  return res.filePaths[0];
});

ipcMain.handle('shell:openFolder', (_, instance) => {
  const folder = path.join(INSTANCES_DIR, instance, '.minecraft');
  shell.openPath(folder);
});

ipcMain.handle('shell:openInstanceMods', (_, instance, type) => {
  const destMap = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks', world: 'saves' };
  const subdir = destMap[type] || 'mods';
  const folder = path.join(INSTANCES_DIR, instance, '.minecraft', subdir);
  shell.openPath(folder);
});

ipcMain.handle('shell:openLog', (_, instance) => {
  const folder = path.join(INSTANCES_DIR, instance, '.minecraft', 'logs');
  shell.openPath(folder);
});
