const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Берем путь из main.js, иначе fallback
const MC_DIR = process.env.KERNEL_GAME_DIR || path.join(__dirname, '..', 'game');
const VERSIONS_DIR = path.join(MC_DIR, 'versions');
const LIBS_DIR = path.join(MC_DIR, 'libraries');
const ASSETS_DIR = path.join(MC_DIR, 'assets');

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES_URL = 'https://resources.download.minecraft.net';

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function osName() { return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'; }

async function getManifest() {
  const r = await fetch(MANIFEST_URL);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function getVersionList() {
  const manifest = await getManifest();
  return manifest.versions.map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
}

async function getVersionJson(versionId) {
  const manifest = await getManifest();
  const entry = manifest.versions.find((v) => v.id === versionId);
  if (!entry) throw new Error('Версия не найдена: ' + versionId);
  const r = await fetch(entry.url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function download(url, dest) {
  ensureDir(path.dirname(dest));
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

function rulesAllow(rules, osn) {
  if (!rules || rules.length === 0) return true;
  let allow = false;
  for (const r of rules) {
    const matchOs = !r.os || r.os.name === osn;
    if (r.action === 'allow' && matchOs) allow = true;
    if (r.action === 'disallow' && matchOs) allow = false;
  }
  return allow;
}

function libPath(lib, osn) {
  const artifact = lib.downloads && lib.downloads.artifact;
  if (artifact) return artifact.path;
  if (lib.natives) {
    const classifier = lib.natives[osn];
    if (classifier && lib.downloads && lib.downloads.classifiers) {
      const cls = lib.downloads.classifiers[classifier];
      if (cls) return cls.path;
    }
  }
  const parts = lib.name.split(':');
  return `${parts[0].replace(/\./g, '/')}/${parts[1]}/${parts[2]}/${parts[1]}-${parts[2]}.jar`;
}

async function installVersion(versionId, onProgress = () => {}) {
  const osn = osName();
  onProgress({ text: 'Получаем метаданные ' + versionId + '...', percent: 0 });
  const vjson = await getVersionJson(versionId);
  const vid = vjson.id;
  const versionDir = path.join(VERSIONS_DIR, vid);
  ensureDir(versionDir);

  onProgress({ text: 'Скачиваем client.jar...', percent: 5 });
  if (vjson.downloads && vjson.downloads.client && vjson.downloads.client.url) {
    await download(vjson.downloads.client.url, path.join(versionDir, `${vid}.jar`));
  }

  const libs = (vjson.libraries || []).filter((l) => rulesAllow(l.rules, osn));
  let i = 0;
  for (const lib of libs) {
    i++;
    onProgress({ text: `Библиотеки ${i}/${libs.length}`, percent: 5 + Math.round((i / libs.length) * 30) });
    const rel = libPath(lib, osn);
    let url = null;
    if (lib.downloads && lib.downloads.artifact) url = lib.downloads.artifact.url;
    else if (lib.natives && lib.downloads && lib.downloads.classifiers) {
      const cls = lib.downloads.classifiers[lib.natives[osn]];
      if (cls) url = cls.url;
    }
    if (!url) url = 'https://libraries.minecraft.net/' + rel;
    try { await download(url, path.join(LIBS_DIR, rel)); } catch (e) {}
  }

  if (vjson.assetIndex && vjson.assetIndex.url) {
    onProgress({ text: 'Скачиваем индексы ассетов...', percent: 35 });
    const indexPath = path.join(ASSETS_DIR, 'indexes', `${vjson.assetIndex.id}.json`);
    await download(vjson.assetIndex.url, indexPath);
    const indexJson = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const objects = Object.entries(indexJson.objects || {});
    let a = 0;
    for (const [name, info] of objects) {
      a++;
      if (a % 100 === 0) onProgress({ text: `Ассеты ${a}/${objects.length}`, percent: 35 + Math.round((a / objects.length) * 65) });
      const hash = info.hash;
      const sub = hash.slice(0, 2);
      const dest = path.join(ASSETS_DIR, 'objects', sub, hash);
      if (fs.existsSync(dest)) continue;
      try { await download(`${RESOURCES_URL}/${sub}/${hash}`, dest); } catch (e) {}
    }
  }

  fs.writeFileSync(path.join(versionDir, `${vid}.json`), JSON.stringify(vjson, null, 2));
  onProgress({ text: 'Готово!', percent: 100 });
  return vjson;
}

module.exports = {
  installVersion, getVersionJson, getManifest, getVersionList,
  MC_DIR, VERSIONS_DIR, LIBS_DIR, ASSETS_DIR,
  download, ensureDir, osName, rulesAllow, libPath
};