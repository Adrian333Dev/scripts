import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyExtraction } from '../quality.mjs';

test('marks HTTP access blocks as manual required', () => {
  assert.deepEqual(
    classifyExtraction({ text: 'Forbidden', httpStatus: 403 }),
    { status: 'manual_required', reason: 'http_403' },
  );
});

test('detects CAPTCHA-like content', () => {
  assert.deepEqual(
    classifyExtraction({ text: 'Please verify you are human to continue' }),
    { status: 'manual_required', reason: 'captcha_or_login_or_block' },
  );
});

test('detects bot security verification content', () => {
  assert.deepEqual(
    classifyExtraction({
      title: 'forums.example.com',
      text: 'Performing security verification. This website uses a security service to protect against malicious bots.',
      httpStatus: 200,
    }),
    { status: 'manual_required', reason: 'captcha_or_login_or_block' },
  );
});

test('marks short extraction as weak', () => {
  assert.deepEqual(
    classifyExtraction({ title: 'Short page', text: 'Useful but tiny.' }),
    { status: 'weak', reason: 'content_too_short' },
  );
});

test('accepts long natural-language content', () => {
  const text = Array.from({ length: 80 }, (_, index) => `Sentence ${index} explains a useful point.`).join(' ');

  assert.deepEqual(classifyExtraction({ title: 'Long page', text }), { status: 'ok' });
});
