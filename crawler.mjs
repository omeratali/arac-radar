import { ROOT, accessProblem, parseList, parseDetail, sourceUrl, DEEP_PRICE_BANDS, buildPageUrl } from './parser.mjs';
import { BackgroundReader } from './source-reader.mjs';

export const CHECK_INTERVAL = 30000;
const DEEP_CATEGORIES = [
  'https://www.sahibinden.com/otomobil',
  'https://www.sahibinden.com/arazi-suv-pickup'
];
const diagnosticUrl = raw => { try { const u = new URL(raw); return u.origin + u.pathname + (u.search || ''); } catch { return ''; } };
const isTransientError = msg => /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_SOCKET_NOT_CONNECTED|TimeoutError| Navigation timeout|Target page, context or browser has been closed|Execution context was destroyed|net::ERR_|Kalıcı tarayıcı oturumu başlatılamadı|browser-runtime/i.test(String(msg || ''));

export class Crawler {
  constructor(store, base, onChange = () => {}, { now = () => Date.now() } = {}) {
    this.s = store;
    this.base = base;
    this.onChange = onChange;
    this.now = now;
    this.isCustomClock = now !== Date.now;
    this.busy = false;
    this.lastRequest = store.get('lastAttempt')?.at ?? null;
    this.lastKind = 'detail';
    this.consecutivePages = 0;
    this.consecutiveDetails = 0;
    this.consecutiveBlocked = 0;
    this.timer = null;
    this.closed = false;
    this.reader = new BackgroundReader(base, state => { if (!this.closed) { this.s.set('reader', state); this.onChange(); } });
    this.initStatements();
  }

  initStatements() {
    this.stmtPendingPagesCount = this.s.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind='page' AND status IN ('pending','busy')");
    this.stmtPendingDetailsCount = this.s.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind='detail' AND status IN ('pending','busy')");
    this.stmtMissingDetails = this.s.db.prepare(`SELECT l.url FROM listings l
      LEFT JOIN jobs j ON j.url=l.url
      WHERE j.url IS NULL
        AND json_extract(l.data,'$.parts') IS NULL
        AND json_extract(l.data,'$.removed') IS NULL
        AND l.price IS NOT NULL
      ORDER BY l.favorite DESC, l.first_seen DESC LIMIT ?`);
    this.stmtUrgentRefreshJob = this.s.db.prepare(`SELECT j.* FROM jobs j
      WHERE j.status='pending'
        AND EXISTS(SELECT 1 FROM refresh_jobs r WHERE r.url=j.url AND r.status='queued')
      ORDER BY j.checked ASC, j.url LIMIT 1`);
    this.stmtNextPendingJobPageFirst = this.s.db.prepare(`SELECT * FROM jobs WHERE status='pending'
      ORDER BY CASE WHEN EXISTS(SELECT 1 FROM refresh_jobs WHERE refresh_jobs.url=jobs.url AND refresh_jobs.status='queued') THEN 0 ELSE 1 END,
      CASE WHEN kind='page' THEN 0 ELSE 1 END,
      CASE
        WHEN url=? THEN 0
        WHEN (url LIKE '%/otomobil?%' OR url LIKE '%/arazi-suv-pickup?%') AND url NOT LIKE '%price_min=%' AND (url NOT LIKE '%pagingOffset=%' OR url LIKE '%pagingOffset=0%') THEN 1
        WHEN (url LIKE '%/otomobil?%' OR url LIKE '%/arazi-suv-pickup?%') AND url NOT LIKE '%price_min=%' AND url LIKE '%pagingOffset=50%' THEN 2
        WHEN url NOT LIKE '%price_min=%' AND url NOT LIKE '%pagingOffset=%' THEN 3
        WHEN url LIKE '%price_min=%' THEN 4
        ELSE 5
      END,
      CASE WHEN INSTR(url,'pagingOffset=')>0 THEN CAST(SUBSTR(url,INSTR(url,'pagingOffset=')+13) AS INTEGER) ELSE 0 END ASC,
      initial_done ASC,
      checked ASC,url LIMIT 1`);
    this.stmtNextPendingJobDetailFirst = this.s.db.prepare(`SELECT * FROM jobs WHERE status='pending'
      ORDER BY CASE WHEN EXISTS(SELECT 1 FROM refresh_jobs WHERE refresh_jobs.url=jobs.url AND refresh_jobs.status='queued') THEN 0 ELSE 1 END,
      CASE WHEN kind='detail' THEN 0 ELSE 1 END,
      CASE WHEN url=? THEN 0 ELSE 1 END,
      initial_done ASC,
      checked ASC,url LIMIT 1`);
    this.stmtNextPendingJob = this.stmtNextPendingJobPageFirst;
    this.stmtJobUrlExists = this.s.db.prepare('SELECT url FROM jobs WHERE url=?');
    this.stmtUpdateJobBusy = this.s.db.prepare("UPDATE jobs SET status='busy',error=NULL WHERE url=?");
    this.stmtUpdateJobDone = this.s.db.prepare("UPDATE jobs SET status='done',initial_done=1,checked=?,error=NULL WHERE url=?");
    this.stmtUpdateJobDoneError = this.s.db.prepare("UPDATE jobs SET status='done',initial_done=1,checked=?,error=? WHERE url=?");
    this.stmtUpdateJobPendingError = this.s.db.prepare("UPDATE jobs SET status='pending',error=? WHERE url=?");
  }

