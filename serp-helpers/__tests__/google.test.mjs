import test from 'node:test';
import assert from 'node:assert/strict';
import { goToNextPage, searchUrl } from '../google.mjs';

test('direct pagination starts navigation without probing next-link selectors', async () => {
  const calls = [];
  const page = {
    goto: async (url) => {
      calls.push(['goto', url]);
    },
    waitForSelector: async () => {},
    locator: () => {
      throw new Error('selector lookup should not run before direct pagination');
    },
    getByRole: () => {
      throw new Error('role lookup should not run before direct pagination');
    },
  };

  const navigated = await goToNextPage(page, {
    query: 'hello world',
    nextStart: 10,
  });

  assert.equal(navigated, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0][1], /[?&]start=10(&|$)/);
});

test('search URL uses query and start only', () => {
  const url = new URL(searchUrl('hello world', 20));

  assert.equal(url.searchParams.get('q'), 'hello world');
  assert.equal(url.searchParams.get('start'), '20');
  assert.equal(url.searchParams.has('num'), false);
});
