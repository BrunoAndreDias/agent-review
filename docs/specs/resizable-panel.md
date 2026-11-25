# Spec: resize the side panel

## Goal

File and folder names are short in some repos and long in others. The
Explorer tree and the Review changes list have a fixed width, so long names
get cut and short names leave empty space. The user should be able to set the
panel's width with the mouse or the keyboard.

A throwaway prototype compared three ways: drag the divider, size the panel
to fit the names on its own, and cycle preset widths. This spec keeps the
drag, adds keys, and keeps "fit the names" as a key the user presses. A panel
that resizes on its own would move the code every time a folder opens.

## Data

`st.lw` is the panel's width in columns. It is `null` until the user sets a
width, and the panel then uses the width it has today, about a third of the
screen. Explorer and Review share `st.lw`. It lasts until the app quits.

## Behavior

- **Divider.** The column between the panel and the code draws a `↔` on its
  middle row, to show that it can be dragged.
- **Drag.** Pressing the mouse on the divider and moving it sets the width.
  The divider turns into a bright `┃` while the mouse button is held, and the
  footer shows `Panel width N`.
- **Hover.** With the mouse over the divider and no button held, the divider
  turns bright too, and the app asks the terminal for a left-right resize
  pointer (OSC 22 `ew-resize`). For this the app turns on mouse mode 1003,
  which reports moves with no button held. A move that changes nothing does
  not redraw the screen.
- **Keys.** `]` widens the panel by 4 columns and `[` narrows it by 4. `=`
  sets the width to fit the longest name in the current view, with its badges.
  In Review that includes the file's folder.
- **Limits.** The width stays between 16 columns and the screen width less 30
  columns, so the code always keeps 29 columns. A screen that shrinks below a
  set width narrows the panel to fit.
- While the composer is open, `[`, `]` and `=` are typed into the comment.
  The divider cannot be dragged while the composer, the agent picker or the
  preview is open.

## Out of scope

- Hiding the panel.
- Keeping the width between runs.
- Separate widths for Explorer and Review.

## Tests

`src/panel.test.js` drives the snapshot mode on a
temporary repo with one long file name. It finds the divider by its `↔` and
checks its column after drags, keys and mouse moves.
