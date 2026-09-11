import { defineEventHandler, setResponseStatus } from 'h3'

import type { OcrResponse } from '../../utils/formResult'
import { nextForValidation } from '../../utils/db'
import { buildFormPages } from '../../utils/formTemplate'
import { buildResponse } from '../../utils/formResult'

/** A document waiting to be checked: its page images and its filled-in form. */
export interface ValidationDocument extends OcrResponse {
  id: number
  filename: string
  /** One URL per page of the scan, in page order. */
  pageUrls: string[]
  /**
   * The source page each value was read off, keyed as the slots are.
   *
   * Lets the console jump to the page a field came from rather than leaving the
   * annotator to find it. A slot with no entry was never read off the scan.
   */
  valuePages: Record<string, number>
}

/**
 * Hands over the oldest document still waiting to be checked.
 *
 * "Waiting" is exactly `status = 'under_validation'` — nothing else, and no
 * filesystem check on top of it. A document that failed to read never reaches
 * that status (it goes straight to `failed`, see the watcher), so what this
 * ever returns is a document with real values to review.
 *
 * Shaped as an `OcrResponse` plus a few queue fields, so the console renders it
 * through exactly the path the blank form takes.
 */
export default defineEventHandler(async (event): Promise<ValidationDocument | null> => {
  const row = nextForValidation()

  if (!row) {
    setResponseStatus(event, 204)
    return null
  }

  return {
    ...buildResponse(await buildFormPages(row.values), row.values),
    id: row.id,
    filename: row.filename,
    pageUrls: Array.from(
      { length: Math.max(1, row.pageCount) },
      (_, index) => `/api/validation/${row.id}/page/${index + 1}`,
    ),
    valuePages: row.valuePages,
  }
})
