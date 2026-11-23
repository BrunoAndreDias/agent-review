#!/bin/sh
# Opens the reviewer in a new pane to the right of the focused herdr pane.
# The pane closes when you quit the reviewer.
here=$(cd "$(dirname "$0")" && pwd)
herdr=${HERDR_BIN_PATH:-herdr}
# A keybinding passes HERDR_ACTIVE_PANE_*; a plugin action passes HERDR_PLUGIN_CONTEXT_JSON.
ctx() { [ -n "$HERDR_PLUGIN_CONTEXT_JSON" ] && node -e 'const v=JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON)[process.argv[1]];if(v)console.log(v)' "$1"; }
src=${HERDR_ACTIVE_PANE_ID:-$(ctx focused_pane_id)}
cwd=${HERDR_ACTIVE_PANE_CWD:-$(ctx focused_pane_cwd)}
cwd=${cwd:-$PWD}

pane=$("$herdr" pane split $src --direction right --cwd "$cwd" --focus | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p')
[ -n "$pane" ] || { echo "agent-review: could not split a pane" >&2; exit 1; }
"$herdr" pane run "$pane" "exec node '$here/review.js' '$cwd'"
