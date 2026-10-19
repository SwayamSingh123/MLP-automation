# Kraftshala QA Automation

Cypress checks for Kraftshala's lead forms, downloads, KS Live, the callback widget, SEO and
broken links. Each run produces an HTML dashboard that is published to GitHub Pages and can be
started from a plain link (Cloudflare Worker). Same architecture as the Meta Pixel automation.

```
Cloudflare Worker (trigger/)  ->  GitHub Actions (qa-report.yml)  ->  Cypress  ->  reporter/  ->  gh-pages
```

## Suites

| Suite      | Specs                                                         | Tests |
|------------|---------------------------------------------------------------|-------|
| `mlp`      | MLP lead form (7 cases), download brochure, download syllabus | 9     |
| `alm`      | ALM lead form (7 cases), download prospectus                  | 8     |
| `basl`     | BASL (Sales & Marketing) lead form (7 cases)                  | 7     |
| `kslive`   | KS Live event registration                                    | 1     |
| `callback` | Request a callback (home page)                                | 1     |
| `seo`      | 17-point SEO checklist on 7 pages                             | 7     |
| `links`    | Broken link checker on 13 pages                               | 13    |

The suite list lives in [shared/suites.js](shared/suites.js). It's the one source of truth for the
runner, the reporter and CI.

## Run locally

The easiest way is the local dashboard at **http://localhost:4000**. It has a run button for each
platform and suite, follows the run live, then opens the report:

```bash
npm install
npx cypress install   # first time only
npm run serve         # set PORT=xxxx to change the port
```

Or run from the terminal:

```bash
npm install
npm test                          # every suite, test platform
npm run test:suite -- mlp,alm     # selected suites
npm run test:main                 # main (live) platform: creates real leads
npm run open                      # interactive Cypress app (test platform)
npm run open:main                 # interactive Cypress app (main platform)
```

Each run writes `cypress/reports/results-<platform>.json` and the dashboard at
`cypress/reports/site/<platform>/index.html`. To re-render the dashboard without re-running the
tests (for example after a reporter change), use `npm run report`.

> Running from the VS Code terminal? The runner script clears `ELECTRON_RUN_AS_NODE`, which VS
> Code sets and which stops the Cypress binary from starting ("bad option: --smoke-test").

## Results mean what they say

- **PASS / FAIL / SKIPPED come straight from Cypress** (`after:run`). Nothing is parsed out of
  logs, and nothing is forced. SKIPPED is used only for a test that couldn't run, and the report
  says why. Example: "Existing registration" needs the lead created by "New registration".
- **No retries.** The report shows the first attempt.
- **SEO:** a page fails if any of its checks fail. Warnings (manual verification) and checks that
  don't apply to that page are listed, but they don't fail it.
- **Broken links:** a page fails if it can't be loaded or if any link returns 4xx/5xx or doesn't
  respond. Anti-bot answers from external sites (403/429/451/999) are listed but aren't counted as
  broken.
- **Uncaught exceptions** from the site's own code fail the test. Errors from third-party scripts,
  plus the benign `ResizeObserver loop` notice, are allowed, but each one is written into the
  test's notes.

## Lead fixtures and cleanup

Each form has its own fixture in [cypress/fixtures/leads/](cypress/fixtures/leads/):
`mlp-lead-form`, `mlp-download-brochure`, `mlp-download-syllabus`, `alm-lead-form`,
`alm-download-prospectus`, `basl-lead-form`, `kslive-registration`, `request-callback`.

Before a test that creates a lead, the existing delete APIs are called and **every response is
checked**:

- `GET {api}/lead/remove-lead/{programSlug}/{email}`. The slugs are `mlp`, `alm` and `basl`.
- `GET {api}/otp-validation/removeNumber/{phone}`

"Not found" counts as clean. Any other failure fails the test before it touches the form.
Validation-error cases (invalid email or phone, empty form) create no lead, so they skip cleanup
and instead assert that no `lead/create` request was sent. KS Live has no lead-delete endpoint, so
only its phone number is freed. A repeat registration is reported as "Already registered".

After submitting, tests verify the backend through the page's own requests:
`POST /otp-validation/validate` (2xx, or the expected rejection in the blocked case) and
`POST /lead/create` for new leads.

## Report

Each test shows its form, page, lead (masked), cleanup results, submission result, API
verification, failure reason and a screenshot on failure. Emails, phone numbers and names are
masked in Node before anything is written to disk. Unmasked values never reach the results JSON,
the published site or the CI artifact. Screenshots are taken from the real page, so they can show
the typed values.

Each run replaces the report for its platform. Running only MLP shows only MLP, and running every suite shows every suite. Results from earlier runs aren't kept on the page; past runs stay downloadable as artifacts on their GitHub Actions run. The header shows the run's scope.

## CI: GitHub Actions + Pages

[.github/workflows/qa-report.yml](.github/workflows/qa-report.yml) runs on:

- **Run workflow** in the Actions tab (inputs: platform and suites)
- the Worker, through `workflow_dispatch`
- `repository_dispatch` (`qa-test` / `qa-main`, with optional `client_payload.suite`)
- a nightly schedule: every suite on the test platform at 02:00 IST

The workflow publishes the report to the `gh-pages` branch even when tests fail, and then fails the
job if any test failed. If the `GCHAT_WEBHOOK_URL` secret is set, it also posts a summary to Google
Chat.

One-time setup:

1. Push this branch to the default branch (`main`). Workflows only trigger from there.
2. Go to Settings → Actions → General → Workflow permissions and select **Read and write**.
3. Run the workflow once. This creates the `gh-pages` branch.
4. Go to Settings → Pages and choose deploy from branch `gh-pages`, folder `/ (root)`.
   Pages on a private repo needs a paid plan (GitHub Pro/Team). Otherwise, make the repo public
   or read the report from the run's artifact.
5. Optional: add the `GCHAT_WEBHOOK_URL` repository secret.

The report URL is `https://<owner>.github.io/<repo>/` (landing page) and `/<platform>/`.

## Trigger link: Cloudflare Worker

See [trigger/README.md](trigger/README.md). In short:

```bash
cd trigger
npx wrangler secret put GITHUB_TOKEN    # PAT with Actions read/write on this repo
npx wrangler secret put ACCESS_KEY      # recommended: main runs create real leads
npx wrangler deploy
```

## Layout

```
.github/workflows/qa-report.yml   CI: triggers, run, publish, summary
cypress.config.js                 platform switch, Node tasks, after:run -> results + dashboard
cypress/e2e/                      specs (mlp, alm, smbl = BASL, kslive, callback, seo, links)
cypress/fixtures/leads/           one fixture per lead form
cypress/fixtures/seo/             expected SEO values per page
cypress/support/                  commands, cleanup + API checks, per-test report details
reporter/                         results -> HTML dashboard + landing page (pure functions)
shared/                           suite/platform registry, masking
scripts/                          local runner, CI summary + Google Chat
trigger/                          Cloudflare Worker
```
