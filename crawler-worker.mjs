import { parentPort, workerData } from 'node:worker_threads';
import { createStore } from './store.mjs';
import { Crawler } from './crawler.mjs';

const dbPath = workerData?.dbPath || 'data/radar.sqlite';
const base = workerData?.base || process.cwd();

console.log(`[Crawler Worker Thread #${process.pid}] Başlatıldı. DB: ${dbPath}`);

const store = createStore(dbPath);
const crawler = new Crawler(store, base, () => {
  try {
    parentPort.postMessage({ type: 'broadcast' });
  } catch {}
});

crawler.start().then(() => {
  console.log(`[Crawler Worker Thread] Tarama döngüsü aktif.`);
}).catch(err => {
  console.error(`[Crawler Worker Hata]:`, err);
  try {
    parentPort.postMessage({ type: 'error', error: err.message });
  } catch {}
});

parentPort.on('message', async (msg) => {
  if (!msg || !msg.type) return;
  const { id, type } = msg;

  const reply = (ok, data, error) => {
    if (id != null) {
      parentPort.postMessage({ id, ok, data, error });
    }
  };

  try {
    if (type === 'resume') {
      await crawler.resume();
      reply(true);
    } else if (type === 'pause') {
      crawler.pause();
      reply(true);
    } else if (type === 'turbo') {
      await crawler.turbo();
      reply(true);
    } else if (type === 'drain') {
      void crawler.drain();
      reply(true);
    } else if (type === 'openVerification') {
      const info = await crawler.openVerification();
      reply(true, info);
    } else if (type === 'ingestExternal') {
      const info = await crawler.ingestExternal(msg.payload);
      reply(true, info);
    } else if (type === 'requestListingRefresh') {
      const job = crawler.requestListingRefresh(msg.listingId);
      reply(true, job);
    } else if (type === 'stop') {
      await crawler.stop();
      store.db.close();
      reply(true);
    }
  } catch (err) {
    reply(false, null, err.message);
  }
});
