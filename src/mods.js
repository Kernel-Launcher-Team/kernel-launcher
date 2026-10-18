const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { INSTANCES_DIR } = require('./instances');

const CF_API_KEY = '$2a$10$pc88LBOso6/9tXhqCNreC.9UHjc7feOhpmG.ztrBIzMyblxB8.4di';

async function downloadFile(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

// ---------- MODRINTH ----------
async function searchModrinth(query, projectType = 'mod', loader, mcVersion, page = 1, limit = 20) {
  const facets = [[`project_type:${projectType}`]];
  if (loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);
  if (mcVersion) facets.push([`versions:${mcVersion}`]);
  const url = new URL('https://api.modrinth.com/v2/search');
  url.searchParams.set('query', query || '');
  url.searchParams.set('facets', JSON.stringify(facets));
  url.searchParams.set('offset', (page - 1) * limit);
  url.searchParams.set('limit', limit);
  const r = await fetch(url.toString(), { headers: { 'User-Agent': 'Kernel-Launcher/1.0' } });
  if (!r.ok) throw new Error('Modrinth search: HTTP ' + r.status);
  const data = await r.json();
  return {
    items: (data.hits || []).map((h) => ({
      id: h.project_id, title: h.title, description: h.description,
      icon: h.icon_url, downloads: h.downloads, source: 'modrinth'
    })),
    total: data.total_hits || 0
  };
}

async function installFromModrinth({ instance, projectId, mcVersion, loader, projectType }) {
  const subdirMap = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks', world: 'saves' };
  const subdir = subdirMap[projectType] || 'mods';
  const base = path.join(INSTANCES_DIR, instance, '.minecraft', subdir);
  
  async function fetchAndDownload(id, isDependency = false) {
    const r = await fetch(`https://api.modrinth.com/v2/project/${id}/version`, { headers: { 'User-Agent': 'Kernel-Launcher/1.0' } });
    if (!r.ok) return;
    const versions = await r.json();
    const match = versions.find((v) => v.game_versions.includes(mcVersion) && (!loader || loader === 'vanilla' || v.loaders.includes(loader)));
    if (!match) return;
    
    if (match.dependencies && match.dependencies.length > 0) {
      for (const dep of match.dependencies) {
        if (dep.project_id) await fetchAndDownload(dep.project_id, true);
      }
    }

    const file = match.files.find((f) => f.primary) || match.files[0];
    const filePath = path.join(base, file.filename);
    if (!fs.existsSync(filePath)) {
      await downloadFile(file.url, filePath);
    }
    
    if (projectType === 'world' && file.filename.endsWith('.zip')) {
      const zip = new AdmZip(filePath);
      const name = file.filename.replace(/\.zip$/i, '');
      zip.extractAllTo(path.join(base, name), true);
      fs.unlinkSync(filePath);
      return name;
    }
    return file.filename;
  }

  const fileName = await fetchAndDownload(projectId);
  return { ok: true, file: fileName || 'Установлено' };
}

// ---------- CURSEFORGE ----------
async function searchCurseForge(query, type, mcVersion, loader, page = 1, limit = 20) {
  const url = new URL('https://api.curseforge.com/v1/mods/search');
  url.searchParams.set('gameId', '432');
  url.searchParams.set('searchFilter', query || '');
  url.searchParams.set('index', (page - 1) * limit);
  url.searchParams.set('pageSize', limit);
  const classMap = { mod: 6, resourcepack: 12, shader: 6552, world: 17, datapack: 6945, modpack: 4471 };
  if (classMap[type]) url.searchParams.set('classId', String(classMap[type]));
  if (mcVersion) url.searchParams.set('gameVersion', mcVersion);
  const loaderMap = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
  if (loaderMap[loader]) url.searchParams.set('modLoaderType', String(loaderMap[loader]));

  const r = await fetch(url.toString(), { headers: { 'x-api-key': CF_API_KEY } });
  if (!r.ok) throw new Error('CF search: HTTP ' + r.status);
  const data = await r.json();
  return {
    items: (data.data || []).map((m) => ({
      id: m.id, title: m.name, description: m.summary,
      icon: m.logo && m.logo.thumbnailUrl, downloads: m.downloadCount, source: 'curseforge'
    })),
    total: data.pagination ? data.pagination.totalCount : 0
  };
}

async function installFromCurseForge({ instance, projectId, type, mcVersion }) {
  const r = await fetch(`https://api.curseforge.com/v1/mods/${projectId}/files`, { headers: { 'x-api-key': CF_API_KEY } });
  if (!r.ok) throw new Error('CF files: HTTP ' + r.status);
  const data = await r.json();
  const files = data.data || [];
  const match = files.find((f) => (f.gameVersions || []).includes(mcVersion)) || files[0];
  if (!match) throw new Error('Нет файлов для этой версии');

  const destMap = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks', world: 'saves' };
  const subdir = destMap[type] || 'mods';
  const base = path.join(INSTANCES_DIR, instance, '.minecraft', subdir);
  const tmpFile = path.join(base, match.fileName);
  
  await downloadFile(match.downloadUrl, tmpFile);

  if (type === 'world' && match.fileName.endsWith('.zip')) {
    const zip = new AdmZip(tmpFile);
    const name = match.fileName.replace(/\.zip$/i, '');
    zip.extractAllTo(path.join(base, name), true);
    fs.unlinkSync(tmpFile);
    return { ok: true, file: name };
  }
  return { ok: true, file: match.fileName };
}

async function deleteMod(instance, filename, type) {
  const destMap = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks', world: 'saves' };
  const subdir = destMap[type] || 'mods';
  const filePath = path.join(INSTANCES_DIR, instance, '.minecraft', subdir, filename);
  
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { recursive: true, force: true });
    return { ok: true };
  }
  return { ok: false, error: 'Файл не найден' };
}

