import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { WORKSPACE_CHANNEL, type WorkspaceApi } from '../shared/workspace-api'

export function exposeWorkspaceApi(): void {
  const call = (method: string, ...args: unknown[]) =>
    ipcRenderer.invoke(WORKSPACE_CHANNEL, method, ...args)
  const api: WorkspaceApi = {
    onSourceDrop: (listener) => {
      const onDrop = (event: DragEvent) => {
        if (
          !event.isTrusted ||
          !(event.target instanceof Element) ||
          !event.target.closest('[data-infomonk-source-drop]')
        )
          return
        event.preventDefault()
        const paths = Array.from(event.dataTransfer?.files ?? [])
          .slice(0, 20)
          .map((file) => webUtils.getPathForFile(file))
          .filter(Boolean)
        if (paths.length) listener(paths)
      }
      window.addEventListener('drop', onDrop)
      return () => window.removeEventListener('drop', onDrop)
    },
    list: () => call('list'),
    create: (input) => call('create', input),
    update: (id, patch) => call('update', id, patch),
    open: (id) => call('open', id),
    pickFile: () => call('pickFile'),
    filePreview: (path, delimiter) => call('filePreview', path, delimiter),
    addSource: (id, input) => call('addSource', id, input),
    openSource: (id, sourceId) => call('openSource', id, sourceId),
    layout: (left, top) => call('layout', left, top),
    profile: (id, sheetId, range, hasHeader) => call('profile', id, sheetId, range, hasHeader),
    preview: (id, options) => call('preview', id, options),
    discard: (token) => call('discard', token),
    apply: (id, token) => call('apply', id, token),
    undoCleanup: (id) => call('undoCleanup', id),
    exportWorkbook: (id) => call('exportWorkbook', id),
  }
  contextBridge.exposeInMainWorld('infomonk', api)
}
