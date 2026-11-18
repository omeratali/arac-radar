(() => {
  const hasListings = document.querySelector('tr.searchResultsItem, .classifiedInfoList, #classifiedDescription');
  if (!hasListings) return;

  const badge = document.createElement('div');
  badge.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:999999;background:#10141c;color:#f5f7fa;border:1px solid #f59e0b;border-radius:10px;padding:10px 14px;font:600 12px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);display:flex;align-items:center;gap:10px;';
  const statusText = document.createElement('span');
  statusText.textContent = '◉ Araç Radar’a aktarılıyor...';
  const autoBtn = document.createElement('button');
  autoBtn.style.cssText = 'background:#1e2636;color:#f59e0b;border:1px solid #f59e0b;border-radius:6px;padding:4px 8px;cursor:pointer;font:600 11px system-ui,sans-serif;';

  const isAuto = sessionStorage.getItem('arac_radar_auto_30s') === '1';
  autoBtn.textContent = isAuto ? '30sn Oto-Yenile: Açık' : '30sn Oto-Yenile: Kapalı';

  let timer = null;
  function scheduleReload() {
    clearTimeout(timer);
    if (sessionStorage.getItem('arac_radar_auto_30s') === '1' && !location.pathname.includes('/detay')) {
      timer = setTimeout(() => location.reload(), 30000);
    }
  }

  autoBtn.addEventListener('click', () => {
    const next = sessionStorage.getItem('arac_radar_auto_30s') === '1' ? '0' : '1';
    sessionStorage.setItem('arac_radar_auto_30s', next);
    autoBtn.textContent = next === '1' ? '30sn Oto-Yenile: Açık' : '30sn Oto-Yenile: Kapalı';
    scheduleReload();
  });

  badge.append(statusText, autoBtn);
  document.body.appendChild(badge);

  chrome.runtime.sendMessage(
    { type: 'INGEST_PAGE', url: location.href, html: document.documentElement.outerHTML },
    res => {
      if (res?.ok) {
        statusText.textContent = `◉ Araç Radar: ${res.count} ilan aktarıldı (${res.newCount} yeni)`;
        scheduleReload();
      } else {
        statusText.textContent = `◉ Araç Radar bağlantı hatası: ${res?.error || 'Sunucu kapalı'}`;
      }
    }
  );
})();
