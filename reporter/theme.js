/** Shared look for the dashboard and landing page (same palette as Pixel Automation). */

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDuration(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  // Reports are read in India; show IST explicitly.
  return `${d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })} IST`;
}

const STATUS = {
  passed: { icon: '✓', label: 'PASS', cls: 'ok' },
  failed: { icon: '✕', label: 'FAIL', cls: 'bad' },
  skipped: { icon: '–', label: 'SKIPPED', cls: 'skip' },
};

function badge(state) {
  const s = STATUS[state] || STATUS.failed;
  return `<span class="badge ${s.cls}"><b aria-hidden="true">${s.icon}</b>${s.label}</span>`;
}

const STYLE = `
:root{--gold:#f1ae13;--navy:#243e60;--navy-deep:#1b2f4a;--ink:#303030;--body:#505050;
  --muted:#7e7e7e;--line:#e5e5e5;--bg:#f8f8f8;--card:#fff;--ok:#157a4f;--ok-soft:#eaf6f0;
  --bad:#c0392b;--bad-soft:#fdecea;--skip:#5d6b80;--skip-soft:#eef1f6;--code:#f4f5f7;
  --font:"Plus Jakarta Sans","Segoe UI",-apple-system,Roboto,Helvetica,Arial,sans-serif}
@media (prefers-color-scheme:dark){:root{--ink:#eceff4;--body:#c9d1dc;--muted:#97a3b4;--line:#2c3746;
  --bg:#121821;--card:#1a2230;--ok:#4cc38a;--ok-soft:#173528;--bad:#f07a6c;--bad-soft:#3b1f1c;
  --skip:#a9b4c4;--skip-soft:#252f3e;--code:#111722}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--body);font-family:var(--font);line-height:1.55;font-size:14px}
a{color:inherit}
header{background:linear-gradient(135deg,var(--navy),var(--navy-deep));color:#fff;padding:40px 24px 36px;
  position:relative;overflow:hidden}
header:after{content:"";position:absolute;right:-70px;top:-70px;width:240px;height:240px;border-radius:50%;
  background:var(--gold);opacity:.13}
.wrap{max-width:1080px;margin:0 auto;position:relative}
.brandmark{display:inline-flex;align-items:center;gap:8px;font-weight:800;font-size:13px;color:#fff;text-decoration:none}
.brandmark i{width:10px;height:10px;border-radius:2px;background:var(--gold);transform:rotate(45deg)}
h1{margin:14px 0 6px;font-size:28px;font-weight:800;letter-spacing:-.5px;color:#fff}
header p{margin:0;color:#b9c4d4;font-size:13.5px}
header nav{margin-top:14px;display:flex;gap:16px;flex-wrap:wrap;font-size:13px;font-weight:700}
header nav a{color:#fff;text-decoration:none;border-bottom:2px solid var(--gold)}
main{max-width:1080px;margin:0 auto;padding:24px 24px 60px;display:grid;gap:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;
  box-shadow:0 1px 3px rgba(36,62,96,.05)}
h2{margin:0;font-size:18px;font-weight:800;color:var(--ink)}
h3{margin:0 0 8px;font-size:13px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:.05em}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;border-top:3px solid var(--line)}
.kpi b{display:block;font-size:28px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}
.kpi span{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.kpi.ok{border-top-color:var(--ok)}.kpi.bad{border-top-color:var(--bad)}.kpi.skip{border-top-color:var(--skip)}
.kpi.gold{border-top-color:var(--gold)}
.verdict{padding:13px 16px;border-radius:10px;font-weight:700}
.verdict.ok{background:var(--ok-soft);color:var(--ok)}.verdict.bad{background:var(--bad-soft);color:var(--bad)}
.verdict.skip{background:var(--skip-soft);color:var(--skip)}
.badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;letter-spacing:.04em;
  border-radius:999px;padding:3px 10px;white-space:nowrap}
.badge b{font-weight:900}
.badge.ok{background:var(--ok-soft);color:var(--ok)}.badge.bad{background:var(--bad-soft);color:var(--bad)}
.badge.skip{background:var(--skip-soft);color:var(--skip)}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
  padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.suite-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.suite-head small{color:var(--muted);font-size:12px}
details.test{border:1px solid var(--line);border-radius:10px;margin-top:8px;background:var(--card)}
details.test>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;padding:11px 14px}
details.test>summary::-webkit-details-marker{display:none}
details.test>summary:before{content:"▸";color:var(--muted);font-size:12px}
details.test[open]>summary:before{content:"▾"}
.t-title{flex:1;font-weight:600;color:var(--ink)}
.t-group{display:block;font-weight:500;font-size:11.5px;color:var(--muted)}
.t-dur{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.t-body{padding:4px 16px 16px;display:grid;gap:14px;border-top:1px solid var(--line)}
.kv{display:grid;grid-template-columns:170px 1fr;gap:6px 14px;font-size:13px;margin-top:12px}
.kv dt{color:var(--muted);font-weight:600}.kv dd{margin:0;color:var(--ink)}
ul.checks{list-style:none;margin:0;padding:0;display:grid;gap:4px}
ul.checks li{display:flex;gap:8px;align-items:baseline}
.mark{font-weight:900;width:14px;flex:none}.mark.ok{color:var(--ok)}.mark.bad{color:var(--bad)}.mark.skip{color:var(--skip)}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px}
pre.err{margin:0;white-space:pre-wrap;word-break:break-word;background:var(--bad-soft);color:var(--ink);
  border-left:3px solid var(--bad);padding:10px 12px;border-radius:6px;font-size:12px;max-height:280px;overflow:auto}
.shots{display:flex;gap:10px;flex-wrap:wrap}
.shots img{width:260px;max-width:100%;border:1px solid var(--line);border-radius:8px;display:block}
.muted{color:var(--muted)}
footer{max-width:1080px;margin:0 auto;padding:0 24px 40px;color:var(--muted);font-size:12px}
@media(max-width:640px){header,main,footer{padding-left:16px;padding-right:16px}h1{font-size:23px}
  .kv{grid-template-columns:1fr}.kv dt{margin-top:6px}}
`;

function shell(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${STYLE}</style></head>
<body>${body}</body></html>`;
}

module.exports = { esc, fmtDuration, fmtTime, badge, STATUS, shell };
