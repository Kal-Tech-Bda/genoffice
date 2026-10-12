import { isSafeRemoteUrl } from '@genoffice/electron-utils/safe-remote-url'
import { readBodyCapped, ResponseTooLargeError } from '@genoffice/electron-utils/remote-image'
import { publicHtml, htmlAttr, htmlTag } from '@genoffice/electron-utils/public-html'

const MAX_BYTES = 2 * 1024 * 1024
const OVERALL_TIMEOUT_MS = 20_000
const DNS_TIMEOUT_MS = 5_000
const MAX_REDIRECTS = 3
const AUTH_PATH =
  /(?:^|\/)(?:log[-_]?in|sign[-_]?in|sign[-_]?up|register|oauth\d*|auth(?:enticate|entication|orize)?|sso|log[-_]?out)(?:$|[/._?#-])/i
const AUTH_PARAMETER =
  /^(?:password|passwd|access_token|refresh_token|id_token|token|authorization|auth|session(?:id|_id)?|api[-_]?key|client_secret)$/i
class DnsCheckTimeout extends Error {
  constructor() {
    super('Table source public DNS check timed out after 5 seconds.')
  }
}
/** Remote errors can contain credentials or complete URLs; public failures omit their causes. */
const sanitizedError = (message: string): Error => new Error(message)

/** Canonical public-table route; authentication and fragment routes are not acquisition inputs. */
export function tableSourceUrl(raw: string): string {
  if (
    typeof raw !== 'string' ||
    !raw.trim() ||
    [...raw].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new Error('Enter a valid public HTTPS table URL.')
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('Enter a valid public HTTPS table URL.')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.href.includes('#'))
    throw new Error('Table sources require HTTPS without credentials or fragments.')
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    throw new Error('Table source path is malformed.')
  }
  if (AUTH_PATH.test(path) || [...url.searchParams.keys()].some((key) => AUTH_PARAMETER.test(key)))
    throw new Error('Login and authentication routes are not public-table sources.')
  return url.href
}

/** Settle an operation without waiting indefinitely for DNS, a request or a body stream. */
function bounded<T>(
  task: Promise<T>,
  signal: AbortSignal,
  timeout?: { milliseconds: number; error: Error },
): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      reject(signal.reason)
    }
    if (signal.aborted) {
      // Attach rejection handling even if the supplied operation has already started.
      void task.catch(() => {})
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    if (timeout)
      timer = setTimeout(() => {
        cleanup()
        reject(timeout.error)
      }, timeout.milliseconds)
    task.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

async function discard(response: Response, signal: AbortSignal): Promise<void> {
  if (response.body)
    await bounded(
      response.body.cancel().catch(() => {}),
      signal,
    )
}

/**
 * Acquire a bounded HTML snapshot; no cookies, login, scripts or browser state.
 * DNS is rechecked before each request. The inherited gate is best-effort:
 * resolution is not pinned, so DNS rebinding between validation and fetch remains possible.
 */
export async function fetchTableSource(
  raw: string,
  signal: AbortSignal,
): Promise<{ bytes: Buffer; uri: string; retrievedAt: string }> {
  let uri = tableSourceUrl(raw)
  const origin = new URL(uri).origin
  const controller = new AbortController()
  const cancel = () =>
    controller.abort(new DOMException('Table acquisition cancelled.', 'AbortError'))
  if (signal.aborted) cancel()
  else signal.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('Table acquisition timed out after 20 seconds.', 'TimeoutError'),
      ),
    OVERALL_TIMEOUT_MS,
  )
  const acquisitionSignal = controller.signal
  try {
    for (let redirects = 0; ; redirects++) {
      acquisitionSignal.throwIfAborted()
      let safe: boolean
      try {
        safe = await bounded(isSafeRemoteUrl(uri), acquisitionSignal, {
          milliseconds: DNS_TIMEOUT_MS,
          error: new DnsCheckTimeout(),
        })
      } catch (error) {
        acquisitionSignal.throwIfAborted()
        if (error instanceof DnsCheckTimeout) throw error
        throw sanitizedError('Table source public address check failed.')
      }
      if (!safe) throw new Error('Table sources must resolve exclusively to public addresses.')
      acquisitionSignal.throwIfAborted()
      let response: Response
      try {
        const request = fetch(uri, {
          method: 'GET',
          signal: acquisitionSignal,
          redirect: 'manual',
          credentials: 'omit',
          headers: { Accept: 'text/html', 'User-Agent': 'Infomonk/0.11 public-table-check' },
        })
        // A custom transport can settle after the timeout despite its aborted signal.
        void request.then(
          (late) => {
            if (acquisitionSignal.aborted) void late.body?.cancel().catch(() => {})
          },
          () => {},
        )
        response = await bounded(request, acquisitionSignal)
      } catch {
        acquisitionSignal.throwIfAborted()
        throw new Error(
          'Table source request failed. Retry acquisition; accepted data is unchanged.',
        )
      }
      if (response.redirected || (response.url && response.url !== uri)) {
        await discard(response, acquisitionSignal)
        throw new Error('Table source transport followed an unreviewed redirect.')
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        await discard(response, acquisitionSignal)
        if (!location) throw new Error('Table source redirect has no destination.')
        if (redirects >= MAX_REDIRECTS)
          throw new Error('Table source exceeds the three-redirect limit.')
        let target: string
        try {
          target = new URL(location, uri).href
        } catch {
          throw new Error('Table source redirect destination is malformed.')
        }
        const next = tableSourceUrl(target)
        if (new URL(next).origin !== origin)
          throw new Error('Table source redirect leaves the confirmed HTTPS origin.')
        uri = next
        continue
      }
      if (!response.ok) {
        await discard(response, acquisitionSignal)
        throw new Error(
          `Table source unavailable (HTTP ${response.status}); accepted data is unchanged.`,
        )
      }
      if (!/^\s*text\/html\s*(?:;[^\r\n]*)?$/i.test(response.headers.get('content-type') ?? '')) {
        await discard(response, acquisitionSignal)
        throw new Error('Table source did not return text/html. Select a public HTML table page.')
      }
      // A signal-aware pass-through also cancels stalled mocked/custom streams;
      // readBodyCapped retains its declared-length and actual-byte checks.
      const readable = response.body
        ? new Response(
            response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), {
              signal: acquisitionSignal,
            }),
            { headers: response.headers },
          )
        : response
      let bytes: Buffer
      try {
        bytes = Buffer.from(await bounded(readBodyCapped(readable, MAX_BYTES), acquisitionSignal))
      } catch (error) {
        acquisitionSignal.throwIfAborted()
        if (error instanceof ResponseTooLargeError)
          throw sanitizedError('Table source exceeds the 2 MiB response limit.')
        throw sanitizedError(
          'Table source HTML body could not be read; accepted data is unchanged.',
        )
      }
      acquisitionSignal.throwIfAborted()
      const nodes = publicHtml(bytes)
      if (
        nodes.some(
          (node) =>
            (htmlTag(node) === 'input' && htmlAttr(node, 'type').toLowerCase() === 'password') ||
            (htmlTag(node) === 'form' && AUTH_PATH.test(htmlAttr(node, 'action'))),
        )
      )
        throw new Error(
          'Table source returned a login form; authenticated acquisition is unavailable.',
        )
      acquisitionSignal.throwIfAborted()
      return { bytes, uri, retrievedAt: new Date().toISOString() }
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
  }
}