  update(phase, message) {
    this.s.set('phase', phase);
    this.s.set('message', message);
    this.onChange();
  }

  async start() {
    this.s.set('serverStarted', this.now());
    const listingCount = this.s.db.prepare('SELECT COUNT(*) AS n FROM listings').get().n;
    if (listingCount > 50) {
      this.s.set('liveMode', true);
      // Upgrade legacy 20-item pagingOffset pending jobs to pagingSize=50 mode
      this.s.db.exec(`DELETE FROM jobs WHERE kind='page' AND status='pending' AND url LIKE '%pagingOffset=%' AND url NOT LIKE '%pagingSize=50%'`);
    }
    // Remove any rogue non-date_desc sorting jobs permanently
    this.s.db.exec(`DELETE FROM jobs WHERE url LIKE '%sorting=%' AND url NOT LIKE '%sorting=date_desc%'`);
    // Completed detail jobs are preserved and not re-queued
    this.s.db.exec(`UPDATE jobs SET status='done',error=NULL
      WHERE kind='detail' AND status IN ('pending','failed')
      AND EXISTS(SELECT 1 FROM listings WHERE listings.url=jobs.url AND (listings.detail_complete=1 OR json_extract(listings.data,'$.parts') IS NOT NULL))`);
    if (!this.s.get('baselineDone', false)) {
      this.s.set('nextTick', null);
      if (!this.s.db.prepare('SELECT url FROM jobs WHERE url=?').get(ROOT)) this.s.enqueue(ROOT, 'page');
    } else if (!this.s.get('activeCycle')) {
      this.s.set('nextTick', this.now());
    }
    await this.resume();
  }

  advanceDeepScanBatch(cycle = 0, pagesPerBatch = 2) {
    const cursor = this.s.get('deepCursor') || { catIdx: 0, bandIdx: 0, offset: 0, fullSweeps: 0, pagesScanned: 0 };
    const urls = [];
    for (let i = 0; i < pagesPerBatch; i++) {
      const catUrl = DEEP_CATEGORIES[cursor.catIdx % DEEP_CATEGORIES.length];
      const [priceMin, priceMax] = DEEP_PRICE_BANDS[cursor.bandIdx % DEEP_PRICE_BANDS.length];
      const url = buildPageUrl(catUrl, {
        offset: cursor.offset,
        pagingSize: 50,
        sort: 'date_desc',
        priceMin,
        priceMax
      });
      if (url) {
        urls.push(url);
        this.s.enqueue(url, 'page', false, cycle);
      }
      cursor.pagesScanned = (cursor.pagesScanned || 0) + 1;
      cursor.offset += 50;
      if (cursor.offset > 300) {
        cursor.offset = 0;
        cursor.bandIdx++;
        if (cursor.bandIdx >= DEEP_PRICE_BANDS.length) {
          cursor.bandIdx = 0;
          cursor.catIdx++;
          if (cursor.catIdx >= DEEP_CATEGORIES.length) {
            cursor.catIdx = 0;
            cursor.fullSweeps = (cursor.fullSweeps || 0) + 1;
          }
        }
      }
    }
    this.s.set('deepCursor', cursor);
    return { cursor, urls };
  }

  skipCurrentDeepBand() {
    const cursor = this.s.get('deepCursor');
    if (!cursor) return;
    const [priceMin, priceMax] = DEEP_PRICE_BANDS[cursor.bandIdx % DEEP_PRICE_BANDS.length] || [];
    if (priceMin != null && priceMax != null) {
      this.s.db.prepare("UPDATE jobs SET status='done',initial_done=1,checked=? WHERE status='pending' AND url LIKE ? AND url LIKE ?").run(this.now(), `%price_min=${priceMin}%`, `%price_max=${priceMax}%`);
    }
    cursor.offset = 0;
    cursor.bandIdx = (cursor.bandIdx || 0) + 1;
    if (cursor.bandIdx >= DEEP_PRICE_BANDS.length) {
      cursor.bandIdx = 0;
      cursor.catIdx = ((cursor.catIdx || 0) + 1) % DEEP_CATEGORIES.length;
      if (cursor.catIdx === 0) cursor.fullSweeps = (cursor.fullSweeps || 0) + 1;
    }
    this.s.set('deepCursor', cursor);
  }

