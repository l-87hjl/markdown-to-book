# Maintained fork: agent orientation

Read `docs/MAINTENANCE.md` before editing or building. The upstream README and MIT
license remain authoritative for original code/provenance. MetaOps owns shared
coordination; this repository owns implementation evidence. No qualification or
new shared queue is created here.

- Work in an isolated `codex/<fix>` / other approved agent branch. `upstream-tracking`
  contains original upstream code only. Maintained `main` accepts reviewed PRs only.
- Do not open real manuscripts or cover assets without explicit file/content authority.
  Keep them and all generated outputs outside Git worktrees in local private storage.
- Run only reviewed, hash-checked synthetic fixtures in public tests/CI. Never upload
  private material, build logs or book PDFs to issues, PRs, Actions artifacts or APIs.
- Use installed dependencies. No model/API call, network image fetch or TeX shell escape
  is part of the maintained local build path. Inspect code changes for egress.
- Stage explicit paths, never `git add -A`. Run the staged and proposed-range publication
  preflights. Review changes to the allowlist and any binary/fixture hashes manually.
- Preserve history/user work. No force push, automatic upstream adoption, releases,
  deployment or permission/default-branch changes without separate authority.
- Test and review exact commits before creating immutable candidate pins. A local
  commit/tag is not a published or production-approved version.
