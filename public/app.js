const uiIcon=name=>'<svg class="ui-icon" aria-hidden="true"><use href="/assets/ui-icons.svg#icon-'+name+'"></use></svg>';
const badgeNames={agir_hasar:'Ağır hasar',riskli:'Riskli ilan',modifiye:'Modifiye',airbag:'Airbag işlemi',sase_podye:'Şase / podye',sel_hasarli:'Sel hasarı',dolu_hasarli:'Dolu hasarı',taksi_cikmasi:'Taksi çıkması',cekme_belgeli:'Çekme belgeli',km_supheli:'Kilometre şüphesi',motor_degismis:'Motor değişimi',admin_kaldirdi:'Kaldırılmış ilan',ariza_masraf:'Arıza / masraf',aciklama_uyumsuz:'Açıklama tutarsız',sema_teyitsiz:'Şema teyitsiz',hatali_fiyat:'Fiyat kontrolü gerekli',hatali_km:'Kilometre kontrolü gerekli',satildi:'Satıldı',suresi_doldu:'Süresi doldu',otomatik_kalkti:'Yayından kalktı',detay_eksik:'Detay bilgisi eksik'};
let filterReturnFocus=null;
let sourceFilterAuto=localStorage.getItem('arac_radar_filter_auto')!=='false',sourceFilterApplied=null;
let sourceCategoryRequest=0,sourceCategoryKey='',sourceCategoryData=null,sourceCountsTimer,sourceCountsKey='';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let state=null,view='listings',page=1,pageSize=48,freshMode='all',liveTab='all',treeTrim='',conditionMode='standard',selected=new Set(),toastTimer,livePulseTimer=null,activeRefreshId=null,listingViewMode=localStorage.getItem('arac_radar_view_mode')||'grid';
const money=n=>n==null?'Fiyat okunmadı':new Intl.NumberFormat('tr-TR',{maximumFractionDigits:0}).format(n)+' TL';
const num=n=>new Intl.NumberFormat('tr-TR').format(n||0);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=n=>n?new Intl.DateTimeFormat('tr-TR',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Istanbul'}).format(n):'Henüz yok';
const ago=n=>!n?'Kontrol bekliyor':Date.now()-n<60000?'Az önce':`${Math.floor((Date.now()-n)/60000)} dk önce`;
const labels={listings:'İlanlar',live:'Canlı akış',opportunities:'Fırsatlar',favorites:'Favorilerim',valuation:'Araç değerle',system:'Tarama merkezi'};
const phases={ready:'Hazır',waiting:'İstek aralığı bekleniyor',connected:'Kaynak tarayıcısı hazır',baselining:'İlk tarama',live:'Yeni ilan kontrolü açık',checking:'Yeni ilanlar kontrol ediliyor',auth_required:'Kaynak girişsiz erişime kapalı',access_blocked:'Kaynak erişimi reddetti',rate_limited:'Kaynak bekletiyor',paused:'Duraklatıldı',source_error:'Bağlantı kontrolü gerekli'};

const ARAC_PARCALARI=[
  {key:'kaput',label:'Motor Kaputu'},
  {key:'tavan',label:'Tavan'},
  {key:'bagaj',label:'Bagaj Kapağı'},
  {key:'on_tampon',label:'Ön Tampon'},
  {key:'arka_tampon',label:'Arka Tampon'},
  {key:'sag_on_camurluk',label:'Sağ Ön Çamurluk'},
  {key:'sol_on_camurluk',label:'Sol Ön Çamurluk'},
  {key:'sag_on_kapi',label:'Sağ Ön Kapı'},
  {key:'sol_on_kapi',label:'Sol Ön Kapı'},
  {key:'sag_arka_kapi',label:'Sağ Arka Kapı'},
  {key:'sol_arka_kapi',label:'Sol Arka Kapı'},
  {key:'sag_arka_camurluk',label:'Sağ Arka Çamurluk'},
  {key:'sol_arka_camurluk',label:'Sol Arka Çamurluk'}
];

const RISK_ROZETLERI=['agir_hasar','riskli','modifiye','airbag','sase_podye','sel_hasarli','dolu_hasarli','taksi_cikmasi','cekme_belgeli','km_supheli','motor_degismis','admin_kaldirdi'];
const UYARI_ROZETLERI=['aciklama_uyumsuz','sema_teyitsiz','hatali_fiyat','hatali_km'];
const DURUM_ROZETLERI=['satildi','suresi_doldu','otomatik_kalkti','detay_eksik'];
const TUM_ROZETLER=[
  ...RISK_ROZETLERI.map(k=>({key:k,group:'Risk'})),
  {key:'ariza_masraf',group:'Arıza'},
  ...UYARI_ROZETLERI.map(k=>({key:k,group:'Uyarı'})),
  ...DURUM_ROZETLERI.map(k=>({key:k,group:'Durum'}))
];

function normalizePartStatus(raw){
  const s=String(raw||'').trim().toLocaleLowerCase('tr');
  if(!s||s==='bilinmiyor'||s==='belirtilmemiş')return 'Bilinmiyor';
  if(s.includes('değişen')||s.includes('degisen')||s==='changed')return 'Değişen';
  if(s.includes('lokal'))return 'Lokal Boyalı';
  if(s.includes('boyalı')||s.includes('boyali')||s==='painted')return 'Boyalı';
  if(s.includes('orijinal')||s.includes('orjinal')||s.includes('boyasız')||s==='original')return 'Orijinal';
  return 'Bilinmiyor';
}

const PART_NLP_PATTERNS = [
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

function extractPartsFromText(text) {
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

function extractVehicleSpecs(trim = '', title = '', fields = {}) {
  const norm = s => String(s || '').toLowerCase()
    .replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/ı/g, 'i')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c');
  const fullText = norm(`${trim} ${title} ${fields['Model'] || ''} ${fields['Seri'] || ''}`);

  let motor = '';
  const codeMatch = fullText.match(/\b([1-9]\d{2}[a-z]|c\s*\d{2,3}\s*[a-z]?|e\s*\d{2,3}\s*[a-z]?|a\s*\d{2,3}\s*[a-z]?|cla\s*\d{2,3}\s*[a-z]?|gla\s*\d{2,3}\s*[a-z]?)\b/i);
  if (codeMatch) {
    motor = codeMatch[1].replace(/\s+/g, '');
  } else {
    const techMatch = fullText.match(/\b(\d\.\d\s*(?:i-dtec|idtec|tsi|tdi|dci|tce|multijet|fire|hdi|bluehdi|cdti|ecoboost|tdci|crdi|gdi|vtec|d-4d|puretech|mpi|e-torq)?)\b/i);
    if (techMatch) motor = techMatch[1].trim();
  }

  let fuel = norm(fields['Yakıt / Motor Tipi'] || fields['Yakıt'] || '');
  if (!fuel) {
    if (/tdi|dci|multijet|hdi|bluehdi|cdti|tdci|crdi|d-4d|i-dtec|dizel|\b\d{3}d\b|\b[a-z]\d{2,3}d\b/i.test(motor + ' ' + fullText)) fuel = 'dizel';
    else if (/tsi|tce|fire|ecoboost|gdi|vtec|puretech|mpi|benzin|\b\d{3}i\b|\b[a-z]\d{2,3}\b/i.test(motor + ' ' + fullText)) fuel = 'benzin';
    else if (/hybrid|hibrit|e-hybrid|phev/i.test(fullText)) fuel = 'hibrit';
    else if (/electric|elektrik|\bev\b/i.test(fullText)) fuel = 'elektrik';
  }

  let gear = norm(fields['Vites'] || '');
  if (!gear) {
    if (/\b(otomatik|dsg|edc|s-tronic|tiptronic|powershift|eat8|eat6|7g-tronic|9g-tronic|zf|cvt|steptronic|x-tronic)\b/i.test(fullText)) gear = 'otomatik';
    else if (/\b(manuel|duz vites)\b/i.test(fullText)) gear = 'manuel';
  }

  let body = norm(fields['Kasa Tipi'] || '');
  if (!body) {
    if (/\bsedan\b/i.test(fullText)) body = 'sedan';
    else if (/\bhatchback\b|\bhb\b/i.test(fullText)) body = 'hatchback';
    else if (/\bstation\b|\bvariant\b|\bsw\b|\bcombi\b|\btourer\b/i.test(fullText)) body = 'station';
    else if (/\bcoupe\b/i.test(fullText)) body = 'coupe';
    else if (/\bcabrio\b/i.test(fullText)) body = 'cabrio';
  }

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

function boyaDegisenSayisi(item={}){
  const partsMap={};
  for(const p of ARAC_PARCALARI)partsMap[p.key]='Bilinmiyor';
  const rawParts=item.parts??item.fields?.['Parça Şeması'];
  let parsedParts=rawParts;
  if(typeof rawParts==='string'&&rawParts.trim().startsWith('{')){
    try{parsedParts=JSON.parse(rawParts);}catch{}
  }
  if(Array.isArray(parsedParts)){
    for(const entry of parsedParts){
      if(!entry)continue;
      const k=entry.key||entry.part||entry.id;
      const found=ARAC_PARCALARI.find(p=>p.key===k||p.label.toLocaleLowerCase('tr')===String(k||'').toLocaleLowerCase('tr'));
      if(found)partsMap[found.key]=normalizePartStatus(entry.status??entry.state??entry.value);
    }
  }else if(parsedParts&&typeof parsedParts==='object'){
    for(const [k,v] of Object.entries(parsedParts)){
      const lower=k.toLocaleLowerCase('tr');
      const found=ARAC_PARCALARI.find(p=>p.key===k||p.label.toLocaleLowerCase('tr')===lower);
      if(found)partsMap[found.key]=normalizePartStatus(v);
    }
  }else if(typeof item.fields?.['Boya-değişen']==='string'){
    const bd=item.fields['Boya-değişen'].trim().toLocaleLowerCase('tr');
    if(bd==='tamamı orijinal'){
      for(const p of ARAC_PARCALARI)partsMap[p.key]='Orijinal';
    }
  }

  const textDesc=`${item.title||''} ${item.description||''}`.trim();
  if(textDesc){
    const textExtracted=extractPartsFromText(textDesc);
    for(const [k, status] of Object.entries(textExtracted)){
      if(partsMap[k]==='Bilinmiyor'||partsMap[k]===undefined){
        partsMap[k]=status;
      }
    }
    const isDeclaredClean=/(?:tamam[ıi]\s*orijinal|tamam[ıi]\s*orjinal|hatasız\s*boyasız|hatasiz\s*boyasiz)/i.test(textDesc);
    const hasDamageClue=/(?:boya\s*var|değişen\s*var|lokal\s*boya|parça\s*boya|hasar\s*kayd)/i.test(textDesc);
    if(isDeclaredClean&&!hasDamageClue){
      for(const p of ARAC_PARCALARI){
        if(partsMap[p.key]==='Bilinmiyor')partsMap[p.key]='Orijinal';
      }
    }
  }

  let boyali=0,lokalBoyali=0,degisen=0,knownCount=0;
  for(const p of ARAC_PARCALARI){
    const st=partsMap[p.key];
    if(st!=='Bilinmiyor')knownCount++;
    if(st==='Lokal Boyalı'){boyali++;lokalBoyali++;}
    else if(st==='Boyalı'){boyali++;}
    else if(st==='Değişen'){degisen++;}
  }
  const schemaComplete=knownCount===ARAC_PARCALARI.length;
  return {partsMap,boyali,lokalBoyali,degisen,knownCount,schemaComplete,statusLabel:schemaComplete?`${boyali} Boyalı / ${degisen} Değişen`:knownCount>0?`${boyali} Boya / ${degisen} Değişen (${knownCount} parça)`:'Bilinmiyor'};
}

function parcaHaricIhlal(item,boyasizParcalar=[],degisensizParcalar=[]){
  const {partsMap}=boyaDegisenSayisi(item);
  for(const key of boyasizParcalar){
    const st=partsMap[key];
    if(st==='Boyalı'||st==='Lokal Boyalı')return true;
  }
  for(const key of degisensizParcalar){
    const st=partsMap[key];
    if(st==='Değişen')return true;
  }
  return false;
}

function parseTramerInfo(item={}){
  const raw=item.tramer_amount!==undefined?item.tramer_amount:(item.tramer!==undefined?item.tramer:(item.fields?.['Tramer']??item.fields?.['Tramer Tutarı']));
  if(typeof raw==='number'&&Number.isFinite(raw))return {known:true,amount:raw,label:`${num(raw)} TL`};
  if(typeof raw==='string'&&raw.trim()){
    const s=raw.trim().toLocaleLowerCase('tr');
    if(!['bilinmiyor','belirtilmemiş','-'].includes(s)){
      if(s==='yok'||s==='hasarsız'||s==='tramersiz'||s==='0'||s==='0 tl'){
        return {known:true,amount:0,label:'0 TL'};
      }
      const digits=s.replace(/[^\d,.]/g,'').replace(/\./g,'').replace(',','.');
      const n=Number(digits);
      if(digits&&Number.isFinite(n)){
        return {known:true,amount:n,label:`${num(n)} TL`};
      }
    }
  }

  const text=`${item.title||''} ${item.description||''}`.trim();
  if(text){
    const lower=text.toLocaleLowerCase('tr');
    const positivePatterns = [
      /(?:tramer[a-zıiğüşöç]*|hasar\s*kayd[a-zıiğüşöç]*)[^\w\n]{0,25}?(?:tutarı|tutari|sadece|miktar[ıi])?[:\s]*([1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d{2,6})\s*(?:tl|₺)?/i,
      /([1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d{2,6})\s*(?:tl|₺)\s*(?:tramer|hasar\s*kayd)/i,
      /(?:tramer[a-zıiğüşöç]*|hasar\s*kayd[a-zıiğüşöç]*)[^\w\n]{0,25}?(?:tutarı|tutari|sadece)?[:\s]*([1-9]\d*(?:[.,]\d+)?)\s*bin\s*(?:tl|₺)?/i,
      /([1-9]\d*(?:[.,]\d+)?)\s*bin\s*(?:tl|₺)?\s*(?:tramer|hasar\s*kayd)/i
    ];

    for(const pat of positivePatterns){
      const m=lower.match(pat);
      if(m&&m[1]){
        const rawVal=m[1].replace(/\./g,'').replace(',','.');
        let numVal=Number(rawVal);
        if(pat.source.includes('bin')) numVal=Math.round(numVal*1000);
        if(Number.isFinite(numVal)&&numVal>0){
          return {known:true,amount:numVal,label:`${num(numVal)} TL`};
        }
      }
    }

    const zeroPattern = /(?:^|[^\wçğışöü])(tramersiz|hasar\s*kayıtsız|hasar\s*kayitsiz|tramer\s*yok\w*|hasar\s*kayd[ıi]\s*yok\w*|sıfır\s*tramer|sifir\s*tramer|tramer\s*:\s*0\b|tramer\s+0\s*tl\b|hasar\s*kayd[ıi]\s*:\s*0\b)/i;
    if(zeroPattern.test(lower)){
      return {known:true,amount:0,label:'0 TL'};
    }
  }

  return {known:false,amount:null,label:'Bilinmiyor'};
}

function parseHeavyDamageInfo(item={}){
  const raw=item.heavy_damage!==undefined?item.heavy_damage:item.fields?.['Ağır Hasar Kayıtlı'];
  if(raw===undefined||raw===null||raw==='')return {known:false,heavy:false,label:'Bilinmiyor'};
  if(typeof raw==='boolean')return {known:true,heavy:raw,label:raw?'Evet':'Hayır'};
  const s=String(raw).trim().toLocaleLowerCase('tr');
  if(s==='evet'||s==='var'||s==='1'||s==='true')return {known:true,heavy:true,label:'Evet'};
  if(s==='hayır'||s==='hayir'||s==='yok'||s==='0'||s==='false')return {known:true,heavy:false,label:'Hayır'};
  return {known:false,heavy:false,label:'Bilinmiyor'};
}

function hasDescriptionSchemaConflict(item={},schema=boyaDegisenSayisi(item)){
  const desc=`${item.title||''} ${item.description||''}`.toLocaleLowerCase('tr');
  if(!desc.trim())return false;
  if(schema.schemaComplete&&schema.boyali===0&&schema.degisen===0){
    const cleaned=desc.replace(/boyasız|boyasiz|değişensiz|degisensiz|hatasız|hatasiz|boya\s*yok\w*|değişen\s*yok\w*|degisen\s*yok\w*|lokal\s*boya\s*yok\w*|boyalı\s*parça\s*yok\w*|hasar\s*kaydı\s*yok\w*|tramer\s*yok\w*/g,' ');
    if(/(lokal\s*boya|boyalı|boyali|değişen|degisen|parça\s*boya|etek\s*alt[ıi]\s*boya|komple\s*boya|hasar\s*kayd[ıi]\s*var|tramer\s*var)/i.test(cleaned)){
      return true;
    }
  }
  return false;
}

function ilanRozetleri(item={}){
  const badges=new Set(Array.isArray(item.badges)?item.badges:(Array.isArray(item.rozetler)?item.rozetler:[]));
  const schema=boyaDegisenSayisi(item);
  const heavy=parseHeavyDamageInfo(item);
  if(heavy.heavy)badges.add('agir_hasar');
  if(!schema.schemaComplete)badges.add('sema_teyitsiz');
  if(item.detailComplete===false)badges.add('detay_eksik');
  if(hasDescriptionSchemaConflict(item,schema))badges.add('aciklama_uyumsuz');
  const desc=`${item.title||''} ${item.description||''}`.toLocaleLowerCase('tr');
  if(/(airbag\s*açm[ıi]ş|airbag\s*işlem|hava\s*yast[ıi]ğ[ıi]\s*açm[ıi]ş)/i.test(desc))badges.add('airbag');
  if(/(şase\s*işlem|podye\s*işlem|şasede\s*işlem)/i.test(desc))badges.add('sase_podye');
  if(/(sel\s*hasarl[ıi]|su\s*bask[ıi]n[ıi])/i.test(desc))badges.add('sel_hasarli');
  if(/(dolu\s*hasarl[ıi]|dolu\s*göçüğü)/i.test(desc))badges.add('dolu_hasarli');
  if(/(taksi\s*ç[ıi]kmas[ıi]|ticari\s*ç[ıi]kmas[ıi])/i.test(desc))badges.add('taksi_cikmasi');
  if(/(çekme\s*belgeli)/i.test(desc))badges.add('cekme_belgeli');
  if(/(km\s*düşürülmüş|kilometre\s*oynanm[ıi]ş)/i.test(desc))badges.add('km_supheli');
  if(/(sand[ıi]k\s*motor|motor\s*değişmiş)/i.test(desc))badges.add('motor_degismis');
  if(/(ar[ıi]zal[ıi]|masrafl[ıi]|motor\s*ar[ıi]za|şanz[ıi]man\s*ar[ıi]za)/i.test(desc))badges.add('ariza_masraf');
  return [...badges];
}

function ilanBilgisineGoreHatasizMi(item={}){
  const schema=boyaDegisenSayisi(item);
  const tramer=parseTramerInfo(item);
  const heavy=parseHeavyDamageInfo(item);
  const badges=ilanRozetleri(item);
  const reasons=[];
  if(!schema.schemaComplete)reasons.push('Parça şeması eksik (Bilinmiyor)');
  if(schema.boyali>0)reasons.push(`${schema.boyali} boyalı/lokal boyalı parça var`);
  if(schema.degisen>0)reasons.push(`${schema.degisen} değişen parça var`);
  if(!tramer.known)reasons.push('Tramer tutarı eksik (Bilinmiyor)');
  else if(tramer.amount!==0)reasons.push(`Tramer pozitif (${tramer.label})`);
  if(!heavy.known)reasons.push('Ağır hasar durumu eksik (Bilinmiyor)');
  else if(heavy.heavy)reasons.push('Ağır hasar kayıtlı');
  if(badges.includes('aciklama_uyumsuz'))reasons.push('Şema ile açıklama arasında boya/hasar çelişkisi var');
  if(badges.includes('sema_teyitsiz'))reasons.push('Parça şeması teyitsiz');
  for(const r of RISK_ROZETLERI){if(badges.includes(r))reasons.push(`Risk işareti: ${r}`);}
  if(badges.includes('ariza_masraf'))reasons.push('Arıza/masraf işareti var');
  return {passed:reasons.length===0,reasons,schema,tramer,heavy,badges};
}

const kondisyonAnalizCache=new Map();

function aracKondisyonAnalizi(item={}){
  const schema=boyaDegisenSayisi(item);
  const tramer=parseTramerInfo(item);
  const heavy=parseHeavyDamageInfo(item);
  const badges=ilanRozetleri(item);
  
  const text=`${item.title||''} ${item.description||''} ${typeof item.fields?.['Boya-değişen']==='string'?item.fields['Boya-değişen']:''}`.toLocaleLowerCase('tr');

  const hasHeavyDamageText=/(ağır\s*hasar|agir\s*hasar|pert\s*kayd|çekme\s*belgeli|\bpert\b)/i.test(text);
  const hasRiskText=/(airbag\s*aç|hava\s*yast[ıi]ğ[ıi]\s*aç|şase\s*işlem|podye\s*işlem|sel\s*hasar|su\s*bask)/i.test(text);
  const isHeavy=heavy.heavy||hasHeavyDamageText;

  const noPaintPhrases=/(hatasız\s*boyasız|hatasiz\s*boyasiz|boyasız|boyasiz|boya\s*yok|boyalı\s*parça\s*yok|tamam[ıi]\s*orijinal|tamam[ıi]\s*orjinal|çizik\s*boyasız|hatasız|hatasiz)/gi;
  const cleanedForPaint=text.replace(noPaintPhrases,' ');
  const hasPaintDisqualifier=/(lokal\s*boya|parça\s*boya|\d+\s*boya|bel\s*alt[ıi]\s*boya|etek\s*alt[ıi]\s*boya|temizlik\s*boyas|tavan\s*boya|kaput\s*boya|boyalı|boyali|boyanm[ıi]ş)/i.test(cleanedForPaint);

  let isPaintless=false;
  if(schema.schemaComplete){
    isPaintless=(schema.boyali===0);
  }else if(schema.boyali>0){
    isPaintless=false;
  }else{
    const declaresPaintless=/(boyasız|boyasiz|boya\s*yok|tamam[ıi]\s*orijinal|tamam[ıi]\s*orjinal)/i.test(text);
    isPaintless=declaresPaintless&&!hasPaintDisqualifier;
  }

  const noChangePhrases=/(değişensiz|degisensiz|değişen\s*yok|degisen\s*yok|değişen\s*parça\s*yok)/gi;
  const cleanedForChange=text.replace(noChangePhrases,' ');
  const hasChangeDisqualifier=/(değişen|degisen|değişmiş|degismis|\d+\s*parça\s*değişen)/i.test(cleanedForChange);

  let isChangeless=false;
  if(schema.schemaComplete){
    isChangeless=(schema.degisen===0);
  }else if(schema.degisen>0){
    isChangeless=false;
  }else{
    const declaresChangeless=/(değişensiz|degisensiz|değişen\s*yok|degisen\s*yok|tamam[ıi]\s*orijinal|tamam[ıi]\s*orjinal)/i.test(text);
    isChangeless=declaresChangeless&&!hasChangeDisqualifier;
  }

  const noTramerPhrases=/(tramersiz|hasar\s*kayıtsız|hasar\s*kayitsiz|tramer\s*yok|hasar\s*kayd[ıi]\s*yok|sıfır\s*tramer|sifir\s*tramer)/gi;
  const cleanedForTramer=text.replace(noTramerPhrases,' ');
  const hasTramerDisqualifier=/(tramer\s*:\s*[1-9]|tramer\s*[1-9]|hasar\s*kayd[ıi]\s*:\s*[1-9]|hasar\s*kayd[ıi]\s*[1-9]|\d+\s*(?:tl|bin|bintl)\s*tramer|\d+\s*(?:tl|bin|bintl)\s*hasar\s*kayd)/i.test(cleanedForTramer);

  let isZeroTramer=false;
  if(tramer.known){
    isZeroTramer=(tramer.amount===0);
  }else{
    const declaresZeroTramer=/(tramersiz|hasar\s*kayıtsız|hasar\s*kayitsiz|tramer\s*yok|hasar\s*kayd[ıi]\s*yok|sıfır\s*tramer|sifir\s*tramer)/i.test(text);
    isZeroTramer=declaresZeroTramer&&!hasTramerDisqualifier;
  }

  const hasExceptionClause=/(hariç|harici|dışında|disinda)\s*hatasız|(hariç|harici|dışında|disinda)\s*hatasiz/i.test(text);
  let isHatasiz=false;
  if(schema.schemaComplete){
    isHatasiz=(schema.boyali===0&&schema.degisen===0&&!isHeavy&&!hasRiskText&&(tramer.amount===0||(!tramer.known&&!hasTramerDisqualifier)));
  }else{
    const declaresHatasiz=/(hatasız|hatasiz|kusursuz|nokta\s*hata)/i.test(text);
    const hasAnyDamageClue=hasPaintDisqualifier||hasChangeDisqualifier||hasTramerDisqualifier||isHeavy||hasRiskText||hasExceptionClause;
    if((declaresHatasiz&&!hasAnyDamageClue)||(isPaintless&&isChangeless&&!hasAnyDamageClue)){
      isHatasiz=true;
    }
  }

  if(isHatasiz&&!hasChangeDisqualifier)isChangeless=true;

  return {isHatasiz,isPaintless,isChangeless,isZeroTramer,isHeavy,hasPaintDisqualifier,hasChangeDisqualifier,schema,tramer,heavy,badges};
}

function getAracKondisyon(item={}){
  if(item.id&&kondisyonAnalizCache.has(item.id))return kondisyonAnalizCache.get(item.id);
  const res=aracKondisyonAnalizi(item);
  if(item.id)kondisyonAnalizCache.set(item.id,res);
  return res;
}

function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,6500);}
async function api(path,body){const r=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error||'İşlem tamamlanamadı.');return data;}

function rozetKayitOku(){try{return JSON.parse(localStorage.getItem('arac_radar_rozet_filtre')||'{}');}catch{return {};}}
function rozetKayitYaz(obj){try{localStorage.setItem('arac_radar_rozet_filtre',JSON.stringify(obj));}catch{}}
function dgkOku(){try{return JSON.parse(localStorage.getItem('arac_radar_dgk_gecmis')||'[]');}catch{return [];}}
function dgkYaz(entry){try{const list=[entry,...dgkOku().filter(x=>x.key!==entry.key)].slice(0,50);localStorage.setItem('arac_radar_dgk_gecmis',JSON.stringify(list));renderValuationHistory();}catch{}}

let refreshInFlight=false,pendingRefresh=false;
async function fastBootstrap(){
  try{
    const pulse=await api('/api/live/pulse');
    if(!state){
      if($('#totalStat'))$('#totalStat').textContent=num(pulse.totalListings);
      if($('#freshStat'))$('#freshStat').textContent=num(pulse.todayNewCount);
      if($('#changesStat'))$('#changesStat').textContent=num(pulse.priceDropCount);
      if($('#navCount'))$('#navCount').textContent=num(pulse.totalListings);
      if($('#connectionText'))$('#connectionText').textContent='Bağlantı kuruldu';
      if($('#bannerTitle'))$('#bannerTitle').textContent='Gerçek İlanlar Hazır';
      if($('#bannerMessage'))$('#bannerMessage').textContent=`Yerel veritabanında ${num(pulse.totalListings)} ilan hazır, listeleniyor...`;
      if($('#stTotalListings'))$('#stTotalListings').textContent=num(pulse.totalListings)+' İLAN';
      if($('#stBotStatus'))$('#stBotStatus').textContent=pulse.crawlerState==='paused'?'CANLI BOT: DURAKLATILDI':'CANLI BOT: AKTİF';
    }
  }catch{}
}

async function refresh(){
  if(refreshInFlight){
    pendingRefresh=true;
    return;
  }
  refreshInFlight=true;
  try{
    if(state && state.lastSync){
      const delta = await api('/api/state/delta?since=' + state.lastSync);
      if(delta && delta.delta){
        state.lastSync = delta.timestamp;
        state.source = delta.source;
        state.jobs = delta.jobs;
        if(delta.events && delta.events.length){
          const existingIds = new Set(state.events.map(e => e.id));
          const newEvents = delta.events.filter(e => !existingIds.has(e.id));
          state.events = [...newEvents, ...state.events].slice(0, 80);
        }
        let listChanged = false;
        if(delta.newOrUpdated && delta.newOrUpdated.length){
          const map = new Map(state.listings.map((item, idx) => [item.id, idx]));
          const toAdd = [];
          for(const item of delta.newOrUpdated){
            const idx = map.get(item.id);
            if(idx !== undefined){
              state.listings[idx] = { ...state.listings[idx], ...item };
            } else {
              toAdd.push(item);
            }
          }
          if(toAdd.length){
            state.listings = [...toAdd, ...state.listings];
          }
          for(const item of delta.newOrUpdated){
            if(item.id){
              emsalCache.delete(item.id);
              kondisyonCache.delete(item.id);
              kondisyonAnalizCache.delete(item.id);
            }
          }
          brandModelIndex = null;
          updateSelectors(true);
          listChanged = true;
        }
        $('#connectionText').textContent='Bağlantı açık';
        $('#serverDot').classList.remove('disconnected');
        render(listChanged);
        return;
      }
    }
    state=await api('/api/state');
    state.lastSync = state.timestamp || Date.now();
    emsalCache.clear();
    kondisyonCache.clear();
    kondisyonAnalizCache.clear();
    brandModelIndex = null;
    updateSelectors(true);
    $('#connectionText').textContent='Bağlantı açık';
    $('#serverDot').classList.remove('disconnected');
    render(true);
    if(state && state.hasMore){
      setTimeout(loadFullArchive, 250);
    }
  }catch{
    if(!state){
      $('#connectionText').textContent='Sunucu bağlantısı kesildi';
      $('#bannerTitle').textContent='Yerel sunucuya ulaşılamıyor';
      $('#bannerMessage').textContent='Sunucuyu Baslat.cmd ile yeniden açabilirsin.';
    }
  }finally{
    refreshInFlight=false;
    if(pendingRefresh){
      pendingRefresh=false;
      setTimeout(refresh,2000);
    }
  }
}

let fullArchiveLoading = false;
async function loadFullArchive(){
  if(fullArchiveLoading || !state || !state.hasMore) return;
  fullArchiveLoading = true;
  try{
    const fullData = await api('/api/state?all=true');
    if(fullData && fullData.listings && fullData.listings.length > (state?.listings?.length || 0)){
      state.listings = fullData.listings;
      state.hasMore = false;
      brandModelIndex = null;
      updateSelectors(true);
      render(true);
    }
  }catch{}finally{
    fullArchiveLoading = false;
  }
}

async function canliHepsiniTazele(){
  try{
    const pulse=await api('/api/live/pulse');
    if($('#livePulseInfo')){
      $('#livePulseInfo').textContent=`Canlı ekran yoklaması: ${pulse.uiPollSeconds||30} sn · Bugün yeni: ${num(pulse.todayNewCount)} · Fiyat düşüşü: ${num(pulse.priceDropCount)}`;
    }
    await refresh();
  }catch{}
}

function _canliNabizDonguYonet(){
  clearInterval(livePulseTimer);
  livePulseTimer=null;
  if(view==='live'){
    void canliHepsiniTazele();
    livePulseTimer=setInterval(canliHepsiniTazele,30000);
  }
}

let lastVisibilitySync=0;
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){
    const now=Date.now();
    if(now - lastVisibilitySync > 15000 && state && (now - (state.lastSync || 0) > 15000)){
      lastVisibilitySync=now;
      void refresh();
    }
    if(view==='live')void canliHepsiniTazele();
  }
});

