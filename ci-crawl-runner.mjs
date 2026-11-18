import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { Crawler } from './crawler.mjs';

const base = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(base, 'data');
const dbPath = path.join(dataDir, 'radar.sqlite');
const publicDir = path.join(base, 'public');
const distDir = path.join(base, 'dist-pages');
const staticApiDir = path.join(distDir, 'static-api');

const CRAWL_MINUTES = Math.max(1, Number(process.env.CRAWL_MINUTES || 15));
const CRAWL_MAX_JOBS = Math.max(1, Number(process.env.CRAWL_MAX_JOBS || 120));
const GAP_SECONDS = Math.max(1, Number(process.env.GAP_SECONDS || 3));
const EXPORT_ONLY = process.env.EXPORT_ONLY === '1';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function buildAdapterScript() {
  return `(function () {
  var statePromise = null;
  var pulsePromise = null;
  var brandsPromise = null;

  function fetchJson(relPath) {
    return fetch(relPath, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('Statik veri dosyası okunamadı: ' + relPath);
      return r.json();
    });
  }

  function loadState() {
    if (!statePromise) statePromise = fetchJson('./static-api/state.json');
    return statePromise;
  }

  function loadPulse() {
    if (!pulsePromise) pulsePromise = fetchJson('./static-api/pulse.json');
    return pulsePromise;
  }

  function loadBrands() {
    if (!brandsPromise) brandsPromise = fetchJson('./static-api/brands.json');
    return brandsPromise;
  }

  function jsonResponse(data, status) {
    return Promise.resolve(new Response(JSON.stringify(data), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    }));
  }

  function trNorm(s) {
    return String(s || '')
      .replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/ı/g, 'i')
      .replace(/ğ/g, 'g').replace(/Ğ/g, 'g').replace(/ü/g, 'u').replace(/Ü/g, 'u')
      .replace(/ş/g, 's').replace(/Ş/g, 's').replace(/ö/g, 'o').replace(/Ö/g, 'o')
      .replace(/ç/g, 'c').replace(/Ç/g, 'c').toLowerCase().trim();
  }

  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var rawUrl = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    var url;
    try {
      url = new URL(rawUrl, window.location.href);
    } catch (_) {
      return origFetch(input, init);
    }

    var p = url.pathname;
    var apiIdx = p.indexOf('/api/');
    if (apiIdx === -1) return origFetch(input, init);
    var route = p.slice(apiIdx);
    var method = ((init && init.method) || 'GET').toUpperCase();

    if (method === 'POST') {
      return jsonResponse({
        ok: false,
        error: 'GitHub Pages statik görünümündesiniz. Tarama GitHub Actions tarafından arka planda otomatik yürütülür.'
      }, 400);
    }

    if (route === '/api/health') {
      return fetchJson('./static-api/health.json').then(function (d) { return jsonResponse(d, 200); });
    }

    if (route === '/api/live/pulse') {
      return loadPulse().then(function (d) { return jsonResponse(d, 200); });
    }

    if (route === '/api/brands') {
      return loadBrands().then(function (d) { return jsonResponse(d, 200); });
    }

    if (route === '/api/state/delta' || (route === '/api/state' && url.searchParams.has('since'))) {
      return loadState().then(function (s) {
        return jsonResponse({
          delta: true,
          timestamp: s.timestamp || Date.now(),
          totalListings: s.totalCount || (s.listings ? s.listings.length : 0),
          newOrUpdated: [],
          events: [],
          jobs: s.jobs,
          source: s.source
        }, 200);
      });
    }

    if (route === '/api/state') {
      return loadState().then(function (s) {
        if (url.searchParams.get('all') === 'true') {
          return jsonResponse(Object.assign({}, s, { hasMore: false }), 200);
        }
        return jsonResponse(s, 200);
      });
    }

    if (route === '/api/models') {
      var targetBrand = url.searchParams.get('brand') || '';
      return loadState().then(function (s) {
        var set = new Set();
        (s.listings || []).forEach(function (item) {
          if (targetBrand && item.brand !== targetBrand) return;
          if (item.model) set.add(String(item.model).trim());
          if (item.trim && /^[a-z0-9]/i.test(String(item.trim).trim()) && item.model) {
            var comb = (String(item.model).trim() + ' ' + String(item.trim).trim()).trim();
            if (comb.length <= 40) set.add(comb);
          }
        });
        return jsonResponse(Array.from(set).sort(function (a, b) { return a.localeCompare(b, 'tr'); }), 200);
      });
    }

    if (route === '/api/category-tree') {
      var cb = url.searchParams.get('brand') || '';
      var cs = url.searchParams.get('series') || '';
      return loadState().then(function (s) {
        var map = new Map();
        var total = 0;
        (s.listings || []).forEach(function (item) {
          if (!item.brand) return;
          if (!cb) {
            map.set(item.brand, (map.get(item.brand) || 0) + 1);
            total++;
          } else if (item.brand === cb && !cs && item.model) {
            map.set(item.model, (map.get(item.model) || 0) + 1);
            total++;
          } else if (item.brand === cb && cs && item.model === cs && item.trim) {
            map.set(item.trim, (map.get(item.trim) || 0) + 1);
            total++;
          }
        });
        var key = !cb ? 'brand' : (!cs ? 'series' : 'trim');
        var items = Array.from(map.entries()).map(function (entry) {
          var o = { count: entry[1] };
          o[key] = entry[0];
          return o;
        }).sort(function (a, b) { return b.count - a.count; });
        return jsonResponse({ level: !cb ? 0 : (!cs ? 1 : 2), brand: cb || undefined, series: cs || undefined, items: items, total: total }, 200);
      });
    }

    if (route === '/api/category-search') {
      var q = trNorm(url.searchParams.get('q') || '');
      var sb = url.searchParams.get('brand') || '';
      return loadState().then(function (s) {
        var cats = new Map();
        (s.listings || []).forEach(function (item) {
          if (!item.brand || (sb && item.brand !== sb)) return;
          var key = (item.brand || '') + '|' + (item.model || '') + '|' + (item.trim || '');
          var cur = cats.get(key) || { brand: item.brand, model: item.model || '', trim: item.trim || '', count: 0 };
          cur.count++;
          cats.set(key, cur);
        });
        var tokens = q.split(/\\s+/).filter(Boolean);
        var list = Array.from(cats.values()).filter(function (c) {
          if (!tokens.length) return true;
          var full = trNorm(c.brand + ' ' + c.model + ' ' + c.trim);
          return tokens.every(function (t) { return full.indexOf(t) !== -1; });
        }).sort(function (a, b) { return b.count - a.count; }).slice(0, 40).map(function (c) {
          return {
            brand: c.brand,
            model: c.model,
            trim: c.trim,
            count: c.count,
            path: c.brand + ' › ' + c.model + (c.trim ? ' › ' + c.trim : '')
          };
        });
        return jsonResponse(list, 200);
      });
    }

    var listingMatch = route.match(/^\\/api\\/listings\\/(\\d+)$/);
    if (listingMatch) {
      var targetId = listingMatch[1];
      return loadState().then(function (s) {
        var found = (s.listings || []).find(function (x) { return String(x.id) === targetId; });
        if (!found) return jsonResponse({ error: 'İlan statik önbellekte bulunamadı.' }, 404);
        return jsonResponse(Object.assign({}, found, { history: found.history || [] }), 200);
      });
    }

    return jsonResponse({
      ok: false,
      error: 'GitHub Pages statik görünümünde bu özellik devre dışıdır.'
    }, 400);
  };

  var OrigEventSource = window.EventSource;
  window.EventSource = function (url) {
    if (String(url).indexOf('/api/events') !== -1) {
      return { close: function () {}, addEventListener: function () {}, removeEventListener: function () {} };
    }
    return OrigEventSource ? new OrigEventSource(url) : { close: function () {} };
  };
})();
`;
}

