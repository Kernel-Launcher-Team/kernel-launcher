const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { VERSIONS_DIR, LIBS_DIR, MC_DIR, download, ensureDir } = require('./versions');

async function installFabric(mcVersion) {
  const r = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
  const list = await r.json();
  if (!list.length) throw new Error('Fabric для ' + mcVersion + ' не найден');
  const loaderVer = list[0].loader.version;
  const p = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVer}/profile/json`);
  const profile = await p.json();
  const vid = profile.id;
  const vdir = path.join(VERSIONS_DIR, vid);
  ensureDir(vdir);
  for (const lib of profile.libraries || []) {
    const parts = lib.name.split(':');
    const rel = `${parts[0].replace(/\./g, '/')}/${parts[1]}/${parts[2]}/${parts[1]}-${parts[2]}.jar`;
    const base = lib.url || 'https://maven.fabricmc.net/';
    try { await download(base + rel, path.join(LIBS_DIR, rel)); } catch (e) {}
  }
  fs.writeFileSync(path.join(vdir, `${vid}.json`), JSON.stringify(profile, null, 2));
  return { versionId: vid, loaderVersion: loaderVer };
}

async function installQuilt(mcVersion) {
  const r = await fetch(`https://meta.quiltmc.org/v3/versions/loader/${mcVersion}`);
  const list = await r.json();
  if (!list.length) throw new Error('Quilt для ' + mcVersion + ' не найден');
  const loaderVer = list[0].loader.version;
  const p = await fetch(`https://meta.quiltmc.org/v3/versions/loader/${mcVersion}/${loaderVer}/profile/json`);
  const profile = await p.json();
  const vid = profile.id;
  const vdir = path.join(VERSIONS_DIR, vid);
  ensureDir(vdir);
  for (const lib of profile.libraries || []) {
    const parts = lib.name.split(':');
    const rel = `${parts[0].replace(/\./g, '/')}/${parts[1]}/${parts[2]}/${parts[1]}-${parts[2]}.jar`;
    const base = lib.url || 'https://maven.quiltmc.org/repository/release/';
    try { await download(base + rel, path.join(LIBS_DIR, rel)); } catch (e) {}
  }
  fs.writeFileSync(path.join(vdir, `${vid}.json`), JSON.stringify(profile, null, 2));
  return { versionId: vid, loaderVersion: loaderVer };
}

async function installForge(mcVersion) {
  const pr = await fetch('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
  const promos = await pr.json();
  const forgeVer = promos.promos[`${mcVersion}-recommended`] || promos.promos[`${mcVersion}-latest`];
  if (!forgeVer) throw new Error('Forge для ' + mcVersion + ' не найден');
  const fullVer = `${mcVersion}-${forgeVer}`;
  const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVer}/forge-${fullVer}-installer.jar`;
  const cacheDir = path.join(VERSIONS_DIR, '_cache');
  ensureDir(cacheDir);
  const installer = path.join(cacheDir, `forge-${fullVer}-installer.jar`);
  await download(url, installer);
  const { spawnSync } = require('child_process');
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
  const res = spawnSync(java, ['-jar', installer, '--installClient', MC_DIR], { stdio: 'inherit' });
  if (res.error) throw new Error('Java error: ' + res.error.message);
  if (res.status !== 0) throw new Error('Forge installer упал с кодом ' + res.status);
  const all = fs.readdirSync(VERSIONS_DIR);
  const found = all.find((v) => v.includes(forgeVer) && v.includes(mcVersion) && v !== '_cache');
  return { versionId: found || fullVer, loaderVersion: forgeVer };
}

async function installNeoForge(mcVersion) {
  const r = await fetch('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
  const data = await r.json();
  const prefix = mcVersion.replace(/^1\./, '');
  const ver = data.versions.filter((v) => v.startsWith(prefix + '.')).pop();
  if (!ver) throw new Error('NeoForge для ' + mcVersion + ' не найден');
  const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${ver}/neoforge-${ver}-installer.jar`;
  const cacheDir = path.join(VERSIONS_DIR, '_cache');
  ensureDir(cacheDir);
  const installer = path.join(cacheDir, `neoforge-${ver}-installer.jar`);
  await download(url, installer);
  const { spawnSync } = require('child_process');
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
  const res = spawnSync(java, ['-jar', installer, '--installClient', MC_DIR], { stdio: 'inherit' });
  if (res.error) throw new Error('Java error: ' + res.error.message);
  if (res.status !== 0) throw new Error('NeoForge installer упал с кодом ' + res.status);
  const all = fs.readdirSync(VERSIONS_DIR);
  const found = all.find((v) => v.toLowerCase().includes('neoforge') && v.includes(ver));
  return { versionId: found || `neoforge-${ver}`, loaderVersion: ver };
}

async function installLiteLoader(mcVersion) {
  const supported = ['1.5.2','1.6.2','1.6.4','1.7.2','1.7.10','1.8','1.8.9','1.9','1.9.4','1.10.2','1.11.2','1.12','1.12.1','1.12.2'];
  if (!supported.includes(mcVersion)) throw new Error('LiteLoader не поддерживает ' + mcVersion);
  const url = `https://dl.liteloader.com/versions/com/mumfrey/liteloader/${mcVersion}/liteloader-${mcVersion}.jar`;
  const cacheDir = path.join(VERSIONS_DIR, '_cache');
  ensureDir(cacheDir);
  const installer = path.join(cacheDir, `liteloader-${mcVersion}.jar`);
  try {
    await download(url, installer);
  } catch (e) {
    throw new Error('Не удалось скачать LiteLoader. Сайт часто недоступен. Скачай вручную с зеркала и положи в ' + cacheDir);
  }
  const { spawnSync } = require('child_process');
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
  const res = spawnSync(java, ['-jar', installer], { stdio: 'inherit' });
  if (res.error) throw new Error('Java error: ' + res.error.message);
  if (res.status !== 0) throw new Error('LiteLoader installer упал с кодом ' + res.status);
  const all = fs.readdirSync(VERSIONS_DIR);
  const found = all.find((v) => v.includes('liteloader') && v.includes(mcVersion));
  return { versionId: found || `liteloader-${mcVersion}`, loaderVersion: 'latest' };
}

module.exports = { installFabric, installQuilt, installForge, installNeoForge, installLiteLoader };