import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOT,parseList,parseDetail,accessProblem,sourceUrl } from './parser.mjs';
import { createStore } from './store.mjs';
import { Crawler,CHECK_INTERVAL } from './crawler.mjs';
test('giriş, engel ve kota yanıtı veri olarak okunmaz',()=>{
  assert.equal(accessProblem('','https://secure.sahibinden.com/giris?return_url=x').phase,'auth_required');
  assert.equal(accessProblem('<title>Just a moment</title>','https://www.sahibinden.com/otomobil').phase,'access_blocked');
  assert.equal(accessProblem('','https://www.sahibinden.com/otomobil',429).phase,'rate_limited');
  assert.equal(accessProblem('<title>Just a moment</title>','https://www.sahibinden.com/otomobil',403).reason,'browser_verification');
  assert.equal(accessProblem('Access denied','https://www.sahibinden.com/otomobil',403).reason,'access_denied');
});
test('kaynak dışı ve javascript bağlantıları reddedilir',()=>{assert.equal(sourceUrl('javascript:alert(1)'),null);assert.equal(sourceUrl('https://example.org/ilan/vasita-test-123/detay'),null);});
test('ayrıştırıcı kimliği tekilleştirir, fiyatı Türkçe biçimden okur',()=>{
  const html='<table><tr><td><a href="/ilan/vasita-otomobil-test-1234567890/detay">Test araç başlığı</a><a href="/ilan/vasita-otomobil-test-1234567890/detay">Detay</a></td><td>1.250.000 TL</td></tr></table><a href="/otomobil?pagingOffset=20">2</a>';
  const p=parseList(html);assert.equal(p.listings.length,1);assert.equal(p.listings[0].price,1250000);assert.equal(p.pages.length,1);
});
test('eksik detay temiz veya tam olarak doldurulmaz',()=>{
  assert.equal(parseDetail('<h1>Başlık</h1>','https://www.sahibinden.com/ilan/vasita-test-1234567890/detay'),null);
  const d=parseDetail('<h1>Kaynak başlığı</h1><h3>900.000 TL</h3><li><span>Marka</span><strong>Test</strong></li><li><span>Yıl</span><strong>2020</strong></li>','https://www.sahibinden.com/ilan/vasita-test-1234567890/detay');assert.equal(d.year,2020);assert.equal(d.km,null);assert.equal(d.price,900000);
});
test('aynı gözlem geçmişi çoğaltmaz, fiyat geri döndüğünde olay korunur',()=>{
  const s=createStore(':memory:');s.ingest({id:'100',url:'https://www.sahibinden.com/ilan/vasita-test-100/detay',title:'Test',price:800});s.ingest({id:'100',url:'https://www.sahibinden.com/ilan/vasita-test-100/detay',price:800},true);s.ingest({id:'100',url:'https://www.sahibinden.com/ilan/vasita-test-100/detay',price:750},true);s.ingest({id:'100',url:'https://www.sahibinden.com/ilan/vasita-test-100/detay',price:800},true);assert.equal(s.listings().length,1);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM history').get().n,3);assert.equal(s.state().events.length,2);s.db.close();
});
test('iş kuyruğu tekildir, yeniden sıraya alma başlangıç ilerlemesini bozmaz',()=>{
  const s=createStore(':memory:');s.enqueue('https://www.sahibinden.com/otomobil','page');s.enqueue('https://www.sahibinden.com/otomobil','page');assert.equal(s.state().jobs.total,1);s.db.exec("UPDATE jobs SET status='done',initial_done=1");s.enqueue('https://www.sahibinden.com/otomobil','page',false);assert.equal(s.state().jobs.baselineCompleted,1);assert.equal(s.state().jobs.pending,1);assert.equal(s.state().server.demo,false);s.db.close();
});
test('girişsiz tarama erişim engelinde sahte ilan ve tamamlandı sonucu üretmez',async()=>{
  const s=createStore(':memory:');const c=new Crawler(s,'.');s.enqueue('https://www.sahibinden.com/otomobil','page');s.set('running',true);
  c.read=async()=>({html:'<title>Just a moment</title>',url:'https://www.sahibinden.com/otomobil',status:403});
  await c.drain();await c.stop();assert.equal(s.get('running'),false);assert.equal(s.get('phase'),'access_blocked');assert.equal(s.listings().length,0);assert.equal(s.get('baselineDone',false),false);assert.equal(s.state().source.mode,'public_only');s.db.close();
});

