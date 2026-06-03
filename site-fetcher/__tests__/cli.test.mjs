import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../extract-sources.mjs';

test('parses urls-file and output directory', () => {
  const args = parseArgs(['--urls-file', 'urls.txt', '--out', 'runs/corpus']);

  assert.deepEqual(args.urls, []);
  assert.equal(args.urlsFile, 'urls.txt');
  assert.equal(args.out, 'runs/corpus');
  assert.equal(args.method, 'auto');
  assert.equal(args.concurrency, 3);
});

test('parses direct URL input', () => {
  const args = parseArgs(['--url', 'https://example.com/', '--out', 'runs/corpus']);

  assert.deepEqual(args.urls, ['https://example.com/']);
  assert.equal(args.out, 'runs/corpus');
});

test('parses repeated direct URL input', () => {
  const args = parseArgs(['--url', 'https://a.example/', '--url', 'https://b.example/']);

  assert.deepEqual(args.urls, ['https://a.example/', 'https://b.example/']);
});

test('parses SERP input, max URLs, and force mode', () => {
  const args = parseArgs([
    '--input',
    'runs/serp',
    '--max-urls',
    '25',
    '--concurrency',
    '2',
    '--force',
    '--verbose',
  ]);

  assert.equal(args.input, 'runs/serp');
  assert.equal(args.maxUrls, 25);
  assert.equal(args.concurrency, 2);
  assert.equal(args.force, true);
  assert.equal(args.verbose, true);
});

test('requires a URL source', () => {
  assert.throws(() => parseArgs([]), /--url, --input, or --urls-file is required/);
});

test('rejects unsupported methods', () => {
  assert.throws(() => parseArgs(['--urls-file', 'urls.txt', '--method', 'browser']), /must be one of/);
});

test('parses Jina-only method and API key env', () => {
  const args = parseArgs([
    '--url',
    'https://example.com/',
    '--method',
    'jina',
    '--jina-api-key-env',
    'JINA_API_KEY',
  ]);

  assert.equal(args.method, 'jina');
  assert.equal(args.jinaApiKeyEnv, 'JINA_API_KEY');
});
