import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWithJina } from '../jina-extract.mjs';

test('Jina extractor can be imported', () => {
  assert.equal(typeof extractWithJina, 'function');
});
