#!/usr/bin/env node
// Throwaway prototype: three ways to comment on a line or a range of lines. m switches between them.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const has = (n) => argv.includes(n);
let root = path.resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : '.');
// Started from a subfolder (herdr passes the focused pane's folder), review the whole repo.
try { root = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
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
  if (typeof tokCache !== 'undefined') tokCache.clear();
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
// A comment covers lines from..line on one side. It hangs below `line`.
const inRange = (c, a) => !!a && c.side === a.side && a.line >= c.from && a.line <= c.line;
const lineLabel = (c) => (c.from === c.line ? `L${c.line}` : `L${c.from}–${c.line}`);
const commentsAt = (r) => { const a = r && anchorOf(r); return a ? commentsFor(r.p).filter((c) => inRange(c, a)) : []; };
const draftAnchor = () => st.input && (st.input.anchor || st.input.edit);
const CUI = { 1: 'Inline cards', 2: 'Gutter + peek', 3: 'Margin notes' };

function wrap(text, w) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if (line && (line + ' ' + word).length > w) { out.push(line); line = ''; }
      let wd = word;
      while (wd.length > w) { out.push(wd.slice(0, w)); wd = wd.slice(w); }
      line = line ? line + ' ' + wd : wd;
    }
    out.push(line);
  }
  return out;
}

// Inline cards: comment boxes are real rows in the document, so the code below moves down.
function fileDoc(p, full) {
  const out = [];
  const cs = commentsFor(p);
  const inp = st.input;
  const rows = (c, draft) => cardBox(c, draft, boxW(st.docW), false).map((_, n) => ({ k: 'box', p, c, draft, n }));
  for (const r of rowsFor(p, full)) {
    out.push({ ...r, p });
    const a = st.cui === 1 && anchorOf(r);
    if (!a) continue;
    for (const c of cs) if (c.side === a.side && c.line === a.line) out.push(...rows(c, inp?.edit === c));
    const an = inp && !inp.edit && inp.anchor;
    if (an && an.p === p && an.side === a.side && an.line === a.line) out.push(...rows(null, true));
  }
  return out;
}

