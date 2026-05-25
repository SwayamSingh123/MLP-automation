/// <reference types="cypress" />
//
// Kraftshala SMBL — lead form sanity tests.
// Page: /pgp/learn-sales-and-marketing/
//
// Structure mirrors cypress/e2e/mlp/mlpLeadForm.cy.js exactly — same test
// names, same fixture shape, same shared commands — so form-server's
// existing parsers (isUrlSuccessCase / registrationExpectationFromName /
// leadDetailsFromName) recognise every test and the dashboard renders the
// same rich PASS / FAIL rows + LEAD info + API chips as MLP.
//
// Only difference from MLP: success URL pattern.
//   MLP success URL:  .../marketing-launchpad/digital-marketing-course/screening-test/{id}/{id}/
//   SMBL success URL: .../pgp/learn-sales-and-marketing/thank-you/?id={uuid}/

const testData = require('../../fixtures/smbl/smblTestData.json');

const SMBL_SUCCESS_URL_PATH = '/pgp/learn-sales-and-marketing/thank-you/';

describe('Kraftshala SMBL lead form', () => {
  const assertPositiveFlowOutcome = () => {
    cy.url({ timeout: 90000 }).should('include', SMBL_SUCCESS_URL_PATH);
  };

  const submitLeadAndVerifySuccess = ({ email, phone }) => {
    cy.fillLeadForm({
      name: testData.name,
      email,
      phone,
      whatsappOptIn: true,
    });
    cy.enterOtpAndSubmit(testData.otp);
    assertPositiveFlowOutcome();
  };

  beforeEach(() => {
    // Suppress page-side uncaught errors. The SMBL thank-you page fires GTM /
    // Meta Pixel / analytics on hydration, and any of those throwing inside
    // the AUT iframe is reported by Cypress as an "after each" hook failure
    // even when the URL assertion already passed. Scoped to this spec only —
    // does not affect MLP / ALM / Callback / KS Live / SEO.
    Cypress.on('uncaught:exception', () => false);

    cy.visit('/pgp/learn-sales-and-marketing/', { failOnStatusCode: false });
    cy.selectPlatformIfPresent();
  });

  it('New registration with base email and base phone', () => {
    submitLeadAndVerifySuccess({
      email: testData.existingEmail,
      phone: testData.existingPhone,
    });
  });

  it('Existing registration with base email and base phone', () => {
    submitLeadAndVerifySuccess({
      email: testData.existingEmail,
      phone: testData.existingPhone,
    });
  });

  it('Base email with different phone number should be blocked', () => {
    cy.intercept('POST', /otp-validation[^?]*(?:validate|verify)/i).as(
      'otpValidateBlocked'
    );
    cy.fillLeadForm({
      name: testData.name,
      email: testData.sameEmailDifferentPhone.email,
      phone: testData.sameEmailDifferentPhone.phone,
      whatsappOptIn: true,
    });
    cy.assertSameEmailDifferentPhoneBlockedFlow(testData.otp, {
      denyUrlPattern: /\/pgp\/learn-sales-and-marketing\/thank-you\//i,
      includeUrl: '/pgp/learn-sales-and-marketing/',
      requireOtp: true,
      blockedMessagePattern:
        /phone number associated with[\s\S]*?try using this phone number/i,
    });
    cy.url().should('not.include', SMBL_SUCCESS_URL_PATH);
  });

  it('Base phone number with different email', () => {
    submitLeadAndVerifySuccess({
      email: testData.samePhoneDifferentEmail.email,
      phone: testData.samePhoneDifferentEmail.phone,
    });
  });

  it('Invalid email should show error and not open OTP', () => {
    cy.fillLeadForm({
      name: testData.name,
      email: testData.invalidEmails[0],
      phone: testData.existingPhone,
      whatsappOptIn: true,
    });
    cy.assertOtpStageNotOpened();
    cy.url().should('not.include', SMBL_SUCCESS_URL_PATH);
  });

  it('Invalid phone should show error and not open OTP', () => {
    cy.fillLeadForm({
      name: testData.name,
      email: testData.existingEmail,
      phone: testData.invalidPhones[1],
      whatsappOptIn: true,
    });
    cy.assertOtpStageNotOpened();
    cy.url().should('not.include', SMBL_SUCCESS_URL_PATH);
  });

  it('Submitting empty form should show required field errors', () => {
    cy.submitLeadForm();
    cy.assertOtpStageNotOpened();
    cy.url().should('not.include', SMBL_SUCCESS_URL_PATH);
    cy.get('body', { timeout: 10000 })
      .invoke('text')
      .then((text) => {
        const bodyText = String(text || '');
        expect(
          /Please enter valid email ID here|Number must be 10 digits|required|please fill|enter your/i.test(
            bodyText
          )
        ).to.equal(true);
      });
  });
});
