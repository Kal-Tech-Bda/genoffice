# GenOffice architecture and Infomonk extension boundaries

Audit date: 9 October 2026. Upstream revision:
`1ca5e9adfc1807a158db19741eff825dba9ab757`.

This describes source-confirmed architecture. Runtime evidence and limitations
are recorded separately in [docs/audit/verification.md](docs/audit/verification.md).
The inherited architecture below is the audited baseline. The implemented Infomonk
seams are described next. Stages 3–5 add the accepted ledger and local executor
described in [research contracts](docs/implementation/research-workflows.md).

## Implemented Infomonk seam (Stages 1–2)

```mermaid
flowchart LR
    Workspace[Project navigation and cleanup UI] --> API[Shell preload: window.infomonk]
    API --> IPC[Main-frame validated workspace IPC]
    IPC --> Projects[WorkspaceStore / reused ProjectStore]
    IPC --> Bounds[TabManager native view insets]
    Projects --> Owned[Owned XLSX and immutable source snapshots]
    IPC --> Profile[Saved-range profile and cleanup plan]
    Profile --> Gateway[Inherited CSV / XLSX patch and atomic writer]
    Gateway --> New[Separate cleaned workbook]
    New --> Editors[Inherited native editors and save paths]
```

- `apps/shell/src/shared/workspace-api.ts` is the typed boundary. The shell preload
  exposes it; secondary editor preloads do not. `workspace-ipc.ts` verifies the
  requesting shell main frame and bounds IDs, paths, URLs and rule inputs with
  existing Zod. URL registration is HTTP(S) only; it does not retrieve content.
- `workspace-store.ts` adapts existing project creation, file membership and chat
  persistence. Optional versioned `WorkspaceMetadata` adds description, star,
  primary/previous workbook, sources and a bounded activity list. Existing editor
  projects remain readable; Infomonk's project list selects metadata version 1.
- Owned files live under `userData/projects/{projectId}/workspace`. Local source
  bytes live under `sources/{sha256}/{name}`. Opening a source verifies its hash
  and copies it into a separate `previews/{uuid}` directory before native viewing.
  Source copies have no automatic retention/pruning policy yet.
- CSV/TSV imports reuse the inherited decoder, delimiter/parser and XLSX writer.
  Existing XLSX imports copy the original. Document, text and goal starts create a
  real blank workbook; extraction is an explicit workflow action. Inputs are bounded to 32 MiB;
  imports and chosen cleanup ranges are bounded to 100,000 cells.
- `clean-table.ts` reads the saved workbook, profiles the full chosen range and
  constructs deterministic rule plans. A 15-minute preview token pins the source
  hash; stale saved content is rejected. Apply uses the inherited atomic writer
  for a separate cleaned XLSX and switches the metadata pointer only after writing.
  Per-project apply is serialized. Previous version swaps pointers, keeping files.
  This is filesystem persistence, not an accepted-dataset transaction/ledger.
- Scalar transformations skip formulas. Row-moving/removing transformations
  require the full A1 used worksheet and headers, no formulas anywhere in the
  workbook and no named ranges or unsupported advanced structures. Narrow OOXML
  patches preserve untouched package parts; flat-row movement carries row/cell
  styles. New date-format columns get readable widths.
- Flat managed rows carry `_infomonk_record_id` in a hidden column and a validated
  `infomonk/records.json` ZIP part referenced by package relationships. IDs link
  to saved workbook SHA, sheet and original row. They move with cleanup records
  and native full-row sorts, survive native save/reopen and XLSX export. Native
  partial-column sorts are blocked; assistant sort proposals for managed sheets
  are rejected before expansion can produce unrelated per-cell writes. These IDs
  are origin links, not validation of edited values. CSV omits ZIP metadata; helper
  editing/copying and arbitrary agent mutations are not a maintained-data contract.
- `Workspace.tsx` owns project chrome. `TabManager.setWorkspaceInsets` hosts live
  editors below the tab strip/project toolbar and beside navigation. Section
  changes hide views without disposal. Assistant/Details mode switches preserve
  the mounted inherited assistant. The sheet retains its existing runtime, grid,
  formula engine, editing journal, undo, filters, charts, file save and providers.

Product identity is Infomonk with a separate userData directory, original SVG and
installer assets. Internal `@genoffice/*` package names and locks stay unchanged.
Builder app ID is `com.infomonk.app`. Upstream GA4 credential injection is disabled;
only `INFOMONK_UPDATE_URL` can configure the fork's feed. Genspark auth/cloud/search
remain optional inherited integrations and keep their identity. Secondary editor
branding and some upstream help/repository links remain. Installers were not tested.

## Research domain and execution (Stages 3–5)

