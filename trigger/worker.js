/**
 * Cloudflare Worker: a plain URL that starts the QA automation on GitHub
 * Actions and follows it live until the report is published.
 *
 *   /                          pick a platform and suite
 *   /run/<platform>            run every suite      (platform: test | main)
 *   /run/<platform>/<suite>    run one suite        (suite: mlp, alm, basl, kslive, callback, seo, links)
 *   /api/status?since=         progress, polled by the waiting page
 *
 * The GitHub token stays in the Worker and is never sent to the browser.
 */

const PLATFORMS = {
  test: { label: 'Test platform', host: 'testprogram.kraftshala.com', live: false },
  main: { label: 'Main platform', host: 'www.kraftshala.com', live: true },
};

const SUITES = {
  mlp: 'MLP',
  alm: 'ALM',
  basl: 'BASL',
  kslive: 'KS Live',
  callback: 'Callback',
  seo: 'SEO',
  links: 'Broken links',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (!isAuthorised(request, env)) return page(deniedPage(), 401);
    const headers = keyCookie(request, env);

    try {
      if (path === '/') return page(homePage(env), 200, headers);

      const run = /^\/run\/(test|main)(?:\/([a-z]+))?$/.exec(path);
      if (run) {
        const suite = run[2] || 'all';
        if (suite !== 'all' && !SUITES[suite]) {
          return page(errorPage('Unknown suite', `"${escapeHtml(suite)}" is not a suite.`), 404);
        }
        return startRun(run[1], suite, env, headers);
      }

      if (path === '/api/status') return statusJson(url, env);

      return page(errorPage('Page not found', `Nothing is served at ${escapeHtml(path)}.`), 404);
    } catch (err) {
      return page(errorPage('Something went wrong', escapeHtml(String(err && err.message))), 500);
    }
  },
};

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/** Open to anyone unless ACCESS_KEY is set; then ?key= or the cookie must match. */
function isAuthorised(request, env) {
  if (!env.ACCESS_KEY) return true;
  const url = new URL(request.url);
  if (url.searchParams.get('key') === env.ACCESS_KEY) return true;
  const cookie = request.headers.get('Cookie') || '';
  return cookie.split(';').some((c) => c.trim() === `qakey=${env.ACCESS_KEY}`);
}

