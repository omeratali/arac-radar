import { Worker } from 'node:worker_threads';
import path from 'node:path';

export class CrawlerWorkerClient {
  constructor(store, base, broadcast) {
    this.store = store;
    this.base = base;
    this.broadcast = broadcast;
    this.reqSeq = 0;
    this.pending = new Map();
    this.stopped = false;

    this.spawnWorker();
  }

  spawnWorker() {
    this.worker = new Worker(path.join(this.base, 'crawler-worker.mjs'), {
      workerData: {
        dbPath: this.store.dbPath || path.join(this.base, 'data/radar.sqlite'),
        base: this.base
      }
    });

    this.worker.on('message', (msg) => {
      if (msg.type === 'broadcast') {
        this.broadcast();
      } else if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.ok) resolve(msg.data);
        else reject(new Error(msg.error));
      }
    });

    this.worker.on('error', (err) => {
      console.error('[Crawler Worker Hatası]:', err.message);
    });

    this.worker.on('exit', (code) => {
      if (!this.stopped && code !== 0) {
        console.warn(`[Crawler Worker Beklenmedik Şekilde Kapandı (Kod: ${code})]. 5 sn sonra yeniden başlatılıyor...`);
        setTimeout(() => {
          if (!this.stopped) this.spawnWorker();
        }, 5000);
      }
    });
  }

  send(type, payload = {}) {
    if (this.stopped) return Promise.reject(new Error('Crawler worker durduruldu.'));
    return new Promise((resolve, reject) => {
      const id = ++this.reqSeq;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...payload });
    });
  }

  async resume() { return this.send('resume'); }
  async pause() { return this.send('pause'); }
  async turbo() { return this.send('turbo'); }
  async drain() { return this.send('drain'); }
  async openVerification() { return this.send('openVerification'); }
  async ingestExternal(body) { return this.send('ingestExternal', { payload: body }); }
  async requestListingRefresh(listingId) { return this.send('requestListingRefresh', { listingId }); }

  getRefreshStatus(listingId, jobId) {
    const row = jobId
      ? this.store.db.prepare('SELECT * FROM refresh_jobs WHERE job_id=? AND listing_id=?').get(String(jobId), String(listingId))
      : this.store.db.prepare('SELECT * FROM refresh_jobs WHERE listing_id=? ORDER BY created_at DESC LIMIT 1').get(String(listingId));
    if (!row) return null;
    return { job_id: row.job_id, listing_id: row.listing_id, status: row.status, error: row.error, updatedAt: row.updated_at };
  }

  async stop() {
    this.stopped = true;
    for (const [, p] of this.pending) {
      p.reject(new Error('Worker kapatılıyor.'));
    }
    this.pending.clear();
    try {
      await this.send('stop');
    } catch {}
    await this.worker.terminate();
  }
}
