# Spec: send the review to a bound agent session

## Goal

You review one agent's changes, and your comments should reach that agent as
its next message. You shouldn't have to pick the agent each time, and the
review shouldn't arrive in the middle of the agent's current task.

The prototype in `prototypes/line-comments` compared three ways to pick the
target. This spec keeps "bound session, deliver when idle" and drops the other
two, "pick each time" and "bound, send at once".

## Behavior

- **Binding.** The review is bound to one herdr agent session. The binding
  uses the agent's session id (`agent_session.value` from `herdr agent list`),
  so it survives herdr renumbering panes.
- **Default target.** `open-pane.sh` passes the pane the review was opened
  from as `--target <pane_id>`. If an agent runs in that pane, the review is
  bound to it. If not, the review is bound to the first agent whose `cwd` is
  inside the reviewed repo. If there is none, nothing is bound.
- **Header.** The header shows the target and where the review stands, for
  example `→ claude [w2:p9] idle` or `→ claude [w2:p9] working on your review`.
  With nothing bound it shows `→ no agent (t)`. If the bound agent is no longer
  running, it shows `→ agent gone (t)`.
- **`s` sends.**
  - With no comments it shows a message and does nothing else.
  - With nothing bound, or the bound agent gone, it opens the agent picker.
    Choosing an agent binds it and sends.
  - If the agent is idle or done, it sends now.
  - If the agent is working or blocked, it queues the review. A queued review
    goes out on the first poll that finds the agent idle or done.
  - While a review is queued, `s` sends it now.
- **`u`** cancels a queued review. The comments stay.
- **`t`** opens the agent picker: running agents, the bound one first and
  marked, then agents in this repo, then the rest, followed by "Copy to
  clipboard" and "Preview message". Choosing an agent rebinds and cancels a
  queued review.
- **After sending,** the comments move to the sent list and the header follows
  the agent. It shows "working on your review" while the agent works, and
  "done with your review" once the agent finishes the turn that holds the
  review. Changed files reload as before.
- **Errors.** If herdr refuses the prompt because the agent is blocked
  (`agent_blocked`), the review stays queued. Any other error shows a message
  and keeps the comments.
- **Outside herdr,** or if `herdr` is missing, nothing is bound. `s` and `t`
  open the picker with only "Copy to clipboard" and "Preview message".
- **`--dry-run`** goes through the same steps but doesn't call
  `herdr agent prompt`.

## Data shape

```js
// The binding. Null when nothing is bound.
target: { session: string } | null

// Where the review stands. One state replaces separate queued and phase flags.
delivery:
  | { state: 'none' }
  | { state: 'queued' }
  | { state: 'sent', seq: number | undefined, left: 1 | 2 }
  | { state: 'done' }
```

herdr stamps `completion_seq` on an agent when it finishes a turn. The number
comes from a counter shared by all agents, and it is missing while the agent
works. So the reviewer counts finished turns, not the number itself. `seq` is
the agent's `completion_seq` when the review is sent. `left` is how many turns
must finish before the review is done: 1, or 2 if the agent was working when
the review was sent, because the turn already running finishes first. Each poll
that finds a defined `completion_seq` different from `seq` stores the new
value and lowers `left`.

Two turns finishing between polls count as one. The review turn is the second
of those, and it rarely takes under 2 seconds, so the header can then stay on
"working on your review" until the next turn ends.

Every 2 seconds, `herdr agent list` runs in the background, without blocking
input. Its result goes to one function, `step(delivery, agent)`, which returns
the next delivery state and whether to send:

| state  | agent                       | next                         |
| ------ | --------------------------- | ---------------------------- |
| queued | idle or done                | send, then `sent`            |
| queued | working, blocked, or gone   | `queued`                     |
| sent   | new `completion_seq`, `left` 1 | `done`                    |
| sent   | new `completion_seq`, `left` 2 | `sent`, `left` 1          |
| sent   | otherwise                   | `sent`                       |

## Testing

- The snapshot harness reads agents from `--agents-json <file>` instead of
  herdr. It also takes two key tokens: `agents=<file>` switches the file, and
  `poll` runs one poll.
- `node --test 'prototypes/line-comments/*.test.js'` runs tests that drive the harness and
  check the header and footer through the behavior above.

## Out of scope

- Sending to several agents at once.
- Remembering the binding between runs.
- Replies from the agent shown in the reviewer.
