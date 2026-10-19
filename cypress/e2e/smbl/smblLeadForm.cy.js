/// <reference types="cypress" />
// BASL (Sales & Marketing, URL /pgp/learn-sales-and-marketing/) lead form —
// the seven shared cases (see support/leadFormSuite.js).
// Success: /pgp/learn-sales-and-marketing/thank-you/?id={uuid}
import { defineLeadFormSuite } from '../../support/leadFormSuite';

const fixture = require('../../fixtures/leads/basl-lead-form.json');

defineLeadFormSuite({
  title: 'Kraftshala BASL lead form',
  fixture,
  success: /\/pgp\/learn-sales-and-marketing\/thank-you\/?$/,
  assertSuccessPage: () => {
    cy.location('search').should('match', /[?&]id=[\w-]+/);
  },
});
