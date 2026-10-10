/** Server-owned preparation contract. This does not enable a coding agent or grant host access. */
export const ENGINEERING_POLICY = Object.freeze({
  version: 1,
  firstInputPattern: 'supplier-invoices-v1',
  privateDocumentProcessing: 'local-only',
  privateCloudRequests: false,
  generatedCodeExecution: false,
  requiredRunner:
    'isolated process with enforced filesystem, network, CPU, memory, time and output limits',
  budgets: Object.freeze({
    maxCostUsd: 0,
    maxAgentTurns: 8,
    sampleTimeoutSeconds: 60,
    runnerCpuSeconds: 10,
    runnerMemoryMiB: 512,
    runnerOutputMiB: 5,
  }),
  publication:
    'full coverage, valid schema, evidence and reviewed changes; enforced by application outside the agent',
  evaluationCorpus: 'fixtures/infomonk/engineering/expected.json',
})
export function assertEngineeringCapability(
  capability: 'execute-generated' | 'send-private-to-cloud',
): never {
  if (capability === 'execute-generated')
    throw new Error(
      'Generated pipeline execution is unavailable until an isolated runner passes acceptance checks.',
    )
  throw new Error(
    'Engineering workflows use private-only defaults. Private cloud processing is not authorized.',
  )
}