// Fixtures are used only by these in-memory tests, never by the application reader.
const detailUrl=id=>`https://www.sahibinden.com/ilan/vasita-otomobil-test-${id}/detay`;
const listHtml=(ids,pages=[])=>`<table>${ids.map(id=>`<tr><td><a href="${detailUrl(id)}">Test araç başlığı ${id}</a></td><td>900.000 TL</td></tr>`).join('')}</table>${pages.map(p=>`<a href="${p}">Sonraki sayfa</a>`).join('')}`;
const detailHtml=id=>`<h1>Test araç başlığı ${id}</h1><h3>900.000 TL</h3><li><span>Marka</span><strong>Test</strong></li><li><span>Yıl</span><strong>2020</strong></li>`;
function harness(t){
  const s=createStore(':memory:');let now=1000000,version=0;
  const reads=[],second=ROOT+'?pagingOffset=20';
  const c=new Crawler(s,'.',()=>{},{now:()=>now});
  s.set('gapSeconds',0);s.set('running',true);s.enqueue(ROOT,'page');
  c.read=async url=>{
    reads.push(url);
    let html;
    if(url===ROOT)html=listHtml(version>=1?['1000000003','1000000001']:['1000000001'],[second]);
    else if(url===second)html=listHtml(version>=3?['1000000004','1000000002']:['1000000002']);
    else html=detailHtml(url.match(/-(\d+)\/detay$/)[1]);
    return {html,url,status:200};
  };
  t.after(async()=>{await c.stop();s.db.close();});
  return {s,c,reads,second,advance:ms=>now+=ms,version:n=>version=n};
}
async function emptyQueue(c,s){
  for(let i=0;i<30;i++){
    if(!s.get('running')||!s.db.prepare("SELECT url FROM jobs WHERE status IN ('pending','busy')").get())return;
    await c.drain();
  }
  assert.fail('Test iş kuyruğu tamamlanmadı.');
}
test('ilk envanter bir kez yüklenir; 30 sn sonra yalnız yeni ilan detayı okunur',async t=>{
  const h=harness(t),{c,s,reads}=h;
  await emptyQueue(c,s);
  assert.equal(s.get('baselineDone'),true);
  assert.equal(s.listings().length,2);
  assert.equal(s.state().source.pageCheck.passed,true);
  assert.equal(s.state().source.reader.usesEdge,false);
  assert.equal(s.state().events.filter(e=>e.type==='new').length,0);
  const baselineAt=s.get('baselineCompletedAt'),baselineJobs=s.state().jobs.baselineCompleted;
  h.version(1);h.advance(CHECK_INTERVAL-1);
  assert.equal(c.schedule(),false);
  h.advance(1);assert.equal(c.schedule(),true);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind='detail' AND status='pending'").get().n,0);
  const pending=s.state().jobs.pending;
  h.advance(90000);assert.equal(c.schedule(),false);
  assert.equal(s.state().jobs.pending,pending,'çalışan kontrolün üstüne yeni kuyruk eklenmemeli');
  await emptyQueue(c,s);
  assert.equal(s.get('cyclesCompleted'),1);
  assert.equal(s.get('lastNewCount'),1);
  assert.equal(s.listings().length,3);
  assert.equal(s.state().events.filter(e=>e.type==='new').length,1);
  assert.equal(reads.filter(url=>url===detailUrl('1000000001')).length,1);
  assert.equal(reads.filter(url=>url===detailUrl('1000000002')).length,1);
  assert.equal(reads.filter(url=>url===detailUrl('1000000003')).length,1);
  assert.equal(s.get('baselineCompletedAt'),baselineAt);
  assert.equal(s.state().jobs.baselineCompleted,baselineJobs);
  h.version(2);h.advance(CHECK_INTERVAL);assert.equal(c.schedule(),true);await emptyQueue(c,s);
  assert.equal(s.get('cyclesCompleted'),2);
  assert.equal(s.get('lastNewCount'),0);
  assert.equal(s.state().events.filter(e=>e.type==='new').length,1,'aynı ilan ikinci kez yeni sayılmamalı');
  h.version(3);h.advance(CHECK_INTERVAL);c.schedule();await emptyQueue(c,s);
  assert.equal(s.get('lastNewCount'),1,'sonraki liste sayfasındaki yeni ilan da bulunmalı');
  assert.equal(s.listings().length,4);
  assert.equal(s.state().events.filter(e=>e.type==='new').length,2);
});
test('kaynak bekleme süresi tekrar denemede korunur; başarısız okuma sayacı artırmaz',async t=>{
  const h=harness(t),{c,s,reads}=h,read=c.read;
  c.read=async url=>{c.read=read;return {html:'',url,status:429,retryAfter:'60'};};
  await c.drain();
  const retryAt=s.get('retryAt');
  assert.equal(s.get('baselineDone',false),false);
  assert.equal(s.get('cyclesCompleted',0),0);
  assert.equal(s.state().source.lastAttempt.status,429);
  await c.resume();assert.equal(s.get('retryAt'),retryAt);assert.equal(reads.length,0);
  h.advance(59999);await c.drain();assert.equal(reads.length,0);
  h.advance(1);await emptyQueue(c,s);
  assert.equal(s.get('baselineDone'),true);
  assert.equal(s.get('retryAt'),null);
});
test('ilk envanterden sonraki erişim reddi yeni kontrolü başarılı göstermez',async t=>{
  const h=harness(t),{c,s}=h;
  await emptyQueue(c,s);h.advance(CHECK_INTERVAL);c.schedule();
  c.read=async url=>({html:'<title>Access denied</title>',url,status:403});
  await c.drain();
  assert.equal(s.get('running'),false);
  assert.equal(s.get('baselineDone'),true);
  assert.equal(s.get('cyclesCompleted',0),0);
  assert.equal(s.get('lastCheckAt'),null);
  assert.equal(s.state().source.lastAttempt.status,403);
  assert.equal(s.listings().length,2);
});
test('yeniden deneme seçili istek aralığını atlamaz ve beklemeyi gösterir',async t=>{
  const h=harness(t),{c,s}=h;let attempts=0;
  s.set('gapSeconds',60);
  c.read=async url=>{attempts++;return {html:'Access denied',url,status:403};};
  await c.drain();assert.equal(attempts,1);
  await c.resume();
  assert.equal(attempts,1);
  assert.equal(s.get('phase'),'waiting');
  assert.equal(s.get('nextRequestAt'),1060000);
  h.advance(60000);await c.drain();assert.equal(attempts,2);
  await c.stop();
  const restarted=new Crawler(s,'.',()=>{},{now:()=>h.advance(0)});
  t.after(()=>restarted.stop());
  restarted.read=async url=>{attempts++;return {html:'Access denied',url,status:403};};
  await restarted.start();
  assert.equal(attempts,2,'yeniden başlatma seçili istek aralığını atlamamalı');
  assert.equal(s.get('phase'),'waiting');
  assert.equal(s.get('nextRequestAt'),1120000);
  await restarted.stop();
});
test('bir saniyeden uzun yanıt işçiyi durdurmaz, sonraki iş otomatik işlenir',async t=>{
  const s=createStore(':memory:'),c=new Crawler(s,'.');
  t.after(async()=>{await c.stop();s.db.close();});
  s.set('running',true);s.set('gapSeconds',0);s.enqueue(ROOT,'page');
  const reads=[];
  c.read=async url=>{
    reads.push(url);
    if(url===ROOT)await new Promise(resolve=>setTimeout(resolve,1100));
    return {html:url===ROOT?listHtml(['1000000001']):detailHtml('1000000001'),url,status:200};
  };
  await c.drain();
  await new Promise(resolve=>setTimeout(resolve,1250));
  assert.equal(reads.length,2);
  assert.equal(s.get('baselineDone'),true);
});
test('yeniden başlatma ilk envanteri ve tamamlanmış detayları tekrar toplamaz',async t=>{
  const h=harness(t),{c,s,reads}=h;
  await emptyQueue(c,s);
  const initialAt=s.get('baselineCompletedAt');
  await c.stop();
  // Simulate a completed detail incorrectly queued by the previous scheduler.
  s.enqueue(detailUrl('1000000001'),'detail',false);
  const restarted=new Crawler(s,'.',()=>{},{now:()=>2000000});
  const newReads=[];
  restarted.read=async url=>{newReads.push(url);return {html:url===ROOT?listHtml(['1000000001']):listHtml(['1000000002']),url,status:200};};
  t.after(()=>restarted.stop());
  await restarted.start();await emptyQueue(restarted,s);
  assert.equal(s.get('baselineCompletedAt'),initialAt);
  assert.equal(s.get('baselineDone'),true);
  assert.equal(reads.filter(url=>url.includes('/detay')).length,2);
  assert.equal(newReads.some(url=>url.includes('/detay')),false);
  assert.equal(s.state().events.filter(e=>e.type==='new').length,0);
});

