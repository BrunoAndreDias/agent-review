#!/usr/bin/env node
// Throwaway prototype for agent-review. Zero deps. Three layouts behind keys 1, 2, 3.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const has = (n) => argv.includes(n);
const root = path.resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : '.');
const project = path.basename(root);
const DRY = has('--snapshot') || has('--dry-run');

const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
try { git('rev-parse', '--git-dir'); } catch { console.error(`Not a git repository: ${root}`); process.exit(1); }
let BASE = opt('--base');
if (!BASE) { try { BASE = git('rev-parse', '--verify', 'HEAD').trim(); } catch { BASE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; } }

// ---------- data ----------
let data;
const cache = new Map();

function untrackedFiles() { return git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean); }

function signature() {
  let s = git('diff', '--no-color', BASE);
  for (const p of untrackedFiles()) { try { s += p + fs.statSync(path.join(root, p)).mtimeMs; } catch {} }
  return s;
}

function load(sig) {
  const changed = new Map();
  const untracked = new Set();
  const parts = git('diff', '--name-status', '-z', BASE).split('\0');
  for (let i = 0; i < parts.length; ) {
    const s = parts[i++];
    if (!s) continue;
    if (s[0] === 'R' || s[0] === 'C') { i++; changed.set(parts[i++], 'R'); }
    else changed.set(parts[i++], s[0] === 'T' ? 'M' : s[0]);
  }
  for (const p of untrackedFiles()) { changed.set(p, 'A'); untracked.add(p); }
  const files = new Set(git('ls-files', '--cached', '-z').split('\0').filter(Boolean));
  for (const p of changed.keys()) files.add(p);
  data = { changed, untracked, changedList: [...changed.keys()].sort(), tree: buildTree([...files].sort(), changed), sig: sig ?? signature() };
  cache.clear();
}

function readText(abs) {
  try {
    const b = fs.readFileSync(abs);
    if (b.includes(0)) return null;
    const t = b.toString('utf8').split('\n');
    if (t[t.length - 1] === '') t.pop();
    return t;
  } catch { return ['(unreadable)']; }
}

function parseDiff(d, full) {
  const rows = [];
  let o = 0, n = 0, inHunk = false;
  for (const line of d.split('\n')) {
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      o = +m[1]; n = +m[2]; inHunk = true;
      if (!full) rows.push({ k: 'hunk', t: line });
      continue;
    }
    if (!inHunk) { if (line.startsWith('Binary')) rows.push({ k: 'info', t: '(binary file changed)' }); continue; }
    if (line.startsWith('+')) rows.push({ k: 'add', t: line.slice(1), n: n++ });
    else if (line.startsWith('-')) rows.push({ k: 'del', t: line.slice(1), o: o++ });
    else if (line.startsWith(' ')) rows.push({ k: 'ctx', t: line.slice(1), o: o++, n: n++ });
  }
  if (!rows.length) rows.push({ k: 'info', t: '(no textual changes)' });
  return rows;
}

function rowsFor(p, full) {
  const key = p + (full ? '#full' : '#diff');
  if (cache.has(key)) return cache.get(key);
  const abs = path.join(root, p);
  let out;
  if (data.untracked.has(p)) {
    const txt = readText(abs);
    out = txt === null ? [{ k: 'info', t: '(binary file)' }] : [...(full ? [] : [{ k: 'hunk', t: 'new file' }]), ...txt.map((t, i) => ({ k: 'add', t, n: i + 1 }))];
  } else if (data.changed.has(p)) {
    out = parseDiff(git('diff', full ? '-U1000000' : '-U3', '--no-color', BASE, '--', p), full);
  } else {
    const txt = readText(abs);
    out = txt === null ? [{ k: 'info', t: '(binary file)' }] : txt.map((t, i) => ({ k: 'ctx', t, n: i + 1, o: i + 1 }));
  }
  cache.set(key, out);
  return out;
}

function stats(p) {
  let a = 0, d = 0;
  for (const r of rowsFor(p, false)) { if (r.k === 'add') a++; else if (r.k === 'del') d++; }
  return [a, d];
}

