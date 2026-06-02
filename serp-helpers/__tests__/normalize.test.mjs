import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeResultUrl,
  isGoogleInternalUrl,
} from '../normalize.mjs';

test('unwraps Google redirect URLs and removes tracking params', () => {
  const input = 'https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fpost%3Futm_source%3Dx%26gclid%3Dabc%26id%3D7&sa=U';
  const result = normalizeResultUrl(input);
  assert.equal(result.url, 'https://example.com/post?id=7');
  assert.equal(result.key, 'https://example.com/post?id=7');
});

test('preserves reddit comment paths while dropping hashes', () => {
  const input = 'https://www.reddit.com/r/test/comments/abc/title/comment/def/?utm_medium=web#thing';
  const result = normalizeResultUrl(input);
  assert.equal(result.url, 'https://www.reddit.com/r/test/comments/abc/title/comment/def/');
});

test('rejects google internal URLs', () => {
  assert.equal(isGoogleInternalUrl('https://www.google.com/search?q=x'), true);
  assert.equal(isGoogleInternalUrl('https://accounts.google.com/signin'), true);
  assert.equal(isGoogleInternalUrl('https://example.com/search?q=x'), false);
});

test('allows Google-owned organic result destinations', () => {
  assert.equal(isGoogleInternalUrl('https://play.google.com/store/apps/details?id=com.reddit.frontpage'), false);
});
