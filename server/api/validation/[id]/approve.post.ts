import { mkdir, rename, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

import { defineEventHandler, getRouterParam, readBody } from 'h3'

import type { FieldValues } from '../../../utils/formTemplate'
import type { ApproveResult } from '../../../utils/db'
import { approveForm, getForm } from '../../../utils/db'
import { apiError, internalError, isReply } from '../../../utils/errors'
import { requireReviewer } from '../../../utils/reviewers'

/**
 * Accepts a validated form, for the reviewer holding its claim.
 *
 * The corrected values are saved first and the file is filed away second — the
 * annotator's work is what matters, and a rename that fails must not lose it.
 */
export default defineEventHandler(async (event) => {
  const reviewer = requireReviewer(event)

  try {
    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id < 1) {
      throw apiError(400, 'invalid_id', 'Invalid document id.')
    }

    const row = getForm(id)
    if (!row) throw apiError(404, 'not_found', `No document #${id}.`)

    const body = await readBody<{ values?: FieldValues }>(event)
    const result = approveForm(id, body?.values ?? {}, reviewer)
    if (!result.ok) throw approvalError(id, reviewer, result)

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
  }
  catch (error) {
    throw isReply(error) ? error : internalError(error)
  }
})

/**
 * The reply for a refused approval. Names are shown on purpose: this is a trusted
 * team. Times are UTC, as stored.
 */
function approvalError(id: number, reviewer: string, result: Exclude<ApproveResult, { ok: true }>) {
  const hhmm = (stamp: string | null) => (stamp ?? '').slice(11, 16)

  switch (result.code) {
    case 'not_found':
      return apiError(404, 'not_found', `No document #${id}.`)
    case 'already_approved':
      return result.by === reviewer
        ? apiError(409, 'already_approved', `You approved this document at ${hhmm(result.at)} UTC.`)
        : apiError(409, 'already_approved', `Already approved by ${result.by ?? 'another reviewer'} at ${hhmm(result.at)} UTC. This document is no longer in your queue.`)
    case 'claimed_by':
      return apiError(409, 'claimed_by', `Claimed by ${result.by ?? 'another reviewer'}.`)
    case 'claim_expired':
      return apiError(409, 'claim_expired', `Your claim on #${id} expired at ${hhmm(result.at)} UTC. It is back in the queue.`)
  }
}

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
