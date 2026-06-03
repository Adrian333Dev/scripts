import { createHash } from 'node:crypto';
import { normalizeResultUrl } from '../serp-helpers/normalize.mjs';

export function normalizeSourceUrl(rawUrl) {
  const normalized = normalizeResultUrl(rawUrl);
  return {
    url: normalized.url,
    key: normalized.key,
    hash: createHash('sha256').update(normalized.key).digest('hex'),
  };
}

export function sourceSlug(title, url, maxLength = 70) {
  const fallback = new URL(url).hostname.replace(/^www\./, '');
  const base = (title || fallback)
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const trimmed = base.slice(0, maxLength).replace(/-+$/g, '');
  return trimmed || 'source';
}
