'use strict';
// Drives the snapshot harness and checks that code lines wider than the pane scroll sideways.
const { test, before } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REVIEW = path.join(__dirname, 'review.js');
const LONG = `const x = "${'A'.repeat(40)}MIDDLE${'B'.repeat(40)}END";`;
let repo;

before(() => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scroll-test-')));
  repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.js'), 'short\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  fs.writeFileSync(path.join(repo, 'a.js'), `short\n${LONG}\n`);
});

function run(...keys) {
  const env = { ...process.env };
  delete env.HERDR_ENV;
  delete env.HERDR_PANE_ID;
  const out = execFileSync('node', [REVIEW, repo, '--snapshot', '--plain', '--dry-run', '--cols', '90', '--rows', '10',
    '--keys', keys.join(',')], { encoding: 'utf8', env });
  const lines = out.split('\n');
  return { screen: out, long: lines.find((l) => / 2 \+ /.test(l)), short: lines.find((l) => / 1 {3}/.test(l)) };
}
const wheel = (btn) => `\x1b[<${btn};60;4M`;

test('a long line is cut at the edge before scrolling', () => {
  const { long } = run();
  assert.match(long, /2 \+ const x = "A+M?…$/);
  assert.doesNotMatch(long, /MIDDLE/);
});

test('L scrolls right by 8 columns and H back, with a ‹ in front of the code', () => {
  const right = run('L', 'L', 'L', 'L', 'L');
  assert.match(right.long, /2 \+ ‹A+MIDDLE/);
  assert.match(right.short, /1 {3}‹/);
  assert.strictEqual(run('L', 'H').long, run().long);
});

test('scrolling stops when the end of the longest line is in view', () => {
  const far = run(...Array(20).fill('L'));
  assert.match(far.long, /END";\s*│?\s*$/);
  assert.strictEqual(run(...Array(30).fill('L')).long, far.long);
});

test('a sideways swipe and shift with the wheel scroll by 4 columns', () => {
  assert.strictEqual(run(wheel(67), wheel(67)).long, run('L').long);
  assert.strictEqual(run(wheel(69), wheel(69), wheel(68)).long, run(wheel(67)).long);
  assert.strictEqual(run(wheel(66)).long, run().long);
});

test('0 goes back to the start of the lines', () => {
  assert.strictEqual(run('L', 'L', '0').long, run().long);
});

test('H, L and 0 are typed into an open comment', () => {
  const { long, screen } = run('right', 'c', 'text:HL0');
  assert.match(screen, /HL0▏/);
  assert.match(long, /const x = "A/);
});
