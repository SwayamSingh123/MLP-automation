/// <reference types="cypress" />
//
// Kraftshala SEO Checklist — 17 checks across 4 sections (Head / Body / Footer / FAQ).
//
// Data-driven from fixtures/seo/seo-page-data.json. One test per page runs every
// applicable check and records a row per check (pass / fail / warning / skipped)
// in the report. The page's test FAILS if any check fails; warnings (manual
// verification needed) and skipped (not applicable) checks do not fail it.

const pageData = require('../../fixtures/seo/seo-page-data.json');

// Single canonical production domain — used to build expected canonical URLs.
// Per spec: canonical must ALWAYS point to www.kraftshala.com (even when testing).
const PROD_ORIGIN = 'https://www.kraftshala.com';
const INTERNAL_DOMAIN_RE = /^https?:\/\/(?:www\.)?kraftshala\.com\b/i;

// Add a single check result row to the current page's report entry.
function recordCheck(_page, row) {
  globalThis.testDetail().checks.push(row);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isProductionPlatform() {
  const v = String(Cypress.env('platform') || 'test').toLowerCase();
  return v === 'production' || v === 'main';
}

// Builds absolute URL for cy.request (raw HTML) — uses Cypress.config('baseUrl')
// so it follows the same platform switch as cy.visit.
function buildAbsoluteUrl(path) {
  const base = Cypress.config('baseUrl').replace(/\/+$/, '');
  const rel = String(path || '').replace(/^\/?/, '/');
  return base + rel;
}

// Normalizes text for substring comparison — handles HTML entities AND common
// Unicode variants (curly quotes, dashes, NBSP). Used when matching FAQ
// answer snippets against raw server HTML so cosmetic encoding differences
// don't cause false negatives.
function normalizeForCompare(s) {
  return decodeHtmlEntities(s)
    .replace(/[‘’‚‛]/g, "'")  // curly single quotes (U+2018-U+201B) -> straight '
    .replace(/[“”„‟]/g, '"')  // double quotes → straight "
    .replace(/[–—]/g, '-')              // en-dash / em-dash → hyphen
    .replace(/ /g, ' ')                       // non-breaking space → regular space
    .replace(/\s+/g, ' ')                          // collapse whitespace
    .trim();
}

// Diagnostic — finds the first character position where two normalized strings
// differ and reports the codepoints + surrounding context. Surfaced in failure
// details so we can see exactly which character variant the normalizer didn't
// catch (e.g. some uncommon dash or quote glyph still slipping through).
function firstDiffDescription(expected, actual) {
  const e = normalizeForCompare(expected);
  const a = normalizeForCompare(actual);
  if (e === a) return '';
  const len = Math.min(e.length, a.length);
  for (let i = 0; i < len; i++) {
    if (e.charCodeAt(i) !== a.charCodeAt(i)) {
      const eCp = e.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
      const aCp = a.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
      const ctx = e.slice(Math.max(0, i - 12), i + 12);
      return `First diff at pos ${i}: U+${eCp} ('${e[i]}') vs U+${aCp} ('${a[i]}') — context: "...${ctx}..."`;
    }
  }
  if (e.length !== a.length) {
    return `Lengths differ after normalize — expected ${e.length}, got ${a.length}.`;
  }
  return '';
}

// Decode the most common HTML entities so attribute values extracted from raw
// HTML (e.g. <meta content="&amp;quot;…&amp;"…">) compare cleanly against the
// human-readable fixture strings. Also handles numeric entities (&#39; etc.).
function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Recursive diff used by Check 7 (JSON-LD comparison). Walks both objects and
// reports every difference with a dotted path: missing / extra / changed.
function deepDiff(expected, actual, basePath = '') {
  const diffs = [];

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  if (isObject(expected) && isObject(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const k of keys) {
      const p = basePath ? `${basePath}.${k}` : k;
      const e = expected[k];
      const a = actual[k];
      if (!(k in actual)) {
        diffs.push({ kind: 'missing', path: p, expected: e });
      } else if (!(k in expected)) {
        diffs.push({ kind: 'extra', path: p, actual: a });
      } else {
        diffs.push(...deepDiff(e, a, p));
      }
    }
    return diffs;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const len = Math.max(expected.length, actual.length);
    for (let i = 0; i < len; i++) {
      const p = `${basePath}[${i}]`;
      if (i >= actual.length) {
        diffs.push({ kind: 'missing', path: p, expected: expected[i] });
      } else if (i >= expected.length) {
        diffs.push({ kind: 'extra', path: p, actual: actual[i] });
      } else {
        diffs.push(...deepDiff(expected[i], actual[i], p));
      }
    }
    return diffs;
  }

  // String-vs-string leaf comparison: normalize curly quotes / dashes / NBSP
  // / HTML entities first. Search engines treat these as equivalent and CMS
  // tooling often inserts curly variants automatically — diffing on them
  // creates noise, not real SEO findings.
  if (typeof expected === 'string' && typeof actual === 'string') {
    if (normalizeForCompare(expected) !== normalizeForCompare(actual)) {
      diffs.push({ kind: 'changed', path: basePath || '(root)', expected, actual });
    }
    return diffs;
  }

  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    diffs.push({ kind: 'changed', path: basePath || '(root)', expected, actual });
  }
  return diffs;
}

