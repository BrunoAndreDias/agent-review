# Spec: comment on several lines or on a whole file

## Goal

A review comment often covers more than one line, or is about a file as a
whole ("this file needs tests"). Both should take one or two keys from the
keyboard and one gesture with the mouse, and work in a terminal that drops
shift-click, such as Ghostty inside herdr.

The prototype in `prototypes/range-comments` compared three keyboard ways to
select lines: shift-arrows, `V` then arrows, and growing an open comment with
the arrows. This spec keeps the third, "grow", and keeps `V` from before. It
drops shift-arrows and shift-click.

## Data

A comment has one of two shapes:

- `{ p, side, from, line, snippet, text, hidden? }` covers lines `from..line`
  on one side (`new` or `old`) of file `p`. It exists today.
- `{ p, file: true, text }` covers the whole file `p`. A file has at most one.

## Behavior

- **Grow.** `c`, `enter` or a double-click on a code line with no comment
  opens the composer on that line. While it is open, `↑` and `↓` move the far
  end of the range one code line at a time. The line it was opened on stays
  covered, except in the mixed case below. The range stays inside one file. It skips `@@` rows, so it can
  grow from one hunk into the next and cover the hidden lines between them.
  As today, a range covers one side. When it spans removed and added lines,
  it takes the side of its bottom line. So growing down from a removed line
  into added lines moves the range to the added side, and the removed line
  drops out. The composer title and the footer show the range as it changes,
  for example `L1–3`. `enter` saves it.
- The arrows grow only a new comment opened on one line. A comment opened on a
  `V` selection or a drag already has its range, and editing a comment does
  not change its range.
- **Mouse.**
  - Dragging over line numbers selects lines and opens the composer, as today.
  - A click on a `@@` row selects that hunk's lines. `c` or `enter` then
    comments on them.
  - A click on a file's header row in Review, or on the path bar above the
    code in Explorer, opens that file's comment.
- **Whole-file comments.**
  - `c` on a file in the Explorer tree or in the Review changes list opens
    that file's comment. `c` on a folder does nothing.
  - `C` opens the comment of the file under the cursor, from the code, the
    tree or the changes list.
  - `enter` on a file's header row in Review opens it too.
  - If the file has a comment already, these open it for editing.
- **Display.** A file comment is a card above the file's first hunk, in all
  three comment styles. Its title reads `whole file`. With the cursor on the
  card, `e` or `enter` edits it and `x` deletes it. The `◆N` counts in the
  tree and the changes list include it.
- **Message.** Under each file's heading, the file comment comes first, as
  `- the whole file:` followed by its text. Line comments follow in line order.

## Keys

Shifted letters (`C`, `V`) must work when the terminal reports them in the
kitty keyboard format, as Ghostty does. `CSI 99;2u` is `C`.

## Out of scope

- Comments on folders, or on several files at once.
- Lines that are not next to each other in one comment.
- Moving a saved comment's range.

## Tests

`prototypes/line-comments/comments.test.js` drives the snapshot mode on a
temporary repo, the way `send.test.js` does, and checks what the user sees:
the card titles, the footer, and the message shown by `p`.
