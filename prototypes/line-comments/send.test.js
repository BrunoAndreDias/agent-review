'use strict';
// Drives the snapshot harness and checks what the user sees in the header and footer.
const { test, before } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REVIEW = path.join(__dirname, 'review.js');
const COMMENT = 'tab,right,enter,text:hello,enter';
let dir, repo;

before(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'send-test-')));
  repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nb\nc\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nB\nc\n');
});

const agent = (o) => ({
  agent: o.agent || 'claude', agent_session: { value: o.session || 's1' }, agent_status: o.status || 'idle',
  completion_seq: o.seq, cwd: o.cwd || '/elsewhere', pane_id: o.pane || 'w1:p9',
});
let n = 0;
function agents(...list) {
  const f = path.join(dir, `agents-${n++}.json`);
  fs.writeFileSync(f, JSON.stringify({ result: { agents: list } }));
  return f;
}
function run(file, keys, target = 'w1:p9') {
  const env = { ...process.env };
  delete env.HERDR_ENV;
  delete env.HERDR_PANE_ID;
  const out = execFileSync('node', [REVIEW, repo, '--snapshot', '--plain', '--dry-run', '--cols', '120',
    '--agents-json', file, '--target', target, '--keys', keys.filter(Boolean).join(',')], { encoding: 'utf8', env });
  const lines = out.trimEnd().split('\n');
  return { header: lines[0], footer: lines[lines.length - 1], screen: out };
}

const idle = (o = {}) => agent({ status: 'idle', seq: 5, ...o });
const working = (o = {}) => agent({ status: 'working', ...o });

test('binds to the agent in the --target pane', () => {
  const { header } = run(agents(idle({ session: 'a', pane: 'w1:p3', cwd: repo }), idle()), []);
  assert.match(header, /→ claude \[w1:p9\] idle/);
});

test('falls back to the first agent working in the repo', () => {
  const sibling = idle({ session: 'a', pane: 'w1:p2', cwd: `${repo}-other` });
  const { header } = run(agents(sibling, idle({ session: 'b', pane: 'w1:p3', cwd: path.join(repo, 'sub') })), [], 'w1:p1');
  assert.match(header, /→ claude \[w1:p3\] idle/);
});

test('with no agent, the header says so and s opens the picker', () => {
  const file = agents(idle({ cwd: '/elsewhere' }));
  assert.match(run(file, [], 'w1:p1').header, /→ no agent \(t\)/);
  const { screen } = run(file, [COMMENT, 's'], 'w1:p1');
  assert.match(screen, /Send 1 comment\(s\) to/);
  assert.match(screen, /Copy to clipboard/);
});

test('s with no comments only shows a message', () => {
  const { header, footer } = run(agents(idle()), ['s']);
  assert.match(footer, /No comments yet/);
  assert.match(header, /→ claude \[w1:p9\] idle/);
});

test('s while the agent is idle sends at once', () => {
  const { header, footer } = run(agents(idle()), [COMMENT, 's']);
  assert.match(footer, /would send 1 comment\(s\) to claude \[w1:p9\]/);
  assert.match(header, /working on your review/);
});

test('s while the agent is working queues, and a poll that finds it idle delivers', () => {
  const queued = run(agents(working()), [COMMENT, 's']);
  assert.match(queued.header, /→ claude \[w1:p9\] review queued \(u\)/);
  assert.match(queued.footer, /goes out when it is idle/);

  const stillWorking = run(agents(working()), [COMMENT, 's', 'poll']);
  assert.match(stillWorking.header, /review queued/);

  const delivered = run(agents(working()), [COMMENT, 's', `agents=${agents(idle())}`, 'poll']);
  assert.match(delivered.footer, /would send 1 comment\(s\)/);
  assert.match(delivered.header, /working on your review/);
});

test('s twice sends now', () => {
  const { header, footer } = run(agents(working()), [COMMENT, 's', 's']);
  assert.match(footer, /would send 1 comment\(s\)/);
  assert.match(header, /working on your review/);
});

test('u cancels a queued review and keeps the comments', () => {
  const { header, footer } = run(agents(working()), [COMMENT, 's', 'u', `agents=${agents(idle())}`, 'poll']);
  assert.match(footer, /Queued review cancelled/);
  assert.match(header, /1 comments · → claude \[w1:p9\] idle/);
});

test('after a send, the header follows the agent until it is done', () => {
  const keys = [COMMENT, 's', `agents=${agents(working())}`, 'poll'];
  assert.match(run(agents(idle({ seq: 5 })), keys).header, /working on your review/);
  keys.push(`agents=${agents(idle({ seq: 9 }))}`, 'poll');
  assert.match(run(agents(idle({ seq: 5 })), keys).header, /done with your review/);
});

test('sent while the agent works, the review is done only after two finished turns', () => {
  const keys = [COMMENT, 's', 's', `agents=${agents(idle({ seq: 7 }))}`, 'poll', 'poll'];
  assert.match(run(agents(working()), keys).header, /working on your review/);
  keys.push(`agents=${agents(working())}`, 'poll');
  assert.match(run(agents(working()), keys).header, /working on your review/);
  keys.push(`agents=${agents(idle({ seq: 8 }))}`, 'poll');
  assert.match(run(agents(working()), keys).header, /done with your review/);
});

test('a bound agent that stops running shows as gone, and s opens the picker', () => {
  const { header } = run(agents(idle()), [`agents=${agents()}`, 'poll']);
  assert.match(header, /→ agent gone \(t\)/);
  const { screen } = run(agents(idle()), [COMMENT, `agents=${agents()}`, 's']);
  assert.match(screen, /Send 1 comment\(s\) to/);
});

test('t rebinds to another agent and cancels a queued review', () => {
  const file = agents(working(), idle({ agent: 'codex', session: 'b', pane: 'w1:p3' }));
  const picker = run(file, [COMMENT, 's', 't']).screen;
  assert.match(picker, /Review goes to/);
  assert.ok(picker.indexOf('● working') < picker.indexOf('codex'), 'the bound agent is listed first and marked');
  const { header } = run(file, [COMMENT, 's', 't', 'down', 'enter']);
  assert.match(header, /→ codex \[w1:p3\] idle/);
  assert.doesNotMatch(header, /queued/);
});
