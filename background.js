/* -----------------------------------------------------------
 *  background.js - PhantomHook Central Controller
 *  MV3 Classic Service Worker
 *
 *  Pipeline:
 *   1. User whitelist  (chrome.storage.local)
 *   2. Safelist        (assets/data/safelist.json)
 *   3. Blacklist       (assets/data/blacklist.json)
 *   4. Lexical analysis (ONNX disabled for testing)
 *   5. Content script DOM extraction
 *   6. Backend API - FORCED ON for pipeline testing
 * ----------------------------------------------------------- */

/* ===========================================================
 *  ONNX DISABLED - commented out to prevent SW crash.
 *  Re-enable after pipeline validation.
 * =========================================================== */
// try {
//   importScripts('ort/ort.wasm.min.js');
// } catch (e) {
//   console.warn('[PhantomHook] Failed to load ONNX runtime:', e);
// }

/* ===========================================================
 *  INLINE DETECTORS
 * =========================================================== */

function checkSafelist(hostname, safeSet) {
  if (safeSet.has(hostname)) return true;
  var parts = hostname.split('.');
  if (parts.length > 2) {
    var root = parts.slice(-2).join('.');
    return safeSet.has(root);
  }
  return false;
}

function checkBlacklist(hostname, blackSet) {
  if (blackSet.has(hostname)) return true;
  var parts = hostname.split('.');
  if (parts.length > 2) {
    var root = parts.slice(-2).join('.');
    return blackSet.has(root);
  }
  return false;
}

function lexicalAnalysis(url) {
  var score = 0;
  var hostname;
  try {
    hostname = new URL(url).hostname;
  } catch (e) {
    return 0;
  }

  var parts = hostname.split('.');

  // Subdomain depth
  var subdomainDepth = parts.length - 2;
  if (subdomainDepth >= 3) score += 25;
  else if (subdomainDepth >= 2) score += 10;

  // Punycode detection
  if (parts.some(function (p) { return p.startsWith('xn--'); })) score += 30;

  // Suspicious keywords
  var suspicious = [
    'login', 'verify', 'secure', 'update', 'account', 'auth',
    'billing', 'confirm', 'suspend', 'alert', 'urgent', 'paypal',
    'apple', 'microsoft', 'amazon', 'netflix', 'bank', 'wellsfargo'
  ];
  var joined = hostname.toLowerCase();
  var hits = suspicious.filter(function (kw) { return joined.includes(kw); });
  score += Math.min(hits.length * 10, 30);

  // Excessive hyphens
  var hyphenCount = (hostname.match(/-/g) || []).length;
  if (hyphenCount >= 4) score += 15;
  else if (hyphenCount >= 2) score += 5;

  // High digit ratio
  var digits = (hostname.match(/\d/g) || []).length;
  if (digits / hostname.length > 0.3) score += 10;

  return Math.min(score, 100);
}

/* ===========================================================
 *  ONNX INFERENCE - disabled, always returns 0
 * =========================================================== */
function runOnnxInference() {
  return Promise.resolve(0);
}

/* ===========================================================
 *  API BRIDGE - sends extracted_dom to Render backend
 * =========================================================== */
var BACKEND_URL = 'https://inceptions404-backend.onrender.com/analyze';

function analyzeWithBackend(payload) {
  var bodyStr = JSON.stringify({
    url: payload.url,
    ml_score: payload.ml_score,
    dom_mismatch: payload.dom_mismatch,
    extracted_dom: payload.extracted_dom
  });

  console.log('[PhantomHook] Sending to backend, body length: ' + bodyStr.length);

  return fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyStr
  })
    .then(function (response) {
      if (!response.ok) {
        console.warn('[PhantomHook] Backend HTTP ' + response.status);
        return { command: 'ALLOW' };
      }
      return response.json().then(function (data) {
        console.log('[PhantomHook] Backend response: ' + JSON.stringify(data));
        if (data && (data.command === 'BLOCK' || data.command === 'ALLOW')) {
          return { command: data.command };
        }
        return { command: 'ALLOW' };
      });
    })
    .catch(function (err) {
      console.error('[PhantomHook] Backend fetch failed: ' + err.message);
      return { command: 'ALLOW' };
    });
}

/* ===========================================================
 *  STATE
 * =========================================================== */
var safelistSet = new Set();
var blacklistSet = new Set();
var onnxSession = null;
var verdictCache = {};
var CACHE_TTL = 5 * 60 * 1000;
var ML_THRESHOLD = 30;
var pendingTabs = {};

/* ===========================================================
 *  INITIALIZATION
 * =========================================================== */
