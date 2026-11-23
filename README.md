# agent-review

A terminal app for reviewing what coding agents changed, PR-style, without writing code.

Open a project folder, browse files and folders, see the agents' changes as diffs,
leave comments on specific lines whenever you want, and send the batch of comments
to the agent pane of your choice in [herdr](https://herdr.dev).

Inspired by [herdr-annotate](https://github.com/plannotator/herdr-annotate) /
[plannotator-tui](https://github.com/plannotator/plannotator-tui).

Status: working prototype (`prototypes/layouts/`). The real build comes after a spec.

## Install in herdr

Needs [herdr](https://herdr.dev) 0.9 or newer, Node.js 18 or newer, and git.

```sh
herdr plugin install BrunoAndreDias/agent-review
```

Then add a key to `~/.config/herdr/config.toml` and run `herdr server reload-config`:

```toml
[[keys.command]]
key = "prefix+alt+r"
type = "plugin_action"
command = "agent-review.open"
description = "review agent changes in a pane"
```

Press the prefix (Ctrl+B by default), then Alt+R, on an agent's pane. The reviewer opens in a new pane to its right, for that pane's project. Press `q` to close it.

To update later, run `herdr plugin update agent-review`.

## Use

- Tab switches between Explorer (browse the project while agents work) and Review (every changed file, stacked, for the final pass).
- `c` comments on a line, `x` deletes a comment, `p` previews the message, and `s` sends your comments to the agent you pick.
- Click files, folders and lines. The scroll wheel scrolls the pane under the pointer.

## License

MIT