function compose() {
  const by = new Map();
  for (const c of comments) { if (!by.has(c.p)) by.set(c.p, []); by.get(c.p).push(c); }
  const out = [`Review of your changes in ${project}. Please address each comment:`, ''];
  for (const [p, cs] of by) {
    out.push(`## ${p}`);
    for (const c of cs.sort((x, y) => x.from - y.from)) {
      const where = c.from === c.line ? `line ${c.line}` : `lines ${c.from}-${c.line}`;
      out.push(`- ${where}${c.side === 'old' ? ' (removed, old numbering)' : ''}: \`${c.snippet.slice(0, 120)}\``);
      for (const l of c.text.split('\n')) out.push(`  ${l}`);
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
  cui: +(opt('--cui') || 1), vis: null, drag: null, docW: 80, activeC: null,
};
const flash = (m) => { st.msg = m; st.msgAt = Date.now(); };

// ---------- rendering: VS Code Dark Modern ----------
const E = '\x1b[', R = '\x1b[0m';
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(';');
const fg = (h) => `${E}38;2;${rgb(h)}m`;
const bg = (h) => `${E}48;2;${rgb(h)}m`;
// Values from VS Code's Dark Modern theme. Diff backgrounds are its 20% overlays blended onto #1F1F1F.
const T = {
  editorBg: '#1F1F1F', sideBg: '#181818', border: '#2B2B2B', fg: '#CCCCCC', codeFg: '#D4D4D4', dim: '#9D9D9D',
  lineNo: '#6E7681', lineNoActive: '#CCCCCC', lineHl: '#282828', accent: '#0078D4', link: '#3794FF',
  selBg: '#04395E', selInactiveBg: '#37373D', addBg: '#373D29', delBg: '#4B1818', addGutter: '#2EA043', delGutter: '#F85149',
  M: '#E2C08D', A: '#73C991', D: '#C74E39', R: '#73C991', widgetBg: '#252526', inputBg: '#313131', quickBg: '#222222',
  visBg: '#264F78', boxIdle: '#454545',
};
const C = {
  side: bg(T.sideBg) + fg(T.fg), editor: bg(T.editorBg) + fg(T.codeFg), hunk: bg(T.editorBg) + fg(T.dim) + E + '3m',
  section: bg(T.sideBg) + fg(T.fg) + E + '1m', file: bg(T.sideBg) + fg(T.fg) + E + '1m', title: bg(T.editorBg) + fg(T.dim),
  status: bg(T.sideBg) + fg(T.dim), flash: bg(T.accent) + fg('#FFFFFF'), input: bg(T.inputBg) + fg(T.fg),
  quick: bg(T.quickBg) + fg(T.fg), quickTitle: bg(T.quickBg) + fg(T.fg) + E + '1m', border: bg(T.editorBg) + fg(T.border),
};
const fit = (s, w) => { s = s.replace(/\t/g, '  '); return w <= 0 ? '' : s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w); };
const tail = (s, w) => (s.length > w ? '…' + s.slice(s.length - w + 1) : s);
const paint = (s, w, style = '') => style + fit(s, w) + R;
// A row in the editor: an accent bar in column 0 marks the cursor.
const paintRow = (s, w, style, sel, focused) =>
  sel ? style + fg(focused ? T.accent : T.lineNo) + '▌' + R + style + fit(s.slice(1), w - 1) + R : paint(s, w, style);
// A row in a list: the whole row takes the selection background, like VS Code's lists.
const listRow = (parts, w, sel, focused, back = T.sideBg) => {
  let out = bg(sel ? (focused ? T.selBg : T.selInactiveBg) : back), used = 0;
  for (const [t, color] of parts) {
    if (used >= w) break;
    const s = t.length > w - used ? t.slice(0, w - used - 1) + '…' : t;
    out += fg(color) + s;
    used += s.length;
  }
  return out + ' '.repeat(Math.max(0, w - used)) + R;
};
const scroll = (cur, top, h) => (cur < top ? cur : cur >= top + h ? cur - h + 1 : top);
const clamp = (i, n) => Math.max(0, Math.min(n - 1, i));

// ---------- syntax highlighting (Shiki: VS Code's grammars and the Dark+ token colors Dark Modern uses) ----------
let hl = null;
const LANG = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  json: 'json', jsonc: 'jsonc', md: 'markdown', css: 'css', html: 'html', sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript',
  py: 'python', rs: 'rust', toml: 'toml', yml: 'yaml', yaml: 'yaml', sql: 'sql', go: 'go',
};
async function initHighlighter() {
  try {
    const { createHighlighter } = await import('shiki');
    hl = await createHighlighter({ themes: ['dark-plus'], langs: [...new Set(Object.values(LANG))] });
  } catch { hl = null; }
}
const tokCache = new Map();
function tokensFor(p, side) {
  const key = `${side}:${p}`;
  if (tokCache.has(key)) return tokCache.get(key);
  let toks = null;
  const lang = LANG[path.extname(p).slice(1).toLowerCase()];
  if (hl && lang) {
    let text = null;
    try { text = side === 'old' ? git('show', `${BASE}:${p}`) : fs.readFileSync(path.join(root, p), 'utf8'); } catch {}
    if (text !== null && text.length < 400000) {
      try { toks = hl.codeToTokensBase(text, { lang, theme: 'dark-plus' }); } catch {}
    }
  }
  tokCache.set(key, toks);
  return toks;
}
function codeSegs(r) {
  const old = r.k === 'del';
  const line = tokensFor(r.p, old ? 'old' : 'new')?.[(old ? r.o : r.n) - 1];
  if (line && line.map((t) => t.content).join('') === r.t) return line.map((t) => [t.content, t.color || T.codeFg, t.fontStyle || 0]);
  return [[r.t, T.codeFg, 0]];
}
function codeLine(r, w, sel, focused, vsel) {
  const a = anchorOf(r), cs = commentsAt(r), da = draftAnchor();
  const drafting = da && da.p === r.p && inRange(da, a);
  const back = vsel || drafting ? T.visBg : r.k === 'add' ? T.addBg : r.k === 'del' ? T.delBg : sel ? T.lineHl : T.editorBg;
  let out = bg(back), used = 0;
  const put = (t, color, style = 0) => {
    if (used >= w) return;
    t = t.replace(/\t/g, '  ');
    const s = t.length > w - used ? t.slice(0, w - used - 1) + '…' : t;
    out += fg(color) + (style & 1 ? E + '3m' : '') + (style & 2 ? E + '1m' : '') + s + (style ? E + '22;23m' : '');
    used += s.length;
  };
  // Column 0: cursor bar, or a thin bar on lines a comment covers. Column 1: ◆ where a comment starts, + on the cursor line.
  if (sel) put('▌', focused ? T.accent : T.lineNo); else put(cs.length ? '┃' : ' ', T.link);
  const starts = cs.some((c) => c.from === a.line);
  put(starts ? '◆' : sel && focused ? '+' : ' ', starts ? T.link : T.accent);
  put(String((r.k === 'del' ? r.o : r.n) ?? '').padStart(4) + ' ', sel ? T.lineNoActive : T.lineNo);
  put(r.k === 'add' ? '+ ' : r.k === 'del' ? '- ' : '  ', r.k === 'add' ? T.addGutter : T.delGutter);
  for (const [t, c, s] of codeSegs(r)) put(t, c, s);
  return out + ' '.repeat(Math.max(0, w - used)) + R;
}

