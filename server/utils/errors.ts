import { createError } from 'h3'

/**
 * A reply the reviewer can read. `statusMessage` goes on the screen; `data.code`
 * is a fixed word the console reads to decide what to do next.
 */
export function apiError(
  statusCode: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return createError({ statusCode, statusMessage: message, data: { code, ...extra } })
}

/**
 * Turns an unexpected failure into the generic reply. The detail goes to the
 * server log under the same reference the reviewer sees. Nothing else leaves
 * the server.
 */
export function internalError(error: unknown) {
  const reference = crypto.randomUUID().slice(0, 8)
  console.error(`[api] ${reference}:`, error)
  return apiError(500, 'internal', `Something went wrong. Try again. Reference: ${reference}.`)
}

/** Whether an error is already a reply built by {@link apiError} or h3, and so must pass through. */
export function isReply(error: unknown): boolean {
  return typeof (error as { statusCode?: unknown }).statusCode === 'number'
}