test('tekil ilan yenileme kuyruğu (refresh_jobs) queued -> done geçişini ve fiyat güncellemesini tamamlar',async t=>{
  const h=harness(t),{c,s}=h;
  await emptyQueue(c,s);
  s.set('gapSeconds',10);
  c.read=async url=>({html:'<h1>Test araç başlığı 1000000001</h1><h3>710.000 TL</h3><li><span>Marka</span><strong>Test</strong></li><li><span>Yıl</span><strong>2020</strong></li>',url,status:200});
  const job=c.requestListingRefresh('1000000001');
  assert.equal(job.listing_id,'1000000001');
  assert.equal(job.status,'queued');
  assert.ok(job.job_id.startsWith('ref_'));
  h.advance(10000);
  await c.drain();
  const status=c.getRefreshStatus('1000000001',job.job_id);
  assert.equal(status.status,'done');
  assert.equal(s.listings().find(x=>x.id==='1000000001').price,710000);
});

test('ilan bilgisine göre hatasız kabul ölçütleri (6 kabul örneği) ve 13 parça şeması doğrulanır',async()=>{
  const {ARAC_PARCALARI,boyaDegisenSayisi,parcaHaricIhlal,parseTramerInfo,ilanBilgisineGoreHatasizMi}=await import('./parser.mjs');
  const fullCleanParts=Object.fromEntries(ARAC_PARCALARI.map(p=>[p.key,'Orijinal']));

  // 1. Tam ve orijinal şema, açıkça sıfır tramer, ağır hasar yok, işlenmiş risk/uyarı yok -> Geçer
  const case1=ilanBilgisineGoreHatasizMi({
    title:'Temiz aile aracı',
    description:'Bakımları zamanında yapıldı.',
    parts:fullCleanParts,
    tramer_amount:0,
    heavy_damage:'Hayır'
  });
  assert.equal(case1.passed,true);

  // 2. Bir lokal boyalı parça -> Geçmez
  const case2=ilanBilgisineGoreHatasizMi({
    parts:{...fullCleanParts,sag_on_camurluk:'Lokal Boyalı'},
    tramer_amount:0,
    heavy_damage:'Hayır'
  });
  assert.equal(case2.passed,false);
  assert.equal(boyaDegisenSayisi({parts:{...fullCleanParts,sag_on_camurluk:'Lokal Boyalı'}}).boyali,1);
  assert.equal(parcaHaricIhlal({parts:{...fullCleanParts,sag_on_camurluk:'Lokal Boyalı'}},['sag_on_camurluk'],[]),true);

  // 3. Bir değişen parça -> Geçmez
  const case3=ilanBilgisineGoreHatasizMi({
    parts:{...fullCleanParts,kaput:'Değişen'},
    tramer_amount:0,
    heavy_damage:'Hayır'
  });
  assert.equal(case3.passed,false);
  assert.equal(parcaHaricIhlal({parts:{...fullCleanParts,kaput:'Değişen'}},[],['kaput']),true);

  // 4. Boya/değişen yok, tramer pozitif -> Geçmez
  const case4=ilanBilgisineGoreHatasizMi({
    parts:fullCleanParts,
    tramer_amount:12500,
    heavy_damage:'Hayır'
  });
  assert.equal(case4.passed,false);

  // 5. Şema veya tramer tutarı eksik -> Geçmez; ilgili alan Bilinmiyor
  const case5MissingSchema=ilanBilgisineGoreHatasizMi({
    tramer_amount:0,
    heavy_damage:'Hayır'
  });
  assert.equal(case5MissingSchema.passed,false);
  assert.equal(case5MissingSchema.schema.statusLabel,'Bilinmiyor');

  const case5MissingTramer=ilanBilgisineGoreHatasizMi({
    parts:fullCleanParts,
    heavy_damage:'Hayır'
  });
  assert.equal(case5MissingTramer.passed,false);
  assert.equal(parseTramerInfo({parts:fullCleanParts}).label,'Bilinmiyor');

  // 6. Şema temiz, açıklamada boya/değişen çelişkisi var -> Geçmez
  const case6=ilanBilgisineGoreHatasizMi({
    title:'Temiz araç',
    description:'Sol arka kapı lokal boyalı olup harici temizdir.',
    parts:fullCleanParts,
    tramer_amount:0,
    heavy_damage:'Hayır'
  });
  assert.equal(case6.passed,false);
  assert.ok(case6.badges.includes('aciklama_uyumsuz'));
});

