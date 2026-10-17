const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const { MC_DIR, VERSIONS_DIR, LIBS_DIR, ASSETS_DIR, rulesAllow, osName } = require('./versions');
const { INSTANCES_DIR } = require('./instances');

function replaceAll(str, map) {
  for (const k of Object.keys(map)) str = str.split(k).join(map[k]);
  return str;
}

async function getJavaPath(vjson, onProgress) {
  const javaVer = vjson.javaVersion ? vjson.javaVersion.majorVersion : 8;
  const javaBaseDir = path.join(MC_DIR, 'java');
  const jreDir = path.join(javaBaseDir, `jre-${javaVer}`);
  const javaExe = path.join(jreDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');

  if (fs.existsSync(javaExe)) return javaExe;

  onProgress({ text: `Скачиваем Java ${javaVer}...`, percent: 0 });

  let downloadUrl = '';
  if (javaVer === 21) downloadUrl = 'https://aka.ms/download-jdk/microsoft-jdk-21.0.3-windows-x64.zip';
  else if (javaVer >= 22) downloadUrl = 'https://aka.ms/download-jdk/microsoft-jdk-25.0.0-windows-x64.zip'; 
  else if (javaVer === 17) downloadUrl = 'https://aka.ms/download-jdk/microsoft-jdk-17.0.10-windows-x64.zip';
  else return 'java'; 

  const zipPath = path.join(javaBaseDir, `jdk-${javaVer}.zip`);
  fs.mkdirSync(javaBaseDir, { recursive: true });

  const r = await fetch(downloadUrl);
  if (!r.ok) throw new Error('Ошибка скачивания Java: ' + r.status);
  
  const fileStream = fs.createWriteStream(zipPath);
  await new Promise((resolve, reject) => {
    r.body.pipe(fileStream);
    r.body.on('error', reject);
    fileStream.on('finish', resolve);
  });

  onProgress({ text: `Распаковываем Java ${javaVer}...`, percent: 50 });

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(javaBaseDir, true);
  fs.unlinkSync(zipPath);

  const extractedDirs = fs.readdirSync(javaBaseDir).filter(d => d.startsWith('jdk-'));
  if (extractedDirs.length > 0) {
    const extractedPath = path.join(javaBaseDir, extractedDirs[0]);
    fs.renameSync(extractedPath, jreDir);
  }

  onProgress({ text: `Java ${javaVer} готова!`, percent: 100 });
  return javaExe;
}

async function ensureAuthlibInjector() {
  const authlibPath = path.join(MC_DIR, 'libraries', 'authlib-injector.jar');
  if (fs.existsSync(authlibPath)) return authlibPath;
  
  const url = 'https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.5/authlib-injector-1.2.5.jar';
  const r = await fetch(url);
  if (!r.ok) return null;
  fs.mkdirSync(path.dirname(authlibPath), { recursive: true });
  fs.writeFileSync(authlibPath, Buffer.from(await r.arrayBuffer()));
  return authlibPath;
}

function extractNatives(merged, nativesDir) {
  const osn = osName();
  const classifierMap = { windows: 'natives-windows', osx: 'natives-macos', linux: 'natives-linux' };
  const nativeClassifier = classifierMap[osn];
  fs.mkdirSync(nativesDir, { recursive: true });
  
  for (const lib of merged.libraries || []) {
    if (!rulesAllow(lib.rules, osn)) continue;
    let nativePath = null;
    
    if (lib.downloads && lib.downloads.classifiers) {
      const key = Object.keys(lib.downloads.classifiers).find(k => k === nativeClassifier || k.startsWith(nativeClassifier));
      if (key) nativePath = path.join(LIBS_DIR, lib.downloads.classifiers[key].path);
    }
    if (!nativePath && lib.natives && lib.natives[osn]) {
      const cls = lib.natives[osn].replace('${arch}', process.arch === 'x64' ? '64' : '32');
      const parts = lib.name.split(':');
      const rel = `${parts[0].replace(/\./g, '/')}/${parts[1]}/${parts[2]}/${parts[1]}-${parts[2]}-${cls}.jar`;
      nativePath = path.join(LIBS_DIR, rel);
    }
    if (!nativePath || !fs.existsSync(nativePath)) continue;

    try {
      const zip = new AdmZip(nativePath);
      zip.getEntries().forEach((entry) => {
        if (entry.isDirectory || entry.entryName.startsWith('META-INF/')) return;
        if (!/\.(dll|so|dylib)$/i.test(entry.entryName)) return;
        fs.writeFileSync(path.join(nativesDir, path.basename(entry.entryName)), entry.getData());
      });
    } catch (e) { console.warn('Natives skip:', lib.name); }
  }
}

function buildClasspath(vjson, gameDir) {
  const osn = osName();
  const sep = process.platform === 'win32' ? ';' : ':';
  const entries = [path.join(VERSIONS_DIR, vjson.id, `${vjson.id}.jar`)];
  
  for (const lib of vjson.libraries || []) {
    if (!rulesAllow(lib.rules, osn)) continue;
    
    const isNative = lib.natives && lib.natives[osn];
    const hasNativeClassifier = lib.downloads && lib.downloads.classifiers && Object.keys(lib.downloads.classifiers).some(k => k.startsWith('natives-'));
    if (isNative || hasNativeClassifier) continue;

    if (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.path) {
      const p = path.join(LIBS_DIR, lib.downloads.artifact.path);
      if (fs.existsSync(p)) entries.push(p);
    } else {
      const parts = lib.name.split(':');
      const rel = `${parts[0].replace(/\./g, '/')}/${parts[1]}/${parts[2]}/${parts[1]}-${parts[2]}.jar`;
      const p = path.join(LIBS_DIR, rel);
      if (fs.existsSync(p)) entries.push(p);
    }
  }
  
  entries.push(gameDir);
  return entries.join(sep);
}

async function launchGame({ instance, account, onProgress }) {
  const instanceDir = path.join(INSTANCES_DIR, instance);
  const gameDir = path.join(instanceDir, '.minecraft');
  const meta = JSON.parse(fs.readFileSync(path.join(instanceDir, 'instance.json'), 'utf8'));

  let versionId = meta.versionId || meta.mcVersion;
  let vjsonPath = path.join(VERSIONS_DIR, versionId, `${versionId}.json`);
  if (!fs.existsSync(vjsonPath)) {
    const all = fs.readdirSync(VERSIONS_DIR).filter((v) => v !== '_cache');
    let found = null;
    if (meta.loader && meta.loader !== 'vanilla') found = all.find((v) => v.toLowerCase().includes(meta.loader) && v.includes(meta.mcVersion));
    if (!found) found = all.find((v) => v === meta.mcVersion);
    if (!found) throw new Error('Версия не установлена');
    versionId = found;
    vjsonPath = path.join(VERSIONS_DIR, versionId, `${versionId}.json`);
  }
  const vjson = JSON.parse(fs.readFileSync(vjsonPath, 'utf8'));
  let parentJson = null;
  if (vjson.inheritsFrom) {
    const pPath = path.join(VERSIONS_DIR, vjson.inheritsFrom, `${vjson.inheritsFrom}.json`);
    if (fs.existsSync(pPath)) parentJson = JSON.parse(fs.readFileSync(pPath, 'utf8'));
  }
  
  const merged = {
    id: vjson.id, mainClass: vjson.mainClass || (parentJson && parentJson.mainClass),
    assets: vjson.assets || (parentJson && parentJson.assets),
    assetIndex: vjson.assetIndex || (parentJson && parentJson.assetIndex),
    type: vjson.type || (parentJson && parentJson.type) || 'release',
    arguments: vjson.arguments || (parentJson && parentJson.arguments),
    minecraftArguments: vjson.minecraftArguments || (parentJson && parentJson.minecraftArguments),
    libraries: [...((parentJson && parentJson.libraries) || []), ...(vjson.libraries || [])],
    javaVersion: vjson.javaVersion || (parentJson && parentJson.javaVersion)
  };

  const nativesDir = path.join(instanceDir, 'natives');
  extractNatives(merged, nativesDir);
  const classpath = buildClasspath(merged, gameDir);

  const ctx = {
    '${auth_player_name}': account.name,
    '${version_name}': versionId,
    '${game_directory}': gameDir,
    '${assets_root}': ASSETS_DIR,
    '${assets_index_name}': (merged.assetIndex && merged.assetIndex.id) || merged.assets || 'legacy',
    '${auth_uuid}': account.uuid,
    '${auth_access_token}': '0'.repeat(32),
    '${user_type}': 'msa',
    '${version_type}': merged.type,
    '${user_properties}': '{}',
    '${clientid}': 'kernel-launcher',
    '${auth_xuid}': '0',
    '${natives_directory}': nativesDir,
    '${launcher_name}': 'KernelLauncher',
    '${launcher_version}': '1.0.0',
    '${classpath}': classpath,
    '${classpath_separator}': process.platform === 'win32' ? ';' : ':',
    '${library_directory}': LIBS_DIR
  };

  const jvmArgs = [];
  if (merged.arguments && merged.arguments.jvm) {
    for (const a of merged.arguments.jvm) {
      if (typeof a === 'string') jvmArgs.push(replaceAll(a, ctx));
      else if (rulesAllow(a.rules, osName())) {
        const vals = Array.isArray(a.value) ? a.value : [a.value];
        for (const v of vals) jvmArgs.push(replaceAll(v, ctx));
      }
    }
  } else {
    jvmArgs.push('-Djava.library.path=' + nativesDir, '-cp', classpath);
  }

  let gameArgs = [];
  if (merged.arguments && merged.arguments.game) {
    for (const a of merged.arguments.game) {
      if (typeof a === 'string') {
        if (a.toLowerCase().includes('demo')) continue;
        gameArgs.push(replaceAll(a, ctx));
      } else if (rulesAllow(a.rules, osName())) {
        const hasDemoRule = a.rules && a.rules.some(r => r.features && r.features.is_demo_user === true);
        if (hasDemoRule) continue;
        const vals = Array.isArray(a.value) ? a.value : [a.value];
        for (const v of vals) gameArgs.push(replaceAll(v, ctx));
      }
    }
  } else {
    const tpl = merged.minecraftArguments || '';
    tpl.split(' ').forEach((s) => { if (s && !s.toLowerCase().includes('demo')) gameArgs.push(replaceAll(s, ctx)); });
  }

  const extraJvm = meta.jvmArgs ? meta.jvmArgs.split(' ').filter(Boolean) : [];
  const extraGame = meta.gameArgs ? meta.gameArgs.split(' ').filter(Boolean) : [];
  const maxRam = meta.maxMemory || 4096;
  const minRam = meta.minMemory || 1024;

  const allGameArgs = [...gameArgs, ...extraGame];
  const filteredGameArgs = [];
  let quickPlayAdded = false;
  
  for (let i = 0; i < allGameArgs.length; i++) {
    const arg = allGameArgs[i];
    if (arg.startsWith('--quickPlay')) {
      if (!quickPlayAdded) {
        filteredGameArgs.push(arg);
        if (!arg.includes('=') && i + 1 < allGameArgs.length) {
          filteredGameArgs.push(allGameArgs[i + 1]);
          i++; 
        }
        quickPlayAdded = true;
      } else if (!arg.includes('=') && i + 1 < allGameArgs.length) {
        i++;
      }
    } else {
      filteredGameArgs.push(arg);
    }
  }

  let javaPath = meta.javaPath;
  if (!javaPath) {
    javaPath = await getJavaPath(merged, onProgress); 
  }

  let authlibArg = [];
  if (account.type === 'ely') {
    const authlibPath = await ensureAuthlibInjector();
    if (authlibPath) {
      authlibArg = [`-javaagent:${authlibPath}=https://authserver.ely.by/api/authlib-injector`];
    }
  }

  const fullArgs = [
    `-Xmx${maxRam}M`, `-Xms${minRam}M`, `-Djava.library.path="${nativesDir}"`,
    ...authlibArg,
    ...jvmArgs, ...extraJvm, merged.mainClass || 'net.minecraft.client.main.Main',
    ...filteredGameArgs
  ];

  const proc = spawn(javaPath, fullArgs, { cwd: gameDir, stdio: 'inherit' });
  
  return new Promise((resolve, reject) => {
    proc.on('error', reject);
    setTimeout(() => resolve({ pid: proc.pid, proc }), 1000);
  });
}

module.exports = { launchGame };