// Identify a JSON-LD block by its @type for matching across expected/actual lists.
function jsonLdTypeKey(node) {
  if (!node || typeof node !== 'object') return '(unknown)';
  const t = node['@type'];
  if (Array.isArray(t)) return t.join('|');
  return String(t || '(no @type)');
}

// ── The spec ───────────────────────────────────────────────────────────────

describe('SEO Checklist', () => {
  for (const page of pageData.pages) {
    describe(page.name, () => {
      it(`Run all SEO checks for ${page.name}`, () => {
        Object.assign(globalThis.testDetail(), { kind: 'seo', page: page.name, path: page.path, checks: [] });
        runHeadChecks(page);
        // Head checks read raw server HTML; the rest need the rendered DOM.
        cy.visit(page.path);
        runBodyChecks(page);
        runFooterChecks(page);
        runFaqChecks(page);
        cy.then(() => {
          const failed = globalThis.testDetail().checks.filter((c) => c.status === 'fail');
          if (failed.length) {
            throw new Error(
              `${failed.length} SEO check(s) failed on ${page.path}:\n` +
                failed.map((c) => `- ${c.name}: ${c.details}`).join('\n')
            );
          }
        });
      });
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// SECTION 1 — HEAD (7 checks)
// ────────────────────────────────────────────────────────────────────────────

function runHeadChecks(page) {
  const absUrl = buildAbsoluteUrl(page.path);

  cy.request({ url: absUrl, followRedirect: true }).then((resp) => {
    const rawHtml = String(resp.body || '');
    const headMatch = rawHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    const headHtml = headMatch ? headMatch[1] : rawHtml;

    // ── CHECK 1: No client-side rendering of head content via API calls.
    // Server-rendered HTML (before JS) must contain robots, canonical, title,
    // description, and JSON-LD. The intercept side of this check happens after
    // cy.visit (below); here we validate the raw-HTML half.
    {
      // Pages that intentionally don't ship JSON-LD (e.g. blog index pages —
      // structured data lives on individual posts, not the listing) can opt
      // out via `jsonLdType: "none"` in the fixture. When set, we skip the
      // jsonld presence check entirely.
      const jsonLdRequired = page.jsonLdType !== 'none';
      const checks = {
        robots: /<meta[^>]+name=["']robots["']/i.test(headHtml),
        canonical: /<link[^>]+rel=["']canonical["']/i.test(headHtml),
        title: /<title[^>]*>[\s\S]*?<\/title>/i.test(headHtml),
        description: /<meta[^>]+name=["']description["']/i.test(headHtml),
      };
      if (jsonLdRequired) {
        // JSON-LD can validly live anywhere in the document — search rawHtml.
        checks.jsonld = /<script[^>]+type=["']application\/ld\+json["']/i.test(rawHtml);
      }
      const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
      recordCheck(page, {
        id: 'head-1',
        section: 'head',
        name: 'Head content in server-rendered HTML (no client-side injection)',
        status: missing.length === 0 ? 'pass' : 'fail',
        details: missing.length === 0
          ? 'All required tags (robots / canonical / title / description / json-ld) present in raw HTML.'
          : `Missing in server HTML: ${missing.join(', ')}`,
      });
    }

    // ── CHECK 2 & 3: Robots meta tag (test vs production).
    {
      const expected = isProductionPlatform()
        ? pageData.robotsContent.production
        : pageData.robotsContent.test;
      const robotsMatch = headHtml.match(/<meta[^>]+name=["']robots["'][^>]*>/i);
      const robotsTag = robotsMatch ? robotsMatch[0] : '';
      const contentMatch = robotsTag.match(/content=["']([^"']*)["']/i);
      const actual = contentMatch ? contentMatch[1] : '';
      const hasHelmetAttr = /data-react-helmet=["']true["']/i.test(robotsTag);

      const valueOk = actual === expected;
      const helmetOk = hasHelmetAttr;
      const status = valueOk && helmetOk ? 'pass' : 'fail';
      recordCheck(page, {
        id: 'head-2',
        section: 'head',
        name: `Robots meta tag (${isProductionPlatform() ? 'production' : 'test'} expected)`,
        status,
        expected,
        actual,
        details: status === 'pass'
          ? 'Robots content matches and tag has data-react-helmet="true".'
          : !robotsTag
            ? 'Robots meta tag not found in head.'
            : !valueOk
              ? `Robots content mismatch. Expected: "${expected}". Got: "${actual}".`
              : 'Robots content matches but data-react-helmet="true" attribute is missing.',
      });
    }

    // ── CHECK 4: No "nosnippet" anywhere in head.
    {
      const has = /nosnippet|no-snippet/i.test(headHtml);
      recordCheck(page, {
        id: 'head-4',
        section: 'head',
        name: 'No "nosnippet" / "no-snippet" anywhere in head',
        status: has ? 'fail' : 'pass',
        details: has
          ? 'Found "nosnippet" or "no-snippet" in the head section.'
          : 'No nosnippet directives present.',
      });
    }

    // ── CHECK 5: Canonical tag with production URL + trailing slash + helmet attr.
    {
      const canonicalMatch = headHtml.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
      const canonicalTag = canonicalMatch ? canonicalMatch[0] : '';
      const hrefMatch = canonicalTag.match(/href=["']([^"']*)["']/i);
      const actualHref = decodeHtmlEntities(hrefMatch ? hrefMatch[1] : '');
      const hasHelmetAttr = /data-react-helmet=["']true["']/i.test(canonicalTag);

      const expectedCanonical = page.canonical;
      const hrefOk = actualHref === expectedCanonical;
      const slashOk = /\/$/.test(actualHref);
      const status = hrefOk && slashOk && hasHelmetAttr ? 'pass' : 'fail';

      const reasons = [];
      if (!canonicalTag) reasons.push('canonical tag not found');
      else {
        if (!hrefOk) reasons.push(`href mismatch (expected "${expectedCanonical}", got "${actualHref}")`);
        if (!slashOk) reasons.push('href missing trailing slash');
        if (!hasHelmetAttr) reasons.push('data-react-helmet="true" attribute missing');
      }
      recordCheck(page, {
        id: 'head-5',
        section: 'head',
        name: 'Canonical link tag (production URL + trailing slash + helmet attr)',
        status,
        expected: expectedCanonical,
        actual: actualHref,
        details: reasons.length ? reasons.join('; ') : 'Canonical link tag valid.',
      });
    }

    // ── CHECK 6: Title + meta description present and match fixture.
    {
      const titleMatch = headHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const actualTitle = decodeHtmlEntities(titleMatch ? titleMatch[1].trim() : '');
      const descMatch = headHtml.match(/<meta[^>]+name=["']description["'][^>]*>/i);
      const descTag = descMatch ? descMatch[0] : '';
      const descContentMatch = descTag.match(/content=["']([^"']*)["']/i);
      const actualDesc = decodeHtmlEntities(descContentMatch ? descContentMatch[1] : '');
      const descHasHelmetAttr = /data-react-helmet=["']true["']/i.test(descTag);

      // Normalize curly quotes / dashes / NBSP on both sides — Search engines
      // treat ’ and ' as equivalent, but strict === fails on the difference.
      const titleOk =
        !!actualTitle && normalizeForCompare(actualTitle) === normalizeForCompare(page.title);
      const descOk =
        !!actualDesc && normalizeForCompare(actualDesc) === normalizeForCompare(page.description);
      const descHelmetOk = descHasHelmetAttr;

      const titleStatus = page.title.startsWith('FILL IN')
        ? 'skipped'
        : titleOk ? 'pass' : 'fail';
      const titleDiag = titleOk ? '' : ' ' + firstDiffDescription(page.title, actualTitle);
      recordCheck(page, {
        id: 'head-6a',
        section: 'head',
        name: 'Meta title matches expected',
        status: titleStatus,
        expected: page.title,
        actual: actualTitle,
        details: titleStatus === 'skipped'
          ? 'Expected title not set in fixture (placeholder "FILL IN..."). Update seo-page-data.json.'
          : titleOk ? 'Title matches.' : `Title mismatch. Expected: "${page.title}". Got: "${actualTitle}".${titleDiag}`,
      });

      const descStatus = page.description.startsWith('FILL IN')
        ? 'skipped'
        : (descOk && descHelmetOk) ? 'pass' : 'fail';
      const descDiag = descOk ? '' : ' ' + firstDiffDescription(page.description, actualDesc);
      recordCheck(page, {
        id: 'head-6b',
        section: 'head',
        name: 'Meta description matches expected + has data-react-helmet',
        status: descStatus,
        expected: page.description,
        actual: actualDesc,
        details: descStatus === 'skipped'
          ? 'Expected description not set in fixture (placeholder "FILL IN..."). Update seo-page-data.json.'
          : !actualDesc ? 'Meta description tag missing.'
          : !descOk ? `Description mismatch. Expected: "${page.description}". Got: "${actualDesc}".${descDiag}`
          : !descHelmetOk ? 'Description content matches but data-react-helmet="true" attribute missing.'
          : 'Description matches and helmet attribute present.',
      });
    }

    // ── CHECK 7: JSON-LD deep comparison against fixture file.
    // Pass full rawHtml — Gatsby/React templates often place JSON-LD inside
    // the page body (e.g. `<div class="main-homepage"><script type="application/ld+json">…`).
    runJsonLdCheck(page, rawHtml);
  });
}

function runJsonLdCheck(page, rawHtml) {
  // Page-level opt-out — set `jsonLdType: "none"` in the fixture for pages
  // that aren't supposed to have JSON-LD (blog index, etc.).
  if (page.jsonLdType === 'none') {
    recordCheck(page, {
      id: 'head-7',
      section: 'head',
      name: 'JSON-LD matches fixture (deep diff)',
      status: 'skipped',
      details: 'Page is flagged jsonLdType: "none" — JSON-LD comparison does not apply.',
    });
    return;
  }

  cy.readFile(`cypress/fixtures/seo/seo-jsonld/${page.jsonLdFixture}`, { log: false })
    .then((expectedArr) => {
      // Diagnostic counters — surfaced in failure details so we can see what
      // the extractor actually found on the page.
      let scriptTagCount = 0;
      let parseFailureCount = 0;
      const actualBlocks = [];
      const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      let m;
      // Browsers HTML-decode <script> content automatically; we have to do
      // it manually because cy.request gives us the raw bytes. Without this,
      // any JSON-LD that contains `&amp;` `&quot;` etc. in the raw HTML will
      // fail JSON.parse (e.g. a name like "AT&T" is encoded as `AT&amp;T`).
      const tryParse = (raw) => {
        try { return JSON.parse(raw); } catch (_) { /* fall through */ }
        try { return JSON.parse(decodeHtmlEntities(raw)); } catch (_) { return undefined; }
      };

      while ((m = scriptRe.exec(rawHtml)) !== null) {
        scriptTagCount += 1;
        const parsed = tryParse(m[1]);
        if (parsed !== undefined) actualBlocks.push(parsed);
        else parseFailureCount += 1;
      }
      // Also try a more permissive selector that allows `type` to be the
      // FIRST attribute on the script tag (`<script type="...">` with no
      // space before `type`).
      if (scriptTagCount === 0) {
        const looseRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let m2;
        while ((m2 = looseRe.exec(rawHtml)) !== null) {
          scriptTagCount += 1;
          const parsed = tryParse(m2[1]);
          if (parsed !== undefined) actualBlocks.push(parsed);
          else parseFailureCount += 1;
        }
      }

      if (!Array.isArray(expectedArr) || expectedArr.length === 0) {
        recordCheck(page, {
          id: 'head-7',
          section: 'head',
          name: 'JSON-LD matches fixture (deep diff)',
          status: 'skipped',
          details: `Fixture cypress/fixtures/seo/seo-jsonld/${page.jsonLdFixture} is empty — populate it with the live JSON-LD to enable this check.`,
        });
        return;
      }

      const expByType = new Map();
      for (const e of expectedArr) {
        const k = jsonLdTypeKey(e);
        if (!expByType.has(k)) expByType.set(k, []);
        expByType.get(k).push(e);
      }
      const actByType = new Map();
      for (const a of actualBlocks) {
        const k = jsonLdTypeKey(a);
        if (!actByType.has(k)) actByType.set(k, []);
        actByType.get(k).push(a);
      }

      const blockDiffs = [];
      const allTypes = new Set([...expByType.keys(), ...actByType.keys()]);
      for (const t of allTypes) {
        const eList = expByType.get(t) || [];
        const aList = actByType.get(t) || [];
        const len = Math.max(eList.length, aList.length);
        for (let i = 0; i < len; i++) {
          const e = eList[i];
          const a = aList[i];
          if (e === undefined) {
            blockDiffs.push({ type: t, index: i, diffs: [{ kind: 'extra', path: '(entire block)', actual: a }] });
          } else if (a === undefined) {
            blockDiffs.push({ type: t, index: i, diffs: [{ kind: 'missing', path: '(entire block)', expected: e }] });
          } else {
            const diffs = deepDiff(e, a);
            if (diffs.length) blockDiffs.push({ type: t, index: i, diffs });
          }
        }
      }

      const pass = blockDiffs.length === 0;
      // Build a diagnostic line listing what we actually found, so failures
      // pinpoint whether the page has zero JSON-LD, has malformed JSON, or
      // simply has different @types than the fixture.
      const foundTypes = Array.from(actByType.keys()).sort().join(', ') || '(none)';
      const diag =
        `Found ${scriptTagCount} <script type="application/ld+json"> tag(s); ` +
        `${actualBlocks.length} parsed successfully` +
        (parseFailureCount > 0 ? `, ${parseFailureCount} failed to parse` : '') +
        `. @types on page: ${foundTypes}.`;
      recordCheck(page, {
        id: 'head-7',
        section: 'head',
        name: 'JSON-LD matches fixture (deep diff)',
        status: pass ? 'pass' : 'fail',
        details: pass
          ? `All ${expectedArr.length} JSON-LD block(s) match fixture.`
          : `${blockDiffs.reduce((s, b) => s + b.diffs.length, 0)} difference(s) across ${blockDiffs.length} block(s). ${diag}`,
        jsonLdDiff: blockDiffs,
      });
    });
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 2 — BODY (5 checks)
// ────────────────────────────────────────────────────────────────────────────

function runBodyChecks(page) {
  // ── CHECK 8: Exactly one H1 tag.
  cy.document().then((doc) => {
    const h1s = doc.querySelectorAll('h1');
    recordCheck(page, {
      id: 'body-8',
      section: 'body',
      name: 'Exactly one <h1> on the page',
      status: h1s.length === 1 ? 'pass' : 'fail',
      expected: 1,
      actual: h1s.length,
      details: h1s.length === 1
        ? 'Exactly one h1 element found.'
        : `Found ${h1s.length} h1 element(s). Expected exactly 1.`,
    });
  });

  // ── CHECK 9: Canvas / image text — WARNING only (Cypress can't read inside images).
  cy.document().then((doc) => {
    const canvases = doc.querySelectorAll('canvas');
    const images = doc.querySelectorAll('img');
    const imagesMissingAlt = [];
    images.forEach((img) => {
      const alt = (img.getAttribute('alt') || '').trim();
      if (!alt) imagesMissingAlt.push(img.getAttribute('src') || '(no src)');
    });

    const issues = [];
    if (canvases.length) issues.push(`${canvases.length} <canvas> element(s) on the page (may contain text — verify manually).`);
    if (imagesMissingAlt.length) issues.push(`${imagesMissingAlt.length} <img> tag(s) without alt text.`);

    recordCheck(page, {
      id: 'body-9',
      section: 'body',
      name: 'Image / canvas text (warning — manual verification needed)',
      status: issues.length ? 'warning' : 'pass',
      details: issues.length ? issues.join(' ') : 'No canvas elements and all images have alt text.',
      images: imagesMissingAlt.slice(0, 20),
    });
  });

  // ── CHECK 10: No hidden text via display:none (except known-hidden UI classes).
  cy.document().then((doc) => {
    const skipClasses = pageData.hiddenElementSkipClasses || [];
    const elementsToCheck = doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, li, div, a, strong, em');
    const offenders = [];
    elementsToCheck.forEach((el) => {
      // Skip if any ancestor matches the skip list.
      let cur = el;
      let skipped = false;
      while (cur && cur !== doc.body) {
        const cls = (cur.className && typeof cur.className === 'string') ? cur.className : '';
        if (skipClasses.some((sc) => cls.toLowerCase().includes(String(sc).toLowerCase()))) {
          skipped = true;
          break;
        }
        cur = cur.parentElement;
      }
      if (skipped) return;
      const text = (el.textContent || '').trim();
      if (!text) return;
      const cs = doc.defaultView.getComputedStyle(el);
      if (cs.display === 'none') {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          className: typeof el.className === 'string' ? el.className : '',
          preview: text.slice(0, 80),
        });
      }
    });

    recordCheck(page, {
      id: 'body-10',
      section: 'body',
      name: 'No hidden text via display:none (excluding intentional UI)',
      status: offenders.length === 0 ? 'pass' : 'fail',
      details: offenders.length === 0
        ? 'No display:none text content found outside the skip list.'
        : `${offenders.length} element(s) with display:none containing text. Add their class names to hiddenElementSkipClasses if intentional.`,
      offenders: offenders.slice(0, 25),
    });
  });

  // ── CHECK 11: Internal links must be dofollow (no rel="nofollow").
  cy.document().then((doc) => {
    const offenders = [];
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const rel = (a.getAttribute('rel') || '').toLowerCase();
      const isInternal = href.startsWith('/') || INTERNAL_DOMAIN_RE.test(href);
      if (!isInternal) return;
      if (/\bnofollow\b/.test(rel)) {
        offenders.push({ href, rel, text: (a.textContent || '').trim().slice(0, 60) });
      }
    });

    recordCheck(page, {
      id: 'body-11',
      section: 'body',
      name: 'Internal links must NOT have rel="nofollow"',
      status: offenders.length === 0 ? 'pass' : 'fail',
      details: offenders.length === 0
        ? 'All internal links are dofollow.'
        : `${offenders.length} internal link(s) marked nofollow.`,
      offenders: offenders.slice(0, 25),
    });
  });

  // ── CHECK 12: External links must be nofollow (skip on blog pages).
  cy.document().then((doc) => {
    const url = String(doc.location?.href || page.path);
    if (/\/blog\b/i.test(url) || /\/blog\b/i.test(page.path)) {
      recordCheck(page, {
        id: 'body-12',
        section: 'body',
        name: 'External links must be nofollow',
        status: 'skipped',
        details: 'Skipped on blog pages (per spec).',
      });
      return;
    }
    const offenders = [];
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const rel = (a.getAttribute('rel') || '').toLowerCase();
      if (href.startsWith('mailto:') || href.startsWith('tel:')) return;
      const isInternal = href.startsWith('/') || INTERNAL_DOMAIN_RE.test(href) || href.startsWith('#');
      if (isInternal) return;
      if (!/^https?:/i.test(href)) return;
      if (!/\bnofollow\b/.test(rel)) {
        offenders.push({ href, rel, text: (a.textContent || '').trim().slice(0, 60) });
      }
    });

    recordCheck(page, {
      id: 'body-12',
      section: 'body',
      name: 'External links must be nofollow',
      status: offenders.length === 0 ? 'pass' : 'fail',
      details: offenders.length === 0
        ? 'All external links carry rel="nofollow".'
        : `${offenders.length} external link(s) missing rel="nofollow".`,
      offenders: offenders.slice(0, 25),
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 3 — FOOTER (2 checks)
// ────────────────────────────────────────────────────────────────────────────

function runFooterChecks(page) {
  if (!page.hasLocationFooter) {
    recordCheck(page, {
      id: 'footer-13',
      section: 'footer',
      name: 'Location footer links present',
      status: 'skipped',
      details: 'Page is not flagged hasLocationFooter — check does not apply.',
    });
    recordCheck(page, {
      id: 'footer-14',
      section: 'footer',
      name: 'Location anchor text + URL pattern',
      status: 'skipped',
      details: 'Page is not flagged hasLocationFooter — check does not apply.',
    });
    return;
  }

  const locations = pageData.locationFooterLinks || [];

  // ── CHECK 13: All required location links present in footer.
  cy.document().then((doc) => {
    const footer = doc.querySelector('footer') || doc.body;
    const links = Array.from(footer.querySelectorAll('a[href]'));
    const missing = [];
    const found = [];
    for (const loc of locations) {
      const expectedText = `Digital Marketing Course in ${loc.city}`;
      const match = links.find((a) =>
        (a.textContent || '').trim() === expectedText &&
        (a.getAttribute('href') || '').toLowerCase().includes(loc.slug.toLowerCase())
      );
      if (match) found.push(loc.city);
      else missing.push(loc.city);
    }
    recordCheck(page, {
      id: 'footer-13',
      section: 'footer',
      name: 'Location footer links present',
      status: missing.length === 0 ? 'pass' : 'fail',
      details: missing.length === 0
        ? `All ${found.length} location links present.`
        : `Missing locations: ${missing.join(', ')}.`,
      foundCities: found,
      missingCities: missing,
    });
  });

  // ── CHECK 14: Anchor text template + URL pattern validation.
  cy.document().then((doc) => {
    const footer = doc.querySelector('footer') || doc.body;
    const offenders = [];
    let checkedCount = 0;
    Array.from(footer.querySelectorAll('a[href]')).forEach((a) => {
      const text = (a.textContent || '').trim();
      const href = a.getAttribute('href') || '';
      if (!/^Digital Marketing Course in\s+\S/i.test(text)) return;
      checkedCount += 1;
      const urlOk = /\/marketing-launchpad\/digital-marketing-course-in-[a-z0-9-]+\/$/i.test(href);
      if (!urlOk) offenders.push({ text, href });
    });
    recordCheck(page, {
      id: 'footer-14',
      section: 'footer',
      name: 'Location anchor text + URL pattern',
      status: offenders.length === 0 ? 'pass' : 'fail',
      details: offenders.length === 0
        ? `All ${checkedCount} location anchors match the URL pattern.`
        : `${offenders.length} location anchor(s) have invalid URL pattern.`,
      offenders,
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 4 — FAQ ACCORDION (3 checks) — only when hasFaq=true
// ────────────────────────────────────────────────────────────────────────────

function runFaqChecks(page) {
  if (!page.hasFaq) {
    for (const id of ['faq-15', 'faq-16', 'faq-17']) {
      recordCheck(page, {
        id,
        section: 'faq',
        name: faqCheckName(id),
        status: 'skipped',
        details: 'Page is not flagged hasFaq — FAQ checks do not apply.',
      });
    }
    return;
  }

  const sel = pageData.faqSelectors || {};
  const containerSel = sel.faqContainer || '.faq';
  const toggleSel = sel.toggleButton || '[aria-expanded]';
  const answerSel = sel.answerPanel || '[aria-labelledby]';

  // ── CHECK 15: ARIA on accordion (no aria-hidden=true; toggles have aria-expanded/role/tabindex).
  cy.document().then((doc) => {
    const container = doc.querySelector(containerSel);
    if (!container) {
      recordCheck(page, {
        id: 'faq-15',
        section: 'faq',
        name: 'FAQ ARIA attributes',
        status: 'fail',
        details: `FAQ container not found with selector "${containerSel}". Update faqSelectors in fixture.`,
      });
      return;
    }
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    const toggles = container.querySelectorAll(toggleSel);
    const badToggles = [];
    toggles.forEach((t) => {
      const role = (t.getAttribute('role') || '').toLowerCase();
      const expanded = t.getAttribute('aria-expanded');
      const tabindex = t.getAttribute('tabindex');
      const isHidden = (t.getAttribute('aria-hidden') || '').toLowerCase() === 'true';
      const issues = [];
      if (role !== 'button' && t.tagName.toLowerCase() !== 'button') issues.push('role!=button');
      if (expanded == null) issues.push('aria-expanded missing');
      if (tabindex !== '0' && t.tagName.toLowerCase() !== 'button') issues.push('tabindex!=0');
      if (isHidden) issues.push('aria-hidden="true" set');
      if (issues.length) badToggles.push({ text: (t.textContent || '').trim().slice(0, 80), issues });
    });
    const ok = hidden.length === 0 && badToggles.length === 0;
    recordCheck(page, {
      id: 'faq-15',
      section: 'faq',
      name: 'FAQ ARIA attributes',
      status: ok ? 'pass' : 'fail',
      details: ok
        ? `${toggles.length} toggle(s) all have valid ARIA. No aria-hidden="true" inside FAQ.`
        : `${hidden.length} element(s) with aria-hidden="true"; ${badToggles.length} toggle(s) missing required ARIA.`,
      badToggles,
    });
  });

  // ── CHECK 16: FAQ answers must be in server HTML (not JS-injected).
  const absUrl = buildAbsoluteUrl(page.path);
  const snippets = (page.faqAnswerSnippets || []).filter((s) => s && !s.startsWith('FILL IN'));
  if (snippets.length === 0) {
    recordCheck(page, {
      id: 'faq-16',
      section: 'faq',
      name: 'FAQ answers present in server-rendered HTML',
      status: 'skipped',
      details: 'No faqAnswerSnippets configured (or all still "FILL IN..."). Update seo-page-data.json with real answer snippets.',
    });
  } else {
    cy.request({ url: absUrl, followRedirect: true }).then((resp) => {
      const rawHtml = String(resp.body || '');
      // Normalize both sides — decode HTML entities, fold curly quotes and
      // dashes to their ASCII equivalents, collapse whitespace. Stops
      // cosmetic-only differences (e.g. '’' vs "'", `&#8377;` vs '₹')
      // from being reported as missing.
      const normalizedHtml = normalizeForCompare(rawHtml);
      const missing = snippets.filter(
        (s) => !normalizedHtml.includes(normalizeForCompare(s))
      );
      recordCheck(page, {
        id: 'faq-16',
        section: 'faq',
        name: 'FAQ answers present in server-rendered HTML',
        status: missing.length === 0 ? 'pass' : 'fail',
        details: missing.length === 0
          ? `All ${snippets.length} FAQ answer snippet(s) found in raw HTML.`
          : `${missing.length} FAQ answer(s) not found in raw HTML — likely injected by JS.`,
        missingSnippets: missing,
      });
    });
  }

  // ── CHECK 17: Collapsed FAQ panels must NOT use display:none or visibility:hidden.
  cy.document().then((doc) => {
    const container = doc.querySelector(containerSel);
    if (!container) {
      recordCheck(page, {
        id: 'faq-17',
        section: 'faq',
        name: 'Collapsed FAQ panels use crawlable hiding (max-height:0, not display:none)',
        status: 'fail',
        details: `FAQ container not found with selector "${containerSel}". Update faqSelectors in fixture.`,
      });
      return;
    }
    const panels = container.querySelectorAll(answerSel);
    if (panels.length === 0) {
      recordCheck(page, {
        id: 'faq-17',
        section: 'faq',
        name: 'Collapsed FAQ panels use crawlable hiding (max-height:0, not display:none)',
        status: 'warning',
        details: `No FAQ answer panels matched selector "${answerSel}". Update faqSelectors in fixture.`,
      });
      return;
    }
    const offenders = [];
    panels.forEach((p, i) => {
      const cs = doc.defaultView.getComputedStyle(p);
      const issues = [];
      if (cs.display === 'none') issues.push('display:none');
      if (cs.visibility === 'hidden') issues.push('visibility:hidden');
      if (issues.length) offenders.push({ index: i, issues, snippet: (p.textContent || '').trim().slice(0, 80) });
    });
    recordCheck(page, {
      id: 'faq-17',
      section: 'faq',
      name: 'Collapsed FAQ panels use crawlable hiding (max-height:0, not display:none)',
      status: offenders.length === 0 ? 'pass' : 'fail',
      details: offenders.length === 0
        ? `All ${panels.length} FAQ panel(s) use crawlable hiding (no display:none / visibility:hidden).`
        : `${offenders.length} FAQ panel(s) use SEO-hostile hiding. Use max-height:0 with overflow:hidden instead.`,
      offenders,
    });
  });
}

function faqCheckName(id) {
  switch (id) {
    case 'faq-15': return 'FAQ ARIA attributes';
    case 'faq-16': return 'FAQ answers present in server-rendered HTML';
    case 'faq-17': return 'Collapsed FAQ panels use crawlable hiding';
    default: return id;
  }
}