test('başlıktaki peşinat/kredi TL tutarları fiyat olarak okunmaz ve -sb2f- tuzak satırları elenir',()=>{
  const html=`<h1>Audi Q2 Fiyatları &amp; Modelleri</h1>
  <table>
    <tr class="searchResultsItem">
      <td class="searchResultsTagAttributeValue">1.6 TDI</td>
      <td class="searchResultsTitleValue"><a href="/ilan/vasita-arazi-suv-pickup-audi-530.000tl-pesinatla-q2-1346508002/detay">530.000TL PEŞİNATLA 12 18 24 36 AY VADELİ SENETLE Q2</a></td>
      <td class="searchResultsAttributeValue">2018</td>
      <td class="searchResultsAttributeValue">145.000</td>
      <td class="searchResultsPriceValue"><div><span>1.885.000 TL</span></div></td>
    </tr>
    <tr class="searchResultsItem">
      <td class="searchResultsTagAttributeValue">1.6 TDI</td>
      <td class="searchResultsTitleValue"><a href="/ilan/vasita-arazi-suv-pickup-audi-otomatik-sb2f-temiz-846760541/detay">Otomatik Galeriden Dizel Bakımları Yapılı Audi Temiz Acil!</a></td>
      <td class="searchResultsPriceValue">1.935.000 TL</td>
    </tr>
  </table>`;
  const parsed=parseList(html,'https://www.sahibinden.com/arazi-suv-pickup/audi-q2');
  assert.equal(parsed.listings.length,1,'-sb2f- tuzak satırı elenmeli');
  assert.equal(parsed.listings[0].id,'1346508002');
  assert.equal(parsed.listings[0].price,1885000,'başlıktaki 530.000TL peşinat yerine fiyat sütunundaki 1.885.000 TL okunmalı');
  assert.equal(parsed.listings[0].brand,'Audi');
  assert.equal(parsed.listings[0].model,'Q2');
  assert.equal(parsed.listings[0].trim,'1.6 TDI');
});

