# Infomonk upstream compatibility: findings and proposed integration plan

Reviewed 20 October 2026. This is a source/Git audit and a proposed maintenance
process. No upstream application merge, compatibility refactor, workflow change,
installer or release was performed. The engineering harness remains paused
indefinitely. Read the [AI backend audit](genoffice-ai-stack-2026-10-20.md) first.

## What “updates with GenOffice” should mean

Automatically discover upstream changes and prepare a tested integration
candidate. Build and distribute an Infomonk release from that candidate after
review. Preserve upstream history and improvements, with small, explicit
Infomonk integration points and compatibility tests.

Future upstream changes cannot be guaranteed conflict-free. Successful text
merging and upstream CI are useful evidence, but neither verifies Infomonk's
workspace behavior. An installed Infomonk update must be an Infomonk artifact
using its own identity, profile, migrations and release channel.

## Actual divergence and merge result

| Item                                 | Measured at the audited application snapshots           |
| ------------------------------------ | ------------------------------------------------------- |
| Infomonk                             | `a4e787388c02a6eb52538e08e7c1ff8b1ea4e46f`              |
| Pinned upstream                      | `1cb2925afe173b266c1545a3871a397429e11b7e`              |
| Merge base                           | `1ca5e9adfc1807a158db19741eff825dba9ab757`              |
| Unique commits                       | 11 fork / 92 upstream                                   |
| Fork file changes                    | 352: 323 added, 29 modified; 112 binary assets          |
| Fork line changes                    | +50,665 / −378, across the whole tracked fork diff      |
| Upstream changed paths               | 1,257                                                   |
| Overlapping paths                    | 16                                                      |
| Three-way conflicts                  | 3 files / 7 conflict chunks                             |
| Shared foundations unchanged by fork | agent-core, ai-provider, ai-search, npm lockfile and CI |

`git merge-tree --write-tree --messages HEAD upstream/main` calculated a temporary
tree with conflicts. It wrote Git objects only: no checkout/index/branch merge.
Raw output is retained in ignored `.task/upstream-merge-audit.txt`.

| Conflicted file                               | Chunks | Invariants that must be combined                                                                     |
| --------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `apps/sheets/src/renderer/ai/AiChatPanel.tsx` | 4      | Infomonk Details/branding plus upstream chat queue, usage, citations and sidebar behavior            |
| `apps/shell/src/main/index.ts`                | 2      | Infomonk identity/profile plus upstream profile migration, bounds/restoration and new service wiring |
| `apps/shell/src/main/tab-manager.ts`          | 1      | Infomonk workspace insets plus upstream UI scaling and Windows restoration geometry                  |

The other overlapping paths are `.gitattributes`, README, Sheets preload/App/
ExcelShell, shell builder/package/preload/renderer entry, the inherited
find-replace test, electron-utils package exports and project-store store/types.
All 16 exact names are in the companion manifest.

The assistant panel has +316/−272 normal diff lines but only +47/−3 when ignoring
whitespace. Reindentation from the Details wrapper creates avoidable conflicts.
Most Infomonk source is already additive and namespaced; retain that separation.

## Highest-priority compatibility findings

1. **Integration needs semantic reconciliation.** Whole-side conflict resolution
   would discard branding/profile or upstream window/chat improvements. Preserve
   both products' invariants and test them explicitly.
2. **Clean merges can leave functionality unreachable or unimproved.** Upstream's
   new knowledge-base entry sits in a Home sidebar hidden by Infomonk's embedded
   Home styling. Separately, upstream connection-pinned remote fetching will not
   automatically replace Infomonk's `isSafeRemoteUrl` followed by ordinary fetch.
   Adopt the upstream transport at that call site while preserving existing
   cancellation, HTTPS, timeout, size and same-origin restrictions. Preserve its
   documented proxy limitation.
3. **Product/profile/release ownership is incomplete.** CLI discovery/settings
   still use GenOffice profiles; manual updater fallback still links to upstream
   releases; Linux package/executable identifiers remain GenOffice. Current CI
   does not trigger on pushes to the Infomonk development branch.

Additional known integration risk: Stop/New Chat while images are being prepared
may allow an old instruction to start afterward. This exists in fork and current
upstream source; it has not been reproduced in native runtime. It needs an
application-level test, rather than assuming core cancellation tests cover it.

## Proposed work, in order

### 1. Keep the pause and establish a reproducible integration candidate

- Use the pinned SHA above for the first synchronization. Create
  `codex/upstream-sync-1cb2925a` from the Infomonk branch; merge upstream there.
  Preserve public history and resolve all three conflicts by combining behavior.
  Do not rebase the already-pushed product history or update the real profile.
- Use the candidate's committed npm/Cargo lockfiles and native engine changes as
  a coherent set. Run `npm ci` in an isolated checkout. Do not copy new provider
  or skill files into an otherwise old dependency/type graph.
