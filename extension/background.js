chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'INGEST_PAGE') return false;
  fetch('http://127.0.0.1:8765/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html: msg.html, url: msg.url })
  })
    .then(r => r.json())
    .then(data => sendResponse({ ok: Boolean(data?.ok), count: data?.count || 0, newCount: data?.newCount || 0, error: data?.error }))
    .catch(err => sendResponse({ ok: false, error: err.message }));
  return true;
});
