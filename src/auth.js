const fetch = require('node-fetch');
const crypto = require('crypto');

function authOffline(nickname) {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nickname)) {
    throw new Error('Ник: 3-16 символов, только a-z A-Z 0-9 _');
  }
  const uuid = crypto.createHash('md5').update('OfflinePlayer:' + nickname).digest('hex');
  const uuidFmt = uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  return {
    type: 'offline',
    name: nickname,
    uuid: uuidFmt,
    accessToken: '0'.repeat(32),
    clientToken: '0'.repeat(32)
  };
}

async function authEly(username, password) {
  const r = await fetch('https://authserver.ely.by/auth/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      clientToken: crypto.randomUUID(),
      requestUser: true
    })
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Ely.by (${r.status}): ${text.slice(0, 200)}`);
  }
  const data = await r.json();
  return {
    type: 'ely',
    name: data.selectedProfile.name,
    uuid: data.selectedProfile.id,
    accessToken: data.accessToken,
    clientToken: data.clientToken
  };
}

async function authMicrosoft() {
  throw new Error(
    'Microsoft-вход пока не подключён. Используй Ely.by или оффлайн-аккаунт.'
  );
}

module.exports = { authOffline, authEly, authMicrosoft };