// ---------- comments ----------
let comments = [];
const sent = [];
const anchorOf = (r) => (r.k === 'add' || r.k === 'ctx' ? { side: 'new', line: r.n } : r.k === 'del' ? { side: 'old', line: r.o } : null);
const commentsFor = (p) => comments.filter((c) => c.p === p);

function fileDoc(p, full) {
  const out = [];
  const cs = commentsFor(p);
  for (const r of rowsFor(p, full)) {
    out.push({ ...r, p });
    const a = anchorOf(r);
    if (a) for (const c of cs) if (c.side === a.side && c.line === a.line) out.push({ k: 'cmt', p, t: c.text, c });
  }
  return out;
}

function compose() {
  const by = new Map();
  for (const c of comments) { if (!by.has(c.p)) by.set(c.p, []); by.get(c.p).push(c); }
  const out = [`Review of your changes in ${project}. Please address each comment:`, ''];
  for (const [p, cs] of by) {
    out.push(`## ${p}`);
    for (const c of cs.sort((x, y) => x.line - y.line)) {
      out.push(`- line ${c.line}${c.side === 'old' ? ' (removed line, old numbering)' : ''}: \`${c.snippet.slice(0, 120)}\``);
      out.push(`  ${c.text}`);
    }
    out.push('');
  }
  return out.join('\n').trim();
}

// ---------- tree ----------
function buildTree(files, changed) {
  const top = { name: project, path: '', dir: true, kids: new Map() };
  for (const f of files) {
    let node = top;
    const parts = f.split('/');
    parts.forEach((part, i) => {
      if (!node.kids.has(part)) node.kids.set(part, { name: part, path: parts.slice(0, i + 1).join('/'), dir: i < parts.length - 1, kids: new Map() });
      node = node.kids.get(part);
    });
  }
  const count = (n) => (n.changed = n.dir ? [...n.kids.values()].reduce((s, k) => s + count(k), 0) : changed.has(n.path) ? 1 : 0);
  count(top);
  return top;
}
const kidsOf = (n) => [...n.kids.values()].filter((k) => !st.onlyChanged || k.changed).sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name));
function flatTree() {
  const out = [];
  const walk = (n, d) => { for (const k of kidsOf(n)) { out.push({ node: k, depth: d }); if (k.dir && st.expanded.has(k.path)) walk(k, d + 1); } };
  walk(data.tree, 0);
  return out;
}
function findNode(p) {
  let n = data.tree;
  if (!p) return n;
  for (const part of p.split('/')) { n = n.kids.get(part); if (!n) return null; }
  return n;
}

// ---------- state ----------
const st = {
  variant: +(opt('--variant') || 1), onlyChanged: false, expanded: new Set(), viewed: new Set(),
  a: { focus: 'tree', sel: 0, top: 0, cur: 0, vtop: 0, full: false, path: null },
  b: { focus: 'view', sel: 0, cur: 0, top: 0 },
  input: null, picker: null, preview: null, msg: '', msgAt: 0, pageH: 20,
};
const flash = (m) => { st.msg = m; st.msgAt = Date.now(); };

// ---------- rendering ----------
const E = '\x1b[', R = '\x1b[0m';
const C = {
  add: E + '48;5;22m', del: E + '48;5;52m', hunk: E + '36m', cmt: E + '48;5;17m' + E + '38;5;225m',
  file: E + '1m' + E + '48;5;236m', title: E + '1m' + E + '48;5;235m', dim: E + '2m', border: E + '38;5;240m',
  bold: E + '1m', on: E + '7m' + E + '1m', M: E + '33m', A: E + '32m', D: E + '31m', R: E + '36m',
  mark: E + '38;5;214m', markDim: E + '38;5;244m', badge: E + '35m', bar: E + '48;5;234m', warn: E + '1m' + E + '33m',
};
const fit = (s, w) => { s = s.replace(/\t/g, '  '); return w <= 0 ? '' : s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w); };
const tail = (s, w) => (s.length > w ? '…' + s.slice(s.length - w + 1) : s);
const paint = (s, w, style = '') => style + fit(s, w) + R;
const paintSel = (s, w, style, sel, focused = true) =>
  sel ? (focused ? C.mark : C.markDim) + '▌' + R + style + C.bold + fit(s.slice(1), w - 1) + R : paint(s, w, style);
