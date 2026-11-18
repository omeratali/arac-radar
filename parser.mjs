export const ROOT = 'https://www.sahibinden.com/otomobil';
export const text = value => String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/\s+/g,' ').trim();
const attr = (tag,key) => tag.match(new RegExp('\\b'+key+'\\s*=\\s*["\']([^"\']*)["\']','i'))?.[1] || '';

export function sourceUrl(raw,base=ROOT) {
  try {
    const u = new URL(raw.replace(/&amp;/g,'&'),base);
    if(u.protocol!=='https:' || !['www.sahibinden.com','sahibinden.com'].includes(u.hostname)) return null;
    u.hostname='www.sahibinden.com';
    u.hash='';
    return u.href;
  } catch { return null; }
}

export function accessProblem(html,url,status=200) {
  const title = text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const body = text(html).slice(0,16000);
  const hasRealContent = /searchResultsItem|classifiedInfoList|classifiedDescription/i.test(html);
  if(status===404) return {phase:'not_found',message:'Kaynak sayfası bulunamadı (HTTP 404).'};
  if(status===429) return {phase:'rate_limited',message:'Kaynak istek sınırı bildirdi (429). Bekleme uygulanıyor.'};
  if(status===401 || /secure\.sahibinden\.com\/giris|\/giris\?/i.test(url) || /giriş yapmanız gerekmektedir|giriş yapman gerekiyor/i.test(body)) return {phase:'auth_required',message:'Kaynak giriş zorunlu tutuyor. Girişsiz modda bu sayfadan ilan alınamıyor; genel tarama tamamlanmadı.'};
  if(/just a moment|bir dakika|robot doğrulama|verify you are human|checking your browser/i.test(title) || /\/cs\/checkLoading/i.test(url) || (!hasRealContent && (/cf-chl-|px-captcha/i.test(html) || /enable javascript and cookies to continue/i.test(body)))) {
    return {phase:'access_blocked',reason:'browser_verification',message:'Kaynak tarayıcı doğrulaması istiyor. İlan alınamadı; arka plan taraması durduruldu.'};
  }
  if(status===403 || /access denied|access to this page has been denied|bir sorun oluştu/i.test(title)) {
    return {phase:'access_blocked',reason:'access_denied',message:`Kaynak erişimi reddetti${status===403?' (HTTP 403)':''}. İlan alınamadı; tarama durduruldu.`};
  }
  if(status>=400) return {phase:'source_error',message:`Kaynak HTTP ${status} yanıtı verdi. İlanlar kaldırılmış sayılmadı.`};
  return null;
}

export function numberTR(value) {
  const v=String(value||'').replace(/[^\d,.]/g,'').replace(/\./g,'').replace(',','.');
  const n=Number(v);
  return v && Number.isFinite(n) ? n : null;
}

function inferGear(str) {
  if(!str) return null;
  if(/\b(yarı otomatik|yari otomatik|dsg|edc|s-tronic|stronic|tiptronic|easytronic|etg|dualogic|multimode|tct|dct|powershift)\b/i.test(str)) return 'Yarı Otomatik';
  if(/\b(otomatik|eat8|eat6|7g-tronic|8g-tronic|9g-tronic|zf|cvt|multitronic|geartronic|x-tronic|steptronic|e-cvt)\b/i.test(str)) return 'Otomatik';
  if(/\b(manuel|düz vites|duz vites)\b/i.test(str)) return 'Manuel';
  return null;
}

function links(html,base) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m=>({url:sourceUrl(attr(m[1],'href'),base),label:text(m[2]),raw:m[0]})).filter(a=>a.url);
}

const MULTI_WORD_BRANDS = ['Alfa Romeo', 'Aston Martin', 'DS Automobiles', 'Land Rover', 'Mercedes-Benz', 'KGM SsangYong'];
export const KNOWN_BRAND_SLUGS = new Set([
  'alfa-romeo', 'aston-martin', 'audi', 'bentley', 'bmw', 'byd', 'chery', 'chevrolet',
  'citroen', 'cupra', 'dacia', 'daewoo', 'daihatsu', 'dodge', 'ds-automobiles', 'ferrari',
  'fiat', 'ford', 'geely', 'honda', 'hyundai', 'infiniti', 'jaguar', 'jeep', 'kia', 'lada',
  'land-rover', 'lexus', 'maserati', 'mazda', 'mercedes-benz', 'mg', 'mini', 'mitsubishi',
  'nissan', 'opel', 'peugeot', 'porsche', 'renault', 'rover', 'seat', 'skoda', 'smart',
  'ssangyong', 'subaru', 'suzuki', 'tata', 'tesla', 'togg', 'tofas', 'toyota', 'volkswagen', 'volvo'
]);

function splitBrandAndSeries(rawHeader, pageUrl = '') {
  let clean = String(rawHeader || '')
    .replace(/^(?:Satılık|Kiralık|2\.El|İkinci El|Arazi,\s*SUV\s*&\s*Pickup|Otomobil)\s+/i, '')
    .replace(/\s*(?:Fiyatları|Modelleri|İlanları|Satılık|2\.El|Arazi,\s*SUV\s*&\s*Pickup|Otomobil).*$/i, '')
    .trim();
  if (/^(?:Arazi,\s*SUV\s*&\s*Pickup|Otomobil|Vasıta)$/i.test(clean)) clean = '';
  if (!clean && pageUrl) {
    try {
      const u = new URL(pageUrl);
      const slug = u.pathname.match(/^\/(?:(?:otomobil|arazi-suv-pickup)[/-])?([a-z0-9-]+)$/i)?.[1] || '';
      if (slug && !['otomobil', 'arazi-suv-pickup'].includes(slug.toLowerCase())) {
        clean = slug.split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ');
      }
    } catch {}
  }
  if (!clean) return { brand: null, series: null };
  for (const mb of MULTI_WORD_BRANDS) {
    if (clean.toLocaleLowerCase('tr').startsWith(mb.toLocaleLowerCase('tr'))) {
      const rest = clean.slice(mb.length).trim();
      return { brand: mb, series: rest || null };
    }
  }
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return { brand: parts[0], series: null };
  return { brand: parts[0], series: parts.slice(1).join(' ') };
}

