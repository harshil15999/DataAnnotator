import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import Database from 'better-sqlite3'

import type { FieldValues } from './formTemplate'

/**
 * The document queue's database.
 *
 * One document is one row. Every page of it and all five person columns merge into a
 * single `values_json` blob keyed exactly as the template keys them (`p1.name`),
 * so a document physically cannot be split across rows. Both sides of the app
 * already speak that flat map — `FieldValues` on the server, `readFormValues()`
 * on the client — which is why nothing here maps between column names and form
 * fields, and why editing the template needs no migration.
 *
 * The whole flow this supports is deliberately small: a document arrives,
 * lands here as `under_validation` with whatever values were read off it, and
 * leaves by exactly one of two doors — approved (values kept, corrected or
 * not) or failed (never reaches this table at all; see `insertFailed`). There
 * is no third path and no in-between status.
 *
 * Only one person uses this, so there is no locking, no claim protocol and no
 * ownership: the folders carry the state and this carries the data.
 */

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type FormStatus = 'under_validation' | 'approved' | 'failed'

export interface FormRow {
  id: number
  filename: string
  /** Pages in the source document. */
  pageCount: number
  status: FormStatus
  /** Why the read failed; null otherwise. */
  error: string | null

  /** Slots the extraction filled, out of the template's total. */
  fieldsFilled: number
  fieldsTotal: number

  /** The slots the extraction filled, plus every correction made since. */
  values: FieldValues
  /** The source page each value was read off. Same keys as {@link values}. */
  valuePages: Record<string, number>

  updatedAt: string
}

/** The row shape SQLite actually hands back, before {@link hydrate}. */
interface RawRow {
  id: number
  filename: string
  page_count: number
  status: FormStatus
  error: string | null
  fields_filled: number
  fields_total: number
  values_json: string
  value_pages: string
  updated_at: string
}

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */

/**
 * Every statement is `IF NOT EXISTS`, so this runs on every boot and is a no-op
 * once the table exists — it cannot drop, replace or empty anything, and there
 * is no `DROP` anywhere in this file.
 *
 * There is deliberately no migration machinery. Changing the schema below will
 * not alter a database that already exists; delete `.data/forms.db` and let it
 * be created again. That is the right trade for a tool that is set up once.
 *
 * SQLite has no JSON type. Every JSON column below is TEXT with a `json_valid`
 * CHECK, so a malformed value is refused on write rather than surfacing much
 * later as a mysteriously empty form.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS forms (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,   -- also the CSV's grouping column

  -- The file. UNIQUE(filename) is what enforces one document, one row — note the
  -- identity is the name, not the bytes, so the same pair renamed reads twice.
  filename      TEXT NOT NULL UNIQUE,
  page_count    INTEGER NOT NULL DEFAULT 0,          -- pages in the source doc
  status        TEXT NOT NULL DEFAULT 'under_validation'
                CHECK (status IN ('under_validation','approved','failed')),
  error         TEXT,                                -- why the read failed; NULL otherwise

  fields_filled INTEGER NOT NULL DEFAULT 0,          -- slots the extraction filled
  fields_total  INTEGER NOT NULL DEFAULT 0,          -- slots the template declares (210)

  -- The form itself, keyed as the template keys its slots. All pages and all
  -- five people together: {"form_no":"104","p1.name":"Rajesh"}. Overwritten on approve.
  values_json   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(values_json)),
  -- Source page per value, same keys: {"p1.name":1,"p1.email":2}. Reflects what
  -- was read off the scan, so a field typed in by hand has no entry.
  value_pages   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(value_pages)),

  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Serves nextForValidation()'s "oldest waiting" lookup and the export's filter.
CREATE INDEX IF NOT EXISTS idx_forms_status ON forms (status, id);
`

/**
 * Creates the table if it is not there, and leaves it alone if it is.
 *
 * Existing rows are never touched: the only statements are `CREATE ... IF NOT
 * EXISTS`, so a restart adopts whatever is already on disk.
 */
function ensureSchema(db: Database.Database): void {
  const existed = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'forms'`)
    .get() !== undefined

  db.exec(SCHEMA)

  console.log(existed
    ? '[queue] using the existing forms table'
    : '[queue] created the forms table')
}

/* ------------------------------------------------------------------ *
 * Connection
 * ------------------------------------------------------------------ */

/**
 * Kept on `globalThis` rather than in a module variable so a dev reload reuses
 * the open handle instead of leaving a second one holding the file.
 */
const HANDLE = Symbol.for('dataannotator.queue.db')

export function useDb(): Database.Database {
  const store = globalThis as Record<symbol, unknown>
  const open = store[HANDLE] as Database.Database | undefined
  if (open?.open) return open

  const file = resolve(process.cwd(), useRuntimeConfig().queue.dbFile)
  mkdirSync(dirname(file), { recursive: true })

  const db = new Database(file)
  // WAL keeps a read from blocking behind the watcher's write, and the timeout
  // rides out the moment a dev reload has two handles open at once.
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  ensureSchema(db)

  store[HANDLE] = db
  return db
}

/**
 * Parses a JSON column, falling back rather than throwing.
 *
 * The CHECK constraints make malformed JSON unreachable on a database this
 * build created, but a row from an upgraded database carries no such guarantee
 * and one bad row must not take the queue down.
 */
function parseJson<T>(raw: string | null | undefined, fallback: T, label: string): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  }
  catch {
    console.error(`[queue] ${label} could not be parsed`)
    return fallback
  }
}

/** Turns a stored row into the shape the rest of the app uses. */
function hydrate(raw: RawRow | undefined): FormRow | null {
  if (!raw) return null

  return {
    id: raw.id,
    filename: raw.filename,
    pageCount: raw.page_count,
    status: raw.status,
    error: raw.error,
    fieldsFilled: raw.fields_filled ?? 0,
    fieldsTotal: raw.fields_total ?? 0,
    values: parseJson<FieldValues>(raw.values_json, {}, `#${raw.id} values_json`),
    valuePages: parseJson<Record<string, number>>(raw.value_pages, {}, `#${raw.id} value_pages`),
    updatedAt: raw.updated_at,
  }
}

