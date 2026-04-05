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
  },
});

