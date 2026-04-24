/* ─────────────────────────────────────────────────────
 *  detectors/apiDetector.js
 *  Render backend API bridge -- includes extracted_dom
 * ───────────────────────────────────────────────────── */

const BACKEND_URL = 'https://inceptions404-backend.onrender.com/analyze';

/**
 * Send analysis payload to the Render FastAPI backend.
 * @param {{ url: string, ml_score: number, dom_mismatch: boolean, extracted_dom: string }} payload
 * @returns {Promise<{ command: 'ALLOW' | 'BLOCK' }>}
 */
export async function analyzeWithBackend(payload) {
  try {
    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: payload.url,
        ml_score: payload.ml_score,
        dom_mismatch: payload.dom_mismatch,
        extracted_dom: payload.extracted_dom
      })
    });

    if (!response.ok) {
      console.warn('[PhantomHook] Backend returned', response.status);
      return { command: 'ALLOW' };
    }

    const data = await response.json();

    if (data && (data.command === 'BLOCK' || data.command === 'ALLOW')) {
      return { command: data.command };
    }

    return { command: 'ALLOW' };
  } catch (err) {
    console.warn('[PhantomHook] Backend unreachable:', err.message);
    return { command: 'ALLOW' };
  }
}