/* ------------------------------------------------------------------ *
 * The record: save, read, edit, update
 * ------------------------------------------------------------------ */

/** Everything worth keeping about one document that was read. */
export interface NewForm {
  filename: string
  pageCount: number
  filledFields: number
  totalFields: number
  values: FieldValues
  /** The source page each value was read off. */
  valuePages: Record<string, number>
}

/** Records a document that was read successfully. It starts life waiting for review. */
export function insertForm(input: NewForm): FormRow {
  const row = useDb().prepare<unknown[], RawRow>(`
    INSERT INTO forms (
      filename, page_count, status,
      fields_filled, fields_total,
      values_json, value_pages
    )
    VALUES (?, ?, 'under_validation', ?, ?, ?, ?)
    RETURNING *
  `).get(
    input.filename,
    input.pageCount,
    input.filledFields,
    input.totalFields,
    JSON.stringify(input.values),
    JSON.stringify(input.valuePages),
  )

  return hydrate(row) as FormRow
}

/**
 * Records a document that could not be read, straight to `failed`.
 *
 * It never passes through `under_validation` — a document that failed to read
 * has no values to show and nothing to approve, so there is no review step for
 * it. The row exists only so the reason is not lost once the pair is filed
 * away to the failed folder.
 */
export function insertFailed(
  filename: string,
  error: string,
  meta: { pageCount?: number } = {},
): FormRow {
  const row = useDb().prepare<unknown[], RawRow>(`
    INSERT INTO forms (filename, page_count, status, error)
    VALUES (?, ?, 'failed', ?)
    RETURNING *
  `).get(filename, meta.pageCount ?? 0, error)

  return hydrate(row) as FormRow
}

export function getForm(id: number): FormRow | null {
  return hydrate(useDb().prepare<unknown[], RawRow>('SELECT * FROM forms WHERE id = ?').get(id))
}

/** The row for a filename, if this queue has seen it before. */
export function findByFilename(filename: string): FormRow | null {
  return hydrate(useDb().prepare<unknown[], RawRow>('SELECT * FROM forms WHERE filename = ?').get(filename))
}

/**
 * The oldest document still waiting to be checked.
 *
 * With one user this is the whole queue mechanism — no claiming, no locking.
 * A document leaves the queue by being approved.
 */
export function nextForValidation(): FormRow | null {
  return hydrate(useDb().prepare<unknown[], RawRow>(`
    SELECT * FROM forms WHERE status = 'under_validation' ORDER BY id LIMIT 1
  `).get())
}

/** Saves the corrected values and takes the document out of the queue. */
export function approveForm(id: number, values: FieldValues): boolean {
  const info = useDb().prepare(`
    UPDATE forms
       SET values_json = ?, status = 'approved', updated_at = datetime('now')
     WHERE id = ? AND status = 'under_validation'
  `).run(JSON.stringify(values), id)

  return info.changes === 1
}

/**
 * Forgets a document, so dropping the same filename in again re-reads it.
 *
 * Only used to retry a failed read: the filename is this queue's identity, and
 * a document that could not be read has nothing worth keeping.
 */
export function deleteForm(id: number): void {
  useDb().prepare('DELETE FROM forms WHERE id = ?').run(id)
}

export function listForms(status?: FormStatus): FormRow[] {
  const db = useDb()
  const rows = status
    ? db.prepare<unknown[], RawRow>('SELECT * FROM forms WHERE status = ? ORDER BY id').all(status)
    : db.prepare<unknown[], RawRow>('SELECT * FROM forms ORDER BY id').all()

  return rows.map(row => hydrate(row) as FormRow)
}

export function countsByStatus(): Record<FormStatus, number> {
  const counts: Record<FormStatus, number> = { under_validation: 0, approved: 0, failed: 0 }
  const rows = useDb()
    .prepare<unknown[], { status: FormStatus; n: number }>('SELECT status, count(*) AS n FROM forms GROUP BY status')
    .all()

  for (const row of rows) counts[row.status] = row.n
  return counts
}
