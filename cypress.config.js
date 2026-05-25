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

      return config;
    },
  },
});
