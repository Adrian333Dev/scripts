import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { classifyExtraction, normalizeText } from './quality.mjs';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; llm-scripts-site-fetcher/1.0)';

export function isRedditThreadUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  return /(^|\.)reddit\.com$/i.test(url.hostname) && /\/comments\/[^/]+/i.test(url.pathname);
}

export function toOldRedditUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.hostname = 'old.reddit.com';
  url.hash = '';
  return url.toString();
}

export async function extractRedditThread(url, options = {}) {
  const oldRedditUrl = toOldRedditUrl(url);
  const response = await fetch(oldRedditUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs || 20000),
    headers: {
      'accept': 'text/html,application/xhtml+xml',
      'accept-language': options.locale || 'en-US,en;q=0.9',
      'user-agent': options.userAgent || DEFAULT_USER_AGENT,
    },
  });

  const html = await response.text();
  const blockClassification = classifyExtraction({
    text: html.slice(0, 5000),
    httpStatus: response.status,
  });

  if (blockClassification.status === 'manual_required') {
    return {
      method: 'reddit-old',
      ...blockClassification,
      httpStatus: response.status,
      contentType: response.headers.get('content-type') || '',
      markdown: '',
      text: '',
      rawLength: html.length,
      fetchedUrl: oldRedditUrl,
    };
  }

  const dom = new JSDOM(html, { url: oldRedditUrl });
  const document = dom.window.document;
  const turndown = createTurndown();
  const title = extractTitle(document);
  const postMarkdown = extractPostMarkdown(document, turndown);
  const comments = extractCommentMarkdown(document, turndown);
  const markdown = cleanupMarkdown([
    postMarkdown,
    comments.length ? `## Comments\n\n${comments.join('\n\n---\n\n')}` : '',
  ].filter(Boolean).join('\n\n'));
  const text = normalizeText(markdown);
  const classification = classifyExtraction({
    title,
    text,
    httpStatus: response.status,
  });

  return {
    method: 'reddit-old',
    ...classification,
    title,
    siteName: 'Reddit',
    httpStatus: response.status,
    contentType: response.headers.get('content-type') || '',
    markdown,
    text,
    textLength: text.length,
    rawLength: html.length,
    fetchedUrl: oldRedditUrl,
    html: options.debugArtifacts ? html : undefined,
  };
}

function extractTitle(document) {
  const titleNode = document.querySelector('.thing.link .title a.title')
    || document.querySelector('a.title')
    || document.querySelector('title');
  return normalizeText(titleNode?.textContent || '');
}

function extractPostMarkdown(document, turndown) {
  const title = extractTitle(document);
  const post = document.querySelector('.thing.link');
  const body = post?.querySelector('.usertext-body .md');
  const lines = [];

  if (title) {
    lines.push(`## Post\n\n### ${title}`);
  }

  if (body) {
    lines.push(turndown.turndown(body.innerHTML));
  }

  return cleanupMarkdown(lines.join('\n\n'));
}

function extractCommentMarkdown(document, turndown) {
  const comments = [];
  for (const comment of document.querySelectorAll('.commentarea .thing.comment')) {
    const author = normalizeText(comment.querySelector('a.author')?.textContent || '[deleted]');
    const score = normalizeText(comment.querySelector('.score.unvoted')?.textContent || '');
    const body = comment.querySelector('.usertext-body .md');
    if (!body) {
      continue;
    }

    const bodyMarkdown = cleanupMarkdown(turndown.turndown(body.innerHTML));
    if (!bodyMarkdown) {
      continue;
    }

    const heading = score ? `### ${author} (${score})` : `### ${author}`;
    comments.push(`${heading}\n\n${bodyMarkdown}`);
  }
  return comments;
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
