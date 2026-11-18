const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

function getRuntime(base) {
  const browserDirectory = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(base, 'data', 'browser-runtime');
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserDirectory;
  const resolvers = [
    require,
    createRequire(path.resolve(path.dirname(process.execPath), '../node_modules/package.json')),
    createRequire(path.resolve(base, '../tools/rea-runtime/package.json')),
    ...(process.env.USERPROFILE
      ? [createRequire(path.resolve(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json'))]
      : [])
  ];
  for (const resolve of resolvers) {
    let modulePath;
    try { modulePath = resolve.resolve('playwright'); } catch { continue; }
    const { chromium } = resolve(modulePath);
    const version = resolve('playwright/package.json').version;
    const cli = path.join(path.dirname(modulePath), 'cli.js');
    return { chromium, version, cli, browserDirectory, executable: chromium.executablePath() };
  }
  throw new Error('Arka plan okuyucusunun Playwright paketi bulunamadı. Proje bağımlılıkları kurulmalı.');
}

function ensureReader(base) {
  const runtime = getRuntime(base);
  if (fs.existsSync(runtime.executable)) return runtime;
  console.log('Arka plan okuyucusu için Chromium kuruluyor. Edge kullanılmaz.');
  fs.mkdirSync(path.join(base, 'data'), { recursive: true });
  const log = fs.openSync(path.join(base, 'data', 'reader-setup.log'), 'a');
  const install = spawnSync(process.execPath, [runtime.cli, 'install', 'chromium', '--no-shell', '--no-progress'], {
    cwd: base,
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: runtime.browserDirectory, PLAYWRIGHT_SKIP_BROWSER_GC: '1' },
    windowsHide: true,
    stdio: ['ignore', log, log]
  });
  fs.closeSync(log);
  if (install.error || install.status !== 0 || !fs.existsSync(runtime.executable)) {
    throw new Error('Chromium kurulamadı. İnternet bağlantısını ve data/reader-setup.log kaydını kontrol et.');
  }
  return runtime;
}

module.exports = { getRuntime, ensureReader };
if (require.main === module) {
  try { ensureReader(__dirname); console.log('Arka plan okuyucusu hazır.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