function switchView(next){
  if(view===next)return;
  view=next;page=1;document.body.dataset.view=next;
  if(!$('#advancedFilters').hidden)setFilterSheetOpen(false);
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('#breadcrumb').textContent=labels[view];
  const titles={listings:'Aradığın araç burada.',live:'Piyasadaki son hareketler.',opportunities:'Fırsatları yakından incele.',favorites:'Aklındaki araçlar, bir arada.',valuation:'Piyasanın fiyat seviyesini gör.',system:'Taramanın durumunu gör.'};
  $('#pageTitle').textContent=titles[view];
  const subtitle={system:'Gerçek kaynak bağlantısı, ilk tarama ve güncelleme kuyruğu.',live:'Yeni ilanları ve fiyatı düşen araçları tek yerden takip et.',opportunities:'Benzer ilanlara göre avantajlı fiyatları keşfet.',valuation:'Araç özelliklerini seç, benzer ilanlarla fiyat seviyesini karşılaştır.'};
  $('#pageSubtitle').textContent=subtitle[view]||'İlanları keşfet, emsalleri karşılaştır, sana uygun aracı bul.';
  $$('.view-section').forEach(el=>el.hidden=true);
  if($('#monthOppTab'))$('#monthOppTab').hidden=view!=='opportunities';
  if($('#oppThresholdWrap'))$('#oppThresholdWrap').hidden=view!=='opportunities';
  if(view==='opportunities'&&$('#sortSelect').value==='new')$('#sortSelect').value='oppDesc';
  if(['listings','opportunities','favorites'].includes(view))$('#listSection').hidden=false;
  else $({live:'#liveSection',system:'#systemSection',valuation:'#valuationSection'}[view]).hidden=false;
  _canliNabizDonguYonet();
  if(view==='valuation')renderValuationHistory();
  render();
}

const emsalCache=new Map();
const kondisyonCache=new Map();

function kondisyonKatsayisi(item={}){
  if(item.id&&kondisyonCache.has(item.id))return kondisyonCache.get(item.id);
  const schema=boyaDegisenSayisi(item);
  const tramer=parseTramerInfo(item);
  const heavy=parseHeavyDamageInfo(item);
  const badges=ilanRozetleri(item);
  let factor=1.0;
  const notes=[];

  if(heavy.heavy||badges.includes('agir_hasar')){
    factor-=0.22;
    notes.push('Ağır Hasar (-%22)');
  }
  if(['sase_podye','airbag','motor_degismis','cekme_belgeli','taksi_cikmasi'].some(r=>badges.includes(r))){
    factor-=0.12;
    notes.push('Kritik Risk (-%12)');
  }
  if(badges.includes('ariza_masraf')){
    factor-=0.06;
    notes.push('Arıza/Masraf (-%6)');
  }

  if(schema.knownCount>0){
    let paintPenalty=0;
    const tavanSt=schema.partsMap.tavan;
    const kaputSt=schema.partsMap.kaput;
    if(tavanSt==='Değişen')paintPenalty+=0.09;
    else if(tavanSt==='Boyalı')paintPenalty+=0.05;
    else if(tavanSt==='Lokal Boyalı')paintPenalty+=0.025;

    if(kaputSt==='Değişen')paintPenalty+=0.05;
    else if(kaputSt==='Boyalı')paintPenalty+=0.03;
    else if(kaputSt==='Lokal Boyalı')paintPenalty+=0.015;

    for(const p of ARAC_PARCALARI){
      if(p.key==='tavan'||p.key==='kaput')continue;
      const st=schema.partsMap[p.key];
      if(st==='Değişen')paintPenalty+=0.022;
      else if(st==='Boyalı')paintPenalty+=0.012;
      else if(st==='Lokal Boyalı')paintPenalty+=0.006;
    }
    paintPenalty=Math.min(0.22,paintPenalty);
    if(paintPenalty>0){
      factor-=paintPenalty;
      notes.push(`${schema.boyali}B/${schema.degisen}D (-%${Math.round(paintPenalty*100)})`);
    }else if(schema.schemaComplete&&schema.boyali===0&&schema.degisen===0){
      factor+=0.015;
      notes.push('Boyasız/Değişensiz (+%1.5)');
    }
  }

  if(tramer.known&&tramer.amount>0){
    const refP=item.price||1200000;
    const tramerPenalty=Math.min(0.10,(tramer.amount/refP)*0.45);
    factor-=tramerPenalty;
    notes.push(`Tramer ${num(tramer.amount)} TL (-%${Math.round(tramerPenalty*1000)/10})`);
  }else if(tramer.known&&tramer.amount===0&&!heavy.heavy){
    factor+=0.005;
  }

  factor=Math.max(0.55,Math.min(1.04,factor));
  const res={factor,schema,tramer,heavy,badges,notes};
  if(item.id)kondisyonCache.set(item.id,res);
  return res;
}

function emsalKisaEtiket(item={}){
  const k=kondisyonKatsayisi(item);
  const parts=[];
  if(item.year)parts.push(String(item.year));
  if(item.km!=null)parts.push(`${Math.round(item.km/1000)}B km`);
  if(k.heavy.heavy)parts.push('Ağır Hasar');
  else if(k.schema.schemaComplete){
    if(k.schema.boyali===0&&k.schema.degisen===0)parts.push('Hatasız Şema');
    else parts.push(`${k.schema.boyali}B/${k.schema.degisen}D`);
  }
  if(k.tramer.known&&k.tramer.amount>0)parts.push(`Tramer:${Math.round(k.tramer.amount/1000)}B`);
  else if(k.tramer.known&&k.tramer.amount===0)parts.push('0 Tramer');
  return parts.join(' · ')||'Detay bekliyor';
}

function sahibindenEmsalAramaUrl(item={}){
  const q=[item.brand,item.model,item.trim,item.year].filter(Boolean).join(' ').trim();
  return q?`https://www.sahibinden.com/otomobil?query_text=${encodeURIComponent(q)}`:(item.url||'https://www.sahibinden.com/otomobil');
}

let brandModelIndex=null;
function getBrandModelIndex(){
  if(brandModelIndex)return brandModelIndex;
  brandModelIndex=new Map();
  const list=state?.listings||[];
  for(let i=0;i<list.length;i++){
    const l=list[i];
    if(!l||!l.brand||!l.model)continue;
    const k=`${l.brand}|${l.model}`.toLocaleLowerCase('tr');
    let arr=brandModelIndex.get(k);
    if(!arr){arr=[];brandModelIndex.set(k,arr);}
    arr.push(l);
  }
  return brandModelIndex;
}

function emsalAnalizi(item){
  if(!item)return {allPeers:[],topPeers:[],emsalFiyat:null,hamMedyan:null};
  if(item.id&&emsalCache.has(item.id))return emsalCache.get(item.id);
  const itemKond=kondisyonKatsayisi(item);
  const now=Date.now();
  const STALE_MS=30*86400000;
  const seenDedup=new Set();

  const targetSpecs=extractVehicleSpecs(item.trim||'',item.title||'',item.fields||{Marka:item.brand,Seri:item.model,Vites:item.gear});
  if(!targetSpecs.gear&&item.gear)targetSpecs.gear=String(item.gear).toLowerCase();

  const idx=getBrandModelIndex();
  const k=`${item.brand||''}|${item.model||''}`.toLocaleLowerCase('tr');
  const candidates=idx.get(k)||(state?.listings||[]);

  let pool=candidates.filter(l=>{
    if(!l||l.id===item.id||!(l.price>50000)||!l.brand||!item.brand||l.brand!==item.brand)return false;
    if(l.model!==item.model&&!l.model?.includes(item.model)&&!item.model?.includes(l.model))return false;
    if(!l.year||!item.year||Math.abs(l.year-item.year)>2)return false;
    const dk=`${(l.title||'').trim().toLowerCase()}|${l.price}`;
    if(seenDedup.has(dk))return false;
    seenDedup.add(dk);
    return true;
  });

  const freshPool=pool.filter(l=>!l.firstSeen||(now-l.firstSeen)<=STALE_MS||(l.lastChanged&&(now-l.lastChanged)<=STALE_MS));
  if(freshPool.length>=8)pool=freshPool;

  const targetIsHeavy=Boolean(itemKond.heavy.heavy||/ağır hasar|agir hasar|pert/i.test(`${item.title||''} ${item.description||''}`));
  if(!targetIsHeavy){
    const cleanPool=pool.filter(l=>!kondisyonKatsayisi(l).heavy.heavy&&!/ağır hasar|agir hasar|pert/i.test(`${l.title||''} ${l.description||''}`));
    if(cleanPool.length>=3)pool=cleanPool;
  }

  const poolWithSpecs=pool.map(p=>{
    const pSpecs=extractVehicleSpecs(p.trim||'',p.title||'',p.fields||{Marka:p.brand,Seri:p.model,Vites:p.gear});
    return {p,pSpecs};
  });

  let validPool=poolWithSpecs;
  if(targetSpecs.body){
    const bodyPool=validPool.filter(x=>!x.pSpecs.body||x.pSpecs.body===targetSpecs.body);
    if(bodyPool.length>=3)validPool=bodyPool;
  }

  if(targetSpecs.motor){
    const sameMotorPool=validPool.filter(x=>x.pSpecs.motor===targetSpecs.motor);
    if(sameMotorPool.length>=3)validPool=sameMotorPool;
  }

  if(item.gear){
    const g1=String(item.gear).toLowerCase().includes('oto')?'oto':'man';
    const gearPool=validPool.filter(x=>{
      const g2=String(x.p.gear||x.pSpecs.gear||'').toLowerCase().includes('oto')?'oto':'man';
      return g1===g2;
    });
    if(gearPool.length>=3)validPool=gearPool;
  }

  const scored=validPool.map(({p,pSpecs})=>{
    const pKond=kondisyonKatsayisi(p);
    let uyum=30;

    // 1. Motor uyumu
    if(targetSpecs.motor&&pSpecs.motor){
      if(pSpecs.motor===targetSpecs.motor)uyum+=30;
      else uyum-=30;
    }

    // 2. Yakıt uyumu
    if(targetSpecs.fuel&&pSpecs.fuel){
      if(pSpecs.fuel===targetSpecs.fuel)uyum+=10;
      else uyum-=35;
    }

    // 3. Paket / Donanım (trim) uyumu
    if(targetSpecs.pkg&&pSpecs.pkg){
      if(pSpecs.pkg===targetSpecs.pkg)uyum+=20;
      else uyum+=5;
    }else if(item.trim&&p.trim){
      const tTokens=String(item.trim).toLowerCase().split(/\s+/).filter(x=>x.length>2);
      const cTokens=String(p.trim).toLowerCase().split(/\s+/).filter(x=>x.length>2);
      const common=tTokens.filter(t=>cTokens.includes(t));
      if(common.length>=2)uyum+=15;
      else if(common.length===1)uyum+=8;
    }

    // 4. Vites uyumu
    if(item.gear&&(p.gear||pSpecs.gear)){
      const g1=String(item.gear).toLowerCase().includes('oto')?'oto':'man';
      const g2=String(p.gear||pSpecs.gear).toLowerCase().includes('oto')?'oto':'man';
      if(g1===g2)uyum+=10;
      else uyum-=20;
    }

    // 5. Yıl uyumu
    const yDiff=Math.abs((p.year||0)-(item.year||0));
    if(yDiff===0)uyum+=10;
    else if(yDiff===1)uyum+=5;
    else uyum-=8;

    // 6. Kilometre uyumu ve KM fiyat düzeltmesi
    let kmDelta=0;
    if(item.km!=null&&p.km!=null&&p.km>0&&item.km>0){
      const kmDiff=Math.abs(p.km-item.km);
      if(kmDiff<=20000)uyum+=10;
      else if(kmDiff<=45000)uyum+=6;
      else if(kmDiff<=75000)uyum+=2;
      else if(kmDiff>100000)uyum-=10;
      kmDelta=Math.max(-0.10,Math.min(0.10,((p.km-item.km)/10000)*0.0075));
    }

    // 7. Boya & Değişen uyumu
    if(itemKond.schema.knownCount>0&&pKond.schema.knownCount>0){
      const bDiff=Math.abs(pKond.schema.boyali-itemKond.schema.boyali)+Math.abs(pKond.schema.degisen-itemKond.schema.degisen)*2;
      if(bDiff===0)uyum+=5;
      else if(bDiff>4)uyum-=8;
    }

    // 8. Ağır hasar uyumu
    if(pKond.heavy.heavy!==targetIsHeavy)uyum-=35;

    uyum=Math.max(10,Math.min(99,Math.round(uyum)));

    // Fiyat düzeltmesi: Yıl (4%/yıl) + KM (0.75%/10k km) + Kondisyon Oranı
    const yearDelta=((item.year||p.year)-(p.year||item.year))*0.04;
    const condRatio=itemKond.factor/(pKond.factor||1);
    const totalAdjust=Math.max(0.60,Math.min(1.40,(1+yearDelta+kmDelta)*condRatio));
    const duzeltilmisFiyat=Math.round((p.price*totalAdjust)/1000)*1000;

    return {peer:p,pSpecs,uyum,duzeltilmisFiyat,hamFiyat:p.price,totalAdjust,pKond};
  });

  scored.sort((a,b)=>
    b.uyum-a.uyum||
    Math.abs((a.peer.km??item.km??0)-(item.km??0))-Math.abs((b.peer.km??item.km??0)-(item.km??0))||
    Math.abs(a.peer.price-(item.price||0))-Math.abs(b.peer.price-(item.price||0))
  );

  const strongPeers=scored.filter(s=>s.uyum>=50);
  const topPeers=(strongPeers.length>=3?strongPeers:scored).slice(0,15);
  const hasEnough=topPeers.length>=3&&Boolean(item.price);
  const hamMedyan=hasEnough?Math.round(median(topPeers.map(x=>x.hamFiyat))):null;
  const emsalFiyat=hasEnough?Math.round(median(topPeers.map(x=>x.duzeltilmisFiyat))):null;

  const result={allPeers:scored,topPeers,emsalFiyat,hamMedyan,itemKond,targetSpecs};
  if(item.id)emsalCache.set(item.id,result);
  return result;
}

function peers(item){
  return emsalAnalizi(item).allPeers.map(x=>x.peer);
}
function iqrClean(values){
  const a=values.map(Number).filter(v=>Number.isFinite(v)&&v>=50000).sort((x,y)=>x-y);
  if(a.length<4)return a;
  const q1=percentile(a,0.25),q3=percentile(a,0.75),iqr=q3-q1;
  const lo=q1-1.5*iqr,hi=q3+1.5*iqr;
  const f=a.filter(v=>v>=lo&&v<=hi);
  return f.length>=3?f:a;
}
function median(values){const a=iqrClean(values),i=Math.floor(a.length/2);if(!a.length)return null;return a.length%2?a[i]:(a[i-1]+a[i])/2;}
function percentile(values,p){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),idx=Math.min(a.length-1,Math.max(0,Math.floor((a.length-1)*p)));return a[idx];}
function expectedPrice(item){return emsalAnalizi(item).emsalFiyat;}
function score(item){const base=expectedPrice(item);if(!base||!item.price)return null;return Math.round(1000*(base-item.price)/base)/10;}
function satarFiyati(base){return base?Math.round((base*0.94)/1000)*1000:null;}
function verdictYazisi(pct){return pct==null?'Skorsuz':pct>=10?'Süper Fırsat':pct>0?'Ucuz':pct===0?'Piyasa':'Pahalı';}
function cityOf(item){return (item.location||item.fields?.['İl / İlçe']||'').split(/[/,-]/)[0].trim();}

function besYildizMi(item){
  const pct=score(item);
  if(pct==null||pct<=10||!item.year||!item.km||item.km<=0)return false;
  const schema=boyaDegisenSayisi(item);
  const badges=ilanRozetleri(item);
  if(badges.includes('sema_teyitsiz'))return false;
  if(schema.boyali!==0||schema.degisen!==0)return false;
  const tramer=parseTramerInfo(item);
  if(Number(tramer.amount||0)>0)return false;
  const age=Math.max(1,new Date().getFullYear()-item.year);
  return (item.km/age)<=20000;
}

function updateConditionModeUI(){
  const pill=$('#conditionFilterModePill');
  if(!pill)return;
  if($('#hatasizQuickSelect')?.checked){
    conditionMode='hatasiz';
    pill.textContent='İLAN BİLGİSİNE GÖRE HATASIZ';
  }else if(conditionMode==='custom'){
    pill.textContent='ÖZEL FİLTRE';
  }else{
    pill.textContent='STANDART FİLTRE';
  }
}

function applyHatasizQuickPreset(enabled){
  if($('#hatasizQuickSelect'))$('#hatasizQuickSelect').checked=enabled;
  if(enabled){
    conditionMode='hatasiz';
    if($('#maxPaintedSelect'))$('#maxPaintedSelect').value='0';
    if($('#maxChangedSelect'))$('#maxChangedSelect').value='0';
    if($('#paintlessOnly'))$('#paintlessOnly').checked=true;
    if($('#changelessOnly'))$('#changelessOnly').checked=true;
    if($('#zeroTramerOnly'))$('#zeroTramerOnly').checked=true;
    if($('#noHeavyDamage'))$('#noHeavyDamage').checked=true;
    if($('#hideRisk'))$('#hideRisk').checked=true;
    if($('#hideFault'))$('#hideFault').checked=true;
    if($('#hideWarning'))$('#hideWarning').checked=true;
    if($('#hideIncomplete'))$('#hideIncomplete').checked=false;
  }else{
    conditionMode='standard';
    if($('#maxPaintedSelect'))$('#maxPaintedSelect').value='13';
    if($('#maxChangedSelect'))$('#maxChangedSelect').value='13';
    ['#paintlessOnly','#changelessOnly','#zeroTramerOnly','#noHeavyDamage','#hideRisk','#hideFault','#hideWarning','#hideIncomplete'].forEach(id=>{if($(id))$(id).checked=false;});
  }
  updateConditionModeUI();
}

function checkHatasizRelaxation(){
  const isStrict=(
    ($('#maxPaintedSelect')?.value==='0')&&
    ($('#maxChangedSelect')?.value==='0')&&
    ($('#paintlessOnly')?.checked)&&
    ($('#changelessOnly')?.checked)&&
    ($('#zeroTramerOnly')?.checked)&&
    ($('#noHeavyDamage')?.checked)&&
    ($('#hideRisk')?.checked)&&
    ($('#hideFault')?.checked)&&
    ($('#hideWarning')?.checked)
  );
  if(conditionMode==='hatasiz'&&!isStrict){
    if($('#hatasizQuickSelect'))$('#hatasizQuickSelect').checked=false;
    conditionMode='custom';
  }else if(isStrict&&$('#hatasizQuickSelect')?.checked){
    conditionMode='hatasiz';
  }
  updateConditionModeUI();
}

function render(full=true){
  if(!state)return;
  const l=state.listings,s=state.source,j=state.jobs;
  $('#totalStat').textContent=num(state.totalCount||l.length);
  $('#navCount').textContent=num(state.totalCount||l.length);
  if($('#stTotalListings'))$('#stTotalListings').textContent=num(state.totalCount||l.length)+' İLAN';
  if($('#stBotStatus'))$('#stBotStatus').textContent=s.running===false?'CANLI BOT: DURAKLATILDI':'CANLI BOT: AKTİF';
  $('#favoriteCount').textContent=num(l.filter(i=>i.favorite).length);
  $('#pagesStat').textContent=num(j.baselineCompleted);
  $('#pagesHint').textContent=s.baselineDone?'Keşfedilen ilk işler tamamlandı':`${num(j.baselineTotal)} keşfedilen kaynak işi`;
  $('#changesStat').textContent=num(state.events.filter(e=>e.type==='price_drop'||e.type==='price_rise').length);
  $('#bannerTitle').textContent=phases[s.phase]||'Kaynak kontrol ediliyor';
  $('#bannerMessage').textContent=s.message;
  $('#sourceMessage').textContent=s.message;
  $('#phasePill').textContent=(phases[s.phase]||s.phase).toLocaleUpperCase('tr');
  $('#detailsCount').textContent=`${num(l.filter(i=>i.detailComplete).length)} ilan`;
  $('#tickCount').textContent=`${num(s.cyclesCompleted)} başarılı`;
  $('#baselineBadge').textContent=s.baselineDone?'Tamamlandı':`${num(j.baselineCompleted)} / ${num(j.baselineTotal)}`;
  $('#baselineText').textContent=s.baselineDone?`Bir kez tamamlandı: ${date(s.baselineCompletedAt)}.`:(!s.running?'Tamamlanmadı. '+s.message:`Kuyrukta ${num(j.pending)} iş var. İlk genel tarama bitmeden yeni ilan döngüsü başlamaz.`);
  $('#pendingJobs').textContent=num(j.pending);
  if($('#deepCursorStatus')){
    const dc=s.deepCursor;
    $('#deepCursorStatus').textContent=dc?`Bant #${(dc.bandIdx||0)+1}/15 · Sayfa ${(dc.offset||0)/50+1} (${num(dc.pagesScanned||0)} bant sayfası · ${dc.fullSweeps||0} tam tur)`:'Aktif (50 ilan/sayfa)';
  }
  $('#lastSuccess').textContent=date(s.lastSuccess);
  $('#lastAttemptAt').textContent=date(s.lastAttempt?.at);
  const reader=s.reader,readerStates={stopped:'Bekliyor',starting:'Başlatılıyor',ready:'Hazır',reading:'Sayfa okunuyor',blocked:'Kaynak erişimi engelledi',failed:'Okuyucu başlatılamadı'};
  $('#sourcePageCheck').textContent=s.pageCheck?(s.pageCheck.passed?`${num(s.pageCheck.listingCount)} ilan bağlantısı okundu`:'Başarısız'+(s.pageCheck.status?` · HTTP ${s.pageCheck.status}`:'')):'Henüz yapılmadı';
  $('#readerName').textContent=reader?'Arka plan · '+reader.engine:'Hazırlanıyor';
  $('#readerState').textContent=readerStates[reader?.state]||'Bekliyor';
  $('#readerJavascript').textContent=reader?.javascript?'Açık':'—';
  $('#lastHttpStatus').textContent=s.lastAttempt?.status?`HTTP ${s.lastAttempt.status}`:s.lastAttempt?.outcome==='pending'?'Yanıt bekleniyor':s.lastAttempt?'Ağ hatası':'—';
  $('#lastCheckAt').textContent=date(s.lastCheckAt);
  $('#lastNewCount').textContent=num(s.lastNewCount);
  $('#retryAt').textContent=s.retryAt?date(s.retryAt):'—';
  $('#checkedTime').textContent=s.lastSuccess?'Son kaynak okuması '+ago(s.lastSuccess):'Henüz veri alınmadı';
  $('#gapSeconds').value=String(state.settings.gapSeconds);
  $('#resumeCrawl').disabled=s.running;
  $('#pauseCrawl').disabled=!s.running;
  if(full){
    if(['listings','opportunities','favorites'].includes(view)){
      updateSelectors();
      agacOlustur();
      renderList();
    }
  }
  renderEvents();
  countdown();
}

