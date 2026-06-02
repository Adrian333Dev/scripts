export async function openGoogleSession({ profileDir, locale = 'en-US', connectCdp }) {
  const { chromium } = await import('playwright');

  if (connectCdp) {
    const browser = await chromium.connectOverCDP(connectCdp, {
      noDefaults: true,
    });
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close();
      throw new Error(`No browser context found for CDP endpoint: ${connectCdp}`);
    }
    return {
      context,
      close: async () => browser.close(),
    };
  }

  const options = {
    headless: false,
    viewport: { width: 1366, height: 900 },
    locale,
  };

  try {
    const context = await chromium.launchPersistentContext(profileDir, {
      ...options,
      channel: 'chrome',
    });
    return {
      context,
      close: async () => context.close(),
    };
  } catch (error) {
    if (!/chrome|executable|channel/i.test(String(error.message))) {
      throw error;
    }
    console.warn('Chrome channel is unavailable; falling back to Playwright Chromium.');
    const context = await chromium.launchPersistentContext(profileDir, options);
    return {
      context,
      close: async () => context.close(),
    };
  }
}

export async function launchGoogleContext(options) {
  const session = await openGoogleSession(options);
  return session.context;
}

export async function openSearchPage(context, query, start = 0, { log, newPage = false } = {}) {
  const page = newPage ? await context.newPage() : context.pages()[0] || await context.newPage();
  await timed(log, `goto start=${start}`, () => page.goto(searchUrl(query, start), { waitUntil: 'domcontentloaded' }));
  await timed(log, `wait results start=${start}`, () => waitForSearchResults(page));
  return page;
}

export async function tryAcceptConsent(page) {
  const labels = [
    /^accept all$/i,
    /^i agree$/i,
    /^agree$/i,
    /^accept$/i,
  ];

  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      return true;
    }
  }

  return false;
}

export async function goToNextPage(page, { query, nextStart, log } = {}) {
  if (!Number.isInteger(nextStart) || nextStart <= 0) {
    return false;
  }

  await timed(log, `direct goto start=${nextStart}`, () => page.goto(searchUrl(query, nextStart), { waitUntil: 'domcontentloaded' }));
  await timed(log, `wait results start=${nextStart}`, () => waitForSearchResults(page));
  return true;
}

export async function delayBetweenPages(minMs = 3000, maxMs = 8000) {
  await randomDelay(minMs, maxMs);
}

export function searchUrl(query, start = 0) {
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', query);
  if (start > 0) {
    url.searchParams.set('start', String(start));
  }
  return url.toString();
}

async function randomDelay(minMs, maxMs) {
  const waitMs = Math.floor(minMs + Math.random() * (maxMs - minMs));
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

async function waitForSearchResults(page) {
  await page.waitForSelector('div.MjjYud h3, div.g h3, #search', { timeout: 8000 }).catch(() => {});
}

async function timed(log, label, fn) {
  if (!log) {
    return fn();
  }

  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    log(`${label}: ${Date.now() - startedAt}ms`);
  }
}