const scroll = (cur, top, h) => (cur < top ? cur : cur >= top + h ? cur - h + 1 : top);
const clamp = (i, n) => Math.max(0, Math.min(n - 1, i));

function rowText(r) {
  const num = (x) => String(x ?? '').padStart(5);
  switch (r.k) {
    case 'add': return [` ${num(r.n)} + ${r.t}`, C.add];
    case 'del': return [` ${num(r.o)} - ${r.t}`, C.del];
    case 'ctx': return [` ${num(r.n)}   ${r.t}`, ''];
    case 'hunk': return [`       ${r.t}`, C.hunk];
    case 'cmt': return [`         ▍ ${r.t}`, C.cmt];
    case 'info': return [`       ${r.t}`, C.dim];
    case 'file': {
      const [a, d] = stats(r.p), cc = commentsFor(r.p).length, v = st.viewed.has(r.p);
      return [` ${v ? '✓' : ' '} ${data.changed.get(r.p)}  ${r.p}   +${a} -${d}${cc ? `   ◆${cc}` : ''}${v ? '   viewed (v to reopen)' : ''}`, C.file];
    }
    default: return [' ', ''];
  }
}
function docLines(doc, cur, top, h, w, focused) {
  const out = [];
  for (let i = 0; i < h; i++) {
    const r = doc[top + i];
    if (!r) { out.push(paint('', w)); continue; }
    const [t, s] = rowText(r);
    out.push(paintSel(t, w, s, top + i === cur, focused));
  }
  return out;
}
function treeLine(n, depth, w, sel, focused, flat = false) {
  const icon = n.dir ? (!flat && st.expanded.has(n.path) ? '▾ ' : '▸ ') : '  ';
  const cc = n.dir ? 0 : commentsFor(n.path).length;
  const badge = (cc ? `◆${cc} ` : '') + (n.dir ? (n.changed ? `${n.changed}●` : '') : data.changed.get(n.path) || '');
  const label = ` ${'  '.repeat(depth)}${icon}${n.name}${n.dir ? '/' : ''}`;
  const style = n.dir ? (n.changed ? C.bold : C.dim) : C[data.changed.get(n.path)] || C.dim;
  return paintSel(fit(label, w - badge.length - 1) + badge + ' ', w, style, sel, focused);
}

const docA = () => (st.a.path ? fileDoc(st.a.path, st.a.full) : []);
const docB = () => data.changedList.flatMap((p) => [{ k: 'file', p }, ...(st.viewed.has(p) ? [] : fileDoc(p, false)), { k: 'gap', p }]);

function renderA(W, h) {
  const a = st.a;
  const drawer = comments.length ? Math.min(comments.length, 5) + 1 : 0;
  const mh = h - drawer;
  const lw = Math.max(24, Math.min(44, Math.floor(W * 0.3))), rw = W - lw - 1;
  const rows = flatTree();
  a.sel = clamp(a.sel, rows.length);
  a.top = scroll(a.sel, a.top, mh);
  const left = [];
  for (let i = 0; i < mh; i++) {
    const idx = a.top + i, r = rows[idx];
    left.push(r ? treeLine(r.node, r.depth, lw, idx === a.sel, a.focus === 'tree') : paint('', lw));
  }
  const doc = docA();
  a.cur = clamp(a.cur, doc.length);
  a.vtop = scroll(a.cur, a.vtop, mh - 1);
  st.pageH = mh - 1;
  const mode = a.path && data.changed.has(a.path) ? (a.full ? 'full file' : 'diff') : 'unchanged';
  const right = [paint(a.path ? ` ${a.path}  ·  ${mode}` : ' Select a file', rw, C.title), ...docLines(doc, a.cur, a.vtop, mh - 1, rw, a.focus === 'view')];
  const out = left.map((l, i) => l + C.border + '│' + R + right[i]);
  if (drawer) {
    out.push(paint(` Comments (${comments.length})  ·  s send  ·  p preview`, W, C.title));
    for (const c of comments.slice(-5)) out.push(paint(`   ◆ ${c.p}:${c.line}  ${c.text}`, W, C.badge));
  }
  return out;
}

