const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lmAPI', {
  minimize: () => ipcRenderer.invoke('win:minimize'),
  close: () => ipcRenderer.invoke('win:close'),
  authOffline: (nick) => ipcRenderer.invoke('auth:offline', nick),
  authEly: (l, p) => ipcRenderer.invoke('auth:ely', l, p),
  authMicrosoft: () => ipcRenderer.invoke('auth:microsoft'),
  instances: {
    list: () => ipcRenderer.invoke('instances:list'),
    create: (o) => ipcRenderer.invoke('instances:create', o),
    update: (n, p) => ipcRenderer.invoke('instances:update', n, p),
    delete: (n) => ipcRenderer.invoke('instances:delete', n)
  },
  versions: {
    install: (v) => ipcRenderer.invoke('versions:install', v),
    list: () => ipcRenderer.invoke('versions:list')
  },
  loader: { install: (a) => ipcRenderer.invoke('loader:install', a) },
  modrinth: {
    search: (q, t, l, v, page, limit) => ipcRenderer.invoke('modrinth:search', q, t, l, v, page, limit),
    install: (a) => ipcRenderer.invoke('modrinth:install', a)
  },
  curseforge: {
    search: (q, t, v, l, page, limit) => ipcRenderer.invoke('cf:search', q, t, v, l, page, limit),
    install: (a) => ipcRenderer.invoke('cf:install', a)
  },
  mrpack: { import: (f, n) => ipcRenderer.invoke('mrpack:import', f, n) },
  zip: { import: (f, n) => ipcRenderer.invoke('zip:import', f, n) },
  game: { 
    launch: (o) => ipcRenderer.invoke('game:launch', o),
    kill: () => ipcRenderer.invoke('game:kill')
  },
  dialog: { openFile: (f) => ipcRenderer.invoke('dialog:openFile', f) },
  onProgress: (cb) => ipcRenderer.on('progress', (_, data) => cb(data)),
  onGameClosed: (cb) => ipcRenderer.on('game:closed', () => cb()),
  
  mods: {
    delete: (instance, filename, type) => ipcRenderer.invoke('mods:delete', instance, filename, type)
  },
  shell: {
    openFolder: (instance) => ipcRenderer.invoke('shell:openFolder', instance)
  }
});
