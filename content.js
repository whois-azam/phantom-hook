/* ─────────────────────────────────────────────────────
 * content.js — Exact DOM extraction for PhantomHook
 * Injected per-tab by the service worker.
 * Uses MutationObserver to detect forms with
 * mismatched action URLs and extracts the HTML for the LLM.
 * ───────────────────────────────────────────────────── */

(function phantomHookContent() {
  'use strict';

  const PAGE_HOST = window.location.hostname;

  /**
   * Scan a <form> element for action-hostname mismatch.
   */
  function isFormMismatch(form) {
    const action = form.getAttribute('action');
    if (!action) return false;

    try {
      const resolved = new URL(action, window.location.href);
      const actionHost = resolved.hostname;
      if (actionHost && actionHost !== PAGE_HOST) {
        return true;
      }
    } catch {
      return true; // Malformed URL
    }
    return false;
  }

  /**
   * Scan the document for mismatched forms AND extract their HTML.
   */
  function scanDocument() {
    let mismatch = false;
    let domSnippet = "";

    const forms = document.querySelectorAll('form');
    for (const form of forms) {
      // Look for passwords or username fields
      const isLoginForm = form.querySelector('input[type="password"]') !== null ||
        form.querySelector('input[name*="user"]') !== null;

      if (isLoginForm) {
        // WE FOUND A LOGIN FORM! Extract the code for the LLM!
        domSnippet += form.outerHTML + "\n\n";

        if (isFormMismatch(form)) {
          mismatch = true;
        }
      }
    }

    return {
      mismatch: mismatch,
      snippet: domSnippet || "No suspicious login forms found on page."
    };
  }

  let domMismatch = false;
  let reported = false;

  function reportResult(resultData) {
    if (reported) return;
    domMismatch = resultData.mismatch;

    // Send result AND the extracted HTML to the background service worker
    chrome.runtime.sendMessage({
      type: 'DOM_SCAN_RESULT',
      dom_mismatch: resultData.mismatch,
      extracted_dom: resultData.snippet, // <--- Feeding the LLM!
      url: window.location.href
    });
    reported = true;
  }

  // Initial scan
  const initialResult = scanDocument();
  if (initialResult.mismatch || initialResult.snippet !== "No suspicious login forms found on page.") {
    reportResult(initialResult);
  }

  // Observe future DOM mutations
  const observer = new MutationObserver((mutations) => {
    if (reported) return;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const isForm = node.tagName === 'FORM';
        const isPassword = node.tagName === 'INPUT' && node.type === 'password';
        const hasForm = node.querySelector && node.querySelector('form');
        const hasPwd = node.querySelector && node.querySelector('input[type="password"]');

        if (isForm || isPassword || hasForm || hasPwd) {
          const result = scanDocument();
          if (result.mismatch) {
            reportResult(result);
            return;
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // After a reasonable wait, report no-mismatch if nothing found
  setTimeout(() => {
    if (!reported) {
      reportResult({ mismatch: false, snippet: "No suspicious login forms found on page." });
    }
  }, 3000);

  // Listen for explicit scan requests from background
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'REQUEST_DOM_SCAN') {
      reported = false;
      const result = scanDocument();
      sendResponse({
        dom_mismatch: result.mismatch,
        extracted_dom: result.snippet
      });
      reported = true;
    }
  });
})();