import type { FieldValues } from './formTemplate'

/**
 * The form as a spreadsheet.
 *
 * A form is five people sharing one household header, so it exports as one row
 * per person: the household values repeated, then that person's own. Empty rows
 * are kept — a blank column is a fact about the document, and the sheet stays
 * the same width every time.
 */

/** Splits `p3.surname` into its person and its field. */
const PERSON_KEY = /^(p\d+)\.(.+)$/

export interface CsvLayout {
  /** Keys that belong to the form as a whole, including the notes block. */
  household: string[]
  /** The person columns, in template order: p1..p5. */
  persons: string[]
  /** The field names each person repeats. */
  perPerson: string[]
}

/**
 * Works out the column layout from the template's own key order, so the sheet
 * follows the document rather than an order invented here.
 */
export function csvLayout(keys: string[]): CsvLayout {
  const household: string[] = []
  const persons: string[] = []
  const perPerson: string[] = []

  for (const key of keys) {
    const match = key.match(PERSON_KEY)
    if (!match) {
      if (!household.includes(key)) household.push(key)
      continue
    }
    const person = match[1] as string
    const field = match[2] as string
    if (!persons.includes(person)) persons.push(person)
    if (!perPerson.includes(field)) perPerson.push(field)
  }

  return { household, persons, perPerson }
}

/** Column titles, optionally behind some leading columns of your own. */
export function csvHeader(layout: CsvLayout, leading: string[] = []): string[] {
  return [...leading, 'person', 'person_fields_filled', ...layout.household, ...layout.perPerson]
}

/**
 * One row per person for a single form.
 *
 * `person_fields_filled` counts that person's own non-empty fields, which is
 * what makes the sheet workable: every form emits five rows whether or not the
 * household has five people, and this is how you filter the empty ones out
 * without inspecting 39 columns by eye.
 */
export function csvRows(values: FieldValues, layout: CsvLayout): string[][] {
  return layout.persons.map((person) => {
    const own = layout.perPerson.map(field => values[`${person}.${field}`] ?? '')
    return [
      person,
      String(own.filter(Boolean).length),
      ...layout.household.map(key => values[key] ?? ''),
      ...own,
    ]
  })
}

/** Wraps a value in quotes when it holds a comma, quote, or line break. */
export function escapeCsv(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n')
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized
}

export function toCsvRow(cells: string[]): string {
  return cells.map(escapeCsv).join(',')
}

/** CRLF throughout, and a BOM so Excel reads the file as UTF-8. */
export function toCsv(header: string[], rows: string[][]): string {
  return `﻿${[header, ...rows].map(row => `${toCsvRow(row)}\r\n`).join('')}`
}
