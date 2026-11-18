import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { CrawlerWorkerClient } from './crawler-client.mjs';
const base=path.dirname(fileURLToPath(import.meta.url)),publicDir=path.join(base,'public'),port=Number(process.env.PORT||8765),host=process.env.HOST||'127.0.0.1';
const allowRemote=process.env.ALLOW_REMOTE==='1'||host==='0.0.0.0'||host==='::';
const authUser=process.env.AUTH_USER||'admin',authPass=process.env.AUTH_PASS||'';
function safeEqual(a,b){const ba=Buffer.from(String(a)),bb=Buffer.from(String(b));return ba.length===bb.length&&crypto.timingSafeEqual(ba,bb);}
function checkBasicAuth(req){
  if(!authPass)return true;
  const header=req.headers.authorization||'';
  if(!header.startsWith('Basic '))return false;
  let decoded='';
  try{decoded=Buffer.from(header.slice(6),'base64').toString('utf8');}catch{return false;}
  const idx=decoded.indexOf(':');
  if(idx<0)return false;
  return safeEqual(decoded.slice(0,idx),authUser)&&safeEqual(decoded.slice(idx+1),authPass);
}
const store=createStore(path.join(base,'data/radar.sqlite'));const clients=new Set();
function broadcast(){for(const r of clients){try{r.write(`data: ${JSON.stringify({updatedAt:Date.now()})}\n\n`);}catch{clients.delete(r);}}}
const isStandaloneCrawler = process.env.NO_CRAWLER === '1' || process.env.STANDALONE_CRAWLER === '1';
let crawler;
if (!isStandaloneCrawler) {
  crawler = new CrawlerWorkerClient(store, base, broadcast);
} else {
  console.log('[Web Server] Bağımsız tarayıcı modu devrede (Crawler bu süreçte çalıştırılmıyor).');
  crawler = {
    resume: async () => {},
    pause: async () => {},
    turbo: async () => {},
    drain: async () => {},
    openVerification: async () => ({}),
    ingestExternal: async () => ({ count: 0 }),
    requestListingRefresh: (id) => ({ ok: true, status: 'queued', job_id: `ref_${Date.now()}_${id}` }),
    getRefreshStatus: (id, jobId) => {
      const row = jobId
        ? store.db.prepare('SELECT * FROM refresh_jobs WHERE job_id=? AND listing_id=?').get(String(jobId), String(id))
        : store.db.prepare('SELECT * FROM refresh_jobs WHERE listing_id=? ORDER BY created_at DESC LIMIT 1').get(String(id));
      if (!row) return null;
      return { job_id: row.job_id, listing_id: row.listing_id, status: row.status, error: row.error, updatedAt: row.updated_at };
    },
    stop: async () => {}
  };
}
const send=(res,status,data,req=null)=>{
  const json=typeof data==='string'?data:JSON.stringify(data);
  const accept=req?.headers?.['accept-encoding']||'';
  if(accept.includes('gzip')&&json.length>1024){
    const buf=zlib.gzipSync(Buffer.from(json));
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Encoding':'gzip','Cache-Control':'no-store'});
    res.end(buf);
  }else{
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(json);
  }
};
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const allowedBridgeOrigin=(origin,reqHost)=>!origin||[`http://127.0.0.1:${port}`,`http://localhost:${port}`,'https://www.sahibinden.com','https://sahibinden.com'].includes(origin)||(allowRemote&&Boolean(reqHost)&&[`http://${reqHost}`,`https://${reqHost}`].includes(origin))||origin.startsWith('chrome-extension://')||origin.startsWith('moz-extension://');
const isAllowedPostOrigin=(origin,reqHost)=>!origin||[`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(origin)||(allowRemote&&Boolean(reqHost)&&[`http://${reqHost}`,`https://${reqHost}`].includes(origin));

const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(!allowRemote&&!['127.0.0.1','localhost'].some(h=>req.headers.host===`${h}:${port}`)){send(res,403,{error:'Yalnız yerel erişim.'},req);return;}
  const url=new URL(req.url,`http://${req.headers.host||`127.0.0.1:${port}`}`);
  if(url.pathname==='/api/ingest'&&allowedBridgeOrigin(req.headers.origin,req.headers.host)){
    if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
    res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  }
  try{
    if(url.pathname==='/api/health')return send(res,200,{ok:true,app:'arac-radar',pid:process.pid,demo:false},req);
    if(!checkBasicAuth(req)){
      res.writeHead(401,{'WWW-Authenticate':'Basic realm="Arac Radar", charset="UTF-8"','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify({error:'Yetkisiz erişim. Kullanıcı adı ve şifre gerekli.'}));
      return;
    }
    if(req.method==='GET'&&url.pathname==='/api/state'){
      const since=url.searchParams.get('since');
      if(since) return send(res,200,store.stateDelta(Number(since)),req);
      const all=url.searchParams.get('all')==='true';
      const limit=all ? 0 : (Number(url.searchParams.get('limit')) || 3000);
      return send(res,200,store.state(limit),req);
    }
    if(req.method==='GET'&&url.pathname==='/api/state/delta'){
      const since=Number(url.searchParams.get('since'))||0;
      return send(res,200,store.stateDelta(since),req);
    }
    if(req.method==='GET'&&url.pathname==='/api/live/pulse'){
      const dayAgo=Date.now()-86400000;
      const todayNewCount=store.db.prepare('SELECT COUNT(1) AS c FROM listings WHERE first_seen>=?').get(dayAgo).c;
      const priceDropCount=store.db.prepare("SELECT COUNT(1) AS c FROM events WHERE type='price_drop'").get().c;
      const totalListings=store.db.prepare('SELECT COUNT(1) AS c FROM listings').get().c;
      const lastSuccess=store.get('lastSuccess');
      const events=store.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 20').all();
      return send(res,200,{ok:true,todayNewCount,priceDropCount,totalListings,lastSuccess,events,uiPollSeconds:30},req);
    }
    if(req.method==='GET'&&url.pathname==='/api/events'){
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
      res.write(': connected\n\n');
      clients.add(res);
      const ping=setInterval(()=>{
        try{res.write(': heartbeat\n\n');}catch{clearInterval(ping);clients.delete(res);}
      },15000);
      req.on('close',()=>{clearInterval(ping);clients.delete(res);});
      return;
    }
    if(req.method==='GET'&&url.pathname==='/api/brands'){
      return send(res,200,store.getDistinctBrands(),req);
    }
    if(req.method==='GET'&&url.pathname==='/api/models'){
      const brand=url.searchParams.get('brand')||'';
      return send(res,200,store.getDistinctModels(brand),req);
    }
    if(req.method==='GET'&&url.pathname==='/api/category-search'){
      const q=url.searchParams.get('q')||'';
      const brand=url.searchParams.get('brand')||'';
      return send(res,200,store.searchCategories(q,brand),req);
    }
    if(req.method==='GET'&&url.pathname==='/api/category-tree'){
      const brand=url.searchParams.get('brand')||'';
      const series=url.searchParams.get('series')||'';
      return send(res,200,store.getCategoryTree(brand,series),req);
    }
    if(req.method==='GET'&&url.pathname==='/api/valuation'){
      const brand=url.searchParams.get('brand')||'';
      const model=url.searchParams.get('model')||'';
      const trim=url.searchParams.get('trim')||'';
      const year=Number(url.searchParams.get('year'))||0;
      const km=url.searchParams.get('km')?Number(url.searchParams.get('km')):null;
      const gear=url.searchParams.get('gear')||'';
      const roofHood=url.searchParams.get('roofHood')||'orijinal';
      const paintedCount=Number(url.searchParams.get('paintedCount'))||0;
      const tramer=Number(url.searchParams.get('tramer'))||0;
      const sunroof=url.searchParams.get('sunroof')==='true'||url.searchParams.get('sunroof')==='1';
      const targetPrice=url.searchParams.get('targetPrice')?Number(url.searchParams.get('targetPrice')):null;
      const listingId=url.searchParams.get('listingId')||null;
      const result=store.getValuation({brand,model,trim,year,km,gear,roofHood,paintedCount,tramer,sunroof,targetPrice,listingId});
      return send(res,result.ok?200:400,result,req);
    }
    if(req.method==='GET'&&/^\/api\/listings\/\d+\/refresh-status$/.test(url.pathname)){
      const id=url.pathname.split('/')[3],jobId=url.searchParams.get('job_id');
      const status=crawler.getRefreshStatus(id,jobId);
      if(!status)return send(res,404,{error:'Yenileme işi bulunamadı.'},req);
      return send(res,200,status,req);
    }
    if(req.method==='GET'&&/^\/api\/listings\/\d+$/.test(url.pathname)){
      const id=url.pathname.split('/').pop(),item=store.getListing(id);if(!item)return send(res,404,{error:'İlan bulunamadı.'},req);return send(res,200,{...item,history:store.db.prepare('SELECT price,at FROM history WHERE listing_id=? ORDER BY at,id').all(id)},req);
    }
    if(req.method==='GET'&&/^\/api\/listing-no\/\d+$/.test(url.pathname)){
      const id=url.pathname.split('/').pop(),item=store.getListing(id);
      const customUrl=url.searchParams.get('url');
      if(item&&item.brand&&item.price){
        return send(res,200,{ok:true,found:true,complete:true,listing:{...item,history:store.db.prepare('SELECT price,at FROM history WHERE listing_id=? ORDER BY at,id').all(id)}},req);
      }
      const targetUrl=customUrl||item?.url||`https://www.sahibinden.com/ilan/vasita-otomobil-${id}/detay`;
      store.ingest({id,url:targetUrl,title:item?.title||`İlan #${id} (Kaynaktan okunuyor…)`},false);
      const job=await crawler.requestListingRefresh(id);
      broadcast();
      return send(res,202,{ok:true,found:!!item,complete:false,listing_id:id,job_id:job.job_id,status:job.status,listing:item||null,message:'İlan kaynaktan okuma kuyruğuna alındı.'},req);
    }
    if(req.method==='POST'){
      const origin=req.headers.origin;
      const isBridge=url.pathname==='/api/ingest'&&allowedBridgeOrigin(origin,req.headers.host);
      if(!isBridge&&!isAllowedPostOrigin(origin,req.headers.host))return send(res,403,{error:'Başka kaynaktan işlem engellendi.'},req);
      if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'JSON gerekli.'},req);
      const maxLen=url.pathname==='/api/ingest'?6000000:16000;
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>maxLen)return send(res,413,{error:'İstek fazla büyük.'},req);}const body=raw?JSON.parse(raw):{};
      if(url.pathname==='/api/crawl/model'){
        const brand=String(body.brand||'').trim();
        const model=String(body.model||'').trim();
        if(!brand)return send(res,400,{error:'Marka zorunludur.'},req);
        const queryText=`${brand} ${model}`.trim();
        const searchUrl=`https://www.sahibinden.com/kelime-ile-arama?query_text=${encodeURIComponent(queryText)}&sorting=date_desc&pagingSize=50`;
        store.enqueue(searchUrl,'page',false,store.get('cycleSerial',0));
        if(!store.get('running',false))store.set('running',true);
        void crawler.drain();
        broadcast();
        return send(res,200,{ok:true,message:`${queryText} için kaynak taraması başlatıldı.`,url:searchUrl},req);
      }
      if(url.pathname==='/api/crawl/resume'){await crawler.resume();return send(res,200,store.state(),req);}
      if(url.pathname==='/api/crawl/turbo'){await crawler.turbo();return send(res,200,store.state(),req);}
      if(url.pathname==='/api/crawl/pause'){crawler.pause();return send(res,200,store.state(),req);}
      if(url.pathname==='/api/crawl/verify'){await crawler.openVerification();return send(res,200,store.state(),req);}
      if(url.pathname==='/api/ingest'){const info=await crawler.ingestExternal(body);broadcast();return send(res,200,{...info,state:store.state()},req);}
      if(/^\/api\/listings\/\d+\/refresh$/.test(url.pathname)){const id=url.pathname.split('/')[3];const job=await crawler.requestListingRefresh(id);broadcast();return send(res,202,job,req);}
      if(url.pathname==='/api/settings'){const gap=Number(body.gapSeconds);if(!Number.isInteger(gap)||gap<1||gap>300)return send(res,400,{error:'İstek aralığı 1–300 saniye olmalı.'},req);store.set('gapSeconds',gap);broadcast();return send(res,200,store.state(),req);}
      if(/^\/api\/favorites\/\d+$/.test(url.pathname)){const id=url.pathname.split('/').pop();const result=store.db.prepare('UPDATE listings SET favorite=? WHERE id=?').run(+!!body.active,id);if(!result.changes)return send(res,404,{error:'İlan bulunamadı.'},req);store.invalidateListings();broadcast();return send(res,200,{ok:true},req);}
      return send(res,404,{error:'İşlem bulunamadı.'},req);
    }
    if(req.method!=='GET')return send(res,405,{error:'Yöntem desteklenmiyor.'});
    const file=path.resolve(publicDir,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(publicDir+path.sep))return send(res,403,{error:'Geçersiz dosya.'});
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())return send(res,404,{error:'Dosya bulunamadı.'});
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'none'");
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(file).pipe(res);
  }catch(e){send(res,500,{error:String(e.message).slice(0,400)});}
});
server.on('error',e=>{console.error(e.message);process.exit(1);});
server.on('clientError',(err,socket)=>{try{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nLutfen http://127.0.0.1:8765 adresini kullanin (https degil).');}catch{}});
server.listen(port,host,()=>{fs.mkdirSync(path.join(base,'data'),{recursive:true});fs.writeFileSync(path.join(base,'data/server.pid'),String(process.pid));console.log(`Araç Radar: http://${host}:${port}${authPass?' (Şifreli erişim aktif)':''}`);});
async function shutdown(){if(crawler)await crawler.stop();for(const r of clients)r.end();server.close(()=>{store.db.close();process.exit(0);});}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
