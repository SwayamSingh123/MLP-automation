/// <reference types="cypress" />
//
// Broken Link Checker — crawls a configurable set of Kraftshala pages,
// extracts every <a> / <img> / <link> / <script> URL from the page HTML,
// and probes each one via a Node-side task (cy.task('checkUrlSafely')).
//
// Why a task instead of cy.request?
//   cy.request retries on network failure and throws on timeout, which would
//   make this spec hang or fail for any slow/unreachable external link.
//   The Node task handles AbortController-driven timeouts gracefully, never
//   throws, and reports status=0 for unreachable URLs — exactly what we need.
//
// Output: cypress/reports/broken-links-results.json — picked up by
// form-server.js readBrokenLinksResults() and rendered in the dashboard.
//
// Page selection: by default crawls all PAGES below. To restrict, set the
// Cypress env var `linksPages` to a comma-separated list of page IDs, e.g.
//   --env platform=test,linksPages=home,about,mlp

const TEST_ORIGIN = 'https://testprogram.kraftshala.com';
const PROD_ORIGIN = 'https://program.kraftshala.com';

// Each entry: id (used by the dashboard's checkbox state), name (display),
// and either a `path` (resolves against test/prod base) or an absolute `url`
// (used for cross-origin pages like placement-reports / reviews).
const PAGES = [
  { id: 'home',              name: 'Homepage',                        path: '/' },
  { id: 'about',             name: 'About Us',                        path: '/about/' },
  { id: 'blog',              name: 'Blog',                            path: '/blog/' },
  { id: 'mlp',               name: 'MLP Digital Marketing Course',    path: '/marketing-launchpad/digital-marketing-course/' },
  { id: 'mlp-pt',            name: 'MLP Part-Time Digital Marketing', path: '/marketing-launchpad/part-time-digital-marketing-course/' },
  { id: 'mlp-hindi',         name: 'MLP Digital Marketing in Hindi',  path: '/marketing-launchpad/digital-marketing-course-in-hindi/' },
  { id: 'alm',               name: 'PGP in Marketing',                path: '/pgp-in-marketing/' },
  { id: 'smbl',              name: 'BASL Sales and Marketing',        path: '/pgp/learn-sales-and-marketing/' },
  { id: 'glossary',          name: 'Marketing Glossary',              path: '/marketing-glossary/' },
  { id: 'press',             name: 'Press Releases',                  path: '/press-releases/' },
  { id: 'hire',              name: 'Hire Digital Marketers',          path: '/hire-digital-marketers/' },
  { id: 'placement-reports', name: 'Placement Reports',               url: 'https://placement-reports.kraftshala.com/' },
  { id: 'reviews',           name: 'Reviews',                         url: 'https://reviews.kraftshala.com/' },
];

const RESULTS_FILE = 'cypress/reports/broken-links-results.json';
const URL_TIMEOUT_MS = 10000;

// Module-level accumulator — Cypress loads the spec once per run, so all
// `it` blocks share this array. Flushed in the after() hook.
const allResults = [];

function isPlatformMain() {
  const p = String(Cypress.env('platform') || 'test').toLowerCase();
  return p === 'main' || p === 'prod' || p === 'production';
}

function getPageUrl(page) {
  if (page.url) return page.url;
  return (isPlatformMain() ? PROD_ORIGIN : TEST_ORIGIN) + page.path;
}

function getSelectedPages() {
  const selected = Cypress.env('linksPages');
  if (!selected) return PAGES;
  // Accept both | and , as separators. form-server pipe-encodes its list
  // because Cypress's --env flag uses comma for key=value separation, but a
  // manual --env linksPages=home,about would still be parsed correctly here.
  const ids = String(selected).split(/[,|]/).map((s) => s.trim()).filter(Boolean);
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
  $doc.find('link[href]').each((_, el) => {
    push('link', el.getAttribute('href'), el.getAttribute('href'), String(el.getAttribute('rel') || ''));
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
    items: [],
    broken: [],
  };
}

describe('Broken Link Checker', () => {
  before(() => {
    // Clear the results file at run start so stale data doesn't bleed in.
    cy.writeFile(RESULTS_FILE, [], { log: false });
  });

  after(() => {
    // Flush the per-page entries we accumulated across all it() blocks.
    cy.writeFile(RESULTS_FILE, allResults, { log: false });
  });

  const pagesToCheck = getSelectedPages();

  pagesToCheck.forEach((page) => {
    it(`Check ${page.name}`, () => {
      const pageUrl = getPageUrl(page);
      const entry = emptyPageEntry(page, pageUrl);
      allResults.push(entry);

      cy.task('fetchPageHtmlSafely', { url: pageUrl, timeout: 30000 }, { log: false })
        .then((resp) => {
          entry.pageStatus = resp.status;
          entry.pageError = resp.error || '';

          if (!resp.status || resp.status >= 400 || !resp.body) {
            // Couldn't fetch the page — mark it and stop. Don't fail Cypress
            // entirely so other pages still run.
            cy.log(
              'Could not load page ' +
                pageUrl +
                ' — status=' +
                resp.status +
                (resp.error ? ' err=' + resp.error : '')
            );
            return;
          }

          const items = extractUrls(resp.body, pageUrl);
          entry.counts.total = items.length;
          for (const it of items) entry.counts[it.type]++;

          if (items.length === 0) {
            cy.log(`${page.name}: 0 URLs to check`);
            return;
          }

          // Parallel batch probe — one cy.task call dispatches all URLs to
          // Node, which fans them out across a worker pool (concurrency=10
          // by default) using Promise.all. With ~85 URLs per page and
          // ~300ms average per request, this drops per-page time from ~25s
          // sequential to ~3s parallel. Worker-pool ensures we don't open
          // 85 sockets at once.
          cy.task(
            'checkUrlsBatchSafely',
            {
              urls: items.map((it) => it.url),
              concurrency: 10,
              timeout: URL_TIMEOUT_MS,
            },
            { log: false, timeout: 120000 }
          ).then((batchResults) => {
            (batchResults || []).forEach((r, i) => {
              const item = items[i];
              const status = Number((r && r.status) || 0);
              const klass = classifyStatus(status);
              entry.counts[klass] = (entry.counts[klass] || 0) + 1;
              const result = {
                type: item.type,
                url: item.url,
                raw: item.raw,
                text: item.text,
                status,
                klass,
              };
              if (klass === 'redirect' && r && r.redirectTo) {
                result.redirectTo = r.redirectTo;
              }
              if (r && r.error) result.error = r.error;
              entry.items.push(result);
              if (
                klass === 'broken' ||
                klass === 'server_error' ||
                klass === 'unreachable'
              ) {
                entry.broken.push(result);
              }
            });
            cy.log(
              `${page.name}: ${entry.counts.total} URLs checked — ` +
                `${entry.counts.working} OK / ${entry.counts.redirect} redirect / ` +
                `${entry.counts.broken + entry.counts.server_error + entry.counts.unreachable} broken`
            );
          });
        });
    });
  });
});