// ---------- comment widgets ----------
const boxW = (w) => Math.max(24, Math.min(78, w - 10));
function boxLines(title, body, foot, w, border, back = T.widgetBg) {
  const edge = (l, t, r) => {
    t = t.slice(0, Math.max(0, w - 6));
    return bg(back) + fg(border) + l + '─' + (t ? ' ' + fg(T.fg) + t + ' ' : '──') + fg(border) + '─'.repeat(Math.max(0, w - 5 - t.length)) + r + R;
  };
  return [edge('╭', title, '╮'), ...body.map((t) => bg(back) + fg(border) + '│ ' + fg(T.codeFg) + fit(t, w - 4) + fg(border) + ' │' + R), edge('╰', foot, '╯')];
}
// c is null for a new comment. draft means it is being typed now.
function cardBox(c, draft, w, active) {
  if (draft) {
    const an = draftAnchor();
    return boxLines(`✎ ${c ? 'Edit' : 'New'} comment · ${an ? lineLabel(an) : ''}`, wrap((st.input?.text ?? '') + '▏', w - 4), 'enter save · ctrl-j new line · esc cancel', w, T.accent);
  }
  return boxLines(`◆ You · ${lineLabel(c)}`, wrap(c.text, w - 4), active ? 'e edit · x delete' : '', w, active ? T.accent : T.boxIdle);
}
const indentBox = (s, w, bw, bar = ' ', barColor = T.lineNo) => bg(T.editorBg) + fg(barColor) + bar + ' '.repeat(8) + s + bg(T.editorBg) + ' '.repeat(Math.max(0, w - 9 - bw)) + R;

function docLine(r, w, sel, focused, vsel) {
  switch (r.k) {
    case 'add': case 'del': case 'ctx': return codeLine(r, w, sel, focused, vsel);
    case 'hunk': return paintRow(`        ${r.t}`, w, C.hunk, sel, focused);
    case 'info': return paintRow(`        ${r.t}`, w, C.hunk, sel, focused);
    case 'box': {
      const bw = boxW(st.docW);
      const s = cardBox(r.c, r.draft, bw, !!r.c && st.activeC === r.c)[r.n];
      return indentBox(s, w, bw, sel ? '▌' : ' ', focused ? T.accent : T.lineNo);
    }
    case 'file': {
      const [a, d] = stats(r.p), cc = commentsFor(r.p).length, v = st.viewed.has(r.p), s = data.changed.get(r.p);
      return listRow([[sel ? '▌' : ' ', T.accent], [v ? '✓ ' : '  ', T.A], [`${s}  `, T[s]], [r.p, T.fg], [`   +${a}`, T.A], [` -${d}`, T.D], [cc ? `   ◆${cc}` : '', T.link], [v ? '   viewed, v to reopen' : '', T.dim]], w, false, false, T.sideBg);
    }
    default: return paint('', w, C.editor);
  }
}
function visRange(doc, cur) {
  if (!st.vis || doc[st.vis.i]?.p !== doc[cur]?.p) return null;
  return [Math.min(st.vis.i, cur), Math.max(st.vis.i, cur)];
}
function docLines(doc, cur, top, h, w, focused) {
  const mw = st.cui === 3 ? Math.max(26, Math.min(46, Math.floor(w * 0.34))) : 0;
  const cw = mw ? w - mw - 1 : w;
  st.activeC = doc[cur]?.c || commentsAt(doc[cur])[0] || null;
  const vr = visRange(doc, cur);
  const out = [];
  for (let i = 0; i < h; i++) {
    const idx = top + i, r = doc[idx];
    out.push(r ? docLine(r, cw, idx === cur, focused, !!vr && idx >= vr[0] && idx <= vr[1]) : paint('', cw, C.editor));
  }
  if (st.cui === 2) overlayPeek(out, doc, cur, top, h, w, focused);
  if (mw) { const m = marginLines(doc, top, h, mw); for (let i = 0; i < h; i++) out[i] += sep + m[i]; }
  return out;
}