let cachedBrands=null,cachedCities=null,cachedBrandModels=new Map(),allBrandsLoaded=false;
let modelCombobox=null,valuationModelCombobox=null;

function trNorm(str) {
  if (!str) return '';
  return String(str)
    .replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/ı/g, 'i')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/Ü/g, 'u')
    .replace(/ş/g, 's').replace(/Ş/g, 's')
    .replace(/ö/g, 'o').replace(/Ö/g, 'o')
    .replace(/ç/g, 'c').replace(/Ç/g, 'c')
    .toLowerCase().trim();
}

function highlightMatch(text, query) {
  if (!query || !query.trim()) return esc(text);
  const rawTokens = query.trim().split(/\s+/).filter(Boolean);
  if (!rawTokens.length) return esc(text);
  const patterns = rawTokens.map(t => {
    return t.split('').map(ch => {
      const lower = ch.toLowerCase();
      if (lower === 'i' || lower === 'ı') return '[iıİI]';
      if (lower === 'g' || lower === 'ğ') return '[gğGĞ]';
      if (lower === 'u' || lower === 'ü') return '[uüUÜ]';
      if (lower === 's' || lower === 'ş') return '[sşSŞ]';
      if (lower === 'o' || lower === 'ö') return '[oöOÖ]';
      if (lower === 'c' || lower === 'ç') return '[cçCÇ]';
      return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
  });
  const rx = new RegExp('(' + patterns.join('|') + ')', 'gi');
  return esc(text).replace(rx, '<span class="combobox-match">$1</span>');
}

function createCombobox({ inputEl, dropdownEl, arrowBtn, emptyLabel = '', onSelect = null }) {
  if (!inputEl || !dropdownEl) return null;
  let options = [];
  let isOpen = false;
  let activeIndex = -1;
  let currentFiltered = [];

  function setOptions(newOptions) {
    options = Array.isArray(newOptions) ? [...new Set(newOptions.filter(Boolean))] : [];
    if (isOpen) renderDropdown();
  }

  function getFilteredOptions(q) {
    if (!q || !q.trim()) return options;
    const normQ = trNorm(q);
    const cleanQ = normQ.replace(/[\s\-_]/g, '');
    const tokens = normQ.split(/\s+/).filter(Boolean);
    const scored = [];

    for (const opt of options) {
      const normOpt = trNorm(opt);
      const cleanOpt = normOpt.replace(/[\s\-_]/g, '');
      const matches = tokens.every(tok => {
        const cleanTok = tok.replace(/[\s\-_]/g, '');
        return normOpt.includes(tok) || (cleanTok && cleanOpt.includes(cleanTok));
      });
      if (!matches) continue;

      let score = 0;
      if (normOpt === normQ) score += 2000;
      else if (normOpt.startsWith(normQ)) score += 1000;
      else if (cleanOpt.startsWith(cleanQ)) score += 800;
      else if (tokens[0] && normOpt.startsWith(tokens[0])) score += 500;
      else if (tokens[0] && cleanOpt.startsWith(tokens[0])) score += 400;
      else {
        const words = normOpt.split(/[\s\-_]+/);
        if (words.some(w => w.startsWith(tokens[0]))) score += 300;
        else score += 100;
      }
      score += Math.max(0, 50 - Math.min(50, opt.length));
      scored.push({ opt, score });
    }

    scored.sort((a, b) => b.score - a.score || a.opt.localeCompare(b.opt, 'tr'));
    return scored.map(s => s.opt);
  }

  function renderDropdown() {
    const q = inputEl.value.trim();
    currentFiltered = getFilteredOptions(q);
    let html = '';

    if (emptyLabel) {
      html += `<div class="combobox-item combobox-item-clear ${!q ? 'selected' : ''}" data-val="">✕ ${esc(emptyLabel)}</div>`;
    }

    if (!currentFiltered.length) {
      html += `<div class="combobox-empty">Eşleşen model bulunamadı ("${esc(q)}")</div>`;
    } else {
      const visibleItems = currentFiltered.slice(0, 80);
      html += visibleItems.map((opt, idx) => {
        const isSel = opt === inputEl.value;
        const isAct = idx === activeIndex;
        const highlighted = highlightMatch(opt, q);
        return `<div class="combobox-item ${isSel ? 'selected' : ''} ${isAct ? 'active' : ''}" data-idx="${idx}" data-val="${esc(opt)}">${highlighted}</div>`;
      }).join('');
    }

    dropdownEl.innerHTML = html;
    dropdownEl.hidden = false;
    isOpen = true;
  }

  function closeDropdown() {
    dropdownEl.hidden = true;
    isOpen = false;
    activeIndex = -1;
  }

  function selectValue(val) {
    inputEl.value = val;
    closeDropdown();
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    if (onSelect) onSelect(val);
  }

  function highlightActive() {
    const items = dropdownEl.querySelectorAll('.combobox-item[data-idx]');
    items.forEach(el => el.classList.remove('active'));
    if (activeIndex >= 0 && activeIndex < items.length) {
      const activeEl = items[activeIndex];
      if (activeEl) {
        activeEl.classList.add('active');
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  inputEl.addEventListener('focus', () => {
    activeIndex = -1;
    renderDropdown();
  });

  inputEl.addEventListener('input', () => {
    activeIndex = 0;
    renderDropdown();
    highlightActive();
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        renderDropdown();
        activeIndex = 0;
      } else {
        const total = Math.min(currentFiltered.length, 80);
        if (total > 0) {
          activeIndex = (activeIndex + 1) % total;
          highlightActive();
        }
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isOpen) {
        const total = Math.min(currentFiltered.length, 80);
        if (total > 0) {
          activeIndex = (activeIndex - 1 + total) % total;
          highlightActive();
        }
      }
    } else if (e.key === 'Enter') {
      if (isOpen && activeIndex >= 0 && activeIndex < currentFiltered.length) {
        e.preventDefault();
        selectValue(currentFiltered[activeIndex]);
      } else if (isOpen) {
        closeDropdown();
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        closeDropdown();
      }
    }
  });

  dropdownEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const item = e.target.closest('.combobox-item');
    if (!item) return;
    const val = item.getAttribute('data-val') || '';
    selectValue(val);
  });

  if (arrowBtn) {
    arrowBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (isOpen) {
        closeDropdown();
      } else {
        inputEl.focus();
        activeIndex = -1;
        renderDropdown();
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target) && (!arrowBtn || !arrowBtn.contains(e.target))) {
      closeDropdown();
    }
  });

  return {
    setOptions,
    setValue: (val) => { inputEl.value = val || ''; },
    getValue: () => inputEl.value,
    open: () => { inputEl.focus(); renderDropdown(); },
    close: closeDropdown
  };
}

async function loadModelsForBrand(brand) {
  const cacheKey = brand || '__ALL__';
  if (cachedBrandModels.has(cacheKey)) return cachedBrandModels.get(cacheKey);
  try {
    const list = await api('/api/models' + (brand ? '?brand=' + encodeURIComponent(brand) : ''));
    if (Array.isArray(list) && list.length) {
      cachedBrandModels.set(cacheKey, list);
      return list;
    }
  } catch {}
  const fallback = [...new Set((state?.listings||[]).filter(l=>!brand||l.brand===brand).map(l=>l.model).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr'));
  cachedBrandModels.set(cacheKey, fallback);
  return fallback;
}

async function loadFullBrandsList(){
  if(allBrandsLoaded) return;
  try{
    const brands = await api('/api/brands');
    if(Array.isArray(brands) && brands.length > (cachedBrands?.length || 0)){
      allBrandsLoaded = true;
      cachedBrands = brands;
      for(const id of ['#brandFilter','#valuationBrand']){
        const e=$(id);if(!e)continue;
        const old=e.value,first=id==='#brandFilter'?'Tüm markalar':'Marka seç';
        const options='<option value="">'+first+'</option>'+cachedBrands.map(b=>`<option>${esc(b)}</option>`).join('');
        if(e.innerHTML!==options){e.innerHTML=options;if(old)e.value=old;}
      }
    }
  }catch{}
}
function updateSelectors(force=false){
  if(force){
    cachedBrands=null;
    cachedCities=null;
    cachedBrandModels.clear();
    allBrandsLoaded=false;
  }
  if(!cachedBrands){
    cachedBrands=[...new Set((state?.listings||[]).map(l=>l.brand).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr'));
    for(const id of ['#brandFilter','#valuationBrand']){
      const e=$(id);if(!e)continue;
      const old=e.value,first=id==='#brandFilter'?'Tüm markalar':'Marka seç';
      const options='<option value="">'+first+'</option>'+cachedBrands.map(b=>`<option>${esc(b)}</option>`).join('');
      if(e.innerHTML!==options){e.innerHTML=options;e.value=old;}
    }
    void loadFullBrandsList();
  }
  const activeBrand=$('#brandFilter')?.value||'';
  const cacheKey = activeBrand || '__ALL__';
  if(!cachedBrandModels.has(cacheKey)){
    const fallback=[...new Set((state?.listings||[]).filter(l=>!activeBrand||l.brand===activeBrand).map(l=>l.model).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr'));
    cachedBrandModels.set(cacheKey, fallback);
    loadModelsForBrand(activeBrand).then(list => {
      if(modelCombobox) modelCombobox.setOptions(list);
    });
  }
  const models=cachedBrandModels.get(cacheKey)||[];
  if(modelCombobox){
    modelCombobox.setOptions(models);
  } else {
    const modelEl=$('#modelFilter');
    if(modelEl && modelEl.tagName === 'SELECT'){
      const oldM=modelEl.value;
      const mOpts='<option value="">Tüm modeller</option>'+models.map(m=>`<option>${esc(m)}</option>`).join('');
      if(modelEl.innerHTML!==mOpts){modelEl.innerHTML=mOpts;modelEl.value=models.includes(oldM)?oldM:'';}
    }
  }
  if(!cachedCities){
    cachedCities=[...new Set((state?.listings||[]).map(cityOf).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr'));
    const cityEl=$('#cityFilter');
    if(cityEl){
      const oldC=cityEl.value;
      const cOpts='<option value="">Tüm iller</option>'+cachedCities.map(c=>`<option>${esc(c)}</option>`).join('');
      if(cityEl.innerHTML!==cOpts){cityEl.innerHTML=cOpts;cityEl.value=cachedCities.includes(oldC)?oldC:'';}
    }
  }
}

const selectedGears = new Set();
const selectedFuels = new Set();
const selectedBodies = new Set();

function inferGear(l) {
  if (l && l.gear) {
    const g = String(l.gear).toLowerCase();
    if (g.includes('yarı') || g.includes('yari')) return 'Yarı Otomatik';
    if (g.includes('oto') || g.includes('automatic')) return 'Otomatik';
    if (g.includes('man')) return 'Manuel';
  }
  const text = `${l?.title || ''} ${l?.trim || ''} ${l?.description || ''}`.toLowerCase();
  if (/(?:yarı\s*otomatik|yari\s*otomatik|m-joy|dualogic|smg)/i.test(text)) return 'Yarı Otomatik';
  if (/(?:otomatik|dsg|s-tronic|stronic|steptronic|edc|eat8|eat6|cvt|7g-tronic|9g-tronic|tiptronic|geartronic|multitronic)/i.test(text)) return 'Otomatik';
  if (/(?:manuel|düz\s*vites|duz\s*vites)/i.test(text)) return 'Manuel';
  return '';
}

function matchesGear(l, set) {
  if (!set || set.size === 0) return true;
  const g = inferGear(l);
  return g ? set.has(g) : false;
}

function inferFuel(l) {
  if (l && l.fuel) {
    const f = String(l.fuel).toLowerCase();
    if (f.includes('dizel') || f.includes('diesel')) return 'Dizel';
    if (f.includes('hibrit') || f.includes('hybrid')) return 'Hibrit';
    if (f.includes('elektrik') || f.includes('electric')) return 'Elektrik';
    if (f.includes('lpg') || f.includes('gaz')) return 'LPG';
    if (f.includes('benzin') || f.includes('gasoline')) return 'Benzin';
  }
  const text = `${l?.title || ''} ${l?.trim || ''} ${l?.description || ''}`.toLowerCase();
  if (/(?:elektrik|edrive|eq[abcse]\b|taycan|e-tron|ioniq\s*5|ev6|togg|tesla|\bev\b)/i.test(text)) return 'Elektrik';
  if (/(?:hibrit|hybrid|phev|mhev|e-hybrid)/i.test(text)) return 'Hibrit';
  if (/(?:dizel|diesel|\btdi\b|\bdci\b|\bcrdi\b|\bhdi\b|\bcdti\b|\bbluehdi\b|\bmultijet\b|\bjtd\b|\bd-4d\b|\btdci\b|\b16d\b|\b20d\b|\b25d\b|\b30d\b|\b35d\b|\b40d\b)/i.test(text)) return 'Dizel';
  if (/(?:lpg|otogaz|tüp|tup)/i.test(text)) return 'LPG';
  if (/(?:benzin|gasoline|\btsi\b|\btfsi\b|\bpuretech\b|\becoboost\b|\bvtec\b|\btce\b|\b16i\b|\b18i\b|\b20i\b|\b30i\b|\b35i\b|\b40i\b|\bm50i\b|\bm60i\b)/i.test(text)) return 'Benzin';
  return '';
}

function matchesFuel(l, set) {
  if (!set || set.size === 0) return true;
  const f = inferFuel(l);
  return f ? set.has(f) : false;
}

function inferBody(l) {
  if (l && l.body) {
    const b = String(l.body).toLowerCase();
    if (b.includes('suv') || b.includes('arazi')) return 'SUV';
    if (b.includes('sedan')) return 'Sedan';
    if (b.includes('hatchback') || b.includes('hb')) return 'Hatchback';
    if (b.includes('coupe') || b.includes('coupé')) return 'Coupe';
    if (b.includes('station') || b.includes('wagon') || b.includes('combi') || b.includes('sw')) return 'Station Wagon';
    if (b.includes('cabrio') || b.includes('convertible') || b.includes('spider')) return 'Cabrio';
  }
  const text = `${l?.title || ''} ${l?.model || ''} ${l?.trim || ''} ${l?.description || ''}`.toLowerCase();
  if (/(?:cabrio|cabriolet|convertible|spider|roadster|açılır\s*tavan)/i.test(text)) return 'Cabrio';
  if (/(?:station\s*wagon|station|wagon|variant|avant|\bsw\b|touring|combi)/i.test(text)) return 'Station Wagon';
  if (/(?:gran\s*coupe|coupe|coupé|\bcc\b|\btt\b)/i.test(text)) return 'Coupe';
  if (/(?:suv|crossover|\bx[1-7]\b|\bi?x\d\b|\bq[2-8]\b|gl[a-s]\b|tiguan|t-roc|touareg|tucson|sportage|qashqai|kadjar|austral|duster|captur|kuga|puma|cx-5|3008|2008|5008|mokka|crossland|grandland|cherokee|compass|renegade)/i.test(text)) return 'SUV';
  if (/(?:sedan|passat|corolla|civic|jetta|octavia|superb|mondeo|focus\s*sedan|megane\s*sedan|fluence|egea\s*sedan|c-elysee|301|symbol|taliant|a3\s*sedan|a[468]\b|[357]\s*serisi|[ce]-serisi|s-serisi)/i.test(text)) return 'Sedan';
  if (/(?:hatchback|\bhb\b|golf|clio|polo|corsa|i20|fiesta|yaris|fabia|ibiza|leon|auris|a-serisi|1\s*serisi|a1\b|208|308|c3\b)/i.test(text)) return 'Hatchback';
  return '';
}

function matchesBody(l, set) {
  if (!set || set.size === 0) return true;
  const b = inferBody(l);
  return b ? set.has(b) : false;
}

function setCategorySelection({ brand = '', model = '', trim = '' }, target = 'filter') {
  if (target === 'valuation') {
    if ($('#valuationBrand')) $('#valuationBrand').value = brand;
    updateValuationModels(brand).then(() => {
      if ($('#valuationModel')) $('#valuationModel').value = model || trim;
    });
    return;
  }
  if ($('#brandFilter')) $('#brandFilter').value = brand;
  if ($('#modelFilter')) $('#modelFilter').value = model;
  if ($('#trimFilter')) $('#trimFilter').value = trim;
  treeTrim = trim;

  updateCategoryLabels();
  page = 1;
  checkHatasizRelaxation();
  syncQuickChips();
  renderList();
  agacOlustur();
}

function updateCategoryLabels() {
  void sourceRenderCategories();
  const brand = $('#brandFilter')?.value || '';
  const model = $('#modelFilter')?.value || '';
  const trim = $('#trimFilter')?.value || '';

  let label = 'Tüm marka ve modeller';
  if (brand && model && trim) label = `${brand} › ${model} › ${trim}`;
  else if (brand && model) label = `${brand} › ${model}`;
  else if (brand) label = brand;

  if ($('#categoryTriggerLabel')) {
    $('#categoryTriggerLabel').textContent = label;
  }
  if ($('#sheetCategoryDisplay')) {
    $('#sheetCategoryDisplay').textContent = label;
  }
  if ($('#sheetClearCatBtn')) {
    $('#sheetClearCatBtn').hidden = !brand;
  }
}

let modalNavBrand = '';
let modalNavSeries = '';
let modalTarget = 'filter';
let catSearchDebounce = null;
let categoryReturnFocus = null;

async function openCategoryModal(target = 'filter') {
  modalTarget = target;
  const currentBrand = target === 'valuation' ? ($('#valuationBrand')?.value || '') : ($('#brandFilter')?.value || '');
  const currentModel = target === 'valuation' ? ($('#valuationModel')?.value || '') : ($('#modelFilter')?.value || '');

  modalNavBrand = currentBrand;
  modalNavSeries = currentModel;

  const modal = $('#categoryModal');
  if (!modal) return;
  categoryReturnFocus = document.activeElement;
  modal.hidden = false;
  $('#categoryTriggerBtn')?.setAttribute('aria-expanded','true');
  if ($('#catSearchInput')) $('#catSearchInput').value = '';
  if ($('#catSearchClear')) $('#catSearchClear').hidden = true;
  document.body.style.overflow = 'hidden';

  await renderCatModalView();
  setTimeout(() => $('#catSearchInput')?.focus(), 60);
}

function closeCategoryModal() {
  const modal = $('#categoryModal');
  if (!modal) return;
  modal.hidden = true;
  $('#categoryTriggerBtn')?.setAttribute('aria-expanded','false');
  document.body.style.overflow = $('#advancedFilters').hidden ? '' : 'hidden';
  categoryReturnFocus?.focus();
}

async function renderCatModalView() {
  const breadcrumbsEl = $('#catBreadcrumbs');
  const itemsListEl = $('#catItemsList');
  if (!itemsListEl) return;

  const crumbs = [
    `<button type="button" class="cat-crumb ${!modalNavBrand ? 'active' : ''}" data-cat-crumb="root">Tüm Markalar</button>`
  ];
  if (modalNavBrand) {
    crumbs.push(`<button type="button" class="cat-crumb ${modalNavBrand && !modalNavSeries ? 'active' : ''}" data-cat-crumb="brand">${esc(modalNavBrand)}</button>`);
  }
  if (modalNavSeries) {
    crumbs.push(`<button type="button" class="cat-crumb active" data-cat-crumb="series">${esc(modalNavSeries)}</button>`);
  }
  if (breadcrumbsEl) breadcrumbsEl.innerHTML = crumbs.join('<span class="cat-crumb-sep">›</span>');

  itemsListEl.innerHTML = '<div class="cat-item-loading">Kategoriler yükleniyor…</div>';

  try {
    const qParams = new URLSearchParams();
    if (modalNavBrand) qParams.set('brand', modalNavBrand);
    if (modalNavSeries) qParams.set('series', modalNavSeries);

    const data = await api(`/api/category-tree?${qParams.toString()}`);
    let html = '';

    if (data.level === 0) {
      html += `
        <button type="button" class="cat-item cat-item-all" data-cat-select-all="true">
          <div class="cat-item-main">
            <span class="cat-item-title"><strong>Tüm Markalar</strong> (Filtreyi Sıfırla)</span>
          </div>
          <span class="cat-count-badge">${num(data.total || 0)}</span>
        </button>
      `;
      for (const item of (data.items || [])) {
        html += `
          <button type="button" class="cat-item" data-cat-brand-nav="${esc(item.brand)}">
            <div class="cat-item-main">
              <span class="cat-item-title">${esc(item.brand)}</span>
            </div>
            <span class="cat-count-badge">${num(item.count)}</span>
          </button>
        `;
      }
    } else if (data.level === 1) {
      html += `
        <button type="button" class="cat-item cat-item-all" data-cat-select-brand="${esc(data.brand)}">
          <div class="cat-item-main">
            <span class="cat-item-title"><strong>Tüm ${esc(data.brand)} Modelleri</strong></span>
          </div>
          <span class="cat-count-badge">${num(data.total || 0)}</span>
        </button>
      `;
      for (const item of (data.items || [])) {
        html += `
          <button type="button" class="cat-item" data-cat-series-nav="${esc(item.series)}">
            <div class="cat-item-main">
              <span class="cat-item-title">${esc(item.series)}</span>
            </div>
            <span class="cat-count-badge">${num(item.count)}</span>
          </button>
        `;
      }
    } else if (data.level === 2) {
      html += `
        <button type="button" class="cat-item cat-item-all" data-cat-select-series="${esc(data.series)}">
          <div class="cat-item-main">
            <span class="cat-item-title"><strong>Tüm ${esc(data.series)} Modelleri</strong></span>
          </div>
          <span class="cat-count-badge">${num(data.total || 0)}</span>
        </button>
      `;
      for (const item of (data.items || [])) {
        html += `
          <button type="button" class="cat-item" data-cat-select-trim="${esc(item.trim)}">
            <div class="cat-item-main">
              <span class="cat-item-title">${esc(item.trim)}</span>
            </div>
            <span class="cat-count-badge">${num(item.count)}</span>
          </button>
        `;
      }
    }

    itemsListEl.innerHTML = html || '<div class="cat-item-empty">Bu kategoride araç bulunamadı.</div>';
  } catch (err) {
    itemsListEl.innerHTML = `<div class="cat-item-empty">Kategori yüklenirken hata oluştu: ${esc(err.message)}</div>`;
  }
}

async function performCategorySearch(query) {
  const itemsListEl = $('#catItemsList');
  if (!itemsListEl) return;
  const q = String(query || '').trim();
  if (!q) {
    await renderCatModalView();
    return;
  }

  itemsListEl.innerHTML = '<div class="cat-item-loading">Arama yapılıyor…</div>';

  try {
    const res = await api(`/api/category-search?q=${encodeURIComponent(q)}&brand=${encodeURIComponent(modalNavBrand || '')}`);
    if (!res || !res.length) {
      itemsListEl.innerHTML = `<div class="cat-item-empty">"${esc(q)}" ile eşleşen marka, model veya paket bulunamadı.</div>`;
      return;
    }

    const html = res.map(item => `
      <button type="button" class="cat-item" data-cat-pick-brand="${esc(item.brand)}" data-cat-pick-model="${esc(item.model)}" data-cat-pick-trim="${esc(item.trim || '')}">
        <div class="cat-item-main">
          <span class="cat-item-path">${highlightMatch(item.path, q)}</span>
        </div>
        <span class="cat-count-badge">${num(item.count)}</span>
      </button>
    `).join('');

    itemsListEl.innerHTML = html;
  } catch (err) {
    itemsListEl.innerHTML = `<div class="cat-item-empty">Arama hatası: ${esc(err.message)}</div>`;
  }
}

function initChipGroups() {
  $('#gearChipGroup')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-gear-val]');
    if (!btn) return;
    toggleGear(btn.dataset.gearVal);
  });
  $('#fuelChipGroup')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-fuel-val]');
    if (!btn) return;
    toggleFuel(btn.dataset.fuelVal);
  });
  $('#bodyChipGroup')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-body-val]');
    if (!btn) return;
    toggleBody(btn.dataset.bodyVal);
  });
}

function toggleGear(val) {
  if (!val) return;
  if (selectedGears.has(val)) selectedGears.delete(val);
  else selectedGears.add(val);
  syncChipGroupUI('#gearChipGroup', selectedGears, 'gearVal');
  page = 1;
  syncQuickChips();
  renderList();
}

function toggleFuel(val) {
  if (!val) return;
  if (selectedFuels.has(val)) selectedFuels.delete(val);
  else selectedFuels.add(val);
  syncChipGroupUI('#fuelChipGroup', selectedFuels, 'fuelVal');
  page = 1;
  syncQuickChips();
  renderList();
}

function toggleBody(val) {
  if (!val) return;
  if (selectedBodies.has(val)) selectedBodies.delete(val);
  else selectedBodies.add(val);
  syncChipGroupUI('#bodyChipGroup', selectedBodies, 'bodyVal');
  page = 1;
  syncQuickChips();
  renderList();
}

function syncChipGroupUI(groupId, set, attrName) {
  const grp = $(groupId);
  if (!grp) return;
  grp.querySelectorAll('.filter-chip-btn').forEach(btn => {
    const v = btn.dataset[attrName];
    btn.classList.toggle('active', set.has(v));
    btn.setAttribute('aria-checked',String(set.has(v)));
  });
}

