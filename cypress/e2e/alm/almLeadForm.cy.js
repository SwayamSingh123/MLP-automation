/// <reference types="cypress" />
//
// Kraftshala ALM (AI-Led Marketing) — lead form sanity tests.
// (Product URL is /pgp-in-marketing/ — kept as-is — but internally the page
//  is referred to as ALM.)
// Mirrors the 7 MLP edge cases. Reuses MLP form-fill / OTP / blocked-flow
// commands; only the page URL, success-URL pattern, and blocked-message
// detection differ.

const testData = require('../../fixtures/alm/almTestData.json');

const ALM_SUCCESS_URL_PATTERN =
  /\/pgp-in-marketing\/screening-test\/[^/]+\/[^/]+\/?$/;
const ALM_DENY_URL_PATTERN = /\/pgp-in-marketing\/screening-test\//;

describe('Kraftshala ALM lead form', () => {
  const submitLeadAndVerifySuccess = ({ email, phone }) => {
    cy.fillLeadForm({
      name: testData.name,
      email,
      phone,
      whatsappOptIn: true,
    });
    cy.enterOtpAndSubmit(testData.otp);
    cy.assertLeadRegistrationSuccess(testData.name, {
      successUrlPattern: ALM_SUCCESS_URL_PATTERN,
      // ALM success page may not have the same on-demand header as MLP.
      requireOnDemandHeader: false,
    });
  };

  beforeEach(() => {
    cy.visitAlmPage();
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
      denyUrlPattern: ALM_DENY_URL_PATTERN,
      includeUrl: '/pgp-in-marketing/',
      // ALM always renders OTP step before blocking — force the OTP path so
      // baseline marketing copy on the page can't trip the dual-path heuristic.
      requireOtp: true,
      // After OTP validation the product surfaces:
      //   "The phone number associated with <email> is xxxxxx4699. Try using this phone number"
      blockedMessagePattern:
        /phone number associated with[\s\S]*?try using this phone number/i,
    });
    cy.contains(/thank you|we have received|registration successful/i).should('not.exist');
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
    cy.contains(/thank you|we have received|registration successful/i).should('not.exist');
  });

  it('Invalid phone should show error and not open OTP', () => {
    cy.fillLeadForm({
      name: testData.name,
      email: testData.existingEmail,
      phone: testData.invalidPhones[1],
      whatsappOptIn: true,
    });

    cy.assertOtpStageNotOpened();
    cy.contains(/thank you|we have received|registration successful/i).should('not.exist');
  });

  it('Submitting empty form should show required field errors', () => {
    cy.submitLeadForm();

    cy.assertOtpStageNotOpened();
    cy.contains(/thank you|we have received|registration successful/i).should('not.exist');
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
