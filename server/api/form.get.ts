import { defineEventHandler } from 'h3'

import type { OcrResponse } from '../utils/formResult'
import { buildFormPages, distinctFields, summaryOf } from '../utils/formTemplate'

/**
 * The blank master form.
 *
 * The console renders this the moment it loads, before any document exists, and
 * falls back to it whenever nothing is queued. It is the same shape a queued
 * document returns, so the client has one render path for the empty form and
 * the filled one.
 */
export default defineEventHandler(async (): Promise<OcrResponse> => {
  const pages = await buildFormPages()

  return {
    pages,
    values: {},
    summary: summaryOf(pages),
    totalPages: pages.length,
    filledFields: 0,
    totalFields: distinctFields(pages).length,
  }
})
