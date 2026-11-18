import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execSync } from 'node:child_process';
import runtime from './reader-runtime.cjs';
import { accessProblem, sourceUrl } from './parser.mjs';

function cleanupStaleChrome(profileDir, savedPid) {
  if (savedPid) {
    try { process.kill(savedPid, 'SIGKILL'); } catch {}
    if (process.platform === 'win32') {
      try { execSync(`taskkill /F /T /PID ${savedPid}`, { stdio: 'ignore' }); } catch {}
    }
  }
  if (process.platform === 'win32') {
    try {
      execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*chrome-cdp-profile*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"', { stdio: 'ignore', timeout: 5000 });
    } catch {}
  } else {
    try {
      execSync('pkill -9 -f chrome-cdp-profile', { stdio: 'ignore', timeout: 3000 });
    } catch {}
  }
  for (const lockName of ['lockfile', 'SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try { fs.rmSync(path.join(profileDir, lockName), { force: true }); } catch {}
  }
}

const challengeResource = url => /\/cdn-cgi\/challenge-platform(?:\/|$)|^https:\/\/challenges\.cloudflare\.com\//i.test(url);
const publicDiagnosticUrl = raw => { try { const u = new URL(raw); return u.origin + u.pathname; } catch { return ''; } };

function findChromeExecutable(base) {
  const candidates = [
    process.env.CHROME_EXECUTABLE,
    ...(process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
        ]
      : [
          '/usr/bin/google-chrome-stable',
          '/usr/bin/google-chrome',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/snap/bin/chromium'
        ])
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  const installed = runtime.getRuntime(base);
  return installed.executable;
}

function getFreePort(preferred = 9224) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', () => {
      const fallback = net.createServer();
      fallback.unref();
      fallback.on('error', reject);
      fallback.listen(0, '127.0.0.1', () => {
        const p = fallback.address().port;
        fallback.close(() => resolve(p));
      });
    });
    srv.listen(preferred, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

async function waitForCdp(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) });
      if (r.ok) return await r.json();
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

export class BackgroundReader {
  constructor(base, onStatus = () => {}, { allowedUrl = sourceUrl } = {}) {
    this.base = base;
    this.onStatus = onStatus;
    this.allowedUrl = allowedUrl;
    this.isCustomAllowedUrl = allowedUrl !== sourceUrl;
    this.browser = null;
    this.context = null;
    this.activePage = null;
    this.chromeProc = null;
    this.cdpPort = null;
    this.visibleWindow = false;
    this.closed = false;
    this.state = { engine: 'Chromium', mode: 'background', javascript: true, usesEdge: false, state: 'stopped', version: null, pagesRead: 0 };
    this.onStatus(this.state);
  }

  status(state, extra = {}) {
    this.state = { ...this.state, ...extra, state };
    this.onStatus(this.state);
  }

  async ready() {
    if (this.closed) throw new Error('Arka plan okuyucusu kapatıldı.');
    if (this.browser?.isConnected()) return;
    this.status('starting');
    const installed = runtime.getRuntime(this.base);
    if (!this.isCustomAllowedUrl) {
      await this.readyLive(installed);
      return;
    }
    if (!fs.existsSync(installed.executable)) throw new Error('Chromium kurulu değil. Baslat.cmd arka plan okuyucusunu kurabilir.');
    this.browser = await installed.chromium.launch({ channel: 'chromium', headless: true });
    if (this.closed) { await this.release(); throw new Error('Arka plan okuyucusu kapatıldı.'); }
    this.context = await this.browser.newContext({ javaScriptEnabled: true, acceptDownloads: false, serviceWorkers: 'block' });
    this.status('ready', { version: this.browser.version(), playwrightVersion: installed.version });
  }

