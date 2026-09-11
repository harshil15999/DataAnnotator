import type { FieldValues, FormPage, SummaryField } from './formTemplate'
import { distinctFields, summaryOf } from './formTemplate'

/**
 * The shape of a read document, and how one is packaged for the console.
 *
 * The server does not read documents. It renders the master form, serves what
 * is already in the queue, and takes corrections — nothing here calls a model
 * or any inference endpoint. Values reach the database from outside: the
 * extraction JSON the watcher reads, produced by whatever wrote it.
 */

export interface OcrResponse {
  /** The master form, filled in. Always complete, even when nothing was read. */
  pages: FormPage[]
  /** Every value on record, keyed by slot. */
  values: FieldValues
  summary: SummaryField[]
  totalPages: number
  /** Slots that hold a value, out of every slot the template declares. */
  filledFields: number
  totalFields: number
}

/** Packages the filled form, so every caller returns the same thing. */
export function buildResponse(pages: FormPage[], values: FieldValues): OcrResponse {
  const specs = distinctFields(pages)

  return {
    pages,
    values,
    summary: summaryOf(pages, values),
    totalPages: pages.length,
    filledFields: specs.filter(field => (values[field.key] ?? '') !== '').length,
    totalFields: specs.length,
  }
}
