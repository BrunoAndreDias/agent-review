'use strict';
// Drives the snapshot harness and checks range and whole-file comments: card titles, the footer, and the message.
const { test, before } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REVIEW = path.join(__dirname, 'review.js');
let repo;

// f.txt has two hunks (lines 1-4 and 17-20), g.txt follows it in Review, z/ is an unchanged folder.
before(() => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'comments-test-')));
  repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'z'), { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q');
  const lines = Array.from({ length: 20 }, (_, i) => `l${i + 1}`);
  fs.writeFileSync(path.join(repo, 'f.txt'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(repo, 'g.txt'), 'x\n');
  fs.writeFileSync(path.join(repo, 'z', 'h.txt'), 'h\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  lines[0] = 'L1';
  lines[19] = 'L20';
  fs.writeFileSync(path.join(repo, 'f.txt'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(repo, 'g.txt'), 'X\n');
});

function run(...keys) {
  const env = { ...process.env };
  delete env.HERDR_ENV;
  delete env.HERDR_PANE_ID;
  const out = execFileSync('node', [REVIEW, repo, '--snapshot', '--plain', '--dry-run', '--cols', '120', '--rows', '40',
    '--keys', keys.join(',')], { encoding: 'utf8', env });
  const lines = out.trimEnd().split('\n');
  // The preview draws each line of the message with a leading space and pads it to the width.
  const message = lines.map((l) => l.slice(1).trimEnd()).join('\n');
  return { header: lines[0], footer: lines[lines.length - 1], screen: out, message };
}
// Review starts with the cursor on f.txt's header row. Rows below it: @@, -l1, +L1, l2, l3, l4, @@, l17, l18, l19, -l20, +L20.
const review = (downs) => ['tab', 'right', ...Array(downs).fill('down')];
const L2 = review(4), L4 = review(6), L20 = review(12);

test('↑↓ in a new comment grow it down, and the title and footer follow', () => {
  const open = run(...L2, 'c', 'down', 'down');
  assert.match(open.screen, /✎ New comment · L2–4/);
  assert.match(open.footer, /Commenting on f\.txt L2–4 .*↑↓ cover more or fewer lines/);
  const saved = run(...L2, 'c', 'down', 'down', 'text:grown', 'enter', 'p');
  assert.match(saved.message, /- lines 2-4: `l2 …`\n  grown/);
});

test('grow up keeps the line it was opened on', () => {
  const { screen, footer } = run(...L4, 'c', 'up', 'up', 'text:up', 'enter');
  assert.match(screen, /◆ You · L2–4/);
  assert.doesNotMatch(footer, /Commenting/);
});

test('the far end moves back, so the range shrinks', () => {
  assert.match(run(...L2, 'c', 'down', 'down', 'up').footer, /f\.txt L2–3 /);
});

test('grow skips @@ rows', () => {
  assert.match(run(...L4, 'c', 'down').footer, /f\.txt L4–17 /);
});

test('grow stops at the end of the file and does not cross into the next one in Review', () => {
  const { footer, screen } = run(...L20, 'c', 'down', 'down', 'down');
  assert.match(footer, /Commenting on f\.txt L20 /);
  assert.match(screen, /✎ New comment · L20 /);
});

test('a double-click opens a comment that grows', () => {
  // y=6 is the row of l2 in Review.
  const { footer } = run('tab', 'click@50:6', 'release@50:6', 'click@50:6', 'release@50:6', 'down');
  assert.match(footer, /Commenting on f\.txt L2–3 /);
});

test('a V selection or an edit keeps its range under ↑↓', () => {
  const vis = run(...L2, 'V', 'down', 'c', 'down', 'down');
  assert.match(vis.footer, /Commenting on f\.txt L2–3 /);
  assert.doesNotMatch(vis.footer, /↑↓/);
  const edit = run(...L2, 'c', 'down', 'text:a', 'enter', 'up', 'e', 'down', 'down');
  assert.match(edit.footer, /Editing f\.txt L2–3 /);
});

test('a click on @@ selects the hunk, and c or enter comments on it', () => {
  const sel = run('tab', 'click@50:3', 'release@50:3');
  assert.match(sel.footer, /Hunk selected, 5 lines/);
  for (const key of ['c', 'enter']) {
    const { screen } = run('tab', 'click@50:3', 'release@50:3', key, 'text:hunk', 'enter');
    assert.match(screen, /◆ You · L1–4/);
  }
});

test('c on a file in the Explorer tree comments the whole file', () => {
  const open = run('c');
  assert.match(open.footer, /Commenting on f\.txt whole file/);
  assert.match(open.screen, /✎ New comment · whole file/);
  const { screen } = run('c', 'text:needs tests', 'enter');
  assert.match(screen, /◆ You · whole file/);
  assert.match(screen, /f\.txt +◆1 M/);
});

test('c on a folder in the tree does nothing', () => {
  const { header, footer } = run('up', 'c');
  assert.doesNotMatch(footer, /Commenting/);
  assert.match(header, /0 comments/);
});

test('c on a file in the Review changes list comments that file', () => {
  const { message } = run('tab', 'down', 'c', 'text:gee', 'enter', 'p');
  assert.match(message, /## g\.txt\n- the whole file:\n  gee/);
});

test('C comments the whole file from the code', () => {
  assert.match(run(...L4, 'C').footer, /Commenting on f\.txt whole file/);
  assert.match(run('right', 'C').footer, /Commenting on f\.txt whole file/);
});

test('C in the kitty keyboard format works the same', () => {
  assert.match(run(...L4, '\x1b[99;2u').footer, /Commenting on f\.txt whole file/);
});

test('enter on a file header in Review opens its comment', () => {
  assert.match(run('tab', 'right', 'enter').footer, /Commenting on f\.txt whole file/);
});

test('a click on the Review file header or the Explorer path bar opens the file comment', () => {
  assert.match(run('tab', 'click@50:2', 'release@50:2').footer, /Commenting on f\.txt whole file/);
  assert.match(run('click@50:2', 'release@50:2').footer, /Commenting on f\.txt whole file/);
});

test('a second c on a file edits its comment instead of adding one', () => {
  const again = run('c', 'text:one', 'enter', 'c');
  assert.match(again.footer, /Editing f\.txt whole file/);
  assert.match(again.screen, /✎ Edit comment · whole file/);
  const { message } = run('c', 'text:one', 'enter', 'c', 'text: two', 'enter', 'p');
  assert.match(message, /- the whole file:\n  one two/);
  assert.strictEqual(message.match(/the whole file/g).length, 1);
  assert.match(run('c', 'text:one', 'enter', 'C').footer, /Editing f\.txt whole file/);
});

test('on the file card, e and enter edit it and x deletes it', () => {
  const save = ['tab', 'right', 'C', 'text:card', 'enter'];
  assert.match(run(...save, 'e').footer, /Editing f\.txt whole file/);
  assert.match(run(...save, 'enter').footer, /Editing f\.txt whole file/);
  const { header, screen } = run(...save, 'x');
  assert.match(header, /0 comments/);
  assert.doesNotMatch(screen, /whole file/);
});

test('the message lists the file comment first, then line comments in line order', () => {
  const { message } = run(...L4, 'c', 'text:four', 'enter', 'up', 'up', 'c', 'text:two', 'enter', 'C', 'text:file', 'enter', 'p');
  const at = (s) => message.indexOf(s);
  assert.ok(at('- the whole file:') > at('## f.txt'));
  assert.ok(at('- the whole file:') < at('- line 2:'));
  assert.ok(at('- line 2:') < at('- line 4:'));
});