  async readyLive(installed) {
    const absBase = path.resolve(this.base);
    const cdpFile = path.join(absBase, 'data', 'chrome-cdp.json');
    const profileDir = path.join(absBase, 'data', 'chrome-cdp-profile');
    fs.mkdirSync(profileDir, { recursive: true });

    let saved = null;
    if (fs.existsSync(cdpFile)) {
      try { saved = JSON.parse(fs.readFileSync(cdpFile, 'utf8')); } catch {}
    }

    const candidatePorts = [saved?.port, 9224].filter((p, i, a) => p && a.indexOf(p) === i);
    for (const p of candidatePorts) {
      if (await waitForCdp(p, 2000)) {
        try {
          this.browser = await installed.chromium.connectOverCDP(`http://127.0.0.1:${p}`);
          this.context = this.browser.contexts()[0] || await this.browser.newContext();
          this.cdpPort = p;
          const pages = this.context.pages();
          for (let i = 1; i < pages.length; i++) {
            try { await pages[i].close(); } catch {}
          }
          fs.writeFileSync(cdpFile, JSON.stringify({ port: p, pid: saved?.pid || null }));
          this.status('ready', { version: this.browser.version(), playwrightVersion: installed.version, mode: this.visibleWindow ? 'visible_session' : 'background_persistent' });
          return;
        } catch {}
      }
    }

    cleanupStaleChrome(profileDir, saved?.pid);
    await new Promise(r => setTimeout(r, 600));

    const exe = findChromeExecutable(this.base);
    if (!fs.existsSync(exe)) throw new Error('Tarayıcı motoru bulunamadı.');
    const port = await getFreePort(9224);
    this.cdpPort = port;
    const isLinux = process.platform === 'linux';
    const proxyUrl = String(process.env.PROXY_URL || '').trim();
    const args = [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--lang=tr-TR',
      ...(isLinux ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : []),
      ...(isLinux && !process.env.DISPLAY && !this.visibleWindow ? ['--headless=new'] : []),
      ...(proxyUrl ? [`--proxy-server=${proxyUrl}`] : []),
      this.visibleWindow ? '--window-position=100,60' : '--window-position=-2400,-2400',
      '--window-size=1366,768',
      'about:blank'
    ];
    this.chromeProc = spawn(exe, args, {
      cwd: this.base,
      detached: false,
      windowsHide: !this.visibleWindow,
      stdio: 'ignore'
    });
    this.chromeProc.unref();
    fs.writeFileSync(cdpFile, JSON.stringify({ port, pid: this.chromeProc.pid }));

    const info = await waitForCdp(port, isLinux ? 20000 : 12000);
    if (!info) {
      cleanupStaleChrome(profileDir, this.chromeProc?.pid);
      throw new Error('Kalıcı tarayıcı oturumu başlatılamadı.');
    }
    this.browser = await installed.chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    if (this.closed) { await this.release(true); throw new Error('Arka plan okuyucusu kapatıldı.'); }
    this.context = this.browser.contexts()[0] || await this.browser.newContext();
    this.status('ready', { version: this.browser.version(), playwrightVersion: installed.version, mode: this.visibleWindow ? 'visible_session' : 'background_persistent' });
  }

  async openVerificationWindow(targetUrl = 'https://www.sahibinden.com/otomobil') {
    this.visibleWindow = true;
    await this.release(true);
    await this.ready();
    const pages = this.context.pages();
    const page = pages[0] || await this.context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    return { ok: true, mode: 'visible_session', url: page.url() };
  }

  async read(rawUrl, { kind = 'page' } = {}) {
    if (!this.isCustomAllowedUrl) {
      return this.readLive(rawUrl, { kind });
    }
    return this.readIsolated(rawUrl, { kind });
  }

