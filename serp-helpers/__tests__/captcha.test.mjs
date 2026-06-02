import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCaptcha, waitForManualCaptcha } from '../captcha.mjs';

test('detects Google unusual traffic text', async () => {
  const page = fakePage({
    url: 'https://www.google.com/sorry/index',
    bodyText: 'Our systems have detected unusual traffic from your computer network.',
  });

  assert.equal(await detectCaptcha(page), true);
});

test('manual CAPTCHA wait continues automatically when page clears', async () => {
  let checks = 0;
  const page = fakePage({
    url: 'https://www.google.com/search?q=x',
    bodyText: () => {
      checks += 1;
      return checks < 2 ? 'unusual traffic' : 'Search results';
    },
  });

  const solved = await waitForManualCaptcha(page, {
    attempts: 1,
    pollMs: 1,
    timeoutMs: 200,
    log: () => {},
    createQuestion: () => ({
      promise: new Promise(() => {}),
      close: () => {},
    }),
  });

  assert.equal(solved, true);
});

function fakePage({ url, bodyText }) {
  return {
    url: () => url,
    locator: () => ({
      innerText: async () => typeof bodyText === 'function' ? bodyText() : bodyText,
    }),
    waitForLoadState: async () => {},
  };
}
