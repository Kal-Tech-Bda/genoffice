import { contextBridge, ipcRenderer } from 'electron'
import { RESEARCH_CHANNEL, type ResearchApi } from '../shared/research-api'

export function exposeResearchApi(): void {
  const call = (method: string, ...args: unknown[]) =>
    ipcRenderer.invoke(RESEARCH_CHANNEL, method, ...args)
  const api: ResearchApi = {
    readiness: (id, workflowId) => call('readiness', id, workflowId),
    overview: (id) => call('overview', id),
    policy: (id) => call('policy', id),
    state: (id, offset, workflowId) => call('state', id, offset, workflowId),
    detail: (id, runId, page) => call('detail', id, runId, page),
    cell: (id, workflowId, runId, tableId, rowId, columnId) =>
      call('cell', id, workflowId, runId, tableId, rowId, columnId),
    absent: (id, runId, offset) => call('absent', id, runId, offset),
    save: (id, name, config, workflowId) => call('save', id, name, config, workflowId),
    run: (id, workflowId, sample) => call('run', id, workflowId, sample),
    cancel: (id, runId) => call('cancel', id, runId),
    retry: (id, runId) => call('retry', id, runId),
    publish: (id, runId, acknowledge, removals) =>
      call('publish', id, runId, acknowledge, removals),
    schedule: (id, workflowId, minutes, paused) =>
      call('schedule', id, workflowId, minutes, paused),
    copy: (id, workflowId) => call('copy', id, workflowId),
    createFrom: (id, workflowId, name, description) =>
      call('createFrom', id, workflowId, name, description),
    accepted: (id, workflowId, page) => call('accepted', id, workflowId, page),
    correct: (id, workflowId, tableId, rowId, columnId, value, reason) =>
      call('correct', id, workflowId, tableId, rowId, columnId, value, reason),
    open: (id, workflowId) => call('open', id, workflowId),
    evidence: (id, evidence) => call('evidence', id, evidence),
    openEvidence: (id, evidence) => call('openEvidence', id, evidence),
  }
  contextBridge.exposeInMainWorld('infomonkResearch', api)
}
