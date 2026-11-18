import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { extractVehicleSpecs } from './parser.mjs';
export function createStore(filename) {
  if(filename!==':memory:') fs.mkdirSync(path.dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-64000; PRAGMA temp_store=MEMORY; PRAGMA mmap_size=268435456;');
  db.exec(`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS listings(
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      data TEXT NOT NULL,
      price REAL,
      first_seen INTEGER,
      last_checked INTEGER,
      last_changed INTEGER,
      detail_complete INTEGER DEFAULT 0,
      favorite INTEGER DEFAULT 0,
      brand TEXT,
      model TEXT,
      trim TEXT,
      year INTEGER,
      km INTEGER,
      gear TEXT,
      fuel TEXT,
      city TEXT,
      title TEXT,
      image TEXT,
      is_heavy INTEGER DEFAULT 0,
      motor TEXT,
      pkg TEXT
    );
    CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY,listing_id TEXT,price REAL,at INTEGER);
    CREATE TABLE IF NOT EXISTS jobs(url TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT DEFAULT 'pending',initial INTEGER DEFAULT 1,initial_done INTEGER DEFAULT 0,checked INTEGER DEFAULT 0,error TEXT);
    CREATE TABLE IF NOT EXISTS refresh_jobs(job_id TEXT PRIMARY KEY,listing_id TEXT NOT NULL,url TEXT NOT NULL,status TEXT NOT NULL,error TEXT,created_at INTEGER,updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,type TEXT,listing_id TEXT,title TEXT,message TEXT,at INTEGER);
    CREATE INDEX IF NOT EXISTS listing_checked ON listings(last_checked);
    CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status,kind);
    CREATE INDEX IF NOT EXISTS idx_listings_first_seen ON listings(first_seen DESC);
    CREATE INDEX IF NOT EXISTS idx_listings_last_changed ON listings(last_changed DESC);
    CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_at ON events(at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_listing ON history(listing_id, at);
    CREATE INDEX IF NOT EXISTS idx_listings_brand_model_year_opt ON listings(brand, model, year);
    CREATE INDEX IF NOT EXISTS idx_listings_brand_model_trim_opt ON listings(brand, model, trim);
    CREATE INDEX IF NOT EXISTS idx_listings_motor_opt ON listings(motor);
    CREATE INDEX IF NOT EXISTS idx_listings_is_heavy_opt ON listings(is_heavy);
    CREATE INDEX IF NOT EXISTS idx_listings_year_km_opt ON listings(year, km);
    CREATE INDEX IF NOT EXISTS idx_listings_missing_parts ON listings(favorite DESC, first_seen DESC)
      WHERE json_extract(data, '$.parts') IS NULL AND json_extract(data, '$.removed') IS NULL AND price IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_refresh_jobs_url_status ON refresh_jobs(url, status);`);
  const listingCols = new Set(db.prepare('PRAGMA table_info(listings)').all().map(c => c.name));
  for (const [colName, colType] of [
    ['brand', 'TEXT'], ['model', 'TEXT'], ['trim', 'TEXT'], ['year', 'INTEGER'],
    ['km', 'INTEGER'], ['gear', 'TEXT'], ['fuel', 'TEXT'], ['city', 'TEXT'],
    ['title', 'TEXT'], ['image', 'TEXT'], ['is_heavy', 'INTEGER DEFAULT 0'],
    ['motor', 'TEXT'], ['pkg', 'TEXT']
  ]) {
    if (!listingCols.has(colName)) db.exec(`ALTER TABLE listings ADD COLUMN ${colName} ${colType};`);
  }
  if(!db.prepare('PRAGMA table_info(jobs)').all().some(c=>c.name==='cycle')) db.exec('ALTER TABLE jobs ADD COLUMN cycle INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_cycle_status ON jobs(cycle, status);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_status_kind ON jobs(status, kind);');

  let cachedListings = null;
  let cachedCategories = null;
  let cachedCategoriesTime = 0;
  const isMemory = filename === ':memory:';

  function invalidateListings(forceClearCategories = false){
    cachedListings = null;
    if (isMemory || forceClearCategories || !cachedCategoriesTime || (Date.now() - cachedCategoriesTime > 30000)) {
      cachedCategories = null;
    }
  }

  const stmtMetaGet = db.prepare('SELECT value FROM meta WHERE key=?');
  const stmtMetaSet = db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const stmtEvent = db.prepare('INSERT INTO events(type,listing_id,title,message,at) VALUES(?,?,?,?,?)');
  const stmtEnqueue = db.prepare(`INSERT INTO jobs(url,kind,initial,cycle) VALUES(?,?,?,?) ON CONFLICT(url) DO UPDATE SET status=CASE WHEN jobs.status IN ('pending','busy') THEN jobs.status ELSE 'pending' END,error=NULL,cycle=excluded.cycle`);
  const stmtGetListingRaw = db.prepare('SELECT * FROM listings WHERE id=?');
  const stmtUpsertListing = db.prepare(`INSERT INTO listings(
    id,url,data,price,first_seen,last_checked,last_changed,detail_complete,
    brand,model,trim,year,km,gear,fuel,city,title,image,is_heavy,motor,pkg
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET
    data=excluded.data,
    price=excluded.price,
    last_checked=CASE WHEN excluded.last_checked>0 THEN excluded.last_checked ELSE listings.last_checked END,
    last_changed=CASE WHEN listings.data!=excluded.data OR listings.price IS NOT excluded.price THEN excluded.last_changed ELSE listings.last_changed END,
    detail_complete=MAX(listings.detail_complete,excluded.detail_complete),
    brand=COALESCE(excluded.brand,listings.brand),
    model=COALESCE(excluded.model,listings.model),
    trim=COALESCE(excluded.trim,listings.trim),
    year=COALESCE(excluded.year,listings.year),
    km=COALESCE(excluded.km,listings.km),
    gear=COALESCE(excluded.gear,listings.gear),
    fuel=COALESCE(excluded.fuel,listings.fuel),
    city=COALESCE(excluded.city,listings.city),
    title=COALESCE(excluded.title,listings.title),
    image=COALESCE(excluded.image,listings.image),
    is_heavy=excluded.is_heavy,
    motor=COALESCE(excluded.motor,listings.motor),
    pkg=COALESCE(excluded.pkg,listings.pkg)`);
  const stmtInsertHistory = db.prepare('INSERT INTO history(listing_id,price,at) VALUES(?,?,?)');

  function extractListingColumns(merged) {
    const specs = extractVehicleSpecs(merged.trim || '', merged.title || '', merged.fields || { Marka: merged.brand, Seri: merged.model, Vites: merged.gear });
    const isHeavy = (merged.damageGroups?.agirHasar || /ağır hasar|agir hasar|pert/i.test(`${merged.title || ''} ${merged.description || ''} ${JSON.stringify(merged.fields || {})}`)) ? 1 : 0;
    const city = (merged.location || merged.fields?.['İl / İlçe'] || '').split(/[/,-]/)[0].trim() || null;
    const gear = merged.gear || specs.gear || null;
    const fuel = merged.fuel || specs.fuel || null;
    const year = merged.year != null ? Number(merged.year) : null;
    const km = merged.km != null ? Number(merged.km) : null;
    const brand = merged.brand || null;
    const model = merged.model || null;
    const trim = merged.trim || null;
    const title = merged.title || null;
    const image = merged.image || null;
    const motor = specs.motor || null;
    const pkg = specs.pkg || null;
    return { brand, model, trim, year, km, gear, fuel, city, title, image, isHeavy, motor, pkg };
  }

  let eventCounter = 0;
  function pruneEvents(keepCount = 10000) {
    try {
      const maxIdRow = db.prepare('SELECT MAX(id) AS m, COUNT(*) AS c FROM events').get();
      if (maxIdRow && maxIdRow.c > keepCount + 1000) {
        const cutoffId = maxIdRow.m - keepCount;
        db.prepare('DELETE FROM events WHERE id < ?').run(cutoffId);
      }
    } catch (_) {}
  }
  pruneEvents(10000);

  const get = (key,fallback=null)=>{const r=stmtMetaGet.get(key);return r?JSON.parse(r.value):fallback;};
  const set = (key,value)=>stmtMetaSet.run(key,JSON.stringify(value));
  const event = (type,id,title,message)=>{
    stmtEvent.run(type,id,title,message,Date.now());
    if (++eventCounter > 500) {
      eventCounter = 0;
      pruneEvents(10000);
    }
  };
  function enqueue(url,kind,initial=true,cycle=0){stmtEnqueue.run(url,kind,+initial,cycle);}
  function ingest(item,detail=false) {
    if(!item.id||!item.url) return;
    const old=stmtGetListingRaw.get(item.id), now=Date.now();
    const prior=old?JSON.parse(old.data):{}; const merged={...prior};
    for(const [k,v] of Object.entries(item)) if(v!==null&&v!==undefined&&v!=='') merged[k]=v;
    if(prior.fields&&item.fields) merged.fields={...prior.fields,...item.fields};
    const price=item.price??old?.price??null;
    const cols=extractListingColumns(merged);
    db.exec('BEGIN');
    try {
      stmtUpsertListing.run(
        item.id,item.url,JSON.stringify(merged),price,now,detail?now:0,now,+detail,
        cols.brand,cols.model,cols.trim,cols.year,cols.km,cols.gear,cols.fuel,cols.city,
        cols.title,cols.image,cols.isHeavy,cols.motor,cols.pkg
      );
      if(price!==null&&(!old||old.price!==price)) {
        stmtInsertHistory.run(item.id,price,now);
        if(old?.price!=null) event(price<old.price?'price_drop':'price_rise',item.id,merged.title||item.id,`${old.price} → ${price} TL`);
      }
      if(!old && get('baselineDone',false)) event('new',item.id,merged.title||item.id,'Yeni ilan bulundu.');
      db.exec('COMMIT');
      invalidateListings();
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function ingestBatch(items, isLargeLiveBatch = false) {
    if (!Array.isArray(items) || items.length === 0) return { newCount: 0, updatedCount: 0, needsDetail: [] };
    const now = Date.now();
    const isBaselineDone = get('baselineDone', false);
    let newCount = 0;
    let updatedCount = 0;
    const needsDetail = [];
    db.exec('BEGIN');
    try {
      for (const item of items) {
        if (!item || !item.id || !item.url) continue;
        const old = stmtGetListingRaw.get(item.id);
        const prior = old ? JSON.parse(old.data) : {};
        const merged = { ...prior };
        for (const [k, v] of Object.entries(item)) {
          if (v !== null && v !== undefined && v !== '') merged[k] = v;
        }
        if (prior.fields && item.fields) merged.fields = { ...prior.fields, ...item.fields };
        const price = item.price ?? old?.price ?? null;
        const hasRichRowData = isLargeLiveBatch && Boolean(item.brand || item.year != null || item.km != null || item.price != null);
        const cols = extractListingColumns(merged);

        const isDetailed = Boolean(item.parts || item.description || (old && old.detail_complete));
        stmtUpsertListing.run(
          item.id, item.url, JSON.stringify(merged), price, now, hasRichRowData ? now : 0, now, +isDetailed,
          cols.brand, cols.model, cols.trim, cols.year, cols.km, cols.gear, cols.fuel, cols.city,
          cols.title, cols.image, cols.isHeavy, cols.motor, cols.pkg
        );
        if (price !== null && (!old || old.price !== price)) {
          stmtInsertHistory.run(item.id, price, now);
          if (old?.price != null) event(price < old.price ? 'price_drop' : 'price_rise', item.id, merged.title || item.id, `${old.price} → ${price} TL`);
        }
        if (!old) {
          newCount++;
          if (isBaselineDone) event('new', item.id, merged.title || item.id, 'Yeni ilan bulundu.');
        } else {
          updatedCount++;
        }
        if (!hasRichRowData && !old?.detail_complete) {
          needsDetail.push(item.url);
        }
      }
      db.exec('COMMIT');
      invalidateListings();
      return { newCount, updatedCount, needsDetail };
    } catch(e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  function getListing(id){
    const r=db.prepare('SELECT * FROM listings WHERE id=?').get(id);
    if(!r) return null;
    return {...JSON.parse(r.data),price:r.price,firstSeen:r.first_seen,lastChecked:r.last_checked,lastChanged:r.last_changed,detailComplete:!!r.detail_complete,favorite:!!r.favorite};
  }
  function listings(limit = 0){
    if(limit > 0){
      return db.prepare('SELECT * FROM listings ORDER BY first_seen DESC,id DESC LIMIT ?').all(limit).map(r=>{
        const d = JSON.parse(r.data);
        delete d.description;
        delete d.fields;
        return {...d,price:r.price,firstSeen:r.first_seen,lastChecked:r.last_checked,lastChanged:r.last_changed,detailComplete:!!r.detail_complete,favorite:!!r.favorite};
      });
    }
    if(cachedListings) return cachedListings;
    cachedListings = db.prepare('SELECT * FROM listings ORDER BY first_seen DESC,id DESC').all().map(r=>{
      const d = JSON.parse(r.data);
      delete d.description;
      delete d.fields;
      return {...d,price:r.price,firstSeen:r.first_seen,lastChecked:r.last_checked,lastChanged:r.last_changed,detailComplete:!!r.detail_complete,favorite:!!r.favorite};
    });
    return cachedListings;
  }
  function state(limit = 0){
    const jobs=db.prepare(`SELECT COUNT(*) AS total,SUM(status='pending') AS pending,SUM(status='busy') AS busy,SUM(initial=1) AS baselineTotal,SUM(initial=1 AND initial_done=1) AS baselineCompleted,SUM(status='failed') AS failed FROM jobs`).get();
    const totalCount=db.prepare('SELECT COUNT(1) AS c FROM listings').get().c;
    const resultListings=listings(limit);
    return {timestamp:Date.now(),totalCount,hasMore:limit>0&&totalCount>limit,listings:resultListings,events:db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 80').all(),jobs,settings:{intervalSeconds:30,uiPollSeconds:get('uiPollSeconds',30),gapSeconds:get('gapSeconds',10)},source:{mode:'public_only',reader:get('reader'),pageCheck:get('sourceCheck'),phase:get('phase','ready'),message:get('message','Gerçek kaynak bağlantısı bekleniyor.'),running:get('running',false),baselineDone:get('baselineDone',false),baselineCompletedAt:get('baselineCompletedAt'),lastTick:get('lastTick'),lastSuccess:get('lastSuccess'),nextTick:get('nextTick'),nextRequestAt:get('nextRequestAt'),retryAt:get('retryAt'),lastAttempt:get('lastAttempt'),activeCycle:get('activeCycle'),cyclesCompleted:get('cyclesCompleted',0),lastCheckAt:get('lastCheckAt'),lastNewCount:get('lastNewCount',0),deepCursor:get('deepCursor'),failStreak:get('failStreak',0)},server:{startedAt:get('serverStarted'),local:true,demo:false}};
  }
  function stateDelta(since=0){
    const now=Date.now(), effectiveSince = Number(since) || (now - 60000);
    const jobs=db.prepare(`SELECT COUNT(*) AS total,SUM(status='pending') AS pending,SUM(status='busy') AS busy,SUM(initial=1) AS baselineTotal,SUM(initial=1 AND initial_done=1) AS baselineCompleted,SUM(status='failed') AS failed FROM jobs`).get();
    const source={mode:'public_only',reader:get('reader'),pageCheck:get('sourceCheck'),phase:get('phase','ready'),message:get('message','Gerçek kaynak bağlantısı bekleniyor.'),running:get('running',false),baselineDone:get('baselineDone',false),baselineCompletedAt:get('baselineCompletedAt'),lastTick:get('lastTick'),lastSuccess:get('lastSuccess'),nextTick:get('nextTick'),nextRequestAt:get('nextRequestAt'),retryAt:get('retryAt'),lastAttempt:get('lastAttempt'),activeCycle:get('activeCycle'),cyclesCompleted:get('cyclesCompleted',0),lastCheckAt:get('lastCheckAt'),lastNewCount:get('lastNewCount',0),deepCursor:get('deepCursor'),failStreak:get('failStreak',0)};
    const totalListings=db.prepare('SELECT COUNT(1) AS c FROM listings').get().c;
    const updatedRows=db.prepare('SELECT * FROM listings WHERE last_changed > ? ORDER BY last_changed DESC LIMIT 200').all(effectiveSince);
    const newOrUpdated=updatedRows.map(r=>{
      const d = JSON.parse(r.data);
      delete d.description;
      delete d.fields;
      return {...d,price:r.price,firstSeen:r.first_seen,lastChecked:r.last_checked,lastChanged:r.last_changed,detailComplete:!!r.detail_complete,favorite:!!r.favorite};
    });
    const events=db.prepare('SELECT * FROM events WHERE at > ? ORDER BY id DESC LIMIT 50').all(effectiveSince);
    return {delta:true,timestamp:now,totalListings,newOrUpdated,events,jobs,source};
  }
  function getDistinctBrands() {
    return db.prepare("SELECT DISTINCT brand AS b FROM listings WHERE brand IS NOT NULL AND brand != '' ORDER BY b COLLATE NOCASE").all().map(r => r.b);
  }
  function getDistinctModels(brand) {
    const rows = brand
      ? db.prepare("SELECT DISTINCT model AS m, trim AS t FROM listings WHERE brand = ? AND model IS NOT NULL AND model != ''").all(brand)
      : db.prepare("SELECT DISTINCT model AS m, trim AS t FROM listings WHERE model IS NOT NULL AND model != '' LIMIT 1500").all();
    const modelSet = new Set();
    for (const r of rows) {
      if (r.m) modelSet.add(r.m.trim());
    }
    for (const r of rows) {
      if (r.t) {
        const t = r.t.trim();
        if (/^[a-z0-9]/i.test(t)) {
          if (/^i[1-9x]/i.test(t)) {
            modelSet.add(t);
            const sub = t.split(' ')[0];
            if (sub && sub.length >= 2) modelSet.add(sub);
          }
          const combined = `${r.m} ${t}`.trim();
          if (combined.length <= 40) {
            modelSet.add(combined);
          }
        }
      }
    }
    return [...modelSet].sort((a, b) => a.localeCompare(b, 'tr'));
  }
  function getCategories(force = false) {
    const now = Date.now();
    if (!cachedCategories || force || (isMemory ? false : now - cachedCategoriesTime > 30000)) {
      const rows = db.prepare(`
        SELECT 
          brand,
          model,
          trim,
          COUNT(*) as count
        FROM listings
        WHERE brand IS NOT NULL AND brand != ''
        GROUP BY brand, model, trim
      `).all();
      const trNorm = s => String(s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/Ğ/g, 'g').replace(/ü/g, 'u').replace(/Ü/g, 'u').replace(/ş/g, 's').replace(/Ş/g, 's').replace(/ö/g, 'o').replace(/Ö/g, 'o').replace(/ç/g, 'c').replace(/Ç/g, 'c').toLowerCase().trim();
      cachedCategories = rows.map(r => {
        const b = r.brand || '';
        const m = r.model || '';
        const t = r.trim || '';
        return {
          brand: b,
          model: m,
          trim: t,
          count: r.count,
          bNorm: trNorm(b),
          mNorm: trNorm(m),
          tNorm: trNorm(t),
          fullNorm: `${trNorm(b)} ${trNorm(m)} ${trNorm(t)}`,
          cleanNorm: `${trNorm(b)}${trNorm(m)}${trNorm(t)}`.replace(/[\s\-_]/g, '')
        };
      });
      cachedCategoriesTime = now;
    }
    return cachedCategories;
  }
  function searchCategories(query, brandFilter = '') {
    const cats = getCategories();
    const trNorm = s => String(s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/Ğ/g, 'g').replace(/ü/g, 'u').replace(/Ü/g, 'u').replace(/ş/g, 's').replace(/Ş/g, 's').replace(/ö/g, 'o').replace(/Ö/g, 'o').replace(/ç/g, 'c').replace(/Ç/g, 'c').toLowerCase().trim();

    if (!query || !query.trim()) {
      if (brandFilter) {
        return cats.filter(c => c.brand === brandFilter).sort((a, b) => b.count - a.count).slice(0, 50).map(c => ({
          brand: c.brand,
          model: c.model,
          trim: c.trim,
          count: c.count,
          path: `${c.brand} › ${c.model}${c.trim ? ' › ' + c.trim : ''}`
        }));
      }
      return cats.slice(0, 50).map(c => ({
        brand: c.brand,
        model: c.model,
        trim: c.trim,
        count: c.count,
        path: `${c.brand} › ${c.model}${c.trim ? ' › ' + c.trim : ''}`
      }));
    }

    const normQ = trNorm(query);
    const cleanQ = normQ.replace(/[\s\-_]/g, '');
    const tokens = normQ.split(/\s+/).filter(Boolean);
    const scored = [];

    for (const c of cats) {
      if (brandFilter && c.brand !== brandFilter) continue;

      const matches = tokens.every(tok => {
        const cTok = tok.replace(/[\s\-_]/g, '');
        return c.fullNorm.includes(tok) || (cTok && c.cleanNorm.includes(cTok));
      });
      if (!matches) continue;

      let score = 0;
      if (c.mNorm === normQ) score += 5000;
      else if (c.mNorm.startsWith(normQ)) score += 3500;
      else if (c.tNorm === normQ) score += 2500;
      else if (c.tNorm.startsWith(normQ)) score += 1200;
      else if (tokens[0] && c.mNorm.startsWith(tokens[0])) score += 2000;
      else if (tokens[0] && c.tNorm.startsWith(tokens[0])) score += 1000;
      else if (c.bNorm.startsWith(tokens[0])) score += 800;
      else score += 100;

      score += Math.min(300, c.count * 3);

      scored.push({
        brand: c.brand,
        model: c.model,
        trim: c.trim,
        count: c.count,
        score,
        path: `${c.brand} › ${c.model}${c.trim ? ' › ' + c.trim : ''}`
      });
    }

    scored.sort((a, b) => b.score - a.score || b.count - a.count);
    return scored.slice(0, 40);
  }
  function getCategoryTree(selectedBrand = '', selectedSeries = '') {
    const cats = getCategories();
    if (!selectedBrand) {
      const brandCounts = new Map();
      let total = 0;
      for (const c of cats) {
        brandCounts.set(c.brand, (brandCounts.get(c.brand) || 0) + c.count);
        total += c.count;
      }
      const items = [...brandCounts.entries()]
        .map(([brand, count]) => ({ brand, count }))
        .sort((a, b) => b.count - a.count);
      return { level: 0, items, total };
    }

    if (!selectedSeries) {
      const seriesCounts = new Map();
      let total = 0;
      for (const c of cats) {
        if (c.brand === selectedBrand && c.model) {
          seriesCounts.set(c.model, (seriesCounts.get(c.model) || 0) + c.count);
          total += c.count;
        }
      }
      const items = [...seriesCounts.entries()]
        .map(([series, count]) => ({ series, count }))
        .sort((a, b) => b.count - a.count);
      return { level: 1, brand: selectedBrand, items, total };
    }

    const trimCounts = new Map();
    let total = 0;
    for (const c of cats) {
      if (c.brand === selectedBrand && c.model === selectedSeries && c.trim) {
        trimCounts.set(c.trim, (trimCounts.get(c.trim) || 0) + c.count);
        total += c.count;
      }
    }
    const items = [...trimCounts.entries()]
      .map(([trim, count]) => ({ trim, count }))
      .sort((a, b) => b.count - a.count);
    return { level: 2, brand: selectedBrand, series: selectedSeries, items, total };
  }
  function getValuation({ brand, model, trim = '', year, km, gear, roofHood = 'orijinal', paintedCount = 0, tramer = 0, sunroof = false, targetPrice = null, listingId = null }) {
    if (!brand || !model || !year) return { ok: false, error: 'Marka, model ve yıl zorunludur.' };
    const targetYear = Number(year);
    if (!Number.isFinite(targetYear) || targetYear < 1980 || targetYear > 2030) return { ok: false, error: 'Geçerli bir model yılı girin.' };

    let targetListing = null;
    if (listingId) {
      const targetRow = db.prepare("SELECT data, price FROM listings WHERE id = ?").get(listingId);
      if (targetRow) {
        try {
          targetListing = JSON.parse(targetRow.data);
          if (!trim && targetListing.trim) trim = targetListing.trim;
          if (!gear && targetListing.gear) gear = targetListing.gear;
          if ((km == null || km === 0) && targetListing.km) km = targetListing.km;
          if (!targetPrice && targetRow.price) targetPrice = targetRow.price;
        } catch {}
      }
    }

    const targetSpecs = extractVehicleSpecs(trim || '', targetListing?.title || '', targetListing?.fields || { Marka: brand, Seri: model, Vites: gear });
    if (!targetSpecs.gear && gear) targetSpecs.gear = String(gear).toLowerCase();

    let rows = db.prepare(`
      SELECT id, price, brand, model, trim, year, km, gear, fuel, city, title, image, is_heavy, motor, pkg, data FROM listings 
      WHERE brand = ? 
        AND (
          model = ? 
          OR model LIKE ? 
          OR trim LIKE ? 
          OR (model || ' ' || COALESCE(trim, '')) LIKE ?
        )
        AND year BETWEEN ? AND ? 
        AND price > 50000
    `).all(brand, model, `%${model}%`, `%${model}%`, `%${model}%`, targetYear - 1, targetYear + 1);

    if (rows.length < 8) {
      rows = db.prepare(`
        SELECT id, price, brand, model, trim, year, km, gear, fuel, city, title, image, is_heavy, motor, pkg, data FROM listings 
        WHERE brand = ? 
          AND (
            model = ? 
            OR model LIKE ? 
            OR trim LIKE ? 
            OR (model || ' ' || COALESCE(trim, '')) LIKE ?
          )
          AND year BETWEEN ? AND ? 
          AND price > 50000
      `).all(brand, model, `%${model}%`, `%${model}%`, `%${model}%`, targetYear - 2, targetYear + 2);
    }

    const targetIsHeavy = Boolean(targetListing?.damageGroups?.agirHasar || /ağır hasar|agir hasar|pert/i.test(`${targetListing?.title || ''} ${targetListing?.description || ''}`));

    const candidates = [];
    for (const r of rows) {
      if (listingId && r.id === listingId) continue;
      if (!r.price || r.price < 50000) continue;

      const cSpecs = {
        motor: r.motor || '',
        fuel: r.fuel || '',
        gear: r.gear || '',
        body: '',
        pkg: r.pkg || ''
      };

      candidates.push({
        id: r.id,
        price: r.price,
        year: r.year,
        km: r.km,
        gear: r.gear || '',
        trim: r.trim || '',
        title: r.title || '',
        image: r.image || null,
        location: r.city || null,
        url: `https://www.sahibinden.com/ilan/vasita-otomobil-${r.id}/detay`,
        rawData: r.data,
        parts: null,
        damageGroups: null,
        tramer: null,
        publishedDate: null,
        specs: cSpecs,
        isHeavy: Boolean(r.is_heavy)
      });
    }

    const exactMotorCount = targetSpecs.motor ? candidates.filter(c => c.specs.motor === targetSpecs.motor).length : 0;

    const scored = [];
    for (const c of candidates) {
      // 1. Exclude heavy damage if target is clean
      if (!targetIsHeavy && c.isHeavy) continue;

      // 2. Exclude body mismatch (sedan vs station/variant vs coupe vs cabrio)
      if (targetSpecs.body && c.specs.body && targetSpecs.body !== c.specs.body) continue;

      // 3. Strict motor filter if at least 3 exact motor matches exist
      if (targetSpecs.motor && exactMotorCount >= 3 && c.specs.motor && c.specs.motor !== targetSpecs.motor) {
        continue;
      }

      let uyum = 30;

      // Motor score
      if (targetSpecs.motor && c.specs.motor) {
        if (c.specs.motor === targetSpecs.motor) uyum += 30;
        else uyum -= 30;
      }

      // Fuel score
      if (targetSpecs.fuel && c.specs.fuel) {
        if (c.specs.fuel === targetSpecs.fuel) uyum += 10;
        else uyum -= 35;
      }

      // Package / Trim score
      if (targetSpecs.pkg && c.specs.pkg) {
        if (c.specs.pkg === targetSpecs.pkg) uyum += 20;
        else uyum += 5;
      } else if (trim && c.trim) {
        const tTokens = trim.toLowerCase().split(/\s+/).filter(x => x.length > 2);
        const cTokens = c.trim.toLowerCase().split(/\s+/).filter(x => x.length > 2);
        const common = tTokens.filter(t => cTokens.includes(t));
        if (common.length >= 2) uyum += 15;
        else if (common.length === 1) uyum += 8;
      }

      // Gear / Transmission score
      if (gear && c.gear) {
        const g1 = String(gear).toLowerCase().includes('oto') ? 'oto' : 'man';
        const g2 = String(c.gear).toLowerCase().includes('oto') ? 'oto' : 'man';
        if (g1 === g2) uyum += 10;
        else uyum -= 20;
      }

      // Year score
      const yDiff = Math.abs((c.year || targetYear) - targetYear);
      if (yDiff === 0) uyum += 10;
      else if (yDiff === 1) uyum += 5;
      else uyum -= 8;

      // KM score
      const targetKm = Number(km);
      if (targetKm > 0 && c.km != null && c.km > 0) {
        const kmDiff = Math.abs(c.km - targetKm);
        if (kmDiff <= 20000) uyum += 10;
        else if (kmDiff <= 45000) uyum += 6;
        else if (kmDiff <= 75000) uyum += 2;
        else if (kmDiff > 100000) uyum -= 10;
      }

      // Damage / Paint condition check
      if (roofHood === 'orijinal' && c.parts) {
        const h = String(c.parts.kaput || c.parts.motor_kaputu || '');
        const t = String(c.parts.tavan || '');
        if (h.includes('Değişen') || t.includes('Değişen')) uyum -= 12;
        else if (h.includes('Boyalı') || t.includes('Boyalı')) uyum -= 6;
      }

      uyum = Math.max(5, Math.min(99, uyum));
      scored.push({ ...c, uyum });
    }

    scored.sort((a, b) => b.uyum - a.uyum || Math.abs((a.km || km || 0) - (km || 0)) - Math.abs((b.km || km || 0) - (km || 0)));

    const strongPeers = scored.filter(s => s.uyum >= 50);
    const validCandidates = strongPeers.length >= 3 ? strongPeers : scored;

    if (validCandidates.length < 3) {
      return {
        ok: false,
        count: validCandidates.length,
        brand,
        model,
        trim,
        year: targetYear,
        canCrawl: true,
        message: `Bu seçim için veritabanında ${validCandidates.length} uygun emsal ilan bulundu. Değerleme için en az 3 karşılaştırılabilir ilan gereklidir.`
      };
    }

    const pricingPool = validCandidates.slice(0, 20);
    const prices = pricingPool.map(r => r.price).sort((a, b) => a - b);
    const count = validCandidates.length;

    const median = (arr) => {
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 !== 0 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
    };
    const percentile = (arr, p) => {
      const idx = (arr.length - 1) * p;
      const lower = Math.floor(idx);
      const frac = idx - lower;
      return arr[lower + 1] !== undefined ? Math.round(arr[lower] + frac * (arr[lower + 1] - arr[lower])) : arr[lower];
    };

    const base = median(prices);
    const pMin = prices[0];
    const p25 = percentile(prices, 0.25);
    const p75 = percentile(prices, 0.75);
    const pMax = prices[prices.length - 1];

    let adjFactor = 1.0;
    if (roofHood === 'boyali') adjFactor -= 0.04;
    else if (roofHood === 'degisen') adjFactor -= 0.08;
    if (paintedCount > 0) adjFactor -= Math.min(0.12, paintedCount * 0.015);
    if (tramer > 0 && base > 0) adjFactor -= Math.min(0.10, (tramer / base) * 0.5);
    if (sunroof) adjFactor += 0.02;

    const validKms = pricingPool.map(r => r.km).filter(k => typeof k === 'number' && k > 0);
    const peerMedianKm = validKms.length ? median(validKms.sort((a, b) => a - b)) : null;
    const targetKm = Number(km);
    if (targetKm && peerMedianKm && targetKm > 0) {
      const kmDiff = targetKm - peerMedianKm;
      const kmAdj = Math.max(-0.10, Math.min(0.10, -(kmDiff / 10000) * 0.0075));
      adjFactor += kmAdj;
    }

    const adjustedBase = Math.round((base * adjFactor) / 1000) * 1000;
    const buyLevel = Math.round(adjustedBase * 0.85);
    const sellLevel = Math.round(adjustedBase * 0.93);

    let targetAnalysis = null;
    const effectiveTargetPrice = Number(targetPrice) || (listingId ? candidates.find(r => r.id === listingId)?.price : null);
    if (effectiveTargetPrice && effectiveTargetPrice > 0) {
      const diff = effectiveTargetPrice - adjustedBase;
      const oppPct = Math.round(((adjustedBase - effectiveTargetPrice) / adjustedBase) * 100);
      targetAnalysis = {
        targetPrice: effectiveTargetPrice,
        diff,
        oppPct,
        isOpportunity: oppPct > 0,
        label: oppPct >= 15 ? '%15+ Süper Fırsat' : oppPct >= 7 ? '%7+ Fırsat' : oppPct >= 0 ? 'Piyasa Seviyesinde' : 'Piyasa Üzerinde'
      };
    }

    for (const r of pricingPool) {
      if (r.rawData && (!r.parts || !r.damageGroups)) {
        try {
          const d = JSON.parse(r.rawData);
          r.parts = d.parts || null;
          r.damageGroups = d.damageGroups || null;
          r.tramer = d.tramer || null;
          r.publishedDate = d.publishedDate || null;
        } catch {}
      }
    }

    const peers = pricingPool.map(r => ({
      id: r.id,
      price: r.price,
      year: r.year,
      km: r.km,
      gear: r.gear,
      trim: r.trim,
      title: r.title,
      image: r.image,
      location: r.location,
      url: r.url,
      parts: r.parts,
      damageGroups: r.damageGroups,
      tramer: r.tramer,
      publishedDate: r.publishedDate,
      uyum: r.uyum,
      motor: r.specs.motor,
      pkg: r.specs.pkg,
      diffFromBase: r.price - adjustedBase,
      diffPct: Math.round(((r.price - adjustedBase) / adjustedBase) * 100)
    }));

    return {
      ok: true,
      brand,
      model,
      trim,
      year: targetYear,
      count,
      peerMedianKm,
      base,
      adjustedBase,
      buyLevel,
      sellLevel,
      stats: { min: pMin, p25, median: base, p75, max: pMax },
      targetAnalysis,
      peers
    };
  }
  db.exec(`UPDATE jobs SET status='pending' WHERE status='busy'`);
  return {db,dbPath:filename,get,set,event,enqueue,ingest,ingestBatch,listings,getListing,invalidateListings,state,stateDelta,getDistinctBrands,getDistinctModels,getValuation,searchCategories,getCategoryTree,pruneEvents};
}