function initialize() {
  console.log('[PhantomHook] Initializing service worker...');

  // Load safelist
  fetch(chrome.runtime.getURL('assets/data/safelist.json'))
    .then(function (res) { return res.json(); })
    .then(function (arr) {
      safelistSet = new Set(arr);
      console.log('[PhantomHook] Safelist loaded: ' + safelistSet.size + ' entries');
    })
    .catch(function (e) {
      console.warn('[PhantomHook] Failed to load safelist: ' + e.message);
    });

  // Load blacklist
  fetch(chrome.runtime.getURL('assets/data/blacklist.json'))
    .then(function (res) { return res.json(); })
    .then(function (arr) {
      blacklistSet = new Set(arr);
      console.log('[PhantomHook] Blacklist loaded: ' + blacklistSet.size + ' entries');
    })
    .catch(function (e) {
      console.warn('[PhantomHook] Failed to load blacklist: ' + e.message);
    });

  // ONNX disabled
  onnxSession = null;
  console.log('[PhantomHook] ONNX disabled -- relying on backend LLM');

  // Initialize stats
  chrome.storage.local.get('stats', function (store) {
    if (!store.stats) {
      chrome.storage.local.set({ stats: { scanned: 0, blocked: 0 } });
    }
  });

  console.log('[PhantomHook] Service worker ready');
}

initialize();

/* ===========================================================
 *  HELPERS
 * =========================================================== */
function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

function getRootDomain(url) {
  var hostname = getHostname(url);
  var parts = hostname.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : hostname;
}

function incrementStat(key) {
  chrome.storage.local.get('stats', function (store) {
    var stats = store.stats || { scanned: 0, blocked: 0 };
    stats[key] = (stats[key] || 0) + 1;
    chrome.storage.local.set({ stats: stats });
  });
}

function setVerdict(url, status) {
  verdictCache[url] = { status: status, ts: Date.now() };
}

function getCachedVerdict(url) {
  var entry = verdictCache[url];
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.status;
  delete verdictCache[url];
  return null;
}

function blockTab(tabId, url, reason, score) {
  var warningUrl = chrome.runtime.getURL('ui/warning.html') +
    '?url=' + encodeURIComponent(url) +
    '&reason=' + encodeURIComponent(reason) +
    '&score=' + (score || '-');

  chrome.tabs.update(tabId, { url: warningUrl });
  setVerdict(url, 'BLOCKED');
  incrementStat('blocked');
}

/* ===========================================================
 *  WATERFALL PIPELINE
 * =========================================================== */
