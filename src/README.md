# Line comments prototype (throwaway)

A copy of `../layouts/review.js` that tries three ways to comment on a line or a range of lines. `m` switches between them. It exists to pick a design and is not the start of the real code. The herdr action opens this script through `layouts/open-pane.sh`.

Press `q` twice to quit. `ctrl-c` quits at once.

```sh
npm install --prefix prototypes/layouts   # Shiki is loaded from that folder
node prototypes/line-comments/review.js <repo> [--cui 1|2|3] [--target <pane_id>] [--projects <folder>] [--dry-run]
```

Picking lines works the same in all three:

- Opening a file puts the cursor on its first change.
- `enter` or a double-click on a line toggles it. On a `@@` row it uses the next code line. A line with no comment opens the composer. A line with a comment hides or shows that comment. A hidden comment keeps its `◆`. Double-clicking again on an empty composer closes it.
- `c` always adds a new comment, even on a line that has one.
- `V` starts a line selection, the up and down arrows extend it, `enter` or `c` comments on it, `esc` cancels.
- A single click only moves the cursor. Dragging over the line numbers of two or more lines opens the composer on them. Dragging over the code selects lines without opening it.
- In the composer, `enter` saves and `shift-enter` starts a new line. `alt-enter` and `ctrl-j` also start a new line. `e` edits the comment under the cursor, `x` deletes it.
- Lines a comment covers get a `┃` bar, and its first line gets a `◆`.
- While a new comment opened on one line is open, `↑` and `↓` move the far end of its range, one code line at a time. The line it was opened on stays covered. The range stays in one file and skips `@@` rows. If it spans removed and added lines, it takes the side of its last line. The title and the footer show the range, for example `L1–3`. A comment opened on a `V` selection or a drag keeps its range, and so does a comment being edited.
- A click on a `@@` row selects that hunk's lines. `c` or `enter` comments on them.

Comments on a whole file:

- `c` on a file in the Explorer tree or the Review changes list opens that file's comment. `c` on a folder does nothing. `C` opens the comment of the file under the cursor, from the code, the tree or the list. `enter` on a file's header row in Review does the same, and so does a click on that row or on the path bar above the code in Explorer.
- A file has at most one such comment. If it has one, these keys open it for editing.
- It is drawn as a card titled `whole file` above the file's first hunk, in all three styles. On the card, `e` or `enter` edits it and `x` deletes it. The `◆N` counts include it.
- In the message it comes first under the file's heading, as "the whole file", before the line comments.

The side panel:

- Drag the divider between the panel and the code to set the panel's width. The divider shows a `↔` on its middle row, and turns bright while the mouse is over it or dragging it.
- `]` widens the panel by 4 columns and `[` narrows it by 4. `=` fits it to the longest name in the current view.
- Explorer and Review share one width. It stays between 16 columns and the screen width less 30.

Long lines:

- `L` scrolls the code 8 columns right and `H` 8 columns left. A sideways swipe, or the wheel with shift held, scrolls 4 columns. `0` goes back to the start.
- Only the code moves. A dim `‹` in its first column shows it is scrolled. It stops once the end of the longest line on screen is in view.

The project:

- The review shows one git repo. `o` opens a list of projects to switch to. So do a click on `agent-review` at the top left, a click on the project name in the header, and `tab` from Review.
- The list holds the start repo, the repos herdr agents run in, the repos next to those, and the repos in each `--projects` folder. In herdr it also reads one folder per line from `projects` in the plugin's config folder (`herdr plugin config-dir agent-review`).
- Each project keeps its comments while another one is shown.
- Opened from a repo with no changes, the list opens on its own if another project has changes.

The three styles:

1. Inline cards. Comments are boxes inserted below their last line, like VS Code's comment widget and GitHub's diff threads. The code below moves down.
2. Gutter + peek. The code never moves. Comments show only as gutter marks, and while the cursor is on a commented line, a box is drawn over the code below it.
3. Margin notes. A column beside the code holds each note level with its first line, like comments in Google Docs. The code column gets narrower.

Sending the review to a herdr agent:

- The review is bound to one agent session. `open-pane.sh` passes the pane the review was opened from as `--target`, and the review is bound to the agent in that pane. If no agent runs there, it is bound to the first agent working in this repo. The binding uses the session id, so it follows the agent if herdr renumbers panes.
- The header shows the bound agent and where the review stands: idle, review queued, working on your review, or done with your review. With nothing bound it shows `no agent`. If the agent stops running it shows `agent gone`.
- `s` sends the review now if the agent is idle or done. If the agent is working or blocked, `s` queues the review, and it goes out on the first poll that finds the agent idle. The reviewer polls `herdr agent list` every 2 seconds.
- While a review is queued, `s` sends it now and `u` cancels it. Cancelling keeps the comments.
- After sending, the header shows the agent working on your review. It shows done once the agent finishes the turn that holds the review. If the agent was working when the review went out, that takes two finished turns.
- If herdr refuses the review because the agent is blocked on a question, the review stays queued. Any other error keeps the comments.
- `t` opens the agent picker. It lists the bound agent first, then agents in this repo, then the rest, then "Copy to clipboard" and "Preview message". Choosing an agent binds it and cancels a queued review. `s` opens the same picker when nothing is bound or the bound agent is gone. Choosing an agent there binds it, then sends or queues the review by the same rule.
- Outside herdr nothing is bound, and the picker holds only "Copy to clipboard" and "Preview message".

`--dry-run` shows what would be sent without sending it. It keeps the comments.

Run the tests with `node --test 'prototypes/line-comments/*.test.js'`. `send.test.js` covers sending, `comments.test.js` covers ranges and file comments, `panel.test.js` covers the panel width, `projects.test.js` covers the project picker, and `scroll.test.js` covers scrolling sideways. They drive the snapshot mode with `--agents-json <file>` in place of herdr. The key token `agents=<file>` switches that file, and `poll` runs one poll.

`node prototypes/line-comments/bench.js [repo ...]` times startup, keys, the 2-second file check and the project picker, through the snapshot mode's `--timing` output. With no repo it builds a large synthetic one. `--fixture <folder>` keeps that repo for the next run.
