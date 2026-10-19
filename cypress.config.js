const fs = require('fs');
const path = require('path');
const { defineConfig } = require('cypress');
const { PLATFORMS } = require('./shared/suites');
const { maskDeep, maskName, maskText } = require('./shared/mask');
const { collectResults } = require('./reporter/collect');
const { buildSite } = require('./reporter/buildSite');

const REPORTS_DIR = path.join(__dirname, 'cypress', 'reports');
const LINK_CHECK_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; KraftshalaLinkChecker/1.0)',
};

/** Fetch that never throws: resolves { status, location, body, finalUrl, error }. */
async function safeFetch(url, { timeout, redirect, readBody }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { signal: controller.signal, redirect, headers: LINK_CHECK_HEADERS });
    return {
      status: resp.status,
      location: resp.headers.get('location') || '',
      body: readBody ? await resp.text() : '',
      finalUrl: resp.url || url,
      error: '',
    };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return { status: 0, location: '', body: '', finalUrl: url, error: msg.includes('abort') ? 'timeout' : msg };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = defineConfig({
  e2e: {
    specPattern: 'cypress/e2e/**/*.cy.js',
    viewportWidth: 1366,
    viewportHeight: 768,
    defaultCommandTimeout: 15000,
    // Sticky navbars cover elements scrolled to the top edge; centring keeps them clickable without force.
    scrollBehavior: 'center',
    pageLoadTimeout: 120000,
    video: false,
    screenshotOnRunFailure: true,
    trashAssetsBeforeRuns: true,
    // No retries: the report must show what actually happened on the first attempt.
    retries: 0,

    setupNodeEvents(on, config) {
      const name = String(config.env.platform || 'test').toLowerCase();
      const platform = PLATFORMS[name];
      if (!platform) {
        throw new Error(`Unknown platform "${name}". Use one of: ${Object.keys(PLATFORMS).join(', ')}`);
      }
      config.baseUrl = platform.site;
      config.env.platform = name;
      config.env.apiBase = platform.api;
      // Lead emails / phones are shown in full by default. Set MASK_LEADS=true (or
      // --env maskLeads=true) when the report is published somewhere public.
      const maskLeads = String(process.env.MASK_LEADS || config.env.maskLeads || 'false').toLowerCase() === 'true';
      console.log(`\nPlatform: ${platform.label}\n  site ${platform.site}\n  api  ${platform.api}\n`);

      // Per-test details (lead, cleanup, API checks, SEO rows, link results)
      // reported by the specs, keyed by "<spec>::<title path>".
      const details = {};
      const startedAt = new Date();

      on('before:run', () => {
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
        fs.rmSync(path.join(REPORTS_DIR, `results-${name}.json`), { force: true });
      });

      on('task', {
        recordTestDetail({ key, detail }) {
          if (!maskLeads) {
            details[key] = detail;
            return null;
          }
          const masked = maskDeep(detail);
          if (masked.lead && masked.lead.name) masked.lead.name = maskName(masked.lead.name);
          details[key] = masked;
          return null;
        },
        log(message) {
          console.log(maskLeads ? maskText(message) : message);
          return null;
        },
        // Broken link checker: page HTML with redirects followed.
        fetchPageHtml({ url, timeout = 30000 }) {
          return safeFetch(url, { timeout, redirect: 'follow', readBody: true });
        },
        // Broken link checker: probes many URLs through a small worker pool.
        async checkUrlsBatch({ urls, concurrency = 10, timeout = 10000 }) {
          const list = Array.isArray(urls) ? urls : [];
          const results = new Array(list.length);
          let cursor = 0;
          const worker = async () => {
            while (cursor < list.length) {
              const i = cursor++;
              const probe = () => safeFetch(list[i], { timeout, redirect: 'manual', readBody: false });
              let result = await probe();
              // One network hiccup is not a broken link: re-probe anything that did not answer.
              if (result.status === 0) result = { ...(await probe()), retried: true };
              results[i] = result;
            }
          };
          await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
          return results;
        },
      });

      on('before:browser:launch', (browser = {}, launchOptions) => {
        if (browser.family === 'chromium' && browser.name !== 'electron') {
          launchOptions.args.push('--disable-dev-shm-usage');
        }
        return launchOptions;
      });

      on('after:run', (runResults) => {
        if (!runResults || !runResults.runs) return;
        const results = collectResults({
          runResults,
          details,
          platformId: name,
          platform,
          startedAt,
          endedAt: new Date(),
          maskLeads,
        });
        const resultsFile = path.join(REPORTS_DIR, `results-${name}.json`);
        fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2), 'utf8');

        // Local preview of the published site: cypress/reports/site/<platform>/index.html
        const siteDir = path.join(REPORTS_DIR, 'site');
        buildSite({ siteDir, platformId: name, results });
        const t = results.totals;
        console.log(
          `\nResults: ${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped of ${t.tests}` +
            `\nReport:  ${path.join(siteDir, name, 'index.html')}\n`
        );
      });

      return config;
    },
  },
});
