import { defineEventHandler, getQuery, setHeader } from 'h3'

import type { FormStatus } from '../../utils/db'
import { listForms } from '../../utils/db'
import type { FieldValues } from '../../utils/formTemplate'
import { columnToField, constructName, getColumnNames } from '../../utils/formSchema'

/** Wraps a value in quotes when it holds a comma, quote, or line break. */
const escapeCsv = (value: string): string => {
  const normalized = value.replace(/\r\n?/g, '\n')
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized
}

/**
 * Export as CSV: one row per person, columns from SCHEMA_COLUMNS in formSchema.
 *
 * `?status=approved` narrows it to finished work — that is what EXPORT ALL
 * asks for. With no status, everything comes out, whatever state it is in.
 */
export default defineEventHandler(async (event) => {
  const requested = String(getQuery(event).status ?? '')
  const status = ['under_validation', 'approved', 'failed'].includes(requested)
    ? requested as FormStatus
    : undefined

  const columnNames = getColumnNames()

  const getValue = (values: FieldValues, colName: string, personNum: number): string => {
    const fieldKey = columnToField(colName)

    // Special handling for compound fields
    if (colName === 'Grand Father Of Head Of the Family') {
      return constructName(values, 'grandfather')
    }
    if (colName === 'Father Of Head Of the Family') {
      return constructName(values, 'father')
    }

    // Household fields (no person number)
    if (fieldKey && ['form_no', 'village', 'total_members'].includes(fieldKey)) {
      return String(values[fieldKey] ?? '')
    }

    // Person fields
    if (fieldKey) {
      const personKey = `p${personNum}.${fieldKey}`
      return String(values[personKey] ?? '')
    }

    return ''
  }

  const rows = listForms(status).flatMap((form) => {
    // Always export 5 rows (empty rows filtered by user). Each row also carries
    // who approved the document and when, so the sheet says who did the work.
    return Array.from({ length: 5 }, (_, idx) => {
      const personNum = idx + 1
      return [
        ...columnNames.map(col => getValue(form.values, col, personNum)),
        form.approvedBy ?? '',
        form.approvedAt ?? '',
      ]
    })
  })

  const name = status ? `forms-${status}` : 'forms-all'
  setHeader(event, 'content-type', 'text/csv;charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`)

  // Build CSV with header and rows
  const headerRow = [...columnNames, 'approved_by', 'approved_at'].map(col => escapeCsv(col)).join(',')
  const dataRows = rows.map(cells => cells.map(cell => escapeCsv(String(cell))).join(',')).join('\r\n')

  return `﻿${headerRow}\r\n${dataRows}\r\n`
})
