// The seven lead-form cases shared by MLP, ALM and BASL. Each spec passes its
// fixture plus what "success" looks like on its page.
//
// Dependencies are explicit: cases 2-4 need the lead created by case 1. If
// case 1 did not pass they are reported as SKIPPED with the reason, instead of
// failing for an unrelated cause or passing on stale data.

const LEAD_CREATE = /\/lead\/create\/?$/;
const OTP_VALIDATE = /\/otp-validation\/validate\/?$/;
const BLOCKED_MESSAGE = /phone number associated with[\s\S]*?try using this phone number/i;
// Client-side validation copy shown under the fields.
const EMAIL_ERROR = /please enter (a )?valid email/i;
const PHONE_ERROR = /must be (of )?10 digits/i;
const NO_CLEANUP = 'Not needed — this submission must not create a lead.';

export function defineLeadFormSuite({ title, fixture, success, assertSuccessPage }) {
  const { lead, alternate, invalid, programSlug, otp } = fixture;

  // Synchronous on purpose: the case is described even when it is skipped
  // before any Cypress command runs.
  const recordCase = (expectation, identity, extra = {}) =>
    Object.assign(globalThis.testDetail(), {
      kind: 'lead',
      form: fixture.form,
      page: fixture.page,
      expectation,
      lead: identity,
      ...extra,
    });

  // newLead: true  -> lead/create must succeed (brand-new lead)
  //          false -> not checked; whether a lead was created or reused is reported
  const submitAndExpectSuccess = (identity, { newLead = true } = {}) => {
    cy.apiMark().then((since) => {
      cy.fillLeadForm({ ...identity, whatsappOptIn: true });
      cy.enterOtpAndSubmit(otp);
      cy.verifyApi('OTP validation', 'POST', OTP_VALIDATE, { since });
      if (newLead) cy.verifyApi('Lead created (lead/create)', 'POST', LEAD_CREATE, { since });
      cy.location('pathname', { timeout: 90000 }).should('match', success);
      assertSuccessPage();
      cy.location('pathname').then((p) => {
        const created = globalThis.__apiCalls
          .slice(since)
          .some((c) => c.method === 'POST' && LEAD_CREATE.test(c.path) && c.status < 300);
        cy.recordDetail({
          submission: {
            ok: true,
            outcome: `Success page opened: ${p} — ${created ? 'new lead created' : 'existing lead reused (no lead/create)'}`,
          },
        });
      });
    });
  };

  const submitAndExpectValidationError = (identity, errorText) => {
    cy.apiMark().then((since) => {
      cy.fillLeadForm(identity);
      cy.contains(errorText, { timeout: 10000 }).should('be.visible');
      cy.assertOtpStageNotOpened();
      cy.verifyNoApi('No lead created (lead/create)', 'POST', LEAD_CREATE, { since });
      cy.location('pathname').should('not.match', success);
      cy.recordDetail({ submission: { ok: true, outcome: 'Validation error shown; OTP step did not open' } });
    });
  };

  describe(title, () => {
    let baseLeadCreated = false;

    const requireBaseLead = (ctx) => {
      if (!baseLeadCreated) {
        globalThis.skipTest(
          ctx,
          'Depends on the lead from "New registration with base email and base phone", which did not pass in this run.'
        );
      }
    };

    beforeEach(() => {
      cy.visitPage(fixture.page);
    });

    it('New registration with base email and base phone', () => {
      recordCase('A new lead is created and the success page opens', lead);
      cy.cleanupLead({
        programSlug,
        emails: [lead.email, alternate.email],
        phones: [lead.phone, alternate.phone],
      });
      submitAndExpectSuccess(lead);
      cy.then(() => {
        baseLeadCreated = true;
      });
    });

    it('Existing registration with base email and base phone', function () {
      recordCase('Re-submitting an existing lead still opens the success page', lead, {
        cleanupNote: 'Intentionally not run — this case re-submits the lead created by the previous case.',
      });
      requireBaseLead(this);
      submitAndExpectSuccess(lead, { newLead: false });
    });

    it('Base email with different phone number should be blocked', function () {
      const identity = { name: lead.name, email: lead.email, phone: alternate.phone };
      recordCase('Registration is blocked with "phone number associated with …" and no success page', identity);
      requireBaseLead(this);
      cy.cleanupLead({ programSlug, phones: [alternate.phone] });
      cy.apiMark().then((since) => {
        cy.fillLeadForm({ ...identity, whatsappOptIn: true });
        cy.enterOtpAndSubmit(otp);
        cy.verifyApi('OTP validation rejects the mismatched phone', 'POST', OTP_VALIDATE, {
          since,
          expectOk: false,
        }).then((call) => expect(call.message, 'rejection message').to.match(BLOCKED_MESSAGE));
        cy.contains(BLOCKED_MESSAGE, { timeout: 45000 }).should('be.visible');
        cy.verifyNoApi('No lead created (lead/create)', 'POST', LEAD_CREATE, { since });
        cy.location('pathname').should('not.match', success);
        cy.recordDetail({
          submission: { ok: true, outcome: 'Blocked: "phone number associated with … try using this phone number"' },
        });
      });
    });

    it('Base phone number with different email', function () {
      const identity = { name: lead.name, email: alternate.email, phone: lead.phone };
      recordCase('OTP verifies and the success page opens (new lead or existing lead for this phone)', identity);
      requireBaseLead(this);
      cy.cleanupLead({ programSlug, emails: [alternate.email] });
      submitAndExpectSuccess(identity, { newLead: false });
    });

    it('Invalid email should show error and not open OTP', () => {
      const identity = { name: lead.name, email: invalid.email, phone: lead.phone };
      recordCase('Email validation error; no OTP, no lead', identity, { cleanupNote: NO_CLEANUP });
      submitAndExpectValidationError(identity, EMAIL_ERROR);
    });

    it('Invalid phone should show error and not open OTP', () => {
      const identity = { name: lead.name, email: lead.email, phone: invalid.phone };
      recordCase('Phone validation error; no OTP, no lead', identity, { cleanupNote: NO_CLEANUP });
      submitAndExpectValidationError(identity, PHONE_ERROR);
    });

    it('Submitting empty form should show required field errors', () => {
      recordCase('Required-field errors; no OTP, no lead', {}, { cleanupNote: NO_CLEANUP });
      cy.apiMark().then((since) => {
        cy.submitLeadForm();
        cy.contains(EMAIL_ERROR, { timeout: 10000 }).should('be.visible');
        cy.assertOtpStageNotOpened();
        cy.verifyNoApi('No lead created (lead/create)', 'POST', LEAD_CREATE, { since });
        cy.recordDetail({ submission: { ok: true, outcome: 'Required-field errors shown; OTP step did not open' } });
      });
    });
  });
}