function agacOlustur(){
  const bar=$('#categoryTreeBar');
  if(!bar||!state)return;
  const brand=$('#brandFilter')?.value||'',model=$('#modelFilter')?.value||'';
  const crumbs=[`<button type="button" class="tab ${!brand?'active':''}" data-tree-level="root">Tüm Kategoriler (${num(state.listings.length)})</button>`];
  if(brand)crumbs.push(`<button type="button" class="tab ${brand&&!model?'active':''}" data-tree-level="brand">${esc(brand)}</button>`);
  if(model)crumbs.push(`<button type="button" class="tab ${model&&!treeTrim?'active':''}" data-tree-level="model">${esc(model)}</button>`);
  if(treeTrim)crumbs.push(`<button type="button" class="tab active" data-tree-level="trim">${esc(treeTrim)}</button>`);
  let children=[];
  if(!brand){
    const counts=new Map();
    const list=state.listings;
    for(let i=0;i<list.length;i++){const l=list[i];if(l.brand)counts.set(l.brand,(counts.get(l.brand)||0)+1);}
    children=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,c])=>`<button type="button" class="tab" data-tree-brand="${esc(k)}">${esc(k)} <small>(${c})</small></button>`);
  }else if(!model){
    const counts=new Map();
    const list=state.listings;
    for(let i=0;i<list.length;i++){const l=list[i];if(l.brand===brand&&l.model)counts.set(l.model,(counts.get(l.model)||0)+1);}
    children=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,c])=>`<button type="button" class="tab" data-tree-model="${esc(k)}">${esc(k)} <small>(${c})</small></button>`);
  }else if(!treeTrim){
    const counts=new Map();
    const list=state.listings;
    for(let i=0;i<list.length;i++){const l=list[i];if(l.brand===brand&&l.model===model&&l.trim)counts.set(l.trim,(counts.get(l.trim)||0)+1);}
    children=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,c])=>`<button type="button" class="tab" data-tree-trim="${esc(k)}">${esc(k)} <small>(${c})</small></button>`);
  }
  bar.innerHTML=crumbs.join('<span>›</span>')+(children.length?'<span style="margin:0 6px;opacity:.4">|</span>'+children.join(''):'');
}

function filtered(excludeFacet=''){
  const filterGears=sourceFilterSet('gear',excludeFacet),filterFuels=sourceFilterSet('fuel',excludeFacet),filterBodies=sourceFilterSet('body',excludeFacet);
  let rows=[...state.listings],q=sourceFilterControl('#searchInput')?.value?.toLocaleLowerCase('tr')||'';
  const oppThreshold=view==='opportunities'?+((sourceFilterControl('#oppThresholdSelect')?.value)||10):null;
  if(view==='favorites')rows=rows.filter(l=>l.favorite);
  if(sourceFilterFreshMode()==='24h')rows=rows.filter(l=>l.firstSeen&&Date.now()-l.firstSeen<86400000);
  if(sourceFilterFreshMode()==='30d')rows=rows.filter(l=>l.firstSeen&&Date.now()-l.firstSeen<30*86400000);

  const brandVal=sourceFilterControl('#brandFilter')?.value||'';
  const modelVal=sourceFilterControl('#modelFilter')?.value||'';
  const trimVal=sourceFilterControl('#trimFilter')?.value||(sourceFilterAuto?treeTrim:'')||'';
  const gearVal=sourceFilterControl('#gearFilter')?.value||'';
  const cityVal=sourceFilterControl('#cityFilter')?.value||'';
  const pMin=sourceFilterControl('#priceMin')?.value?+sourceFilterControl('#priceMin').value:null;
  const pMax=sourceFilterControl('#priceMax')?.value?+sourceFilterControl('#priceMax').value:null;
  const yMin=sourceFilterControl('#yearMin')?.value?+sourceFilterControl('#yearMin').value:null;
  const yMax=sourceFilterControl('#yearMax')?.value?+sourceFilterControl('#yearMax').value:null;
  const kMin=sourceFilterControl('#kmMin')?.value?+sourceFilterControl('#kmMin').value:null;
  const kMax=sourceFilterControl('#kmMax')?.value?+sourceFilterControl('#kmMax').value:null;

  if(brandVal||modelVal||trimVal||gearVal||cityVal||pMin!=null||pMax!=null||yMin!=null||yMax!=null||kMin!=null||kMax!=null||q||filterGears.size||filterFuels.size||filterBodies.size){
    rows=rows.filter(l=>{
      if(brandVal&&l.brand!==brandVal) return false;
      if(modelVal){
        const mv=trNorm(modelVal);
        const lm=trNorm(l.model||'');
        const lt=trNorm(l.trim||'');
        const lFull=(lm+' '+lt).replace(/\s+/g,' ');
        if(lm!==mv&&lt!==mv&&lFull!==mv){
          const cleanMv=mv.replace(/[\s\-_]/g,'');
          const cleanFull=lFull.replace(/[\s\-_]/g,'');
          if(!cleanFull.includes(cleanMv)){
            const tokens=mv.split(/\s+/).filter(Boolean);
            const matches=tokens.every(tok=>{
              const cTok=tok.replace(/[\s\-_]/g,'');
              return lFull.includes(tok)||(cTok&&cleanFull.includes(cTok));
            });
            if(!matches) return false;
          }
        }
      }
      if(trimVal){
        const tv=trNorm(trimVal);
        const lt=trNorm(l.trim||'');
        if(l.trim!==trimVal&&lt!==tv) return false;
      }
      if(gearVal&&l.gear!==gearVal) return false;
      if(filterGears.size&&!matchesGear(l,filterGears)) return false;
      if(filterFuels.size&&!matchesFuel(l,filterFuels)) return false;
      if(filterBodies.size&&!matchesBody(l,filterBodies)) return false;
      if(cityVal&&cityOf(l)!==cityVal) return false;
      if(pMin!=null&&(l.price==null||l.price<pMin)) return false;
      if(pMax!=null&&(l.price==null||l.price>pMax)) return false;
      if(yMin!=null&&(l.year==null||l.year<yMin)) return false;
      if(yMax!=null&&(l.year==null||l.year>yMax)) return false;
      if(kMin!=null&&(l.km==null||l.km<kMin)) return false;
      if(kMax!=null&&(l.km==null||l.km>kMax)) return false;
      if(q&&![l.title,l.brand,l.model,l.trim,l.id,l.location].join(' ').toLocaleLowerCase('tr').includes(q)) return false;
      return true;
    });
  }

  const districtVal=sourceFilterControl('#districtFilter')?.value||'';
  if(districtVal)rows=rows.filter(l=>sourceDistrict(l)===districtVal);
  const colorVal=sourceFilterControl('#colorFilter')?.value||'';
  if(colorVal)rows=rows.filter(l=>(l.color||'')===colorVal);
  const sellerVal=sourceFilterControl('#sellerFilter')?.value||'';
  if(sellerVal)rows=rows.filter(l=>sourceSeller(l)===sellerVal);
  const within=Number(sourceFilterControl('#publishedWithin')?.value||0);
  if(within)rows=rows.filter(l=>{const stamp=sourcePublishedStamp(l);return stamp!=null&&Date.now()-stamp<=within*86400000&&stamp<=Date.now();});
  const isHatasizQuick=sourceFilterControl('#hatasizQuickSelect')?.checked;
  const maxPainted=+((sourceFilterControl('#maxPaintedSelect')?.value)||13);
  const maxChanged=+((sourceFilterControl('#maxChangedSelect')?.value)||13);
  const paintlessOnly=sourceFilterControl('#paintlessOnly')?.checked;
  const changelessOnly=sourceFilterControl('#changelessOnly')?.checked;
  const zeroTramerOnly=sourceFilterControl('#zeroTramerOnly')?.checked;
  const tramerMaxVal=sourceFilterControl('#tramerMax')?.value;
  const noHeavyDamage=sourceFilterControl('#noHeavyDamage')?.checked;
  const hideRisk=sourceFilterControl('#hideRisk')?.checked;
  const hideFault=sourceFilterControl('#hideFault')?.checked;
  const hideWarning=sourceFilterControl('#hideWarning')?.checked;
  const hideEnded=sourceFilterControl('#hideEnded')?.checked;
  const hideIncomplete=sourceFilterControl('#hideIncomplete')?.checked;
  const unpaintedParts=sourceFilterChecked('[data-unpainted-part]:checked').map(el=>el.dataset.unpaintedPart);
  const unchangedParts=sourceFilterChecked('[data-unchanged-part]:checked').map(el=>el.dataset.unchangedPart);
  const selectedBadges=sourceFilterChecked('[data-badge-item]:checked').map(el=>el.dataset.badgeItem);
  const badgeMode=sourceFilterControl('#badgeFilterMode')?.value||'exclude';

  const hasConditionFilters=isHatasizQuick||paintlessOnly||changelessOnly||zeroTramerOnly||
    (tramerMaxVal!==''&&tramerMaxVal!=null)||noHeavyDamage||hideRisk||hideFault||hideWarning||
    hideEnded||hideIncomplete||maxPainted<13||maxChanged<13||unpaintedParts.length||unchangedParts.length||selectedBadges.length;

  if(isHatasizQuick){
    rows=rows.filter(l=>{
      const k=getAracKondisyon(l);
      return k.isHatasiz||ilanBilgisineGoreHatasizMi(l).passed;
    });
  }else if(hasConditionFilters){
    rows=rows.filter(l=>{
      const k=getAracKondisyon(l);
      const schema=k.schema;
      const tramer=k.tramer;
      const badges=k.badges;

      if(noHeavyDamage&&k.isHeavy)return false;
      if(zeroTramerOnly&&(!tramer.known||tramer.amount!==0))return false;
      if(tramerMaxVal!==''&&tramerMaxVal!=null){
        const maxLimit=+tramerMaxVal;
        if(tramer.known&&tramer.amount>maxLimit)return false;
        if(!tramer.known&&(hideIncomplete||maxLimit===0))return false;
      }
      if(paintlessOnly&&!k.isPaintless)return false;
      if(changelessOnly&&!k.isChangeless)return false;
      if(maxPainted<13){
        if(schema.boyali>maxPainted)return false;
        if(!schema.schemaComplete&&k.hasPaintDisqualifier&&schema.boyali===0)return false;
      }
      if(maxChanged<13){
        if(schema.degisen>maxChanged)return false;
        if(!schema.schemaComplete&&k.hasChangeDisqualifier&&schema.degisen===0)return false;
      }
      if(unpaintedParts.length||unchangedParts.length){
        if(parcaHaricIhlal(l,unpaintedParts,unchangedParts))return false;
        if(hideIncomplete&&!schema.schemaComplete&&!k.isHatasiz&&!k.isPaintless)return false;
      }
      if(hideRisk&&RISK_ROZETLERI.some(r=>badges.includes(r)))return false;
      if(hideFault&&badges.includes('ariza_masraf'))return false;
      if(hideWarning&&UYARI_ROZETLERI.some(w=>badges.includes(w)))return false;
      if(hideEnded&&['satildi','suresi_doldu','otomatik_kalkti'].some(d=>badges.includes(d)))return false;
      if(hideIncomplete&&!schema.schemaComplete&&!k.isHatasiz&&!k.isPaintless)return false;
      if(selectedBadges.length){
        if(badgeMode==='exclude'&&selectedBadges.some(b=>badges.includes(b)))return false;
        if(badgeMode==='include'&&!selectedBadges.some(b=>badges.includes(b)))return false;
      }
      return true;
    });
  }

  if(sourceFilterControl('#fiveStarOnly')?.checked)rows=rows.filter(besYildizMi);
  const minOppVal=sourceFilterControl('#oppMin')?.value;
  if(minOppVal!==''&&minOppVal!=null)rows=rows.filter(l=>(score(l)??-Infinity)>=+minOppVal);
  const yearlyMax=sourceFilterControl('#yearlyKmMax')?.value;
  if(yearlyMax)rows=rows.filter(l=>{if(l.km==null||!l.year)return false;const age=Math.max(1,new Date().getFullYear()-l.year);return (l.km/age)<=+yearlyMax;});

  if(view==='opportunities'){
    const oppMin=oppThreshold!=null?oppThreshold:10;
    const oppList=[];
    for(let i=0;i<rows.length;i++){
      const sc=score(rows[i]);
      if(sc!=null&&sc>=oppMin){
        oppList.push({item:rows[i],score:sc});
      }
    }
    oppList.sort((a,b)=>b.score-a.score);
    return oppList.map(o=>o.item);
  }

  const sort=sourceFilterControl('#sortSelect')?.value||'new';
  if(sort==='oppDesc'){
    const scored=rows.map(item=>({item,s:score(item)??-Infinity}));
    scored.sort((a,b)=>b.s-a.s);
    return scored.map(o=>o.item);
  }
  if(sort==='priceAsc')rows.sort((a,b)=>(a.price??Infinity)-(b.price??Infinity));
  else if(sort==='priceDesc')rows.sort((a,b)=>(b.price??-Infinity)-(a.price??-Infinity));
  else if(sort==='km')rows.sort((a,b)=>(a.km??Infinity)-(b.km??Infinity));
  else rows.sort((a,b)=>b.firstSeen-a.firstSeen);
  return rows;
}

function safeImage(url){try{const u=new URL(url);return u.protocol==='https:'?esc(u.href):'';}catch{return '';}}

function cardEmsalHtml(item){
  const a=emsalAnalizi(item);
  return '<div class="card-emsal-summary"><span>'+uiIcon('chart')+' Emsal fiyatı</span><strong>'+(a.emsalFiyat?money(a.emsalFiyat):'Veri toplanıyor')+'</strong></div>'+(a.allPeers.length?'<button type="button" class="card-peer-link" data-filter-peers="'+esc(item.id)+'">'+num(a.allPeers.length)+' benzer ilanı gör '+uiIcon('chevron-right')+'</button>':'');
}

function detailEmsalBolumuHtml(item){
  const analiz=emsalAnalizi(item);
  const searchUrl=sahibindenEmsalAramaUrl(item);
  const kond=analiz.itemKond||kondisyonKatsayisi(item);
  const kondYuzde=Math.round((kond.factor-1)*1000)/10;
  const kondAciklama=kond.notes.length?kond.notes.join(' · '):'Standart kondisyon (Boya/Tramer nötr)';

  const summaryHtml=`<div class="detail-fields" style="margin:10px 0 14px">
    <div><dt>Kondisyon Düzeltmeli Emsal</dt><dd><strong>${analiz.emsalFiyat?money(analiz.emsalFiyat):'Yetersiz emsal (<5)'}</strong></dd></div>
    <div><dt>Ham Piyasa Medyanı</dt><dd>${analiz.hamMedyan?money(analiz.hamMedyan):'—'} (${analiz.allPeers.length} aday ilan)</dd></div>
    <div><dt>Boya / Hasar / Risk Çarpanı</dt><dd>${kondYuzde>=0?`+%${kondYuzde}`:`%${kondYuzde}`} (${esc(kondAciklama)})</dd></div>
  </div>`;

  if(!analiz.topPeers.length){
    return `${summaryHtml}<p class="muted">Bu marka/model için yerel veritabanında henüz başka emsal ilan yok. <a class="emsal-ext-link" href="${esc(searchUrl)}" target="_blank" rel="noopener noreferrer">Sahibinden.com Emsal Aramasını Aç ↗</a></p>`;
  }

  const cards=analiz.topPeers.slice(0,6).map((x,idx)=>{
    const p=x.peer;
    const adjDiff=Math.round((x.totalAdjust-1)*100);
    return `<div class="detail-emsal-card">
      <div class="detail-emsal-top">
        <span class="detail-emsal-badge">Emsal #${idx+1} · %${x.uyum} Uyum</span>
        <strong>${money(p.price)}</strong>
      </div>
      <div style="font-weight:600;color:#e2e8f0;line-height:1.4">${esc(p.title||'İlan #'+p.id)}</div>
      <div style="color:#94a3b8;font-size:10.5px">${esc(emsalKisaEtiket(p))} · ${esc(p.gear||'')} ${esc(p.trim||'')}</div>
      <div style="color:#cbd5e1;font-size:10.5px">KM/Boya/Hasar Düzeltmeli Karşılığı: <strong>${money(x.duzeltilmisFiyat)}</strong> (${adjDiff>=0?`+%${adjDiff}`:`%${adjDiff}`})</div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:4px;padding-top:6px;border-top:1px solid #1e293b">
        <button type="button" class="emsal-filter-btn" data-open-peer="${esc(p.id)}">Radar'da Detayını Aç →</button>
        <a class="emsal-ext-link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Sahibinden İlanı ↗</a>
      </div>
    </div>`;
  }).join('');

  return `${summaryHtml}<div class="detail-emsal-grid">${cards}</div><div style="display:flex;gap:12px;align-items:center;margin-bottom:18px"><button type="button" class="button button-outline" data-filter-peers="${esc(item.id)}">Listedeki Tüm Emsalleri Filtrele (${analiz.allPeers.length})</button><a class="button button-outline" href="${esc(searchUrl)}" target="_blank" rel="noopener noreferrer">Sahibinden'de Tüm Emsalleri Gör ↗</a></div>`;
}

function syncQuickChips(){
  const container=$('#quickChipsBar');
  if(!container)return;
  const isFresh=freshMode==='24h';
  const isFiveStar=Boolean($('#fiveStarOnly')?.checked);
  const isHatasiz=Boolean($('#hatasizQuickSelect')?.checked);
  const isPaintless=Boolean($('#paintlessOnly')?.checked);
  const isChangeless=Boolean($('#changelessOnly')?.checked);
  const isNoHeavy=Boolean($('#noHeavyDamage')?.checked);
  const isAutoGear=selectedGears.has('Otomatik')||$('#gearFilter')?.value==='Otomatik';
  const isDiesel=selectedFuels.has('Dizel');
  const isGasoline=selectedFuels.has('Benzin');
  const isSuv=selectedBodies.has('SUV');
  const isSedan=selectedBodies.has('Sedan');
  const isLowKm=$('#kmMax')?.value==='100000';
  const isOpp=$('#oppMin')?.value==='10';
  const isBrandOrModel=Boolean($('#brandFilter')?.value||$('#modelFilter')?.value||$('#trimFilter')?.value);
  const isCity=Boolean($('#cityFilter')?.value);
  const anyActive=isFresh||isFiveStar||isHatasiz||isPaintless||isChangeless||isNoHeavy||isAutoGear||isDiesel||isGasoline||isSuv||isSedan||isLowKm||isOpp||isBrandOrModel||isCity;

  container.querySelector('[data-quick-filter="all"]')?.classList.toggle('active',!anyActive);
  container.querySelector('[data-quick-filter="fresh"]')?.classList.toggle('active',isFresh);
  container.querySelector('[data-quick-filter="fiveStar"]')?.classList.toggle('active',isFiveStar);
  container.querySelector('[data-quick-filter="hatasiz"]')?.classList.toggle('active',isHatasiz);
  container.querySelector('[data-quick-filter="paintless"]')?.classList.toggle('active',isPaintless);
  container.querySelector('[data-quick-filter="changeless"]')?.classList.toggle('active',isChangeless);
  container.querySelector('[data-quick-filter="noHeavy"]')?.classList.toggle('active',isNoHeavy);
  container.querySelector('[data-quick-filter="autoGear"]')?.classList.toggle('active',isAutoGear);
  container.querySelector('[data-quick-filter="diesel"]')?.classList.toggle('active',isDiesel);
  container.querySelector('[data-quick-filter="gasoline"]')?.classList.toggle('active',isGasoline);
  container.querySelector('[data-quick-filter="suv"]')?.classList.toggle('active',isSuv);
  container.querySelector('[data-quick-filter="sedan"]')?.classList.toggle('active',isSedan);
  container.querySelector('[data-quick-filter="lowKm"]')?.classList.toggle('active',isLowKm);
  container.querySelector('[data-quick-filter="opp"]')?.classList.toggle('active',isOpp);
  container.querySelector('[data-quick-filter="opp10"]')?.classList.toggle('active',isOpp);
  container.querySelector('[data-quick-filter="clean_tramer"]')?.classList.toggle('active',isNoHeavy);
  const isTavanOrig = Boolean($('#unpaintedPartsWrap input[data-unpainted-part="tavan"]')?.checked);
  container.querySelector('[data-quick-filter="tavan_orig"]')?.classList.toggle('active',isTavanOrig);
  container.querySelector('[data-quick-filter="price_drop"]')?.classList.toggle('active',$('#sortSelect')?.value==='oppDesc');
}

function renderActiveFilterTags(){
  const bar=$('#activeTagsBar');
  if(!bar)return;
  const tags=[];
  const q=$('#searchInput')?.value.trim();
  if(q)tags.push({label:`Arama: "${q}"`,clear:()=>{$('#searchInput').value='';}});
  
  const brand=$('#brandFilter')?.value;
  const model=$('#modelFilter')?.value;
  const trim=$('#trimFilter')?.value||treeTrim;
  if(brand||model||trim){
    const catText=[brand,model,trim].filter(Boolean).join(' › ');
    tags.push({label:`Kategori: ${catText}`,clear:()=>{setCategorySelection({brand:'',model:'',trim:''});}});
  }

  for(const g of selectedGears){
    tags.push({label:`Vites: ${g}`,clear:()=>{toggleGear(g);}});
  }
  for(const f of selectedFuels){
    tags.push({label:`Yakıt: ${f}`,clear:()=>{toggleFuel(f);}});
  }
  for(const b of selectedBodies){
    tags.push({label:`Kasa: ${b}`,clear:()=>{toggleBody(b);}});
  }

  const gear=$('#gearFilter')?.value;
  if(gear&&!selectedGears.has(gear))tags.push({label:`Vites: ${gear}`,clear:()=>{$('#gearFilter').value='';}});
  const city=$('#cityFilter')?.value;
  if(city)tags.push({label:`İl: ${city}`,clear:()=>{$('#cityFilter').value='';}});
  for(const [id,label] of [['districtFilter','İlçe'],['colorFilter','Renk'],['sellerFilter','Kimden']]){
    const value=$('#'+id)?.value;
    if(value)tags.push({label:label+': '+value,clear:()=>{$('#'+id).value='';sourceCommitFilters();}});
  }
  if($('#publishedWithin')?.value)tags.push({label:'Son '+$('#publishedWithin').value+' gün',clear:()=>{$('#publishedWithin').value='';sourceCommitFilters();}});
  const pMin=$('#priceMin')?.value;
  if(pMin)tags.push({label:`Min: ${num(pMin)} TL`,clear:()=>{$('#priceMin').value='';}});
  const pMax=$('#priceMax')?.value;
  if(pMax)tags.push({label:`Maks: ${num(pMax)} TL`,clear:()=>{$('#priceMax').value='';}});
  const yMin=$('#yearMin')?.value;
  if(yMin)tags.push({label:`Min Yıl: ${yMin}`,clear:()=>{$('#yearMin').value='';}});
  const yMax=$('#yearMax')?.value;
  if(yMax)tags.push({label:`Maks Yıl: ${yMax}`,clear:()=>{$('#yearMax').value='';}});
  const kMin=$('#kmMin')?.value;
  if(kMin)tags.push({label:`Min KM: ${num(kMin)}`,clear:()=>{$('#kmMin').value='';}});
  const kmMax=$('#kmMax')?.value;
  if(kmMax)tags.push({label:`Maks KM: ${num(kmMax)}`,clear:()=>{$('#kmMax').value='';}});
  const oppMin=$('#oppMin')?.value;
  if(oppMin)tags.push({label:`Fırsat: ≥%${oppMin}`,clear:()=>{$('#oppMin').value='';}});
  const strictPreset=$('#hatasizQuickSelect')?.checked;
  if(strictPreset)tags.push({label:'İlan bilgisine göre hatasız',clear:()=>applyHatasizQuickPreset(false)});
  if($('#fiveStarOnly')?.checked)tags.push({label:'★ 5 Yıldız',clear:()=>{$('#fiveStarOnly').checked=false;}});
  if(!strictPreset){
    for(const [id,label] of [['paintlessOnly','Boyasız'],['changelessOnly','Değişensiz'],['noHeavyDamage','Ağır hasarlı hariç'],['zeroTramerOnly','Sıfır tramer'],['hideRisk','Riskli ilanlar hariç'],['hideFault','Arızalı ilanlar hariç'],['hideWarning','Uyarılı ilanlar hariç'],['hideIncomplete','Eksik bilgi hariç']]){
      if($('#'+id)?.checked)tags.push({label,clear:()=>{$('#'+id).checked=false;}});
    }
    for(const [id,label] of [['maxPaintedSelect','En fazla boyalı'],['maxChangedSelect','En fazla değişen']]){
      if($('#'+id)?.value!=='13')tags.push({label:label+': '+$('#'+id).value,clear:()=>{$('#'+id).value='13';}});
    }
  }
  for(const [id,label] of [['tramerMax','Tramer üst sınırı'],['yearlyKmMax','Yıllık km üst sınırı']]){
    if($('#'+id)?.value)tags.push({label:label+': '+num($('#'+id).value),clear:()=>{$('#'+id).value='';}});
  }
  for(const [selector,label] of [['[data-unpainted-part]','Boyasız parça'],['[data-unchanged-part]','Değişensiz parça'],['[data-badge-item]','Rozet']]){
    const chosen=$$(selector+':checked');if(chosen.length)tags.push({label:chosen.length+' '+label.toLocaleLowerCase('tr')+' seçili',clear:()=>chosen.forEach(el=>el.checked=false)});
  }
  if(freshMode==='24h')tags.push({label:'Son 24 Saat',clear:()=>{freshMode='all';$('#allTab').classList.add('active');$('#onlyFreshTab').classList.remove('active');}});

  if(!tags.length){
    bar.hidden=true;
    bar.innerHTML='';
    return;
  }
  bar.hidden=false;
  bar.innerHTML=tags.map((t,idx)=>`<span class="active-tag">${esc(t.label)} <button type="button" data-clear-tag="${idx}" aria-label="${esc(t.label)} filtresini kaldır">✕</button></span>`).join('')+
    `<button type="button" class="clear-all-tags-btn" id="btnRemoveAllTags">Tümünü Temizle</button>`;

  bar.querySelectorAll('[data-clear-tag]').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const idx=+btn.dataset.clearTag;
      if(tags[idx]){
        tags[idx].clear();
        sourceUpdateDistricts();sourceCommitFilters();
        page=1;
        checkHatasizRelaxation();
        syncQuickChips();
        renderList();
      }
    });
  });
  bar.querySelector('#btnRemoveAllTags')?.addEventListener('click',()=>clearFilters());
}

