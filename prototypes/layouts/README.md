# Layout prototype (throwaway)

One Node script with no dependencies. It shows three layouts for the reviewer, and keys 1, 2 and 3 switch between them. It exists to choose a layout. It is not the start of the real code.

```sh
node prototypes/layouts/review.js <repo> [--base <ref>] [--dry-run]
```

- `--base` sets what the changes are compared against. It defaults to `HEAD`, which covers uncommitted work. `--base HEAD~3` shows the last three commits too.
- `s` sends the comments to a herdr agent with `herdr agent prompt`. `--dry-run` turns sending off.
- The app reloads by itself every 2 seconds when files change on disk.

Layouts:

1. Explorer: a file tree on the left, the selected file's diff on the right, and a comments drawer at the bottom.
2. PR stack: the changed files on the left, and every diff stacked on the right, like GitHub's "Files changed" tab. `v` marks a file viewed and folds it.
3. Reader: one full-screen pane at a time. You browse folders, then read the whole file with the changes marked inline. `n` jumps to the next change.