test('detay sayfasındaki görsel boya-değişen şeması (.car-parts ve .car-damage-info-list) 13 parça olarak okunur',()=>{
  const html=`<h1>2020 Test Araç</h1><h3>1.450.000 TL</h3>
  <dl class="classifiedInfoList">
    <div class="classifiedInfoItem"><dt>Marka</dt><dd>Volkswagen</dd></div>
    <div class="classifiedInfoItem"><dt>Seri</dt><dd>Golf</dd></div>
    <div class="classifiedInfoItem"><dt>Yıl</dt><dd>2020</dd></div>
  </dl>
  <div class="car-parts">
    <div class="front-bumper original-new"></div>
    <div class="front-hood original-new"></div>
    <div class="roof original-new"></div>
    <div class="front-right-mudguard painted-new"></div>
    <div class="front-right-door local-painted-new"></div>
    <div class="rear-right-door original-new"></div>
    <div class="rear-right-mudguard original-new"></div>
    <div class="front-left-mudguard original-new"></div>
    <div class="front-left-door original-new"></div>
    <div class="rear-left-door original-new"></div>
    <div class="rear-left-mudguard original-new"></div>
    <div class="rear-hood original-new"></div>
    <div class="rear-bumper original-new"></div>
  </div>
  <div class="car-damage-info-list">
    <ul><li class="pair-title local-painted-new">Lokal Boyalı</li><li class="selected-damage">Sağ Ön Kapı</li></ul>
    <ul><li class="pair-title painted-new">Boyalı</li><li class="selected-damage">Sağ Ön Çamurluk</li></ul>
  </div>`;
  const d=parseDetail(html,'https://www.sahibinden.com/ilan/vasita-otomobil-test-1348311663/detay');
  assert.equal(d.parts.sag_on_kapi,'Lokal Boyalı');
  assert.equal(d.parts.sag_on_camurluk,'Boyalı');
  assert.equal(d.parts.kaput,'Orijinal');
  assert.deepEqual(d.damageGroups['Lokal Boyalı'],['Sağ Ön Kapı']);
  assert.deepEqual(d.damageGroups['Boyalı'],['Sağ Ön Çamurluk']);
  assert.equal(d.fields['Lokal Boyalı'],'Sağ Ön Kapı');
  assert.equal(d.fields['Boyalı'],'Sağ Ön Çamurluk');
});