  async readLive(rawUrl, { kind = 'page' } = {}) {
    const url = this.allowedUrl(rawUrl);
    if (!url) throw new Error('Okuyucu için kaynak adresi geçersiz.');
    let page, lastStatus = 200, retryAfter = null;
    const onResponse = res => {
      try {
        if (res.request().isNavigationRequest() && res.frame() === page.mainFrame()) {
          lastStatus = res.status();
          retryAfter = res.headers()['retry-after'] || null;
        }
      } catch {}
    };
    try {
      await this.ready();
      const pages = this.context.pages();
      for (let i = 1; i < pages.length; i++) {
        try { await pages[i].close(); } catch {}
      }
      page = pages[0] || await this.context.newPage();
      this.activePage = page;
      this.status('reading', { lastUrl: publicDiagnosticUrl(url), error: null });
      page.on('response', onResponse);

      const applyChromeIdentity = async targetPage => {
        try {
          await targetPage.addInitScript(() => {
            try {
              Object.defineProperty(navigator, 'webdriver', { get: () => false });
              if (navigator.userAgent && navigator.userAgent.includes('; wv')) {
                const cleanUa = navigator.userAgent.replace(/; wv/g, '').replace(/Version\/\d+\.\d+\s*/g, '');
                Object.defineProperty(navigator, 'userAgent', { get: () => cleanUa });
              }
            } catch {}
          });
        } catch {}
      };

      await applyChromeIdentity(page);

      const stripPxState = async (resetSessionToo = false) => {
        try {
          const all = await this.context.cookies();
          const cfNames = new Set(['cf_clearance', '__cf_bm', '__cflb', 'OptanonConsent']);
          const keep = all.filter(c => {
            if (c.name.toLowerCase().includes('px')) return false;
            if (resetSessionToo) return cfNames.has(c.name);
            return true;
          });
          await this.context.clearCookies();
          if (keep.length) await this.context.addCookies(keep);
          if (resetSessionToo) {
            try {
              const cdp = await this.context.newCDPSession(page);
              await cdp.send('Storage.clearDataForOrigin', { origin: 'https://www.sahibinden.com', storageTypes: 'local_storage,session_storage,indexeddb' });
              await cdp.detach().catch(() => {});
            } catch {}
          }
        } catch {}
      };

      const waitChallengeAutoPass = async () => {
        // Wait up to 3 x ~7s (21s total) for Cloudflare challenge to self-pass
        for (let i = 0; i < 14; i++) {
          if (this.closed) break;
          const title = await page.title().catch(() => '');
          const currentUrl = page.url();
          const isChallenge = /bir dakika|just a moment|loading|checking your browser|doğrulama/i.test(title)
            || currentUrl.includes('/cs/checkLoading')
            || currentUrl.includes('__cf_chl_');
          if (!isChallenge) break;
          await page.waitForTimeout(1500);
        }
      };

      for (let attempt = 0; attempt < 2; attempt++) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await waitChallengeAutoPass();

        const curTitle = await page.title().catch(() => '');
        const curHtml = await page.content().catch(() => '');
        const isLoginOrDenied = /secure\.sahibinden\.com\/giris|\/giris\?/i.test(page.url())
          || /access to this page has been denied|access denied|bir sorun oluştu/i.test(curTitle)
          || (!(/searchResultsItem|classifiedInfoList/i.test(curHtml)) && /px-captcha/i.test(curHtml));

        if (attempt === 0 && isLoginOrDenied) {
          await stripPxState(true);
          await page.goto('https://www.sahibinden.com/otomobil?pagingSize=50&sorting=date_desc', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await waitChallengeAutoPass();
          try {
            await page.locator('tr.searchResultsItem').first().waitFor({ state: 'attached', timeout: 12000 });
          } catch {}
          if (url.startsWith('https://www.sahibinden.com/otomobil') && !url.includes('pagingOffset=')) break;
          await page.waitForTimeout(800);
          continue;
        }
        break;
      }

      const selector = kind === 'detail'
        ? '.classifiedInfoList, h1'
        : 'tr.searchResultsItem, a[href*="/ilan/vasita-"][href*="/detay"]';
      try {
        const waitTimeout = kind === 'detail' ? 4000 : 10000;
        await page.locator(selector).first().waitFor({ state: 'attached', timeout: waitTimeout });
      } catch (error) {
        if (error.name !== 'TimeoutError') throw error;
      }

      const html = await page.content();
      const finalUrl = page.url();
      const hasRealContent = /searchResultsItem|classifiedInfoList|classifiedDescription/i.test(html)
        || /\/ilan\/vasita-.*-\d+\/detay/i.test(html);
      const effectiveStatus = hasRealContent ? 200 : (lastStatus || 200);
      const result = { html, url: finalUrl, status: effectiveStatus, retryAfter };
      const problem = accessProblem(html, finalUrl, result.status);
      if (problem) {
        this.status('blocked', { lastHttpStatus: result.status, reason: problem.reason || problem.phase });
        return { ...result, problem };
      }
      if (!this.allowedUrl(finalUrl)) throw new Error('Sayfa desteklenen kaynağın dışına yönlendi.');
      this.status('ready', { lastHttpStatus: result.status, pagesRead: this.state.pagesRead + 1 });
      return result;
    } catch (error) {
      this.status('failed', { error: String(error.message).split('\n')[0].slice(0, 300) });
      if (!this.browser?.isConnected()) await this.release(true);
      throw error;
    } finally {
      if (page) page.off('response', onResponse);
      this.activePage = null;
    }
  }

