# Maintained fork workflow and private-content boundary

## Branches and review

`upstream-tracking` is a clean copy of the original upstream default branch. Update it
only deliberately and by fast-forward after fetching. It carries no fork documents or
fixes. `main` is the maintained branch, reached through reviewed short-lived fix/update
branches; do not rewrite it. Preserve the legacy `master` branch/default where present.
These are workflow conventions: no GitHub protection, visibility or permission setting
is changed by this patch. Optional local hooks are bypassable and are not remote policy.

Before an update, record both heads and the prior tested pin; fetch upstream; inspect the
whole change; test it on `codex/upstream-<version>`; rerun synthetic and rendered checks;
review the exact resulting diff. Merge by reviewed PR only. Keep the previous pin usable.
A second fork does not remove merge conflicts and adds another synchronization step.

## Inputs, outputs and egress

Keep real manuscript, cover, settings, intermediates, PDFs and logs in explicitly chosen
local private storage outside every Git worktree and public fork. Example location:
`~/PrivatePublishing/paperback/` (choose a nonsynced private location yourself). Do not
copy them into this repository, even temporarily. This task does not create that project
or authorize an agent to read real assets. A future separate private project could combine
interior/cover settings and validation, but remains documentation-only here.

The maintained build guards require an external private root. The synthetic exception is
limited to exact reviewed fixture bytes, not an arbitrary file labeled synthetic. Resource
validation and layout checks still apply. Builds use no-shell TeX and no model/API client.
Inspect changes for network paths; run in an OS/network-isolated environment when stronger
containment is needed. These checks are not a network sandbox and cannot constrain an
arbitrary executable, malicious TeX, another upload tool or future unreviewed code.

## Staging and publication checks

1. Inspect `git status --short`, the intended diff, and the exact changed paths.
2. Stage only explicit paths: `git add -- path/to/source path/to/test`.
3. Run `python3 scripts/publication_preflight.py --staged`.
4. Review `git diff --cached --stat` and the full staged diff, including allowlist changes.
5. Before publication run `python3 scripts/publication_preflight.py --range <public-base>..HEAD`.
   The range scan includes each commit, detecting an unsafe file added and later deleted.
6. Obtain the applicable review/publication authority; verify the published ref and PR.

The exact `.publication-allowlist.json` admits source paths and known upstream assets.
Binary assets and public synthetic fixture bytes are hash-checked. New paths/hashes require
explicit review; editing an allowlist cannot certify content safe. Never stage private
input to test the validator: use throwaway repositories and synthetic negative cases.

Optional per-clone hooks can be enabled manually with
`git config --local core.hooksPath .githooks`; this patch does not enable them globally or
silently change an existing hooks path. The pre-push hook blocks direct main/master
pushes and checks proposed source ranges. Hooks do not cover GitHub/API writes.

`.gitignore` does not protect already tracked files, past Git history, arbitrary prose
inside an allowed source/document, force-added files by itself, bypassed hooks, another
repository or API transmission. If real private content is encountered, stop publication;
do not paste it into an issue/report or rewrite remote history without separate authority.

## Production pins and evidence

Production uses an exact reviewed commit or immutable tested tag, never a moving upstream
branch. Record code SHA, template/filter/font hashes, installed tool/package versions,
settings, page count and final PDF hash privately. Preserve a finished book's source,
settings and artifact; do not overwrite its lock or regenerate it on an upstream update.
Tool/font updates can change layout even with unchanged code and require regression QA.

Local `paperback-candidate-*` tags identify tested candidates, not releases or user
approval. Never move a tag. An update gets a new pin. Roll back by reverting the reviewed
PR or selecting the prior tested pin, without force push or deleting unique work.

## Validation

Use `python3 -m unittest discover -s tests -p 'test_*.py'` and any repository-specific
Node/render checks documented below. Only synthetic fixtures are permitted. Keep all
rendered evidence outside the repository. A successful compilation alone does not prove
text preservation, safe areas, print quality or KDP acceptance.

## Interior commands and migration

Private builds require `--private-root /absolute/local/private/root` (or
`BOOK_PRIVATE_ROOT`). Input Markdown, optional EPUB cover/back-matter JSON and images
must resolve inside it and outside Git. Relative output names resolve under that root.
For example, after explicit content authority:

```sh
node convert.js "$BOOK_PRIVATE_ROOT/input/book.md" --private-root "$BOOK_PRIVATE_ROOT" \
  --format pdf --trim 5x8 --open-right --title "Book title" --author "Author" \
  --paper-stock cream --output output/book
```

Installed requirements: Node/commander, Pandoc, XeLaTeX with the template packages,
Latin Modern OTF files, and Poppler `pdfinfo`. Do not install automatically. EPUB uses
existing zip/unzip. This fork intentionally uses deterministic Latin Modern, not a
font chosen from whichever optional fonts happen to be installed.

A matching first H1 book title is removed and H2 chapters promoted; a different first
H1 is retained as a chapter. `--keep-title-heading` overrides matching-title removal.
`short-title` heading attributes can supply running marks; otherwise long marks are
shortened while full body/TOC headings remain. A last-resort short 'Continued' header
prevents an oversized mark from overflowing.

The final page count controls minimum gutter, with bounded rebuilds. Private outputs
include `.build.log` and `.build.json` (source/tool/font identities and actual page count).
A private build is not automatically production-approved. Review any overflow rejection;
do not bypass it by calling the compiler directly and then calling the result validated.

Run `node --test tests/*.test.js` and `python3 tests/render_regression.py --output <external-directory>`.
`--synthetic-fixture` accepts only the fixture manifest's exact bytes and still requires
external output storage. Never enable public tests for an arbitrary private path.

## CI boundary

The public-content workflow runs only source/guard tests on reviewed synthetic data;
it installs no rendering toolchain and uploads no book/artifact. Local rendered QA is
still required before a candidate pin. CI runs after publication and cannot undo an
accidental disclosure, so explicit staging/pre-push review remain essential. Existing
upstream-owned deployment jobs are not activated for maintained-fork builds.


## Reviewed repair controls

The PDF/EPUB and both sidecars are reserved with exclusive no-follow creation;
existing companions are preserved, and writes use held file descriptors. Rendering
and EPUB repacking occur in the private temporary folder before final bytes are
written. This is still not an adversarial-filesystem or OS security sandbox.

Each Markdown file is parsed locally, its image targets rewritten to the exact
validated canonical file, and its AST blocks combined in basename order. Per-file
metadata is merged with later files taking precedence; CLI metadata overrides it.
Missing resources stop the build instead of producing an incomplete EPUB. Two
manuscript directories may use the same image basename without choosing each
other's image. The original candidate tag remains historical; repairs use new SHAs.
