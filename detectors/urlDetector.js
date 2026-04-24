/* ─────────────────────────────────────────────────────
 *  detectors/urlDetector.js
 *  Lists lookup, Lexical analysis, and ONNX ML inference
 * ───────────────────────────────────────────────────── */

/**
 * Check if hostname is in the safelist Set.
 * @param {string} hostname
 * @param {Set<string>} safelistSet
 * @returns {boolean}
 */
export function checkSafelist(hostname, safelistSet) {
  if (safelistSet.has(hostname)) return true;
  // Also check root domain (e.g. mail.google.com → google.com)
  const parts = hostname.split('.');
  if (parts.length > 2) {
    const root = parts.slice(-2).join('.');
    return safelistSet.has(root);
  }
  return false;
}

/**
 * Check if hostname is in the blacklist Set.
 * @param {string} hostname
 * @param {Set<string>} blacklistSet
 * @returns {boolean}
 */
export function checkBlacklist(hostname, blacklistSet) {
  if (blacklistSet.has(hostname)) return true;
  const parts = hostname.split('.');
  if (parts.length > 2) {
    const root = parts.slice(-2).join('.');
    return blacklistSet.has(root);
  }
  return false;
}

/**
 * Lexical heuristics — returns a suspicion score 0–100.
 *  - Subdomain depth
 *  - Punycode (xn--) presence
 *  - Suspicious keyword presence
 *  - Excessive hyphens / digit ratio
 * @param {string} url
 * @returns {number} score 0–100
 */
export function lexicalAnalysis(url) {
  let score = 0;

  let hostname;
  try { hostname = new URL(url).hostname; } catch { return 0; }

  const parts = hostname.split('.');

  // Subdomain depth (3+ parts beyond TLD.domain)
  const subdomainDepth = parts.length - 2;
  if (subdomainDepth >= 3) score += 25;
  else if (subdomainDepth >= 2) score += 10;

  // Punycode detection
  if (parts.some(p => p.startsWith('xn--'))) score += 30;

  // Suspicious keywords
  const suspicious = ['login', 'verify', 'secure', 'update', 'account', 'auth',
                       'billing', 'confirm', 'suspend', 'alert', 'urgent', 'paypal',
                       'apple', 'microsoft', 'amazon', 'netflix', 'bank', 'wellsfargo'];
  const joined = hostname.toLowerCase();
  const hits = suspicious.filter(kw => joined.includes(kw));
  score += Math.min(hits.length * 10, 30);

  // Excessive hyphens
  const hyphenCount = (hostname.match(/-/g) || []).length;
  if (hyphenCount >= 4) score += 15;
  else if (hyphenCount >= 2) score += 5;

  // High digit ratio
  const digits = (hostname.match(/\d/g) || []).length;
  if (digits / hostname.length > 0.3) score += 10;

  return Math.min(score, 100);
}

/**
 * Run ONNX ML inference on a URL string.
 * @param {import('onnxruntime-web').InferenceSession} session
 * @param {string} url
 * @returns {Promise<number>} ML probability percentage (0–100)
 */
export async function runOnnxInference(session, url) {
  try {
    // Import ort from the bundled module
    const ort = self.ort;
    if (!ort || !session) return 0;

    // Create a rank-1 string tensor with shape [1]
    const tensor = new ort.Tensor('string', [url], [1]);
    const feeds = {};

    // Use the first input name from the model
    const inputName = session.inputNames[0];
    feeds[inputName] = tensor;

    const results = await session.run(feeds);

    // Extract probabilities — standard ONNX RF model output
    if (results['probabilities']) {
      const probs = results['probabilities'].data;
      // probs is typically [p_safe, p_malicious]
      const maliciousProb = probs.length >= 2 ? probs[1] : probs[0];
      return Math.round(maliciousProb * 100);
    }

    // Fallback: check 'output_probability'
    if (results['output_probability']) {
      const prob = results['output_probability'].data;
      const maliciousProb = prob.length >= 2 ? prob[1] : prob[0];
      return Math.round(maliciousProb * 100);
    }

    // Final fallback: use label output
    if (results['output_label'] || results['label']) {
      const label = (results['output_label'] || results['label']).data[0];
      return label === 'bad' || label === '1' || label === 1 ? 80 : 5;
    }

    return 0;
  } catch (err) {
    console.warn('[PhantomHook] ONNX inference error:', err);
    return 0;
  }
}
