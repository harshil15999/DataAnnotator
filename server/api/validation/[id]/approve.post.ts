import { mkdir, rename, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'

import type { FieldValues } from '../../../utils/formTemplate'
import { approveForm, getForm } from '../../../utils/db'

/**
 * Accepts a validated form.
 *
 * The corrected values are saved first and the file is filed away second — the
 * annotator's work is what matters, and a rename that fails must not lose it.
 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id < 1) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid document id.' })
  }

  const row = getForm(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: `No document #${id}.` })

  const body = await readBody<{ values?: FieldValues }>(event)
  const values = body?.values ?? {}

  if (!approveForm(id, values)) {
    throw createError({
      statusCode: 409,
      statusMessage: `Document #${id} is already ${row.status}.`,
    })
  }

  const { queue } = useRuntimeConfig()
  // Approving is what takes a document out of the working folder: until now the
  // pair has been sitting in `processing/`, which is why that folder alone
  // answers "what is still to do?".
  await moveDocument(
    resolve(process.cwd(), queue.processedDir),
    resolve(process.cwd(), queue.approvedDir),
    row.filename,
  ).catch(() => {
    // Approved is approved; the file just did not make it across.
    console.error(`[queue] #${id}: approved but ${row.filename} could not be moved`)
  })

  return { ok: true, id }
})

/**
 * Moves the document and its scan into the approved folder.
 *
 * A document is exactly two files, and both travel together: page images are
 * rendered on request rather than stored, so there is nothing else to carry.
 * Each name is checked before it is moved, so a pair missing its scan still
 * files the half that is there.
 */
async function moveDocument(fromDir: string, toDir: string, filename: string): Promise<void> {
  await mkdir(toDir, { recursive: true })

  const stem = basename(filename, extname(filename))

  for (const name of [filename, `${stem}.pdf`]) {
    const from = join(fromDir, name)
    if (!(await stat(from).then(() => true).catch(() => false))) continue
    await rename(from, join(toDir, name)).catch(() => {})
  }
}
