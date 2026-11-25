# agent-review

A terminal app for reviewing what coding agents changed, PR-style, without writing code.

Open a project folder, browse its files, see the agents' changes as diffs, and comment on lines or whole files. Then send the comments to an agent in [herdr](https://herdr.dev) as its next message.

Inspired by [herdr-annotate](https://github.com/plannotator/herdr-annotate) and [plannotator-tui](https://github.com/plannotator/plannotator-tui).

## Install in herdr

You need [herdr](https://herdr.dev) 0.9 or newer, Node.js 18 or newer, and git.

```sh
herdr plugin install BrunoAndreDias/agent-review
```

Add a key to `~/.config/herdr/config.toml`, then run `herdr server reload-config`:

```toml
[[keys.command]]
key = "prefix+alt+r"
type = "plugin_action"
command = "agent-review.open"
description = "review agent changes in a pane"
```

On an agent's pane, press the prefix (Ctrl+B by default), then Alt+R. The reviewer opens in a new pane to the right, for that pane's project. Press `q` twice to close it. `ctrl-c` closes it at once.

To update, run `herdr plugin update agent-review`.

## Run it from a checkout

```sh
npm install
node src/review.js <repo> [--base <ref>] [--target <pane_id>] [--projects <folder>] [--dry-run]
```

- `--base` sets what the changes are compared against. The default is `HEAD`, which covers uncommitted work. `--base HEAD~3` also shows the last three commits.
- `--target` binds the review to the agent in that herdr pane. `src/open-pane.sh` passes the pane you opened the review from.
- `--projects` adds the git repos in a folder to the project list. You can pass it more than once.
- `--dry-run` shows what would be sent without sending it, and keeps the comments.

The reviewer checks for changed files every 2 seconds and reloads by itself.

## Modes

Tab switches between two modes and keeps the same file and line.

- Explorer is for use while agents work. It has a file tree on the left and the selected file's diff on the right. `d` shows the full file instead of the diff, and `f` shows only changed files in the tree.
- Review is for the final pass. It lists the changed files on the left and stacks every diff on the right, like GitHub's "Files changed" tab. `v` marks a file viewed and folds it.
- In both modes, `n` jumps to the next change.

## Comments

Comments are drawn as cards below the last line they cover, and the code below them moves down.

- Opening a file puts the cursor on its first change.
- `enter` or a double-click on a line toggles it. A line with no comment opens the composer. A line with a comment hides or shows that comment. A hidden comment keeps its `◆`.
- `c` always adds a new comment, even on a line that has one.
- `V` starts a line selection. The up and down arrows extend it, `enter` or `c` comments on it, and `esc` cancels.
- Dragging over the line numbers of two or more lines opens the composer on them. Dragging over the code selects lines without opening it. A single click only moves the cursor.
- A click on a `@@` row selects the lines of that hunk. `c` or `enter` comments on them.
- In the composer, `enter` saves and `shift-enter` starts a new line. `alt-enter` and `ctrl-j` also start a new line.
- While a new comment that was opened on one line is open, `↑` and `↓` move the far end of its range. The range stays in one file, and the header shows it, for example `L1–3`.
- `e` edits the comment under the cursor, and `x` deletes it.

Each file can have one comment on the whole file.

- `c` on a file in the Explorer tree or the Review list opens that comment. `C` opens it for the file under the cursor.
- In Review, `enter` on a file's header row opens it, and so does a click on that row. In Explorer, a click on the path bar above the code opens it.
- It is drawn as a card titled `whole file` above the first hunk of the file. In the message it comes first under the file's heading.

## Send the review to an agent

- The review is bound to one agent session. If no agent runs in the `--target` pane, the review is bound to the first agent that works in this repo. The binding uses the session id, so it follows the agent when herdr renumbers panes.
- The header shows the bound agent and the state of the review. The state is idle, review queued, working on your review, or done with your review. It shows `no agent` when nothing is bound and `agent gone` when the agent stops.
- `s` sends the review if the agent is idle or done. If the agent is working or blocked, `s` queues the review. The reviewer polls `herdr agent list` every 2 seconds and sends a queued review on the first poll that finds the agent idle.
- While a review is queued, `s` sends it now and `u` cancels it. Cancelling keeps the comments.
- If herdr refuses the review because the agent is blocked on a question, the review stays queued. Any other error keeps the comments.
- `t` opens the agent picker. It lists the bound agent first, then the agents in this repo, then the other agents, then "Copy to clipboard" and "Preview message". Choosing an agent binds it and cancels a queued review.
- `p` previews the message.
- Outside herdr, nothing is bound. The picker then holds only "Copy to clipboard" and "Preview message".

## Projects

- The review shows one git repo. `o` opens a list of projects to switch to. A click on `agent-review` at the top left or on the project name in the header also opens it, and so does `tab` in Review.
- The list holds the start repo, the repos that herdr agents run in, the repos next to those, and the repos in each `--projects` folder. In herdr, the list also reads one folder per line from the `projects` file in the plugin's config folder. `herdr plugin config-dir agent-review` prints that folder.
- Each project keeps its comments while another project is shown.
- If you open the reviewer in a repo with no changes and another project has changes, the list opens by itself.

## Layout and scrolling

- Drag the divider between the side panel and the code to set the width of the panel. `]` widens the panel by 4 columns, `[` narrows it by 4, and `=` fits it to the longest name in the view. Explorer and Review share one width.
- `L` scrolls the code 8 columns right and `H` scrolls it 8 columns left. A sideways swipe, or the wheel with shift held, scrolls 4 columns. `0` goes back to the start. A dim `‹` in the first column shows that the code is scrolled.
- Click folders, files, lines, and comments. The scroll wheel scrolls the pane under the pointer.
- Mouse mode takes over the terminal's own text selection. Hold Option on macOS while you drag to select text.

## Theme

The colors copy the Dark Modern theme from VS Code. [Shiki](https://shiki.style) highlights the code with the grammars of VS Code and the Dark+ token colors. You need a terminal with 24-bit color. If Shiki is not installed, the code shows in one color.

## Develop

- `npm test` runs the tests in `src/*.test.js`. They drive the snapshot mode of `src/review.js` and pass `--agents-json <file>` in place of herdr.
- `npm run bench -- [repo ...]` times startup, keys, the 2-second file check, and the project picker. With no repo, it builds a large synthetic one. `--fixture <folder>` keeps that repo for the next run.
- `docs/specs/` holds the spec for each feature. Write the spec before you build a feature.

## License

MIT
