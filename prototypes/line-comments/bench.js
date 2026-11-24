#!/usr/bin/env node
// Times what the user waits for in review.js: startup to the first frame, keys, the 2-second file check, and the
// project picker. It drives the snapshot mode with --timing and reports the median of several runs.
//
//   node prototypes/line-comments/bench.js [repo ...] [--runs 5] [--json out.json] [--fixture <folder>]
//
// With no repo it builds a large synthetic repo (2000 files, 400 changed, one 20000-line file, binary files, 20 repos
// next to it for the picker) in --fixture, or in a temp folder. An existing --fixture is reused, so runs before and
// after a change time the same repo. It never writes to a repo you pass.
//
// ms is the wait from the key to its frame. busy is the part of it the main thread worked, when typed keys wait too.
// In a repo with no changes the picker opens at start, so there only the startup and picker rows mean anything.
'use strict';
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REVIEW = path.join(__dirname, 'review.js');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const RUNS = +opt('--runs', 5);
const repos = argv.filter((a, i) => !a.startsWith('--') && !['--runs', '--json', '--fixture'].includes(argv[i - 1]));

function fixture() {
  const dir = opt('--fixture') ? path.resolve(opt('--fixture')) : fs.mkdtempSync(path.join(os.tmpdir(), 'review-bench-'));
  if (fs.existsSync(path.join(dir, 'big', '.git'))) return path.join(dir, 'big');
  console.log(`Building the fixture in ${dir}`);
  const mk = (name) => {
    const r = path.join(dir, name);
    fs.mkdirSync(r, { recursive: true });
    const git = (...a) => execFileSync('git', ['-C', r, '-c', 'user.name=b', '-c', 'user.email=b@b', ...a]);
    git('init', '-q');
    return { r, git };
  };
  const { r, git } = mk('big');
  const body = (i, n, v) => Array.from({ length: n }, (_, j) => (j % 60 === 7 && v ? `  const v${j} = ${v}; // edited` : `export function f${i}_${j}(a: number): number { return a * ${j} + ${i}; }`)).join('\n') + '\n';
  const file = (i) => path.join(r, `src/mod${i % 25}/sub${i % 7}/file${i}.ts`);
  for (let i = 0; i < 2000; i++) { fs.mkdirSync(path.dirname(file(i)), { recursive: true }); fs.writeFileSync(file(i), body(i, 300)); }
  fs.writeFileSync(path.join(r, 'src/huge.ts'), body(9999, 20000));
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(r, `asset${i}.bin`), Buffer.alloc(8 << 20, i));
  git('add', '.');
  git('commit', '-qm', 'init');
  for (let i = 0; i < 2000; i += 5) fs.writeFileSync(file(i), body(i, 300, 'edited'));
  fs.writeFileSync(path.join(r, 'src/huge.ts'), body(9999, 20000, 'edited'));
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(r, `asset${i}.bin`), Buffer.alloc(8 << 20, i + 1));
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(r, `new${i}.ts`), body(i, 50));
  for (let i = 0; i < 20; i++) {
    const s = mk(`side${i}`);
    fs.writeFileSync(path.join(s.r, 'a.txt'), 'a\n');
    s.git('add', '.');
    s.git('commit', '-qm', 'init');
    if (i % 2) fs.writeFileSync(path.join(s.r, 'a.txt'), 'b\n');
  }
  return r;
}

// Each scenario is a key list. `pick` names the keys whose times it reports. wait:<ms> lets background work run, as
// a person reading the screen would.
const down = (n) => Array(n).fill('down');
const SCENARIOS = [
  { name: 'startup to first frame', keys: [], startup: true },
  { name: 'open Review (tab) at once', keys: ['tab'], pick: [0] },
  { name: 'open Review (tab) after 1s', keys: ['wait:1000', 'tab'], pick: [1] },
  { name: 'Review: next file in list', keys: ['tab', ...down(30)], pick: range(1, 31) },
  { name: 'Review: move down in code', keys: ['tab', 'right', ...down(30)], pick: range(2, 32) },
  { name: 'Review: page down in code', keys: ['tab', 'right', ...Array(10).fill('pgdn')], pick: range(2, 12) },
  { name: 'Explorer: next file in tree', keys: down(20), pick: range(0, 20) },
  { name: 'Explorer: move down in code', keys: ['right', ...down(30)], pick: range(1, 31) },
  { name: 'poll file check, no change', keys: Array(6).fill('tick'), pick: range(1, 6) },
  { name: 'open project picker (o)', keys: ['o', 'esc', 'o', 'esc', 'o'], pick: [0, 2, 4] },
];
function range(a, b) { return Array.from({ length: b - a }, (_, i) => a + i); }
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };

function run(repo, keys) {
  const env = { ...process.env };
  delete env.HERDR_ENV;
  delete env.HERDR_PANE_ID;
  const t = process.hrtime.bigint();
  const res = spawnSync('node', [REVIEW, repo, '--snapshot', '--plain', '--dry-run', '--timing', '--cols', '120', '--rows', '30', '--keys', keys.join(',')], { encoding: 'utf8', env, maxBuffer: 1 << 26 });
  const wall = Number(process.hrtime.bigint() - t) / 1e6;
  const line = res.stderr.trim().split('\n').pop();
  if (res.status !== 0 || !line) throw new Error(`review.js failed on ${repo}: ${res.stderr}`);
  return { ...JSON.parse(line), wall };
}

const results = [];
const targets = repos.length ? repos.map((r) => path.resolve(r.replace(/^~(?=\/|$)/, os.homedir()))) : [fixture()];
console.log(`${'repo'.padEnd(14)} ${'scenario'.padEnd(30)} ${'ms'.padStart(8)} ${'busy ms'.padStart(8)}  bytes`);
for (const repo of targets) {
  for (const sc of SCENARIOS) {
    const ms = [], busy = [], bytes = [];
    let phases;
    for (let i = 0; i < RUNS; i++) {
      const t = run(repo, sc.keys);
      if (sc.startup) { ms.push(t.startup.frame); busy.push(t.startup.frame); phases = t.startup; continue; }
      const ks = sc.pick.map((j) => t.keys[j]);
      ms.push(median(ks.map((k) => k.ms)));
      busy.push(median(ks.map((k) => k.busy)));
      bytes.push(median(ks.map((k) => k.bytes)));
    }
    const row = { repo: path.basename(repo), scenario: sc.name, ms: +median(ms).toFixed(1), busy: +median(busy).toFixed(1), min: +Math.min(...ms).toFixed(1), max: +Math.max(...ms).toFixed(1), bytes: median(bytes), phases };
    results.push(row);
    console.log(`${row.repo.padEnd(14)} ${sc.name.padEnd(30)} ${String(row.ms).padStart(8)} ${String(row.busy).padStart(8)}  ${sc.startup ? JSON.stringify(phases) : row.bytes}`);
  }
}
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify({ node: process.version, runs: RUNS, results }, null, 2));
