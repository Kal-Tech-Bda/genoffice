import { z } from 'zod'
import { cell, hash } from './extract'
import type { Evidence, ResearchConfig, ResearchDataset } from '../../shared/research-api'

const responseSchema = z.tuple([
  z.object({
    page: z.coerce.number().int().positive(),
    pages: z.coerce.number().int().positive(),
    total: z.coerce.number().int().nonnegative(),
    per_page: z.coerce.number().int().positive(),
  }),
  z
    .array(
      z.object({
        indicator: z.object({ id: z.literal('SP.POP.TOTL') }),
        country: z.object({ value: z.string().max(200) }),
        countryiso3code: z.string().regex(/^[A-Z]{3}$/),
        date: z.string().regex(/^\d{4}$/),
        value: z.number().finite().nonnegative().nullable(),
      }),
    )
    .max(10),
])
export function worldBankUrl(config: ResearchConfig, page: number): string {
  const codes = [...new Set(config.countries)].sort().join(';')
  return `https://api.worldbank.org/v2/country/${codes}/indicator/SP.POP.TOTL?format=json&date=${config.fromYear}:${config.toYear}&per_page=10&page=${page}`
}
export function parsePopulation(
  bytes: Buffer,
  source: Omit<Evidence, 'locator' | 'excerpt' | 'method'>,
  config: ResearchConfig,
  page: number,
): { pages: number; total: number; dataset: ResearchDataset } {
  const original = JSON.parse(bytes.toString('utf8'))
  const [meta, records] = responseSchema.parse(original)
  if (meta.page !== page || meta.pages > 3 || meta.total > 30 || meta.per_page !== 10)
    throw new Error('Response exceeds confirmed scope (ten countries, three years, three pages).')
  if (
    records.some(
      (r) =>
        !config.countries.includes(r.countryiso3code) ||
        Number(r.date) < config.fromYear ||
        Number(r.date) > config.toYear,
    )
  )
    throw new Error('Response contains records outside confirmed scope.')
  const columns = [
    { id: 'country_code', name: 'Country code', type: 'text' as const },
    { id: 'country', name: 'Country', type: 'text' as const },
    { id: 'year', name: 'Year', type: 'number' as const },
    { id: 'population', name: 'Population', type: 'number' as const },
  ]
  return {
    pages: meta.pages,
    total: meta.total,
    dataset: {
      schemaVersion: 1,
      issues: [],
      tables: [
        {
          id: 'population',
          name: 'Population',
          rowMeaning: 'One World Bank population observation per country and year',
          columns,
          rows: records.map((r, i) => ({
            id: hash(`SP.POP.TOTL:${r.countryiso3code}:${r.date}`).slice(0, 24),
            cells: Object.fromEntries(
              columns.map((c) => {
                const field =
                  c.id === 'country_code'
                    ? 'countryiso3code'
                    : c.id === 'country'
                      ? 'country.value'
                      : c.id === 'year'
                        ? 'date'
                        : 'value'
                const value =
                  c.id === 'country_code'
                    ? r.countryiso3code
                    : c.id === 'country'
                      ? r.country.value
                      : c.id === 'year'
                        ? Number(r.date)
                        : r.value
                return [
                  c.id,
                  cell(
                    value,
                    [
                      {
                        ...source,
                        locator: `JSON /1/${i}/${field.replace('.', '/')}`,
                        excerpt: JSON.stringify(original[1][i]),
                        method: 'worldbank-SP.POP.TOTL-v1',
                      },
                    ],
                    'World Bank reports no observation',
                    [],
                    'external',
                  ),
                ]
              }),
            ),
          })),
        },
      ],
    },
  }
}
/** Only this public structured endpoint is reachable; no arbitrary URLs or credentials. */
export async function fetchPopulation(url: string, signal: AbortSignal): Promise<Buffer> {
  if (!/^https:\/\/api\.worldbank\.org\/v2\/country\/[A-Z;]+\/indicator\/SP\.POP\.TOTL\?/.test(url))
    throw new Error('Unsupported acquisition URL.')
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      redirect: 'error',
      headers: { Accept: 'application/json' },
    })
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retryHeader = response.headers.get('retry-after')
      const requested = retryHeader
        ? /^\d+(?:\.\d+)?$/.test(retryHeader)
          ? Number(retryHeader) * 1000
          : Date.parse(retryHeader) - Date.now()
        : 1000 * (attempt + 1)
      const retry = Math.max(1000, Number.isFinite(requested) ? requested : 1000)
      await response.body?.cancel()
      if (retry > 5000)
        throw new Error(
          `Acquisition rate limit asks for a longer wait (${Math.ceil(retry / 1000)} seconds). Retry later; accepted data unchanged.`,
        )
      signal.throwIfAborted()
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort)
          resolve()
        }, retry)
        function abort() {
          clearTimeout(timer)
          reject(new Error('Cancelled'))
        }
        signal.addEventListener('abort', abort, { once: true })
      })
      continue
    }
    if (!response.ok) throw new Error(`Acquisition failed: World Bank HTTP ${response.status}`)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Acquisition failed: empty HTTP body')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.length
        if (size > 2 * 1024 * 1024) throw new Error('Acquisition response exceeds 2 MiB')
        chunks.push(chunk.value)
      }
    } finally {
      await reader.cancel()
    }
    return Buffer.concat(chunks)
  }
  throw new Error('Acquisition retries exhausted')
}
