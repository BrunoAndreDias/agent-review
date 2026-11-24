'use strict';
// Drives the snapshot harness and checks the resizable side panel: the divider, dragging it, [ ] and =.
const { test, before } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REVIEW = path.join(__dirname, 'review.js');
const LONG = 'NotificationPreferencesPanel.tsx';
let repo;

before(() => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'panel-test-')));
  repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'src', 'settings'), { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.js'), 'a\n');
  fs.writeFileSync(path.join(repo, 'src', 'settings', LONG), 'x\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  fs.writeFileSync(path.join(repo, 'a.js'), 'a\nb\n');
  fs.writeFileSync(path.join(repo, 'src', 'settings', LONG), 'x\ny\n');
});

function run(...keys) {
  const env = { ...process.env };
  delete env.HERDR_ENV;
  delete env.HERDR_PANE_ID;
  const out = execFileSync('node', [REVIEW, repo, '--snapshot', '--plain', '--dry-run', '--cols', '100', '--rows', '12',
    '--keys', keys.join(',')], { encoding: 'utf8', env });
  const lines = out.trimEnd().split('\n');
  const body = lines.slice(1, -1);
  // The column of the divider, found by the ↔ it draws on its middle row.
  const grip = body.find((l) => l.includes('↔'));
  return { body, footer: lines[lines.length - 1], screen: out, divider: grip ? grip.indexOf('↔') : -1, panel: body.map((l) => l.slice(0, grip?.indexOf('↔'))) };
}
const move = (x, y) => `\x1b[<35;${x};${y}M`;

test('the divider shows a ↔ on its middle row', () => {
  const { body, divider } = run();
  assert.strictEqual(divider, 30);
  assert.strictEqual(body.filter((l) => l.includes('↔')).length, 1);
  assert.strictEqual(body.findIndex((l) => l.includes('↔')), Math.floor(body.length / 2));
});

test('dragging the divider sets the width, and the drag lights it up', () => {
  const held = run('click@31:4', 'drag@51:4');
  assert.ok(held.body.every((l) => l[50] === '┃'));
  const done = run('click@31:4', 'drag@51:4', 'release@51:4');
  assert.strictEqual(done.divider, 50);
  assert.match(done.footer, /Panel width 50/);
  assert.ok(done.panel.some((l) => l.includes(LONG)));
});

test('a click on the divider does not open or select anything', () => {
  const { divider, body } = run('click@31:4', 'release@31:4');
  assert.strictEqual(divider, 30);
  assert.ok(body.every((l) => !l.includes('┃')));
});

test('] and [ change the width by 4, and both views share it', () => {
  assert.strictEqual(run(']', ']').divider, 38);
  assert.strictEqual(run(']', ']', '[').divider, 34);
  assert.strictEqual(run(']', ']', 'tab').divider, 38);
});

test('= fits the panel to the longest name', () => {
  const tree = run('=');
  assert.ok(tree.panel.some((l) => l.includes(LONG + ' M')));
  assert.ok(tree.panel.every((l) => !l.includes('…')));
  const list = run('tab', '=');
  assert.ok(list.panel.some((l) => l.includes(`${LONG} src/settings +1 -0 M`)));
});

test('the width stays between 16 columns and 30 columns short of the screen', () => {
  assert.strictEqual(run(...Array(10).fill('[')).divider, 16);
  assert.strictEqual(run('click@31:4', 'drag@99:4', 'release@99:4').divider, 70);
});

test('hovering the divider lights it up, and moving off turns it back', () => {
  assert.ok(run(move(31, 4)).body.every((l) => l[30] === '┃'));
  assert.strictEqual(run(move(31, 4), move(60, 4)).divider, 30);
});

test('[ ] and = type into an open comment instead of resizing', () => {
  const { divider, footer } = run('tab', 'right', 'down', 'down', 'c', 'text:[=]');
  assert.strictEqual(divider, 32);
  assert.match(footer, /Commenting on/);
});
