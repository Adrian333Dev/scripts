import { createHash } from 'node:crypto';
import { classifyExtraction } from './quality.mjs';

const DEFAULT_MAX_CHARS = 12000;

const EXACT_NOISE_LINES = new Set([
  'Sign In',
  'Sign in',
  'Log In',
  'Log in',
  'Join',
  'Sort',
  'Recommended',
  'All related',
  'Continue Reading',
  'Continue reading',
  'Try again',
  'Advertisement',
  'Advertisements',
  'Sponsored',
  'Related questions',
  'Skip to content',
  'Skip to main content',
  'Skip to search',
  'Logged',
  '* * *',
  '---',
  '___',
]);

const NOISE_LINE_PATTERNS = [
  /^!\[[^\]]*]\([^)]+\)\s*$/i,
  /^\[!\[[^\]]*]\([^)]+\)]\([^)]+\)\s*$/i,
  /^#+\s*!\[[^\]]*]\([^)]+\)\s*/i,
  /^\[]\(https?:\/\/[^)]+\)\s*$/i,
  /^Image\s+\d+$/i,
  /^Upvote\s*·/i,
  /^Downvote\s*·/i,
  /^Reply\s*·/i,
  /^Share\s*·/i,
  /^Award\s*·/i,
  /^Follow\s*·/i,
  /^Asked\s+by\s+/i,
  /^Updated\s+\d+/i,
  /^Sponsored\s+by\s+/i,
  /^Promoted\s+by\s+/i,
  /^View\s+\d+\s+upvotes?/i,
  /^\d+(\.\d+)?[KkMm]?\s+views?$/i,
  /^\d+(\.\d+)?[KkMm]?\s+upvotes?$/i,
  /^\d+\s+comments?$/i,
  /^More posts you may like/i,
  /^This thread is archived/i,
  /^New comments cannot be posted/i,
  /^Want to join/i,
  /^Already have an account/i,
];

export function compactMarkdown(markdown, options = {}) {
  const maxChars = options.maxChars === undefined ? DEFAULT_MAX_CHARS : options.maxChars;
  const parsed = splitSourceMarkdown(markdown);
  const cleanedBody = cleanBody(parsed.body, options);
  const blocked = classifyExtraction({ text: cleanedBody }).status === 'manual_required';
  const eligibleBody = blocked
    ? '[Extraction blocked by captcha, login, or bot-verification page. Refetch or manual capture needed.]'
    : cleanedBody;
  const capped = applyCharacterBudget(eligibleBody, maxChars);
  const output = renderCompactMarkdown(parsed, capped.text, {
    originalChars: String(markdown || '').length,
    compactChars: capped.text.length,
    maxChars,
    truncated: capped.truncated,
    blocked,
  });

  return {
    markdown: output,
    originalChars: String(markdown || '').length,
    compactChars: output.length,
    bodyChars: capped.text.length,
    truncated: capped.truncated,
    blocked,
    contentHash: createHash('sha256').update(output).digest('hex'),
  };
}

export function cleanBody(markdown, options = {}) {
  const withoutHtml = stripRawHtml(String(markdown || ''));
  const withoutImages = options.keepImages ? withoutHtml : removeImageSyntax(withoutHtml);
  const lines = withoutImages
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/g, ''));

  const filteredLines = [];
  let previousBlank = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!previousBlank) {
        filteredLines.push('');
      }
      previousBlank = true;
      continue;
    }

    if (isNoiseLine(trimmed, options)) {
      continue;
    }

    filteredLines.push(line);
    previousBlank = false;
  }

  return dedupeBlocks(filteredLines.join('\n'))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitSourceMarkdown(markdown) {
  const text = String(markdown || '');
  const frontmatterMatch = text.match(/^---\n[\s\S]*?\n---\n*/);
  const frontmatter = frontmatterMatch ? frontmatterMatch[0].trim() : '';
  const withoutFrontmatter = frontmatterMatch ? text.slice(frontmatterMatch[0].length) : text;
  const contentMarker = '\n## Extracted Content\n';
  const contentIndex = withoutFrontmatter.indexOf(contentMarker);

  if (contentIndex < 0) {
    return {
      frontmatter,
      intro: withoutFrontmatter.trim(),
      body: withoutFrontmatter,
    };
  }

  return {
    frontmatter,
    intro: withoutFrontmatter.slice(0, contentIndex).trim(),
    body: withoutFrontmatter.slice(contentIndex + contentMarker.length),
  };
}

function renderCompactMarkdown(parsed, body, stats) {
  const meta = [
    '<!-- compacted_source: true',
    `original_chars: ${stats.originalChars}`,
    `body_chars: ${stats.compactChars}`,
    `max_body_chars: ${stats.maxChars || 'none'}`,
    `truncated: ${stats.truncated}`,
    `blocked: ${stats.blocked}`,
    '-->',
  ].join('\n');

  return [
    parsed.frontmatter,
    parsed.intro,
    meta,
    '## Compacted Content',
    body || '[No compactable content remained.]',
  ]
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .concat('\n');
}

function removeImageLines(markdown) {
  return removeImageSyntax(markdown);
}

function removeImageSyntax(markdown) {
  return String(markdown || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/!\[[^\]]*]\([^)]+\)\s*/gi, ''))
    .filter((line) => !NOISE_LINE_PATTERNS[0].test(line.trim()) && !NOISE_LINE_PATTERNS[1].test(line.trim()))
    .join('\n');
}

function stripRawHtml(markdown) {
  return String(markdown || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/<\/(p|div|section|article|main|header|footer|li|ul|ol|br|h[1-6]|tr|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function isNoiseLine(line, options) {
  if (EXACT_NOISE_LINES.has(line)) {
    return true;
  }

  if (!options.keepImages && NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
    return true;
  }

  return line.length <= 2 && !/^#+$/.test(line);
}

function dedupeBlocks(markdown) {
  const blocks = String(markdown || '').split(/\n{2,}/);
  const seen = new Set();
  const kept = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) {
      continue;
    }

    const key = normalizeBlockKey(trimmed);
    if (key.length > 80 && seen.has(key)) {
      continue;
    }

    if (key.length > 80) {
      seen.add(key);
    }
    kept.push(trimmed);
  }

  return kept.join('\n\n');
}

function normalizeBlockKey(block) {
  return block
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[`*_#[\](){}.,!?;:'"<>|/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyCharacterBudget(markdown, maxChars) {
  if (!maxChars || markdown.length <= maxChars) {
    return { text: markdown, truncated: false };
  }

  const blocks = markdown.split(/\n{2,}/);
  const kept = [];
  let length = 0;
  for (const block of blocks) {
    const addition = kept.length ? block.length + 2 : block.length;
    if (length + addition > maxChars) {
      continue;
    }
    kept.push(block);
    length += addition;
  }

  let text = kept.join('\n\n').trim();
  if (!text) {
    text = markdown.slice(0, maxChars).trim();
  }

  return {
    text: `${text}\n\n[Truncated after deterministic compaction.]`,
    truncated: true,
  };
}
