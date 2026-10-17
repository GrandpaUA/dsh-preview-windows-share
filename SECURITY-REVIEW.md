# Pre-publication security review (local candidate, NOT RELEASED)

Scope: every Git-visible file in this new repository and its Git index. This is a source/configuration review, not a scan of downloaded npm tarballs, installed dependencies, ignored local files, a remote repository, or runtime memory. The release has NOT been installed. Re-run the checks on the final staged commit after every change.

## Method and observations

- `verify-release.ps1` examines tracked and nonignored untracked files, refuses an unstaged/index mismatch, nontext data, reparse points, oversized files, protected state paths, local absolute paths, private-key headers and several credential/token patterns. It does not scan deliberately ignored files because they are not release inputs.
- Reviewed all Git-visible file paths. No chat logs, OAuth state, local credentials, generated profile, attachments, backups or workspaces are included. The original draft's old Git history was not copied into this repository.
- Checked all file text for private-key delimiters, common provider token prefixes, JWT-shaped values, secret-bearing URL query parameters, email-shaped strings and unusually long ASCII/base64-like values. No candidate secret was found. The apparent email matches are npm scoped patch identifiers in the two workspace manifests, not addresses. All 604 unusually long values occur on `resolution: {integrity: sha...}` lines in the two pnpm lockfiles: package checksums, not authentication values.
- Reviewed configuration fields that could conceal credentials: `apiKeyEnv` names are *references to recipient-provided environment variables*, not values. Provider `baseURL` entries are public service endpoints; no URL embeds a key. Personal session-usage counts and remarks about the source machine's credential setup were removed from the share template.
- Both entrypoints intentionally refuse to install/launch while first-party package pins remain BLOCK. The installation hold is **not** a secret-scan failure.

This is a heuristic/static review. It cannot prove the absence of every secret, determine whether a public-looking string is sensitive in the user's context, review npm packages without downloading/scanning them, or approve publication. Before any private push, inspect the final commit, review its full diff and history, and verify the exact destination and authorization. Never publish the original draft's inherited history.

## Simplest safe installation path

Today: **none**. Do not remove the hold to make the installer run. First obtain compatible first-party packages that pass `gate_scan`, review all WARN findings and lifecycle scripts, update and freeze both lockfiles, then test on a clean Windows host. Once approved, keep one entrypoint: `install.ps1` checks prerequisites, checks release contents, generates the ignored recipient-specific profile, installs runtime and web profile from frozen locks, and starts DSH by default. `-NoStart` remains optional for preparatory installation; `Start-Harness.ps1` is the later restart command. Avoid an extra installer framework or a bundled credential file. Enter credentials through the recipient's own DSH UI only after startup.
