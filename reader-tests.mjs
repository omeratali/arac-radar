import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackgroundReader } from './source-reader.mjs';
import { parseList } from './parser.mjs';

// Real Chromium runs only against this temporary local fixture server.
// No production database is opened and no real source is contacted by these tests.
test('arka plan okuyucusu JavaScript çalıştırır; doğrulama ve giriş sayfalarını işlemez', async t => {
  let challengeExecutions = 0, loginRequests = 0;
  const challenge = '<title>Just a moment...</title><script>fetch("/should-not-run")</script>';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/dynamic') {
      res.end('<!doctype html><title>Yerel okuyucu testi</title><div id="result"></div><script>fetch("/fixture-data").then(r=>r.json()).then(data=>{document.querySelector("#result").innerHTML=data.html;});</script>');
    } else if (url.pathname === '/fixture-data') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ html: '<table><tr><td><a href="https://www.sahibinden.com/ilan/vasita-otomobil-test-1234567890/detay">Yalnız test için araç başlığı</a></td><td>900.000 TL</td></tr></table>' }));
    } else if (url.pathname === '/blocked') {
      res.writeHead(403); res.end(challenge);
    } else if (url.pathname === '/blocked-200') {
      res.end(challenge);
    } else if (url.pathname === '/dynamic-blocked') {
      res.end('<title>Yerel test</title><a href="https://www.sahibinden.com/ilan/vasita-otomobil-test-1234567890/detay">Test bağlantısı</a><script>document.title="Just a moment...";</script>');
    } else if (url.pathname === '/login-start') {
      res.writeHead(302, { Location: '/giris?return=fixture' }); res.end();
    } else if (url.pathname === '/public-redirect') {
      res.writeHead(302, { Location: '/dynamic' }); res.end();
    } else if (url.pathname === '/giris') {
      loginRequests++; res.end('<h1>Test giriş ekranı</h1>');
    } else if (url.pathname === '/should-not-run') {
      challengeExecutions++; res.end('Bu kod çalışmamalı.');
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const states = [];
  const reader = new BackgroundReader(path.dirname(fileURLToPath(import.meta.url)), state => states.push({ ...state }), {
    allowedUrl: raw => { try { const url = new URL(raw); return url.origin === origin ? url.href : null; } catch { return null; } }
  });
  t.after(async () => { await reader.stop(); await new Promise(resolve => server.close(resolve)); });

  await t.test('görünür pencere olmadan JavaScript ile sonradan gelen ilan bağlantısı okunur', async () => {
    const result = await reader.read(origin + '/dynamic');
    assert.equal(result.status, 200);
    assert.equal(result.problem, undefined);
    const listings = parseList(result.html).listings;
    assert.equal(listings.length, 1);
    assert.equal(listings[0].price, 900000);
    assert.equal(reader.state.usesEdge, false);
    assert.equal(reader.state.pagesRead, 1);
  });
  await t.test('403 doğrulama yanıtındaki kod çalıştırılmaz ve tarayıcı kapatılır', async () => {
    const result = await reader.read(origin + '/blocked');
    assert.equal(result.status, 403);
    assert.equal(result.problem.reason, 'browser_verification');
    assert.equal(challengeExecutions, 0);
    assert.equal(reader.browser, null);
    assert.equal(reader.state.state, 'blocked');
  });
  await t.test('HTTP 200 doğrulama sayfası da ilan kabul edilmez', async () => {
    const result = await reader.read(origin + '/blocked-200');
    assert.equal(result.status, 200);
    assert.equal(result.problem.reason, 'browser_verification');
    assert.equal(challengeExecutions, 0);
    assert.equal(reader.state.pagesRead, 1);
  });
  await t.test('giriş yönlendirmesi giriş ekranı istenmeden durdurulur', async () => {
    const result = await reader.read(origin + '/login-start');
    assert.equal(result.status, 302);
    assert.equal(result.problem.phase, 'auth_required');
    assert.equal(loginRequests, 0);
    assert.equal(reader.browser, null);
    assert.ok(states.every(state => state.usesEdge === false));
  });
  await t.test('izin verilen sayfa yönlendirmesinde son adres ve JavaScript korunur', async () => {
    const result = await reader.read(origin + '/public-redirect');
    assert.equal(result.status, 200);
    assert.equal(result.url, origin + '/dynamic');
    assert.equal(parseList(result.html).listings.length, 1);
  });
  await t.test('JavaScript sonrasında doğrulama görünürse sonuç durdurulur ve motor kapanır', async () => {
    const result = await reader.read(origin + '/dynamic-blocked');
    assert.equal(result.problem.reason, 'browser_verification');
    assert.equal(reader.browser, null);
    assert.equal(reader.state.state, 'blocked');
  });
});