function renderB(W, h) {
  const b = st.b, list = data.changedList;
  const lw = Math.max(24, Math.min(48, Math.floor(W * 0.32))), rw = W - lw - 1;
  const doc = docB();
  b.cur = clamp(b.cur, doc.length);
  b.top = scroll(b.cur, b.top, h);
  st.pageH = h;
  const curFile = doc[b.cur]?.p;
  if (b.focus === 'view' && curFile) b.sel = list.indexOf(curFile);
  b.sel = clamp(b.sel, list.length);
  const left = [paint(` Changed files (${list.length})`, lw, C.title)];
  const ltop = scroll(b.sel, 0, h - 1);
  for (let i = 0; i < h - 1; i++) {
    const idx = ltop + i, p = list[idx];
    if (!p) { left.push(paint(list.length || i ? '' : '  No changes against base', lw, C.dim)); continue; }
    const [a, d] = stats(p), cc = commentsFor(p).length, v = st.viewed.has(p);
    const right = `${cc ? `◆${cc} ` : ''}+${a} -${d} `;
    left.push(paintSel(fit(` ${v ? '✓' : ' '} ${data.changed.get(p)} ${tail(p, lw - right.length - 6)}`, lw - right.length) + right, lw, v ? C.dim : C[data.changed.get(p)] || '', idx === b.sel, b.focus === 'list'));
  }
  const right = docLines(doc, b.cur, b.top, h, rw, b.focus === 'view');
  return left.map((l, i) => l + C.border + '│' + R + right[i]);
}

function header(W) {
  const names = ['Explorer', 'Review'];
  const left = ' agent-review ';
  const tabs = names.map((n) => ` ${n} `);
  const right = ` ${project} · base ${BASE.slice(0, 7)} · ${data.changedList.length} changed · ${comments.length} comments${st.onlyChanged ? ' · changed only' : ''} `;
  const used = left.length + tabs.join('').length;
  const gap = Math.max(1, W - used - right.length);
  return C.title + left + R + tabs.map((t, i) => (i + 1 === st.variant ? C.on : C.title) + t + R).join('') + paint(' '.repeat(gap) + right, W - used, C.title);
}

const HINTS = {
  1: 'tab Review · ↑↓ move · enter open · ← back · d diff/full · c comment · x delete · n next change · f changed only · s send · q quit',
  2: 'tab Explorer · ↑↓ move · ←→ files/diffs · v mark viewed · c comment · x delete · n next change · s send · p preview · q quit',
};
function footer(W) {
  if (st.input) {
    const i = st.input;
    const where = i.edit ? `edit ${i.edit.p}:${i.edit.line}` : `${i.anchor.p}:${i.anchor.line}`;
    return paint(` ✎ ${where} › ${i.text}▏   enter save · esc cancel`, W, C.title);
  }
  if (st.msg) return paint(` ${st.msg}`, W, C.warn);
  return paint(` ${HINTS[st.variant]}`, W, C.dim);
}

function frame(W, H) {
  if (st.preview) {
    const pv = st.preview;
    pv.top = clamp(pv.top, pv.lines.length);
    const body = pv.lines.slice(pv.top, pv.top + H - 2).map((l) => paint(' ' + l, W));
    while (body.length < H - 2) body.push(paint('', W));
    return [paint(' Message the agent will receive', W, C.title), ...body, paint(' j/k scroll · s send · esc close', W, C.title)];
  }
  const lines = [header(W), ...[renderA, renderB][st.variant - 1](W, H - 2), footer(W)];
  if (st.picker) {
    const p = st.picker;
    const box = [paint(` ${p.title}   enter choose · esc cancel`, W, C.title), ...p.items.map((it, i) => paintSel(`   ${it.label}`, W, C.bar, i === p.sel)), paint('', W, C.bar)];
    const y0 = Math.max(1, Math.floor((H - box.length) / 2));
    box.forEach((l, i) => { if (y0 + i < H - 1) lines[y0 + i] = l; });
  }
  return lines;
}

