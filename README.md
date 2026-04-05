# MLP Page Automation

Kraftshala MLP automation with a simple UI for lead input, lead cleanup, Cypress run, and readable test report.

## Prerequisites

- Node.js (LTS)
- npm

## Setup

From project root:

```bash
npm install
```

## Start the automation UI

```bash
npm run mlp:form
```

Open:

`http://localhost:4000/`

## End-to-end flow (what happens after you click Run tests)

1. You fill form fields:
   - Name
   - Base email
   - Base phone
   - Different email
   - Different phone
2. UI sends `POST /prepare-tests` to backend (`form-server.js`).
3. Backend builds test data and updates `cypress/fixtures/mlpTestData.json`.
4. Backend calls lead cleanup APIs (GET):
   - Email delete: `https://testservice.kraftshala.com/lead/remove-lead/mlp/{email}`
   - Phone delete: `https://testservice.kraftshala.com/otp-validation/removeNumber/{number}`
5. Backend runs Cypress spec:
   - `cypress/e2e/mlpLeadForm.cy.js`
6. Backend parses run output and sends structured result to UI.
7. UI shows clear report: total, pass, fail, and each test case status.

## Edge cases covered (7)

1. New registration (new email + new number) -> PASS
2. Existing registration (base email + base number) -> PASS
3. Base email + different number -> FAIL (expected business behavior)
4. Base number + different email -> PASS
5. Invalid email -> FAIL
6. Invalid phone -> FAIL
7. Blank form -> FAIL

## Main files

- `form.html` - UI form and test report
- `form-server.js` - backend API, lead cleanup, Cypress trigger, report generation
- `cypress/e2e/mlpLeadForm.cy.js` - 7 edge-case tests
- `cypress/support/commands.js` - reusable form and OTP commands
- `cypress/fixtures/mlpTestData.json` - runtime fixture data (auto-updated by backend)

## Optional direct Cypress run

```bash
npm run cy:open
```

or

```bash
npm run cy:run -- --spec cypress/e2e/mlpLeadForm.cy.js
```

## Config (optional)

- `MLP_FORM_PORT` (default: `4000`)
- `MLP_PLATFORM` (`test` or `main`, default: `test`)
- `MLP_EMAIL_DELETE_BASE_TEST` (default: `https://testservice.kraftshala.com/lead/remove-lead/mlp/`)
- `MLP_PHONE_DELETE_BASE_TEST` (default: `https://testservice.kraftshala.com/otp-validation/removeNumber/`)
- `MLP_EMAIL_DELETE_BASE_MAIN` (default: `https://service.kraftshala.com/lead/remove-lead/mlp/`)
- `MLP_PHONE_DELETE_BASE_MAIN` (default: `https://service.kraftshala.com/otp-validation/removeNumber/`)
- Backward compatibility: `MLP_EMAIL_DELETE_BASE` / `MLP_PHONE_DELETE_BASE` still work as test-platform defaults.

Base URLs by platform:
- `test` -> `https://testprogram.kraftshala.com/`
- `main` -> `https://program.kraftshala.com/`

After changing env vars, restart:

```bash
npm run cy:run -- --spec cypress/e2e/mlpLeadForm.cy.js
npm run mlp:form
```

