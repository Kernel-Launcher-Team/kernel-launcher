const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const api = window.lmAPI;

let accounts = JSON.parse(localStorage.getItem('accounts') || '[]');
let currentAccount = null;
let editingInstance = null;
let catalogPage = 1;
let catalogTotal = 0;
const PAGE_SIZE = 20;
let isGameRunning = false;

function showToast(msg, type = 'success') {
  const container = $('#toast-container');
  const div = document.createElement('div');
  div.className = 'toast ' + type;
  div.textContent = msg;
  container.appendChild(div);
  setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 300); }, 3000);
}

let confirmCallback = null;
function showConfirm(title, desc, btnText, callback) {
  $('#confirm-title').textContent = title;
  $('#confirm-desc').textContent = desc;
  $('#confirm-ok').textContent = btnText;
  $('#modal-confirm').style.display = 'flex';
  confirmCallback = callback;
}
$('#confirm-cancel').onclick = () => { $('#modal-confirm').style.display = 'none'; confirmCallback = null; };
$('#confirm-ok').onclick = () => { if (confirmCallback) confirmCallback(); $('#modal-confirm').style.display = 'none'; confirmCallback = null; };

$$('.sidebar button').forEach((b) => {
  b.onclick = () => {
    $$('.sidebar button').forEach((x) => x.classList.remove('active'));
    $$('.tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $('#tab-' + b.dataset.tab).classList.add('active');
    if (b.dataset.tab === 'instances') refreshInstances();
    if (b.dataset.tab === 'accounts') renderAccounts();
    if (b.dataset.tab === 'catalog') { catalogPage = 1; doSearch(true); }
  };
});

$('#btn-min').onclick = () => api.minimize();
$('#btn-close').onclick = () => api.close();

(async () => {
  const res = await api.versions.list();
  if (res.ok) {
    res.versions.sort((a, b) => new Date(b.releaseTime) - new Date(a.releaseTime));
    const sel = $('#c-mc');
    res.versions.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id; opt.textContent = `${v.id} (${v.type})`;
      sel.appendChild(opt);
    });
  }
})();

api.onProgress((data) => {
  const toast = $('#progress-toast');
  const text = $('#p-text');
  const bar = $('#p-bar-fill');
  if (typeof data === 'string') { text.textContent = data; bar.style.width = '100%'; }
  else { text.textContent = data.text; bar.style.width = (data.percent || 0) + '%'; }
  toast.classList.add('show');
  if (data.percent === 100 || data.text?.includes('Готово')) setTimeout(() => { toast.classList.remove('show'); bar.style.width = '0%'; }, 3000);
});

function renderAccounts() {
  const list = $('#accounts-list');
  list.innerHTML = accounts.map((a, i) => `
    <div class="item">
      <div class="info"><strong>${a.name}</strong><small>${a.type}</small></div>
      <button onclick="selectAccount(${i})">${currentAccount === i ? '✓' : '✔'}</button>
      <button onclick="removeAccount(${i})">✕</button>
    </div>
  `).join('') || '<p style="color:#888">Нет аккаунтов</p>';
  refreshAccountSelectors();
}
window.selectAccount = (i) => { currentAccount = i; renderAccounts(); };
window.removeAccount = (i) => {
  accounts.splice(i, 1);
  if (currentAccount === i) currentAccount = null;
  localStorage.setItem('accounts', JSON.stringify(accounts));
  renderAccounts();
};
function addAccount(acc) {
  accounts.push(acc); currentAccount = accounts.length - 1;
  localStorage.setItem('accounts', JSON.stringify(accounts));
  renderAccounts(); showToast('Аккаунт добавлен');
}

