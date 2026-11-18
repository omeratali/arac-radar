const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const base=__dirname,url='http://127.0.0.1:8765';
async function health(){try{return await (await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)})).json();}catch{return null;}}
(async()=>{
  const existing=await health();
  if(process.argv.includes('--stop')){
    const file=path.join(base,'data/server.pid');
    if(existing?.app==='arac-radar'&&fs.existsSync(file)&&Number(fs.readFileSync(file,'utf8'))===existing.pid){process.kill(existing.pid);console.log('Arac Radar sunucusu durduruldu.');return;}
    console.log('Bu klasore ait calisan sunucu bulunamadi.');return;
  }
  if(existing){if(existing.app!=='arac-radar')throw new Error('8765 portu baska bir uygulamada kullaniliyor.');console.log(url);return;}
  require('./reader-runtime.cjs').ensureReader(base);
  fs.mkdirSync(path.join(base,'data'),{recursive:true});
  const log=fs.openSync(path.join(base,'data/server.log'),'a');
  const child=spawn(process.execPath,[path.join(base,'server.mjs')],{cwd:base,detached:true,windowsHide:true,stdio:['ignore',log,log]});child.unref();fs.closeSync(log);
  for(let i=0;i<35;i++){await new Promise(r=>setTimeout(r,300));const h=await health();if(h?.app==='arac-radar'){console.log(url);return;}}
  throw new Error('Sunucu baslatilamadi. data/server.log dosyasini kontrol et.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
