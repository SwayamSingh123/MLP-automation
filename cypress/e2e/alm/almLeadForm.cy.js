/// <reference types="cypress" />
// ALM (AI-Led Marketing, URL /pgp-in-marketing/) lead form — the seven shared
// cases (see support/leadFormSuite.js).
// Success: /pgp-in-marketing/screening-test/{id}/{id}/ with the lead summary.
import { defineLeadFormSuite } from '../../support/leadFormSuite';

const fixture = require('../../fixtures/leads/alm-lead-form.json');

defineLeadFormSuite({
  title: 'Kraftshala ALM lead form',
  fixture,
  success: /\/pgp-in-marketing\/screening-test\/[^/]+\/[^/]+\/?$/,
  assertSuccessPage: () => {
    cy.get('.lead-name', { timeout: 60000 }).should('be.visible');
  },
});