function exportStaticPages(store) {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(staticApiDir, { recursive: true });
  fs.cpSync(publicDir, distDir, { recursive: true });

  const statePayload = store.state(3000);
  const dayAgo = Date.now() - 86400000;
  const todayNewCount = store.db.prepare('SELECT COUNT(1) AS c FROM listings WHERE first_seen>=?').get(dayAgo).c;
  const priceDropCount = store.db.prepare("SELECT COUNT(1) AS c FROM events WHERE type='price_drop'").get().c;
  const totalListings = store.db.prepare('SELECT COUNT(1) AS c FROM listings').get().c;
  const lastSuccess = store.get('lastSuccess');
  const events = store.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 20').all();

  const pulsePayload = {
    ok: true,
    todayNewCount,
    priceDropCount,
    totalListings,
    lastSuccess,
    events,
    uiPollSeconds: 60
  };
  const brandsPayload = store.getDistinctBrands();
  const healthPayload = {
    ok: true,
    app: 'arac-radar',
    mode: 'github_pages_static',
    updatedAt: Date.now()
  };

  fs.writeFileSync(path.join(staticApiDir, 'state.json'), JSON.stringify(statePayload));
  fs.writeFileSync(path.join(staticApiDir, 'pulse.json'), JSON.stringify(pulsePayload));
  fs.writeFileSync(path.join(staticApiDir, 'brands.json'), JSON.stringify(brandsPayload));
  fs.writeFileSync(path.join(staticApiDir, 'health.json'), JSON.stringify(healthPayload));
  fs.writeFileSync(path.join(distDir, 'gh-pages-adapter.js'), buildAdapterScript());
  fs.writeFileSync(path.join(distDir, '.nojekyll'), '');

  const indexPath = path.join(distDir, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html
    .replace(/(href|src)="\/assets\//g, '$1="assets/')
    .replace(/href="\/(style\.css|ui\.css|experience\.css|source-filters\.css)/g, 'href="$1')
    .replace(/href="\/"/g, 'href="./"')
    .replace(/<script src="\/(app\.js[^"]*)"([^>]*)><\/script>/i, '<script src="gh-pages-adapter.js"></script>\n  <script src="$1"$2></script>');
  fs.writeFileSync(indexPath, html);

  const appJsPath = path.join(distDir, 'app.js');
  if (fs.existsSync(appJsPath)) {
    let appJs = fs.readFileSync(appJsPath, 'utf8');
    appJs = appJs
      .replace(/'\/assets\//g, "'assets/")
      .replace(/"\/assets\//g, '"assets/');
    fs.writeFileSync(appJsPath, appJs);
  }

  console.log(`[CI Export] dist-pages hazır: ${statePayload.listings.length} özet ilan (toplam DB: ${totalListings}), ${brandsPayload.length} marka.`);
}

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });
  const store = createStore(dbPath);

  if (!EXPORT_ONLY) {
    const crawler = new Crawler(store, base);
    store.set('gapSeconds', GAP_SECONDS);
    console.log(`[CI Crawl] Başlatılıyor (süre: ${CRAWL_MINUTES} dk, maks iş: ${CRAWL_MAX_JOBS}, aralık: ${GAP_SECONDS} sn)...`);

    const startedAt = Date.now();
    const deadline = startedAt + CRAWL_MINUTES * 60 * 1000;
    const initialPagesRead = store.get('reader')?.pagesRead || 0;

    await crawler.start();

    let lastLoggedPages = -1;
    while (Date.now() < deadline) {
      await sleep(2000);
      const readerState = store.get('reader') || {};
      const currentPagesRead = Math.max(0, (readerState.pagesRead || 0) - initialPagesRead);
      const phase = store.get('phase');
      const running = store.get('running', false);

      if (currentPagesRead !== lastLoggedPages) {
        lastLoggedPages = currentPagesRead;
        const total = store.db.prepare('SELECT COUNT(1) AS c FROM listings').get().c;
        const attempt = store.get('lastAttempt');
        console.log(`[CI Crawl] Okunan: ${currentPagesRead}/${CRAWL_MAX_JOBS} | Toplam ilan: ${total} | Son: ${attempt?.kind || '-'} (${attempt?.status || '-'})`);
      }

      if (currentPagesRead >= CRAWL_MAX_JOBS) {
        console.log(`[CI Crawl] Maksimum iş sınırına (${CRAWL_MAX_JOBS}) ulaşıldı.`);
        break;
      }
      if (crawler.consecutiveBlocked >= 3 || phase === 'rate_limited' || !running) {
        console.log(`[CI Crawl] Duraklatıldı/Engel algılandı (phase=${phase}, running=${running}, blocked=${crawler.consecutiveBlocked}).`);
        break;
      }
    }

    await crawler.stop();
    console.log(`[CI Crawl] Tarama turu tamamlandı (${Math.round((Date.now() - startedAt) / 1000)} sn).`);
  } else {
    console.log('[CI Export] EXPORT_ONLY=1 aktif; tarama atlanıp doğrudan GitHub Pages çıktısı üretiliyor.');
  }

  try {
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (err) {
    console.warn('[CI Export] WAL checkpoint uyarısı:', err.message);
  }

  exportStaticPages(store);
  store.db.close();
}

main().catch(err => {
  console.error('[CI Crawl] Hata:', err);
  process.exitCode = 1;
});
