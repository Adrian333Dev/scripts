const BLOCK_PATTERNS = [
  /captcha/i,
  /cloudflare/i,
  /checking your browser/i,
  /please wait for verification/i,
  /verify you are human/i,
  /access denied/i,
  /unusual traffic/i,
  /performing security verification/i,
  /security verification/i,
  /protect against malicious bots/i,
  /verifies you are not a bot/i,
  /verify that you are not a bot/i,
  /enable javascript/i,
  /sign in to continue/i,
  /login to continue/i,
];

const NAV_PATTERNS = [
  /privacy policy/i,
  /cookie policy/i,
  /terms of service/i,
  /subscribe to our newsletter/i,
];

export function classifyExtraction({ title, text, httpStatus }) {
  const normalizedText = normalizeText(text);
  const lower = normalizedText.toLowerCase();

  if (httpStatus && [401, 403, 429].includes(httpStatus)) {
    return { status: 'manual_required', reason: `http_${httpStatus}` };
  }

  if (BLOCK_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
    return { status: 'manual_required', reason: 'captcha_or_login_or_block' };
  }

  if (!normalizedText) {
    return { status: 'failed', reason: 'empty_content' };
  }

  if (normalizedText.length < 700) {
    return { status: 'weak', reason: 'content_too_short' };
  }

  if (!title || title.trim().length < 3) {
    return { status: 'weak', reason: 'missing_title' };
  }

  const navHits = NAV_PATTERNS.filter((pattern) => pattern.test(lower)).length;
  const sentenceCount = (normalizedText.match(/[.!?]\s/g) || []).length;
  if (navHits >= 2 && sentenceCount < 6) {
    return { status: 'weak', reason: 'likely_boilerplate' };
  }

  return { status: 'ok' };
}

export function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}
