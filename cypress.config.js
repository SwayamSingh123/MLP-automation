const { defineConfig } = require('cypress');
const fs = require('fs');
const path = require('path');

const MAIN_PLATFORM_BASE_URL = 'https://program.kraftshala.com/';
const TEST_PLATFORM_BASE_URL = 'https://testprogram.kraftshala.com/';

const selectedPlatform = String(process.env.MLP_PLATFORM || 'test').toLowerCase();
const resolvedBaseUrl =
  selectedPlatform === 'main'
    ? MAIN_PLATFORM_BASE_URL
    : TEST_PLATFORM_BASE_URL;

const REPORTS_DIR = path.resolve(__dirname, 'cypress', 'reports');
const API_DATA_FILE = path.join(REPORTS_DIR, 'api-monitor-data.json');
const PIXEL_DATA_FILE = path.join(REPORTS_DIR, 'pixel-monitor-data.json');
const PIXEL_FLAG_FILE = path.join(REPORTS_DIR, 'pixel-claimed.flag');
const LINKS_SELECTED_PAGES_FILE = path.join(REPORTS_DIR, 'links-selected-pages.json');

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function readJsonFile(file) {
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_err) {
    return [];
  }
}

function writeJsonFile(file, data) {
  ensureReportsDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function readApiData() {
  return readJsonFile(API_DATA_FILE);
}

function writeApiData(data) {
  writeJsonFile(API_DATA_FILE, data);
}

function readPixelData() {
  return readJsonFile(PIXEL_DATA_FILE);
}

function writePixelData(data) {
  writeJsonFile(PIXEL_DATA_FILE, data);
}

module.exports = defineConfig({
  e2e: {
    baseUrl: resolvedBaseUrl,
    specPattern: 'cypress/e2e/**/*.cy.js',
    viewportWidth: 1366,
    viewportHeight: 768,
    setupNodeEvents(on, config) {
      // Fresh API + pixel capture data at the start of every run.
      on('before:run', () => {
        ensureReportsDir();
        writeApiData([]);
        writePixelData([]);
        if (fs.existsSync(PIXEL_FLAG_FILE)) {
          try { fs.unlinkSync(PIXEL_FLAG_FILE); } catch (_err) { /* noop */ }
        }
      });

      on('task', {
        // Broken Link Checker — issues an HTTP request from Node (no CORS,
        // no Cypress retries) and returns the status code + redirect target.
        // Used by cypress/e2e/links/brokenLinkChecker.cy.js. Returns
        // { status, redirectTo, error } — never throws, always resolves.
        async checkUrlSafely({ url, timeout = 10000, method = 'GET' }) {
          if (typeof fetch !== 'function') {
            return { status: 0, redirectTo: '', error: 'global fetch unavailable' };
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);
          try {
            const resp = await fetch(url, {
              method,
              signal: controller.signal,
              redirect: 'manual',
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (compatible; KraftshalaLinkChecker/1.0)',
                Accept: '*/*',
              },
            });
            const redirectTo = resp.headers.get('location') || '';
            return { status: resp.status, redirectTo, error: '' };
          } catch (e) {
            const msg = String((e && e.message) || e || '');
            return {
              status: 0,
              redirectTo: '',
              error: msg.includes('aborted') ? 'timeout' : msg,
            };
          } finally {
            clearTimeout(timer);
          }
        },
        // Parallel batch variant — used by the broken-link spec to probe an
        // entire page's URLs in one task call. Worker-pool pattern: at most
        // `concurrency` requests in flight at any time. Cypress command-queue
        // doesn't allow parallel cy.* commands, but a single task call can
        // run as many concurrent fetches as we like internally — that's
        // where the speedup comes from (10x for the default concurrency=10).
        async checkUrlsBatchSafely({ urls, concurrency = 10, timeout = 10000 }) {
          if (typeof fetch !== 'function') {
            return (urls || []).map(() => ({
              status: 0, redirectTo: '', error: 'global fetch unavailable',
            }));
          }
          const list = Array.isArray(urls) ? urls : [];
          const results = new Array(list.length);
          let cursor = 0;
          const probe = async (url) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);
            try {
              const resp = await fetch(url, {
                signal: controller.signal,
                redirect: 'manual',
                headers: {
                  'User-Agent':
                    'Mozilla/5.0 (compatible; KraftshalaLinkChecker/1.0)',
                  Accept: '*/*',
                },
              });
              return {
                status: resp.status,
                redirectTo: resp.headers.get('location') || '',
                error: '',
              };
            } catch (e) {
              const msg = String((e && e.message) || e || '');
              return {
                status: 0,
                redirectTo: '',
                error: msg.includes('aborted') ? 'timeout' : msg,
              };
            } finally {
              clearTimeout(timer);
            }
          };
          const worker = async () => {
            while (true) {
              const i = cursor++;
              if (i >= list.length) return;
              results[i] = await probe(list[i]);
            }
          };
          const workerCount = Math.max(
            1,
            Math.min(Number(concurrency) || 10, list.length)
          );
          await Promise.all(
            Array.from({ length: workerCount }, () => worker())
          );
          return results;
        },
        // Fetch a page's HTML body (with redirects followed) so the spec can
        // parse <a> / <img> / <link> / <script> tags out of it. Returns
        // { status, body, finalUrl, error }.
        async fetchPageHtmlSafely({ url, timeout = 30000 }) {
          if (typeof fetch !== 'function') {
            return { status: 0, body: '', finalUrl: url, error: 'global fetch unavailable' };
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);
          try {
            const resp = await fetch(url, {
              signal: controller.signal,
              redirect: 'follow',
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (compatible; KraftshalaLinkChecker/1.0)',
                Accept: 'text/html,application/xhtml+xml',
              },
            });
            const body = await resp.text();
            return {
              status: resp.status,
              body,
              finalUrl: resp.url || url,
              error: '',
            };
          } catch (e) {
            const msg = String((e && e.message) || e || '');
            return {
              status: 0,
              body: '',
              finalUrl: url,
              error: msg.includes('aborted') ? 'timeout' : msg,
            };
          } finally {
            clearTimeout(timer);
          }
        },
        apiMonitorAppend(entry) {
          const data = readApiData();
          data.push(entry);
          writeApiData(data);
          return null;
        },
        apiMonitorReset() {
          writeApiData([]);
          return null;
        },
        // Pixel monitor: returns true exactly once per run — the first test that
        // claims it captures Meta Pixel events; subsequent tests skip capture.
        pixelClaimFirstSlot() {
          ensureReportsDir();
          if (fs.existsSync(PIXEL_FLAG_FILE)) return false;
          fs.writeFileSync(PIXEL_FLAG_FILE, String(Date.now()), 'utf8');
          return true;
        },
        pixelMonitorAppend(entry) {
          const data = readPixelData();
          data.push(entry);
          writePixelData(data);
          return null;
        },
        pixelMonitorReset() {
          writePixelData([]);
          if (fs.existsSync(PIXEL_FLAG_FILE)) {
            try { fs.unlinkSync(PIXEL_FLAG_FILE); } catch (_err) { /* noop */ }
          }
          return null;
        },
      });

      on('before:browser:launch', (browser = {}, launchOptions) => {
        if (browser.family === 'chromium' && browser.name !== 'electron') {
          // Required on constrained Linux hosts (e.g. Render) so browser boots reliably.
          launchOptions.args.push('--no-sandbox');
          launchOptions.args.push('--disable-dev-shm-usage');
          launchOptions.args.push('--disable-gpu');
          launchOptions.args.push('--disable-software-rasterizer');
        }
        return launchOptions;
      });

      // Broken Link Checker — picks up its selected-page list from a config
      // file written by form-server. Reading it here (in Node, before specs
      // load) lets us inject it as a Cypress.env value the spec can read
      // synchronously. Avoids the shell-escaping landmines of passing a
      // comma- or pipe-separated list through --env on Windows.
      try {
        if (fs.existsSync(LINKS_SELECTED_PAGES_FILE)) {
          const raw = fs.readFileSync(LINKS_SELECTED_PAGES_FILE, 'utf8');
          const cfg = JSON.parse(raw);
          if (cfg && Array.isArray(cfg.pages) && cfg.pages.length > 0) {
            config.env = config.env || {};
            config.env.linksPages = cfg.pages.join(',');
          }
        }
      } catch (_err) {
        // Stale or malformed config file — fall back to crawling all pages.
      }

      return config;
    },
  },
});
