const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'mc_cid',
  'mc_eid',
]);

const GOOGLE_HOST_RE = /(^|\.)google\.[a-z.]+$/i;
const GOOGLE_INTERNAL_HOST_RE = /^(www|consent|accounts|support)\.google\./i;

export function normalizeResultUrl(rawUrl, baseUrl = 'https://www.google.com') {
  const unwrapped = unwrapGoogleRedirect(rawUrl, baseUrl);
  const url = new URL(unwrapped, baseUrl);

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }

  return {
    url: url.toString(),
    key: url.toString(),
  };
}

export function unwrapGoogleRedirect(rawUrl, baseUrl = 'https://www.google.com') {
  const url = new URL(rawUrl, baseUrl);
  if (!GOOGLE_HOST_RE.test(url.hostname)) {
    return url.toString();
  }

  const target = url.searchParams.get('q') || url.searchParams.get('url');
  if (target && /^https?:\/\//i.test(target)) {
    return target;
  }

  return url.toString();
}

export function isGoogleInternalUrl(rawUrl, baseUrl = 'https://www.google.com') {
  let url;
  try {
    url = new URL(rawUrl, baseUrl);
  } catch {
    return true;
  }

  if (!GOOGLE_INTERNAL_HOST_RE.test(url.hostname)) {
    return false;
  }

  const target = url.searchParams.get('q') || url.searchParams.get('url');
  return !(target && /^https?:\/\//i.test(target));
}
