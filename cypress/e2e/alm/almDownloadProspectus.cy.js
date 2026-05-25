/// <reference types="cypress" />
//
// Kraftshala ALM — "Download prospectus" sanity flow.
// Single happy-path check: open the prospectus form, fill base email + base phone,
// submit OTP, and verify the in-modal success message.
// Success copy (user-confirmed): "You're all set. We've sent the document to your email and WhatsApp."

const testData = require('../../fixtures/alm/almTestData.json');

describe('Kraftshala ALM — Download prospectus', () => {
  beforeEach(() => {
    cy.visitAlmPage();
  });

  it('Download prospectus with base email and base phone', () => {
    cy.openDownloadProspectusForm();
    cy.fillDownloadForm({
      name: testData.name,
      email: testData.existingEmail,
      phone: testData.existingPhone,
      whatsappOptIn: true,
    });
    cy.waitForDownloadOtpStage();
    cy.enterOtpAndSubmit(testData.otp);
    cy.assertProspectusDownloadSuccess();
  });
});
