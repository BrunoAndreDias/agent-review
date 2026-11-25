# Spec: scroll code sideways

## Goal

Code lines wider than the code pane are cut at its edge with a `…`, and the
rest of the line cannot be read. The user should be able to scroll the code
sideways to read it.

The prototype also looked at wrapping long lines onto more rows. Each screen
row stands for one code line today, and the cursor, clicks and comments rely
on that, so wrapping is left out.

## Data

`st.hx` is how many columns the code is scrolled to the right. It starts at
0 and is shared by Explorer and Review. It lasts until the app quits.

## Behavior

- **Keys.** `L` scrolls 8 columns right and `H` 8 columns left. `0` goes back
  to the start of the lines. `←` and `→` keep moving between the side panel
  and the code.
- **Mouse.** A sideways swipe on a trackpad or a sideways wheel scrolls 4
  columns, and so does the wheel with shift held. Terminals report these as
  mouse buttons 66 and 67, and 68 and 69 with shift.
- **What moves.** Only the code moves. The line numbers, the `+` and `-` marks,
  the `◆` and `┃` comment marks, `@@` rows, file rows and comment cards stay
  in place. All code lines on screen move together.
- **Marker.** While the code is scrolled, a dim `‹` takes its first column.
- **Limit.** The code cannot scroll past the point where the end of the
  longest code line on screen is in view. When the lines on screen get
  shorter, the scroll shrinks to fit.
- While the composer is open, `H`, `L` and `0` are typed into the comment.

## Out of scope

- Wrapping long lines.
- A separate scroll for each file.

## Tests

`src/scroll.test.js` drives the snapshot mode on a
temporary repo with one 95-character line, in a 90-column screen. It checks
the cut line, the keys, the limit, the mouse buttons and the composer.
