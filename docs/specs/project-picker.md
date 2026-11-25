# Spec: pick the project to review

## Goal

The review opens on the repo of the pane it was started from. An agent often
runs in one folder and edits a repo in another, so the review can open on a
repo with no changes. The user should be able to switch the review to another
repo without closing it.

A throwaway prototype compared three ways to pick a project: a popup list, a
strip of projects under the header, and a full-screen list. This spec keeps
the popup. The strip took a row all the time and fit about four projects in a
narrow pane. From the full-screen list it keeps one idea: opening the list on
its own when the start repo has no changes.

## Data

A project is a git repo, named by the folder at its top:

```
{ root, name, branch, changed, newest, agents }
```

`changed` counts the files `git status` lists, untracked files included.
`newest` is the time the newest of those files changed. `agents` counts the
herdr agents whose folder is inside `root`.

The list of projects is built each time the picker opens. It holds:

- the repo the review started in, and the repo it shows now,
- the repos herdr agents run in,
- the repos next to each of those, in the same parent folder,
- each folder given with `--projects <folder>` or listed in the `projects`
  file of the plugin's config folder (`herdr plugin config-dir agent-review`).
  A folder that is a repo is added. A folder of repos adds each repo in it.
  The file holds one folder per line. `~` means the home folder, and lines
  that start with `#` are skipped.

Each project keeps its own comments, base, cursor, open folders and viewed
files while another project is shown. They last until the app quits.

## Behavior

- **Open.** `o` opens the picker. So do a click on `agent-review` at the top
  left and a click on the project name in the header. The name has a `▾`
  after it, which turns into `▴` while the picker is open.
- **Tab.** `tab` goes from Explorer to Review, from Review to the picker, and
  from the picker back to Explorer.
- **List.** Each row shows the name, the branch, `N changed` or `clean`, the
  number of agents, how long ago the newest change was made, and `◆N` for the
  comments kept in that project. The current project comes first with a `●`.
  Projects with changes follow, the most recently edited first, then the
  clean ones by name.
- **Switch.** `enter` or a click on a row shows that project. Its base is its
  `HEAD`, unless it was shown before. The footer says
  `Reviewing <name> · N changed`, and adds `N comments kept` when the project
  had comments.
- **At start.** If the start repo has no changes and another project has, the
  picker opens on its own, with the first project that has changes selected.
- A queued review is cancelled when the project changes. The bound agent
  stays bound.

## Out of scope

- Reviewing two projects at once.
- Remembering projects or comments between runs.
- Searching the list by typing.

## Tests

`src/projects.test.js` drives the snapshot mode on
temporary repos side by side and one in another folder. It checks the order
of the list, switching, the comments each project keeps, the clicks, tab, and
the picker that opens at start.
