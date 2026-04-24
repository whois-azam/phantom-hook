/* ─── PhantomHook Popup Controller ─── */

(async function initPopup() {
  const statusBadge   = document.getElementById('statusBadge');
  const statusDot     = document.getElementById('statusDot');
  const statusText    = document.getElementById('statusText');
  const currentUrlEl  = document.getElementById('currentUrl');
  const whitelistBtn  = document.getElementById('whitelistBtn');
  const removeBtn     = document.getElementById('removeWhitelistBtn');
  const scannedEl     = document.getElementById('scannedCount');
  const blockedEl     = document.getElementById('blockedCount');
  const whitelistedEl = document.getElementById('whitelistedCount');

  /* ── Helpers ── */
  function getRootDomain(url) {
    try {
      const hostname = new URL(url).hostname;
      const parts = hostname.split('.');
      return parts.length > 2 ? parts.slice(-2).join('.') : hostname;
    } catch { return ''; }
  }

  function setStatus(type, label) {
    statusBadge.className = 'status-badge ' + type;
    statusText.textContent = label;
  }

  /* ── Get active tab ── */
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    currentUrlEl.textContent = 'No active tab';
    setStatus('unknown', 'Unknown');
    return;
  }

  const url = tab.url;
  const rootDomain = getRootDomain(url);
  currentUrlEl.textContent = url.length > 70 ? url.slice(0, 67) + '…' : url;

  /* ── Load stats ── */
  const store = await chrome.storage.local.get(['whitelist', 'stats']);
  const whitelist = store.whitelist || [];
  const stats = store.stats || { scanned: 0, blocked: 0 };

  scannedEl.textContent     = stats.scanned;
  blockedEl.textContent     = stats.blocked;
  whitelistedEl.textContent = whitelist.length;

  /* ── Determine status ── */
  const isWhitelisted = whitelist.includes(rootDomain);

  if (isWhitelisted) {
    setStatus('safe', 'Whitelisted');
    whitelistBtn.style.display = 'none';
    removeBtn.style.display = 'flex';
  } else {
    // Query background for last-known verdict
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS', url });
      if (response && response.status) {
        const map = { SAFE: 'safe', BLOCKED: 'danger', SUSPICIOUS: 'suspicious' };
        setStatus(map[response.status] || 'unknown', response.status);
      } else {
        setStatus('unknown', 'Unknown');
      }
    } catch {
      setStatus('unknown', 'Unknown');
    }
  }

  /* ── Whitelist button ── */
  whitelistBtn.addEventListener('click', async () => {
    if (!rootDomain) return;
    const data = await chrome.storage.local.get('whitelist');
    const list = data.whitelist || [];
    if (!list.includes(rootDomain)) {
      list.push(rootDomain);
      await chrome.storage.local.set({ whitelist: list });
    }
    setStatus('safe', 'Whitelisted');
    whitelistBtn.style.display = 'none';
    removeBtn.style.display = 'flex';
    whitelistedEl.textContent = list.length;
  });

  /* ── Remove whitelist button ── */
  removeBtn.addEventListener('click', async () => {
    const data = await chrome.storage.local.get('whitelist');
    let list = data.whitelist || [];
    list = list.filter(d => d !== rootDomain);
    await chrome.storage.local.set({ whitelist: list });
    setStatus('unknown', 'Unknown');
    removeBtn.style.display = 'none';
    whitelistBtn.style.display = 'flex';
    whitelistedEl.textContent = list.length;
  });
})();
