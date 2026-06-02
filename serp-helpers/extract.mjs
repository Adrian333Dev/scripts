export async function extractOrganicResults(page, { verbose = false, includeDebugFields = false } = {}) {
  return page.evaluate(({ verbose, includeDebugFields }) => {
    const skipped = [];
    const candidates = [];
    const seenHrefs = new Set();

    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const cleanText = (value) => (value || '').replace(/\s+/g, ' ').trim();

    const isBlockedText = (text) => {
      const lower = text.toLowerCase();
      return lower.includes('people also ask') ||
        lower.includes('sponsored') ||
        lower.includes('images') ||
        lower.includes('videos') ||
        lower.includes('related searches');
    };

    const isGoogleUrl = (href) => {
      try {
        const url = new URL(href, location.href);
        if (url.searchParams.get('q') || url.searchParams.get('url')) {
          return false;
        }
        return /^(www|consent|accounts|support)\.google\./i.test(url.hostname);
      } catch {
        return true;
      }
    };

    const cleanSnippet = (element) => {
      if (!element) return undefined;
      const clone = element.cloneNode(true);
      for (const remove of clone.querySelectorAll('a.vzmbzf, script, style')) {
        remove.remove();
      }
      return cleanText(clone.textContent) || undefined;
    };

    const resultContainers = [...document.querySelectorAll('div.MjjYud, div.g, div.Gx5Zad')];

    for (const container of resultContainers) {
      const h3 = [...container.querySelectorAll('h3')].find(isVisible) || container.querySelector('h3.LC20lb, h3');
      if (!h3) {
        continue;
      }

      const anchor = h3.closest('a') || container.querySelector('a[href]');
      const title = cleanText(h3.textContent);
      const href = anchor?.href;

      if (!title || !href || seenHrefs.has(href) || isGoogleUrl(href)) {
        skipped.push({ title, href, reason: 'missing duplicate or google internal' });
        continue;
      }

      const containerText = cleanText(container.innerText);
      if (isBlockedText(containerText.slice(0, 200))) {
        skipped.push({ title, href, reason: 'blocked result type' });
        continue;
      }

      const displayUrl = cleanText(container.querySelector('cite')?.textContent);
      const source = cleanText(container.querySelector('.VuuXrf')?.textContent);
      const snippet = cleanSnippet(container.querySelector('.VwiC3b'));
      const positioned = container.querySelector('[data-rpos]') || container.closest('[data-rpos]');
      const resultPosition = Number.parseInt(positioned?.getAttribute('data-rpos') || '', 10);
      const hveidElement = container.querySelector('[data-hveid]');

      seenHrefs.add(href);
      const result = {
        title,
        url: href,
        source: source || undefined,
        displayUrl: displayUrl || undefined,
        snippet,
        language: container.querySelector('[lang]')?.getAttribute('lang') || undefined,
      };

      if (Number.isInteger(resultPosition)) {
        result.resultPosition = resultPosition;
      }

      if (includeDebugFields) {
        result.dataVed = anchor?.getAttribute('data-ved') || undefined;
        result.dataHveid = hveidElement?.getAttribute('data-hveid') || undefined;
      }

      candidates.push(result);
    }

    if (verbose && skipped.length > 0) {
      console.debug('Skipped SERP candidates:', skipped);
    }

    return candidates;
  }, { verbose, includeDebugFields });
}
