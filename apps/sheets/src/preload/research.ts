import { contextBridge, ipcRenderer } from 'electron'
import { EVIDENCE_CHANNEL, type SheetEvidenceApi } from '../../../shell/src/shared/research-api'

export function exposeSheetEvidence(): void {
  const api: SheetEvidenceApi = {
    cell: (selection) => ipcRenderer.invoke(EVIDENCE_CHANNEL, 'cell', selection),
    inspect: (details, index) => ipcRenderer.invoke(EVIDENCE_CHANNEL, 'inspect', details, index),
    open: (details, index) => ipcRenderer.invoke(EVIDENCE_CHANNEL, 'open', details, index),
  }
  contextBridge.exposeInMainWorld('infomonkEvidence', api)
}
