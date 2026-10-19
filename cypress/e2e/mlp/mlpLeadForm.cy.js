/// <reference types="cypress" />
// MLP lead form — the seven shared cases (see support/leadFormSuite.js).
// Success: .../digital-marketing-course/screening-test/{id}/{id}/ with the lead summary.
import { defineLeadFormSuite } from '../../support/leadFormSuite';

const fixture = require('../../fixtures/leads/mlp-lead-form.json');

defineLeadFormSuite({
  title: 'Kraftshala MLP lead form',
  fixture,
  success: /\/marketing-launchpad\/digital-marketing-course\/screening-test\/[^/]+\/[^/]+\/?$/,
  assertSuccessPage: () => {
    cy.get('.lead-name', { timeout: 60000 }).should('be.visible');
  },
});
