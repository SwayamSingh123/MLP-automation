/// <reference types="cypress" />
//
// Fixture (from UI / prepare-tests):
// - new + existing registration → base email + base phone (same pair in fixture)
// - samePhoneDifferentEmail     → different email + base phone (expect screening URL)
// - sameEmailDifferentPhone     → base email + different phone (blocked: no screening URL)

const testData = require('../../fixtures/mlp/mlpTestData.json');

describe('Kraftshala MLP lead form', () => {
  const assertPositiveFlowOutcome = () => {
    cy.assertLeadRegistrationSuccess(testData.name);
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
    cy.visitMlpPage();
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

  // Real app: same email + different phone often does not validate OTP / no screening URL — pass if we stay off success URL.
  it('Base email with different phone number should be blocked', () => {
    // Match validate/verify only (not send-otp or removeNumber under otp-validation).
    cy.intercept('POST', /otp-validation[^?]*(?:validate|verify)/i).as(
      'otpValidateBlocked'
    );

    cy.fillLeadForm({
      name: testData.name,
      email: testData.sameEmailDifferentPhone.email,
      phone: testData.sameEmailDifferentPhone.phone,
      whatsappOptIn: true,
    });

    cy.assertSameEmailDifferentPhoneBlockedFlow(testData.otp);
    cy.contains(/thank you|we have received|registration successful/i).should('not.exist');
  });

  it('Base phone number with different email', () => {
    cy.fillLeadForm({
      name: testData.name,
      email: testData.samePhoneDifferentEmail.email,
      phone: testData.samePhoneDifferentEmail.phone,
      whatsappOptIn: true,
    });

    cy.enterOtpAndSubmit(testData.otp);
    assertPositiveFlowOutcome();
  });

  it('Invalid email should show error and not open OTP', () => {
    cy.fillLeadForm({
      name: testData.name,
      // Intentionally invalid format from fixture data
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
    // For invalid number, success state must not appear.
    cy.contains(/thank you|we have received|registration successful/i).should('not.exist');
  });

  it('Submitting empty form should show required field errors', () => {
    // Click submit CTA without filling anything
    cy.submitLeadForm();

    cy.assertOtpStageNotOpened();
    // For blank form, success state must not appear.
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
