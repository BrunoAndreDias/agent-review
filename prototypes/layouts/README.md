# Layout prototype (throwaway)

One Node script with no dependencies. It has two modes, and Tab switches between them while keeping the same file and line. It exists to try the design. It is not the start of the real code.

```sh
npm install --prefix prototypes/layouts
node prototypes/layouts/review.js <repo> [--base <ref>] [--dry-run]
```

- `--base` sets what the changes are compared against. It defaults to `HEAD`, which covers uncommitted work. `--base HEAD~3` shows the last three commits too.
- `s` sends the comments to a herdr agent with `herdr agent prompt`. `--dry-run` turns sending off.
- The app reloads by itself every 2 seconds when files change on disk.

Modes:

1. Explorer is for use while agents work. It has a file tree on the left, the selected file's diff on the right (`d` shows the full file instead), and a comments drawer at the bottom.
2. Review is for the final pass. It lists the changed files on the left and stacks every diff on the right, like GitHub's "Files changed" tab. `v` marks a file viewed and folds it.

A third layout, Reader, was tried and dropped in favor of these two.

Mouse: click a folder to open or close it, click a file to show it, and click a line to put the cursor on it. In Review, click a file in the list to jump to its diff. Click a comment in Explorer's drawer to jump to it, and click a mode name in the header to switch modes. The scroll wheel scrolls the pane under the pointer and leaves the selected file alone. Mouse mode takes over the terminal's own text selection, so hold Option (macOS) while dragging to select text.

Theme: the colors copy VS Code's Dark Modern theme. Code is highlighted with [Shiki](https://shiki.style), which uses VS Code's own grammars and the Dark+ token colors that Dark Modern uses. It needs a terminal with 24-bit color. Without Shiki installed, code shows in one color.
