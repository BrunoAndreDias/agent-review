# Line comments prototype (throwaway)

A copy of `../layouts/review.js` that tries three ways to comment on a line or a range of lines. `m` switches between them. It exists to pick a design and is not the start of the real code.

```sh
npm install --prefix prototypes/layouts   # node_modules here links to that folder
node prototypes/line-comments/review.js <repo> [--cui 1|2|3] [--dry-run]
```

Picking lines works the same in all three:

- `c` comments on the cursor line.
- `V` starts a line selection, `↑↓` extend it, `c` comments on it, `esc` cancels.
- With the mouse, press in the gutter (line numbers) and drag to pick lines; releasing opens the composer. Dragging over the code selects lines without opening it.
- In the composer, `enter` saves and `ctrl-j` starts a new line. `e` edits the comment under the cursor, `x` deletes it.
- Lines a comment covers get a `┃` bar, and its first line gets a `◆`.

The three styles:

1. Inline cards. Comments are boxes inserted below their last line, like VS Code's comment widget and GitHub's diff threads. The code below moves down.
2. Gutter + peek. The code never moves. Comments show only as gutter marks, and a box floats over the code while the cursor is on a commented line.
3. Margin notes. A column beside the code holds each note level with its first line, like comments in Google Docs. The code column gets narrower.