// ---------- actions ----------
const isChange = (r) => !!r && (r.k === 'add' || r.k === 'del');
function move(list, cur, k, page) {
  switch (k) {
    case 'down': return Math.min(list.length - 1, cur + 1);
    case 'up': return Math.max(0, cur - 1);
    case 'pgdn': return Math.min(list.length - 1, cur + page);
    case 'pgup': return Math.max(0, cur - page);
    case 'top': return 0;
    case 'bottom': return Math.max(0, list.length - 1);
    case 'n': for (let i = cur + 1; i < list.length; i++) if (isChange(list[i]) && !isChange(list[i - 1])) return i; return cur;
    case 'N': for (let i = cur - 1; i >= 0; i--) if (isChange(list[i]) && !isChange(list[i - 1])) return i; return cur;
  }
  return null;
}
const firstChange = (doc) => Math.max(0, doc.findIndex(isChange));

function docKey(doc, cur, k) {
  const r = doc[cur];
  if (!r) return;
  if (k === 'c') {
    if (r.k === 'cmt') { st.input = { text: r.c.text, edit: r.c }; return; }
    const a = anchorOf(r);
    if (!a) return flash('Move to a code line to comment');
    st.input = { text: '', anchor: { p: r.p, ...a, snippet: r.t.trim() } };
  } else if (k === 'x' && r.k === 'cmt') {
    comments = comments.filter((c) => c !== r.c);
    flash('Comment deleted');
  }
}

function toggleDir(p, force) { if (force || !st.expanded.has(p)) st.expanded.add(p); else st.expanded.delete(p); }
function selectA(r) { if (r && !r.node.dir && r.node.path !== st.a.path) Object.assign(st.a, { path: r.node.path, cur: 0, vtop: 0 }); }

function keyA(k) {
  const a = st.a;
  if (k === 'd') { a.full = !a.full; a.cur = a.full ? firstChange(docA()) : 0; a.vtop = Math.max(0, a.cur - 5); return; }
  if (a.focus === 'tree') {
    const rows = flatTree(), r = rows[a.sel];
    const m = move(rows, a.sel, k, st.pageH);
    if (m !== null) { a.sel = m; selectA(rows[m]); return; }
    if (!r) return;
    if (k === 'enter' || k === 'right') { if (r.node.dir) toggleDir(r.node.path, k === 'right'); else a.focus = 'view'; }
    else if (k === 'left') {
      if (r.node.dir && st.expanded.has(r.node.path)) st.expanded.delete(r.node.path);
      else { const pi = rows.findIndex((x) => x.node.path === path.dirname(r.node.path)); if (pi >= 0) a.sel = pi; }
    }
    return;
  }
  if (k === 'left' || k === 'esc') { a.focus = 'tree'; return; }
  const doc = docA();
  const m = move(doc, a.cur, k, st.pageH);
  if (m !== null) a.cur = m; else docKey(doc, a.cur, k);
}

function keyB(k) {
  const b = st.b, list = data.changedList;
  const jump = (p) => { const i = docB().findIndex((r) => r.k === 'file' && r.p === p); if (i >= 0) { b.cur = i; b.top = i; } };
  const doc = docB();
  if (k === 'v') {
    const p = b.focus === 'list' ? list[b.sel] : doc[b.cur]?.p;
    if (!p) return;
    if (st.viewed.has(p)) { st.viewed.delete(p); jump(p); }
    else { st.viewed.add(p); jump(b.focus === 'view' ? list[list.indexOf(p) + 1] || p : p); }
    return;
  }
  if (b.focus === 'list') {
    const m = move(list, b.sel, k, st.pageH);
    if (m !== null) { b.sel = m; jump(list[m]); return; }
    if (k === 'enter' || k === 'right') b.focus = 'view';
    return;
  }
  if (k === 'left' || k === 'esc') { b.focus = 'list'; return; }
  const m = move(doc, b.cur, k, st.pageH);
  if (m !== null) b.cur = m; else docKey(doc, b.cur, k);
}

