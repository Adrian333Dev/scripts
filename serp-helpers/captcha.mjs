import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const CAPTCHA_PATTERNS = [
  /unusual traffic/i,
  /our systems have detected/i,
  /i['’]m not a robot/i,
];

export async function detectCaptcha(page) {
  const currentUrl = page.url();
  if (currentUrl.includes('/sorry/')) {
    return true;
  }

  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return CAPTCHA_PATTERNS.some((pattern) => pattern.test(bodyText));
}

export async function waitForManualCaptcha(page, options = {}) {
  const { attempts = 2 } = options;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const cleared = await waitForCaptchaClear(page, options);
    if (cleared) {
      return true;
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    if (!(await detectCaptcha(page))) {
      return true;
    }
  }

  return false;
}

export async function waitForCaptchaClear(page, {
  pollMs = 2000,
  timeoutMs = 15 * 60 * 1000,
  createQuestion = defaultQuestion,
  log = console.log,
} = {}) {
  log('CAPTCHA detected. Solve it in the browser. Collection will continue automatically, or press Enter here to re-check now.');

  let stopPolling = false;
  const questionHandle = createQuestion();

  const question = questionHandle.promise.then(() => 'enter');

  const polling = (async () => {
    const startedAt = Date.now();
    while (!stopPolling && Date.now() - startedAt < timeoutMs) {
      await sleep(pollMs);
      if (!(await detectCaptcha(page))) {
        return 'cleared';
      }
    }
    return 'timeout';
  })();

  try {
    const result = await Promise.race([question, polling]);
    stopPolling = true;

    if (result === 'cleared') {
      return true;
    }

    if (result === 'timeout') {
      return false;
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    return !(await detectCaptcha(page));
  } finally {
    stopPolling = true;
    question.catch(() => {});
    questionHandle.close();
  }
}

function defaultQuestion() {
  const rl = readline.createInterface({ input, output });
  return {
    promise: rl.question(''),
    close: () => rl.close(),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