- Preserve Infomonk application IDs, profile overrides, disabled GA4 injection,
  local research files and licenses/notices. Keep `ee/` under its separate license.

### 2. Make the existing backend usable through small Infomonk adapters

- Keep AgentLoop, provider protocols and search routing upstream-owned. Add future
  domain capability through `AgentSkill` composition and existing transport APIs.
  Do not introduce a second assistant loop, credential store or document engine.
- Introduce one product/profile resolver used by shell, CLI discovery, GUI control
  and cloud-settings lookup. Preserve inherited environment compatibility and
  verify production/dev/explicit-profile resolution without reading another
  product's settings or registry.
- Expose the existing upstream knowledge-base panel through Workspace navigation.
  Keep global file stars, project sources and accepted-cell evidence distinct.
  Reuse paged reads/citation navigation and document creation rather than building
  another retrieval or writing stack.
- Make Details/brand/context content a narrow panel composition point, without
  wrapping and reindenting the whole inherited chat implementation. Keep the
  composer mounted so drafts and queued messages survive navigation.
- Put shared source-evidence contracts behind a small typed public adapter; avoid
  deep cross-app imports. Preserve additive workspace metadata through upstream
  project-store/chat changes.
- Integrate new preloads, custom provider profiles, usage types, imported skills
  and UI queues together. Imported skills' CLI writes require explicit mutation
  accounting and accurate UI statements about undo.

### 3. Prove compatibility before adopting the candidate

- Run formatting/theme/comment/skill-version/license gates, all workspace type
  checks, relevant unit/native engine tests, all-editor builds and round-trip
  preservation checks. Compare failures against the same environment's baseline.
- Add a fork-specific Windows acceptance policy covering fresh isolated profiles
  and copied prior-version workspaces. Verify native open/edit/formula/save/
  restart/export, accepted ledger versus native edits, source snapshots/evidence,
  manual corrections, metadata, chat/attachments/cancellation and profile routing.
- Cover 900/1450 window widths, light/dark themes, 100/125/150% interface scale,
  detached tabs, fullscreen and taskbar restore. Ensure workspace insets are
  applied exactly once with upstream scaling/restoration.
- Exercise new knowledge-base and imported-skill routes from the actual Infomonk
  UI. Validate file citations separately from immutable accepted-cell evidence.
- Reproduce and resolve the inherited Windows provider fixture failure; diagnose
  the intermittent CLI test before treating it as a reliable gate. A source
  merge or Linux CI success cannot waive these checks.

Upstream CONTRIBUTING now describes Playwright/Electron drivers as local,
on-demand tools, while its CI still contains an E2E job. Document the fork's
Windows acceptance policy explicitly. Do not silently infer a stable public
upstream testing policy or publish local drivers as an upstream contribution.

### 4. Establish ongoing source integration and separate release promotion

- Put the reviewed Infomonk baseline on protected fork `main` through a PR.
  Today `origin/main` still points to the original upstream baseline, while
  development is on `codex/infomonk-workspace`.
- Configure CI to cover the Infomonk integration branch and synchronization PRs.
  Current triggers cover `main`, `dev_*`, `release_*` and PRs targeting `main`,
  so development-branch pushes currently miss the gate.
- Add a daily upstream-check job that records a pinned SHA, divergence, changed
  packages, overlapping files, trial-merge conflicts and dependency/license
  changes. It may prepare one synchronization PR per unintegrated upstream head;
  subsequent changes update that candidate instead of creating duplicates.
- Require the static/unit/build and Windows acceptance results before human
  review/merge. Source synchronization does not automatically publish installers,
  migrate real user profiles or resume harness work.
- Build/sign Infomonk artifacts after integration. Test product identity, profile
  retention, migrations, CLI discovery, notices and update download/install using
  disposable environments. Replace upstream manual-download fallback links with
  the Infomonk channel and finish Linux identity before a Linux release.
- Preserve the existing `INFOMONK_UPDATE_URL` boundary. Promote only tested
  Infomonk artifacts through that feed; retain a known-good prior release and
  compatible workspace backup for rollback.

These jobs, branches, PRs, adapters and release changes are **proposed**, not
implemented by this audit. Do not create a recurring chat automation as a
substitute for repository-owned maintenance CI.

## Acceptance and remaining evidence limits

The next integration milestone is complete when the pinned candidate preserves
existing Infomonk behavior, exposes the selected inherited capabilities, passes
the declared Windows gates and can produce an Infomonk-owned update artifact.
The long-term process should detect and test later upstream changes rather than
promise all future updates will apply without intervention.

This audit verified current fork package tests, extracted upstream core tests,
local CLI operations and a successful upstream CI run. It did not resolve/build
the merged candidate, exercise live model accounts, test a native integrated AI
journey, upgrade an installed application or validate a release feed. The harness
stays paused after the audit and after any source integration until further owner
direction.