function agents() {
  try { return JSON.parse(execFileSync('herdr', ['agent', 'list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).result.agents; }
  catch { return []; }
}
function sendTo(a) {
  if (DRY) return flash(`(dry run) would send ${comments.length} comment(s) to ${a.pane_id}`);
  try {
    execFileSync('herdr', ['agent', 'prompt', a.pane_id, compose()], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const n = comments.length;
    sent.push(...comments);
    comments = [];
    flash(`Sent ${n} comment(s) to ${a.agent} [${a.pane_id}]`);
  } catch (e) { flash(`Send failed: ${String(e.stderr || e.stdout || e.message).trim().slice(0, 200)}`); }
}
function openSend() {
  if (!comments.length) return flash('No comments yet. Press c on a line to add one');
  const mine = (a) => (a.cwd || '').startsWith(root);
  const items = agents()
    .filter((a) => a.pane_id !== process.env.HERDR_PANE_ID)
    .sort((x, y) => mine(y) - mine(x))
    .map((a) => ({ label: `${a.agent_status.padEnd(8)} ${a.agent}  ${a.terminal_title_stripped || ''}  [${a.pane_id}]${mine(a) ? '  · this project' : ''}`, run: () => sendTo(a) }));
  items.push({ label: 'Copy to clipboard', run: () => { execFileSync('pbcopy', { input: compose() }); flash('Copied review to clipboard'); } });
  items.push({ label: 'Preview message', run: () => { st.preview = { lines: compose().split('\n'), top: 0 }; } });
  st.picker = { title: `Send ${comments.length} comment(s) to`, items, sel: 0 };
}

function reload(manual) {
  const sig = signature();
  if (!manual && sig === data.sig) return false;
  load(sig);
  flash(manual ? 'Reloaded' : 'Files changed on disk. Reloaded');
  return true;
}

function handleInput(raw) {
  const inp = st.input;
  if (raw === '\r' || raw === '\n') {
    const t = inp.text.trim();
    if (inp.edit) { if (t) inp.edit.text = t; else comments = comments.filter((c) => c !== inp.edit); }
    else if (t) comments.push({ ...inp.anchor, text: t });
    st.input = null;
  } else if (raw === '\x1b' || raw === '\x03') st.input = null;
  else if (raw === '\x7f' || raw === '\b') inp.text = inp.text.slice(0, -1);
  else if (!raw.startsWith('\x1b')) inp.text += raw.replace(/[\x00-\x1f]/g, ' ');
}

const KEYS = {
  '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left', '\x1bOA': 'up', '\x1bOB': 'down', '\x1bOC': 'right', '\x1bOD': 'left',
  '\r': 'enter', '\n': 'enter', '\t': 'tab', '\x1b': 'esc', '\x7f': 'bs', '\b': 'bs', '\x1b[5~': 'pgup', '\x1b[6~': 'pgdn',
  j: 'down', k: 'up', h: 'left', l: 'right', g: 'top', G: 'bottom', ' ': 'pgdn',
};
function handle(raw) {
  if (raw === '\x03') return quit();
  if (st.input) return handleInput(raw);
  const k = KEYS[raw] || raw;
  if (st.msg && Date.now() - st.msgAt > 1500) st.msg = '';
  if (st.preview) {
    if (k === 'down') st.preview.top++;
    else if (k === 'up') st.preview.top--;
    else if (k === 's') { st.preview = null; openSend(); }
    else if (k === 'esc' || k === 'q' || k === 'p') st.preview = null;
    return;
  }
  if (st.picker) {
    const p = st.picker;
    if (k === 'down') p.sel = Math.min(p.items.length - 1, p.sel + 1);
    else if (k === 'up') p.sel = Math.max(0, p.sel - 1);
    else if (k === 'esc' || k === 'q') st.picker = null;
    else if (k === 'enter') { st.picker = null; p.items[p.sel].run(); }
    return;
  }
  if (k === 'q') return quit();
  if (k === 'tab' || (k === '1' && st.variant === 2) || (k === '2' && st.variant === 1)) { toggleMode(); return; }
  if (k === 's') return openSend();
  if (k === 'p') { if (comments.length) st.preview = { lines: compose().split('\n'), top: 0 }; else flash('No comments yet'); return; }
  if (k === 'r') { reload(true); return; }
  if (k === 'f') { st.onlyChanged = !st.onlyChanged; return; }
  [keyA, keyB][st.variant - 1](k);
}

// Explorer and Review share one cursor: switching keeps the file, and the line when it exists in both.
function sameRow(doc, r) {
  if (!r) return -1;
  const a = anchorOf(r);
  return doc.findIndex((x) => x.p === r.p && (a ? x.k === r.k && anchorOf(x)?.line === a.line : x.k === 'file'));
}
function revealA(p) {
  for (let d = path.dirname(p); d !== '.'; d = path.dirname(d)) st.expanded.add(d);
  st.a.path = p;
  st.a.sel = Math.max(0, flatTree().findIndex((x) => x.node.path === p));
}
function toggleMode() {
  if (st.variant === 1) {
    const r = docA()[st.a.cur];
    st.variant = 2;
    const doc = docB();
    let i = st.a.focus === 'view' ? sameRow(doc, r) : -1;
    if (i < 0 && st.a.path) i = doc.findIndex((x) => x.k === 'file' && x.p === st.a.path);
    if (i >= 0) { st.b.cur = i; st.b.top = Math.max(0, i - 5); }
    st.b.focus = st.a.focus === 'tree' ? 'list' : 'view';
    if (st.a.path && data.changed.has(st.a.path)) st.b.sel = data.changedList.indexOf(st.a.path);
    flash('Review: every changed file, stacked');
  } else {
    const r = st.b.focus === 'list' ? { k: 'file', p: data.changedList[st.b.sel] } : docB()[st.b.cur];
    st.variant = 1;
    if (r?.p) {
      revealA(r.p);
      st.a.cur = Math.max(0, sameRow(docA(), r));
      st.a.vtop = Math.max(0, st.a.cur - 5);
    }
    st.a.focus = st.b.focus === 'list' ? 'tree' : 'view';
    flash('Explorer: browse the whole project');
  }
}

// ---------- main ----------
load();
(function init() {
  const walk = (n) => { for (const k of n.kids.values()) if (k.dir && k.changed) { st.expanded.add(k.path); walk(k); } };
  walk(data.tree);
  const rows = flatTree();
  const i = rows.findIndex((r) => !r.node.dir && r.node.changed);
  if (i >= 0) { st.a.sel = i; st.a.path = rows[i].node.path; }
})();

const TOKEN_RE = /\x1b\[[0-9;]*[~A-Za-z]|\x1bO[A-D]|\x1b|[\s\S]/g;
const TOK = { down: '\x1b[B', up: '\x1b[A', left: '\x1b[D', right: '\x1b[C', enter: '\r', tab: '\t', esc: '\x1b', bs: '\x7f', space: ' ' };

if (has('--snapshot')) {
  const W = +(opt('--cols') || 120), H = +(opt('--rows') || 32);
  frame(W, H);
  for (const tok of (opt('--keys') || '').split(',').filter(Boolean)) {
    if (tok.startsWith('text:')) for (const ch of tok.slice(5)) handle(ch);
    else handle(TOK[tok] ?? tok);
    frame(W, H);
  }
  let out = frame(W, H).join('\n');
  if (has('--plain')) out = out.replace(/\x1b\[[0-9;]*m/g, '');
  console.log(out);
  process.exit(0);
}

const tty = process.stdout;
function quit() {
  tty.write('\x1b[?25h\x1b[?1049l');
  if (comments.length) console.log('Unsent review comments:\n\n' + compose());
  process.exit(0);
}
const draw = () => tty.write('\x1b[H' + frame(tty.columns || 100, tty.rows || 30).join('\r\n'));
tty.write('\x1b[?1049h\x1b[?25l\x1b[2J');
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
process.stdin.on('data', (chunk) => { for (const t of chunk.match(TOKEN_RE) || []) handle(t); draw(); });
tty.on('resize', () => { tty.write('\x1b[2J'); draw(); });
setInterval(() => {
  try { if (!st.input && reload(false)) draw(); } catch {}
  if (st.msg && Date.now() - st.msgAt > 4000) { st.msg = ''; draw(); }
}, 2000);
draw();
