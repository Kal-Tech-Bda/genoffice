# Local workspace backup and recovery

Implemented and verified on Windows x64 on 10 October 2026. Use the tested
Node 24 runtime for the CLI. Close Infomonk before transferring data.
Choose a new destination whose parent directory already exists; existing
destinations and nested source/destination folders are rejected.

```powershell
$infomonkProfile = Join-Path $env:APPDATA 'Infomonk Dev'
$infomonkBackup = Join-Path $env:USERPROFILE 'Documents\Infomonk Backup 2026-10-10'
$infomonkRestored = Join-Path $env:USERPROFILE 'Documents\Infomonk Restored 2026-10-10'
npm run workspace:backup -- backup --source "$infomonkProfile" --destination "$infomonkBackup"
npm run workspace:backup -- restore --source "$infomonkBackup" --destination "$infomonkRestored"
$env:INFOMONK_USER_DATA = $infomonkRestored
npx --no-install electron apps/shell
```

The backup includes the project directory tree: metadata, JSONL chats, owned
workbooks, immutable snapshots and preview files. SQLite's backup API captures
the research ledger consistently, including committed WAL content; `quick_check`
must succeed first. The backup excludes root provider/settings/auth files,
caches and external original files. Chats and snapshots remain private workspace
content. Provider configuration must be set up separately after restoration.

Restore relocates project file membership, primary/previous/working workbooks,
current and historical source snapshot paths, workflow/revision destinations, durable input paths and typed
chat file/attachment references. Original source URIs, evidence excerpts,
arbitrary chat/tool text and stable chat IDs retain their historical meaning.
External originals are not required to resolve an owned source snapshot.

Restored schedules are paused and queued/acquiring/processing attempts become
failed attempts requiring manual review and retry. Review candidates, accepted
revisions and human corrections remain intact. These fences are written before
the new destination folder is exposed. Startup and transfer share a maintenance
lock; active application session markers prevent backing up an open profile.
These locks coordinate Infomonk and this CLI, not arbitrary third-party writers.

The profile records its root in `infomonk-workspace.json`. Startup relocates a
legacy copied profile before opening research services. Migration keeps the old
root marker until all stores are updated, so interruption can be retried. A mixed
legacy root or malformed metadata stops startup with an explicit error instead
of launching the queue against unresolved paths. If relocation fails, preserve
the source and destination, repair the reported metadata problem and launch the
destination again. Do not overwrite a partially restored folder with another run.

Transfers build a sibling `.partial-UUID` folder and rename it only after copying
and database preparation. Failed partial folders are retained for inspection.
Symbolic links and directory junctions inside the project tree are rejected.
No automatic pruning, encrypted archive, continuous backup or cloud sync is added.
Relocation between Windows folders is runtime-tested; another computer/OS is not.

See [hardening verification](../testing/hardening-2026-10-10.md) and the permanent
unit/native restore tests for executed evidence.
