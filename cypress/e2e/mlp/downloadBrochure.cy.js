/// <reference types="cypress" />
// MLP "Download brochure": cleanup, fill, OTP, success copy.
import { defineDownloadTest } from '../../support/downloadTest';

defineDownloadTest({
  title: 'Kraftshala MLP — Download brochure',
  testName: 'Download brochure with base email and base phone',
  fixture: require('../../fixtures/leads/mlp-download-brochure.json'),
  cta: /download\s*brochure/i,
  documentText: 'document',
});
