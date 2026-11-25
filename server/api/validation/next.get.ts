import { defineEventHandler, setResponseStatus } from 'h3'

import type { OcrResponse } from '../../utils/formResult'
import { claimNext } from '../../utils/db'
import { internalError, isReply } from '../../utils/errors'
import { buildFormPages } from '../../utils/formTemplate'
import { buildResponse } from '../../utils/formResult'
import { requireReviewer } from '../../utils/reviewers'

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
  /** When this reviewer's claim started (UTC, `YYYY-MM-DD HH:MM:SS`). */
  claimedAt: string
}

/**
 * Hands the requesting reviewer one document to check, and claims it for them.
 *
 * Shaped as an `OcrResponse` plus a few queue fields, so the console renders it
 * through exactly the path the blank form takes. An empty queue is a 204.
 */
export default defineEventHandler(async (event): Promise<ValidationDocument | null> => {
  const reviewer = requireReviewer(event)

  try {
    const row = claimNext(reviewer)

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
      claimedAt: row.claimedAt ?? '',
    }
  }
  catch (error) {
    throw isReply(error) ? error : internalError(error)
  }
})
