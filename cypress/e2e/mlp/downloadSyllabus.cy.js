/// <reference types="cypress" />
// MLP "Download syllabus": cleanup, fill, OTP, success copy.
import { defineDownloadTest } from '../../support/downloadTest';

defineDownloadTest({
  title: 'Kraftshala MLP — Download syllabus',
  testName: 'Download syllabus with base email and base phone',
  fixture: require('../../fixtures/leads/mlp-download-syllabus.json'),
  cta: /download\s*syllabus/i,
  documentText: 'syllabus',
});
