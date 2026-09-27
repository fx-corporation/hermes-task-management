# AI agent instructions

## Record changes in the changelog

All AI agents working in this repository must maintain the root `CHANGELOG.md`.
This rule applies to code, tests, documentation, configuration, dependencies,
and agent instructions.

- When making changes, add or update an entry under `Unreleased` describing
  the actual changes and why they were needed. Keep the entry current as the
  work evolves, including when changes are left uncommitted.
- Use a dated, descriptive heading and the `Agent`, `Changes`, `Why`, and
  `Validation` fields shown in the changelog. Identify the agent when known;
  do not invent attribution. List relevant paths and concrete reasons.
- Record checks actually performed and their results. If no checks were run,
  say so and explain why. Mention known failures or limitations.
- Before committing, inspect the staged diff and ensure the entry covers
  every AI-authored change included in that commit. Stage the corresponding
  `CHANGELOG.md` update and include it in the same commit. For separate
  commits, use separate entries describing each commit's scope.
- Record only your own work or earlier work whose AI authorship and purpose
  are supported by evidence. Do not claim unrelated changes already in the
  working tree. Preserve other agents' entries and existing history.
- Do not log read-only investigation or fully reverted work. Do not include
  secrets, credentials, or private user data in entries.
- Keep entries newest first. Update your pending entry rather than adding
  duplicates for intermediate edits. Do not rewrite committed history except
  to correct a factual error; do not invent dates, checks, or commit hashes.

Updating the changelog does not authorize a commit or release. Commit only
when the user's task authorizes it. When preparing an authorized release,
move the relevant entries from `Unreleased` to the version's dated section.