`ResearchPanel → window.infomonkResearch → validated shell IPC → ResearchService`
connects task/schema/source confirmation, sample inspection, batch execution,
cell evidence, corrections and publication. The service reuses WorkspaceStore
snapshots/ProjectStore membership, inherited DOCX/PDF parsers, CSV/XLSX package
creation and atomic writes. `research-api.ts` defines the domain contracts.

`research/store.ts` uses the already available Node SQLite runtime for schema 2
migrations, the durable queue/input checkpoints, execution/validation events,
normalized accepted cells, immutable revisions and independent corrections.
It is separate from the regenerable search SQLite cache and UI/chat JSON.
Publication writes a separate XLSX first, then atomically advances the accepted
revision with configuration, processing, coverage and revision fences. Failed,
cancelled or obsolete execution cannot replace accepted data. Unreferenced output
files may remain after interruption before commit; no accepted pointer is advanced.

`research/extract.ts` separates source parsing from the supported quote-family
extractor. `worldbank.ts` is one strictly bounded structured adapter with durable
HTTP snapshots, pagination/scope/count validation, timeout and rate-limit backoff.
Enrichment matches confirmed public country codes against a local accepted quote
revision. No internal names/document text or provider secrets are sent externally.

The same SQLite queue owns app-open scheduling; no parallel scheduler or hosted
service exists. Missing execution times coalesce, pending review prevents overlap,
and scheduling never automatically publishes. Interrupted active runs become
failed resumable attempts on restart. Retry reuses acquired inputs; new runs
reacquire public responses. Full contracts are in the research document linked above.

`projection.ts` creates separate related worksheets with typed literals, hidden
record IDs and linked research/evidence metadata. Sheets exposes only a narrow
`window.infomonkEvidence` bridge. Main IPC derives the workbook path from its actual
Sheets tab, checks owned membership and resolves references through the ledger;
renderer-supplied source paths are never accepted. Details verifies the selected
record/column and warns on value/revision divergence. Native viewers use verified
snapshot copies. Arbitrary native edits do not silently become ledger corrections.

No new application parser/framework dependency or agent harness was installed.
The isolated parser experiment is documented separately. The owner puts the
engineering harness last; it remains disabled.

## Workspace accuracy and source-version seam

- Optional ProjectStore metadata records `startKind` and `workingWorkbook`.
  File starts route to Sources and public starts to the existing adapter controls.
  Opening/accepting an owned XLSX remembers it without changing the cleanup
  `primaryWorkbook`. Source/preview files cannot become the working workbook.
  Default reopen and export fallback resolve the same owned workbook.
- `WorkspaceStore.updateSource` retains logical source identity, saves a new
  content-addressed snapshot and appends the previous metadata version. Concurrent
  updates compare the old hash before changing the pointer. Preview IPC may select
  a trusted previous hash, verifies the immutable bytes and opens a separate copy.
  Profile relocation includes working workbooks and historical source paths.
- `ResearchService.queue` supplies local input references to `ResearchStore.queue`
  in the queue transaction. Execution and retry parse those pinned paths rather
  than re-resolving the latest project source. Confirmed duplicate-byte inputs
  remain pinned even when extraction deduplicates them. Publication checks the
  current selected content set both before projection and before accepted commit.
- Metadata SQL supplies Home summaries and freshness without loading historic
  candidate JSON. Counts cover accepted rows across related tables, unresolved
  cells, pending reviews and active runs. Current signatures include local hashes
  and enrichment parent revisions. Public sources retain acquisition timestamps;
  freshness does not probe remote changes.
- `pages.ts` applies Needs review across the complete table before the 100-row
  page. Overview reads at most 100 revision outputs and combines recent events
  and correction records into 50 research activity entries. Workspace Activity
  merges these with project activity and displays at most 100 entries. Older
  output count remains visible; run history remains separately paged.
- Sheets keeps the opening `inert` guard until Univer reaches Steady, preventing
  name-box navigation before scroll render dependencies exist. The lifecycle
  subscription is released on completion or renderer disposal.

The [workspace flow report](docs/testing/workspace-flow-2026-10-10.md) records
executed boundaries and the synthetic comparison.

The hardening boundary uses `ResearchStore.history/latest` to query indexed run
summaries without parsing candidate blobs or calculating historical diffs.
`pages.ts` limits candidate/accepted previews to 100 rows and removes evidence
payloads; explicit cell IPC retrieves trusted full evidence and prior values.
Absence is computed against complete stored datasets. Renderer polling awaits
completion and discards stale responses. `metadata.ts` shares the 16 Mi-character
publication/correction/reader bound; dataset previews never enter accepted writes.

