/// <reference types="cypress" />
//
// KS Live — register on the first visible event with the fixture lead.
//
// "Register" calls window.open(url, '_top'), which would navigate the Cypress
// runner itself; the URL is captured on load and followed with cy.visit.
import { EMAIL_INPUT, PHONE_INPUT, findNameInputs } from '../../support/dom';

const fixture = require('../../fixtures/leads/kslive-registration.json');

const CARD = '.ks-live-registration-card';
const REGISTER_BUTTON = '.register-btn';
const SUBMIT_BUTTON = 'button.ks-live-submit-btn';
const OTP_INPUT = 'input.otp-input-kslive';
const OTP_VALIDATE = /\/otp-validation\/validate\/?$/;
const EVENT_LEAD = /\/events\/[^/]+\/lead\/?$/;

// "🎉 You're In! Don't Miss Important Updates" (current) / "Your Session Registration Is Confirmed" (older).
const REGISTERED = /you[’‘']?re\s+in[\s\S]{0,300}(don[’‘']?t\s+miss|important\s+updates)|your\s+session\s+registration\s+is\s+confirmed/i;
// Repeat registration of the same email for the same event.
const ALREADY_REGISTERED = /you[’‘']?re\s+already\s+registered/i;

function captureWindowOpen(win) {
  try {
    Object.defineProperty(win, 'top', { configurable: true, get: () => win });
    Object.defineProperty(win, 'parent', { configurable: true, get: () => win });
    // The events page registers a service worker that can reload the AUT mid-test.
    Object.defineProperty(win.navigator, 'serviceWorker', { configurable: true, get: () => undefined });
  } catch (_) {
    // Not redefinable in this browser; the open() capture below still applies.
  }
  win.__nextRegisterUrl = null;
  win.open = (url) => {
    win.__nextRegisterUrl = String(url || '');
    return null;
  };
}

describe('Kraftshala KS Live registration', () => {
  it('Register on 1st KS Live event with base email and base phone', () => {
    Object.assign(globalThis.testDetail(), {
      kind: 'lead',
      form: fixture.form,
      page: fixture.page,
      expectation: '"You\'re In!" confirmation (or "already registered" for a repeat registration)',
      lead: fixture.lead,
    });
    cy.cleanupLead({ phones: [fixture.lead.phone] });

    cy.visitPage(fixture.page, { onBeforeLoad: captureWindowOpen });
    cy.get(CARD, { timeout: 25000 }).filter(':visible').first().find(REGISTER_BUTTON).filter(':visible').first().click();
    cy.window({ timeout: 10000 })
      .its('__nextRegisterUrl')
      .should('be.a', 'string')
      .and('not.be.empty')
      .then((url) => {
        cy.recordDetail({ notes: [`Registration page: ${new URL(url, Cypress.config('baseUrl')).pathname}`] });
        cy.visit(url, { onBeforeLoad: captureWindowOpen });
      });

    cy.get(EMAIL_INPUT, { timeout: 20000 }).filter(':visible').should('have.length.at.least', 1);
    cy.get('body').then(($body) => {
      const $name = findNameInputs($body);
      if (!$name.length) throw new Error('Name input not found on the KS Live registration form');
      cy.wrap($name.first()).typeInto(fixture.lead.name);
    });
    cy.get(EMAIL_INPUT).filter(':visible').last().typeInto(fixture.lead.email);
    cy.get(PHONE_INPUT).filter(':visible').last().typeInto(fixture.lead.phone);
    // Required "What describes you best?" dropdown.
    cy.get('.user-description-dropdown .dropdown-button').filter(':visible').first().pickDropdownOption(fixture.role);

    cy.apiMark().then((since) => {
      cy.get(SUBMIT_BUTTON).filter(':visible').last().click();

      // Current site confirms straight away; an older version asked for an OTP first.
      cy.get('body', { timeout: 30000 }).should(($body) => {
        const text = $body.text();
        const hasOtp = $body.find(OTP_INPUT).filter(':visible').length > 0;
        expect(hasOtp || REGISTERED.test(text) || ALREADY_REGISTERED.test(text), 'OTP step or confirmation').to.equal(true);
      });
      cy.get('body').then(($body) => {
        if (!$body.find(OTP_INPUT).filter(':visible').length) return;
        cy.apiMark().then((otpSince) => {
          cy.get(OTP_INPUT).typeInto(fixture.otp);
          // The OTP step submits by itself on the last digit; clicking too would double-submit.
          cy.waitForApi('POST', OTP_VALIDATE, { since: otpSince, timeout: 3000, sent: true }).then((call) => {
            if (!call) cy.get(SUBMIT_BUTTON).filter(':visible').last().click();
          });
        });
      });

      cy.contains(new RegExp(`${REGISTERED.source}|${ALREADY_REGISTERED.source}`, 'i'), { timeout: 60000 })
        .should('be.visible')
        .invoke('text')
        .then((text) => {
          const repeat = ALREADY_REGISTERED.test(text);
          cy.recordDetail({
            submission: {
              ok: true,
              outcome: repeat
                ? 'Already registered for this event (repeat registration — KS Live has no delete API to reset it)'
                : 'Registration confirmed ("You\'re In!")',
            },
          });

          // The backend must agree with the page: a new registration creates the
          // event lead (2xx); a repeat one is refused with 409 "Lead already exists".
          // Any other error fails the test.
          const calls = globalThis.__apiCalls.slice(since).filter((c) => c.method === 'POST' && c.status !== null);
          const eventLead = calls.find((c) => EVENT_LEAD.test(c.path));
          const expected = (c) =>
            c === eventLead && repeat ? c.status === 409 && /already exists/i.test(c.message) : c.status < 400;
          cy.recordDetail({
            api: calls.map((c) => ({ label: `POST ${c.path}`, status: c.status, message: c.message, ok: expected(c) })),
          });
          expect(eventLead, 'event registration request (…/events/<id>/lead)').to.not.equal(undefined);
          expect(
            calls.filter((c) => !expected(c)).map((c) => `${c.path} -> ${c.status} ${c.message}`),
            'unexpected backend responses'
          ).to.deep.equal([]);
        });
    });
  });
});