$('#btn-off').onclick = async () => {
  try { addAccount(await api.authOffline($('#off-nick').value.trim())); }
  catch (e) { showToast('Ошибка: только английские буквы и цифры (3-16 символов)', 'error'); }
};
$('#btn-ely').onclick = async () => {
  try { addAccount(await api.authEly($('#ely-login').value, $('#ely-pass').value)); }
  catch (e) { showToast('Ошибка Ely.by', 'error'); }
};
$('#btn-ms').onclick = async () => {
  try { addAccount(await api.authMicrosoft()); }
  catch (e) { showToast('Microsoft: ' + e.message, 'error'); }
};

async function refreshInstances() {
  const list = await api.instances.list();
  const el = $('#instances-list');
  if (list.length === 0) {
    el.innerHTML = '<p style="color:#888; grid-column: 1/-1">Сборок пока нет.</p>';
    refreshInstanceSelectors(list); return;
  }
  const groups = {};
  list.forEach(i => { const g = i.group || 'Без группы'; if (!groups[g]) groups[g] = []; groups[g].push(i); });

  let html = '';
  for (const [groupName, insts] of Object.entries(groups)) {
    html += `<h3 style="grid-column: 1/-1; color:#8a90a3; font-size:14px; margin-top:16px; margin-bottom:-4px">${groupName}</h3>`;
    html += insts.map((i) => {
      let iconHtml = i.icon.startsWith('http') ? `<img src="${i.icon}">` : (i.icon === 'default' ? '📦' : i.icon);
      return `
        <div class="item">
          <div class="inst-icon">${iconHtml}</div>
          <div class="info"><strong>${i.name}</strong><small>${i.mcVersion} • ${i.loader} • ${i.maxMemory}MB</small></div>
          <button onclick="openSettings('${i.name}')">⚙</button>
          <button onclick="deleteInst('${i.name}')">✕</button>
        </div>`;
    }).join('');
  }
  el.innerHTML = html; refreshInstanceSelectors(list);
}

window.deleteInst = (name) => {
  showConfirm('Удалить сборку?', `Вы действительно хотите удалить "${name}"?`, 'Удалить', async () => {
    await api.instances.delete(name); refreshInstances(); showToast('Сборка удалена');
  });
};

window.openSettings = async (name) => {
  const meta = (await api.instances.list()).find((i) => i.name === name);
  if (!meta) return;
  editingInstance = name;
  $('#modal-title').textContent = 'Настройки: ' + name;
  $('#m-icon').value = meta.icon || 'default';
  $('#m-group').value = meta.group || 'Без группы';
  $('#m-min-ram').value = meta.minMemory;
  $('#m-max-ram').value = meta.maxMemory;
  $('#m-java').value = meta.javaPath;
  $('#m-jvm').value = meta.jvmArgs;
  $('#m-notes').value = meta.notes;
  $('#modal-inst').style.display = 'flex';

  
  $('#m-open-folder').onclick = () => api.shell.openFolder(name);
};

$('#modal-cancel').onclick = () => { $('#modal-inst').style.display = 'none'; };
$('#modal-save').onclick = async () => {
  await api.instances.update(editingInstance, {
    icon: $('#m-icon').value.trim() || 'default',
    group: $('#m-group').value.trim() || 'Без группы',
    minMemory: +$('#m-min-ram').value || 1024,
    maxMemory: +$('#m-max-ram').value || 4096,
    javaPath: $('#m-java').value,
    jvmArgs: $('#m-jvm').value,
    notes: $('#m-notes').value
  });
  $('#modal-inst').style.display = 'none';
  refreshInstances(); showToast('Настройки сохранены');
};

$('#btn-new-inst').onclick = () => { $('#c-name').value = ''; $('#modal-create').style.display = 'flex'; };
$('#c-submit').onclick = async () => {
  const name = $('#c-name').value.trim();
  const mcVersion = $('#c-mc').value;
  const loader = $('#c-loader').value;
  if (!name) return showToast('Введи название', 'error');
  $('#modal-create').style.display = 'none';
  $('#progress-toast').classList.add('show');
  try {
    await api.instances.create({ name, mcVersion, loader });
    const vres = await api.versions.install(mcVersion);
    if (!vres.ok) throw new Error(vres.error);
    if (loader !== 'vanilla') {
      $('#p-text').textContent = `Устанавливаем ${loader}...`;
      const lres = await api.loader.install({ loader, mcVersion });
      if (!lres.ok) throw new Error(lres.error);
    }
    refreshInstances(); showToast('Сборка создана');
  } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
};