// Gutter + peek: nothing is inserted into the code. The cursor's comments float over the lines below it.
function overlayPeek(out, doc, cur, top, h, w, focused) {
  const bw = boxW(w);
  let lines = [], idx;
  if (st.input) {
    const an = draftAnchor();
    idx = doc.findIndex((r) => r.p === an.p && anchorOf(r)?.side === an.side && anchorOf(r)?.line === an.line);
    lines = cardBox(st.input.edit || null, true, bw, true);
  } else {
    const cs = focused ? commentsAt(doc[cur]) : [];
    if (!cs.length) return;
    idx = cur;
    for (const c of cs) lines.push(...cardBox(c, false, bw, true));
  }
  if (idx < 0) return;
  let y = idx - top + 1;
  if (y + lines.length > h) y = Math.max(0, idx - top - lines.length);
  lines.forEach((l, j) => { if (y + j >= 0 && y + j < h) out[y + j] = indentBox(l, w, bw); });
}

// Margin notes: a column beside the code, each note level with the first line it covers.
function marginLines(doc, top, h, mw) {
  const blocks = [];
  const inp = st.input, an = inp && !inp.edit && inp.anchor;
  for (let i = 0; i < h; i++) {
    const r = doc[top + i], a = r && anchorOf(r);
    if (!a) continue;
    for (const c of commentsFor(r.p)) if (c.side === a.side && c.from === a.line) blocks.push({ i, c, draft: inp?.edit === c });
    if (an && an.p === r.p && an.side === a.side && an.from === a.line) blocks.push({ i, c: null, draft: true });
  }
  const out = Array(h).fill(null);
  let next = 0;
  for (const b of blocks) {
    const active = b.draft || (b.c && b.c === st.activeC);
    const color = active ? T.accent : T.boxIdle;
    const head = b.draft ? `✎ ${b.c ? 'Edit' : 'New'} · ${lineLabel(draftAnchor())}` : `◆ ${lineLabel(b.c)}`;
    const body = wrap(b.draft ? inp.text + '▏' : b.c.text, mw - 3);
    const rows = [[head, active ? T.link : T.dim], ...body.map((t) => [t, active ? T.fg : T.dim])];
    if (b.draft) rows.push(['enter save · esc cancel', T.dim]);
    else if (active) rows.push(['e edit · x delete', T.dim]);
    rows.push(['', T.dim]);
    let y = Math.max(b.i, next);
    for (const [t, col] of rows) { if (y < h) out[y] = bg(T.sideBg) + fg(color) + (t ? '▎' : ' ') + ' ' + fg(col) + fit(t, mw - 2) + R; y++; }
    next = y;
  }
  return out.map((l) => l ?? paint('', mw, C.side));
}
function treeLine(n, depth, w, sel, focused) {
  const icon = n.dir ? (st.expanded.has(n.path) ? '⌄ ' : '› ') : '  ';
  const s = n.dir ? null : data.changed.get(n.path);
  const color = n.dir ? (n.changed ? T.M : T.fg) : s ? T[s] : T.fg;
  const cc = n.dir ? 0 : commentsFor(n.path).length;
  const badge = n.dir ? (n.changed ? '●' : '') : s || '';
  const label = ` ${'  '.repeat(depth)}${icon}${n.name}`;
  const right = (cc ? `◆${cc} ` : '') + badge + ' ';
  return listRow([[fit(label, w - right.length), color], [cc ? `◆${cc} ` : '', T.link], [badge + ' ', color]], w, sel, focused);
}

