import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const publicGate = vi.hoisted(() => vi.fn<(url: string) => Promise<boolean>>())
vi.mock('@genoffice/electron-utils/safe-remote-url', async (original) => ({
  ...(await original<typeof import('@genoffice/electron-utils/safe-remote-url')>()),
  isSafeRemoteUrl: publicGate,
}))
import { fetchTableSource, tableSourceUrl } from '../src/main/research/table-fetch'

const fetchMock = vi.fn<typeof fetch>()
const source = 'https://agency.example/data/table?year=2026'
const markup = '<!doctype html><table><tr><th>ID</th></tr><tr><td>001</td></tr></table>'
const html = (body = markup) =>
  new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })
const redirect = (to?: string, status = 302) =>
  new Response(null, { status, headers: to ? { location: to } : undefined })
const signal = () => new AbortController().signal
const never = <T>() => new Promise<T>(() => {})

beforeEach(() => {
  publicGate.mockReset().mockResolvedValue(true)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('public HTML table route', () => {
  it('canonicalizes HTTPS but preserves data-query values and encoded path text', () => {
    expect(tableSourceUrl('  https://AGENCY.example:443/a%20table?country=BM&year=2026  ')).toBe(
      'https://agency.example/a%20table?country=BM&year=2026',
    )
  })
  it.each([
    'http://agency.example/table',
    'file:///c:/private/table.html',
    'javascript:alert(1)',
    'https://user:secret@agency.example/table',
    'https://agency.example/table#selected',
    'https://agency.example/table#',
    'https://agency.example/account/l%6fgin',
    'https://agency.example/sign-in?next=/table',
    'https://agency.example/oauth2/authorize',
    'https://agency.example/table?access_token=secret',
    'https://agency.example/table?API_KEY=secret',
    'https://agency.example/ta\nble',
    'https://agency.example/%ZZ',
    'not a URL',
  ])('rejects unsupported/authentication input before DNS or request: %s', async (url) => {
    await expect(fetchTableSource(url, signal())).rejects.toThrow()
    expect(publicGate).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('bounded public table acquisition', () => {
  it('checks the public gate before GET, omits credentials and returns exact bytes and final URI', async () => {
    fetchMock.mockImplementation(async () => {
      expect(publicGate).toHaveBeenCalledWith(source)
      return html()
    })
    const captured = await fetchTableSource(source, signal())
    expect(captured.bytes).toEqual(Buffer.from(markup))
    expect(captured.uri).toBe(source)
    expect(Number.isNaN(Date.parse(captured.retrievedAt))).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      source,
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        signal: expect.any(AbortSignal),
        headers: { Accept: 'text/html', 'User-Agent': 'Infomonk/0.11 public-table-check' },
      }),
    )
  })

  it.each([
    'https://127.0.0.1/table',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/table',
    'https://metadata.internal/table',
    'https://public-name.example/table',
  ])('makes no request when the inherited address/DNS gate rejects %s', async (url) => {
    publicGate.mockResolvedValue(false)
    await expect(fetchTableSource(url, signal())).rejects.toThrow('public addresses')
    expect(publicGate).toHaveBeenCalledWith(url)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('follows at most three same-origin redirects and rechecks the gate at every hop', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('/data/one', 301))
      .mockResolvedValueOnce(redirect('/data/two', 307))
      .mockResolvedValueOnce(redirect('/data/final', 308))
      .mockResolvedValueOnce(html())
    expect((await fetchTableSource(source, signal())).uri).toBe('https://agency.example/data/final')
    expect(publicGate.mock.calls.map(([uri]) => uri)).toEqual([
      source,
      'https://agency.example/data/one',
      'https://agency.example/data/two',
      'https://agency.example/data/final',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls.every(([, init]) => init?.redirect === 'manual')).toBe(true)
  })

  it.each([
    'https://other.example/table',
    'https://agency.example:8443/table',
    'http://agency.example/table',
    'https://user:secret@agency.example/table',
    '/login?next=/table',
    '/data/table#table',
  ])(
    'blocks an unconfirmed or authentication redirect before the next request: %s',
    async (target) => {
      fetchMock.mockResolvedValueOnce(redirect(target))
      await expect(fetchTableSource(source, signal())).rejects.toThrow()
      expect(publicGate).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('does not fetch a same-origin redirect after its address gate changes to unsafe', async () => {
    publicGate.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    fetchMock.mockResolvedValueOnce(redirect('/new-table'))
    await expect(fetchTableSource(source, signal())).rejects.toThrow('public addresses')
    expect(publicGate).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops at the redirect budget and rejects missing or malformed destinations', async () => {
    fetchMock.mockResolvedValue(redirect('/loop'))
    await expect(fetchTableSource(source, signal())).rejects.toThrow('three-redirect limit')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    fetchMock.mockReset().mockResolvedValueOnce(redirect())
    await expect(fetchTableSource(source, signal())).rejects.toThrow('no destination')
    fetchMock.mockReset().mockResolvedValueOnce(redirect('https://['))
    await expect(fetchTableSource(source, signal())).rejects.toThrow('malformed')
  })

  it('refuses a transport that unexpectedly auto-followed a redirect', async () => {
    const response = html()
    Object.defineProperty(response, 'redirected', { value: true })
    fetchMock.mockResolvedValueOnce(response)
    await expect(fetchTableSource(source, signal())).rejects.toThrow('unreviewed redirect')
  })

  it.each(['application/json', 'application/xhtml+xml', 'text/html-malicious', '', 'text/plain'])(
    'requires successful text/html rather than %s',
    async (type) => {
      fetchMock.mockResolvedValueOnce(new Response(markup, { headers: { 'content-type': type } }))
      await expect(fetchTableSource(source, signal())).rejects.toThrow('did not return text/html')
    },
  )

  it('reports HTTP failures without accepting their HTML body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(markup, { status: 403, headers: { 'content-type': 'text/html' } }),
    )
    await expect(fetchTableSource(source, signal())).rejects.toThrow('HTTP 403')
  })

  it.each([
    '<form><input type="password"></form>',
    '<form action="/account/login?next=/table"><input name="username"></form>',
  ])('rejects a login form even when the server returns HTTP 200', async (body) => {
    fetchMock.mockResolvedValueOnce(html(body))
    await expect(fetchTableSource(source, signal())).rejects.toThrow('login form')
  })

  it('caps declared and chunked body bytes using the inherited reader', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('', {
        headers: { 'content-type': 'text/html', 'content-length': String(2 * 1024 * 1024 + 1) },
      }),
    )
    await expect(fetchTableSource(source, signal())).rejects.toThrow('2 MiB')
    const cancelBody = vi.fn()
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024))
        controller.enqueue(new Uint8Array(1024 * 1024 + 1))
      },
      cancel: cancelBody,
    })
    fetchMock.mockResolvedValueOnce(
      new Response(streamed, { headers: { 'content-type': 'text/html' } }),
    )
    await expect(fetchTableSource(source, signal())).rejects.toThrow('2 MiB')
    expect(cancelBody).toHaveBeenCalledTimes(1)
  })

  it('never exposes URL credentials, query secrets or raw transport errors in failures', async () => {
    publicGate.mockRejectedValueOnce(
      new Error('timed out at secret-user:secret-password@private.example'),
    )
    await expect(fetchTableSource(source, signal())).rejects.toThrow('public address check failed')
    fetchMock.mockRejectedValueOnce(
      new Error('Network failed at https://private.example?secret=hidden'),
    )
    await expect(fetchTableSource(source, signal())).rejects.toThrow(
      /^Table source request failed\./,
    )
    await expect(
      fetchTableSource('https://secret-user:secret-password@agency.example/table', signal()),
    ).rejects.toThrow(/^Table sources require HTTPS without credentials or fragments\.$/)
  })

  it('does not start DNS or fetch after cancellation', async () => {
    const abort = new AbortController()
    abort.abort('private caller details')
    await expect(fetchTableSource(source, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Table acquisition cancelled.',
    })
    expect(publicGate).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bounds DNS wait independently and makes no request after its timeout', async () => {
    vi.useFakeTimers()
    publicGate.mockImplementationOnce(() => never<boolean>())
    const result = expect(fetchTableSource(source, signal())).rejects.toThrow(
      'DNS check timed out after 5 seconds',
    )
    await vi.advanceTimersByTimeAsync(5_000)
    await result
    expect(fetchMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a stalled DNS wait immediately rather than waiting for lookup', async () => {
    publicGate.mockImplementationOnce(() => never<boolean>())
    const abort = new AbortController()
    const result = expect(fetchTableSource(source, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    abort.abort()
    await result
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels a stalled request and passes an aborted signal to its transport', async () => {
    const abort = new AbortController()
    fetchMock.mockImplementationOnce(async (_uri, init) => {
      abort.abort()
      expect(init?.signal?.aborted).toBe(true)
      return never<Response>()
    })
    await expect(fetchTableSource(source, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('enforces the 20-second total budget even when transport ignores cancellation', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce(() => never<Response>())
    const result = expect(fetchTableSource(source, signal())).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'Table acquisition timed out after 20 seconds.',
    })
    await vi.advanceTimersByTimeAsync(20_000)
    await result
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shares the overall timeout across DNS and redirect requests rather than restarting it', async () => {
    vi.useFakeTimers()
    publicGate.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(true), 4_000)),
    )
    fetchMock
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(redirect('/final')), 10_000)),
      )
      .mockImplementationOnce(() => never<Response>())
    const result = expect(fetchTableSource(source, signal())).rejects.toMatchObject({
      name: 'TimeoutError',
    })
    await vi.advanceTimersByTimeAsync(19_999)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await result
    expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a response that arrives after the caller has cancelled its ignored transport', async () => {
    const abort = new AbortController()
    let complete: (response: Response) => void = () => {}
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const result = expect(fetchTableSource(source, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    abort.abort()
    await result
    const cancelBody = vi.fn()
    complete(
      new Response(new ReadableStream({ cancel: cancelBody }), {
        headers: { 'content-type': 'text/html' },
      }),
    )
    await vi.waitFor(() => expect(cancelBody).toHaveBeenCalledTimes(1))
  })

  it('sanitizes a body-stream failure and times out a stalled body within the overall budget', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('Body failed at secret-user@private.example'))
          },
        }),
        { headers: { 'content-type': 'text/html' } },
      ),
    )
    await expect(fetchTableSource(source, signal())).rejects.toThrow(
      /^Table source HTML body could not be read;/,
    )
    vi.useFakeTimers()
    const cancelBody = vi.fn()
    fetchMock.mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel: cancelBody }), {
        headers: { 'content-type': 'text/html' },
      }),
    )
    const result = expect(fetchTableSource(source, signal())).rejects.toMatchObject({
      name: 'TimeoutError',
    })
    await vi.advanceTimersByTimeAsync(20_000)
    await result
    expect(cancelBody).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a stalled body stream and releases the underlying source', async () => {
    const abort = new AbortController()
    const cancelBody = vi.fn()
    fetchMock.mockResolvedValueOnce(
      new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
        headers: { 'content-type': 'text/html' },
      }),
    )
    const result = expect(fetchTableSource(source, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    abort.abort()
    await result
    await vi.waitFor(() => expect(cancelBody).toHaveBeenCalledTimes(1))
  })
})
