import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { extractOrganicResults } from '../extract.mjs';

test('extracts richer organic metadata from Google-like result HTML', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <div class="MjjYud">
        <div class="A6K0A" data-rpos="0">
          <div lang="en" data-hveid="CA8QAA">
            <div class="tF2Cxc">
              <div class="yuRUbf">
                <a href="https://www.reddit.com/" data-ved="2ahUKEwifzJvM1-aUAxXMQvEDHeGrAdUQFnoECA0QAQ">
                  <h3 class="LC20lb">Reddit - The heart of the internet</h3>
                  <span class="VuuXrf">Reddit</span>
                  <cite>https://www.reddit.com</cite>
                </a>
              </div>
              <div class="VwiC3b">
                <span><em>Reddit</em> is where millions of people gather for conversations about the things they care about, in over 100000 subreddit communities.</span>
                <a class="vzmbzf" href="https://www.reddit.com/#:~:text=ignore">Read more</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);

    const results = await extractOrganicResults(page, {
      includeDebugFields: true,
    });

    assert.equal(results.length, 1);
    assert.deepEqual(results[0], {
      title: 'Reddit - The heart of the internet',
      url: 'https://www.reddit.com/',
      source: 'Reddit',
      displayUrl: 'https://www.reddit.com',
      snippet: 'Reddit is where millions of people gather for conversations about the things they care about, in over 100000 subreddit communities.',
      language: 'en',
      resultPosition: 0,
      dataVed: '2ahUKEwifzJvM1-aUAxXMQvEDHeGrAdUQFnoECA0QAQ',
      dataHveid: 'CA8QAA',
    });
  } finally {
    await browser.close();
  }
});