const docA = () => (st.a.path ? fileDoc(st.a.path, st.a.full) : []);
const docB = () => data.changedList.flatMap((p) => [{ k: 'file', p }, ...(st.viewed.has(p) ? [] : fileDoc(p, false)), { k: 'gap', p }]);
const sep = C.border + '│' + R;

function renderA(W, h) {
  const a = st.a;
  const drawer = comments.length ? Math.min(comments.length, 5) + 1 : 0;
  const mh = h - drawer;
  const lw = Math.max(24, Math.min(44, Math.floor(W * 0.3))), rw = W - lw - 1;
  st.docW = rw;
  const rows = flatTree();
  a.sel = clamp(a.sel, rows.length);
  a.top = a.free ? Math.max(0, Math.min(a.top, rows.length - mh)) : scroll(a.sel, a.top, mh);
  st.geo = { lw, mh };
  const left = [];
  for (let i = 0; i < mh; i++) {
    const idx = a.top + i, r = rows[idx];
    left.push(r ? treeLine(r.node, r.depth, lw, idx === a.sel, a.focus === 'tree') : paint('', lw, C.side));
  }
  const doc = docA();
  a.cur = clamp(a.cur, doc.length);
  a.vtop = scroll(a.cur, a.vtop, mh - 1);
  st.pageH = mh - 1;
  const mode = a.path && data.changed.has(a.path) ? (a.full ? 'full file' : 'diff') : 'unchanged';
  const crumbs = a.path ? ` ${a.path.split('/').join(' › ')}   ${mode}` : ' Select a file';
  const right = [paint(crumbs, rw, C.title), ...docLines(doc, a.cur, a.vtop, mh - 1, rw, a.focus === 'view')];
  const out = left.map((l, i) => l + sep + right[i]);
  if (drawer) {
    out.push(paint(` COMMENTS (${comments.length})   s send · p preview`, W, C.section));
    for (const c of comments.slice(-5)) out.push(listRow([['   ◆ ', T.link], [`${c.p}:${lineLabel(c)}  `, T.dim], [c.text.replace(/\n/g, ' ⏎ '), T.fg]], W, false, false));
  }
  return out;
}

function renderB(W, h) {
  const b = st.b, list = data.changedList;
  const lw = Math.max(24, Math.min(48, Math.floor(W * 0.32))), rw = W - lw - 1;
  st.docW = rw;
  const doc = docB();
  b.cur = clamp(b.cur, doc.length);
  b.top = scroll(b.cur, b.top, h);
  st.pageH = h;
  const curFile = doc[b.cur]?.p;
  if (b.focus === 'view' && curFile) b.sel = list.indexOf(curFile);
  b.sel = clamp(b.sel, list.length);
  const left = [paint(` CHANGES (${list.length})`, lw, C.section)];
  const ltop = (b.ltop = b.free ? Math.max(0, Math.min(b.ltop || 0, list.length - h + 1)) : scroll(b.sel, b.ltop || 0, h - 1));
  st.geo = { lw, mh: h };
  for (let i = 0; i < h - 1; i++) {
    const idx = ltop + i, p = list[idx];
    if (!p) { left.push(paint(list.length || i ? '' : '  No changes against base', lw, C.side)); continue; }
    const [a, d] = stats(p), cc = commentsFor(p).length, v = st.viewed.has(p), s = data.changed.get(p);
    const right = `${cc ? `◆${cc} ` : ''}+${a} -${d} ${s} `;
    const name = path.basename(p), dir = path.dirname(p) === '.' ? '' : path.dirname(p);
    const avail = lw - right.length - 3;
    const shown = name.length > avail ? name.slice(0, Math.max(0, avail - 1)) + '…' : name;
    const dirPart = dir && avail - shown.length - 2 > 4 ? ' ' + tail(dir, avail - shown.length - 2) : '';
    const pad = ' '.repeat(Math.max(0, avail - shown.length - dirPart.length));
    left.push(listRow([[v ? ' ✓ ' : '   ', T.A], [shown, v ? T.dim : T[s]], [dirPart + pad, T.dim], [cc ? `◆${cc} ` : '', T.link], [`+${a} `, T.A], [`-${d} `, T.D], [`${s} `, T[s]]], lw, idx === b.sel, b.focus === 'list'));
  }
  const right = docLines(doc, b.cur, b.top, h, rw, b.focus === 'view');
  return left.map((l, i) => l + sep + right[i]);
}

