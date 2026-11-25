# agent-review

A personal, open-source terminal app (and herdr plugin) for reviewing coding
agents' changes: browse a project's files, view diffs, leave line comments,
and send them to a chosen agent in herdr as its next message.

- Status: in daily use through the herdr plugin. The code is
  `src/review.js`, one Node script, with `src/open-pane.sh` as the herdr
  launcher. `README.md` documents every key and flag. Update it in the
  same change as the behavior.
- Write a spec in `docs/specs/` before you build a feature. Settle open
  design questions with a throwaway prototype in `prototypes/`. Delete the
  prototype once the spec records the outcome.
- Run `npm test` before every commit. A change in the launcher or the
  manifest also needs one run through herdr.
- Integration with herdr goes through its CLI (`herdr agent list`,
  `herdr agent prompt`, `herdr agent wait`) and plugin manifest
  (`herdr-plugin.toml`). Docs: https://herdr.dev/tui/docs/plugins/
- Bump `version` in `herdr-plugin.toml` and `package.json` together.
