/* Headless UI regression harness for solar-system.html
 *
 * Loads the page in headless Chrome with a set of URL states and asserts that
 *   - no uncaught exception is logged
 *   - the expected number of body rows rendered
 *   - the clock and detail panel actually populated
 *
 * These are the exact failure modes that were found in review: an unvalidated
 * link, an out-of-range date, and a hidden frame centre.
 *
 * usage: node verify-ui.js
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PAGE = 'file:///' + path.join(__dirname, 'solar-system.html').replace(/\\/g, '/').replace(/ /g, '%20');

function findChrome(){
  const cands = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('no Chrome/Edge found; set CHROME_PATH');
}

const CHROME = findChrome();

/* hash -> expectations. `rows` counts .bodyRow elements (the frame centre row
   carries extra classes, so match the class prefix, not the exact attribute). */
const CASES = [
  { name: 'default boot',              hash: '#center=earth',                     rows: 10, live: true  },
  { name: 'malformed jd',              hash: '#jd=abc',                           rows: 10, live: true  },
  { name: 'jd beyond ISO range',       hash: '#jd=999999999',                     rows: 10, live: true  },
  { name: 'malformed speed',           hash: '#speed=abc',                        rows: 10, live: true  },
  { name: 'malformed trail length',    hash: '#trail=abc',                        rows: 10, live: true  },
  { name: 'malformed camera',          hash: '#dist=abc&yaw=zzz&pitch=qqq',       rows: 10, live: true  },
  { name: 'hidden centre (pluto)',     hash: '#center=pluto',                     rows: 11, live: true  },
  { name: 'hidden centre (moon)',      hash: '#center=moon&showMoon=0',           rows: 10, live: true  },
  { name: 'pluto shown',               hash: '#showPluto=1&center=sun',           rows: 11, live: true  },
  { name: 'moon hidden',               hash: '#showMoon=0&center=earth',          rows: 9,  live: true  },
  { name: 'paused + real scale',       hash: '#pause=1&compress=0&center=sun',    rows: 10, live: false },
  { name: 'nonsense hash entirely',    hash: '#%%%&=&center=&&jd=NaN',            rows: 10, live: true  },
  { name: 'out-of-range epoch year',   hash: '#date=1700-01-01&pause=1',          rows: 10, live: false }
];

let pass = 0, fail = 0;
for (const c of CASES){
  const profile = path.join(os.tmpdir(), 'dshui' + Math.random().toString(36).slice(2));
  let out = '';
  try {
    out = execFileSync(CHROME, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + profile, '--enable-logging=stderr',
      '--virtual-time-budget=2500', '--dump-dom', PAGE + c.hash
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, timeout: 60000 });
  } catch (e){
    out = (e.stdout || '') + (e.stderr || '');
  }
  const errs = [...new Set((out.match(/Uncaught [^"\\\r\n]{0,70}/g) || []))];
  const rows = (out.match(/class="bodyRow/g) || []).length;
  const date = (out.match(/id="dateText"[^>]*>([^<]*)</) || [])[1] || '';
  const title = (out.match(/id="detailTitle"[^>]*>([^<]*)</) || [])[1] || '';

  const problems = [];
  if (errs.length) problems.push('exception: ' + errs.join('; '));
  if (rows !== c.rows) problems.push(`body rows ${rows} != ${c.rows}`);
  if (!date || date === '—') problems.push("clock shows '" + date + "'");
  if (!title || title === '详情') problems.push("detail panel empty ('" + title + "')");

  if (problems.length){ fail++; console.log(`*FAIL  ${c.name}\n        ` + problems.join('\n        ')); }
  else { pass++; console.log(` PASS  ${c.name}`); }
}
console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