  async readIsolated(rawUrl, { kind = 'page' } = {}) {
    const url = this.allowedUrl(rawUrl);
    if (!url) throw new Error('Okuyucu için kaynak adresi geçersiz.');
    let page, blocked = null, navigationCount = 0, lastReply = null, nextNavigation = null;
    try {
      await this.ready();
      page = await this.context.newPage();
      this.activePage = page;
      this.status('reading', { lastUrl: publicDiagnosticUrl(url), error: null });
      await page.route('**/*', async route => {
        const request = route.request();
        try {
          if (blocked || this.closed) { await route.abort(); return; }
          if (challengeResource(request.url())) {
            blocked = { ...(lastReply || { html: '', url, status: 200 }), problem: { phase: 'access_blocked', reason: 'browser_verification', message: 'Kaynak tarayıcı doğrulaması istiyor. Arka plan taraması durduruldu; ilan alınamadı.' } };
            await route.abort();
            return;
          }
          if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) { await route.continue(); return; }
          const destination = request.url();
          const auth = accessProblem('', destination);
          if (auth || !this.allowedUrl(destination)) {
            blocked = { html: '', url: destination, status: lastReply?.status || 302, problem: auth || { phase: 'access_blocked', message: 'Kaynak desteklenen sayfaların dışına yönlendirdi; tarama durduruldu.' } };
            await route.abort();
            return;
          }
          if (++navigationCount > 5) throw new Error('Kaynak yönlendirme sınırına ulaşıldı.');
          const response = await route.fetch({ maxRedirects: 0, timeout: 25000 });
          try {
            const html = await response.text();
            lastReply = { html, url: destination, status: response.status(), retryAfter: response.headers()['retry-after'] || null };
            if ([301, 302, 303, 307, 308].includes(response.status())) {
              const location = response.headers().location;
              if (!location) throw new Error('Kaynak yönlendirme adresi vermedi.');
              const next = new URL(location, destination).href;
              const auth = accessProblem('', next);
              if (auth || !this.allowedUrl(next)) {
                blocked = { ...lastReply, url: next, problem: auth || { phase: 'access_blocked', message: 'Kaynak desteklenen sayfaların dışına yönlendirdi; tarama durduruldu.' } };
                await route.abort();
              } else {
                nextNavigation = next;
                await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Yönlendirme</title>' });
              }
              return;
            }
            const problem = accessProblem(html, destination, response.status());
            if (problem) { blocked = { ...lastReply, problem }; await route.abort(); return; }
            await route.fulfill({ response, body: html });
          } finally { await response.dispose(); }
        } catch (error) {
          if (!blocked) blocked = { ...(lastReply || { html: '', url, status: null }), error };
          await route.abort().catch(() => {});
        }
      });
      let destination = url;
      for (;;) {
        nextNavigation = null;
        try { await page.goto(destination, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
        catch (error) { if (!blocked && !nextNavigation) throw error; }
        if (blocked) break;
        if (nextNavigation) { destination = nextNavigation; continue; }
        const selector = kind === 'detail' ? 'h1' : 'a[href*="/ilan/vasita-"][href*="/detay"]';
        try { await page.locator(selector).first().waitFor({ state: 'attached', timeout: 10000 }); }
        catch (error) { if (error.name !== 'TimeoutError') throw error; }
        break;
      }
      if (blocked?.error) throw blocked.error;
      if (blocked) {
        this.status('blocked', { lastHttpStatus: blocked.status, reason: blocked.problem?.reason || blocked.problem?.phase });
        return blocked;
      }
      const html = await page.content(), finalUrl = page.url();
      if (!this.allowedUrl(finalUrl)) throw new Error('Sayfa desteklenen kaynağın dışına yönlendi.');
      const result = { html, url: finalUrl, status: lastReply?.status || 200, retryAfter: lastReply?.retryAfter || null };
      const problem = accessProblem(html, finalUrl, result.status);
      if (problem) { this.status('blocked', { lastHttpStatus: result.status }); return { ...result, problem }; }
      this.status('ready', { lastHttpStatus: result.status, pagesRead: this.state.pagesRead + 1 });
      return result;
    } catch (error) {
      this.status('failed', { error: String(error.message).split('\n')[0].slice(0, 300) });
      throw error;
    } finally {
      this.activePage = null;
      await page?.close().catch(() => {});
      if (blocked || this.closed || ['blocked', 'failed'].includes(this.state.state)) await this.release();
    }
  }

  async release(killProcess = false) {
    const browser = this.browser;
    this.browser = null;
    this.context = null;
    await browser?.close().catch(() => {});
    if (killProcess) {
      if (this.chromeProc) {
        try { this.chromeProc.kill(); } catch {}
        this.chromeProc = null;
      }
      const cdpFile = path.join(path.resolve(this.base), 'data', 'chrome-cdp.json');
      const profileDir = path.join(path.resolve(this.base), 'data', 'chrome-cdp-profile');
      let saved = null;
      try { saved = JSON.parse(fs.readFileSync(cdpFile, 'utf8')); } catch {}
      cleanupStaleChrome(profileDir, saved?.pid);
      try { fs.rmSync(cdpFile, { force: true }); } catch {}
    }
  }

  async stop() {
    if (this.closed) return;
    this.closed = true;
    await this.release(true);
    this.status('stopped');
  }
}