$('#btn-import-mrpack').onclick = async () => {
  const file = await api.dialog.openFile([{ name: 'Modrinth', extensions: ['mrpack'] }]);
  if (!file) return;
  const name = prompt('Название сборки:', 'Imported');
  if (!name) return;
  await api.mrpack.import(file, name); refreshInstances(); showToast('Сборка импортирована');
};
$('#btn-import-zip').onclick = async () => {
  const file = await api.dialog.openFile([{ name: 'Archive', extensions: ['zip'] }]);
  if (!file) return;
  const name = prompt('Название сборки:', 'Imported');
  if (!name) return;
  await api.zip.import(file, name); refreshInstances(); showToast('Сборка импортирована');
};

let searchTimeout = null;
$('#cat-q').addEventListener('input', () => { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { catalogPage = 1; doSearch(); }, 500); });
$('#cat-type').onchange = () => { catalogPage = 1; doSearch(); };
$('#cat-source').onchange = () => { catalogPage = 1; doSearch(); };
$('#cat-instance').onchange = () => { catalogPage = 1; doSearch(); };

$('#btn-prev-page').onclick = () => { if (catalogPage > 1) { catalogPage--; doSearch(); } };
$('#btn-next-page').onclick = () => { if (catalogPage * PAGE_SIZE < catalogTotal) { catalogPage++; doSearch(); } };

async function doSearch(autoMode = false) {
  const q = $('#cat-q').value;
  const type = $('#cat-type').value;
  const source = $('#cat-source').value;
  const inst = $('#cat-instance').value;
  const instMeta = (await api.instances.list()).find((i) => i.name === inst);

  if (!autoMode && !q && catalogPage === 1 && type === 'mod') return;
  $('#catalog-results').innerHTML = '<p style="color:#888; grid-column: 1/-1">Поиск...</p>';
  
  let data;
  try {
    if (source === 'modrinth') {
      if (type === 'world') { $('#catalog-results').innerHTML = '<p style="color:#888; grid-column: 1/-1">Карты только в CF</p>'; return; }
      data = await api.modrinth.search(q, type, instMeta?.loader, instMeta?.mcVersion, catalogPage, PAGE_SIZE);
    } else {
      data = await api.curseforge.search(q, type, instMeta?.mcVersion, instMeta?.loader, catalogPage, PAGE_SIZE);
    }
  } catch (e) {
    $('#catalog-results').innerHTML = `<p style="color:#f88; grid-column: 1/-1">${e.message}</p>`; return;
  }

  catalogTotal = data.total || 0;
  $('#cat-pagination').style.display = catalogTotal > PAGE_SIZE ? 'flex' : 'none';
  $('#page-info').textContent = `Стр. ${catalogPage}`;
  $('#btn-prev-page').disabled = catalogPage === 1;
  $('#btn-next-page').disabled = catalogPage * PAGE_SIZE >= catalogTotal;

  $('#catalog-results').innerHTML = data.items.map((r) => `
    <div class="item">
      <div class="inst-icon">${r.icon ? `<img src="${r.icon}">` : '📦'}</div>
      <div class="info"><strong>${r.title}</strong><small>${r.description || ''}</small></div>
      <button id="btn-inst-${r.id}" onclick="installRes('${r.id}','${source}','${type}')">+</button>
    </div>
  `).join('') || '<p style="color:#888; grid-column: 1/-1">Пусто</p>';
}

