import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.resolve(scriptDir, '..');
const dbPath = path.join(baseDir, 'data', 'radar.sqlite');
const gzPath = path.join(baseDir, 'data', 'radar.sqlite.gz');

async function main() {
  if (!fs.existsSync(dbPath)) {
    console.error(`Hata: Veritabanı bulunamadı: ${dbPath}`);
    process.exitCode = 1;
    return;
  }

  console.log('[DB Sıkıştırma] WAL kaydı ana veritabanına birleştiriliyor (PRAGMA wal_checkpoint)...');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } finally {
    db.close();
  }

  const rawBytes = fs.statSync(dbPath).size;
  const rawMb = (rawBytes / (1024 * 1024)).toFixed(2);
  console.log(`[DB Sıkıştırma] Ham veritabanı boyutu: ${rawMb} MB. Sıkıştırılıyor...`);

  await pipeline(
    fs.createReadStream(dbPath),
    zlib.createGzip({ level: 6 }),
    fs.createWriteStream(gzPath)
  );

  const gzBytes = fs.statSync(gzPath).size;
  const gzMb = (gzBytes / (1024 * 1024)).toFixed(2);

  console.log('');
  console.log('==========================================================');
  console.log(` Sıkıştırma Tamamlandı: ${rawMb} MB -> ${gzMb} MB`);
  console.log(` Çıktı Dosyası: ${gzPath}`);
  console.log('==========================================================');
  console.log(' GitHub Release (db-snapshot) üzerine yüklemek için:');
  console.log(' 1) GitHub CLI (gh) kuruluysa:');
  console.log('    gh release create db-snapshot --title "Arac Radar Canli Veritabani" --notes "Otomatik DB yedegi" 2>$null; gh release upload db-snapshot data/radar.sqlite.gz --clobber');
  console.log(' 2) Veya GitHub web arayüzünden deponuzdaki Releases -> Draft a new release');
  console.log('    bölümünde Tag: "db-snapshot" seçip data/radar.sqlite.gz dosyasını ekleyin.');
  console.log('==========================================================');
}

main().catch(err => {
  console.error('[DB Sıkıştırma] Hata:', err.message);
  process.exitCode = 1;
});