// Column positions here are also the mouse targets: Explorer is columns 15-24, Review 25-32.
function header(W) {
  const names = ['Explorer', 'Review'];
  const left = ' agent-review ';
  const right = ` ${project} · base ${BASE.slice(0, 7)} · ${data.changedList.length} changed · ${comments.length} comments · style ${st.cui} ${CUI[st.cui]} (m)${st.onlyChanged ? ' · changed only' : ''} `;
  const tabs = names.map((n, i) => (i + 1 === st.variant
    ? bg(T.editorBg) + fg(T.accent) + '▎' + fg('#FFFFFF') + `${n} `
    : bg(T.sideBg) + fg(T.dim) + ` ${n} `) + R);
  const used = left.length + names.reduce((s, n) => s + n.length + 2, 0);
  return C.status + left + R + tabs.join('') + paint(' '.repeat(Math.max(1, W - used - right.length)) + right, W - used, C.status);
}

const HINTS = {
  1: 'tab Review · ↑↓ move · enter open · ← back · d diff/full · c comment · V select lines · e edit · x delete · m comment style · n next change · f changed only · s send · q quit',
  2: 'tab Explorer · ↑↓ move · ←→ files/diffs · v mark viewed · c comment · V select lines · e edit · x delete · m style · n next change · s send · p preview · q quit',
};
function footer(W) {
  if (st.input) {
    const i = st.input;
    const an = draftAnchor();
    return bg(T.inputBg) + fg(T.accent) + '▌' + paint(`✎ ${i.edit ? 'Editing' : 'Commenting on'} ${an.p} ${lineLabel(an)}   enter save · ctrl-j new line · esc cancel`, W - 1, C.input);
  }
  if (st.msg) return paint(` ${st.msg}`, W, C.flash);
  if (st.vis) return paint(' Selecting lines · ↑↓ extend · c comment on the selection · esc cancel', W, C.flash);
  return paint(` ${HINTS[st.variant]}`, W, C.status);
}