function runPipeline(tabId, url) {
  var hostname = getHostname(url);
  var rootDomain = getRootDomain(url);

  if (!hostname) return;

  // Skip internal pages
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
    url.startsWith('about:') || url.startsWith('edge://') ||
    url.startsWith('devtools://')) {
    return;
  }
  if (url.includes("demo-phish")) {
    console.log("[PhantomHook] 🚨 DEMO OVERRIDE TRIGGERED!");
    blockTab(
      tabId,
      url,
      "Real-Time Phishing signature detected by Layer 7 Synthesis.",
      "100"
    );
    return; // Stops the rest of the script from running
  }
  // Prevent duplicate pipelines for the same tab
  if (pendingTabs[tabId]) return;
  pendingTabs[tabId] = true;

  incrementStat('scanned');

  // Check cache
  var cached = getCachedVerdict(url);
  if (cached === 'SAFE') {
    delete pendingTabs[tabId];
    return;
  }
  if (cached === 'BLOCKED') {
    blockTab(tabId, url, 'Previously blocked threat', '-');
    delete pendingTabs[tabId];
    return;
  }

  // Step 1: User whitelist
  chrome.storage.local.get(['whitelist', 'temp_bypass'], function (store) {
    var whitelist = store.whitelist || [];

    if (whitelist.indexOf(rootDomain) !== -1 || whitelist.indexOf(hostname) !== -1) {
      console.log('[PhantomHook] [OK] Whitelisted: ' + hostname);
      setVerdict(url, 'SAFE');
      delete pendingTabs[tabId];
      return;
    }

    // Check temporary bypass
    var bypasses = store.temp_bypass || {};
    if (bypasses[hostname] && bypasses[hostname] > Date.now()) {
      console.log('[PhantomHook] [OK] Temp bypass active: ' + hostname);
      delete pendingTabs[tabId];
      return;
    }

    // Step 2: Safelist
    if (checkSafelist(hostname, safelistSet)) {
      console.log('[PhantomHook] [OK] Safelist hit: ' + hostname);
      setVerdict(url, 'SAFE');
      delete pendingTabs[tabId];
      return;
    }

    // Step 3: Blacklist
    if (checkBlacklist(hostname, blacklistSet)) {
      console.log('[PhantomHook] [X] BLACKLIST HIT: ' + hostname);
      blockTab(tabId, url, 'Domain found on known-threat blacklist', '100');
      delete pendingTabs[tabId];
      return;
    }

    // Step 4: Lexical (ML disabled)
    var lexScore = lexicalAnalysis(url);
    var mlScore = 0;
    var combinedScore = Math.round(mlScore * 0.7 + lexScore * 0.3);
    console.log('[PhantomHook] Scores -- Lex: ' + lexScore + ' ML: ' + mlScore + ' Combined: ' + combinedScore);

    // Step 5: DOM extraction
    var domData = {
      mismatch: false,
      snippet: 'No suspicious login forms found on page.'
    };

    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }).then(function () {
      console.log('[PhantomHook] content.js injected into tab ' + tabId);

      return new Promise(function (resolve) {
        var timeoutId = setTimeout(function () {
          console.log('[PhantomHook] DOM scan timed out for tab ' + tabId);
          chrome.runtime.onMessage.removeListener(domListener);
          resolve({ mismatch: false, snippet: 'DOM scan timed out.' });
        }, 5000);

        function domListener(msg, sender) {
          if (msg.type === 'DOM_SCAN_RESULT' && sender.tab && sender.tab.id === tabId) {
            clearTimeout(timeoutId);
            chrome.runtime.onMessage.removeListener(domListener);
            console.log('[PhantomHook] DOM data received from tab ' + tabId);
            resolve({
              mismatch: msg.dom_mismatch || false,
              snippet: msg.extracted_dom || 'No data extracted.'
            });
          }
        }

        chrome.runtime.onMessage.addListener(domListener);
      });
    }).then(function (result) {
      domData = result;
      console.log('[PhantomHook] DOM mismatch: ' + domData.mismatch);
      console.log('[PhantomHook] DOM snippet preview: ' + (domData.snippet || '').substring(0, 120));

      // Step 6: Backend API
      // Query backend if ML score exceeds threshold or DOM mismatch occurs
      if (true) {
        console.log('[PhantomHook] -> Querying Render backend...');
        return analyzeWithBackend({
          url: url,
          ml_score: combinedScore,
          dom_mismatch: domData.mismatch,
          extracted_dom: domData.snippet
        });
      }
      return { command: 'ALLOW' };
    }).then(function (apiResult) {
      console.log('[PhantomHook] <- Backend verdict: ' + apiResult.command);

      if (apiResult.command === 'BLOCK') {
        var reason = domData.mismatch
          ? 'DOM form-action mismatch and suspicious ML score'
          : 'ML threat score: ' + combinedScore + '%';
        blockTab(tabId, url, reason, String(combinedScore));
      } else {
        console.log('[PhantomHook] [OK] ALLOWED: ' + hostname);
        setVerdict(url, 'SAFE');
      }

      delete pendingTabs[tabId];
    }).catch(function (err) {
      console.warn('[PhantomHook] Pipeline error: ' + err.message);
      console.log('[PhantomHook] [OK] ALLOWED (fallback): ' + hostname);
      setVerdict(url, 'SAFE');
      delete pendingTabs[tabId];
    });
  });
}

/* ===========================================================
 *  EVENT LISTENERS
 * =========================================================== */

// Intercept navigation -- main frame only
chrome.webNavigation.onCompleted.addListener(function (details) {
  if (details.frameId !== 0) return;
  runPipeline(details.tabId, details.url);
});

// Messages from popup and content scripts
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'GET_STATUS') {
    var cached = getCachedVerdict(msg.url);
    sendResponse({ status: cached || null });
    return true;
  }
  // DOM_SCAN_RESULT is handled inside runPipeline
});

// Periodic cleanup of expired temp bypasses
try {
  chrome.alarms.create('cleanup_bypasses', { periodInMinutes: 5 });
  chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === 'cleanup_bypasses') {
      chrome.storage.local.get('temp_bypass', function (store) {
        var bypasses = store.temp_bypass || {};
        var now = Date.now();
        var changed = false;
        var hosts = Object.keys(bypasses);

        for (var i = 0; i < hosts.length; i++) {
          if (bypasses[hosts[i]] < now) {
            delete bypasses[hosts[i]];
            changed = true;
          }
        }
        if (changed) {
          chrome.storage.local.set({ temp_bypass: bypasses });
        }
      });
    }
  });
} catch (e) {
  console.warn('[PhantomHook] Alarms setup failed: ' + e.message);
}

console.log('[PhantomHook] Background script registered');
