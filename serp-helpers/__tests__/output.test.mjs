import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { filterResultFields, queryOutputFilename, writeQueryOutput } from '../output.mjs';

test('filters result fields while keeping requested order', () => {
  const filtered = filterResultFields({
    title: 'A "quoted" title',
    url: 'https://example.com',
    source: 'Example',
    snippet: 'line one',
    rank: 1,
    dataVed: 'debug',
  }, ['title', 'url', 'snippet']);

  assert.deepEqual(Object.keys(filtered), ['title', 'url', 'snippet']);
  assert.deepEqual(filtered, {
    title: 'A "quoted" title',
    url: 'https://example.com',
    snippet: 'line one',
  });
});

test('creates stable query output filenames with readable slug and hash', () => {
  const filename = queryOutputFilename(12, '"zoned out" lecture site:reddit.com with many extra terms that would be too long');

  assert.match(filename, /^012-zoned-out-lecture-site-reddit-com-with-many-extra-terms-[a-f0-9]{8}\.json$/);
  assert.ok(filename.length < 100);
});

test('writes one JSON object for a query and no CSV file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'serp-output-'));
  try {
    const filename = await writeQueryOutput(dir, {
      query: 'x',
      metadata: {
        query: 'x',
        startedAt: '2026-06-01T00:00:00.000Z',
        finishedAt: '2026-06-01T00:01:00.000Z',
        maxPages: 1,
        pagesCollected: 1,
        totalRawResults: 1,
        totalUniqueResults: 1,
        stoppedReason: 'max_pages',
      },
      results: [{
        title: 'T',
        url: 'https://e.test',
        source: 'Example',
        snippet: 'Snippet',
        rank: 1,
      }],
    }, { index: 1 });

    const saved = JSON.parse(await readFile(path.join(dir, filename), 'utf8'));
    assert.equal(saved.query, 'x');
    assert.equal(saved.metadata.stoppedReason, 'max_pages');
    assert.equal(saved.results[0].source, 'Example');

    await assert.rejects(() => stat(path.join(dir, 'results.csv')), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writes manifest JSON for multi-query runs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'serp-output-'));
  try {
    const { writeManifest } = await import('../output.mjs');
    await writeManifest(dir, {
      startedAt: '2026-06-01T00:00:00.000Z',
      finishedAt: '2026-06-01T00:01:00.000Z',
      queryCount: 2,
      outputs: [
        { query: 'a', file: 'queries/001-a.json', totalUniqueResults: 1 },
        { query: 'b', file: 'queries/002-b.json', totalUniqueResults: 0 },
      ],
    });

    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.queryCount, 2);
    assert.equal(manifest.outputs[0].file, 'queries/001-a.json');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
