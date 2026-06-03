import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { classifyExtraction, normalizeText } from './quality.mjs';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; llm-scripts-site-fetcher/1.0)';

export async function extractWithHttpReadability(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs || 20000),
    headers: {
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': options.locale || 'en-US,en;q=0.9',
      'user-agent': options.userAgent || DEFAULT_USER_AGENT,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    return {
      method: 'http-readability',
      status: 'failed',
      reason: 'unsupported_content_type',
      httpStatus: response.status,
      contentType,
      markdown: '',
      text: '',
    };
  }

  const html = await response.text();
  const blockClassification = classifyExtraction({
    text: html.slice(0, 5000),
    httpStatus: response.status,
  });

  if (blockClassification.status === 'manual_required') {
    return {
      method: 'http-readability',
      ...blockClassification,
      httpStatus: response.status,
      contentType,
      markdown: '',
      text: '',
      rawLength: html.length,
    };
  }

  const dom = new JSDOM(html, { url });
  removeNoisyNodes(dom.window.document);
  const article = new Readability(dom.window.document.cloneNode(true), {
    charThreshold: options.charThreshold || 300,
  }).parse();

  if (!article) {
    return {
      method: 'http-readability',
      status: 'failed',
      reason: 'readability_failed',
      httpStatus: response.status,
      contentType,
      markdown: '',
      text: '',
      rawLength: html.length,
    };
  }

  const turndown = createTurndown();
  const markdown = cleanupMarkdown(turndown.turndown(article.content || ''));
  const text = normalizeText(article.textContent);
  const classification = classifyExtraction({
    title: article.title,
    text,
    httpStatus: response.status,
  });

  return {
    method: 'http-readability',
    ...classification,
    title: article.title,
    byline: article.byline,
    excerpt: article.excerpt,
    siteName: article.siteName,
    lang: article.lang,
    publishedTime: article.publishedTime,
    httpStatus: response.status,
    contentType,
    markdown,
    text,
    textLength: text.length,
    rawLength: html.length,
    html: options.debugArtifacts ? html : undefined,
  };
}

function removeNoisyNodes(document) {
  for (const selector of [
    'script',
    'style',
    'noscript',
    'svg',
    'canvas',
    'iframe',
    'form',
    '[aria-hidden="true"]',
  ]) {
    for (const node of document.querySelectorAll(selector)) {
      node.remove();
    }
  }
}

function createTurndown() {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  turndown.remove(['script', 'style', 'noscript']);
  return turndown;
}

function cleanupMarkdown(markdown) {
  return String(markdown || '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
