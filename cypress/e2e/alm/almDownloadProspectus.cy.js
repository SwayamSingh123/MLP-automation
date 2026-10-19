/// <reference types="cypress" />
// ALM "Download prospectus": cleanup, fill, OTP, success copy.
import { defineDownloadTest } from '../../support/downloadTest';

defineDownloadTest({
  title: 'Kraftshala ALM — Download prospectus',
  testName: 'Download prospectus with base email and base phone',
  fixture: require('../../fixtures/leads/alm-download-prospectus.json'),
  cta: /download\s*prospectus/i,
  documentText: 'document',
});