  // Boya/değişen şeması yalnız /detay sayfasında bulunur. Şeması hiç okunmamış ilanları
  // (yeniden eskiye ve favorilere göre) arka planda düzenli olarak detay kuyruğuna ekler.
  queueMissingDetails(limit = 12, maxPending = 25) {
    if (!this.stmtMissingDetails) this.initStatements();
    const pending = this.stmtPendingDetailsCount.get().n;
    if (pending >= maxPending) return 0;
    const toQueue = Math.min(limit, maxPending - pending);
    const rows = this.stmtMissingDetails.all(toQueue);
    for (const row of rows) this.s.enqueue(row.url, 'detail', false, 0);
    return rows.length;
  }

  async turbo() {
    this.s.set('gapSeconds', 2);
    this.s.set('retryAt', null);
    this.s.set('failStreak', 0);
    this.lastRequest = null;
    if (this.s.get('baselineDone', false)) {
      this.s.set('activeCycle', null);
      this.s.set('nextTick', this.now());
    }
    await this.resume();
  }

  requestListingRefresh(listingId) {
    const row = this.s.db.prepare('SELECT id,url FROM listings WHERE id=?').get(String(listingId));
    if (!row) throw new Error('İlan bulunamadı.');
    const active = this.s.db.prepare("SELECT job_id,status FROM refresh_jobs WHERE listing_id=? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1").get(row.id);
    if (active) return { ok: true, job_id: active.job_id, listing_id: row.id, status: active.status, message: 'İlan yenileme işi zaten sırada.' };
    const now = this.now();
    const jobId = `ref_${now}_${row.id}`;
    this.s.db.prepare('INSERT INTO refresh_jobs(job_id,listing_id,url,status,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(jobId, row.id, row.url, 'queued', null, now, now);
    this.s.enqueue(row.url, 'detail', false, this.s.get('cycleSerial', 0));
    if (!this.s.get('running', false)) this.s.set('running', true);
    clearTimeout(this.timer);
    void this.drain();
    return { ok: true, job_id: jobId, listing_id: row.id, status: 'queued', message: 'İlan yenileme işi başlatıldı.' };
  }

  getRefreshStatus(listingId, jobId) {
    const row = jobId
      ? this.s.db.prepare('SELECT * FROM refresh_jobs WHERE job_id=? AND listing_id=?').get(String(jobId), String(listingId))
      : this.s.db.prepare('SELECT * FROM refresh_jobs WHERE listing_id=? ORDER BY created_at DESC LIMIT 1').get(String(listingId));
    if (!row) return null;
    return { job_id: row.job_id, listing_id: row.listing_id, status: row.status, error: row.error, updatedAt: row.updated_at };
  }

  schedule() {
    if (!this.s.get('running', false) || !this.s.get('baselineDone', false)
      || this.now() < (this.s.get('retryAt', 0) || 0)) return false;
    const active = this.s.get('activeCycle');
    if (active) {
      if (this.now() - (active.startedAt || 0) > 120000) {
        this.s.set('activeCycle', null);
      } else {
        return false;
      }
    }
    const due = this.s.get('nextTick');
    if (due != null && this.now() < due) return false;
    const cycle = (this.s.get('cycleSerial', 0) || 0) + 1;
    if (this.s.get('liveMode', false)) {
      // 1. Yeni ilan taraması (50'şerli en yeni sayfalar)
      const freshPages = [
        buildPageUrl(ROOT, { offset: 0, pagingSize: 50, sort: 'date_desc' }),
        buildPageUrl(ROOT, { offset: 50, pagingSize: 50, sort: 'date_desc' }),
        buildPageUrl('https://www.sahibinden.com/arazi-suv-pickup', { offset: 0, pagingSize: 50, sort: 'date_desc' }),
        buildPageUrl('https://www.sahibinden.com/arazi-suv-pickup', { offset: 50, pagingSize: 50, sort: 'date_desc' })
      ].filter(Boolean);
      for (const p of freshPages) this.s.enqueue(p, 'page', false, cycle);

      // 2. Derin tarama (Fiyat bantları imleci: deepBand / deepPage, her tur 6 bant sayfası = 300 ilan)
      this.advanceDeepScanBatch(cycle, 6);

      // 3. Döner marka/kategori sayfaları (en eski kontrol edilen 3 kategori)
      const rotPages = this.s.db.prepare("SELECT url FROM jobs WHERE kind='page' AND url NOT LIKE '%pagingOffset=%' AND url NOT LIKE '%price_min=%' ORDER BY checked ASC, url LIMIT 3").all();
      for (const page of rotPages) {
        const fastUrl = buildPageUrl(page.url, { offset: 0, pagingSize: 50, sort: 'date_desc' }) || page.url;
        this.s.enqueue(fastUrl, 'page', false, cycle);
      }
    } else {
      const pages = this.s.db.prepare("SELECT url FROM jobs WHERE kind='page' ORDER BY CASE WHEN url=? THEN 0 WHEN url NOT LIKE '%pagingOffset=%' THEN 1 ELSE 2 END,checked ASC,url LIMIT 12").all(ROOT);
      if (!pages.length) pages.push({ url: ROOT });
      // Refresh list pages to compare IDs. Completed vehicle details are never requeued here.
      for (const page of pages) this.s.enqueue(page.url, 'page', false, cycle);
    }
    this.s.set('cycleSerial', cycle);
    this.s.set('activeCycle', { id: cycle, startedAt: this.now(), newCount: 0 });
    this.s.set('lastTick', this.now());
    this.s.set('nextTick', null);
    this.update('checking', 'Yeni ilan + fiyat bandı derin tarama döngüsü başladı (sayfa başı 50 ilan).');
    return true;
  }

  pause() {
    this.s.set('running', false);
    this.s.set('nextRequestAt', null);
    clearTimeout(this.timer);
    this.update('paused', 'Tarama duraklatıldı. İlanlar ve kontrol noktası korunuyor.');
  }

  async openVerification() {
    const info = await this.reader.openVerificationWindow(ROOT);
    this.update('waiting', 'Tarayıcı doğrulama penceresi açıldı. Doğrulama geçildiğinde otomatik devam edecek.');
    void this.resume();
    return info;
  }

  async ingestExternal({ html = '', url = ROOT, listings = [] } = {}) {
    let cleanInput = String(html || '').trim();
    let targetUrl = String(url || '').trim();

    // 1. If 'html' is actually a URL or listing ID passed by user
    if ((/^https?:\/\//i.test(cleanInput) || /^\d{7,12}$/.test(cleanInput)) && !cleanInput.includes('<')) {
      targetUrl = cleanInput;
      cleanInput = '';
    }

    // 2. Handle ID if given (e.g. 123456789)
    if (/^\d{7,12}$/.test(targetUrl)) {
      targetUrl = `https://www.sahibinden.com/ilan/vasita-${targetUrl}/detay`;
    }

    let cleanUrl = sourceUrl(targetUrl) || (cleanInput ? ROOT : null);
    let count = 0, newCount = 0;

    // 3. If targetUrl is a valid sahibinden URL and no HTML was provided, fetch it live!
    if (cleanUrl && !cleanInput && (!Array.isArray(listings) || listings.length === 0)) {
      const isDetail = /\/ilan\/vasita-.*-\d+\/detay/i.test(cleanUrl);
      try {
        const response = await this.read(cleanUrl, { kind: isDetail ? 'detail' : 'page' });
        if (response?.html) {
          cleanInput = response.html;
          cleanUrl = response.url || cleanUrl;
        }
      } catch (err) {
        // If live reading fails or is blocked, enqueue as an urgent job
        this.s.enqueue(cleanUrl, isDetail ? 'detail' : 'page', false, 0);
        if (!this.s.get('running', false)) this.s.set('running', true);
        void this.drain();
        return {
          ok: true,
          count: 1,
          newCount: 1,
          enqueued: true,
          message: 'İlan tarama kuyruğuna alındı. Arka plan okuyucusu işleyecek.'
        };
      }
    }

    // 4. If HTML was provided or fetched
    if (cleanInput) {
      // Extract real canonical URL if cleanUrl is ROOT
      const extractedUrl = cleanInput.match(/rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1]
        || cleanInput.match(/property=["']og:url["'][^>]*content=["']([^"']+)["']/i)?.[1];
      if (extractedUrl) {
        const parsed = sourceUrl(extractedUrl);
        if (parsed) cleanUrl = parsed;
      }

      const isDetailPage = (/\/ilan\/vasita-.*-\d+\/detay/i.test(cleanUrl) || /classifiedInfoList|car-parts|classifiedDescription/i.test(cleanInput))
        && !/searchResultsItem/i.test(cleanInput);

      if (isDetailPage) {
        const detail = parseDetail(cleanInput, cleanUrl);
        if (detail && detail.id) {
          const existing = this.s.db.prepare('SELECT id FROM listings WHERE id=?').get(detail.id);
          this.s.ingest(detail, true);
          this.s.db.prepare("UPDATE jobs SET status='done',initial_done=1,checked=?,error=NULL WHERE url=?").run(this.now(), detail.url || cleanUrl);
          count++;
          if (!existing) newCount++;
          const now = this.now();
          this.s.set('sourceCheck', { at: now, passed: true, status: 200, listingCount: count, reason: 'Doğrudan aktarımdan 1 gerçek ilan aktarıldı.' });
          this.s.set('lastSuccess', now);
          this.s.set('lastAttempt', { at: now, url: diagnosticUrl(detail.url || cleanUrl), kind: 'detail', status: 200, outcome: 'success', reason: null, reader: 'browser_bridge' });
          this.update('live', `İlan başarıyla aktarıldı: ${detail.title || detail.id}`);
          return { ok: true, count: 1, newCount: existing ? 0 : 1, listing: detail, message: `İlan başarıyla aktarıldı: ${detail.title || detail.id}` };
        }
      }

      const list = parseList(cleanInput, cleanUrl);
      if (list.listings.length > 0) {
        const batchRes = this.s.ingestBatch(list.listings, true);
        count = list.listings.length;
        newCount = batchRes.newCount;
      }
    }

    if (Array.isArray(listings) && listings.length > 0) {
      for (const raw of listings) {
        const validUrl = sourceUrl(raw?.url);
        if (!raw?.id || !validUrl) continue;
        const existing = this.s.db.prepare('SELECT id FROM listings WHERE id=?').get(String(raw.id));
        this.s.ingest({ ...raw, id: String(raw.id), url: validUrl }, Boolean(raw.brand && raw.year != null));
        count++;
        if (!existing) newCount++;
      }
    }

    if (!count) throw new Error('Gönderilen içerikte geçerli sahibinden.com ilanı bulunamadı.');
    const now = this.now();
    this.s.set('sourceCheck', { at: now, passed: true, status: 200, listingCount: count, reason: `Tarayıcı köprüsünden ${count} gerçek ilan aktarıldı.` });
    this.s.set('lastSuccess', now);
    this.s.set('lastAttempt', { at: now, url: diagnosticUrl(cleanUrl), kind: 'page', status: 200, outcome: 'success', reason: null, reader: 'browser_bridge' });
    if (!this.s.get('baselineDone', false)) {
      this.s.db.exec("UPDATE jobs SET status='done',initial_done=1,error=NULL WHERE initial=1");
      this.s.set('baselineDone', true);
      this.s.set('baselineCompletedAt', now);
      this.s.set('nextTick', now + 10000);
    } else {
      this.s.set('lastCheckAt', now);
      this.s.set('lastNewCount', newCount);
    }
    this.update('live', `Tarayıcı köprüsünden ${count} ilan güncellendi (${newCount} yeni ilan).`);
    return { ok: true, count, newCount, message: `${count} gerçek ilan başarıyla aktarıldı (${newCount} yeni).` };
  }

  async resume() {
    // A source-imposed wait survives retries and server restarts.
    if (this.now() < (this.s.get('retryAt', 0) || 0)) {
      this.s.set('running', true);
      this.update('rate_limited', 'Kaynağın bekleme süresi henüz dolmadı. Süre dolunca kontrol devam edecek.');
      this.arm();
      return;
    }
    this.s.set('running', true);
    this.s.set('retryAt', null);
    this.s.db.exec("UPDATE jobs SET status='pending' WHERE status='failed'");
    if (this.s.get('baselineDone', false) && !this.s.get('activeCycle')) this.s.set('nextTick', this.now());
    const requestAt = this.lastRequest == null ? null : this.lastRequest + this.s.get('gapSeconds', 10) * 1000;
    if (requestAt && requestAt > this.now()) {
      this.s.set('nextRequestAt', requestAt);
      this.update('waiting', 'Seçili istek aralığı bekleniyor. Süre dolunca arka plan okuyucusu yeniden deneyecek.');
    } else {
      this.s.set('nextRequestAt', null);
      this.update(this.s.get('baselineDone', false) ? 'checking' : 'baselining', 'Arka plan okuyucusu kaynak sayfasını kontrol ediyor.');
    }
    // The API returns promptly; the worker owns the network request.
    void this.drain();
  }

  arm(ms = 1000) {
    clearTimeout(this.timer);
    if (!this.closed && this.s.get('running', false)) {
      this.timer = setTimeout(() => void this.drain(), Math.max(50, Math.min(ms, 60000)));
    }
  }

  async read(url, options) {
    return this.reader.read(url, options);
  }

  finishWork() {
    if (!this.s.get('baselineDone', false)) {
      const pending = this.s.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE initial=1 AND status IN ('pending','busy')").get().n;
      if (pending || !this.s.get('running', false)) return;
      const missing = this.s.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE initial=1 AND initial_done=0').get().n;
      const found = this.s.db.prepare('SELECT COUNT(*) AS n FROM listings').get().n;
      if (missing || !found) {
        this.s.set('running', false);
        this.update('source_error', 'Kaynak sayfalarından ilan okunamadı. İlk genel tarama tamamlanmış sayılmadı.');
        return;
      }
      this.s.set('baselineDone', true);
      this.s.set('baselineCompletedAt', this.now());
      this.s.set('nextTick', this.now() + CHECK_INTERVAL);
      this.update('live', 'İlk genel taramanın keşfedilen sayfaları tamamlandı. 30 saniye sonra yeni ilan kontrolü başlayacak.');
      return;
    }
    const cycle = this.s.get('activeCycle');
    if (!cycle) return;
    const pendingCycle = this.s.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE cycle=? AND status IN ('pending','busy')").get(cycle.id).n;
    if (pendingCycle === 0) {
      this.s.set('cyclesCompleted', (this.s.get('cyclesCompleted', 0) || 0) + 1);
      this.s.set('lastCheckAt', this.now());
      this.s.set('lastNewCount', cycle.newCount || 0);
      this.s.set('activeCycle', null);
      const pauseMs = this.s.get('liveMode') ? 10000 : CHECK_INTERVAL;
      this.s.set('nextTick', this.now() + pauseMs);
      this.update('live', `Yeni ilan kontrolü tamamlandı: ${cycle.newCount || 0} yeni ilan. Sonraki kontrol ${Math.round(pauseMs / 1000)} saniye sonra.`);
    }
  }

  async drain() {
    if (this.closed || this.busy) return;
    clearTimeout(this.timer);
    let job;
    try {
      if (!this.s.get('running', false) || this.now() < (this.s.get('retryAt', 0) || 0)) return;
      this.finishWork();
      if (!this.s.get('running', false)) return;
      this.schedule();
      if (this.s.get('baselineDone', false)) this.queueMissingDetails();

      // Check urgent refresh first (user on-demand click)
      const urgentJob = this.stmtUrgentRefreshJob ? this.stmtUrgentRefreshJob.get() : null;
      let isUrgent = false;

      if (urgentJob) {
        job = urgentJob;
        isUrgent = true;
      } else {
        const pendingPages = this.stmtPendingPagesCount.get().n;
        const pendingDetails = this.stmtPendingDetailsCount.get().n;
        const isBaselining = !this.s.get('baselineDone', false);
        const preferDetail = !isBaselining && pendingDetails > 0 && (pendingPages === 0 || this.consecutivePages >= 2);
        const stmt = preferDetail ? (this.stmtNextPendingJobDetailFirst || this.stmtNextPendingJob) : (this.stmtNextPendingJobPageFirst || this.stmtNextPendingJob);
        job = stmt.get(ROOT);
        if (!job && preferDetail && this.stmtNextPendingJobPageFirst) {
          job = this.stmtNextPendingJobPageFirst.get(ROOT);
        } else if (!job && !preferDetail && pendingDetails > 0 && this.stmtNextPendingJobDetailFirst) {
          job = this.stmtNextPendingJobDetailFirst.get(ROOT);
        }
      }

      if (!job) return;

      const baseGap = this.s.get('gapSeconds', 10);
      let requiredGap;

      if (isUrgent) {
        // User on-demand refresh: minimal 200ms gap for immediate responsiveness
        requiredGap = this.isCustomClock ? 0 : 200;
      } else if (job.kind === 'detail') {
        // Background detail fetch: fast 1.8s gap (detail pages are small and lightweight)
        const jitterMs = this.isCustomClock ? 0 : Math.floor(Math.random() * 400);
        const detailGap = Math.min(baseGap, 1.8);
        requiredGap = (detailGap * 1000) + jitterMs;
      } else {
        // Page jobs: standard configured gap
        const jitterMs = this.isCustomClock ? 0 : Math.floor(Math.random() * 800);
        requiredGap = (baseGap * 1000) + jitterMs;
      }

      const elapsed = this.lastRequest != null ? (this.now() - this.lastRequest) : Infinity;
      if (elapsed < requiredGap) {
        const waitMs = requiredGap - elapsed;
        this.s.set('nextRequestAt', this.lastRequest + requiredGap);
        if (this.s.get('phase') !== 'waiting' && !isUrgent) {
          this.update('waiting', 'Seçili istek aralığı bekleniyor. Süre dolunca arka plan okuyucusu devam edecek.');
        }
        this.arm(waitMs);
        return;
      }

      this.s.set('nextRequestAt', null);
      this.update(this.s.get('baselineDone', false) ? 'checking' : 'baselining', 'Arka plan okuyucusu kaynak sayfasını okuyor.');
      this.busy = true;
      this.lastKind = job.kind;
      this.lastRequest = this.now();
      this.stmtUpdateJobBusy.run(job.url);
      this.s.db.prepare("UPDATE refresh_jobs SET status='running',updated_at=? WHERE url=? AND status='queued'").run(this.now(), job.url);
      this.s.set('lastAttempt', { at: this.now(), url: diagnosticUrl(job.url), kind: job.kind, status: null, outcome: 'pending' });
      this.onChange();
      const response = await this.read(job.url, { kind: job.kind });
      if (this.closed) return;
      const problem = response.problem || accessProblem(response.html, response.url, response.status);
      this.s.set('lastAttempt', { at: this.lastRequest, url: diagnosticUrl(response.url), kind: job.kind, status: response.status, outcome: problem?.phase || 'received', reason: problem?.reason || null, reader: 'chromium_background' });
      if (problem) {
        this.s.set('nextRequestAt', null);
        this.s.db.prepare("UPDATE refresh_jobs SET status='failed',error=?,updated_at=? WHERE url=? AND status IN ('queued','running')").run(problem.message, this.now(), job.url);
        if (job.url === ROOT) this.s.set('sourceCheck', { at: this.now(), passed: false, status: response.status, listingCount: 0, reason: problem.message });
        if (problem.phase === 'rate_limited') {
          const secs = Number(response.retryAfter), date = Date.parse(response.retryAfter || '');
          const until = Number.isFinite(secs) && secs > 0 ? this.now() + secs * 1000 : Number.isFinite(date) ? date : this.now() + 45000;
          this.s.set('retryAt', Math.max(this.now() + CHECK_INTERVAL, until));
          this.stmtUpdateJobPendingError.run(problem.message, job.url);
          this.update('rate_limited', problem.message);
          return;
        }
        if (problem.phase === 'access_blocked' && !this.isCustomClock && job.url !== ROOT) {
          this.consecutiveBlocked = (this.consecutiveBlocked || 0) + 1;
          if (this.consecutiveBlocked >= 2) {
            this.stmtUpdateJobPendingError.run(problem.message, job.url);
            const waitMs = 25000;
            this.s.set('retryAt', this.now() + waitMs);
            this.s.set('nextRequestAt', this.now() + waitMs);
            this.update('waiting', 'Tarayıcı erişim doğrulaması bekleniyor. 25 saniye sonra otomatik tekrar denenecek.');
            return;
          }
        } else {
          this.consecutiveBlocked = 0;
        }
        if (job.url !== ROOT && this.s.get('baselineDone', false)) {
          this.stmtUpdateJobDoneError.run(this.now(), problem.message, job.url);
          this.update('checking', `${job.kind === 'detail' ? 'İlan detayı' : 'Alt sayfa'} atlandı (${problem.phase === 'auth_required' ? 'giriş zorunlu' : problem.phase}); tarama devam ediyor.`);
          return;
        }
        this.stmtUpdateJobPendingError.run(problem.message, job.url);
        this.s.set('running', false);
        this.update(problem.phase, problem.message);
        return;
      }
      this.consecutiveBlocked = 0;
      if (job.kind === 'page') {
        const result = parseList(response.html, response.url);
        if (job.url === ROOT) this.s.set('sourceCheck', { at: this.now(), passed: result.listings.length > 0, status: response.status, listingCount: result.listings.length, reason: result.listings.length ? 'Kaynak sayfasından gerçek ilan bağlantıları okundu.' : 'Bu sayfada henüz ilan bağlantısı okunamadı.' });
        if (!result.listings.length && !result.pages.length && !job.url.includes('pagingOffset=')) {
          if (job.url === ROOT || !this.s.get('baselineDone', false)) {
            throw new Error('İlan veya kategori yapısı okunamadı; boş yanıt tamamlanmış tarama sayılmadı.');
          }
        }
        const isLargeLiveBatch = result.listings.length > 5;
        if (isLargeLiveBatch) this.s.set('liveMode', true);
        const { newCount, needsDetail } = this.s.ingestBatch(result.listings, isLargeLiveBatch);
        const newInBatch = newCount;
        for (const detailUrl of needsDetail) {
          this.s.enqueue(detailUrl, 'detail', !this.s.get('baselineDone', false), job.cycle);
        }
        if (newCount > 0) {
          const cycle = this.s.get('activeCycle');
          if (cycle) this.s.set('activeCycle', { ...cycle, newCount: cycle.newCount + newCount });
        }

        const isDeepBandUrl = job.url.includes('price_min=') || job.url.includes('price_max=');
        if (isLargeLiveBatch && job.url === ROOT) {
          result.pages.length = 0;
          for (let offset = 0; offset <= 950; offset += 50) {
            result.pages.push(buildPageUrl(ROOT, { offset, pagingSize: 50, sort: 'date_desc' }));
          }
          for (let offset = 0; offset <= 450; offset += 50) {
            result.pages.push(buildPageUrl('https://www.sahibinden.com/arazi-suv-pickup', { offset, pagingSize: 50, sort: 'date_desc' }));
          }
          this.advanceDeepScanBatch(job.cycle, 4);
        } else if (isDeepBandUrl) {
          result.pages.length = 0;
          const offsetMatch = job.url.match(/pagingOffset=(\d+)/);
          const currentOffset = offsetMatch ? Number(offsetMatch[1]) : 0;
          if (result.listings.length < 35 || (currentOffset > 0 && newInBatch === 0)) {
            this.skipCurrentDeepBand();
          }
        } else if (isLargeLiveBatch && /^https:\/\/www\.sahibinden\.com\/[a-z0-9-]+(\?.*)?$/i.test(job.url) && !job.url.startsWith(`${ROOT}?`) && !job.url.startsWith('https://www.sahibinden.com/arazi-suv-pickup?')) {
          const baseCatUrl = job.url.split('?')[0];
          const offsetMatch = job.url.match(/pagingOffset=(\d+)/);
          const currentOffset = offsetMatch ? Number(offsetMatch[1]) : 0;
          result.pages.length = 0;
          if (currentOffset > 0 && newInBatch === 0) {
            this.s.db.prepare("UPDATE jobs SET status='done',initial_done=1,checked=?,error=NULL WHERE status='pending' AND url LIKE ?").run(this.now(), `${baseCatUrl}?%`);
          } else if (result.listings.length >= 48 && (currentOffset === 0 || newInBatch >= 3)) {
            const step = job.url.includes('pagingSize=50') ? 50 : 50;
            for (const nextOffset of [currentOffset + step, currentOffset + step * 2]) {
              if (nextOffset <= 300) {
                result.pages.push(buildPageUrl(baseCatUrl, { offset: nextOffset, pagingSize: 50, sort: 'date_desc' }));
              }
            }
          }
        } else if (isLargeLiveBatch) {
          // Convert any discovered brand/category links to 50-per-page date_desc URLs
          const upgraded = result.pages.map(p => buildPageUrl(p, { offset: 0, pagingSize: 50, sort: 'date_desc' }) || p);
          result.pages.length = 0;
          result.pages.push(...upgraded);
        }
        for (const page of result.pages) {
          if (page && !this.stmtJobUrlExists.get(page)) {
            this.s.enqueue(page, 'page', !this.s.get('baselineDone', false), job.cycle);
          }
        }
        this.consecutivePages++;
        this.consecutiveDetails = 0;
      } else {
        this.consecutiveDetails++;
        if (this.consecutiveDetails >= 2) this.consecutivePages = 0;
        const item = parseDetail(response.html, response.url);
        if (!item) {
          const id = job.url.match(/-(\d+)\/detay/)?.[1] || job.url.match(/\/(\d+)(?:\/detay|\?|$)/)?.[1];
          if (id) {
            const row = this.s.db.prepare('SELECT id, data FROM listings WHERE id=?').get(id);
            if (row) {
              const data = JSON.parse(row.data);
              const badges = new Set(data.badges || []);
              if (/satılmıştır|satıldı/i.test(response.html)) badges.add('satildi');
              else if (/süresi dol/i.test(response.html)) badges.add('suresi_doldu');
              else badges.add('otomatik_kalkti');
              data.badges = [...badges];
              data.removed = true;
              data.removedAt = this.now();
              this.s.db.prepare('UPDATE listings SET data=? WHERE id=?').run(JSON.stringify(data), id);
            }
          }
          this.stmtUpdateJobDoneError.run(this.now(), 'İlan yayından kaldırılmış veya detay alanları okunamadı', job.url);
          this.s.db.prepare("UPDATE refresh_jobs SET status='failed',error='İlan yayından kaldırılmış',updated_at=? WHERE url=? AND status IN ('queued','running')").run(this.now(), job.url);
          this.update('checking', 'Yayından kalkmış veya eksik ilan detayı atlandı; tarama devam ediyor.');
          return;
        }
        this.s.ingest(item, true);
      }
      this.stmtUpdateJobDone.run(this.now(), job.url);
      this.s.db.prepare("UPDATE refresh_jobs SET status='done',error=NULL,updated_at=? WHERE url=? AND status IN ('queued','running')").run(this.now(), job.url);
      this.s.set('lastSuccess', this.now());
      this.s.set('retryAt', null);
      this.s.set('failStreak', 0);
      this.s.set('lastAttempt', { ...this.s.get('lastAttempt'), outcome: 'success' });
      if (this.s.get('running', false)) {
        this.update(this.s.get('baselineDone', false) ? 'checking' : 'baselining', `Kaynak okundu: ${job.kind === 'page' ? 'liste kimlikleri karşılaştırıldı' : 'yeni ilan detayı kaydedildi'}.`);
        this.finishWork();
      }
    } catch (error) {
      if (this.closed) return;
      const message = [error.message, error.cause?.code].filter(Boolean).join(' · ').slice(0, 500);
      if (job?.url === ROOT) this.s.set('sourceCheck', { at: this.now(), passed: false, status: this.s.get('lastAttempt')?.status || null, listingCount: 0, reason: message });
      if (job && isTransientError(message)) {
        // Auto-recover from transient network/browser timeouts (failStreak backoff, never permanently stops)
        const streak = (this.s.get('failStreak', 0) || 0) + 1;
        this.s.set('failStreak', streak);
        const waitMs = Math.min(120000, Math.round(8000 * Math.pow(1.6, Math.min(streak, 5))));
        this.s.db.prepare("UPDATE jobs SET status='pending',error=? WHERE url=?").run(message, job.url);
        this.s.set('lastAttempt', { ...this.s.get('lastAttempt', {}), outcome: 'transient_retry', error: message });
        this.s.set('retryAt', this.now() + waitMs);
        this.s.set('nextRequestAt', this.now() + waitMs);
        this.update('waiting', `Geçici bağlantı kesintisi (${Math.round(waitMs / 1000)} sn sonra otomatik devam edecek): ${message.slice(0, 120)}`);
        return;
      }
      if (job) {
        this.s.db.prepare("UPDATE jobs SET status='failed',error=? WHERE url=?").run(message, job.url);
        this.s.db.prepare("UPDATE refresh_jobs SET status='failed',error=?,updated_at=? WHERE url=? AND status IN ('queued','running')").run(message, this.now(), job.url);
      }
      this.s.set('lastAttempt', { ...this.s.get('lastAttempt', {}), outcome: 'source_error', error: message });
      this.s.set('running', false);
      this.s.set('nextRequestAt', null);
      this.update('source_error', `Tarama bekletildi: ${message}`);
    } finally {
      this.busy = false;
      if (job) this.onChange();
      // Rearm after the awaited request. Long responses cannot silently kill the worker.
      this.arm();
    }
  }

  async stop() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    await this.reader.stop();
  }
}
