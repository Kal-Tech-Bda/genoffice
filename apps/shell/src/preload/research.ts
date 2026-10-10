import { contextBridge, ipcRenderer } from 'electron'
import { RESEARCH_CHANNEL, type ResearchApi } from '../shared/research-api'

export function exposeResearchApi(): void {
  const call = (method: string, ...args: unknown[]) =>
    ipcRenderer.invoke(RESEARCH_CHANNEL, method, ...args)
  const api: ResearchApi = {
    state: (id) => call('state', id),
    save: (id, name, config, workflowId) => call('save', id, name, config, workflowId),
    run: (id, workflowId, sample) => call('run', id, workflowId, sample),
    cancel: (id, runId) => call('cancel', id, runId),
    retry: (id, runId) => call('retry', id, runId),
    publish: (id, runId, acknowledge, removals) =>
      call('publish', id, runId, acknowledge, removals),
    schedule: (id, workflowId, minutes, paused) =>
      call('schedule', id, workflowId, minutes, paused),
    copy: (id, workflowId) => call('copy', id, workflowId),
    accepted: (id, workflowId) => call('accepted', id, workflowId),
    correct: (id, workflowId, tableId, rowId, columnId, value, reason) =>
      call('correct', id, workflowId, tableId, rowId, columnId, value, reason),
    open: (id, workflowId) => call('open', id, workflowId),
    evidence: (id, evidence) => call('evidence', id, evidence),
    openEvidence: (id, evidence) => call('openEvidence', id, evidence),
  }
  contextBridge.exposeInMainWorld('infomonkResearch', api)
}
