# Upstream and local-checkout manifest

Recorded 9 October 2026.

| Item                            | Value                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Application upstream            | https://github.com/genspark-ai/genoffice                                                                                    |
| Configured Git remote           | `upstream=https://github.com/genspark-ai/genoffice.git`                                                                     |
| Upstream default branch         | `main`                                                                                                                      |
| Audited revision                | `1ca5e9adfc1807a158db19741eff825dba9ab757`                                                                                  |
| Working branch                  | `codex/infomonk-workspace`                                                                                                  |
| Checkout method                 | Reused the empty initialized workspace, fetched full upstream history, switched to the audited commit on the audit branch   |
| History                         | Not shallow; 889 commits reachable from the audited revision                                                                |
| Hosted Infomonk fork / `origin` | [Kal-Tech-Bda/genoffice](https://github.com/Kal-Tech-Bda/genoffice); `origin=https://github.com/Kal-Tech-Bda/genoffice.git` |
| Application changes             | Stages 1–2 workspace/branding/local cleanup; see patch inventory below                                                      |
| Root package version            | `genoffice@0.1.0`                                                                                                           |
| Shell package version           | `@genoffice/shell@0.11.0`                                                                                                   |
| Resolved embedded Univer        | `0.25.1`                                                                                                                    |
| Resolved Electron / React       | `43.7.6` / `19.2.7`                                                                                                         |
| Package manager                 | npm with committed `package-lock.json`; installed using `npm ci`                                                            |
| Tested environment              | Windows x64, Node `24.13.1`, npm `11.8.0`, Rust `1.93.0`, Cargo `1.93.0`, MSVC build tools available                        |
| Upstream runtime guidance       | `.nvmrc` selects Node 22; manifest requires Node >=22.12 and npm >=10; CI uses Node 22                                      |
| npm lockfile Git blob           | `8a571d83a84cf0cfe91d5ffbc59a4ee4ec36b6c2`                                                                                  |
| Native Cargo lockfile Git blob  | `ecf155e64a437cc12aec64584c76fd52804edad9`                                                                                  |

The checkout is connected to the public hosted fork
[Kal-Tech-Bda/genoffice](https://github.com/Kal-Tech-Bda/genoffice). After GitHub
CLI authentication became available, the fork was created and verified to have
`genspark-ai/genoffice` as its parent. `origin/main` matches the audited revision;
full local history and `codex/infomonk-audit` remain intact. `remote.pushDefault`
is set to `origin`. The implementation remains on the local `codex/infomonk-workspace` branch; no
implementation branch was pushed. The hosted fork exists independently of local work. Upstream main matched the supplied research revision at checkout; no
revision drift needed resolution.

## Licensing and distribution boundaries

- Keep root `LICENSE`, `NOTICE`, Unicode/font notices and existing attribution.
  The open-source application is Apache-2.0; `ee/` has a separate enterprise
  license and was not modified.
- The existing Univer composition avoids proprietary presets. The production
  npm license allowlist check passed; native `cargo-deny` was not run. This is
  not a complete license audit of every optional asset or future dependency.
- Internal workspace names and native-format compatibility are preserved.
  Stage 1 deliberately changes the public shell identity to Infomonk. Root version, app version and release tags
  are different concepts; do not globally replace version numbers.
- Infomonk uses `com.infomonk.app`, product name Infomonk and a separate profile.
  `INFOMONK_USER_DATA` overrides development profiles; `GENOFFICE_USER_DATA` remains
  a compatibility fallback for inherited tests. Default development data is
  `%APPDATA%/Infomonk Dev`. Upstream legacy migration is not run into this profile.
- Upstream GA4 credential injection is disabled in the builder. Fork updates
  require explicit `INFOMONK_UPDATE_URL`; no upstream feed is inherited. Genuine
  Genspark accounts/cloud/search, optional font CDN and upstream help/repository
  links remain. Do not describe them as Infomonk services. Packaging is untested. Linux retains upstream executable/desktop identifiers and
  maintainer metadata; review those before publishing a Linux package.
- Supporting candidates and their exact reviewed revisions/license boundaries
  are recorded in [research.md](research.md). No supporting repository was forked
  or additional processing framework installed.

## Local development

From this checkout, in PowerShell:

```powershell
npm ci
npm run fixtures
npm run fixtures -w @genoffice/sheets
npm run build:all
npm run dev
```

`build:all` includes the Rust release sidecar. In development, shell main imports
all editor main modules; rebuild the shell after main-process changes and rebuild
preloads after preload changes. The root `predev` script checks stale preloads.

For an isolated audit profile and synthetic-file folder:

```powershell
New-Item -ItemType Directory -Force .task/audit/dev-userdata, .task/audit/runtime-files | Out-Null
$auditSettingsPath = Join-Path (Resolve-Path .task/audit/dev-userdata).Path 'app-settings.json'
if (-not (Test-Path -LiteralPath $auditSettingsPath)) {
    @{onboardingSeen=$true; defaultSaveDir=(Resolve-Path .task/audit/runtime-files).Path; analyticsEnabled=$false} |
        ConvertTo-Json | Set-Content -LiteralPath $auditSettingsPath -Encoding utf8
}
$env:GENOFFICE_USER_DATA = (Resolve-Path .task/audit/dev-userdata).Path
$env:GENOFFICE_LANG = 'en'
$env:GENOFFICE_NO_SPARE_VIEW = '1'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run dev
```

The executed walkthrough additionally enabled the existing
`GENOFFICE_DEBUG_HOOKS=1` and electron-vite `REMOTE_DEBUGGING_PORT=9328` for local
automated inspection. These are audit settings, not recommended production
configuration. Audit processes were stopped after capture. Fresh-launch
verification used another scratch profile. Normal app settings and originals
were not overwritten.

No installer, signing, macOS/Linux runtime or browser deployment was verified.
Windows installer packaging has a documented native-sidecar staging distinction
between GNU and MSVC output paths; it remains outside this milestone.

## Upstream synchronization procedure

1. Keep audit/product work in small inspectable commits and retain this baseline
   SHA. Verify `origin` still points to the intended hosted fork before pushing;
   never push product work to `upstream`.
2. Run `git fetch upstream`, inspect snapshot changes and create a temporary
   integration branch from the current Infomonk branch. Upstream publicly ships
   squashed snapshot commits, as documented in `CONTRIBUTING.md`.
3. Merge the selected upstream revision into that integration branch, resolve
   product patches deliberately and update this manifest/lockfile record.
   Do not reset the working branch or broadly upgrade dependencies.
4. Run type checks, license checks and applicable unit/native checks, then
   Windows file open/edit/save/reopen, CSV/TSV, filter, tab and assistant/theme
   journeys. Compare failures against the recorded baseline rather than masking
   inherited failures or allowing new ones to hide among them.
5. Promote the integration only after resolving regressions and recording the
   new audited SHA. Keep enterprise and optional commercial modules separate.

Current baseline limitations are in [audit/verification.md](audit/verification.md).

## Local patch inventory (Stages 1–2)

- Shell public identity, original assets, package product metadata and installer
  identity/configuration; internal package names and dependency locks unchanged.
- Typed workspace preload/IPC; WorkspaceStore and bounded cleanup service.
- Optional versioned metadata on inherited ProjectStore; no new chat store.
- Project navigation, creation, Sources/Outputs/Activity, light/dark semantic UI.
- Native editor insets; Assistant/Details modes and managed-record sort guards.
- Meaningful cleanup/store/guard tests, adjusted Home title expectations and
  filter regression entry through Local files; `.task` excluded from lint like Git.
- Synthetic CSV/TSV/formula XLSX fixtures, baseline audit and implementation records.

Root LICENSE/NOTICE, `ee/`, `package-lock.json` and native Cargo lockfile are
unchanged. No dependency upgrades or supporting repository forks were made.
Final Stage 1–2 checks and limits are in
[implementation/verification.md](implementation/verification.md).
