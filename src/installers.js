const { installVersion, getVersionJson } = require('./versions');
const { installFabric, installQuilt, installForge, installNeoForge } = require('./loaders');

async function installLoader({ loader, mcVersion }) {
  switch (loader) {
    case 'fabric': return installFabric(mcVersion);
    case 'quilt': return installQuilt(mcVersion);
    case 'forge': return installForge(mcVersion);
    case 'neoforge': return installNeoForge(mcVersion);
    default: throw new Error('Неизвестный лоадер: ' + loader);
  }
}

module.exports = { installVersion, getVersionJson, installLoader };