`workspace-portability.ts` coordinates startup/closed-profile transfers with
session and maintenance markers, relocates owned references before services open,
and preserves historical source URIs/text. The CLI copies the owned project tree
and uses SQLite backup for the ledger. Restored automation is fenced in staging
before the destination is exposed. Root credentials/settings/caches are excluded.
The old-root marker persists until relocation completes so interruption is retriable.
Recovery and Stage 6's disabled engineering contract are documented in
[workspace recovery](docs/implementation/workspace-recovery.md) and
[Stage 6 preparation](docs/implementation/stage-6-preparation.md).

## Inherited system

The npm monorepo has seven Electron workspaces: shell, docs, sheets, slides,
PDF, Markdown and HTML. The shell imports editor main-process modules into its
own build; each editor has a separate React renderer and preload bridge.
Shared TypeScript packages own file engines, providers, agent behavior and UI.

```mermaid
flowchart LR
    Home[Shell home and tab strip] --> Bridge[Typed preload and IPC]
    Bridge --> Shell[Electron shell services]
    Shell --> Views[Live editor WebContentsViews]
    Views --> Sheet[React Sheets shell and Univer]
    Sheet --> SheetIPC[Sheets preload and validated IPC]
    SheetIPC --> Rust[Rust XLSX sidecar]
    SheetIPC --> Gateway[TypeScript OOXML gateway]
    Rust --> Disk[Native files and temporary chunks]
    Gateway --> Disk
    Views --> Agents[Shared agent loop and editor skills]
    Agents --> AIIPC[Streaming IPC transport]
    AIIPC --> Providers[Configured model providers or Codex bridge]
    Shell --> Search[SQLite file search index]
    Views --> Store[Local project metadata and JSONL chats]
```

### Shell, navigation and file ownership

`apps/shell/src/renderer/src/AppFrame.tsx` now renders Workspace and the tab strip;
legacy Home remains reachable through Local files.
Editor content is an Electron `WebContentsView`, positioned over the shell
content area by `apps/shell/src/main/tab-manager.ts`; it is not a React page
mounted within Home. Keep that distinction when adding project navigation:
ordinary shell DOM cannot simply overlay an editor view.

Home calls the `HomeApi` exposed as `window.aiOffice`; tab actions use
`window.aiOfficeTabs`. The preload routes these to main-process handlers in
`apps/shell/src/main/index.ts`. Routing is centralized in `app-routing.ts`.
`folder-tree.ts` manages real directory operations and root boundaries;
`detached-windows.ts` transfers live views between windows.

Local search is already substantial. `file-index/store.ts` uses Node's
`DatabaseSync`, WAL and SQLite FTS5. `indexer.ts` scans roots and extra recent or
starred paths, compares size/mtime, and delegates bounded text extraction to a
worker. `extract.ts` limits content indexing to 64 MB files and one million
characters. This mutable, regenerable search cache is not a source snapshot or
an accepted-dataset database. Optional reranking sends bounded excerpts to a
configured provider and is off by default.

The visible Genspark Projects view is a separate signed-in cloud list.
`cloud-projects.ts` paginates and caches account-bound project links and opens
relative links on Genspark. It must not be mistaken for Infomonk project storage.

### Workbook import, editing and save

`apps/sheets/src/renderer/App.tsx` composes the workbook runtime and surrounding
features; `ExcelShell.tsx` supplies the ribbon, status and assistant layout.
`create-univer.ts` composes selected free presets, deliberately avoiding the
meta-package that would import proprietary Pro packages. The lockfile pins the
embedded Univer packages to 0.25.1; current standalone examples are not
automatically compatible.

The Rust sidecar uses Calamine, IronCalc, Quick XML and ZIP processing. Main owns
the process and opaque workbook sessions through `xlsx-sidecar-client.ts`.
Cells stream through typed `readWorkbookRange` requests. `univer-sync.ts`,
`view-transform.ts` and `edit-journal.ts` project streamed file content and pending
changes into the grid. The journal covers more than values: structures, filters,
styles, worksheet lifecycle, visuals, tables and other supported states.

There are distinct small-workbook formula and larger streamed modes. Current
source defaults are a 50,000 stored-cell formula-mode ceiling; Full Load has
separate limits of one million value cells, two million stored cells and a
ten-million-cell value bounding box. These are application gates, not measured
Infomonk capacity guarantees. Do not infer whole-table coverage from the viewport.

`plan-operations.ts` validates the workbook DSL and loading constraints.
`lazy-plan.ts` compares previewed cell content with current cell content;
structural operations do not have the same per-cell comparison.
`op-executor.ts` executes through Univer and records edits. Its `ApplyOutcome`
explicitly allows `partiallyApplied` and `undoDropped`; a workbook batch is not
an unconditional database transaction.

