#!/bin/sh
# Opens the reviewer in a new pane to the right of the focused herdr pane.
# The pane closes when you quit the reviewer.
here=$(cd "$(dirname "$0")" && pwd)
herdr=${HERDR_BIN_PATH:-herdr}
src=${HERDR_ACTIVE_PANE_ID:-$HERDR_PANE_ID}
cwd=${HERDR_ACTIVE_PANE_CWD:-$PWD}

pane=$("$herdr" pane split $src --direction right --cwd "$cwd" --focus | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p')
[ -n "$pane" ] || { echo "agent-review: could not split a pane" >&2; exit 1; }
"$herdr" pane run "$pane" "exec node '$here/review.js' '$cwd'"