function renderTraderTableRow(l){
  const image=safeImage(l.image),pct=score(l);
  const k=getAracKondisyon(l);
  const hatasiz=ilanBilgisineGoreHatasizMi(l);
  const schema=k.schema;
  const isCleanHatasiz=k.isHatasiz||hatasiz.passed;
  const base=expectedPrice(l);
  const listingUrl=l.url?(l.url.startsWith('http')?l.url:'https://www.sahibinden.com'+l.url):'https://www.sahibinden.com/ilan/'+l.id;

  let badgesHtml = '';
  const tavanStatus = schema.partsMap?.tavan;
  if(tavanStatus === 'Boyalı'){
    badgesHtml += '<span class="st-badge st-badge-danger">Tavan Boyalı</span> ';
  } else if(tavanStatus === 'Değişen'){
    badgesHtml += '<span class="st-badge st-badge-danger">Tavan Değişen</span> ';
  } else if(tavanStatus === 'Orijinal' || isCleanHatasiz || k.isPaintless){
    badgesHtml += '<span class="st-badge st-badge-clean">Tavan Orijinal</span> ';
  }

  if(isCleanHatasiz){
    badgesHtml += '<span class="st-badge st-badge-clean">Hatasız Boyasız</span> ';
  } else if(k.isPaintless){
    badgesHtml += '<span class="st-badge st-badge-clean">Boyasız</span> ';
  } else if(schema.schemaComplete){
    badgesHtml += `<span class="st-badge ${schema.degisen>0?'st-badge-danger':'st-badge-warning'}">${schema.boyali}B ${schema.degisen}D</span> `;
  } else if(k.hasPaintDisqualifier){
    badgesHtml += '<span class="st-badge st-badge-warning">İşlemli</span> ';
  }

  if(k.tramer.known && k.tramer.amount === 0){
    badgesHtml += '<span class="st-badge st-badge-neutral">Tramer: 0 TL</span>';
  } else if(k.tramer.known && k.tramer.amount > 0){
    badgesHtml += `<span class="st-badge st-badge-warning">Tramer: ${k.tramer.label}</span>`;
  }

  let needleLeft = 50;
  let meterDesc = 'Karşılaştırma bekleniyor';
  if(pct != null){
    if(pct >= 0){
      needleLeft = Math.max(8, Math.round(50 - pct * 2.8));
      meterDesc = `%${pct} uygun`;
    } else {
      needleLeft = Math.min(92, Math.round(50 + Math.abs(pct) * 2.5));
      meterDesc = `%${Math.abs(pct)} üzerinde`;
    }
  }

  const meterHtml = `
    <div class="st-meter-meta">
      <span>${base ? money(base) : 'Emsal Bekleniyor'}</span>
      <span class="${pct!=null&&pct>=10?'stitch-telemetry-highlight':''}" style="font-weight:700">${meterDesc}</span>
    </div>
    <div class="st-meter-bar">
      <div class="st-meter-part-green"></div>
      <div class="st-meter-part-mid"></div>
      <div class="st-meter-part-red"></div>
      <div class="st-meter-needle" style="left: ${needleLeft}%"></div>
    </div>
    <div class="st-meter-labels">
      <span>-25% Kelepir</span>
      <span>Medyan</span>
      <span>+20% Pahalı</span>
    </div>
  `;

  let profitHtml = '';
  if(pct != null && base != null && base > l.price){
    const diff = base - l.price;
    profitHtml = `
      <div class="st-profit-val">+${money(diff)}</div>
      <span class="st-profit-pill">%${pct} fiyat farkı</span>
    `;
  } else if(pct != null && pct === 0){
    profitHtml = '<span class="st-profit-neutral">Piyasa Fiyatı</span>';
  } else if(pct != null && pct < 0){
    profitHtml = `<span class="st-profit-neutral" style="color:var(--st-crimson)">-%${Math.abs(pct)} Pahalı</span>`;
  } else {
    profitHtml = '<span class="st-profit-neutral">Analiz Bekleniyor</span>';
  }

  let priceDropHtml = '';
  if(l.price_history && l.price_history.length > 1){
    const prevPrice = l.price_history[l.price_history.length - 2]?.price;
    if(prevPrice && prevPrice > l.price){
      const diff = prevPrice - l.price;
      priceDropHtml = `<div class="st-price-drop">${money(prevPrice)} (-${num(Math.round(diff/1000))}k)</div>`;
    }
  }

  const isChecked = selected.has(l.id);

  return `
    <tr class="st-table-row ${isChecked?'is-selected':''}" data-id="${esc(l.id)}">
      <td class="st-col-check" onclick="event.stopPropagation()">
        <input type="checkbox" data-compare="${esc(l.id)}" ${isChecked?'checked':''}>
      </td>
      <td class="st-thumb-cell">
        <div class="st-thumb-wrap">
          ${image ? `<img class="st-thumb-img" src="${image}" alt="${esc(l.title)}" loading="lazy" referrerpolicy="no-referrer">` : '<svg class="ui-icon" style="color:var(--st-text-muted)"><use href="/assets/ui-icons.svg#icon-car"></use></svg>'}
          ${pct != null && pct >= 12 ? '<span class="st-thumb-tag is-flash">FLAŞ</span>' : (Date.now() - (l.found_at||0) < 86400000 ? '<span class="st-thumb-tag is-new">YENİ</span>' : '')}
        </div>
      </td>
      <td class="st-vehicle-cell">
        <div class="st-vehicle-title">
          <span>${esc([l.year, l.brand, l.model].filter(Boolean).join(' ') || 'Araç')}</span>
          ${l.gear ? `<span class="st-gear-tag">${esc(l.gear)}</span>` : ''}
        </div>
        <div class="st-vehicle-sub">${esc(l.trim || l.title || '')}</div>
      </td>
      <td class="st-km-cell">
        <div class="st-km-val">${l.km != null ? num(l.km) + ' KM' : 'KM Belirtilmedi'}</div>
        <div class="st-city-val">
          <svg class="ui-icon" style="width:12px;height:12px"><use href="/assets/ui-icons.svg#icon-pin"></use></svg>
          ${esc(l.location ? cityOf(l) : 'Konum yok')}
        </div>
      </td>
      <td class="st-damage-cell">
        <div class="st-chips-row">${badgesHtml}</div>
      </td>
      <td class="st-price-cell">
        <div class="st-price-val">${money(l.price)}</div>
        ${priceDropHtml}
      </td>
      <td class="st-meter-cell">
        ${meterHtml}
      </td>
      <td class="st-profit-cell">
        ${profitHtml}
      </td>
      <td class="st-action-cell" onclick="event.stopPropagation()">
        <button type="button" class="st-action-btn" data-action-detail="${esc(l.id)}">İncele</button>
        <a class="st-ext-btn emsal-ext-link" href="${esc(listingUrl)}" target="_blank" rel="noopener noreferrer" title="Sahibinden İlanını Aç">↗</a>
      </td>
    </tr>
  `;
}

function renderList(){
  if(!state)return;
  const rows=filtered(),start=(page-1)*pageSize;
  const end=Math.min(rows.length,start+pageSize);
  $('#resultsCount').textContent=num(rows.length);

  if($('#resultsRangeText')){
    $('#resultsRangeText').textContent=rows.length
      ? `${num(rows.length)} ilandan ${num(start+1)} - ${num(end)} arası listeleniyor`
      : 'Eşleşen ilan bulunamadı';
  }
  if($('#resultsPageBadge')){
    const totalPages=Math.max(1,Math.ceil(rows.length/pageSize));
    $('#resultsPageBadge').textContent=`Sayfa ${page} / ${totalPages}`;
  }

  const slice=rows.slice(start,start+pageSize);

  const viewToggleWrap=$('#stitchViewToggle');
  if(viewToggleWrap){
    viewToggleWrap.querySelectorAll('.stitch-view-btn').forEach(btn=>{
      btn.classList.toggle('active',btn.dataset.viewMode===listingViewMode);
      btn.setAttribute('aria-pressed',String(btn.dataset.viewMode===listingViewMode));
    });
  }

  if(listingViewMode==='table'){
    if($('#listingTableWrap'))$('#listingTableWrap').hidden=false;
    if($('#listingGrid'))$('#listingGrid').hidden=true;
    if($('#traderTableBody'))$('#traderTableBody').innerHTML=slice.map(renderTraderTableRow).join('');
  }else{
    if($('#listingTableWrap'))$('#listingTableWrap').hidden=true;
    if($('#listingGrid'))$('#listingGrid').hidden=false;
    $('#listingGrid').innerHTML=slice.map(l=>{
      const image=safeImage(l.image),pct=score(l),fiveStar=besYildizMi(l);
      const k=getAracKondisyon(l);
      const hatasiz=ilanBilgisineGoreHatasizMi(l);
      const schema=k.schema;
      const isCleanHatasiz=k.isHatasiz||hatasiz.passed;
      const base=expectedPrice(l);

      let topBadgeHtml = '';
      if(pct != null && pct >= 10){
        const diff = base && base > l.price ? (base - l.price) : null;
        topBadgeHtml = `<span class="card-top-label is-opportunity">${uiIcon('bolt')} Emsalden %${pct} uygun</span>`;
      } else if(fiveStar){
        topBadgeHtml = `<span class="card-top-label is-opportunity">${uiIcon('star')} 5 yıldızlı fırsat</span>`;
      } else if(pct != null && pct > 0){
        topBadgeHtml = `<span class="card-top-label">%${pct} Fiyat Avantajı</span>`;
      } else if(pct === 0){
        topBadgeHtml = `<span class="card-top-label">Piyasa Seviyesinde</span>`;
      } else if(pct != null && pct < 0){
        topBadgeHtml = `<span class="card-top-label" style="color:var(--crimson)">Emsalin +%${Math.abs(pct)} Üzerinde</span>`;
      } else {
        topBadgeHtml = `<span class="card-top-label">Analiz Bekleniyor</span>`;
      }

      let tramerHtml = '';
      if(k.tramer.known && k.tramer.amount > 0){
        tramerHtml = `<span class="condition-chip is-damaged">${uiIcon('tag')}${k.tramer.label} tramer</span>`;
      }else if(k.tramer.known && k.tramer.amount === 0){
        tramerHtml = `<span class="condition-chip is-clean">${uiIcon('shield')}0 Tramer</span>`;
      }
      let condHtml = '';
      if(isCleanHatasiz){
        condHtml='<span class="condition-chip is-clean">'+uiIcon('shield')+'İlan bilgisine göre hatasız</span>';
      }else if(k.isPaintless){
        condHtml='<span class="condition-chip is-clean">'+uiIcon('check')+'Boyasız araç</span>';
      }else if(schema.schemaComplete){
        condHtml=`<span class="condition-chip ${schema.degisen>0?'is-damaged':''}">${schema.boyali} boyalı · ${schema.degisen} değişen</span>`;
      }else if(k.hasPaintDisqualifier){
        condHtml='<span class="condition-chip is-damaged">Boyalı / İşlemli</span>';
      }else{
        condHtml='<span class="condition-chip is-unknown">Detay şeması bekleniyor</span>';
      }

      let tavanBadge = '';
      const tavanSt = schema.partsMap?.tavan;
      if(tavanSt === 'Boyalı'){
        tavanBadge = '<span class="condition-chip is-damaged">Tavan Boyalı</span>';
      } else if(tavanSt === 'Değişen'){
        tavanBadge = '<span class="condition-chip is-damaged">Tavan Değişen</span>';
      } else if(tavanSt === 'Orijinal' || isCleanHatasiz || k.isPaintless){
        tavanBadge = '<span class="condition-chip is-clean">Tavan Orijinal</span>';
      }

      let priceDropBadge = '';
      if(l.price_history && l.price_history.length > 1){
        const prevPrice = l.price_history[l.price_history.length - 2]?.price;
        if(prevPrice && prevPrice > l.price){
          const diff = prevPrice - l.price;
          priceDropBadge = `<span class="condition-chip is-damaged">-${num(Math.round(diff/1000))}k Düştü</span>`;
        }
      }

      let needleLeft = 50;
      if(pct != null){
        if(pct >= 0){
          needleLeft = Math.max(8, Math.round(50 - pct * 2.8));
        } else {
          needleLeft = Math.min(92, Math.round(50 + Math.abs(pct) * 2.5));
        }
      }
      const miniMeterHtml = pct != null ? `
        <div class="card-meter-wrap" style="margin:6px 0 8px">
          <div class="st-meter-bar" style="height:5px">
            <div class="st-meter-part-green"></div>
            <div class="st-meter-part-mid"></div>
            <div class="st-meter-part-red"></div>
            <div class="st-meter-needle" style="left:${needleLeft}%"></div>
          </div>
        </div>
      ` : '';

      const cardTitle = [l.year, l.brand, l.model].filter(Boolean).join(' ') || l.title || ('İlan #' + l.id);

      return `<article class="listing-card" data-id="${esc(l.id)}" tabindex="0" role="button" aria-label="${esc(l.title||l.id)} ilanını aç">
        <div class="car-image">${image?`<img src="${image}" alt="${esc(l.title)}" loading="lazy" referrerpolicy="no-referrer">`:'<div class="no-image">'+uiIcon('car')+'<span>Fotoğraf henüz eklenmedi</span></div>'}
          ${topBadgeHtml}
          <button type="button" class="card-favorite ${l.favorite?'saved':''}" data-favorite="${esc(l.id)}" aria-pressed="${!!l.favorite}" aria-label="Favori">${uiIcon('heart')}</button>
        </div>
        <div class="card-content">
          <div class="card-meta">${esc([l.brand,l.model].filter(Boolean).join(' · ')||'Araç ilanı')}</div>
          <h3>${esc(cardTitle)}</h3>
          <p class="card-trim">${esc(l.trim||l.title||'Araç ilanı')}</p>
          <div class="card-specs">
            ${l.year?'<span>'+uiIcon('calendar')+esc(l.year)+'</span>':''}
            ${l.km!=null?'<span>'+uiIcon('gauge')+num(l.km)+' km</span>':''}
            ${l.gear?'<span>'+uiIcon('gear')+esc(l.gear)+'</span>':''}
            ${l.fuel?'<span>'+esc(l.fuel)+'</span>':''}
          </div>
          <div class="card-condition-info">
            ${condHtml}
            ${tavanBadge}
            ${tramerHtml}
            ${priceDropBadge}
          </div>
          <div class="card-price">${money(l.price)}</div>
          ${base ? `<div class="card-emsal-summary"><span>${uiIcon('chart')} Emsal fiyatı</span><strong>${money(base)}</strong></div>` : ''}
          ${miniMeterHtml}
          <div class="card-bottom">
            <span>${uiIcon('pin')}${esc(l.location?cityOf(l):'Konum belirtilmedi')}</span>
            <label class="compare-check" onclick="event.stopPropagation()">
              <input type="checkbox" data-compare="${esc(l.id)}" ${selected.has(l.id)?'checked':''}> Kıyasla
            </label>
          </div>
        </div></article>`;
    }).join('');
  }

  $('#listEmpty').hidden=rows.length>0;
  $('#pagination').hidden=rows.length<=pageSize;
  $('#pageNumber').textContent=`${page} / ${Math.max(1,Math.ceil(rows.length/pageSize))}`;
  $('#prevPage').disabled=page<=1;
  $('#nextPage').disabled=start+pageSize>=rows.length;

  renderActiveFilterTags();
  syncQuickChips();
  updateFilterPresentation(rows.length);

  if(state.listings.length){
    $('#emptyTitle').textContent=view==='favorites'?'Henüz favorin yok.':view==='opportunities'?'Bu eşikte fırsat ilanı bulunamadı.':'Bu kondisyon / filtre seçimine uyan ilan bulunamadı.';
    $('#emptyText').textContent=view==='favorites'?'İlan kartındaki kalbe dokunarak araçları kaydedebilirsin.':view==='opportunities'?'Fırsat eşiğini (%5) düşürebilir veya daha fazla emsal toplanmasını bekleyebilirsin.':'Eksik şema veya tramer verisi Bilinmiyor kabul edildiği için sıkı kondisyon filtrelerinden geçmez; filtreleri gevşetebilir veya ilanı kaynaktan yenileyebilirsin.';
    $('#emptyAction').textContent='Filtreleri temizle';
  }else{
    $('#emptyTitle').textContent='İlk ilanlarını bekliyoruz.';
    $('#emptyText').textContent=state.source.message;
    $('#emptyAction').textContent='Tarama durumunu gör →';
  }
  renderCompareBar();
}

function renderEvents(){
  const minOpp=+($('#liveMinOpp')?.value||0);
  const noHeavy=$('#liveNoHeavyDamage')?.checked;
  const onlyHatasiz=$('#livePaintless')?.checked;
  const listingMap=new Map((state?.listings||[]).map(l=>[l.id,l]));
  const events=(state?.events||[]).filter(e=>{
    if(liveTab==='new'&&e.type!=='new')return false;
    if(liveTab==='price_drop'&&e.type!=='price_drop')return false;
    const item=listingMap.get(e.listing_id);
    if(item){
      if(noHeavy&&parseHeavyDamageInfo(item).heavy)return false;
      if(onlyHatasiz&&!getAracKondisyon(item).isHatasiz&&!ilanBilgisineGoreHatasizMi(item).passed)return false;
      const pct=score(item);
      if(minOpp>0&&pct!=null&&pct<minOpp)return false;
    }
    return true;
  });
  $('#eventList').innerHTML=events.length?events.map(e=>{
    const item=listingMap.get(e.listing_id),pct=item?score(item):null;
    return `<article class="event-row" data-event-id="${esc(e.listing_id)}"><span class="event-icon">${e.type==='price_drop'?'↘':e.type==='new'?'+':'↗'}</span><div><h3>${esc(e.title)} ${pct!=null?`<small>(%${pct} · ${verdictYazisi(pct)})</small>`:''}</h3><p>${esc(e.message)} ${item?.price?`· Güncel fiyat: ${money(item.price)}`:''}</p></div><time>${esc(date(e.at))}</time></article>`;
  }).join(''):'<div class="simple-empty">Bu canlı akış filtresinde kaydedilen ilan hareketi yok.<br>İlk genel yükleme eski ilanları yeni bildirim olarak göstermez.</div>';
}

function countdown(){
  if(!state)return;
  const s=state.source,backoff=s.retryAt&&s.retryAt>Date.now();
  const waiting=s.running&&s.phase==='waiting'&&s.nextRequestAt;
  const counting=s.running&&s.baselineDone&&!s.activeCycle&&!backoff&&s.nextTick;

  if(!s.running){
    $('#countdown').textContent='Durdu';
    $('#tickProgress').value=0;
    $('#tickHint').textContent='Tarama durduruldu';
    return;
  }
  if(backoff){
    const waitSec=Math.max(1,Math.ceil((s.retryAt-Date.now())/1000));
    $('#countdown').textContent=waitSec;
    $('#tickProgress').value=Math.max(0,30-waitSec);
    $('#tickHint').textContent=`Kaynağın bekleme süresi (${waitSec} sn)`;
    return;
  }
  if(s.activeCycle||s.phase==='checking'){
    $('#countdown').textContent='Aktif';
    $('#tickProgress').value=30;
    $('#tickHint').textContent=s.message||'İlanlar taranıyor...';
    return;
  }
  if(waiting){
    const sec=Math.max(1,Math.ceil((s.nextRequestAt-Date.now())/1000));
    $('#countdown').textContent=sec;
    $('#tickProgress').value=Math.max(0,30-sec);
    $('#tickHint').textContent='Sonraki sayfa bekleniyor';
    return;
  }
  if(counting){
    const sec=Math.max(0,Math.ceil((s.nextTick-Date.now())/1000));
    $('#countdown').textContent=sec;
    $('#tickProgress').value=Math.max(0,30-sec);
    $('#tickHint').textContent='Yeni döngüye kalan süre';
    return;
  }
  $('#countdown').textContent='Canlı';
  $('#tickProgress').value=30;
  $('#tickHint').textContent='Tarama aktif çalışıyor';
}

async function yenileTakipEt(id,jobId){
  activeRefreshId=jobId;
  for(let i=0;i<60;i++){
    const pollInterval = i === 0 ? 1000 : (i < 4 ? 2000 : 3500);
    await new Promise(r=>setTimeout(r, pollInterval));
    if(activeRefreshId!==jobId||!$('#detailDialog').open)return;
    try{
      const st=await api(`/api/listings/${encodeURIComponent(id)}/refresh-status?job_id=${encodeURIComponent(jobId)}`);
      const statusEl=$('#refreshJobStatus');
      if(st.status==='failed'){
        if(statusEl)statusEl.textContent=`Yenileme başarısız: ${st.error||'Kaynak yanıt vermedi.'}`;
        toast(st.error||'İlan yenilenemedi.');
        return;
      }
      if(st.status==='done'){
        if(statusEl)statusEl.textContent='Kaynak verisi güncellendi.';
        await refresh();
        await detail(id,true);
        setTimeout(()=>{if($('#detailDialog').open)void detail(id,true);},4000);
        return;
      }
      if(statusEl)statusEl.textContent=`Kaynak işi sürüyor (${st.status}) · Deneme ${i+1}/60…`;
    }catch{return;}
  }
}

function fiyatGecmisiHtml(history){
  if(!history||!history.length)return '<p class="muted">Henüz fiyat gözlemi yok.</p>';
  return history.map((h,idx)=>{
    const prev=idx>0?history[idx-1].price:null;
    const diff=prev!=null&&h.price!=null?h.price-prev:null;
    const diffText=diff==null||diff===0?'':diff<0?` <strong style="color:#4ade80">(${money(diff)} ↘)</strong>`:` <strong style="color:#f87171">(+${money(diff)} ↗)</strong>`;
    return `<div class="history-item"><span>${money(h.price)}${diffText}</span><small>${esc(date(h.at))}</small></div>`;
  }).join('');
}

const KASA_SEMASI_PATHS={
  on_tampon:'M 108,17 L 204,17 L 207,20 L 207,33 L 204,36 L 108,36 L 105,33 L 105,20 L 108,17 Z',
  kaput:'M 141,50 L 178,51 L 192,54 L 202,59 L 206,80 L 208,125 L 191,120 L 171,117 L 140,117 L 120,120 L 103,125 L 104,91 L 109,59 L 122,53 L 141,50 Z',
  tavan:'M 121,209 L 190,209 L 190,259 L 121,259 L 121,209 Z',
  bagaj:'M 107,312 L 120,316 L 142,319 L 179,318 L 204,312 L 206,328 L 193,333 L 174,336 L 150,337 L 129,335 L 118,333 L 105,327 L 107,312 Z',
  arka_tampon:'M 108,353 L 204,353 L 207,356 L 207,369 L 204,372 L 108,372 L 105,369 L 105,356 L 108,353 Z',
  sol_on_camurluk:'M 25,52 L 34,52 L 36,56 L 47,59 L 47,89 L 39,78 L 30,73 L 22,72 L 22,55 L 24,55 L 25,52 Z',
  sol_on_kapi:'M 49,111 L 64,126 L 79,149 L 92,180 L 98,209 L 50,198 L 22,194 L 22,131 L 30,130 L 39,125 L 49,111 Z',
  sol_arka_kapi:'M 22,199 L 98,214 L 98,259 L 50,279 L 46,267 L 39,259 L 30,254 L 22,253 L 22,199 Z',
  sol_arka_camurluk:'M 47,296 L 47,330 L 41,330 L 35,336 L 29,336 L 22,329 L 22,313 L 30,312 L 39,307 L 47,296 Z',
  sag_on_camurluk:'M 277,52 L 286,52 L 286,54 L 289,55 L 289,72 L 281,73 L 272,78 L 264,89 L 264,59 L 275,56 L 277,52 Z',
  sag_on_kapi:'M 261,111 L 271,125 L 280,130 L 288,131 L 288,194 L 260,198 L 212,209 L 218,180 L 227,157 L 243,130 L 261,111 Z',
  sag_arka_kapi:'M 288,199 L 288,253 L 280,254 L 271,259 L 264,267 L 260,279 L 212,259 L 212,214 L 288,199 Z',
  sag_arka_camurluk:'M 264,296 L 272,307 L 281,312 L 289,313 L 289,329 L 282,336 L 276,336 L 270,330 L 264,330 L 264,296 Z'
};
const KAPI_CAM_PATHLERI=[
  'M 63,130 L 74,146 L 83,165 L 91,189 L 94,205 L 63,198 Z',
  'M 63,210 L 95,217 L 95,257 L 63,270 Z',
  'M 248,130 L 237,146 L 228,165 L 220,189 L 217,205 L 248,198 Z',
  'M 248,210 L 216,217 L 216,257 L 248,270 Z'
];
const PART_FILL={
  'Orijinal':'#d4d8e1',
  'Lokal Boyalı':'#f59e0b',
  'Boyalı':'#2563eb',
  'Değişen':'#dc2626',
  'Bilinmiyor':'#e2e8f0'
};

