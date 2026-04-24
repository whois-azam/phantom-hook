/* ─── PhantomHook Warning Page Controller ─── */
(function () {
  'use strict';

  const blockedUrlEl  = document.getElementById('blockedUrl');
  const blockReasonEl = document.getElementById('blockReason');
  const mlScoreEl     = document.getElementById('mlScore');
  const goBackBtn     = document.getElementById('goBackBtn');
  const proceedBtn    = document.getElementById('proceedBtn');

  // Parse URL parameters
  const params  = new URLSearchParams(window.location.search);
  const url     = params.get('url')     || 'Unknown';
  const reason  = params.get('reason')  || 'Threat detected';
  const score   = params.get('score')   || '—';

  // Populate threat details
  blockedUrlEl.textContent  = decodeURIComponent(url);
  blockReasonEl.textContent = decodeURIComponent(reason);
  mlScoreEl.textContent     = score !== '—' ? score + '%' : '—';

  // Go back to safety
  goBackBtn.addEventListener('click', () => {
    // Navigate back, or to a safe page
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = 'https://www.google.com';
    }
  });

  // Proceed anyway — add a temporary bypass for this URL
  proceedBtn.addEventListener('click', () => {
    const decodedUrl = decodeURIComponent(url);
    let hostname;
    try {
      hostname = new URL(decodedUrl).hostname;
    } catch {
      hostname = decodedUrl;
    }

    // Store temporary bypass (expires in 10 minutes)
    chrome.storage.local.get('temp_bypass', (data) => {
      const bypasses = data.temp_bypass || {};
      bypasses[hostname] = Date.now() + 10 * 60 * 1000; // 10min TTL
      chrome.storage.local.set({ temp_bypass: bypasses }, () => {
        // Navigate to the original URL
        window.location.href = decodedUrl;
      });
    });
  });
})();