test('50 ilan/sayfa URL üretimi, fiyat bandı derin tarama imleci, IQR emsal ve geçici ağ kesintisinde otomatik kurtarma çalışır',async t=>{
  const {buildPageUrl,iqrStats,evaluateOpportunityCandidate}=await import('./parser.mjs');
  const url=buildPageUrl(ROOT,{offset:100,pagingSize:50,sort:'date_desc',priceMin:550000,priceMax:725000});
  assert.ok(url.includes('pagingSize=50'));
  assert.ok(url.includes('sorting=date_desc'));
  assert.ok(url.includes('price_min=550000'));
  assert.ok(url.includes('price_max=725000'));
  assert.ok(url.includes('pagingOffset=100'));

  // IQR outlier filtering ignores extreme typo prices
  const stats=iqrStats([1000000,1020000,1040000,1050000,1060000,99000000]);
  assert.equal(stats.count,5);
  assert.equal(stats.median,1040000);

  // Selective opportunity candidate detection
  const peers=[
    {id:'1',brand:'Renault',model:'Clio',year:2021,price:1000000,title:'A'},
    {id:'2',brand:'Renault',model:'Clio',year:2021,price:1020000,title:'B'},
    {id:'3',brand:'Renault',model:'Clio',year:2021,price:1040000,title:'C'},
    {id:'4',brand:'Renault',model:'Clio',year:2021,price:1060000,title:'D'}
  ];
  const cheap=evaluateOpportunityCandidate({id:'5',brand:'Renault',model:'Clio',year:2021,price:910000},peers);
  assert.equal(cheap.isCandidate,true);
  const expensive=evaluateOpportunityCandidate({id:'6',brand:'Renault',model:'Clio',year:2021,price:1050000},peers);
  assert.equal(expensive.isCandidate,false);

  // Deep scan cursor & transient network error auto-recovery (failStreak)
  const s=createStore(':memory:');
  let now=5000000;
  const c=new Crawler(s,'.',()=>{},{now:()=>now});
  t.after(async()=>{await c.stop();s.db.close();});
  const batch=c.advanceDeepScanBatch(1,4);
  assert.equal(batch.urls.length,4);
  assert.equal(batch.cursor.offset,200);
  assert.equal(batch.cursor.pagesScanned,4);

  // Simulate transient ERR_INTERNET_DISCONNECTED -> should NOT set running=false
  s.set('running',true);
  s.enqueue(ROOT,'page');
  c.read=async()=>{throw new Error('page.goto: net::ERR_INTERNET_DISCONNECTED at https://www.sahibinden.com/otomobil');};
  await c.drain();
  assert.equal(s.get('running'),true,'geçici internet kesintisi taramayı kalıcı olarak durdurmamalı');
  assert.equal(s.get('failStreak'),1);
  assert.ok(s.get('retryAt')>now);
});