/** Remember a correct ?key= so later navigation and polling do not need it. */
function keyCookie(request, env) {
  if (!env.ACCESS_KEY) return {};
  if (new URL(request.url).searchParams.get('key') !== env.ACCESS_KEY) return {};
  return { 'Set-Cookie': `qakey=${env.ACCESS_KEY}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax` };
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

function gh(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'kraftshala-qa-trigger',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function startRun(platform, suite, env, headers) {
  // A run already queued or in progress is followed instead of stacking another.
  const running = await findRun(env, null);
  if (running && running.status !== 'completed') {
    return page(waitingPage(platform, suite, running.startedAt, env, true), 200, headers);
  }

  const startedAt = Date.now();
  const res = await gh(env, `/actions/workflows/${env.WORKFLOW_FILE}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: env.GIT_REF || 'main', inputs: { platform, suite } }),
  });
  if (res.status !== 204) {
    const detail = await res.text();
    return page(
      errorPage('Could not start the run', `GitHub replied ${res.status}. ${escapeHtml(detail.slice(0, 300))}`),
      502
    );
  }
  return page(waitingPage(platform, suite, startedAt, env, false), 200, headers);
}

/** Newest workflow run, optionally only one created at or after `since`. */
async function findRun(env, since) {
  const res = await gh(env, `/actions/workflows/${env.WORKFLOW_FILE}/runs?per_page=10`);
  if (!res.ok) return null;
  const runs = (await res.json()).workflow_runs || [];
  const cutoff = since ? since - 120000 : null; // allow for clock skew
  for (const run of runs) {
    const created = Date.parse(run.created_at);
    if (cutoff !== null && created < cutoff) continue;
    return { status: run.status, conclusion: run.conclusion, htmlUrl: run.html_url, startedAt: created };
  }
  return null;
}

async function statusJson(url, env) {
  const run = await findRun(env, Number(url.searchParams.get('since')) || null);
  const body = run
    ? { state: run.status === 'completed' ? run.conclusion || 'unknown' : run.status, runUrl: run.htmlUrl }
    : { state: 'pending', runUrl: null };
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function page(html, status = 200, headers = {}) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLE = `
:root{--gold:#f1ae13;--navy:#243e60;--navy-deep:#1b2f4a;--ink:#303030;--body:#505050;
  --muted:#7e7e7e;--line:#e5e5e5;--bg:#f8f8f8;--card:#fff;--ok:#157a4f;--ok-soft:#eaf6f0;
  --bad:#c0392b;--bad-soft:#fdecea;
  --font:"Plus Jakarta Sans","Segoe UI",-apple-system,Roboto,Helvetica,Arial,sans-serif}
@media (prefers-color-scheme:dark){:root{--ink:#eceff4;--body:#c9d1dc;--muted:#97a3b4;--line:#2c3746;
  --bg:#121821;--card:#1a2230;--ok:#4cc38a;--ok-soft:#173528;--bad:#f07a6c;--bad-soft:#3b1f1c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--body);font-family:var(--font);line-height:1.55}
header{background:linear-gradient(135deg,var(--navy),var(--navy-deep));color:#fff;padding:44px 24px 40px;
  position:relative;overflow:hidden}
header:after{content:"";position:absolute;right:-70px;top:-70px;width:240px;height:240px;border-radius:50%;
  background:var(--gold);opacity:.13}
.wrap{max-width:760px;margin:0 auto;position:relative}
.brandmark{display:inline-flex;align-items:center;gap:8px;font-weight:800;font-size:13px;color:#fff}
.brandmark i{width:10px;height:10px;border-radius:2px;background:var(--gold);transform:rotate(45deg)}
h1{margin:16px 0 6px;font-size:28px;font-weight:800;letter-spacing:-.5px;color:#fff}
header p{margin:0;color:#b9c4d4;font-size:13.5px}
main{max-width:760px;margin:0 auto;padding:28px 24px 60px;display:grid;gap:18px}
.card{display:block;background:var(--card);border:1px solid var(--line);border-top:3px solid var(--gold);
  border-radius:14px;padding:22px 24px;text-decoration:none;color:inherit;box-shadow:0 1px 3px rgba(36,62,96,.05)}
h2{margin:0;font-size:19px;font-weight:800;color:var(--ink)}
.host{margin:3px 0 0;font-size:12px;color:var(--muted);font-family:ui-monospace,Consolas,monospace}
.desc{margin:12px 0 0;font-size:13.5px}
.tagline{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;
  padding:3px 10px;margin-left:10px;vertical-align:2px}
.tagline.live{background:var(--gold);color:#3d2c00}.tagline.safe{background:#eef1f6;color:#516179}
.btn{display:inline-block;margin-top:16px;background:var(--navy);color:#fff;text-decoration:none;font-weight:700;
  font-size:14px;padding:11px 20px;border-radius:9px}
.btn.gold{background:var(--gold);color:#3d2c00}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.chip{font-size:12.5px;font-weight:700;color:var(--navy);border:1px solid var(--line);border-radius:999px;
  padding:5px 12px;text-decoration:none;background:var(--card)}
@media (prefers-color-scheme:dark){.chip{color:#dbe4f0}}
.status{display:flex;align-items:center;gap:14px;font-size:16px;font-weight:700;color:var(--ink)}
.spinner{width:22px;height:22px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--gold);
  animation:spin .9s linear infinite;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
.steps{margin:18px 0 0;padding:0;list-style:none;font-size:13.5px;color:var(--muted)}
.steps li{padding:5px 0 5px 22px;position:relative}
.steps li:before{content:"";position:absolute;left:0;top:12px;width:8px;height:8px;border-radius:50%;background:var(--line)}
.steps li.done{color:var(--ink)}.steps li.done:before{background:var(--ok)}
.note{margin:16px 0 0;font-size:12.5px;color:var(--muted)}
.banner{padding:12px 15px;border-radius:10px;font-size:14px;font-weight:600;margin-top:16px}
.banner.ok{background:var(--ok-soft);color:var(--ok)}.banner.bad{background:var(--bad-soft);color:var(--bad)}
@media(max-width:560px){header,main{padding-left:16px;padding-right:16px}h1{font-size:23px}}
`;

function shell(title, bodyHtml) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - Kraftshala QA Automation</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${STYLE}</style></head>
<body>${bodyHtml}</body></html>`;
}

function header(title, subtitle) {
  return `<header><div class="wrap">
    <span class="brandmark"><i></i>KRAFTSHALA</span>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
  </div></header>`;
}

function homePage(env) {
  const cards = Object.entries(PLATFORMS)
    .map(
      ([id, p]) => `<div class="card">
        <h2>${escapeHtml(p.label)}<span class="tagline ${p.live ? 'live' : 'safe'}">${p.live ? 'Live site' : 'Test site'}</span></h2>
        <p class="host">${escapeHtml(p.host)}</p>
        <p class="desc">Lead forms (MLP, ALM, BASL), downloads, KS Live, callback, SEO checklist and
        broken links.${p.live ? ' <b>Creates real leads on the live site.</b>' : ''}</p>
        <a class="btn gold" href="/run/${id}">Run every suite &rarr;</a>
        <div class="chips">${Object.entries(SUITES)
          .map(([s, label]) => `<a class="chip" href="/run/${id}/${s}">${escapeHtml(label)}</a>`)
          .join('')}</div>
      </div>`
    )
    .join('');

  return shell(
    'Run the QA check',
    `${header('QA Automation', 'Pick a platform, then run everything or a single suite. A full run takes about 25 minutes.')}
     <main>
       ${cards}
       <a class="card" href="${escapeHtml(env.REPORT_BASE)}/" style="border-top-color:var(--line)">
         <h2>Latest reports</h2>
         <p class="desc">Open the most recent result for either platform without starting a new run.</p>
       </a>
     </main>`
  );
}

function waitingPage(platform, suite, startedAt, env, alreadyRunning) {
  const p = PLATFORMS[platform];
  const what = suite === 'all' ? 'every suite' : SUITES[suite];
  const reportUrl = `${env.REPORT_BASE}/${platform}/`;

  return shell(
    'Running',
    `${header(
      `Checking ${what} on the ${p.label.toLowerCase()}`,
      alreadyRunning ? 'A run was already in progress — following that one.' : 'Started. This page updates on its own.'
    )}
     <main>
       <div class="card">
         <div class="status"><span class="spinner" id="spin"></span><span id="state">Starting the run…</span></div>
         <ul class="steps">
           <li id="s1">Run queued on GitHub</li>
           <li id="s2">Running the tests</li>
           <li id="s3">Report published</li>
         </ul>
         <div id="done"></div>
         <p class="note">You can leave this tab open, or come back to the report link later.</p>
       </div>
     </main>
<script>
(function () {
  var since = ${Number(startedAt) || 0};
  var reportUrl = ${JSON.stringify(reportUrl)};
  var state = document.getElementById('state');
  var done = document.getElementById('done');
  var spin = document.getElementById('spin');
  var steps = ['s1', 's2', 's3'].map(function (id) { return document.getElementById(id); });
  var runUrl = null;

  function mark(n) { for (var i = 0; i < n; i++) steps[i].className = 'done'; }
  function link(text, href, cls) { return '<a class="btn ' + cls + '" href="' + href + '">' + text + '</a> '; }

  function finish(conclusion) {
    spin.style.display = 'none';
    var log = runUrl ? link('Run log', runUrl, '') : '';
    if (conclusion === 'success') {
      mark(3);
      state.textContent = 'Done — every test passed';
      done.innerHTML = '<div class="banner ok">The report is ready.</div>' + link('Open the report', reportUrl, 'gold') + log;
    } else if (conclusion === 'failure') {
      mark(3);
      state.textContent = 'Done — some tests failed';
      done.innerHTML = '<div class="banner bad">The run finished with failures. The report lists them.</div>'
        + link('Open the report', reportUrl, 'gold') + log;
    } else {
      state.textContent = 'The run stopped early (' + conclusion + ')';
      done.innerHTML = '<div class="banner bad">No new report may have been published.</div>' + log + link('Back', '/', '');
    }
  }

  function poll() {
    fetch('/api/status?since=' + since, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        runUrl = d.runUrl || runUrl;
        if (d.state === 'queued') { state.textContent = 'Waiting for a runner…'; mark(1); }
        if (d.state === 'in_progress') { state.textContent = 'Running the tests…'; mark(2); }
        if (['success', 'failure', 'cancelled', 'timed_out', 'unknown'].indexOf(d.state) > -1) return finish(d.state);
        setTimeout(poll, 8000);
      })
      .catch(function () { setTimeout(poll, 10000); });
  }
  setTimeout(poll, 3000);
})();
</script>`
  );
}

function errorPage(title, detail) {
  return shell(
    title,
    `${header(title, 'Nothing was started.')}
     <main><div class="card"><p class="desc">${detail}</p><a class="btn" href="/">Back</a></div></main>`
  );
}

function deniedPage() {
  return shell(
    'Access key needed',
    `${header('Access key needed', 'This link is missing its key.')}
     <main><div class="card"><p class="desc">Ask the tech team for the full link — it ends with <code>?key=…</code>.</p></div></main>`
  );
}

// Exported for local rendering checks.
export { homePage, waitingPage, errorPage, deniedPage, PLATFORMS, SUITES };
