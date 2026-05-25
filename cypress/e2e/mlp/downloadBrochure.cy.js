/// <reference types="cypress" />
//
// Kraftshala MLP — "Download brochure" sanity flow.
// Single happy-path check: fill the form with base email + base phone,
// submit OTP, and verify the in-modal success message.
// Success copy: "You're all set. We've sent the document to your email and WhatsApp."

const testData = require('../../fixtures/mlp/mlpTestData.json');

describe('Kraftshala MLP — Download brochure', () => {
  beforeEach(() => {
    cy.visitMlpPage();
  });

  it('Download brochure with base email and base phone', () => {
    cy.openDownloadBrochureForm();
    cy.fillDownloadForm({
      name: testData.name,
      email: testData.existingEmail,
      phone: testData.existingPhone,
      whatsappOptIn: true,
    });
    cy.waitForDownloadOtpStage();
    cy.enterOtpAndSubmit(testData.otp);
    cy.assertBrochureDownloadSuccess();
  });
});
