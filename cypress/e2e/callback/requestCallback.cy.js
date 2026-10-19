/// <reference types="cypress" />
//
// "Request a CallBack" widget on the home page:
// cleanup -> open widget -> name / email / phone -> course -> Request OTP ->
// OTP -> "Thanks for sharing your details. One of our Admissions Counsellors
// will get in touch with you shortly".
import { EMAIL_INPUT, PHONE_INPUT, findButtons, findNameInputs } from '../../support/dom';

const fixture = require('../../fixtures/leads/request-callback.json');

const OTP_VALIDATE = /\/otp-validation\/validate\/?$/;
const REQUEST_OTP = /request\s*otp|get\s*otp|send\s*otp/i;
const SUCCESS =
  /thanks for sharing your details[\s\S]*one of our admissions counsellors will get in touch with you shortly/i;

// Smallest container around the visible email input that also has the Request OTP button.
function callbackForm($body) {
  const $email = $body.find(EMAIL_INPUT).filter(':visible').last();
  let $cur = $email.parent();
  while ($cur.length && !$cur.is('body')) {
    if (findButtons($cur, REQUEST_OTP).length) return $cur;
    $cur = $cur.parent();
  }
  return null;
}

describe('Kraftshala — Request a CallBack', () => {
  it('Submit callback request and verify success message', () => {
    Object.assign(globalThis.testDetail(), {
      kind: 'lead',
      form: fixture.form,
      page: fixture.page,
      expectation: '"Thanks for sharing your details…" confirmation is shown',
      lead: fixture.lead,
    });
    cy.cleanupLead({
      programSlug: fixture.programSlug,
      emails: [fixture.lead.email],
      phones: [fixture.lead.phone, ...(fixture.alsoFreePhones || [])],
    });
    cy.visitPage(fixture.page);

    cy.contains(/request\s*a?\s*call\s*back/i, { timeout: 15000 }).filter(':visible').first().click();
    cy.get('body', { timeout: 15000 }).should(($body) => {
      expect(callbackForm($body), 'callback form (email input + Request OTP button)').to.not.equal(null);
    });

    cy.apiMark().then((since) => {
      cy.get('body').then(($body) => {
        const $form = callbackForm($body);
        const $name = findNameInputs($form);
        if (!$name.length) throw new Error('Name input not found in the callback form');
        cy.wrap($name.first()).typeInto(fixture.lead.name);
        cy.wrap($form.find(EMAIL_INPUT).filter(':visible').first()).typeInto(fixture.lead.email);
        cy.wrap($form.find(PHONE_INPUT).filter(':visible').last()).typeInto(fixture.lead.phone);

        // Course picker (the site's custom dropdown).
        const $trigger = $form.find('.dropdown-button, .dropdown-text').filter(':visible').first();
        if (!$trigger.length) throw new Error('Course dropdown not found in the callback form');
        cy.wrap($trigger).pickDropdownOption(fixture.course);
      });
      cy.get('body').then(($body) => cy.wrap(findButtons(callbackForm($body), REQUEST_OTP).last()).click());

      cy.enterOtpAndSubmit(fixture.otp);
      cy.verifyApi('OTP validation', 'POST', OTP_VALIDATE, { since });
      cy.contains(SUCCESS, { timeout: 45000 }).should('be.visible');
      cy.recordDetail({ submission: { ok: true, outcome: 'Callback confirmation shown' } });
    });
  });
});
