/// <reference types="cypress" />
//
// Broken Link Checker — for each page, fetches the HTML from Node, extracts
// every <a> / <img> / <source> / <link> / <script> / media URL, and probes them
// in parallel from Node (no CORS, no Cypress retries). One test per page; it
// FAILS when the page cannot be loaded or any link is broken (4xx except bot
// blocks, 5xx, unreachable). 403/429/451/999 are anti-bot responses from
// external sites: listed in the report, not counted as broken.
//
// Restrict pages with --env linksPages=home+about (ids below; "+" or "," separated).

const PAGES = [
  { id: 'home',              name: 'Homepage',                        path: '/' },
  { id: 'about',             name: 'About Us',                        path: '/about/' },
  { id: 'blog',              name: 'Blog',                            path: '/blog/' },
  { id: 'mlp',               name: 'MLP Digital Marketing Course',    path: '/marketing-launchpad/digital-marketing-course/' },
  { id: 'mlp-pt',            name: 'MLP Part-Time Digital Marketing', path: '/marketing-launchpad/part-time-digital-marketing-course/' },
  { id: 'mlp-hindi',         name: 'MLP Digital Marketing in Hindi',  path: '/marketing-launchpad/digital-marketing-course-in-hindi/' },
  { id: 'alm',               name: 'ALM (AI-Led Marketing)',          path: '/pgp-in-marketing/' },
  { id: 'smbl',              name: 'BASL Sales and Marketing',        path: '/pgp/learn-sales-and-marketing/' },
  { id: 'glossary',          name: 'Marketing Glossary',              path: '/marketing-glossary/' },
  { id: 'press',             name: 'Press Releases',                  path: '/press-releases/' },
  { id: 'hire',              name: 'Hire Digital Marketers',          path: '/hire-digital-marketers/' },
  { id: 'placement-reports', name: 'Placement Reports',               url: 'https://placement-reports.kraftshala.com/' },
  { id: 'reviews',           name: 'Reviews',                         url: 'https://reviews.kraftshala.com/' },
];

const URL_TIMEOUT_MS = 10000;
const CONCURRENCY = 10;

function getPageUrl(page) {
  return page.url || Cypress.config('baseUrl').replace(/\/+$/, '') + page.path;
}

function getSelectedPages() {
  const selected = Cypress.env('linksPages');
  if (!selected) return PAGES;
  const ids = String(selected).split(/[,|+]/).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return PAGES;
  return PAGES.filter((p) => ids.includes(p.id));
}

function shouldSkipUrl(url) {
  if (!url) return true;
  const t = String(url).trim();
  if (!t) return true;
  if (/^(mailto:|tel:|javascript:)/i.test(t)) return true;
  if (t.startsWith('#')) return true;
  if (/^data:/i.test(t)) return true; // inline data URIs aren't network-fetchable
  return false;
}

function resolveUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch (_) {
    return null;
  }
}

function classifyStatus(status) {
  if (status === 0) return 'unreachable';
  if (status >= 200 && status < 300) return 'working';
  if (status === 301 || status === 302 || status === 307 || status === 308) return 'redirect';
  // Anti-bot / rate-limit responses from external sites — the link works for
  // real users but the target rejects automated fetches. We log them but do
  // NOT classify them as broken:
  //   403 — generic forbidden (used by many sites against bots)
  //   429 — too many requests (rate-limited; real browser would retry)
  //   451 — unavailable for legal reasons
  //   999 — LinkedIn's non-standard "we think you're a bot" code
  if (status === 403 || status === 429 || status === 451 || status === 999) return 'forbidden';
  if (status === 404) return 'broken';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'broken';
  return 'unknown';
}

// Parse srcset attribute value — each candidate is "url descriptor" (e.g.
// "img.png 480w, img@2x.png 1024w"). We only need the URL part of each.
function parseSrcset(srcset) {
  if (!srcset) return [];
  return String(srcset)
    .split(',')
    .map((c) => c.trim().split(/\s+/)[0])
    .filter(Boolean);
}