window.installRes = async (id, source, type) => {
  const inst = $('#cat-instance').value;
  if (!inst) return showToast('Выбери сборку в выпадающем списке!', 'error');
  const meta = (await api.instances.list()).find((i) => i.name === inst);
  const btn = document.getElementById(`btn-inst-${id}`);
  
  btn.innerHTML = '<div class="spinner"></div>';
  btn.disabled = true;
  btn.className = 'circle-btn';
  btn.onclick = null;

  try {
    let res;
    if (source === 'modrinth') res = await api.modrinth.install({ instance: inst, projectId: id, mcVersion: meta.mcVersion, loader: meta.loader, projectType: type });
    else res = await api.curseforge.install({ instance: inst, projectId: id, type, mcVersion: meta.mcVersion });
    if (res.ok === false) throw new Error(res.error);
    
    btn.innerHTML = '✕';
    btn.className = 'circle-btn danger';
    btn.title = 'Удалить мод';
    btn.disabled = false;
    
    const filename = res.file;
    btn.dataset.filename = filename;
    btn.dataset.type = type;

    btn.onclick = () => {
      showConfirm('Удалить мод?', `Удалить "${filename}" из этой сборки?`, 'Удалить', async () => {
        const delRes = await api.mods.delete(inst, filename, type);
        if (delRes.ok) {
          btn.innerHTML = '+';
          btn.className = '';
          btn.title = '';
          btn.dataset.filename = '';
          btn.onclick = () => window.installRes(id, source, type);
          showToast('Удалено!');
        } else {
          showToast('Ошибка удаления: ' + delRes.error, 'error');
        }
      });
    };
    showToast('Установлено!');
  } catch (e) {
    btn.innerHTML = '+'; btn.className = ''; btn.disabled = false;
    btn.onclick = () => window.installRes(id, source, type);
    showToast('Ошибка: ' + e.message, 'error');
  }
};

const btnLaunch = $('#btn-launch');
const launchLog = $('#launch-log');

btnLaunch.onclick = async () => {
  if (isGameRunning) { await api.game.kill(); return; }
  if (currentAccount === null) return showToast('Выбери аккаунт', 'error');
  const instance = $('#play-instance').value;
  if (!instance) return showToast('Выбери сборку', 'error');

  launchLog.textContent = 'Запуск...\n';
  try {
    const res = await api.game.launch({ instance, account: accounts[currentAccount] });
    if (!res.ok) throw new Error(res.error);
    
    isGameRunning = true;
    btnLaunch.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:8px"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg> Закрыть игру';
    btnLaunch.className = 'primary big danger';
    launchLog.textContent += `PID: ${res.pid}\nИгра запущена!`;
  } catch (e) {
    launchLog.textContent += 'Ошибка: ' + e.message;
    showToast('Ошибка: ' + e.message, 'error');
  }
};

api.onGameClosed(() => {
  isGameRunning = false;
  btnLaunch.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:8px"><polygon points="5 3 19 12 5 21 5 3"/></svg> Запустить Minecraft';
  btnLaunch.className = 'primary big';
  launchLog.textContent += '\nИгра закрыта.';
});

function refreshInstanceSelectors(list) {
  if (!list) return;
  const opts = list.map((i) => `<option value="${i.name}">${i.name} (${i.mcVersion}/${i.loader})</option>`).join('');
  $('#play-instance').innerHTML = opts || '<option value="">Нет сборок</option>';
  $('#cat-instance').innerHTML = opts || '<option value="">Нет сборок</option>';
}
function refreshAccountSelectors() {
  const opts = accounts.map((a, i) => `<option value="${i}" ${i === currentAccount ? 'selected' : ''}>${a.name}</option>`).join('');
  $('#play-account').innerHTML = opts || '<option value="">Нет аккаунтов</option>';
}
$('#play-account').onchange = (e) => { currentAccount = +e.target.value; renderAccounts(); };

refreshInstances();
renderAccounts();
