import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { Crawler } from './crawler.mjs';

const base = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(base, 'data/radar.sqlite');

console.log(`[Crawler Daemon - Bağımsız Arka Plan Süreci #${process.pid}] Başlatılıyor...`);
console.log(`Veritabanı: ${dbPath}`);

const store = createStore(dbPath);
const crawler = new Crawler(store, base, () => {
  const phase = store.get('phase', 'ready');
  const msg = store.get('message', '');
  console.log(`[Crawler Durum] ${phase}: ${msg}`);
});

crawler.start().then(() => {
  console.log(`[Crawler Daemon] Tarama döngüsü başarıyla başlatıldı. 7/24 çalışıyor.`);
}).catch(err => {
  console.error(`[Crawler Daemon Hata]:`, err);
});

async function shutdown() {
  console.log('\n[Crawler Daemon] Kapatılıyor...');
  await crawler.stop();
  store.db.close();
  console.log('[Crawler Daemon] Güvenle sonlandırıldı.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