async function importMrpack(file, instanceName) {
  const zip = new AdmZip(file);
  const manifest = JSON.parse(zip.readAsText('modrinth.index.json'));
  const mcVersion = manifest.dependencies.minecraft;
  const loader = manifest.dependencies['fabric-loader'] ? 'fabric' : manifest.dependencies['quilt-loader'] ? 'quilt' : manifest.dependencies.forge ? 'forge' : manifest.dependencies.neoforge ? 'neoforge' : 'vanilla';
  const { createInstance } = require('./instances');
  createInstance({ name: instanceName, mcVersion, loader });
  const base = path.join(INSTANCES_DIR, instanceName, '.minecraft');
  for (const f of manifest.files || []) {
    try { await downloadFile(f.downloads[0], path.join(base, f.path)); } catch (e) {}
  }
  zip.getEntries().forEach((e) => {
    if (e.entryName.startsWith('overrides/') && !e.isDirectory) {
      const rel = e.entryName.slice('overrides/'.length);
      const out = path.join(base, rel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, e.getData());
    }
  });
  return { ok: true, instanceName, mcVersion, loader };
}

async function importZipArchive(file, instanceName) {
  const zip = new AdmZip(file);
  const names = zip.getEntries().map((e) => e.entryName);
  let kind = 'raw';
  if (names.includes('manifest.json')) kind = 'curseforge';
  else if (names.some((n) => n.endsWith('mmc-pack.json'))) kind = 'prism';
  const { createInstance } = require('./instances');
  createInstance({ name: instanceName, mcVersion: 'imported', loader: 'vanilla' });
  const base = path.join(INSTANCES_DIR, instanceName, '.minecraft');
  zip.getEntries().forEach((e) => {
    if (e.isDirectory) return;
    let rel = e.entryName;
    if (kind === 'curseforge') rel = rel.replace(/^overrides\//, '');
    else rel = rel.replace(/^\.minecraft\//, '');
    const out = path.join(base, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.getData());
  });
  return { ok: true, instanceName, kind };
}

module.exports = {
  searchModrinth, installFromModrinth, searchCurseForge, installFromCurseForge,
  importMrpack, importZipArchive, deleteMod
};