export function extractRowPrice(rowHtml) {
  const priceCell = rowHtml.match(/<td\b[^>]*class=["'][^"']*searchResultsPriceValue[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1];
  const rawSource = priceCell !== undefined
    ? text(priceCell)
    : text(rowHtml.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' '));
  const matches = [...rawSource.matchAll(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*(?:TL|₺)/gi)];
  if (!matches.length) return null;
  return numberTR(matches[matches.length - 1][1]);
}

export function isHoneypotRow(rowHtml, url = '') {
  if (/-sb2f-/i.test(url)) return true;
  const trOpen = rowHtml.match(/^<tr\b[^>]*>/i)?.[0] || '';
  if (/display\s*:\s*none|visibility\s*:\s*hidden|searchResultsPromo|classicNativeAd/i.test(trOpen)) return true;
  return false;
}

export function parseList(html,base=ROOT) {
  const all=links(html,base), byId=new Map();
  const h1Raw = text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const { brand: pageBrand, series: pageSeries } = splitBrandAndSeries(h1Raw, base);
  for(const row of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const rowHtml = row[0];
    if (isHoneypotRow(rowHtml)) continue;
    const tags = [...rowHtml.matchAll(/<td\b[^>]*class=["'][^"']*searchResultsTagAttributeValue[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)].map(m=>text(m[1])).filter(Boolean);
    const attrs = [...rowHtml.matchAll(/<td\b[^>]*class=["'][^"']*searchResultsAttributeValue[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)].map(m=>text(m[1])).filter(Boolean);
    const locCell = rowHtml.match(/<td\b[^>]*class=["'][^"']*searchResultsLocationValue[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1];
    const dateCell = rowHtml.match(/<td\b[^>]*class=["'][^"']*searchResultsDateValue[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1];
    const rowPrice = extractRowPrice(rowHtml);
    for(const a of links(rowHtml,base)) {
      if (isHoneypotRow(rowHtml, a.url)) continue;
      const id=new URL(a.url).pathname.match(/^\/ilan\/vasita-.*-(\d+)\/detay$/)?.[1];
      if(!id) continue;
      const img=rowHtml.match(/<img\b[^>]*>/i)?.[0]||'';
      const prior=byId.get(id);
      const title=a.label.length>8?a.label:prior?.title||'';
      let brand=prior?.brand||null, model=prior?.model||null, trim=prior?.trim||null;
      if(tags.length>=3) {
        brand=tags[0]; model=tags[1]; trim=tags[2];
      } else if(tags.length===2) {
        brand=pageBrand||prior?.brand||null;
        model=tags[0]; trim=tags[1];
      } else if(tags.length===1) {
        brand=pageBrand||prior?.brand||null;
        model=pageSeries||prior?.model||null;
        trim=tags[0];
      } else if(pageBrand) {
        brand=pageBrand;
        if(pageSeries) model=pageSeries;
      }
      const year=numberTR(attrs[0])??prior?.year??null;
      const km=numberTR(attrs[1])??prior?.km??null;
      const location=locCell?text(locCell.replace(/<br\s*\/?>/gi,' / ')):(prior?.location||null);
      const publishedDate=dateCell?text(dateCell):(prior?.publishedDate||null);
      const gear=inferGear(`${title} ${trim||''}`)||prior?.gear||null;
      const item={...prior,id,url:a.url,title,price:rowPrice??prior?.price??null,image:attr(img,'data-src')||attr(img,'src')||''};
      if(brand) item.brand=brand;
      if(model) item.model=model;
      if(trim) item.trim=trim;
      if(year!=null) item.year=year;
      if(km!=null) item.km=km;
      if(gear) item.gear=gear;
      if(location) item.location=location;
      if(publishedDate) item.publishedDate=publishedDate;
      if(brand||year!=null||km!=null||location) {
        item.fields={
          ...(prior?.fields||{}),
          ...(brand?{'Marka':brand}:{}),
          ...(model?{'Seri':model}:{}),
          ...(trim?{'Model':trim}:{}),
          ...(year!=null?{'Yıl':String(year)}:{}),
          ...(km!=null?{'KM':new Intl.NumberFormat('tr-TR').format(km)}:{}),
          ...(gear?{'Vites':gear}:{}),
          ...(location?{'Konum':location}:{}),
          ...(publishedDate?{'İlan Tarihi':publishedDate}:{})
        };
      }
      byId.set(id,item);
    }
  }
  for(const a of all) {
    if (/-sb2f-/i.test(a.url)) continue;
    const id=new URL(a.url).pathname.match(/^\/ilan\/vasita-.*-(\d+)\/detay$/)?.[1];
    if(id && !byId.has(id)) byId.set(id,{id,url:a.url,title:a.label,price:null,image:''});
  }
  const allowedSearchKeys = new Set(['pagingOffset', 'pagingSize', 'sorting', 'price_min', 'price_max']);
  const pages=[...new Set(all.filter(a=>{
    const u=new URL(a.url);
    const p=u.pathname.replace(/^\//,'').toLowerCase();
    const isMainCat = p === 'otomobil' || p === 'arazi-suv-pickup';
    const isBrandCat = KNOWN_BRAND_SLUGS.has(p) || (p.startsWith('arazi-suv-pickup-') && KNOWN_BRAND_SLUGS.has(p.slice('arazi-suv-pickup-'.length)));
    if(!isMainCat && !isBrandCat) return false;
    if(u.searchParams.has('sorting') && u.searchParams.get('sorting') !== 'date_desc') return false;
    return [...u.searchParams.keys()].every(k=>allowedSearchKeys.has(k));
  }).map(a=>a.url))];
  return {listings:[...byId.values()],pages};
}

export const DEEP_PRICE_BANDS = [
  [0, 350000],
  [350000, 550000],
  [550000, 725000],
  [725000, 875000],
  [875000, 1025000],
  [1025000, 1175000],
  [1175000, 1325000],
  [1325000, 1500000],
  [1500000, 1700000],
  [1700000, 1950000],
  [1950000, 2250000],
  [2250000, 2650000],
  [2650000, 3250000],
  [3250000, 4500000],
  [4500000, null]
];

export function buildPageUrl(baseUrl, { offset = 0, pagingSize = 50, sort = 'date_desc', priceMin = null, priceMax = null } = {}) {
  const clean = sourceUrl(baseUrl);
  if (!clean) return null;
  const u = new URL(clean);
  if (sort) u.searchParams.set('sorting', sort);
  if (pagingSize) u.searchParams.set('pagingSize', String(pagingSize));
  if (priceMin != null && priceMin > 0) u.searchParams.set('price_min', String(priceMin));
  else u.searchParams.delete('price_min');
  if (priceMax != null && priceMax > 0) u.searchParams.set('price_max', String(priceMax));
  else u.searchParams.delete('price_max');
  if (offset > 0) u.searchParams.set('pagingOffset', String(offset));
  else u.searchParams.delete('pagingOffset');
  return u.href;
}

export function iqrStats(values = []) {
  const valid = values
    .map(Number)
    .filter(v => Number.isFinite(v) && v >= 50000 && v <= 150000000)
    .sort((a, b) => a - b);
  if (!valid.length) return { count: 0, median: null, p25: null, p75: null, min: null, max: null, cleaned: [] };
  const pct = (arr, q) => {
    const idx = (arr.length - 1) * q;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? arr[lo] : arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
  };
  let cleaned = valid;
  if (valid.length >= 4) {
    const q1 = pct(valid, 0.25);
    const q3 = pct(valid, 0.75);
    const iqr = q3 - q1;
    const lowFence = q1 - 1.5 * iqr;
    const highFence = q3 + 1.5 * iqr;
    const filtered = valid.filter(v => v >= lowFence && v <= highFence);
    if (filtered.length >= 3) cleaned = filtered;
  }
  return {
    count: cleaned.length,
    median: Math.round(pct(cleaned, 0.5)),
    p25: Math.round(pct(cleaned, 0.25)),
    p75: Math.round(pct(cleaned, 0.75)),
    min: cleaned[0],
    max: cleaned[cleaned.length - 1],
    cleaned
  };
}

export function evaluateOpportunityCandidate(item, allListings = []) {
  if (!item || !item.price || item.price < 50000 || !item.brand || !item.model) {
    return { isCandidate: false, compMedian: null, compCount: 0, discountPct: null };
  }
  const now = Date.now();
  const STALE_MS = 21 * 86400000;
  // Filter peer pool (excluding stale >21d unsold listings when fresh ones exist, and deduplicating title+price)
  const seenKeys = new Set();
  const basePool = [];
  for (const l of allListings) {
    if (!l || l.id === item.id || !l.price || l.price < 50000) continue;
    if (l.brand !== item.brand || l.model !== item.model) continue;
    if (item.year && l.year && Math.abs(l.year - item.year) > 2) continue;
    const dedupKey = `${(l.title || '').trim().toLowerCase()}|${l.price}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    basePool.push(l);
  }
  const freshPool = basePool.filter(l => !l.firstSeen || (now - l.firstSeen) <= STALE_MS || (l.lastChanged && (now - l.lastChanged) <= STALE_MS));
  let pool = freshPool.length >= 4 ? freshPool : basePool;

  // Stepwise relaxation (CompFinder style):
  // 1. Same year(±1) + same gear + close KM
  if (item.year) {
    const y1 = pool.filter(l => l.year && Math.abs(l.year - item.year) <= 1);
    if (y1.length >= 4) pool = y1;
  }
  if (item.gear) {
    const gPool = pool.filter(l => !l.gear || l.gear === item.gear);
    if (gPool.length >= 4) pool = gPool;
  }
  if (item.km != null) {
    const kmPool = pool.filter(l => l.km == null || Math.abs(l.km - item.km) <= 65000);
    if (kmPool.length >= 4) pool = kmPool;
  }
  const stats = iqrStats(pool.map(l => l.price));
  if (stats.count < 3 || !stats.median) {
    return { isCandidate: false, compMedian: null, compCount: stats.count, discountPct: null };
  }
  const discountPct = Math.round(((stats.median - item.price) / stats.median) * 1000) / 10;
  // Candidate if at least 6% below IQR median comp (or below P25)
  const isCandidate = discountPct >= 6 || item.price <= stats.p25;
  return {
    isCandidate,
    compMedian: stats.median,
    compP25: stats.p25,
    compP75: stats.p75,
    compCount: stats.count,
    discountPct
  };
}

export const ARAC_PARCALARI = [
  { key: 'kaput', label: 'Motor Kaputu', aliases: ['motor kaputu', 'kaput', 'ön kaput'] },
  { key: 'tavan', label: 'Tavan', aliases: ['tavan'] },
  { key: 'bagaj', label: 'Bagaj Kapağı', aliases: ['bagaj kapağı', 'bagaj', 'arka kaput'] },
  { key: 'on_tampon', label: 'Ön Tampon', aliases: ['ön tampon'] },
  { key: 'arka_tampon', label: 'Arka Tampon', aliases: ['arka tampon'] },
  { key: 'sag_on_camurluk', label: 'Sağ Ön Çamurluk', aliases: ['sağ ön çamurluk'] },
  { key: 'sol_on_camurluk', label: 'Sol Ön Çamurluk', aliases: ['sol ön çamurluk'] },
  { key: 'sag_on_kapi', label: 'Sağ Ön Kapı', aliases: ['sağ ön kapı'] },
  { key: 'sol_on_kapi', label: 'Sol Ön Kapı', aliases: ['sol ön kapı'] },
  { key: 'sag_arka_kapi', label: 'Sağ Arka Kapı', aliases: ['sağ arka kapı'] },
  { key: 'sol_arka_kapi', label: 'Sol Arka Kapı', aliases: ['sol arka kapı'] },
  { key: 'sag_arka_camurluk', label: 'Sağ Arka Çamurluk', aliases: ['sağ arka çamurluk'] },
  { key: 'sol_arka_camurluk', label: 'Sol Arka Çamurluk', aliases: ['sol arka çamurluk'] }
];

export const RISK_ROZETLERI = [
  'agir_hasar', 'riskli', 'modifiye', 'airbag', 'sase_podye',
  'sel_hasarli', 'dolu_hasarli', 'taksi_cikmasi', 'cekme_belgeli',
  'km_supheli', 'motor_degismis', 'admin_kaldirdi'
];
export const UYARI_ROZETLERI = ['aciklama_uyumsuz', 'sema_teyitsiz', 'hatali_fiyat', 'hatali_km'];
export const DURUM_ROZETLERI = ['satildi', 'suresi_doldu', 'otomatik_kalkti', 'detay_eksik'];

export function normalizePartStatus(raw) {
  const s = String(raw || '').trim().toLocaleLowerCase('tr');
  if (!s || s === 'bilinmiyor' || s === 'belirtilmemiş') return 'Bilinmiyor';
  if (s.includes('değişen') || s.includes('degisen') || s === 'changed') return 'Değişen';
  if (s.includes('lokal')) return 'Lokal Boyalı';
  if (s.includes('boyalı') || s.includes('boyali') || s === 'painted') return 'Boyalı';
  if (s.includes('orijinal') || s.includes('orjinal') || s.includes('boyasız') || s === 'original') return 'Orijinal';
  return 'Bilinmiyor';
}

export const PART_NLP_PATTERNS = [
  { key: 'tavan', regex: /(?:^|[^\wçğışöü])tavan(?:da|ı|i)?(?=[^\wçğışöü]|$)/i },
  { key: 'kaput', regex: /(?:^|[^\wçğışöü])(?:motor\s*)?kaput(?:ta|u)?(?=[^\wçğışöü]|$)/i },
  { key: 'bagaj', regex: /(?:^|[^\wçğışöü])bagaj(?:\s*kapağ[ıi]|\s*kapag[ıi])?(?=[^\wçğışöü]|$)/i },
  { key: 'sag_on_camurluk', regex: /sağ\s*ön\s*çamurluk|sag\s*on\s*camurluk/i },
  { key: 'sol_on_camurluk', regex: /sol\s*ön\s*çamurluk|sol\s*on\s*camurluk/i },
  { key: 'sag_on_kapi', regex: /sağ\s*ön\s*kap[ıi]|sag\s*on\s*kap[ıi]/i },
  { key: 'sol_on_kapi', regex: /sol\s*ön\s*kap[ıi]|sol\s*on\s*kap[ıi]/i },
  { key: 'sag_arka_kapi', regex: /sağ\s*arka\s*kap[ıi]|sag\s*arka\s*kap[ıi]/i },
  { key: 'sol_arka_kapi', regex: /sol\s*arka\s*kap[ıi]|sol\s*arka\s*kap[ıi]/i },
  { key: 'sag_arka_camurluk', regex: /sağ\s*arka\s*çamurluk|sag\s*arka\s*camurluk/i },
  { key: 'sol_arka_camurluk', regex: /sol\s*arka\s*çamurluk|sol\s*arka\s*camurluk/i },
  { key: 'on_tampon', regex: /ön\s*tampon|on\s*tampon/i },
  { key: 'arka_tampon', regex: /arka\s*tampon/i }
];

export function extractVehicleSpecs(trim = '', title = '', fields = {}) {
  const norm = s => String(s || '').toLowerCase()
    .replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/ı/g, 'i')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c');
  const fullText = norm(`${trim} ${title} ${fields['Model'] || ''} ${fields['Seri'] || ''}`);

  // 1. Motor / Engine code
  let motor = '';
  const codeMatch = fullText.match(/\b([1-9]\d{2}[a-z]|c\s*\d{2,3}\s*[a-z]?|e\s*\d{2,3}\s*[a-z]?|a\s*\d{2,3}\s*[a-z]?|cla\s*\d{2,3}\s*[a-z]?|gla\s*\d{2,3}\s*[a-z]?)\b/i);
  if (codeMatch) {
    motor = codeMatch[1].replace(/\s+/g, '');
  } else {
    const techMatch = fullText.match(/\b(\d\.\d\s*(?:i-dtec|idtec|tsi|tdi|dci|tce|multijet|fire|hdi|bluehdi|cdti|ecoboost|tdci|crdi|gdi|vtec|d-4d|puretech|mpi|e-torq)?)\b/i);
    if (techMatch) motor = techMatch[1].trim();
  }

  // 2. Fuel inference
  let fuel = norm(fields['Yakıt / Motor Tipi'] || fields['Yakıt'] || '');
  if (!fuel) {
    if (/tdi|dci|multijet|hdi|bluehdi|cdti|tdci|crdi|d-4d|i-dtec|dizel|\b\d{3}d\b|\b[a-z]\d{2,3}d\b/i.test(motor + ' ' + fullText)) fuel = 'dizel';
    else if (/tsi|tce|fire|ecoboost|gdi|vtec|puretech|mpi|benzin|\b\d{3}i\b|\b[a-z]\d{2,3}\b/i.test(motor + ' ' + fullText)) fuel = 'benzin';
    else if (/hybrid|hibrit|e-hybrid|phev/i.test(fullText)) fuel = 'hibrit';
    else if (/electric|elektrik|\bev\b/i.test(fullText)) fuel = 'elektrik';
  }

  // 3. Transmission (Vites)
  let gear = norm(fields['Vites'] || '');
  if (!gear) {
    if (/\b(otomatik|dsg|edc|s-tronic|tiptronic|powershift|eat8|eat6|7g-tronic|9g-tronic|zf|cvt|steptronic|x-tronic)\b/i.test(fullText)) gear = 'otomatik';
    else if (/\b(manuel|duz vites)\b/i.test(fullText)) gear = 'manuel';
  }

  // 4. Kasa tipi
  let body = norm(fields['Kasa Tipi'] || '');
  if (!body) {
    if (/\bsedan\b/i.test(fullText)) body = 'sedan';
    else if (/\bhatchback\b|\bhb\b/i.test(fullText)) body = 'hatchback';
    else if (/\bstation\b|\bvariant\b|\bsw\b|\bcombi\b|\btourer\b/i.test(fullText)) body = 'station';
    else if (/\bcoupe\b/i.test(fullText)) body = 'coupe';
    else if (/\bcabrio\b/i.test(fullText)) body = 'cabrio';
  }

  // 5. Package keywords
  const packageKeywords = [
    'first edition m sport', 'edition m sport', 'm sport', 'sport line', 'luxury line', 'joy plus', 'joy edition', 'joy', 'comfort line', 'comfort', 'urban line', 'urban', 'first edition',
    'amg line', 'amg', 'progressive', 'exclusive', 'avantgarde', 'fascination', 'style',
    'r-line', 'elegance', 'highline', 'comfortline', 'business', 'trendline', 'impression', 'life',
    'rs line', 'gt-line', 'gt line', 'icon', 'touch plus', 'touch', 'zen',
    'lounge plus', 'lounge', 'mirror', 'cross plus', 'cross', 'street', 'easy plus', 'easy',
    'titanium plus', 'titanium', 'st-line', 'trend x', 'trend',
    'executive plus', 'executive',
    'elite plus', 'elite', 'prestige', 'prime',
    'passion x-pack', 'passion', 'flame x-pack', 'flame', 'vision plus', 'vision', 'dream',
    'gt', 'allure', 'active', 'cosmo', 'enjoy', 'edition'
  ];
  let pkg = '';
  for (const p of packageKeywords) {
    if (fullText.includes(p)) { pkg = p; break; }
  }

  return { motor, fuel, gear, body, pkg, fullText };
}

export function extractPartsFromText(text) {
  if (!text || typeof text !== 'string') return {};
  const lower = text.toLocaleLowerCase('tr');
  const extracted = {};
  const locked = new Set();

  if (/tavan\s*(?:hariç|harici|dışında|disinda)(?=[^\wçğışöü]|$)/i.test(lower)) {
    extracted['tavan'] = 'Orijinal';
    locked.add('tavan');
  }
  if (/kaput\s*(?:hariç|harici|dışında|disinda)(?=[^\wçğışöü]|$)/i.test(lower)) {
    extracted['kaput'] = 'Orijinal';
    locked.add('kaput');
  }

  const clauses = lower.split(/[\n,;•\-\/|\+]+|(?<=(?:boyalı|boyali|değişen|degisen|orijinal|orjinal|lokal))(?=[^\wçğışöü]|$)/i)
    .map(c => c.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    let status = null;
    if (/(?:değişen|degisen|değişmiş|degismis|sök\s*tak|sok\s*tak)(?=[^\wçğışöü]|$)/i.test(clause)) {
      status = 'Değişen';
    } else if (/(?:lokal\s*boya|yarım\s*boya|kordon\s*alt[ıi])/i.test(clause)) {
      status = 'Lokal Boyalı';
    } else if (/(?:boyalı|boyali|boyanm[ıi]ş|boya\s*var)/i.test(clause) && !/(?:boya\s*yok|boyasız|boyasiz)/i.test(clause)) {
      status = 'Boyalı';
    } else if (/(?:orijinal|orjinal|boyasız|boyasiz|boya\s*yok|hatasız|hatasiz)/i.test(clause)) {
      status = 'Orijinal';
    }

    if (!status) continue;

    for (const p of PART_NLP_PATTERNS) {
      if (p.regex.test(clause) && !locked.has(p.key)) {
        if (!extracted[p.key] || status !== 'Orijinal') {
          extracted[p.key] = status;
        }
      }
    }

    if (/sağ\s*(?:iki|2)\s*kap[ıi]/i.test(clause)) {
      if (!locked.has('sag_on_kapi')) extracted['sag_on_kapi'] = status;
      if (!locked.has('sag_arka_kapi')) extracted['sag_arka_kapi'] = status;
    }
    if (/sol\s*(?:iki|2)\s*kap[ıi]/i.test(clause)) {
      if (!locked.has('sol_on_kapi')) extracted['sol_on_kapi'] = status;
      if (!locked.has('sol_arka_kapi')) extracted['sol_arka_kapi'] = status;
    }
    if (/sağ\s*yan\b/i.test(clause)) {
      ['sag_on_camurluk', 'sag_on_kapi', 'sag_arka_kapi', 'sag_arka_camurluk'].forEach(k => {
        if (!locked.has(k)) extracted[k] = status;
      });
    }
    if (/sol\s*yan\b/i.test(clause)) {
      ['sol_on_camurluk', 'sol_on_kapi', 'sol_arka_kapi', 'sol_arka_camurluk'].forEach(k => {
        if (!locked.has(k)) extracted[k] = status;
      });
    }
  }

  return extracted;
}

export function boyaDegisenSayisi(item = {}) {
  const partsMap = {};
  for (const p of ARAC_PARCALARI) partsMap[p.key] = 'Bilinmiyor';

  const rawParts = item.parts ?? item.fields?.['Parça Şeması'];
  let parsedParts = rawParts;
  if (typeof rawParts === 'string' && rawParts.trim().startsWith('{')) {
    try { parsedParts = JSON.parse(rawParts); } catch {}
  }

  if (Array.isArray(parsedParts)) {
    for (const entry of parsedParts) {
      if (!entry) continue;
      const k = entry.key || entry.part || entry.id;
      const found = ARAC_PARCALARI.find(p => p.key === k || p.label.toLocaleLowerCase('tr') === String(k || '').toLocaleLowerCase('tr'));
      if (found) partsMap[found.key] = normalizePartStatus(entry.status ?? entry.state ?? entry.value);
    }
  } else if (parsedParts && typeof parsedParts === 'object') {
    for (const [k, v] of Object.entries(parsedParts)) {
      const lower = k.toLocaleLowerCase('tr');
      const found = ARAC_PARCALARI.find(p => p.key === k || p.label.toLocaleLowerCase('tr') === lower || p.aliases.includes(lower));
      if (found) partsMap[found.key] = normalizePartStatus(v);
    }
  } else if (typeof item.fields?.['Boya-değişen'] === 'string') {
    const bd = item.fields['Boya-değişen'].trim().toLocaleLowerCase('tr');
    if (bd === 'tamamı orijinal') {
      for (const p of ARAC_PARCALARI) partsMap[p.key] = 'Orijinal';
    }
  }

  const textDesc = `${item.title || ''} ${item.description || ''}`.trim();
  if (textDesc) {
    const textExtracted = extractPartsFromText(textDesc);
    for (const [k, status] of Object.entries(textExtracted)) {
      if (partsMap[k] === 'Bilinmiyor' || partsMap[k] === undefined) {
        partsMap[k] = status;
      }
    }
    const isDeclaredClean = /(?:tamam[ıi]\s*orijinal|tamam[ıi]\s*orjinal|hatasız\s*boyasız|hatasiz\s*boyasiz)/i.test(textDesc);
    const hasDamageClue = /(?:boya\s*var|değişen\s*var|lokal\s*boya|parça\s*boya|hasar\s*kayd)/i.test(textDesc);
    if (isDeclaredClean && !hasDamageClue) {
      for (const p of ARAC_PARCALARI) {
        if (partsMap[p.key] === 'Bilinmiyor') partsMap[p.key] = 'Orijinal';
      }
    }
  }

  let boyali = 0, lokalBoyali = 0, degisen = 0, knownCount = 0;
  for (const p of ARAC_PARCALARI) {
    const st = partsMap[p.key];
    if (st !== 'Bilinmiyor') knownCount++;
    if (st === 'Lokal Boyalı') { boyali++; lokalBoyali++; }
    else if (st === 'Boyalı') { boyali++; }
    else if (st === 'Değişen') { degisen++; }
  }
  const schemaComplete = knownCount === ARAC_PARCALARI.length;
  return { partsMap, boyali, lokalBoyali, degisen, knownCount, schemaComplete, statusLabel: schemaComplete ? 'Tam Şema' : (knownCount > 0 ? `${knownCount} Parça Biliniyor` : 'Bilinmiyor') };
}

export function parcaHaricIhlal(item, boyasizParcalar = [], degisensizParcalar = []) {
  const { partsMap } = boyaDegisenSayisi(item);
  for (const key of boyasizParcalar) {
    if (partsMap[key] === 'Boyalı' || partsMap[key] === 'Lokal Boyalı') return true;
  }
  for (const key of degisensizParcalar) {
    if (partsMap[key] === 'Değişen') return true;
  }
  return false;
}

export function parseTramerInfo(item = {}) {
  const raw = item.tramer_amount !== undefined ? item.tramer_amount : (item.tramer !== undefined ? item.tramer : (item.fields?.['Tramer'] ?? item.fields?.['Tramer Tutarı']));
  if (typeof raw === 'number' && Number.isFinite(raw)) return { known: true, amount: raw, label: `${new Intl.NumberFormat('tr-TR').format(raw)} TL` };
  if (typeof raw === 'string' && raw.trim()) {
    const s = raw.trim().toLocaleLowerCase('tr');
    if (!['bilinmiyor', 'belirtilmemiş', '-'].includes(s)) {
      if (s === 'yok' || s === 'hasarsız' || s === 'tramersiz' || s === '0' || s === '0 tl') return { known: true, amount: 0, label: '0 TL' };
      const num = numberTR(s);
      if (num !== null) return { known: true, amount: num, label: `${new Intl.NumberFormat('tr-TR').format(num)} TL` };
    }
  }

  const text = `${item.title || ''} ${item.description || ''}`.trim();
  if (text) {
    const lower = text.toLocaleLowerCase('tr');
    const positivePatterns = [
      /(?:tramer[a-zıiğüşöç]*|hasar\s*kayd[a-zıiğüşöç]*)[^\w\n]{0,25}?(?:tutarı|tutari|sadece|miktar[ıi])?[:\s]*([1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d{2,6})\s*(?:tl|₺)?/i,
      /([1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d{2,6})\s*(?:tl|₺)\s*(?:tramer|hasar\s*kayd)/i,
      /(?:tramer[a-zıiğüşöç]*|hasar\s*kayd[a-zıiğüşöç]*)[^\w\n]{0,25}?(?:tutarı|tutari|sadece)?[:\s]*([1-9]\d*(?:[.,]\d+)?)\s*bin\s*(?:tl|₺)?/i,
      /([1-9]\d*(?:[.,]\d+)?)\s*bin\s*(?:tl|₺)?\s*(?:tramer|hasar\s*kayd)/i
    ];

    for (const pat of positivePatterns) {
      const m = lower.match(pat);
      if (m && m[1]) {
        let numVal = numberTR(m[1]);
        if (pat.source.includes('bin') && numVal !== null) numVal = Math.round(numVal * 1000);
        if (numVal !== null && numVal > 0) {
          return { known: true, amount: numVal, label: `${new Intl.NumberFormat('tr-TR').format(numVal)} TL` };
        }
      }
    }

    const zeroPattern = /(?:^|[^\wçğışöü])(tramersiz|hasar\s*kayıtsız|hasar\s*kayitsiz|tramer\s*yok\w*|hasar\s*kayd[ıi]\s*yok\w*|sıfır\s*tramer|sifir\s*tramer|tramer\s*:\s*0\b|tramer\s+0\s*tl\b|hasar\s*kayd[ıi]\s*:\s*0\b)/i;
    if (zeroPattern.test(lower)) {
      return { known: true, amount: 0, label: '0 TL' };
    }
  }

  return { known: false, amount: null, label: 'Bilinmiyor' };
}

export function parseHeavyDamageInfo(item = {}) {
  const raw = item.heavy_damage !== undefined ? item.heavy_damage : item.fields?.['Ağır Hasar Kayıtlı'];
  if (raw === undefined || raw === null || raw === '') return { known: false, heavy: false, label: 'Bilinmiyor' };
  if (typeof raw === 'boolean') return { known: true, heavy: raw, label: raw ? 'Evet' : 'Hayır' };
  const s = String(raw).trim().toLocaleLowerCase('tr');
  if (s === 'evet' || s === 'var' || s === '1' || s === 'true') return { known: true, heavy: true, label: 'Evet' };
  if (s === 'hayır' || s === 'hayir' || s === 'yok' || s === '0' || s === 'false') return { known: true, heavy: false, label: 'Hayır' };
  return { known: false, heavy: false, label: 'Bilinmiyor' };
}

export function hasDescriptionSchemaConflict(item = {}, schema = boyaDegisenSayisi(item)) {
  const desc = `${item.title || ''} ${item.description || ''}`.toLocaleLowerCase('tr');
  if (!desc.trim()) return false;
  if (schema.schemaComplete && schema.boyali === 0 && schema.degisen === 0) {
    const cleaned = desc
      .replace(/boyasız|boyasiz|değişensiz|degisensiz|hatasız|hatasiz|boya\s*yok\w*|değişen\s*yok\w*|degisen\s*yok\w*|lokal\s*boya\s*yok\w*|boyalı\s*parça\s*yok\w*|hasar\s*kaydı\s*yok\w*|tramer\s*yok\w*/g, ' ');
    if (/(lokal\s*boya|boyalı|boyali|değişen|degisen|parça\s*boya|etek\s*alt[ıi]\s*boya|komple\s*boya|hasar\s*kayd[ıi]\s*var|tramer\s*var)/i.test(cleaned)) {
      return true;
    }
  }
  return false;
}

export function ilanRozetleri(item = {}) {
  const badges = new Set(Array.isArray(item.badges) ? item.badges : (Array.isArray(item.rozetler) ? item.rozetler : []));
  const schema = boyaDegisenSayisi(item);
  const heavy = parseHeavyDamageInfo(item);
  if (heavy.heavy) badges.add('agir_hasar');
  if (!schema.schemaComplete) badges.add('sema_teyitsiz');
  if (item.detailComplete === false) badges.add('detay_eksik');
  if (hasDescriptionSchemaConflict(item, schema)) badges.add('aciklama_uyumsuz');

  const desc = `${item.title || ''} ${item.description || ''}`.toLocaleLowerCase('tr');
  if (/(airbag\s*açm[ıi]ş|airbag\s*işlem|hava\s*yast[ıi]ğ[ıi]\s*açm[ıi]ş)/i.test(desc)) badges.add('airbag');
  if (/(şase\s*işlem|podye\s*işlem|şasede\s*işlem)/i.test(desc)) badges.add('sase_podye');
  if (/(sel\s*hasarl[ıi]|su\s*bask[ıi]n[ıi])/i.test(desc)) badges.add('sel_hasarli');
  if (/(dolu\s*hasarl[ıi]|dolu\s*göçüğü)/i.test(desc)) badges.add('dolu_hasarli');
  if (/(taksi\s*ç[ıi]kmas[ıi]|ticari\s*ç[ıi]kmas[ıi])/i.test(desc)) badges.add('taksi_cikmasi');
  if (/(çekme\s*belgeli)/i.test(desc)) badges.add('cekme_belgeli');
  if (/(km\s*düşürülmüş|kilometre\s*oynanm[ıi]ş)/i.test(desc)) badges.add('km_supheli');
  if (/(sand[ıi]k\s*motor|motor\s*değişmiş)/i.test(desc)) badges.add('motor_degismis');
  if (/(ar[ıi]zal[ıi]|masrafl[ıi]|motor\s*ar[ıi]za|şanz[ıi]man\s*ar[ıi]za)/i.test(desc)) badges.add('ariza_masraf');
  return [...badges];
}

export function ilanBilgisineGoreHatasizMi(item = {}) {
  const schema = boyaDegisenSayisi(item);
  const tramer = parseTramerInfo(item);
  const heavy = parseHeavyDamageInfo(item);
  const badges = ilanRozetleri(item);
  const reasons = [];

  if (!schema.schemaComplete) reasons.push('Parça şeması eksik (Bilinmiyor)');
  if (schema.boyali > 0) reasons.push(`${schema.boyali} boyalı/lokal boyalı parça var`);
  if (schema.degisen > 0) reasons.push(`${schema.degisen} değişen parça var`);
  if (!tramer.known) reasons.push('Tramer tutarı eksik (Bilinmiyor)');
  else if (tramer.amount !== 0) reasons.push(`Tramer pozitif (${tramer.label})`);
  if (!heavy.known) reasons.push('Ağır hasar durumu eksik (Bilinmiyor)');
  else if (heavy.heavy) reasons.push('Ağır hasar kayıtlı');
  if (badges.includes('aciklama_uyumsuz')) reasons.push('Şema ile açıklama arasında boya/hasar çelişkisi var');
  if (badges.includes('sema_teyitsiz')) reasons.push('Parça şeması teyitsiz');
  for (const r of RISK_ROZETLERI) {
    if (badges.includes(r)) reasons.push(`Risk işareti: ${r}`);
  }
  if (badges.includes('ariza_masraf')) reasons.push('Arıza/masraf işareti var');

  return {
    passed: reasons.length === 0,
    reasons,
    schema,
    tramer,
    heavy,
    badges
  };
}

const SAHIBINDEN_PART_CLASS_MAP = {
  'front-bumper': 'on_tampon',
  'front-hood': 'kaput',
  'roof': 'tavan',
  'front-right-mudguard': 'sag_on_camurluk',
  'front-right-door': 'sag_on_kapi',
  'rear-right-door': 'sag_arka_kapi',
  'rear-right-mudguard': 'sag_arka_camurluk',
  'front-left-mudguard': 'sol_on_camurluk',
  'front-left-door': 'sol_on_kapi',
  'rear-left-door': 'sol_arka_kapi',
  'rear-left-mudguard': 'sol_arka_camurluk',
  'rear-hood': 'bagaj',
  'rear-bumper': 'arka_tampon'
};

export function parseCarParts(html) {
  const parts = {};
  let foundAny = false;

  // 1. Parse visual diagram <div class="car-parts"><div class="front-right-door local-painted-new">...</div></div>
  for (const [cssPart, key] of Object.entries(SAHIBINDEN_PART_CLASS_MAP)) {
    const re = new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${cssPart}\\b([^"']*)["']`, 'i');
    const m = html.match(re);
    if (m) {
      const cls = m[0].toLowerCase();
      if (cls.includes('local-painted')) { parts[key] = 'Lokal Boyalı'; foundAny = true; }
      else if (cls.includes('painted')) { parts[key] = 'Boyalı'; foundAny = true; }
      else if (cls.includes('changed')) { parts[key] = 'Değişen'; foundAny = true; }
      else if (cls.includes('original')) { parts[key] = 'Orijinal'; foundAny = true; }
    }
  }

  // 2. Parse <div class="car-damage-info-list"><ul><li class="pair-title ...">Lokal Boyalı</li><li class="selected-damage">Sağ Ön Kapı</li></ul></div>
  const listSection = html.match(/<div\b[^>]*class=["'][^"']*car-damage-info-list[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
  if (listSection) {
    for (const ul of listSection.matchAll(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi)) {
      const ulHtml = ul[1];
      const titleLi = text(ulHtml.match(/<li\b[^>]*class=["'][^"']*pair-title[^"']*["'][^>]*>([\s\S]*?)<\/li>/i)?.[1]);
      const items = [...ulHtml.matchAll(/<li\b[^>]*class=["'][^"']*selected-damage[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)].map(m => text(m[1])).filter(Boolean);
      const st = normalizePartStatus(titleLi);
      for (const itemText of items) {
        if (/tüm parçaları orijinal|değişen ve boyalı parçası bulunmamaktadır/i.test(itemText)) {
          for (const p of ARAC_PARCALARI) if (!parts[p.key]) parts[p.key] = 'Orijinal';
          foundAny = true;
          continue;
        }
        if (st !== 'Bilinmiyor') {
          const lower = itemText.toLocaleLowerCase('tr');
          const matched = ARAC_PARCALARI.find(p => p.label.toLocaleLowerCase('tr') === lower || p.aliases.includes(lower));
          if (matched) {
            parts[matched.key] = st;
            foundAny = true;
          }
        }
      }
    }
  }

  if (!foundAny) return null;
  for (const p of ARAC_PARCALARI) {
    if (!parts[p.key]) parts[p.key] = 'Orijinal';
  }
  const groups = { 'Lokal Boyalı': [], 'Boyalı': [], 'Değişen': [] };
  for (const p of ARAC_PARCALARI) {
    const st = parts[p.key];
    if (groups[st]) groups[st].push(p.label);
  }
  return { parts, groups };
}

export function parseDetail(html,url) {
  const fields={};
  // 1. Classic & test fixture <li><span>Label</span><strong>Value</strong></li> or <li><strong>Label</strong><span>Value</span></li>
  for(const m of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const spanText=text(m[1].match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const strongText=text(m[1].match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1]);
    if(spanText && strongText && spanText.length<60 && spanText!=='?') {
      fields[spanText]=strongText;
    }
  }
  // 2. Current sahibinden.com <dl class="classifiedInfoList"><div class="classifiedInfoItem"><dt>Label</dt><dd>Value</dd></div></dl>
  for(const m of html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const label=text(m[1]);
    const value=text(m[2]);
    if(label && value && label.length<60 && label!=='?') {
      fields[label]=value;
    }
  }
  const locHtml=html.match(/<p\b[^>]*class=["'][^"']*classifiedLocation[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
  const location=locHtml?text(locHtml.replace(/<span>\s*\/\s*<\/span>/gi,' / ')):null;
  if(location && !fields['Konum']) fields['Konum']=location;

  const meta=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>m[0]);
  const og = key => attr(meta.find(m=>attr(m,'property')===key)||'','content');
  const title=text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1])||og('og:title');

  let parsedPrice = null;
  const favInput = [...html.matchAll(/<input\b[^>]*>/gi)].map(m => m[0]).find(tag => attr(tag, 'id') === 'favoriteClassifiedPrice');
  if (favInput) {
    const val = attr(favInput, 'value');
    const tlMatch = val.match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*(?:TL|₺)?/i);
    if (tlMatch) parsedPrice = numberTR(tlMatch[1]);
  }
  if (parsedPrice == null) {
    const priceBlock =
      html.match(/<span\b[^>]*class=["'][^"']*classified-price-wrapper[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
      html.match(/<h3\b[^>]*class=["'][^"']*classifiedPriceValue[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] ||
      html.match(/<div\b[^>]*class=["'][^"']*classifiedInfo\b[^"']*["'][^>]*>[\s\S]*?<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '';
    if (priceBlock) {
      const m = text(priceBlock).match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*(?:TL|₺)/i);
      if (m) parsedPrice = numberTR(m[1]);
    }
  }
  if (parsedPrice == null) {
    const htmlWithoutDesc = html.replace(/<div\b[^>]*id=["']classifiedDescription["'][^>]*>[\s\S]*?<\/div>/gi, '');
    for(const h3 of htmlWithoutDesc.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) {
      const t = text(h3[1]);
      const m = t.match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*(?:TL|₺)/i);
      if(m) { parsedPrice = numberTR(m[1]); break; }
    }
  }
  const description=text(html.match(/<div\b[^>]*id=["']classifiedDescription["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);
  const carPartsInfo = parseCarParts(html);
  if (carPartsInfo) {
    fields['Parça Şeması'] = JSON.stringify(carPartsInfo.parts);
    if (carPartsInfo.groups['Lokal Boyalı'].length) fields['Lokal Boyalı'] = carPartsInfo.groups['Lokal Boyalı'].join(', ');
    if (carPartsInfo.groups['Boyalı'].length) fields['Boyalı'] = carPartsInfo.groups['Boyalı'].join(', ');
    if (carPartsInfo.groups['Değişen'].length) fields['Değişen'] = carPartsInfo.groups['Değişen'].join(', ');
  }
  const get = (...names)=>names.map(n=>fields[n]).find(Boolean)||null;
  const brand=get('Marka'), model=get('Seri'), year=numberTR(get('Yıl')), km=numberTR(get('KM','Kilometre'));
  if(!title || !Object.keys(fields).length) return null;
  return {
    id:url.match(/-(\d+)\/detay/)?.[1]||url.match(/\/(\d+)(?:\/detay|\?|$)/)?.[1]||get('İlan No'),
    url,
    title,
    price:parsedPrice,
    brand,
    model,
    trim:get('Model'),
    year,
    km,
    gear:get('Vites'),
    fuel:get('Yakıt Tipi','Yakıt / Motor Tipi','Yakıt'),
    body:get('Kasa Tipi'),
    seller:get('Kimden'),
    color:get('Renk'),
    location,
    image:og('og:image'),
    description,
    parts:carPartsInfo?.parts || null,
    damageGroups:carPartsInfo?.groups || null,
    fields
  };
}
