/**
 * Local QA dashboard: http://localhost:4000
 *
 *   /                      run buttons (per platform / suite) + link to the reports
 *   /run?platform=&suite=  start a local Cypress run (one at a time)
 *   /status                JSON: running?, exit code, last log lines
 *   /test/ /main/          the dashboards (cypress/reports/site)
 *
 * Usage: npm run serve   (PORT env var to change the port)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PLATFORMS, SUITES } = require('../shared/suites');

const PORT = Number(process.env.PORT) || 4000;
const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'cypress', 'reports', 'site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };

const run = { active: false, platform: null, suite: null, startedAt: null, exitCode: null, log: [] };

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function startRun(platform, suite) {
  Object.assign(run, { active: true, platform, suite, startedAt: Date.now(), exitCode: null, log: [] });
  const child = spawn(process.execPath, [path.join(__dirname, 'run.js'), '--platform', platform, '--suite', suite], {
    cwd: ROOT,
  });
  const onData = (buf) => {
    // Strip ANSI colours; keep the last 400 lines.
    const lines = buf.toString().replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).filter((l) => l.trim());
    run.log.push(...lines);
    if (run.log.length > 400) run.log.splice(0, run.log.length - 400);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', (code) => Object.assign(run, { active: false, exitCode: code }));
}

const PAGE_STYLE = `body{margin:0;font-family:"Segoe UI",Roboto,Arial,sans-serif;background:#f8f8f8;color:#303030}
header{background:linear-gradient(135deg,#243e60,#1b2f4a);color:#fff;padding:30px 24px}
header h1{margin:0 0 4px;font-size:24px}header p{margin:0;color:#b9c4d4;font-size:13px}
main{max-width:900px;margin:0 auto;padding:24px;display:grid;gap:16px}
.card{background:#fff;border:1px solid #e5e5e5;border-top:3px solid #f1ae13;border-radius:12px;padding:18px 20px}
h2{margin:0 0 4px;font-size:18px}.muted{color:#7e7e7e;font-size:13px}
.btn{display:inline-block;margin:10px 8px 0 0;padding:8px 14px;border-radius:8px;background:#243e60;color:#fff;
  text-decoration:none;font-weight:600;font-size:13px}.btn.gold{background:#f1ae13;color:#3d2c00}
.btn.off{opacity:.45;pointer-events:none}
pre{background:#111722;color:#c9d1dc;padding:12px;border-radius:8px;font-size:12px;max-height:420px;overflow:auto;white-space:pre-wrap}
.warn{color:#c0392b;font-weight:600}`;

function homePage() {
  const busy = run.active;
  const cards = Object.entries(PLATFORMS)
    .map(([id, p]) => {
      const link = (suite, label, cls = '') =>
        `<a class="btn ${cls} ${busy ? 'off' : ''}" href="/run?platform=${id}&suite=${suite}"${
          p.live ? ` onclick="return confirm('This creates REAL leads on the live site. Continue?')"` : ''
        }>${esc(label)}</a>`;
      return `<div class="card"><h2>${esc(p.label)}</h2><div class="muted">${esc(p.site)}</div>
        ${p.live ? '<p class="warn">Creates real leads on the live site.</p>' : ''}
        ${link('all', 'Run every suite', 'gold')}${SUITES.map((s) => link(s.id, s.id.toUpperCase())).join('')}
        <div><a class="btn" href="/${id}/">Open ${esc(p.label.toLowerCase())} report</a></div></div>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA Automation - local</title><style>${PAGE_STYLE}</style></head><body>
<header><h1>QA Automation — local</h1><p>Runs Cypress on this machine and shows the dashboard.</p></header>
<main>${busy ? `<div class="card"><b>A run is in progress</b> (${esc(run.platform)} · ${esc(run.suite)}). <a href="/running">Follow it</a></div>` : ''}${cards}</main>
</body></html>`;
}

function runningPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Running - QA Automation</title><style>${PAGE_STYLE}</style></head><body>
<header><h1>Running ${esc(run.suite)} on ${esc(run.platform)}</h1><p id="state">Starting…</p></header>
<main><div class="card"><div id="done"></div><pre id="log"></pre></div></main>
<script>
function poll(){fetch('/status',{cache:'no-store'}).then(r=>r.json()).then(s=>{
  var log=document.getElementById('log');log.textContent=s.log.join('\\n');log.scrollTop=log.scrollHeight;
  var secs=Math.round((Date.now()-s.startedAt)/1000);
  if(s.active){document.getElementById('state').textContent='Running… '+secs+'s';setTimeout(poll,3000);return;}
  document.getElementById('state').textContent=s.exitCode===0?'Finished — every test passed':'Finished — some tests failed (exit '+s.exitCode+')';
  document.getElementById('done').innerHTML='<a class="btn gold" href="/'+s.platform+'/">Open the report</a><a class="btn" href="/">Back</a>';
}).catch(()=>setTimeout(poll,5000));}
poll();
</script></body></html>`;
}

function serveStatic(urlPath, res) {
  let rel = decodeURIComponent(urlPath);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(SITE, rel));
  if (!file.startsWith(SITE + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<p>No report here yet — run a suite first. <a href="/">Back</a></p>');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const html = (body, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
    };

    if (url.pathname === '/') return html(homePage());
    if (url.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(run));
    }
    if (url.pathname === '/running') return html(runningPage());
    if (url.pathname === '/run') {
      const platform = url.searchParams.get('platform');
      const suite = url.searchParams.get('suite') || 'all';
      if (!PLATFORMS[platform] || !(suite === 'all' || SUITES.some((s) => s.id === suite))) {
        return html('<p>Unknown platform or suite. <a href="/">Back</a></p>', 400);
      }
      if (!run.active) startRun(platform, suite);
      res.writeHead(302, { Location: '/running' });
      return res.end();
    }
    return serveStatic(url.pathname, res);
  })
  .listen(PORT, () => console.log(`QA dashboard: http://localhost:${PORT}`));