`save-actions.ts` serializes the journal and live supported states. The preload
and `sheets-main.ts` validate the request and own file writes.
`packages/xlsx-gateway/src/gateway/xlsx-package-io.ts` reads/patches declared
archive parts, asserts preservation and promotes the temporary file. Saving
swaps/reopens sessions; view restoration and `undo-carry.ts` preserve supported
working state. Autosave recovery uses the same payload through a separate writer
and does not publish a research dataset revision.

CSV/TSV imports already have delimiter/encoding handling and preserve leading
zero strings. CSV export serializes display values, quotes fields and writes a
UTF-8 BOM with loss warnings. Its quoting helper does not establish a separate
formula-injection policy for untrusted plain-value exports.

### AI and evidence

The agent loop runs with editor-specific `AgentSkill` implementations. A skill
provides prompts, bounded context, tool schemas, execution and an optional
claimed-action verifier. Sheets already exposes `read_range`, `aggregate_range`,
`read_sheet_features`, formula tracing, `propose_operations`, `create_document`
and related tools. Attachments and search are composed as additional skills.

The transport sends streaming requests through preload IPC to provider code in
main. Cancellation uses the same shared IPC transport and AbortSignals. Tool
effects execute in application code rather than becoming arbitrary model-owned
shell operations. Tool outputs and conversation history are bounded.

`packages/ai-provider/src/codex-app-server.ts` is already a Codex model backend:
it starts App Server, requests structured text/tool-call output and forbids
Codex-owned tools in its instructions. It attempts a narrow permission profile,
checks the returned profile identity, and falls back to read-only for incompatible
servers. Read-only permits broader reads; this is not a private-data isolation
guarantee or a sandbox for generated processing code. No live Codex call was
performed during this audit.

Sheets citations use `sheetnav://` references and navigate worksheet addresses.
They do not link an extracted value to an immutable original-document version.
`packages/file-parse` returns plain text/image/unsupported results without a
general evidence locator contract. More structured starting points already
exist in `docx-engine` block anchors and `apps/pdf/src/main/read-text.ts` per-page
text, but no durable source-to-cell research mapping was established.

### Persistence, providers and secondary editors

`ProjectStore` is a filesystem service containing `index.json`, per-project
`project.json` and per-file JSONL chats. It already creates/renames projects,
moves file membership, resolves stable chat IDs after path changes, and produces
summaries/timelines. The current editor-facing `ProjectApi` primarily exposes
resolve, append, load and rebind chat operations. Metadata JSON writes are atomic
per file; they do not provide a transaction across an accepted dataset ledger.
Chat attachment records reference paths, not retained source bytes.

DOCX open/save uses structured block parsing and patching over original package
content. Docs archives originals by hash with bounded retention and maintains
per-turn history. Those mechanisms are useful editor recovery tools, not a
maintained research-source retention policy. PDF uses PDF.js for the renderer
and PDFium/pdf-lib for supported local operations. Slides, Markdown and HTML
remain reusable secondary editors and conversion surfaces.

Provider settings include API keys and are stored locally; Sheets returns the
settings object to its renderer through `aiGetSettings`. Do not repeat the older
architecture document's blanket claim that renderers never receive credentials.
Future worker execution needs a separate secret boundary. This audit neither
changed storage nor assessed every credential-handling path.

Source/dev analytics are inactive without packaged keys. Distribution settings,
Genspark authentication/cloud routes, optional media/search providers, branding,
app identity and injected update feeds need deliberate review before an Infomonk
distribution. No new telemetry or hosted service was configured here.

## Future extension boundaries and applied decisions

1. **Project metadata gateway (implemented for UI metadata):** adapt existing `ProjectStore` behind a narrow
   main-process service and typed IPC. Add Infomonk metadata and a primary workbook
   relationship without changing native workbook authority or repurposing cloud links.
2. **Workspace chrome (implemented):** focused shell/editor integration components for project
   navigation and Assistant/Details modes. Preserve live editor instances and the
   shared semantic theme tokens; do not grow Home or App into the entire product.
3. **Cleanup operations:** build on existing parsing, DSL, previews, execution,
   aggregation and saves. Add missing user-facing preview/original-copy behavior
   and explicit formula/load safety instead of rebuilding formulas or imports.
4. **Research domain (implemented for supported families):** immutable source versions, stable table/row/column
   identities, observations/evidence, accepted revisions, review and corrections.
   Declare one authoritative transactional store before introducing managed sheets.
5. **Adapters and execution (implemented locally):** one replaceable parsing boundary, one bounded
   web adapter, and eventually an isolated runner plus an authoritative scheduler.
   `packages/pipelines` currently exports slides only; create a distinct research
   workflow module rather than claiming an ETL engine already exists.

The Stage 0 audit itself changed no application behavior; subsequent Stages 1–5
implement the local seams above. See [the reuse map](docs/reuse-map.md) for decisions.