function boyaSemaGorselHtml(schema){
  const partsShapes=ARAC_PARCALARI.map(p=>{
    const st=schema.partsMap[p.key]||'Bilinmiyor';
    const d=KASA_SEMASI_PATHS[p.key];
    const fill=PART_FILL[st]||'#d4d8e1';
    const stroke=st==='Bilinmiyor'?'#94a3b8':'#ffffff';
    const dash=st==='Bilinmiyor'?'stroke-dasharray="4 2"':'';
    return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${dash}><title>${esc(p.label)}: ${esc(st)}</title></path>`;
  }).join('');
  const camShapes=KAPI_CAM_PATHLERI.map(d=>`<path d="${d}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>`).join('');
  const groups={'Lokal Boyalı':[],'Boyalı':[],'Değişen':[]};
  for(const p of ARAC_PARCALARI){
    const st=schema.partsMap[p.key];
    if(groups[st])groups[st].push(p.label);
  }
  let listHtml='';
  for(const [groupName,color] of [['Lokal Boyalı','#f59e0b'],['Boyalı','#2563eb'],['Değişen','#dc2626']]){
    if(groups[groupName].length){
      listHtml+=`<div style="margin-bottom:12px"><div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;color:#1e293b;margin-bottom:6px"><span style="width:12px;height:12px;background:${color};display:inline-block;border-radius:2px"></span>${esc(groupName)}</div><ul style="margin:0;padding-left:20px;color:#334155;font-size:14px;line-height:1.6">${groups[groupName].map(item=>`<li>${esc(item)}</li>`).join('')}</ul></div>`;
    }
  }
  if(!listHtml){
    if(schema.schemaComplete){
      listHtml=`<div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;color:#16a34a;margin-bottom:4px"><span style="width:12px;height:12px;background:#16a34a;display:inline-block;border-radius:2px"></span>Tamamı Orijinal</div><p style="margin:0;color:#475569;font-size:14px">Aracın tüm parçaları orijinaldir. Değişen ve boyalı parçası bulunmamaktadır.</p>`;
    }else{
      listHtml=`<div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;color:#64748b;margin-bottom:4px"><span style="width:12px;height:12px;background:#94a3b8;display:inline-block;border-radius:2px"></span>Şema Verisi Bekleniyor (Bilinmiyor)</div><p style="margin:0;color:#475569;font-size:13.5px">Görsel boya-değişen şeması detay sayfasından otomatik çekiliyor veya "İlanı kaynaktan yenile ↻" düğmesiyle güncellenebilir.</p>`;
    }
  }
  return `<div style="background:#ffffff;color:#1e293b;border-radius:14px;padding:20px;margin:14px 0;display:flex;flex-wrap:wrap;align-items:center;gap:24px;box-shadow:0 4px 16px rgba(0,0,0,0.18)">
    <div style="width:185px;flex-shrink:0;margin:0 auto">
      <svg viewBox="0 0 311 391" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">
        <path d="M 100,45 Q 155,35 211,45 L 214,340 Q 155,350 97,340 Z" fill="#f1f5f9" stroke="#e2e8f0" stroke-width="2"/>
        <path d="M 106,133 L 122,126 L 155,123 L 189,126 L 205,133 L 192,199 L 119,199 Z" fill="#e2e8f0"/>
        <path d="M 121,268 L 190,268 L 202,304 L 109,304 Z" fill="#e2e8f0"/>
        <circle cx="24" cy="101" r="18" fill="#edeff2" stroke="#e2e8f0" stroke-width="2"/>
        <circle cx="24" cy="283" r="18" fill="#edeff2" stroke="#e2e8f0" stroke-width="2"/>
        <circle cx="287" cy="101" r="18" fill="#edeff2" stroke="#e2e8f0" stroke-width="2"/>
        <circle cx="287" cy="283" r="18" fill="#edeff2" stroke="#e2e8f0" stroke-width="2"/>
        ${partsShapes}
        ${camShapes}
      </svg>
    </div>
    <div style="flex:1;min-width:220px">
      ${listHtml}
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:14px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:12px;color:#475569">
        <span style="display:flex;align-items:center;gap:5px"><i style="width:10px;height:10px;background:#d4d8e1;display:inline-block;border-radius:2px"></i>Orijinal</span>
        <span style="display:flex;align-items:center;gap:5px"><i style="width:10px;height:10px;background:#f59e0b;display:inline-block;border-radius:2px"></i>Lokal Boyalı</span>
        <span style="display:flex;align-items:center;gap:5px"><i style="width:10px;height:10px;background:#2563eb;display:inline-block;border-radius:2px"></i>Boyalı</span>
        <span style="display:flex;align-items:center;gap:5px"><i style="width:10px;height:10px;background:#dc2626;display:inline-block;border-radius:2px"></i>Değişen</span>
      </div>
    </div>
  </div>`;
}

async function detail(id,autoFetchAttempted=false){
  try{
    const l=await api('/api/listings/'+encodeURIComponent(id)),image=safeImage(l.image);
    const base=expectedPrice(l),pct=score(l),satar=satarFiyati(base),fiveStar=besYildizMi(l),hatasiz=ilanBilgisineGoreHatasizMi(l);
    const k=getAracKondisyon(l);
    const isCleanHatasiz=k.isHatasiz||hatasiz.passed;
    const listPrice=l.price||0,refPrice=base||listPrice;
    const partsHtml=ARAC_PARCALARI.map(p=>`<div><dt>${esc(p.label)}</dt><dd>${esc(hatasiz.schema.partsMap[p.key])}</dd></div>`).join('');
    const images=[...new Set([image,...(Array.isArray(l.images)?l.images:[])].map(x=>typeof x==='string'?safeImage(x):safeImage(x?.url)).filter(Boolean))];
    const facts=[[uiIcon('calendar'),'Model yılı',l.year||'Belirtilmedi'],[uiIcon('gauge'),'Kilometre',l.km!=null?num(l.km)+' km':'Belirtilmedi'],[uiIcon('gear'),'Vites',l.gear||'Belirtilmedi'],[uiIcon('pin'),'Konum',l.location||'Belirtilmedi']];
    $('#detailContent').innerHTML=`<div class="detail-intro"><p class="eyebrow">${esc([l.brand,l.model].filter(Boolean).join(' / '))} · İLAN #${esc(l.id)}</p><h2 id="detailTitle">${esc(l.title||'İlan detayı')}</h2></div>
      <div class="detail-hero"><div class="detail-gallery">${images.length?'<img id="detailMainImage" src="'+images[0]+'" alt="'+esc(l.title)+'" referrerpolicy="no-referrer">':'<div class="detail-image-empty">'+uiIcon('car')+'<span>Fotoğraf bulunmuyor</span></div>'}<div class="detail-photo-caption"><span>${uiIcon('car')} İlan fotoğrafları</span><span>${images.length} fotoğraf</span></div>${images.length>1?'<div class="gallery-thumbnails">'+images.slice(0,12).map((src,i)=>'<button type="button" data-gallery-src="'+src+'" class="'+(i===0?'active':'')+'" aria-label="'+(i+1)+'. fotoğrafı göster"><img src="'+src+'" alt="" loading="lazy" referrerpolicy="no-referrer"></button>').join('')+'</div>':''}</div>
      <div class="detail-summary"><span class="price-caption">İLAN FİYATI</span><div class="detail-price">${money(l.price)}</div><span class="detail-score ${pct>0?'positive':''}">${pct==null?'Fiyat analizi için veri bekleniyor':pct>0?'Emsallere göre %'+pct+' avantajlı':pct===0?'Emsal fiyatına yakın':'Emsalin %'+Math.abs(pct)+' üzerinde'}</span>
      <div class="detail-market"><div><span>Emsal fiyatı</span><strong>${base?money(base):'Yeterli veri yok'}</strong></div><div><span>Örnek satış hedefi <small>Emsalden %6 düşük</small></span><strong>${satar?money(satar):'—'}</strong></div></div>
      <dl class="detail-key-facts">${facts.map(([i,k,v])=>'<div>'+i+'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')}</dl>
      <a class="button button-primary detail-source-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">Kaynak ilanı aç ${uiIcon('arrow-up-right')}</a>
      <div class="detail-secondary-actions"><button type="button" class="button button-outline" data-detail-favorite="${esc(l.id)}">${uiIcon('heart')} ${l.favorite?'Favoriden çıkar':'Favoriye ekle'}</button><button class="button button-outline detayYenileBtn" id="refreshListingBtn" data-id="${esc(l.id)}">${uiIcon('refresh')} Bilgileri yenile</button></div>
      <p class="detail-updated">${uiIcon('clock')} Son kontrol: ${esc(date(l.lastChecked||l.firstSeen))}<span id="refreshJobStatus"></span></p></div></div>
      <nav class="detail-section-nav" aria-label="İlan bölümleri">${[['detailCondition','Araç durumu'],['detailPeers','Emsaller'],['detailSpecs','Özellikler'],['detailDescription','Açıklama'],['detailHistory','Fiyat geçmişi'],['detailProfit','Al-sat hesabı']].map(([id,label])=>'<button type="button" data-detail-section="'+id+'">'+label+'</button>').join('')}</nav>
      <section class="detail-block" id="detailCondition"><div class="detail-block-heading"><div><span class="eyebrow">BOYA, DEĞİŞEN VE HASAR</span><h3>Aracın kondisyonu</h3></div><span class="condition-chip ${isCleanHatasiz?'is-clean':'is-unknown'}">${isCleanHatasiz?'Hatasız seçimine uygun':'Bilgileri incele'}</span></div>
      <div class="condition-facts"><div><span>Boyalı parça</span><strong>${hatasiz.schema.schemaComplete?num(hatasiz.schema.boyali):(k.isPaintless?'0 (Beyan: Boyasız)':'Bilinmiyor')}</strong></div><div><span>Değişen parça</span><strong>${hatasiz.schema.schemaComplete?num(hatasiz.schema.degisen):(k.isChangeless?'0 (Beyan: Değişensiz)':'Bilinmiyor')}</strong></div><div><span>Tramer tutarı</span><strong>${esc(hatasiz.tramer.known?hatasiz.tramer.label:(k.isZeroTramer?'Sıfır / Yok':'Bilinmiyor'))}</strong></div><div><span>Ağır hasar</span><strong>${esc(hatasiz.heavy.known?hatasiz.heavy.label:(k.isHeavy?'Ağır hasar belirtilmiş':'Yok / Belirtilmemiş'))}</strong></div></div>
      ${hatasiz.badges.length?'<div class="detail-risk-tags">'+hatasiz.badges.map(b=>'<span>'+esc(badgeNames[b]||b.replaceAll('_',' '))+'</span>').join('')+'</div>':''}
      ${k.isHatasiz&&!hatasiz.passed?'<p class="filter-help" style="color:#10b981">✓ Satıcı başlık ve açıklamasında aracın hatasız/boyasız olduğunu beyan etmiştir.</p>':'<p class="filter-help">Kondisyon bilgileri ilandan alınır. Ekspertiz sonucu değildir.</p>'}
      <div class="condition-diagram">${boyaSemaGorselHtml(hatasiz.schema)}</div><details class="detail-disclosure"><summary>Parçaları tek tek incele ${uiIcon('chevron-down')}</summary><dl class="detail-fields">${partsHtml}</dl></details>${!isCleanHatasiz?'<details class="detail-disclosure"><summary>Hatasız filtresinden neden geçmiyor? '+uiIcon('chevron-down')+'</summary><ul class="condition-reasons">'+hatasiz.reasons.map(r=>'<li>'+esc(r)+'</li>').join('')+'</ul></details>':''}</section>
      <section class="detail-block" id="detailPeers"><div class="detail-block-heading"><div><span class="eyebrow">PİYASAYLA KARŞILAŞTIR</span><h3>Benzer ilanlar</h3></div></div>${detailEmsalBolumuHtml(l)}</section>
      <section class="detail-block" id="detailSpecs"><div class="detail-block-heading"><h3>Araç özellikleri</h3></div><dl class="detail-fields">${Object.entries(l.fields||{}).filter(([k])=>k!=='Parça Şeması').map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')||'<p class="muted">Özellik bilgileri henüz okunmadı.</p>'}</dl></section>
      <section class="detail-block" id="detailDescription"><div class="detail-block-heading"><h3>Satıcının açıklaması</h3></div><p class="detail-description">${esc(l.description||'Açıklama henüz kaynaktan okunmadı.')}</p></section>
      <section class="detail-block" id="detailHistory"><div class="detail-block-heading"><h3>Fiyat geçmişi</h3><span class="quiet">${(l.history||[]).length} gözlem</span></div><div class="history">${fiyatGecmisiHtml(l.history)}</div></section>
      <section class="detail-block" id="detailProfit"><div class="detail-block-heading"><div><span class="eyebrow">MASRAFLARI DA HESABA KAT</span><h3>Al-sat hesabı</h3></div></div><div class="profit-inputs"><label>Pazarlık (%)<input type="number" id="alsatBargain" value="3" min="0" max="40" step="0.5"></label><label>Hedef satış indirimi (%)<input type="number" id="alsatDiscount" value="6" min="0" max="40" step="0.5"></label><label>Ekspertiz (TL)<input type="number" id="alsatExp" value="10000" min="0" step="500"></label><label>Diğer masraflar (TL)<input type="number" id="alsatOther" value="10000" min="0" step="500"></label><label>Alıcı türü<select id="alsatBuyerType"><option value="bireysel">Bireysel</option><option value="esnaf">Esnaf / galeri</option></select></label></div><div class="detail-fields" id="alsatResultFields"></div></section>`;
    const updateAlSat=()=>{
      const bargain=+($('#alsatBargain')?.value||3),discount=+($('#alsatDiscount')?.value||6),exp=+($('#alsatExp')?.value||10000),other=+($('#alsatOther')?.value||10000),buyer=$('#alsatBuyerType')?.value||'bireysel';
      const buy=listPrice?Math.round(listPrice*(1-bargain/100)):0;
      const sell=refPrice?Math.round((refPrice*(1-discount/100))/1000)*1000:0;
      const notary=buy?(buyer==='esnaf'?2500:Math.round(Math.max(1000,buy*0.002)+1970)):0;
      const net=sell-buy-exp-other-notary;
      const roi=buy>0?Math.round(1000*net/buy)/10:0;
      if($('#alsatResultFields')){
        $('#alsatResultFields').innerHTML=`<div><dt>Pazarlıklı Alış (%${bargain})</dt><dd>${buy?money(buy):'—'}</dd></div><div><dt>Hedef Satış (%${discount} iskonto)</dt><dd>${sell?money(sell):'—'}</dd></div><div><dt>Noter + Ekspertiz + Diğer</dt><dd>${buy?`${money(notary+exp+other)} (Noter: ${money(notary)})`:'—'}</dd></div><div><dt>Tahmini Net Kâr</dt><dd><strong>${buy&&sell?`${money(net)} (%${roi})`:'Fiyat bekleniyor'}</strong></dd></div>`;
      }
    };
    updateAlSat();
    ['#alsatBargain','#alsatDiscount','#alsatExp','#alsatOther','#alsatBuyerType'].forEach(sel=>$(sel)?.addEventListener('input',updateAlSat));
    const startRefresh=async()=>{
      const btn=$('#refreshListingBtn');if(btn)btn.disabled=true;
      try{
        const job=await api(`/api/listings/${encodeURIComponent(id)}/refresh`,{});
        if($('#refreshJobStatus'))$('#refreshJobStatus').textContent=`· Görsel boya şeması ve detay kaynaktan çekiliyor (İş #${job.job_id})…`;
        void yenileTakipEt(id,job.job_id);
      }catch(err){toast(err.message);if(btn)btn.disabled=false;}
    };
    $('#refreshListingBtn')?.addEventListener('click',startRefresh);
    if(!$('#detailDialog').open)$('#detailDialog').showModal();
    if(!hatasiz.schema.schemaComplete&&!autoFetchAttempted){
      void startRefresh();
    }
  }catch(e){toast(e.message);}
}

function renderCompareBar(){
  const bar = $('#compareBar');
  if(!bar) return;
  bar.hidden = selected.size === 0;
  if(selected.size === 0) return;

  if($('#compareCount')) $('#compareCount').textContent = selected.size;
  if($('#compareCountBadge')) $('#compareCountBadge').innerHTML = `<strong>${selected.size}</strong> ARAÇ SEÇİLDİ`;
  if($('#compareButton')) $('#compareButton').disabled = selected.size < 2;

  const selectedListings = (state?.listings || []).filter(l => selected.has(l.id));
  let totalProfit = 0;
  let totalCapital = 0;

  const chipsHtml = selectedListings.map(l => {
    const base = expectedPrice(l);
    if(base && l.price && base > l.price) totalProfit += (base - l.price);
    if(l.price) totalCapital += l.price;
    const title = [l.year, l.brand, l.model].filter(Boolean).join(' ') || ('İlan #' + l.id);
    return `
      <div class="st-dock-car-chip">
        <span>${esc(title)}</span>
        <strong>${money(l.price)}</strong>
        <button type="button" data-remove-compare="${esc(l.id)}" title="Seçimi Kaldır">✕</button>
      </div>
    `;
  }).join('');

  if($('#compareChipsList')) $('#compareChipsList').innerHTML = chipsHtml;
  if($('#dockCombinedProfit')){
    if(totalProfit > 0){
      const marginPct = totalCapital > 0 ? (Math.round((totalProfit / totalCapital) * 1000) / 10) : 0;
      $('#dockCombinedProfit').textContent = `+${money(totalProfit)} (%${marginPct})`;
    } else {
      $('#dockCombinedProfit').textContent = money(totalCapital);
    }
  }
}

function clearFilters(){
  $('#searchInput').value='';
  ['#brandFilter','#modelFilter','#trimFilter','#gearFilter','#cityFilter','#districtFilter','#colorFilter','#sellerFilter','#publishedWithin','#priceMin','#priceMax','#yearMin','#yearMax','#kmMin','#kmMax','#yearlyKmMax','#oppMin','#tramerMax'].forEach(id=>{if($(id))$(id).value='';});
  selectedGears.clear();
  selectedFuels.clear();
  selectedBodies.clear();
  $$('.filter-chip-btn').forEach(btn=>btn.classList.remove('active'));
  updateCategoryLabels();
  if($('#maxPaintedSelect'))$('#maxPaintedSelect').value='13';
  if($('#maxChangedSelect'))$('#maxChangedSelect').value='13';
  ['#hatasizQuickSelect','#zeroTramerOnly','#noHeavyDamage','#paintlessOnly','#changelessOnly','#hideRisk','#hideFault','#hideWarning','#hideIncomplete','#fiveStarOnly'].forEach(id=>{if($(id))$(id).checked=false;});
  if($('#hideEnded'))$('#hideEnded').checked=true;
  $$('[data-unpainted-part],[data-unchanged-part],[data-badge-item]').forEach(el=>el.checked=false);
  $$('.source-check[role=checkbox]').forEach(el=>el.setAttribute('aria-checked','false'));
  conditionMode='standard';
  updateConditionModeUI();
  treeTrim='';
  freshMode='all';
  $('#allTab').classList.add('active');
  $('#onlyFreshTab').classList.remove('active');
  $('#monthOppTab')?.classList.remove('active');
  rozetKayitYaz({});
  page=1;
  updateSelectors();
  agacOlustur();
  syncQuickChips();
  sourceUpdateDistricts();
  sourceCommitFilters();
  renderList();
}

function renderValuationHistory(){
  const container=$('#valuationHistoryList');
  if(!container)return;
  const items=dgkOku();
  if(!items.length){container.innerHTML='<p class="muted">Henüz kaydedilmiş değerleme yok.</p>';return;}
  container.innerHTML=items.slice(0,10).map((it,idx)=>`<div class="history-item" style="cursor:pointer" data-dgk-idx="${idx}"><span><strong>${esc(it.brand)} ${esc(it.model)}</strong> (${it.year}) · Ort: ${money(it.base)} · Satılabilir: ${money(it.sellLevel)}</span><small>${esc(date(it.at))}</small></div>`).join('');
}

function initPartAndBadgeCheckboxes(){
  const unp=$('#unpaintedPartsWrap'),unch=$('#unchangedPartsWrap'),bdg=$('#badgeListWrap');
  if(unp)unp.innerHTML=ARAC_PARCALARI.map(p=>`<label style="font-size:12px"><input type="checkbox" data-unpainted-part="${esc(p.key)}"> ${esc(p.label)}</label>`).join('');
  if(unch)unch.innerHTML=ARAC_PARCALARI.map(p=>`<label style="font-size:12px"><input type="checkbox" data-unchanged-part="${esc(p.key)}"> ${esc(p.label)}</label>`).join('');
  if(bdg)bdg.innerHTML=TUM_ROZETLER.map(b=>`<label style="font-size:12px"><input type="checkbox" data-badge-item="${esc(b.key)}"> ${esc(badgeNames[b.key]||b.key)}</label>`).join('');
}
initPartAndBadgeCheckboxes();

$$('.nav-item[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
['#sourceShortcut','#bannerAction'].forEach(id=>$(id).addEventListener('click',()=>switchView('system')));
$('#emptyAction').addEventListener('click',()=>state?.listings.length?clearFilters():switchView('system'));

$('#hatasizQuickSelect')?.addEventListener('change',e=>{
  applyHatasizQuickPreset(e.target.checked);
  page=1;
  if(state)renderList();
});

const filterControls=['#searchInput','#brandFilter','#modelFilter','#trimFilter','#gearFilter','#cityFilter','#districtFilter','#colorFilter','#sellerFilter','#publishedWithin','#sortSelect','#priceMin','#priceMax','#yearMin','#yearMax','#kmMin','#kmMax','#yearlyKmMax','#oppMin','#oppThresholdSelect','#maxPaintedSelect','#maxChangedSelect','#tramerMax','#zeroTramerOnly','#noHeavyDamage','#paintlessOnly','#changelessOnly','#hideRisk','#hideFault','#hideWarning','#hideEnded','#hideIncomplete','#fiveStarOnly','#badgeFilterMode'];
filterControls.forEach(id=>$(id)?.addEventListener(id==='#searchInput'?'input':'change',()=>{
  if(id==='#cityFilter'){if($('#districtFilter'))$('#districtFilter').value='';sourceUpdateDistricts();}
  if(id==='#brandFilter'){$('#modelFilter').value='';$('#trimFilter').value='';treeTrim='';updateSelectors();}
  if(id==='#modelFilter'){$('#trimFilter').value='';treeTrim='';}
  checkHatasizRelaxation();
  rozetKayitYaz({
    noHeavyDamage:$('#noHeavyDamage')?.checked||false,
    paintlessOnly:$('#paintlessOnly')?.checked||false,
    changelessOnly:$('#changelessOnly')?.checked||false,
    zeroTramerOnly:$('#zeroTramerOnly')?.checked||false,
    hideRisk:$('#hideRisk')?.checked||false,
    hideFault:$('#hideFault')?.checked||false,
    hideWarning:$('#hideWarning')?.checked||false,
    hideEnded:$('#hideEnded')?.checked??true,
    hideIncomplete:$('#hideIncomplete')?.checked||false,
    fiveStarOnly:$('#fiveStarOnly')?.checked||false
  });
  page=1;
  agacOlustur();
  if(state)renderList();
}));

$('#advancedFilters')?.addEventListener('change',e=>{
  if(e.target.matches('[data-unpainted-part],[data-unchanged-part],[data-badge-item]')){
    page=1;
    if(state)renderList();
  }
});

// Update the visible result count while a budget or range is being entered.
let rangeFilterTimer;
$('#advancedFilters')?.addEventListener('input',e=>{
  if(!e.target.matches('input[type="number"]'))return;
  clearTimeout(rangeFilterTimer);
  rangeFilterTimer=setTimeout(()=>{page=1;if(state)renderList();},250);
});

$('#categoryTreeBar')?.addEventListener('click',e=>{
  const levelBtn=e.target.closest('[data-tree-level]');
  if(levelBtn){
    const lv=levelBtn.dataset.treeLevel;
    if(lv==='root'){$('#brandFilter').value='';$('#modelFilter').value='';$('#trimFilter').value='';treeTrim='';}
    else if(lv==='brand'){$('#modelFilter').value='';$('#trimFilter').value='';treeTrim='';}
    else if(lv==='model'){$('#trimFilter').value='';treeTrim='';}
    page=1;updateCategoryLabels();updateSelectors();agacOlustur();renderList();return;
  }
  const bBtn=e.target.closest('[data-tree-brand]');
  if(bBtn){$('#brandFilter').value=bBtn.dataset.treeBrand;$('#modelFilter').value='';$('#trimFilter').value='';treeTrim='';page=1;updateCategoryLabels();updateSelectors();agacOlustur();renderList();return;}
  const mBtn=e.target.closest('[data-tree-model]');
  if(mBtn){$('#modelFilter').value=mBtn.dataset.treeModel;$('#trimFilter').value='';treeTrim='';page=1;updateCategoryLabels();agacOlustur();renderList();return;}
  const tBtn=e.target.closest('[data-tree-trim]');
  if(tBtn){$('#trimFilter').value=tBtn.dataset.treeTrim;treeTrim=tBtn.dataset.treeTrim;page=1;updateCategoryLabels();agacOlustur();renderList();}
});

function sourceFilterDesktop(){return matchMedia('(min-width:1100px)').matches;}
function setFilterSheetOpen(isOpen){
  const sheet=$('#advancedFilters'),backdrop=$('#filterBackdrop');
  if(sourceFilterDesktop()){
    sheet.hidden=false;sheet.setAttribute('role','region');sheet.removeAttribute('aria-modal');
    if(backdrop)backdrop.hidden=true;
    document.body.classList.remove('filters-open');document.body.style.overflow='';return;
  }
  if(isOpen)filterReturnFocus=document.activeElement;
  sheet.hidden=!isOpen;if(backdrop)backdrop.hidden=!isOpen;
  sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');
  $('#filterToggle')?.setAttribute('aria-expanded',String(isOpen));
  document.body.classList.toggle('filters-open',isOpen);document.body.style.overflow=isOpen?'hidden':'';
  if(isOpen)$('#closeFilterSheet').focus();else filterReturnFocus?.focus();
}
$('#filterToggle')?.addEventListener('click',()=>setFilterSheetOpen($('#advancedFilters').hidden));
$('#mobileFilterBtn')?.addEventListener('click',()=>setFilterSheetOpen(true));
$('#closeFilterSheet')?.addEventListener('click',()=>setFilterSheetOpen(false));
$('#filterBackdrop')?.addEventListener('click',()=>setFilterSheetOpen(false));
$('#applyFiltersBtn')?.addEventListener('click',()=>{sourceCommitFilters();page=1;renderList();if(!sourceFilterDesktop())setFilterSheetOpen(false);});

$('#pageSizeSelect')?.addEventListener('change',e=>{
  pageSize=+e.target.value||24;
  page=1;
  renderList();
});

function initQuickChips(){
  const container=$('#quickChipsBar');
  if(!container)return;
  container.addEventListener('click',e=>{
    const btn=e.target.closest('[data-quick-filter]');
    if(!btn)return;
    const filter=btn.dataset.quickFilter;
    if(filter==='all'){
      clearFilters();
      return;
    }
    if(filter==='fresh'){
      freshMode=freshMode==='24h'?'all':'24h';
      $('#allTab')?.classList.toggle('active',freshMode==='all');
      $('#onlyFreshTab')?.classList.toggle('active',freshMode==='24h');
    }else if(filter==='fiveStar'){
      if($('#fiveStarOnly'))$('#fiveStarOnly').checked=!$('#fiveStarOnly').checked;
    }else if(filter==='hatasiz'){
      const next=!$('#hatasizQuickSelect')?.checked;
      applyHatasizQuickPreset(next);
    }else if(filter==='paintless'){
      if($('#paintlessOnly'))$('#paintlessOnly').checked=!$('#paintlessOnly').checked;
    }else if(filter==='changeless'){
      if($('#changelessOnly'))$('#changelessOnly').checked=!$('#changelessOnly').checked;
    }else if(filter==='noHeavy'){
      if($('#noHeavyDamage'))$('#noHeavyDamage').checked=!$('#noHeavyDamage').checked;
    }else if(filter==='autoGear'){
      toggleGear('Otomatik');
      return;
    }else if(filter==='diesel'){
      toggleFuel('Dizel');
      return;
    }else if(filter==='gasoline'){
      toggleFuel('Benzin');
      return;
    }else if(filter==='suv'){
      toggleBody('SUV');
      return;
    }else if(filter==='sedan'){
      toggleBody('Sedan');
      return;
    }else if(filter==='lowKm'){
      if($('#kmMax'))$('#kmMax').value=$('#kmMax').value==='100000'?'':'100000';
    }else if(filter==='opp'||filter==='opp10'){
      if($('#oppMin'))$('#oppMin').value=$('#oppMin').value==='10'?'':'10';
    }else if(filter==='clean_tramer'){
      const next=!$('#noHeavyDamage')?.checked;
      if($('#noHeavyDamage'))$('#noHeavyDamage').checked=next;
      if($('#zeroTramerOnly'))$('#zeroTramerOnly').checked=next;
    }else if(filter==='tavan_orig'){
      const unp=$('#unpaintedPartsWrap input[data-unpainted-part="tavan"]');
      if(unp) unp.checked=!unp.checked;
    }else if(filter==='price_drop'){
      if($('#sortSelect'))$('#sortSelect').value=$('#sortSelect').value==='oppDesc'?'new':'oppDesc';
    }
    checkHatasizRelaxation();
    page=1;
    syncQuickChips();
    renderList();
  });
}
initQuickChips();

$('#categoryTriggerBtn')?.addEventListener('click',()=>openCategoryModal('filter'));
$('#sheetChangeCatBtn')?.addEventListener('click',()=>openCategoryModal('filter'));
$('#sheetClearCatBtn')?.addEventListener('click',()=>{
  setCategorySelection({brand:'',model:'',trim:''},'filter');
});
$('#catModalBackdrop')?.addEventListener('click',closeCategoryModal);
$('#closeCatModal')?.addEventListener('click',closeCategoryModal);
$('#catModalDoneBtn')?.addEventListener('click',closeCategoryModal);
$('#catModalClearBtn')?.addEventListener('click',()=>{
  setCategorySelection({brand:'',model:'',trim:''},modalTarget);
  closeCategoryModal();
});
$('#catSearchInput')?.addEventListener('input',e=>{
  const val=e.target.value;
  if($('#catSearchClear'))$('#catSearchClear').hidden=!val;
  clearTimeout(catSearchDebounce);
  catSearchDebounce=setTimeout(()=>{
    performCategorySearch(val);
  },120);
});
$('#catSearchClear')?.addEventListener('click',()=>{
  if($('#catSearchInput'))$('#catSearchInput').value='';
  if($('#catSearchClear'))$('#catSearchClear').hidden=true;
  renderCatModalView();
  $('#catSearchInput')?.focus();
});
$('#catBreadcrumbs')?.addEventListener('click',async e=>{
  const crumb=e.target.closest('[data-cat-crumb]');
  if(!crumb)return;
  const level=crumb.dataset.catCrumb;
  if(level==='root'){
    modalNavBrand='';
    modalNavSeries='';
  }else if(level==='brand'){
    modalNavSeries='';
  }
  if($('#catSearchInput'))$('#catSearchInput').value='';
  if($('#catSearchClear'))$('#catSearchClear').hidden=true;
  await renderCatModalView();
});
$('#catItemsList')?.addEventListener('click',async e=>{
  const pickBtn=e.target.closest('[data-cat-pick-brand]');
  if(pickBtn){
    const brand=pickBtn.dataset.catPickBrand||'';
    const model=pickBtn.dataset.catPickModel||'';
    const trim=pickBtn.dataset.catPickTrim||'';
    setCategorySelection({brand,model,trim},modalTarget);
    closeCategoryModal();
    return;
  }
  if(e.target.closest('[data-cat-select-all]')){
    setCategorySelection({brand:'',model:'',trim:''},modalTarget);
    closeCategoryModal();
    return;
  }
  const brandNav=e.target.closest('[data-cat-brand-nav]');
  if(brandNav){
    modalNavBrand=brandNav.dataset.catBrandNav;
    modalNavSeries='';
    await renderCatModalView();
    return;
  }
  const selBrand=e.target.closest('[data-cat-select-brand]');
  if(selBrand){
    setCategorySelection({brand:selBrand.dataset.catSelectBrand,model:'',trim:''},modalTarget);
    closeCategoryModal();
    return;
  }
  const seriesNav=e.target.closest('[data-cat-series-nav]');
  if(seriesNav){
    modalNavSeries=seriesNav.dataset.catSeriesNav;
    await renderCatModalView();
    return;
  }
  const selSeries=e.target.closest('[data-cat-select-series]');
  if(selSeries){
    setCategorySelection({brand:modalNavBrand,model:selSeries.dataset.catSelectSeries,trim:''},modalTarget);
    closeCategoryModal();
    return;
  }
  const selTrim=e.target.closest('[data-cat-select-trim]');
  if(selTrim){
    setCategorySelection({brand:modalNavBrand,model:modalNavSeries,trim:selTrim.dataset.catSelectTrim},modalTarget);
    closeCategoryModal();
    return;
  }
});
initChipGroups();

$('#clearFilters')?.addEventListener('click',clearFilters);
$('#allTab')?.addEventListener('click',()=>{freshMode='all';$('#allTab').classList.add('active');$('#onlyFreshTab').classList.remove('active');$('#monthOppTab')?.classList.remove('active');page=1;renderList();});
$('#onlyFreshTab')?.addEventListener('click',()=>{freshMode='24h';$('#onlyFreshTab').classList.add('active');$('#allTab').classList.remove('active');$('#monthOppTab')?.classList.remove('active');page=1;renderList();});
$('#monthOppTab')?.addEventListener('click',()=>{freshMode='30d';$('#monthOppTab').classList.add('active');$('#allTab').classList.remove('active');$('#onlyFreshTab').classList.remove('active');page=1;renderList();});
$('#prevPage')?.addEventListener('click',()=>{page--;renderList();window.scrollTo({top:0,behavior:'smooth'});});
$('#nextPage')?.addEventListener('click',()=>{page++;renderList();window.scrollTo({top:0,behavior:'smooth'});});

$$('[data-live-tab]').forEach(btn=>btn.addEventListener('click',()=>{
  liveTab=btn.dataset.liveTab;
  $$('[data-live-tab]').forEach(b=>b.classList.toggle('active',b===btn));
  renderEvents();
}));
$('#saveLiveSettings')?.addEventListener('click',()=>{
  try{
    localStorage.setItem('arac_radar_canli_esik',JSON.stringify({
      minOpp:+($('#liveMinOpp')?.value||0),
      noHeavy:$('#liveNoHeavyDamage')?.checked||false,
      paintless:$('#livePaintless')?.checked||false
    }));
  }catch{}
  renderEvents();
  toast('Canlı bildirim ve izleme eşiği kaydedildi.');
});

function emsalleriFiltrele(listingId){
  const item=(state?.listings||[]).find(x=>x.id===listingId);
  if(!item)return;
  clearFilters();
  switchView('listings');
  if(item.brand){
    $('#brandFilter').value=item.brand;
    updateSelectors();
  }
  if(item.model&&$('#modelFilter'))$('#modelFilter').value=item.model;
  if(item.year){
    if($('#yearMin'))$('#yearMin').value=String(item.year-1);
    if($('#yearMax'))$('#yearMax').value=String(item.year+1);
  }
  page=1;
  agacOlustur();
  renderList();
  toast(`${[item.brand,item.model,item.year?`(${item.year-1}–${item.year+1})`:''].filter(Boolean).join(' ')} emsalleri filtrelendi.`);
}

$('#listingGrid').addEventListener('click',async e=>{
  if(e.target.closest('.emsal-ext-link')){
    e.stopPropagation();
    return;
  }
  const openPeer=e.target.closest('[data-open-peer]');
  if(openPeer){
    e.stopPropagation();
    detail(openPeer.dataset.openPeer);
    return;
  }
  const filterPeers=e.target.closest('[data-filter-peers]');
  if(filterPeers){
    e.stopPropagation();
    emsalleriFiltrele(filterPeers.dataset.filterPeers);
    return;
  }
  const favorite=e.target.closest('[data-favorite]'),check=e.target.closest('[data-compare]');
  if(favorite){
    e.stopPropagation();
    try{
      const l=state.listings.find(l=>l.id===favorite.dataset.favorite);
      await api('/api/favorites/'+l.id,{active:!l.favorite});
      await refresh();
    }catch(err){toast(err.message);}
    return;
  }
  if(e.target.closest('.compare-check')){
    if(check){
      const id=check.dataset.compare;
      if(check.checked){
        if(selected.size>=2){
          const oldest=selected.values().next().value;
          selected.delete(oldest);
        }
        selected.add(id);
      }else{
        selected.delete(id);
      }
      renderList();
    }
    return;
  }
  const card=e.target.closest('[data-id]');
  if(card)detail(card.dataset.id);
});
$('#detailContent')?.addEventListener('click',e=>{
  const openPeer=e.target.closest('[data-open-peer]');
  if(openPeer){
    e.preventDefault();
    detail(openPeer.dataset.openPeer);
    return;
  }
  const filterPeers=e.target.closest('[data-filter-peers]');
  if(filterPeers){
    e.preventDefault();
    $('#detailDialog').close();
    emsalleriFiltrele(filterPeers.dataset.filterPeers);
  }
});
$('#listingGrid').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.listing-card')){e.preventDefault();detail(e.target.dataset.id);}});
$('#eventList').addEventListener('click',e=>{const row=e.target.closest('[data-event-id]');if(row)detail(row.dataset.eventId);});
$('#closeDetail').addEventListener('click',()=>{activeRefreshId=null;$('#detailDialog').close();});
$('#closeCompare').addEventListener('click',()=>$('#compareDialog').close());
$('#clearCompare').addEventListener('click',()=>{selected.clear();renderList();});

$('#compareButton').addEventListener('click',()=>{
  const rows=[...selected].map(id=>state.listings.find(l=>l.id===id)).filter(Boolean);
  if(rows.length<2)return;
  const [a,b]=rows;
  const scoreA=score(a)??-999,scoreB=score(b)??-999;
  const winner=scoreA>scoreB?a:scoreB>scoreA?b:(a.price||Infinity)<=(b.price||Infinity)?a:b;
  const rowsSpec=[
    ['İlan Başlığı',l=>l.title||`#${l.id}`],
    ['İlan Fiyatı',l=>money(l.price)],
    ['Emsal Fiyat',l=>expectedPrice(l)?money(expectedPrice(l)):'Yetersiz emsal'],
    ['Satar Fiyatı (%6)',l=>satarFiyati(expectedPrice(l))?money(satarFiyati(expectedPrice(l))):'—'],
    ['Fırsat Yüzdesi / Sınıf',l=>{const p=score(l);return p!=null?`%${p} (${verdictYazisi(p)})`:'Skorsuz';}],
    ['İlan Bilgisine Göre Hatasız',l=>ilanBilgisineGoreHatasizMi(l).passed?'Geçer':'Geçmez'],
    ['★ 5 Yıldız Durumu',l=>besYildizMi(l)?'★ Evet (5 Yıldız)':'Hayır'],
    ['Parça Şeması',l=>boyaDegisenSayisi(l).statusLabel],
    ['Tramer',l=>parseTramerInfo(l).label],
    ['Ağır Hasar Kaydı',l=>parseHeavyDamageInfo(l).label],
    ['Marka / Model / Paket',l=>[l.brand,l.model,l.trim].filter(Boolean).join(' ')||'Okunmadı'],
    ['Yıl',l=>l.year??'Okunmadı'],
    ['Kilometre',l=>l.km!=null?`${num(l.km)} km`:'Okunmadı'],
    ['Yıllık Ortalama KM',l=>l.km!=null&&l.year?`${num(Math.round(l.km/Math.max(1,new Date().getFullYear()-l.year)))} km/yıl`:'—'],
    ['Vites / Yakıt',l=>[l.gear,l.fuel].filter(Boolean).join(' · ')||'Okunmadı'],
    ['Konum',l=>l.location||'Okunmadı'],
    ['Son Kontrol',l=>date(l.lastChecked||l.firstSeen)]
  ];
  $('#compareContent').innerHTML=`<p class="muted" style="margin-bottom:10px">Öneri: <strong>${esc(winner.title||'#'+winner.id)}</strong> (${money(winner.price)}) fiyat/emsal avantajı açısından öne çıkıyor.</p><table class="compare-table"><tbody>${rowsSpec.map(([label,fn])=>`<tr><th>${esc(label)}</th>${rows.map(l=>`<td>${esc(fn(l))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  $('#compareDialog').showModal();
});

$('#traderTableBody')?.addEventListener('click', async e => {
  if (e.target.closest('.emsal-ext-link')) {
    return;
  }
  const comp = e.target.closest('input[data-compare]');
  if (comp) {
    const id = comp.dataset.compare;
    if (comp.checked) selected.add(id);
    else selected.delete(id);
    renderCompareBar();
    return;
  }
  const detailBtn = e.target.closest('[data-action-detail]');
  if (detailBtn) {
    detail(detailBtn.dataset.actionDetail);
    return;
  }
  const row = e.target.closest('tr[data-id]');
  if (row) {
    detail(row.dataset.id);
  }
});

$('#selectAllCheckbox')?.addEventListener('change', e => {
  const isChecked = e.target.checked;
  const checkboxes = $$('#traderTableBody input[data-compare]');
  checkboxes.forEach(cb => {
    cb.checked = isChecked;
    const id = cb.dataset.compare;
    if (isChecked) selected.add(id);
    else selected.delete(id);
  });
  renderCompareBar();
});

$('#stitchViewToggle')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-view-mode]');
  if (!btn) return;
  listingViewMode = btn.dataset.viewMode;
  localStorage.setItem('arac_radar_view_mode', listingViewMode);
  $$('.stitch-view-btn').forEach(b => b.classList.toggle('active', b.dataset.viewMode === listingViewMode));
  renderList();
});

$('#compareChipsList')?.addEventListener('click', e => {
  const removeBtn = e.target.closest('[data-remove-compare]');
  if (removeBtn) {
    const id = removeBtn.dataset.removeCompare;
    selected.delete(id);
    renderList();
  }
});

async function control(button,path,body={}){button.disabled=true;try{const result=await api(path,body);await refresh();toast(result.source?.running===false&&path.includes('resume')?result.source.message:'Ayar uygulandı.');}catch(e){toast(e.message);}finally{button.disabled=false;if(state)render();}}
$('#resumeCrawl').addEventListener('click',()=>control($('#resumeCrawl'),'/api/crawl/resume'));
$('#turboCrawl')?.addEventListener('click',()=>control($('#turboCrawl'),'/api/crawl/turbo'));
$('#verifyCrawl')?.addEventListener('click',()=>control($('#verifyCrawl'),'/api/crawl/verify'));
$('#pauseCrawl').addEventListener('click',()=>control($('#pauseCrawl'),'/api/crawl/pause'));
$('#speedForm').addEventListener('submit',e=>{e.preventDefault();control($('#speedForm button'),'/api/settings',{gapSeconds:+$('#gapSeconds').value});});
$('#bridgeForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const raw=$('#bridgeHtml').value.trim();
  if(!raw){toast('İlan linki, ilan no veya sayfa HTML kaynağı yapıştır.');return;}
  const btn=$('#bridgeForm button');
  const origText=btn.textContent;
  btn.disabled=true;
  btn.textContent='Aktarılıyor...';
  try{
    const isUrlOrId=/^https?:\/\//i.test(raw)||/^\d{7,12}$/.test(raw);
    const payload=isUrlOrId?{url:raw,html:''}:{html:raw};
    const res=await api('/api/ingest',payload);
    $('#bridgeHtml').value='';
    await refresh();
    toast(res.message||`${res.count} gerçek ilan aktarıldı (${res.newCount} yeni).`);
  }catch(err){
    toast(err.message||'Aktarım hatası');
  }finally{
    btn.disabled=false;
    btn.textContent=origText;
  }
});

function extractListingInput(raw){
  if(!raw) return {id:null,url:null};
  const str=String(raw).trim();
  let parsedUrl=null;
  if(/^https?:\/\//i.test(str)) parsedUrl=str;
  const urlIdMatch=str.match(/-(\d{8,11})\/detay/i)||str.match(/\/(\d{8,11})(?:[/?#]|$)/i);
  if(urlIdMatch) return {id:urlIdMatch[1],url:parsedUrl||str};
  const idMatch=str.match(/\b(\d{8,11})\b/);
  if(idMatch) return {id:idMatch[1],url:null};
  const cleanDigits=str.replace(/\D/g,'');
  if(cleanDigits.length>=8&&cleanDigits.length<=11) return {id:cleanDigits,url:null};
  return {id:null,url:null};
}

async function updateValuationModels(brand){
  const modelEl=$('#valuationModel');
  if(!modelEl) return;
  if(!brand){
    if(valuationModelCombobox){
      valuationModelCombobox.setOptions([]);
      valuationModelCombobox.setValue('');
    }else if(modelEl.tagName==='SELECT'){
      modelEl.innerHTML='<option value="">Model seç</option>';
    }
    return;
  }
  let models = [];
  try{
    const res = await loadModelsForBrand(brand);
    if(Array.isArray(res) && res.length) models = res;
  }catch{}
  if(!models.length){
    models=[...new Set((state?.listings||[]).filter(l=>l.brand===brand).map(l=>l.model).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr'));
  }
  if(valuationModelCombobox){
    valuationModelCombobox.setOptions(models);
  }else if(modelEl.tagName==='SELECT'){
    modelEl.innerHTML='<option value="">Model seç</option>'+models.map(m=>`<option>${esc(m)}</option>`).join('');
  }
}

$('#valuationBrand')?.addEventListener('change',()=>{
  updateValuationModels($('#valuationBrand').value);
});

function populateValuationFromListing(item){
  if(!item) return;
  if($('#valuationBrand')&&item.brand){
    $('#valuationBrand').value=item.brand;
    updateValuationModels(item.brand).then(()=>{
      if($('#valuationModel')&&item.model) $('#valuationModel').value=item.model;
    });
  }
  if($('#valuationTrim')) $('#valuationTrim').value=item.trim||'';
  if($('#valuationYear')&&item.year) $('#valuationYear').value=item.year;
  if($('#valuationKm')) $('#valuationKm').value=item.km!=null?item.km:'';
  if($('#valuationGear')&&item.gear){
    const g=item.gear.toLowerCase();
    if(g.includes('oto')) $('#valuationGear').value='Otomatik';
    else if(g.includes('man')) $('#valuationGear').value='Manuel';
    else if(g.includes('yarı')) $('#valuationGear').value='Yarı Otomatik';
  }
  const k=getAracKondisyon(item);
  if($('#valuationRoofHood')){
    const hoodPart=item.parts?.kaput||item.parts?.motor_kaputu||'';
    const roofPart=item.parts?.tavan||'';
    if(hoodPart.includes('Değişen')||roofPart.includes('Değişen')) $('#valuationRoofHood').value='degisen';
    else if(hoodPart.includes('Boyalı')||roofPart.includes('Boyalı')) $('#valuationRoofHood').value='boyali';
    else $('#valuationRoofHood').value='orijinal';
  }
  if($('#valuationPaintedCount')){
    const pCount=boyaDegisenSayisi(item);
    $('#valuationPaintedCount').value=(pCount.boyali||0)+(pCount.degisen||0);
  }
  if($('#valuationTramer')){
    $('#valuationTramer').value=k.tramerAmount||0;
  }
  if($('#valuationSunroof')){
    const hasSunroof=/sunroof|cam tavan|panoramik/i.test((item.description||'')+' '+(item.title||'')+' '+JSON.stringify(item.fields||{}));
    $('#valuationSunroof').checked=hasSunroof;
  }
}

async function runValuationFromListing(item){
  const k=getAracKondisyon(item);
  const pCount=boyaDegisenSayisi(item);
  const hoodPart=item.parts?.kaput||item.parts?.motor_kaputu||'';
  const roofPart=item.parts?.tavan||'';
  let roofHood='orijinal';
  if(hoodPart.includes('Değişen')||roofPart.includes('Değişen')) roofHood='degisen';
  else if(hoodPart.includes('Boyalı')||roofPart.includes('Boyalı')) roofHood='boyali';

  return runValuation({
    brand:item.brand,
    model:item.model,
    trim:item.trim||'',
    year:item.year,
    km:item.km||0,
    gear:item.gear||'',
    roofHood,
    paintedCount:(pCount.boyali||0)+(pCount.degisen||0),
    tramer:k.tramerAmount||0,
    sunroof:/sunroof|cam tavan|panoramik/i.test((item.description||'')+' '+(item.title||'')+' '+JSON.stringify(item.fields||{})),
    targetListing:item
  });
}

$('#ilanNoForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const rawInput=$('#ilanNoInput')?.value||'';
  const parsed=extractListingInput(rawInput);
  if(!parsed.id){toast('Geçerli bir ilan numarası veya sahibinden linki girin.');return;}
  const cleanId=parsed.id;
  const targetUrl=parsed.url;

  $('#valuationResult').innerHTML=`
    <div style="text-align:center;padding:24px 10px">
      <span class="spin-symbol">⏳</span>
      <h3 style="margin:10px 0 6px">İlan Bilgileri Kontrol Ediliyor...</h3>
      <p class="muted">İlan #${esc(cleanId)} veritabanında ve kaynak sitede sorgulanıyor. Lütfen bekleyin.</p>
    </div>
  `;

  try{
    const fetchUrl='/api/listing-no/'+encodeURIComponent(cleanId)+(targetUrl?'?url='+encodeURIComponent(targetUrl):'');
    const res=await api(fetchUrl);

    if(res.found&&res.listing&&res.listing.brand&&res.listing.price){
      populateValuationFromListing(res.listing);
      await runValuationFromListing(res.listing);
      toast('İlan bilgileri yüklendi ve değerlendi.');
      return;
    }

    const jobId=res.job_id;
    $('#valuationResult').innerHTML=`
      <div style="text-align:center;padding:24px 10px">
        <span class="spin-symbol">🔄</span>
        <h3 style="margin:10px 0 6px">İlan Kaynaktan Çekiliyor...</h3>
        <p class="muted">İlan #${esc(cleanId)} veritabanında henüz yoktu. Sahibinden'den araç özellikleri, fiyatı, hasar ve kilometre bilgileri okunuyor...</p>
        <p style="font-size:11px;color:#a0b8c6;margin-top:10px" id="valPollStatus">Kaynak okuma kuyruğuna alındı · Bekleniyor ⏳</p>
      </div>
    `;

    let fetchedListing=null;
    for(let i=0;i<30;i++){
      await new Promise(r=>setTimeout(r,2000));
      try{
        const st=await api(`/api/listings/${encodeURIComponent(cleanId)}/refresh-status?job_id=${encodeURIComponent(jobId)}`);
        const pollEl=$('#valPollStatus');
        if(pollEl) pollEl.textContent=`Kaynak işi sürüyor (${st.status||'işleniyor'}) · Deneme ${i+1}/30 ⏳`;

        if(st.status==='done'){
          const item=await api('/api/listings/'+encodeURIComponent(cleanId));
          if(item&&item.brand&&item.price){
            fetchedListing=item;
            break;
          }
        }else if(st.status==='failed'){
          throw new Error(st.error||'İlan kaynaktan okunamadı.');
        }
      }catch(pollErr){
        if(i>=6&&pollErr.message&&!pollErr.message.includes('bulunamadı')){
          throw pollErr;
        }
      }
    }

    if(fetchedListing){
      populateValuationFromListing(fetchedListing);
      await runValuationFromListing(fetchedListing);
      toast('İlan başarıyla kaynaktan çekildi ve değerlendi!');
      await refresh();
    }else{
      $('#valuationResult').innerHTML=`
        <div style="text-align:center;padding:24px 10px">
          <span class="large-symbol">⚠️</span>
          <h3 style="margin:10px 0 6px">İlan Kaynaktan Alınamadı</h3>
          <p class="muted">İlan #${esc(cleanId)} yayından kalkmış olabilir veya kaynak site erişimi gecikti.</p>
          <p style="margin-top:12px">Dilerseniz aracın marka, model ve yılını soldaki formdan seçerek piyasa değerini anında görebilirsiniz.</p>
        </div>
      `;
    }
  }catch(err){
    $('#valuationResult').innerHTML=`
      <div style="text-align:center;padding:24px 10px">
        <span class="large-symbol">⚠️</span>
        <h3 style="margin:10px 0 6px">İlan Okunurken Sorun Oluştu</h3>
        <p class="muted">${esc(err.message)}</p>
        <p style="margin-top:12px">Soldaki formdan marka, model ve yılı manuel seçerek değerleme yapabilirsiniz.</p>
      </div>
    `;
    toast(err.message);
  }
});

async function runValuation({brand,model,trim='',year,km,gear,roofHood,paintedCount,tramer,sunroof,targetListing=null}){
  if(!brand||!model||!year){
    toast('Lütfen en az Marka, Model ve Model Yılı girin.');
    return;
  }

  const effectiveTrim=trim||targetListing?.trim||$('#valuationTrim')?.value||'';

  $('#valuationResult').innerHTML=`
    <div style="text-align:center;padding:30px 10px">
      <span class="spin-symbol">⏳</span>
      <h3 style="margin:10px 0 6px">Emsal İlanlar Taranıyor...</h3>
      <p class="muted">112.000+ gerçek ilan arasından ${esc(brand)} ${esc(model)} ${effectiveTrim?`(${esc(effectiveTrim)}) `:''}(${year}) emsalleri çıkarılıyor...</p>
    </div>
  `;

  try{
    const q=new URLSearchParams({
      brand:brand||'',
      model:model||'',
      trim:effectiveTrim,
      year:String(year||''),
      km:String(km||''),
      gear:gear||'',
      roofHood:roofHood||'orijinal',
      paintedCount:String(paintedCount||0),
      tramer:String(tramer||0),
      sunroof:sunroof?'true':'false'
    });
    if(targetListing?.price) q.set('targetPrice',String(targetListing.price));
    if(targetListing?.id) q.set('listingId',String(targetListing.id));

    const res=await api('/api/valuation?'+q.toString());

    if(!res.ok){
      $('#valuationResult').innerHTML=`
        <div style="text-align:center;padding:24px 10px">
          <span class="large-symbol">◎</span>
          <h3 style="margin:10px 0 6px">Veritabanında Yeterli İlan Yok</h3>
          <p class="muted">${esc(res.message||'Bu seçim için henüz yeterli emsal ilan toplanmadı.')}</p>
          <div style="margin-top:18px">
            <button type="button" class="button button-primary" id="fetchCategoryBtn" data-brand="${esc(brand)}" data-model="${esc(model)}">
              📡 Sahibinden'den ${esc(brand)} ${esc(model)} İlanlarını Çek / Tara
            </button>
          </div>
        </div>
      `;
      return;
    }

    dgkYaz({
      key:`${brand}_${model}_${year}_${effectiveTrim}_${gear||''}`,
      brand,model,trim:effectiveTrim,year,km,gear,roofHood,paintedCount,tramer,sunroof,
      base:res.adjustedBase,
      buyLevel:res.buyLevel,
      sellLevel:res.sellLevel,
      count:res.count,
      at:Date.now()
    });

    const targetCardHtml=targetListing?`
      <div class="val-target-card" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:14px;margin-bottom:16px;display:flex;gap:14px;align-items:center;text-align:left">
        ${targetListing.image?`<img src="${safeImage(targetListing.image)}" style="width:90px;height:68px;object-fit:cover;border-radius:6px;flex-shrink:0" alt="" referrerpolicy="no-referrer">`:''}
        <div style="flex:1;min-width:0">
          <span class="eyebrow" style="color:#b8d997">SORGULANAN İLAN #${esc(targetListing.id)}</span>
          <h4 style="margin:2px 0 4px;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(targetListing.title||`${brand} ${model}`)}</h4>
          <div style="display:flex;gap:8px;font-size:11px;color:#a0b0b8;flex-wrap:wrap">
            <span>${targetListing.year} Model</span>
            <span>•</span>
            <span>${targetListing.km!=null?num(targetListing.km)+' km':'KM belirtilmedi'}</span>
            <span>•</span>
            <span>${esc(targetListing.gear||'Vites belirtilmedi')}</span>
            ${targetListing.trim?`<span>•</span><span style="color:#e2e8f0">${esc(targetListing.trim)}</span>`:''}
          </div>
          <div style="margin-top:6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <strong style="font-size:16px;color:#f0f4f4">${money(targetListing.price)}</strong>
            ${res.targetAnalysis?`<span class="condition-chip ${res.targetAnalysis.oppPct>0?'is-clean':'is-unknown'}" style="font-size:11px;padding:3px 8px">${res.targetAnalysis.oppPct>0?'%'+res.targetAnalysis.oppPct+' Avantajlı':'Emsalin %'+Math.abs(res.targetAnalysis.oppPct)+' üzerinde'}</span>`:''}
            <a href="${esc(targetListing.url)}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:#b8d997;margin-left:auto;text-decoration:none">Sahibinden'de Aç ↗</a>
          </div>
        </div>
      </div>
    `:'';

    const peersListHtml=(res.peers||[]).map(m=>`
      <div class="history-item" style="cursor:pointer;padding:10px 12px;display:flex;align-items:center;gap:12px" data-val-listing="${esc(m.id)}">
        ${m.image?`<img src="${safeImage(m.image)}" style="width:52px;height:40px;object-fit:cover;border-radius:5px;flex-shrink:0" alt="" loading="lazy" referrerpolicy="no-referrer">`:'<div style="width:52px;height:40px;background:#20313d;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#607b8b;font-size:10px;flex-shrink:0">Foto Yok</div>'}
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;gap:8px">
            <span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              <span class="detail-emsal-badge" style="font-size:10px;padding:1px 6px;margin-right:6px">%${m.uyum||90} Uyum</span>
              ${esc(m.title||'#'+m.id)}
            </span>
            <strong style="white-space:nowrap;color:#f0f4f4">${money(m.price)}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:#87a7ba;margin-top:2px">
            <span>${m.year} Model • ${m.km!=null?num(m.km)+' km':'KM yok'} • ${esc(m.gear||'')} • ${esc(m.trim||m.pkg||'')} • ${esc(m.location||'')}</span>
            <span style="color:${m.diffFromBase<0?'#10b981':'#a0b0b8'};font-weight:600">${m.diffFromBase<0?money(Math.abs(m.diffFromBase))+' ucuz':money(m.diffFromBase)+' pahalı'}</span>
          </div>
        </div>
      </div>
    `).join('');

    $('#valuationResult').innerHTML=`
      ${targetCardHtml}
      <p class="eyebrow">DEĞERLEME SONUCU (ORTANCA PİYASA DEĞERİ)</p>
      <div style="display:flex;align-items:baseline;gap:12px;justify-content:center;margin:8px 0 14px">
        <strong style="font-size:32px;letter-spacing:-0.5px;color:#f0f4f4">${money(res.adjustedBase)}</strong>
        ${res.targetAnalysis?`<span style="font-size:13px;color:${res.targetAnalysis.diff<0?'#10b981':'#f87171'};font-weight:600">${res.targetAnalysis.diff<0?money(Math.abs(res.targetAnalysis.diff))+' piyasanın altında':money(res.targetAnalysis.diff)+' piyasanın üzerinde'}</span>`:''}
      </div>

      <div class="detail-fields" style="margin:14px 0;text-align:left">
        <div>
          <dt>Alınabilir (%15 Fırsat)</dt>
          <dd><strong>${money(res.buyLevel)}</strong></dd>
        </div>
        <div>
          <dt>Satılabilir (%7 Fırsat)</dt>
          <dd><strong>${money(res.sellLevel)}</strong></dd>
        </div>
        <div>
          <dt>⚪ Piyasa Ortancası (%0)</dt>
          <dd><strong>${money(res.adjustedBase)}</strong></dd>
        </div>
        <div>
          <dt>📊 İncelenen Emsal Sayısı</dt>
          <dd><strong>${res.count} gerçek ilan</strong> ${res.peerMedianKm?`<small style="color:#87a7ba">(Ort. ${num(res.peerMedianKm)} km)</small>`:''}</dd>
        </div>
        <div style="grid-column:1/-1">
          <dt>📈 Emsal Fiyat Dağılımı (${esc(brand)} ${esc(model)} ${res.year} ±1–2 Yıl)</dt>
          <dd style="font-size:11px;color:#a0b8c6;line-height:1.6">
            Min: <strong>${money(res.stats.min)}</strong> · %25: <strong>${money(res.stats.p25)}</strong> · Medyan: <strong>${money(res.stats.median)}</strong> · %75: <strong>${money(res.stats.p75)}</strong> · Max: <strong>${money(res.stats.max)}</strong>
          </dd>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 12px;padding:8px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;flex-wrap:wrap;gap:8px">
        <span style="font-size:11px;color:#87a7ba">Daha taze veya daha fazla ilan mı gerekiyor?</span>
        <button type="button" class="button button-outline" id="fetchCategoryBtn" data-brand="${esc(brand)}" data-model="${esc(model)}" style="padding:6px 12px;font-size:11px">
          📡 Sahibinden'den ${esc(brand)} ${esc(model)} Taraması Başlat
        </button>
      </div>

      <div style="text-align:left;margin-top:16px">
        <span class="eyebrow" style="color:#b8d997">PİYASADAKİ EMSAL İLANLAR (${(res.peers||[]).length} İlan Listeleniyor)</span>
        <div class="history" style="margin-top:8px">
          ${peersListHtml||'<p class="muted" style="padding:12px">Emsal ilan bulunamadı.</p>'}
        </div>
      </div>
    `;
  }catch(err){
    $('#valuationResult').innerHTML=`
      <div style="text-align:center;padding:24px 10px">
        <span class="large-symbol">⚠️</span>
        <h3 style="margin:10px 0 6px">Değerleme Hesaplanamadı</h3>
        <p class="muted">${esc(err.message)}</p>
      </div>
    `;
    toast(err.message);
  }
}

$('#valuationForm')?.addEventListener('submit',e=>{
  e.preventDefault();
  runValuation({
    brand:$('#valuationBrand').value,
    model:$('#valuationModel').value,
    trim:$('#valuationTrim')?.value||'',
    year:+$('#valuationYear').value,
    km:+($('#valuationKm')?.value||0),
    gear:$('#valuationGear')?.value||'',
    roofHood:$('#valuationRoofHood')?.value||'orijinal',
    paintedCount:+($('#valuationPaintedCount')?.value||0),
    tramer:+($('#valuationTramer')?.value||0),
    sunroof:$('#valuationSunroof')?.checked||false
  });
});

$('#valuationResult')?.addEventListener('click',async e=>{
  const fetchBtn=e.target.closest('#fetchCategoryBtn');
  if(fetchBtn){
    const brand=fetchBtn.dataset.brand;
    const model=fetchBtn.dataset.model;
    if(!brand) return;
    fetchBtn.disabled=true;
    fetchBtn.textContent='⏳ Kaynak taraması başlatılıyor...';
    try{
      const res=await api('/api/crawl/model',{brand,model});
      toast(res.message||'Kaynak taraması başlatıldı!');
      fetchBtn.textContent='✅ Tarama kuyruğuna eklendi (İlanlar toplanıyor)';
      setTimeout(async()=>{
        await refresh();
        const curBrand=$('#valuationBrand')?.value;
        const curModel=$('#valuationModel')?.value;
        const curTrim=$('#valuationTrim')?.value||'';
        const curYear=+$('#valuationYear')?.value;
        if(curBrand&&curModel&&curYear){
          runValuation({
            brand:curBrand,
            model:curModel,
            trim:curTrim,
            year:curYear,
            km:+($('#valuationKm')?.value||0),
            gear:$('#valuationGear')?.value||'',
            roofHood:$('#valuationRoofHood')?.value||'orijinal',
            paintedCount:+($('#valuationPaintedCount')?.value||0),
            tramer:+($('#valuationTramer')?.value||0),
            sunroof:$('#valuationSunroof')?.checked||false
          });
        }
      },4000);
    }catch(err){
      toast(err.message);
      fetchBtn.disabled=false;
      fetchBtn.textContent='Tekrar Dene';
    }
    return;
  }

  const row=e.target.closest('[data-val-listing]');
  if(row)detail(row.dataset.valListing);
});

$('#valuationHistoryList')?.addEventListener('click',e=>{
  const row=e.target.closest('[data-dgk-idx]');
  if(!row)return;
  const item=dgkOku()[+row.dataset.dgkIdx];
  if(!item)return;
  $('#valuationBrand').value=item.brand;
  updateValuationModels(item.brand).then(()=>{
    $('#valuationModel').value=item.model;
  });
  if($('#valuationTrim')) $('#valuationTrim').value=item.trim||'';
  $('#valuationYear').value=item.year;
  if($('#valuationKm')) $('#valuationKm').value=item.km||'';
  if($('#valuationGear')) $('#valuationGear').value=item.gear||'';
  if($('#valuationRoofHood')) $('#valuationRoofHood').value=item.roofHood||'orijinal';
  if($('#valuationPaintedCount')) $('#valuationPaintedCount').value=item.paintedCount||0;
  if($('#valuationTramer')) $('#valuationTramer').value=item.tramer||0;
  if($('#valuationSunroof')) $('#valuationSunroof').checked=!!item.sunroof;
  runValuation(item);
});

(function initSavedPreferences(){
  const saved=rozetKayitOku();
  if($('#noHeavyDamage')&&saved.noHeavyDamage)$('#noHeavyDamage').checked=true;
  if($('#paintlessOnly')&&saved.paintlessOnly)$('#paintlessOnly').checked=true;
  if($('#changelessOnly')&&saved.changelessOnly)$('#changelessOnly').checked=true;
  if($('#zeroTramerOnly')&&saved.zeroTramerOnly)$('#zeroTramerOnly').checked=true;
  if($('#hideRisk')&&saved.hideRisk)$('#hideRisk').checked=true;
  if($('#hideFault')&&saved.hideFault)$('#hideFault').checked=true;
  if($('#hideWarning')&&saved.hideWarning)$('#hideWarning').checked=true;
  if($('#hideEnded')&&saved.hideEnded!==undefined)$('#hideEnded').checked=saved.hideEnded;
  if($('#hideIncomplete')&&saved.hideIncomplete)$('#hideIncomplete').checked=true;
  if($('#fiveStarOnly')&&saved.fiveStarOnly)$('#fiveStarOnly').checked=true;
  try{
    const liveSaved=JSON.parse(localStorage.getItem('arac_radar_canli_esik')||'{}');
    if($('#liveMinOpp')&&liveSaved.minOpp!=null)$('#liveMinOpp').value=liveSaved.minOpp;
    if($('#liveNoHeavyDamage')&&liveSaved.noHeavy)$('#liveNoHeavyDamage').checked=true;
    if($('#livePaintless')&&liveSaved.paintless)$('#livePaintless').checked=true;
  }catch{}
  renderValuationHistory();
})();

if ($('#modelFilter') && $('#modelFilterDropdown')) {
  modelCombobox = createCombobox({
    inputEl: $('#modelFilter'),
    dropdownEl: $('#modelFilterDropdown'),
    arrowBtn: $('#modelFilter').parentNode?.querySelector('.combobox-arrow'),
    emptyLabel: 'Tüm modelleri göster (Temizle)',
    onSelect: (val) => {
      if (!$('#brandFilter')?.value && val && state?.listings) {
        const match = state.listings.find(l => {
          const lm = l.model || '';
          const lt = l.trim || '';
          return lm === val || lt === val || (lm + ' ' + lt).includes(val);
        });
        if (match?.brand) {
          $('#brandFilter').value = match.brand;
          loadModelsForBrand(match.brand).then(m => modelCombobox?.setOptions(m));
        }
      }
      treeTrim = '';
      page = 1;
      checkHatasizRelaxation();
      renderList();
      agacOlustur();
    }
  });
}

if ($('#valuationModel') && $('#valuationModelDropdown')) {
  valuationModelCombobox = createCombobox({
    inputEl: $('#valuationModel'),
    dropdownEl: $('#valuationModelDropdown'),
    arrowBtn: $('#valuationModel').parentNode?.querySelector('.combobox-arrow'),
    emptyLabel: '',
    onSelect: (val) => {
      if (!$('#valuationBrand')?.value && val && state?.listings) {
        const match = state.listings.find(l => {
          const lm = l.model || '';
          const lt = l.trim || '';
          return lm === val || lt === val || (lm + ' ' + lt).includes(val);
        });
        if (match?.brand) {
          $('#valuationBrand').value = match.brand;
          loadModelsForBrand(match.brand).then(m => valuationModelCombobox?.setOptions(m));
        }
      }
    }
  });
}

document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();switchView('listings');$('#searchInput').focus();}});
$('#today').textContent=new Intl.DateTimeFormat('tr-TR',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Istanbul'}).format(new Date());
fastBootstrap();
const eventSource=new EventSource('/api/events');let refreshTimer;
eventSource.onopen=()=>{if($('#connectionText'))$('#connectionText').textContent='Bağlantı açık';$('#serverDot')?.classList.remove('disconnected');};
eventSource.onmessage=()=>{if($('#connectionText'))$('#connectionText').textContent='Bağlantı açık';$('#serverDot')?.classList.remove('disconnected');clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,3000);};
eventSource.onerror=()=>{if($('#connectionText'))$('#connectionText').textContent='Bağlantı yeniden kuruluyor';$('#serverDot')?.classList.add('disconnected');};
setInterval(countdown,1000);setInterval(refresh,20000);refresh();

function updateFilterPresentation(count){
  if($('#freshStat'))$('#freshStat').textContent=num((state?.listings||[]).filter(l=>l.firstSeen&&Date.now()-l.firstSeen<86400000).length);
  const ignored=new Set(['searchInput','sortSelect','oppThresholdSelect']);
  let n=0;
  for(const id of filterControls){const el=$(id);if(!el||ignored.has(el.id))continue;if(el.type==='checkbox'){if(el.id!=='hideEnded'&&el.checked)n++;}else if(['maxPaintedSelect','maxChangedSelect'].includes(el.id)){if(el.value!=='13')n++;}else if(el.id!=='badgeFilterMode'&&el.value!=='')n++;}
  n+=$$('[data-unpainted-part]:checked,[data-unchanged-part]:checked,[data-badge-item]:checked').length;
  n+=selectedGears.size+selectedFuels.size+selectedBodies.size;
  if($('#hatasizQuickSelect').checked)n=1+Math.max(0,n-10);
  const badge=$('#filterCount');badge.hidden=n===0;badge.textContent=n;
  sourceUpdateFilterPresentation(count);
  $$('.quick-chip').forEach(b=>b.setAttribute('aria-pressed',String(b.classList.contains('active'))));
}
document.addEventListener('keydown',e=>{
  if(!$('#categoryModal').hidden){
    if(e.key==='Escape'){e.preventDefault();closeCategoryModal();return;}
    if(e.key==='Tab'){
      const nodes=[...$('#categoryModal').querySelectorAll('button,input,[tabindex]')].filter(el=>!el.disabled&&el.getClientRects().length);
      const first=nodes[0],last=nodes[nodes.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
    return;
  }
  if(sourceFilterDesktop()||$('#advancedFilters').hidden||!$('#categoryModal').hidden)return;
  if(e.key==='Escape'){e.preventDefault();setFilterSheetOpen(false);return;}
  if(e.key==='Tab'){
    const nodes=[...$('#advancedFilters').querySelectorAll('button,input,select,summary,[tabindex]')].filter(el=>!el.disabled&&el.getClientRects().length);
    const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
});
$('#detailContent').addEventListener('click',async e=>{
  const section=e.target.closest('[data-detail-section]');if(section){$$('[data-detail-section]').forEach(b=>b.classList.toggle('active',b===section));$('#'+section.dataset.detailSection)?.scrollIntoView({behavior:'smooth',block:'start'});return;}
  const photo=e.target.closest('[data-gallery-src]');if(photo){$('#detailMainImage').src=photo.dataset.gallerySrc;$$('[data-gallery-src]').forEach(b=>b.classList.toggle('active',b===photo));return;}
  const fav=e.target.closest('[data-detail-favorite]');if(fav){const l=state.listings.find(x=>x.id===fav.dataset.detailFavorite);if(!l)return;try{await api('/api/favorites/'+encodeURIComponent(l.id),{active:!l.favorite});l.favorite=!l.favorite;fav.innerHTML=uiIcon('heart')+' '+(l.favorite?'Favoriden çıkar':'Favoriye ekle');renderList();}catch(err){toast(err.message);}}
});


/* Source-style filtering: local UI only; no crawler or valuation changes. */
function sourceCaptureFilters(){
  const controls={};
  document.querySelectorAll('#advancedFilters input[id],#advancedFilters select[id],#searchInput').forEach(el=>{
    if(['filterAutoResults','sourceCategorySearch'].includes(el.id))return;
    controls['#'+el.id]={value:el.value,checked:el.checked};
  });
  const checks={};
  for(const [selector,key] of [['[data-unpainted-part]:checked','unpaintedPart'],['[data-unchanged-part]:checked','unchangedPart'],['[data-badge-item]:checked','badgeItem']]){
    checks[selector]=$$(selector).map(el=>({dataset:{[key]:el.dataset[key]}}));
  }
  return {controls,checks,gear:[...selectedGears].sort(),fuel:[...selectedFuels].sort(),body:[...selectedBodies].sort(),fresh:freshMode};
}
function sourceCommitFilters(){sourceFilterApplied=sourceCaptureFilters();}
function sourceFilterControl(selector){
  if(sourceFilterAuto||!sourceFilterApplied||['#sortSelect','#oppThresholdSelect'].includes(selector))return $(selector);
  return sourceFilterApplied.controls[selector]||$(selector);
}
function sourceFilterChecked(selector){return sourceFilterAuto||!sourceFilterApplied?$$(selector):(sourceFilterApplied.checks[selector]||[]);}
const SOURCE_EMPTY_FILTER_SET=new Set();
function sourceFilterSet(kind,except=''){
  if(kind===except)return SOURCE_EMPTY_FILTER_SET;
  if(!sourceFilterAuto&&sourceFilterApplied)return new Set(sourceFilterApplied[kind]||[]);
  return {gear:selectedGears,fuel:selectedFuels,body:selectedBodies}[kind];
}
function sourceFilterFreshMode(){return !sourceFilterAuto&&sourceFilterApplied?sourceFilterApplied.fresh:freshMode;}
function sourceFilterPending(){return !sourceFilterAuto&&sourceFilterApplied&&JSON.stringify(sourceCaptureFilters())!==JSON.stringify(sourceFilterApplied);}
function sourceDistrict(l){return String(l.location||'').split('/')[1]?.trim()||'';}
function sourceSeller(l){
  const raw=typeof l.seller==='string'?l.seller:(l.seller?.type||l.seller?.label||'');
  const text=trNorm(raw);
  if(/yetkili|bayi/.test(text))return 'Yetkili Bayiden';
  if(/galeri/.test(text))return 'Galeriden';
  if(/sahibinden|bireysel/.test(text))return 'Sahibinden';
  return '';
}
function sourcePublishedStamp(l){
  const value=l.publishedDate;if(!value)return null;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  const text=String(value).toLocaleLowerCase('tr').trim();
  const months={ocak:0,şubat:1,mart:2,nisan:3,mayıs:4,haziran:5,temmuz:6,ağustos:7,eylül:8,ekim:9,kasım:10,aralık:11};
  const tr=text.match(/(\d{1,2})\s+([a-zçğıöşü]+)\s+(\d{4})/i);
  if(tr&&months[tr[2]]!=null)return new Date(+tr[3],months[tr[2]],+tr[1]).getTime();
  const dotted=text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if(dotted)return new Date(+dotted[3],+dotted[2]-1,+dotted[1]).getTime();
  if(/^\d{4}-\d{2}-\d{2}/.test(text)){const stamp=Date.parse(text);return Number.isFinite(stamp)?stamp:null;}
  return null;
}
let sourceDistrictOptionsKey='',sourceColorOptionsKey='';
function sourceUpdateDistricts(){
  const el=$('#districtFilter');if(!el)return;
  const city=$('#cityFilter')?.value||'';
  const key=city+'|'+(state?.listings?.length||0);
  if(key===sourceDistrictOptionsKey)return;sourceDistrictOptionsKey=key;
  const old=el.value;
  const districts=city?[...new Set((state?.listings||[]).filter(l=>cityOf(l)===city).map(sourceDistrict).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr')):[];
  el.innerHTML='<option value="">'+(city?'Tüm ilçeler':'Önce il seçiniz')+'</option>'+districts.map(x=>'<option>'+esc(x)+'</option>').join('');
  el.disabled=!city;el.value=districts.includes(old)?old:'';
}
function sourceUpdateColors(){
  const el=$('#colorFilter');if(!el)return;
  const key=String(state?.listings?.length||0);if(key===sourceColorOptionsKey)return;sourceColorOptionsKey=key;
  const old=el.value,colors=[...new Set((state?.listings||[]).map(l=>l.color).filter(x=>typeof x==='string'&&x.trim()))].sort((a,b)=>a.localeCompare(b,'tr'));
  el.innerHTML='<option value="">Tüm renkler</option>'+colors.map(x=>'<option>'+esc(x)+'</option>').join('');
  el.value=colors.includes(old)?old:'';
}
async function sourceRenderCategories(force=false){
  const list=$('#sourceCategoryList');if(!list)return;
  const brand=$('#brandFilter')?.value||'',series=$('#modelFilter')?.value||'';
  const key=JSON.stringify([brand,series,Math.floor(Date.now()/30000)]);
  if(!force&&key===sourceCategoryKey){sourceDrawCategories();return;}
  sourceCategoryKey=key;
  const request=++sourceCategoryRequest;
  if(!sourceCategoryData)list.innerHTML='<p class="source-filter-help">Kategoriler yükleniyor…</p>';
  try{
    const q=new URLSearchParams();if(brand)q.set('brand',brand);if(series)q.set('series',series);
    const result=await api('/api/category-tree?'+q);
    if(request!==sourceCategoryRequest)return;
    sourceCategoryData=result;sourceDrawCategories();
  }catch{
    if(request===sourceCategoryRequest){sourceCategoryKey='';list.innerHTML='<p class="source-filter-help">Kategoriler alınamadı. <button type="button" data-source-category-retry>Yeniden dene</button></p>';}
  }
}
function sourceDrawCategories(){
  const data=sourceCategoryData;if(!data)return;
  const brand=$('#brandFilter').value,series=$('#modelFilter').value,trim=$('#trimFilter').value;
  const crumbs=[`<button type="button" data-source-cat-level="root">Tüm markalar</button>`];
  if(brand)crumbs.push(`<button type="button" data-source-cat-level="brand">${esc(brand)}</button>`);
  if(series)crumbs.push(`<button type="button" data-source-cat-level="series">${esc(series)}</button>`);
  if(trim)crumbs.push(`<strong>${esc(trim)}</strong>`);
  $('#sourceCategoryBreadcrumbs').innerHTML=crumbs.join('<span aria-hidden="true">›</span>');
  const input=$('#sourceCategorySearch');input.placeholder=data.level===0?'Marka ara':data.level===1?'Seri ara':'Model / paket ara';
  const query=trNorm(input.value||'');
  const items=(data.items||[]).filter(x=>trNorm(x.brand||x.series||x.trim||'').includes(query));
  const attribute=data.level===0?'brand':data.level===1?'series':'trim';
  $('#sourceCategoryList').innerHTML=items.map(x=>{
    const value=x.brand||x.series||x.trim;
    return `<button type="button" class="source-category-option ${trim&&trim===value?'selected':''}" data-source-cat-${attribute}="${esc(value)}"><span>${esc(value)}</span><small class="source-category-count">(${num(x.count)})</small>${data.level<2?uiIcon('chevron-right'):''}</button>`;
  }).join('')||'<p class="source-filter-help">Eşleşen kategori bulunamadı.</p>';
}
function sourceRefreshFacetCounts(){
  if(!sourceFilterAuto){$$('[data-facet-count]').forEach(el=>el.textContent='');return;}
  if(!state)return;
  const key=JSON.stringify([state.lastSync,state.listings.length,sourceCaptureFilters(),view,$('#oppThresholdSelect')?.value]);
  if(key===sourceCountsKey)return;sourceCountsKey=key;
  clearTimeout(sourceCountsTimer);
  sourceCountsTimer=setTimeout(()=>{
    if(!sourceFilterAuto||!state)return;
    for(const [facet,infer] of [['gear',inferGear],['fuel',inferFuel],['body',inferBody]]){
      const counts=new Map();
      for(const l of filtered(facet)){const value=infer(l);if(value)counts.set(value,(counts.get(value)||0)+1);}
      $$('[data-facet-count]').filter(el=>el.dataset.facetCount.startsWith(facet+':')).forEach(el=>{const value=el.dataset.facetCount.slice(facet.length+1);el.textContent='('+num(counts.get(value)||0)+')';});
    }
  },180);
}
function sourceUpdateFilterPresentation(count){
  sourceUpdateDistricts();sourceUpdateColors();void sourceRenderCategories();
  for(const [id,set,key] of [['#gearChipGroup',selectedGears,'gearVal'],['#fuelChipGroup',selectedFuels,'fuelVal'],['#bodyChipGroup',selectedBodies,'bodyVal']])syncChipGroupUI(id,set,key);
  const pending=sourceFilterPending();
  $('#filterPendingNote').hidden=!pending;
  if(pending)$('#activeTagsBar').hidden=true;
  document.body.classList.toggle('source-filter-manual',!sourceFilterAuto);
  const button=$('#applyFiltersBtn');button.hidden=sourceFilterAuto&&sourceFilterDesktop();
  button.textContent=sourceFilterAuto?num(count)+' ilanı göster':'Ara';
  $('#sourceFilterResultCount').textContent=pending?'Arama kriterleri değişti':num(count)+' ilan';
  sourceRefreshFacetCounts();
}
function sourceInitializeFilters(){
  const mode=$('#filterAutoResults');mode.checked=sourceFilterAuto;
  sourceCommitFilters();
  mode.addEventListener('change',()=>{
    sourceCommitFilters();sourceFilterAuto=mode.checked;localStorage.setItem('arac_radar_filter_auto',String(sourceFilterAuto));
    page=1;sourceCountsKey='';if(state)renderList();
  });
  $('#sourceCategorySearch').addEventListener('input',sourceDrawCategories);
  $('#advancedFilters').addEventListener('click',e=>{
    const retry=e.target.closest('[data-source-category-retry]');if(retry){void sourceRenderCategories(true);return;}
    const level=e.target.closest('[data-source-cat-level]');
    if(level){
      $('#sourceCategorySearch').value='';
      const target=level.dataset.sourceCatLevel;
      setCategorySelection({brand:target==='root'?'':$('#brandFilter').value,model:target==='series'?$('#modelFilter').value:'',trim:''});return;
    }
    const button=e.target.closest('[data-source-cat-brand],[data-source-cat-series],[data-source-cat-trim]');
    if(!button)return;
    $('#sourceCategorySearch').value='';
    setCategorySelection({brand:button.dataset.sourceCatBrand||$('#brandFilter').value,model:button.dataset.sourceCatBrand?'':(button.dataset.sourceCatSeries||$('#modelFilter').value),trim:button.dataset.sourceCatTrim||''});
  });
  const layout=matchMedia('(min-width:1100px)');
  const sync=()=>{setFilterSheetOpen(false);if(state)sourceUpdateFilterPresentation(filtered().length);};
  layout.addEventListener('change',sync);sync();
  void sourceRenderCategories();
}
sourceInitializeFilters();