test('metin içi parça NLP ayrıştırıcısı ve tramer tutarı indeksleme doğrulanır', async () => {
  const { extractPartsFromText, boyaDegisenSayisi, parseTramerInfo, parcaHaricIhlal } = await import('./parser.mjs');

  // 1. Serbest metinden parça durumları ayrıştırma
  const parts1 = extractPartsFromText('Kaput: boyalı, tavan: orijinal, bagaj: değişen');
  assert.equal(parts1.kaput, 'Boyalı');
  assert.equal(parts1.tavan, 'Orijinal');
  assert.equal(parts1.bagaj, 'Değişen');

  // 2. 'Tavan hariç boyalı' kuralı -> Tavan orijinal kalmalı
  const parts2 = extractPartsFromText('Tavan hariç bel altı temizlik boyalı');
  assert.equal(parts2.tavan, 'Orijinal');

  // 3. Lokal boya ve değişen ayrıştırma
  const parts3 = extractPartsFromText('Aracımda kaput yarım boya sol ön çamurluk lokal boyalıdır');
  assert.equal(parts3.kaput, 'Lokal Boyalı');
  assert.equal(parts3.sol_on_camurluk, 'Lokal Boyalı');

  // 4. Parça ihlal kontrolü
  const itemNoTavan = { description: 'Tavan hariç bel altı boyalı' };
  assert.equal(parcaHaricIhlal(itemNoTavan, ['tavan']), false); // Tavan boyalı değil, ihlal yok

  const itemTavanPainted = { description: 'Tavan boyalıdır, dolu izi nedeniyle boyandı' };
  assert.equal(parcaHaricIhlal(itemTavanPainted, ['tavan']), true); // Tavan boyalı, ihlal var

  // 5. Tramer tutarı metinden okuma
  const t1 = parseTramerInfo({ title: 'HASAR KAYDI : 39.736 TL' });
  assert.equal(t1.known, true);
  assert.equal(t1.amount, 39736);

  const t2 = parseTramerInfo({ description: 'trameri 3 bin harici kondisyonu süper' });
  assert.equal(t2.known, true);
  assert.equal(t2.amount, 3000);

  const t3 = parseTramerInfo({ title: 'TRAMER SADECE: 680TL' });
  assert.equal(t3.known, true);
  assert.equal(t3.amount, 680);

  const t4 = parseTramerInfo({ title: 'Hatasız Boyasız Tramersiz' });
  assert.equal(t4.known, true);
  assert.equal(t4.amount, 0);

  // 6. Tramer belirtilmemişse kesinlikle 0 sayılmamalı (Bilinmiyor olmalı)
  const tUnknown = parseTramerInfo({ title: '2022 model Ford Ecosport temiz aile aracı', description: 'Bakımlı masrafsız' });
  assert.equal(tUnknown.known, false);
  assert.equal(tUnknown.amount, null);
  assert.equal(tUnknown.label, 'Bilinmiyor');
});