// Extract every relevant URL from the page HTML using a detached jQuery doc.
// Returns [{ type: 'a'|'img'|'link'|'script'|'media', url, raw, text }, ...] —
// deduplicated by (type, resolved-url) so we never check the same link twice.
//
// Coverage:
//   <a href>, <area href>                   → type 'a'
//   <img src/data-src/data-lazy-src/srcset> → type 'img'
//   <source src/srcset>                     → type 'img' (responsive picture)
//   <link href>                             → type 'link' (CSS / preload / etc.)
//   <script src>                            → type 'script'
//   <video src/poster>, <audio src>         → type 'media'
function extractUrls(html, baseUrl) {
  const $doc = Cypress.$('<div>').html(html || '');
  const items = [];

  const push = (type, url, raw, text) => {
    if (shouldSkipUrl(url)) return;
    const resolved = resolveUrl(url, baseUrl);
    if (!resolved) return;
    items.push({ type, url: resolved, raw: raw || url, text: text || '' });
  };

  // Anchors + image-map areas.
  $doc.find('a, area').each((_, el) => {
    const href = el.getAttribute('href');
    const text =
      String(el.textContent || '').trim().slice(0, 100) ||
      String(el.getAttribute('alt') || '').slice(0, 100) ||
      '(no text)';
    push('a', href, href, text);
  });

  // Images — including common lazy-load attributes used by Gatsby / lozad /
  // similar libraries, and srcset candidates.
  $doc.find('img').each((_, el) => {
    const alt = String(el.getAttribute('alt') || '').slice(0, 100);
    const candidates = [
      el.getAttribute('src'),
      el.getAttribute('data-src'),
      el.getAttribute('data-lazy-src'),
      el.getAttribute('data-original'),
    ];
    for (const c of candidates) {
      if (c) push('img', c, c, alt);
    }
    parseSrcset(el.getAttribute('srcset')).forEach((u) => push('img', u, u, alt));
    parseSrcset(el.getAttribute('data-srcset')).forEach((u) => push('img', u, u, alt));
  });

  // <picture> / responsive <source> tags.
  $doc.find('source').each((_, el) => {
    const src = el.getAttribute('src');
    if (src) push('img', src, src, '');
    parseSrcset(el.getAttribute('srcset')).forEach((u) => push('img', u, u, ''));
  });

  // <link> tags (CSS / preload / dns-prefetch / icon etc).
  // preconnect / dns-prefetch point at an origin, not a fetchable resource
  // (e.g. https://fonts.gstatic.com/ answers 404) — not links.
  $doc.find('link[href]').each((_, el) => {
    const rel = String(el.getAttribute('rel') || '');
    if (/\b(preconnect|dns-prefetch)\b/i.test(rel)) return;
    push('link', el.getAttribute('href'), el.getAttribute('href'), rel);
  });

  // <script src>.
  $doc.find('script[src]').each((_, el) => {
    push('script', el.getAttribute('src'), el.getAttribute('src'), '');
  });

  // Media (video / audio).
  $doc.find('video, audio').each((_, el) => {
    const src = el.getAttribute('src');
    const poster = el.getAttribute('poster');
    if (src) push('media', src, src, el.tagName.toLowerCase());
    if (poster) push('img', poster, poster, 'video poster');
  });

  const seen = new Set();
  return items.filter((it) => {
    const key = it.type + '|' + it.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emptyPageEntry(page, pageUrl) {
  return {
    id: page.id,
    name: page.name,
    url: pageUrl,
    pageStatus: null,
    pageError: '',
    counts: {
      total: 0,
      a: 0,
      img: 0,
      link: 0,
      script: 0,
      media: 0,
      working: 0,
      redirect: 0,
      forbidden: 0,
      broken: 0,
      server_error: 0,
      unreachable: 0,
      unknown: 0,
    },
    broken: [],
  };
}

describe('Broken Link Checker', () => {
  getSelectedPages().forEach((page) => {
    it(`Check ${page.name}`, () => {
      const pageUrl = getPageUrl(page);
      const entry = Object.assign(globalThis.testDetail(), { kind: 'links' }, emptyPageEntry(page, pageUrl));

      cy.task('fetchPageHtml', { url: pageUrl, timeout: 30000 }, { log: false, timeout: 40000 }).then((resp) => {
        entry.pageStatus = resp.status;
        entry.pageError = resp.error || '';
        expect(resp.status, `page ${pageUrl} loads (${resp.error || "HTTP " + resp.status})`).to.be.within(200, 299);

        const items = extractUrls(resp.body, pageUrl);
        entry.counts.total = items.length;
        for (const it of items) entry.counts[it.type]++;
        if (!items.length) return;

        // Worst case: every URL in a worker's share times out twice (probe + one re-probe).
        const taskTimeout = Math.ceil(items.length / CONCURRENCY) * 2 * (URL_TIMEOUT_MS + 2000) + 30000;
        cy.task(
          'checkUrlsBatch',
          { urls: items.map((it) => it.url), concurrency: CONCURRENCY, timeout: URL_TIMEOUT_MS },
          { log: false, timeout: taskTimeout }
        ).then((batch) => {
          batch.forEach((r, i) => {
            const klass = classifyStatus(r.status);
            entry.counts[klass] += 1;
            const result = { ...items[i], status: r.status, klass };
            if (klass === 'redirect' && r.location) result.redirectTo = r.location;
            if (r.error) result.error = r.error;
            if (klass === 'broken' || klass === 'server_error' || klass === 'unreachable') entry.broken.push(result);
          });
          cy.log(`${page.name}: ${entry.counts.total} URLs, ${entry.broken.length} broken`);
          expect(
            entry.broken.map((b) => `${b.status || b.error} ${b.url}`),
            `broken links on ${page.name}`
          ).to.deep.equal([]);
        });
      });
    });
  });
});
