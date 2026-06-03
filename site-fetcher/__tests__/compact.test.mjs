import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanBody, compactMarkdown } from '../compact.mjs';
import { compactSources, parseArgs } from '../compact-sources.mjs';

test('compact args default to input compact directory', () => {
  const args = parseArgs(['--input', 'runs/site-corpus']);

  assert.equal(args.input, 'runs/site-corpus');
  assert.equal(args.out, path.join('runs/site-corpus', 'compact'));
  assert.equal(args.maxChars, 12000);
});

test('cleanBody removes obvious shell noise, images, and duplicate blocks', () => {
  const repeated = 'This answer explains the main useful point with enough words to dedupe the repeated paragraph correctly.';
  const body = [
    'Sign In',
    '![Image 1](https://example.com/a.jpg)',
    repeated,
    '',
    repeated,
    '',
    'Continue Reading',
    'A short useful line.',
  ].join('\n');

  const clean = cleanBody(body);

  assert.equal(clean.includes('Sign In'), false);
  assert.equal(clean.includes('![Image'), false);
  assert.equal(clean.includes('Continue Reading'), false);
  assert.equal(clean.match(/main useful point/g).length, 1);
  assert.equal(clean.includes('A short useful line.'), true);
});

test('cleanBody removes generic forum chrome', () => {
  const body = [
    '### ![Image 1](https://example.com/icon.gif) Topic: Useful forum thread',
    '',
    'Actual question text.',
    '',
    '![Image 2](https://example.com/ip.gif) Logged',
    '',
    '* * *',
    '',
    '[](https://example.com/thread)',
    '',
    'Actual answer text.',
  ].join('\n');

  const clean = cleanBody(body);

  assert.equal(clean.includes('![Image'), false);
  assert.equal(clean.includes('Logged'), false);
  assert.equal(clean.includes('* * *'), false);
  assert.equal(clean.includes('[](https://example.com/thread)'), false);
  assert.equal(clean.includes('### Topic: Useful forum thread'), true);
  assert.equal(clean.includes('Actual answer text.'), true);
});

test('cleanBody strips raw HTML', () => {
  const clean = cleanBody('<html><body><nav>Menu</nav><script>alert(1)</script><p>Useful text.</p></body></html>');

  assert.equal(clean.includes('<html>'), false);
  assert.equal(clean.includes('alert'), false);
  assert.equal(clean.includes('Useful text.'), true);
});

test('compactMarkdown preserves source header and applies body cap', () => {
  const markdown = [
    '---',
    'url: "https://example.com/"',
    '---',
    '',
    '# Example',
    '',
    'Source: https://example.com/',
    '',
    '## Extracted Content',
    '',
    'First useful paragraph with enough detail to keep.',
    '',
    'Second useful paragraph that should not fit in the tiny cap.',
  ].join('\n');

  const result = compactMarkdown(markdown, { maxChars: 60 });

  assert.equal(result.markdown.includes('# Example'), true);
  assert.equal(result.markdown.includes('## Compacted Content'), true);
  assert.equal(result.truncated, true);
  assert.equal(result.markdown.includes('[Truncated after deterministic compaction.]'), true);
});

test('compactMarkdown replaces blocked verification content with placeholder', () => {
  const result = compactMarkdown([
    '# Blocked',
    '',
    '## Extracted Content',
    '',
    'Performing security verification',
    'This website uses a security service to protect against malicious bots.',
  ].join('\n'));

  assert.equal(result.blocked, true);
  assert.equal(result.markdown.includes('Refetch or manual capture needed'), true);
  assert.equal(result.markdown.includes('protect against malicious bots'), false);
});

test('compactSources writes compact files and manifest', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'site-fetcher-compact-'));
  const sourceDir = path.join(dir, 'sources');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(sourceDir, { recursive: true }));
  await writeFile(path.join(sourceDir, '001-example.md'), [
    '# Example',
    '',
    'Source: https://example.com/',
    '',
    '## Extracted Content',
    '',
    'Sign In',
    'Useful body.',
  ].join('\n'));

  const manifest = await compactSources({
    input: dir,
    out: path.join(dir, 'compact'),
    maxChars: 12000,
    keepImages: false,
  });

  const output = await readFile(path.join(dir, 'compact', 'sources', '001-example.md'), 'utf8');
  const manifestJson = JSON.parse(await readFile(path.join(dir, 'compact', 'manifest.json'), 'utf8'));

  assert.equal(manifest.totalSources, 1);
  assert.equal(manifestJson.outputs.length, 1);
  assert.equal(output.includes('Useful body.'), true);
  assert.equal(output.includes('Sign In'), false);
});
