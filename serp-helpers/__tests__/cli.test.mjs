import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../collect-google.mjs';

test('parses required query and optional max pages and out dir', () => {
  const args = parseArgs(['--query', 'hello world', '--max-pages', '3', '--out', 'runs/test']);
  assert.deepEqual(args.queries, ['hello world']);
  assert.equal(args.maxPages, 3);
  assert.equal(args.out, 'runs/test');
});

test('creates default out dir slug from query', () => {
  const args = parseArgs(['--query', '"zoned out" lecture']);
  assert.equal(args.out, 'runs/zoned-out-lecture');
});

test('rejects missing query', () => {
  assert.throws(() => parseArgs([]), /--query is required/);
});

test('parses repeated queries and uses generic default output dir', () => {
  const args = parseArgs(['--query', 'first', '--query', 'second']);

  assert.deepEqual(args.queries, ['first', 'second']);
  assert.equal(args.out, 'runs/google-serp-run');
});

test('parses query file, field list, and delay range', () => {
  const args = parseArgs([
    '--queries-file',
    'queries.txt',
    '--fields',
    'title,url,snippet',
    '--delay-ms',
    '100:500',
  ]);

  assert.equal(args.queriesFile, 'queries.txt');
  assert.deepEqual(args.fields, ['title', 'url', 'snippet']);
  assert.deepEqual(args.delayMs, { min: 100, max: 500 });
});

test('fast mode lowers delay range', () => {
  const args = parseArgs(['--query', 'hello', '--fast']);

  assert.deepEqual(args.delayMs, { min: 100, max: 500 });
});

test('parses open-only manual browser mode', () => {
  const args = parseArgs(['--query', 'hello', '--open-only']);

  assert.equal(args.openOnly, true);
});

test('parses Chrome DevTools endpoint', () => {
  const args = parseArgs(['--query', 'hello', '--connect-cdp', 'http://127.0.0.1:9222']);

  assert.equal(args.connectCdp, 'http://127.0.0.1:9222');
});

test('parses page concurrency', () => {
  const args = parseArgs(['--query', 'hello', '--page-concurrency', '3']);

  assert.equal(args.pageConcurrency, 3);
});

test('rejects excessive page concurrency', () => {
  assert.throws(
    () => parseArgs(['--query', 'hello', '--page-concurrency', '9']),
    /--page-concurrency must be between 1 and 8/,
  );
});

test('rejects removed pagination and results-per-page options', () => {
  assert.throws(() => parseArgs(['--query', 'hello', '--pagination', 'click']), /Unknown option: --pagination/);
  assert.throws(() => parseArgs(['--query', 'hello', '--results-per-page', '100']), /Unknown option: --results-per-page/);
});
