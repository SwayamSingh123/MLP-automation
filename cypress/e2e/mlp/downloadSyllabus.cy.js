/// <reference types="cypress" />
//
// Kraftshala MLP — "Download syllabus" sanity flow.
// Single happy-path check: fill the form with base email + base phone,
// submit OTP, and verify the in-modal success message.
// Success copy: "You're all set. We've sent the syllabus to your email and WhatsApp."

const testData = require('../../fixtures/mlp/mlpTestData.json');

describe('Kraftshala MLP — Download syllabus', () => {
  beforeEach(() => {
    cy.visitMlpPage();
  });

  it('Download syllabus with base email and base phone', () => {
    cy.openDownloadSyllabusForm();
    cy.fillDownloadForm({
      name: testData.name,
      email: testData.existingEmail,
      phone: testData.existingPhone,
      whatsappOptIn: true,
    });
    cy.waitForDownloadOtpStage();
    cy.enterOtpAndSubmit(testData.otp);
    cy.assertSyllabusDownloadSuccess();
  });
});
