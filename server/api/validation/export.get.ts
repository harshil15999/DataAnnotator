import { defineEventHandler, getQuery, setHeader } from 'h3'

import type { FormStatus } from '../../utils/db'
import { listForms } from '../../utils/db'
import { csvHeader, csvLayout, csvRows, toCsv } from '../../utils/formCsv'
import { buildFormPages, distinctFields } from '../../utils/formTemplate'

/**
 * Every form as one sheet: one row per person, five rows per document.
 *
 * `?status=approved` narrows it to finished work — that is what EXPORT ALL
 * asks for. With no status, everything comes out, whatever state it is in.
 */
export default defineEventHandler(async (event) => {
  const requested = String(getQuery(event).status ?? '')
  const status = ['under_validation', 'approved', 'failed'].includes(requested)
    ? requested as FormStatus
    : undefined

  // Column order comes from the template, the same source the console uses.
  const layout = csvLayout(distinctFields(await buildFormPages()).map(field => field.key))

  // Enough of the record to judge a row without opening the database: where it
  // came from, whether it can be trusted, and why it is empty when it is.
  const leading = [
    'id', 'filename', 'status', 'error',
    'pages', 'fields_read', 'fields_total', 'read_pct',
    'validated_at',
  ]

  const rows = listForms(status).flatMap(form =>
    csvRows(form.values, layout).map(cells => [
      String(form.id),
      form.filename,
      form.status,
      form.error ?? '',
      String(form.pageCount),
      String(form.fieldsFilled),
      String(form.fieldsTotal),
      form.fieldsTotal ? `${Math.round((form.fieldsFilled / form.fieldsTotal) * 100)}%` : '',
      form.updatedAt,
      ...cells,
    ]),
  )

  const name = status ? `forms-${status}` : 'forms-all'
  setHeader(event, 'content-type', 'text/csv;charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`)

  return toCsv(csvHeader(layout, leading), rows)
})
