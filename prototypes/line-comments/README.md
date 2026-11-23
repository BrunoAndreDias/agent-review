# Line comments prototype (throwaway)

A copy of `../layouts/review.js` that tries three ways to comment on a line or a range of lines. `m` switches between them. It exists to pick a design and is not the start of the real code. The herdr action (`layouts/open-pane.sh`) opens this script.

Press `q` twice to quit (`ctrl-c` quits at once).

```sh
npm install --prefix prototypes/layouts   # Shiki is loaded from that folder
node prototypes/line-comments/review.js <repo> [--cui 1|2|3] [--dry-run]
```

Picking lines works the same in all three:

- Opening a file puts the cursor on its first change.
- `enter` or a double-click on a line toggles it. On a `@@` row it uses the next code line. A line with no comment opens the composer. A line with a comment hides or shows that comment (it keeps its `◆`). Double-clicking again on an empty composer closes it.
- `c` always adds a new comment, even on a line that has one.
- `V` starts a line selection, `↑↓` extend it, `enter` or `c` comments on it, `esc` cancels.
- A single click only moves the cursor. Dragging in the gutter (line numbers) over two or more lines opens the composer on them. Dragging over the code selects lines without opening it.
- In the composer, `enter` saves and `shift-enter` starts a new line (`alt-enter` and `ctrl-j` work too). `e` edits the comment under the cursor, `x` deletes it.
- Lines a comment covers get a `┃` bar, and its first line gets a `◆`.

The three styles:

1. Inline cards. Comments are boxes inserted below their last line, like VS Code's comment widget and GitHub's diff threads. The code below moves down.
2. Gutter + peek. The code never moves. Comments show only as gutter marks, and a box floats over the code while the cursor is on a commented line.
3. Margin notes. A column beside the code holds each note level with its first line, like comments in Google Docs. The code column gets narrower.
