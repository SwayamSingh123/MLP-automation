const { defineConfig } = require('cypress');

const MAIN_PLATFORM_BASE_URL = 'https://program.kraftshala.com/';
const TEST_PLATFORM_BASE_URL = 'https://testprogram.kraftshala.com/';

const selectedPlatform = String(process.env.MLP_PLATFORM || 'test').toLowerCase();
const resolvedBaseUrl =
  selectedPlatform === 'main'
    ? MAIN_PLATFORM_BASE_URL
    : TEST_PLATFORM_BASE_URL;

module.exports = defineConfig({
  e2e: {
    baseUrl: resolvedBaseUrl,
    specPattern: 'cypress/e2e/**/*.cy.js',
    viewportWidth: 1366,
    viewportHeight: 768,
    setupNodeEvents(on, config) {
      on('before:browser:launch', (browser = {}, launchOptions) => {
        if (browser.family === 'chromium') {
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