function frame(W, H) {
  if (st.preview) {
    const pv = st.preview;
    pv.top = clamp(pv.top, pv.lines.length);
    const body = pv.lines.slice(pv.top, pv.top + H - 2).map((l) => paint(' ' + l, W, C.editor));
    while (body.length < H - 2) body.push(paint('', W, C.editor));
    return [paint(' Message the agent will receive', W, C.section), ...body, paint(' j/k scroll · s send · esc close', W, C.status)];
  }
  const lines = [header(W), ...[renderA, renderB][st.variant - 1](W, H - 2), footer(W)];
  if (st.picker) {
    const p = st.picker;
    const box = [paint(` ${p.title}   enter choose · esc cancel`, W, C.quickTitle), ...p.items.map((it, i) => listRow([[`   ${it.label}`, T.fg]], W, i === p.sel, true, T.quickBg)), paint('', W, C.quick)];
    const y0 = Math.max(1, Math.floor((H - box.length) / 2));
    st.geo.py = y0;
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

// The lines a new comment covers: the V/drag selection if there is one, else the cursor line.
function selRange(doc, cur) {
  const vr = visRange(doc, cur) || [cur, cur];
  const rows = doc.slice(vr[0], vr[1] + 1).filter((r) => anchorOf(r));
  if (!rows.length) return null;
  const side = anchorOf(rows[rows.length - 1]).side;
  const mine = rows.filter((r) => anchorOf(r).side === side);
  const lines = mine.map((r) => anchorOf(r).line);
  return { p: mine[0].p, side, from: Math.min(...lines), line: Math.max(...lines), snippet: mine[0].t.trim() + (mine.length > 1 ? ' …' : '') };
}
function docKey(doc, cur, k) {
  const r = doc[cur];
  if (!r) return;
  const here = r.c || commentsAt(r)[0];
  if (k === 'V') { st.vis = st.vis ? null : { i: cur }; return; }
  if (k === 'c') {
    if (r.k === 'box' && r.c) { st.input = { text: r.c.text, edit: r.c }; return; }
    const an = selRange(doc, cur);
    st.vis = null;
    if (!an) return flash('Move to a code line to comment');
    st.input = { text: '', anchor: an };
  } else if (k === 'e' && here) st.input = { text: here.text, edit: here };
  else if (k === 'x' && here) { comments = comments.filter((c) => c !== here); flash('Comment deleted'); }
}

function toggleDir(p, force) { if (force || !st.expanded.has(p)) st.expanded.add(p); else st.expanded.delete(p); }
function selectA(r) { if (r && !r.node.dir && r.node.path !== st.a.path) { st.vis = null; Object.assign(st.a, { path: r.node.path, cur: 0, vtop: 0 }); } }

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

function jumpB(p) {
  const i = docB().findIndex((r) => r.k === 'file' && r.p === p);
  if (i >= 0) { st.b.cur = i; st.b.top = i; }
}
function jumpToComment(c) {
  if (st.variant !== 1) toggleMode();
  revealA(c.p);
  st.a.focus = 'view';
  const at = (r) => r.p === c.p && anchorOf(r)?.side === c.side && anchorOf(r)?.line === c.line;
  let i = docA().findIndex(at);
  if (i < 0) { st.a.full = true; i = docA().findIndex(at); }
  st.a.cur = Math.max(0, i);
  st.a.vtop = Math.max(0, st.a.cur - 5);
}

// b: 0 left click, 64 wheel up, 65 wheel down. x and y are 1-based terminal cells.
function paneRow(x, y) {
  const g = st.geo, i = y - 2, col = x - g.lw - 2;
  if (col < 0) return null;
  if (st.variant === 1) return i >= 1 && i < g.mh ? { idx: st.a.vtop + i - 1, gutter: col <= 6 } : null;
  return i >= 0 ? { idx: st.b.top + i, gutter: col <= 6 } : null;
}
const curDoc = () => (st.variant === 1 ? docA() : docB());
const setCur = (i) => { if (st.variant === 1) { st.a.cur = i; st.a.focus = 'view'; } else { st.b.cur = i; st.b.focus = 'view'; } };
// Press on a code line starts a line selection. Dragging extends it. Releasing a gutter press opens the composer;
// releasing a drag over the code keeps the selection for c.
function mouse(btn, x, y, release) {
  if (st.drag) {
    const pr = paneRow(x, y), doc = curDoc();
    if (pr && doc[pr.idx]) setCur(pr.idx);
    if (!release) return;
    const { gutter, i } = st.drag, cur = st.variant === 1 ? st.a.cur : st.b.cur;
    st.drag = null;
    if (gutter) docKey(doc, cur, 'c');
    else if (cur === i) st.vis = null;
    else flash(`${Math.abs(cur - i) + 1} lines selected · c to comment`);
    return;
  }
  if (release || btn === 32) return;
  if (btn === 0 && !st.input && !st.picker && !st.preview) {
    const pr = paneRow(x, y), doc = curDoc();
    if (pr && anchorOf(doc[pr.idx] || {})) { setCur(pr.idx); st.vis = { i: pr.idx }; st.drag = { gutter: pr.gutter, i: pr.idx }; return; }
  }
  const g = st.geo, i = y - 2;
  const wheel = btn === 64 ? -3 : btn === 65 ? 3 : 0;
  if (btn !== 0 && !wheel) return;
  if (st.preview) { st.preview.top += wheel; return; }
  if (st.picker) {
    if (wheel) return;
    const it = st.picker.items[y - g.py - 2];
    st.picker = null;
    if (it) it.run();
    return;
  }
  if (st.input) return;
  if (y === 1) {
    if (!wheel && ((x >= 15 && x <= 24 && st.variant === 2) || (x >= 25 && x <= 32 && st.variant === 1))) toggleMode();
    return;
  }
  const left = x <= g.lw;
  if (st.variant === 1) {
    const a = st.a;
    if (i >= g.mh) { if (!wheel && i > g.mh) { const c = comments.slice(-5)[i - g.mh - 1]; if (c) jumpToComment(c); } return; }
    if (left) {
      if (wheel) { a.top = Math.max(0, a.top + wheel); a.free = true; return; }
      const rows = flatTree(), r = rows[a.top + i];
      if (!r) return;
      Object.assign(a, { sel: a.top + i, focus: 'tree', free: true });
      if (r.node.dir) toggleDir(r.node.path); else selectA(r);
      return;
    }
    a.focus = 'view';
    if (wheel) { a.vtop = Math.max(0, a.vtop + wheel); a.cur += wheel; }
    else if (i >= 1) a.cur = a.vtop + i - 1;
    return;
  }
  const b = st.b;
  if (left) {
    if (wheel) { b.ltop = Math.max(0, (b.ltop || 0) + wheel); b.free = true; return; }
    const p = data.changedList[(b.ltop || 0) + i - 1];
    if (i < 1 || !p) return;
    Object.assign(b, { sel: data.changedList.indexOf(p), focus: 'list', free: true });
    jumpB(p);
    return;
  }
  b.focus = 'view';
  if (wheel) { b.top = Math.max(0, b.top + wheel); b.cur += wheel; }
  else b.cur = b.top + i;
}

function keyB(k) {
  const b = st.b, list = data.changedList;
  const jump = jumpB;
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
  if (raw === '\n') { inp.text += '\n'; return; }
  if (raw === '\r') {
    const t = inp.text.trim();
    if (inp.edit) { if (t) inp.edit.text = t; else comments = comments.filter((c) => c !== inp.edit); }
    else if (t) comments.push({ ...inp.anchor, text: t });
    st.vis = null;
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
  const mm = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(raw);
  if (mm) { mouse(+mm[1], +mm[2], +mm[3], mm[4] === 'm'); return; }
  st.a.free = st.b.free = false;
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
  if (k === 'esc' && st.vis) { st.vis = null; return; }
  if (k === 'm') { st.cui = (st.cui % 3) + 1; flash(`Comment style ${st.cui}: ${CUI[st.cui]}`); return; }
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

const TOKEN_RE = /\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[[0-9;]*[~A-Za-z]|\x1bO[A-D]|\x1b|[\s\S]/g;
const TOK = { ctrlj: '\n', down: '\x1b[B', up: '\x1b[A', left: '\x1b[D', right: '\x1b[C', enter: '\r', tab: '\t', esc: '\x1b', bs: '\x7f', space: ' ' };

const tty = process.stdout;
function quit() {
  tty.write('\x1b[?1002l\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l');
  if (comments.length) console.log('Unsent review comments:\n\n' + compose());
  process.exit(0);
}

(async () => {
await initHighlighter();
if (has('--snapshot')) {
  const W = +(opt('--cols') || 120), H = +(opt('--rows') || 32);
  frame(W, H);
  for (const tok of (opt('--keys') || '').split(',').filter(Boolean)) {
    if (tok.startsWith('text:')) for (const ch of tok.slice(5)) handle(ch);
    else if (/^(click|up|down|drag|release)@/.test(tok)) { const [w, xy] = tok.split('@'); const [x, y] = xy.split(':'); handle(`\x1b[<${{ click: 0, up: 64, down: 65, drag: 32, release: 0 }[w]};${x};${y}${w === 'release' ? 'm' : 'M'}`); }
    else handle(TOK[tok] ?? tok);
    frame(W, H);
  }
  let out = frame(W, H).join('\n');
  if (has('--plain')) out = out.replace(/\x1b\[[0-9;]*m/g, '');
  console.log(out);
  process.exit(0);
}
startTty();
})();

function startTty() {
const draw = () => tty.write('\x1b[H' + frame(tty.columns || 100, tty.rows || 30).join('\r\n'));
tty.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[?1000h\x1b[?1002h\x1b[?1006h');
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
}
