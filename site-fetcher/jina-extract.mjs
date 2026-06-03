import { classifyExtraction, normalizeText } from './quality.mjs';

const JINA_READER_PREFIX = 'https://r.jina.ai/http://';

export async function extractWithJina(url, options = {}) {
  const readerUrl = `${JINA_READER_PREFIX}${url}`;
  const headers = {
    'accept': 'text/plain,text/markdown,*/*',
    'user-agent': options.userAgent || 'llm-scripts-site-fetcher/1.0',
  };

  const apiKey = options.jinaApiKeyEnv ? process.env[options.jinaApiKeyEnv] : undefined;
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(readerUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs || 30000),
    headers,
  });

  const markdown = cleanupJinaMarkdown(await response.text());
  const title = extractJinaTitle(markdown);
  const text = normalizeText(markdown);
  const classification = classifyExtraction({
    title,
    text,
    httpStatus: response.status,
  });

  return {
    method: 'jina',
    ...classification,
    title,
    siteName: new URL(url).hostname.replace(/^www\./, ''),
    httpStatus: response.status,
    contentType: response.headers.get('content-type') || '',
    markdown,
    text,
    textLength: text.length,
    fetchedUrl: readerUrl,
  };
}

export function shouldTryJina(options) {
  return options.method === 'auto' || options.method === 'jina';
}

function extractJinaTitle(markdown) {
  const titleMatch = markdown.match(/^Title:\s*(.+)$/m);
  if (titleMatch) {
    return titleMatch[1].trim();
  }

  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  return headingMatch ? headingMatch[1].trim() : '';
}

function cleanupJinaMarkdown(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const contentStart = lines.findIndex((line) => line.trim() === 'Markdown Content:');
  const contentLines = contentStart >= 0 ? lines.slice(contentStart + 1) : lines;

  return contentLines
    .filter((line) => !/^Warning:/i.test(line.trim()))
    .filter((line) => !isCommonShellNoise(line.trim()))
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function isCommonShellNoise(line) {
  return [
    'Something went wrong. Wait a moment and try again.',
    'Try again',
    'Skip to content',
    'Skip to search',
  ].includes(line);
}
