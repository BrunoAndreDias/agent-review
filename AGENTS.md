# agent-review

A personal, open-source terminal app (and herdr plugin) for reviewing coding
agents' changes: browse a project's files, view diffs, leave line comments,
and send them to a chosen agent in herdr as its next message.

- Status: design phase. Settle the design and write a spec before building.
- Integration with herdr goes through its CLI (`herdr agent list`,
  `herdr agent prompt`, `herdr agent wait`) and plugin manifest
  (`herdr-plugin.toml`). Docs: https://herdr.dev/tui/docs/plugins/
