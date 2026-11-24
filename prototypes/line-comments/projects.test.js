'use strict';
// Drives the snapshot harness and checks the project picker: what it lists, switching, and the comments each project keeps.
const { test, before } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REVIEW = path.join(__dirname, 'review.js');
let dir;

function repo(name, change) {
  const r = path.join(dir, name);
  fs.mkdirSync(r, { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', r, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q');
  fs.writeFileSync(path.join(r, `${path.basename(name)}.js`), 'a\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  if (change) fs.writeFileSync(path.join(r, `${path.basename(name)}.js`), 'a\nb\n');
  return r;
}

before(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'projects-test-')));
  repo('work', true);
  repo('other', true);
  repo('quiet', false);
  repo('far/away', true); // not next to work, so only --projects finds it
  fs.mkdirSync(path.join(dir, 'notes'));
});

function run(start, keys, ...flags) {
  const env = { ...process.env };
  delete env.HERDR_ENV;
  delete env.HERDR_PANE_ID;
  const out = execFileSync('node', [REVIEW, path.join(dir, start), '--snapshot', '--plain', '--dry-run', '--cols', '110', '--rows', '14',
    '--keys', keys.join(','), ...flags], { encoding: 'utf8', env });
  const lines = out.trimEnd().split('\n');
  return { header: lines[0], footer: lines[lines.length - 1], screen: out, rows: lines.filter((l) => /^ {3}[● ] \S/.test(l)).map((l) => l.trim().replace(/^● /, '● ')) };
}
const names = (rows) => rows.map((r) => r.replace(/^● /, '').split(/\s+/)[0]);

test('o lists the current project first, then the ones with changes, then the clean ones', () => {
  const { rows, screen } = run('work', ['o']);
  assert.match(screen, /Review project/);
  assert.deepStrictEqual(names(rows), ['work', 'other', 'quiet']);
  assert.match(rows[0], /^● work/);
  assert.match(rows[1], /1 changed/);
  assert.match(rows[2], /clean/);
});

test('--projects adds the repos in another folder', () => {
  assert.ok(names(run('work', ['o'], '--projects', path.join(dir, 'far')).rows).includes('away'));
});

test('choosing a project shows its changes', () => {
  const { header, footer, screen } = run('work', ['o', 'down', 'enter']);
  assert.match(header, /other ▾ · 1 changed/);
  assert.match(footer, /Reviewing other · 1 changed/);
  assert.match(screen, /other\.js/);
  assert.doesNotMatch(screen, /work\.js/);
});

test('each project keeps its comments while another one is shown', () => {
  const comment = ['tab', 'right', 'down', 'c', 'text:check this', 'enter'];
  const away = run('work', [...comment, 'esc', 'o', 'down', 'enter']);
  assert.match(away.header, /other ▾ .* 0 comments/);
  const back = run('work', [...comment, 'esc', 'o', 'down', 'enter', 'o']);
  assert.match(back.rows.find((r) => r.startsWith('work')), /◆1$/);
  const home = run('work', [...comment, 'esc', 'o', 'down', 'enter', 'o', 'down', 'enter']);
  assert.match(home.header, /work ▾ .* 1 comments/);
  assert.match(home.footer, /1 comments kept/);
});

test('a click on the project name or on agent-review opens the picker', () => {
  const x = run('work', []).header.indexOf('work ▾') + 1;
  assert.match(run('work', [`click@${x}:1`]).screen, /Review project/);
  assert.match(run('work', [`click@${x + 5}:1`]).screen, /Review project/);
  assert.match(run('work', ['click@3:1']).screen, /Review project/);
  assert.doesNotMatch(run('work', [`click@${x - 3}:1`]).screen, /Review project/);
});

test('tab goes Explorer, Review, the project picker, then Explorer again', () => {
  const picker = run('work', ['tab', 'tab']);
  assert.match(picker.screen, /Review project/);
  assert.match(picker.header, /work ▴/);
  const back = run('work', ['tab', 'tab', 'tab']);
  assert.doesNotMatch(back.screen, /Review project/);
  assert.match(back.header, /▎Explorer/);
});

test('started in a repo with no changes, it opens the picker on its own', () => {
  assert.match(run('quiet', []).screen, /Review project/);
  assert.match(run('quiet', ['enter']).footer, /Reviewing (work|other) · 1 changed/);
  assert.doesNotMatch(run('work', []).screen, /Review project/);
});
