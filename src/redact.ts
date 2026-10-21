const SECRET = /auth|key|token|secret|cookie|password|signature/i

export const REDACTED = "[redacted]"

export function redactHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, name) => {
    result[name] = SECRET.test(name) ? REDACTED : value
  })
  return result
}

/** Some providers (e.g. Google) pass the API key as a query parameter. */
export function redactUrl(raw: string): string {
  const url = new URL(raw)
  for (const name of [...url.searchParams.keys()]) {
    if (SECRET.test(name)) url.searchParams.set(name, REDACTED)
  }
  return url.toString()
}
