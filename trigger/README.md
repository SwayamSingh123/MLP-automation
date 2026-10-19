# Trigger endpoint (Cloudflare Worker)

This Worker gives the team a plain URL. Opening a link starts the QA run on GitHub Actions, and the
page follows the run live until the report is published. The GitHub token stays inside the Worker
and is never sent to the browser.

| Route | What it does |
|---|---|
| `GET /` | Lists both platforms, a "run every suite" button, one chip per suite, and a link to the latest reports |
| `GET /run/<test\|main>` | Dispatches `qa-report.yml` for every suite, then shows the live status page |
| `GET /run/<test\|main>/<suite>` | The same, for one suite (`mlp`, `alm`, `basl`, `kslive`, `callback`, `seo`, `links`) |
| `GET /api/status?since=` | Polled by the status page: queued → in progress → success / failure |

If a run is already queued or running, `/run/...` follows that run instead of starting another one.

## Deploy

```bash
cd trigger
npx wrangler login                      # one time
npx wrangler secret put GITHUB_TOKEN    # fine-grained PAT: this repo, "Actions: read and write"
npx wrangler secret put ACCESS_KEY      # recommended: main runs create real leads
npx wrangler deploy
```

With the existing account subdomain, the URL is
`https://kraftshala-qa-trigger.kraftshala.workers.dev/`. When `ACCESS_KEY` is set, share
`.../?key=<value>`. The Worker remembers the key in a cookie.

The repository, workflow file, branch and report base URL live in `wrangler.toml` under `[vars]`.

## If a run doesn't start

- **403 from GitHub:** the token can't dispatch workflows. Give it Actions write access.
- **404 from GitHub:** `GITHUB_OWNER`, `GITHUB_REPO` or `WORKFLOW_FILE` doesn't match, or the
  workflow isn't on the default branch yet.
