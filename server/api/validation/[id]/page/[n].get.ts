import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'

import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'

import { getForm } from '../../../../utils/db'
import { rasterizePdf } from '../../../../utils/pdfPages'

/**
 * One page of a document's scan, rendered when it is asked for.
 *
 * The images are not kept. The PDF is already on disk beside the extraction it
 * belongs to, and rendering one page of it takes a fraction of a second, so
 * storing the result would only add a second copy of the same picture — one
 * that can go missing, go stale, or be left behind when the document moves.
 * Deriving it on request means the scan is available exactly as long as the
 * document is, and never disagrees with it.
 *
 * The scan only lives in the processing folder while the document is
 * `under_validation`; approving or failing moves the pair on. So the status on
 * the row — not a filesystem check — is what says whether there is anything
 * here to render.
 *
 * The browser is asked to cache the result, so paging back and forth across a
 * document does not re-render anything.
 */

/** Longest edge of a served page, in pixels. Enough to read handwriting at panel width. */
const PAGE_MAX_EDGE_PX = 1500

/** JPEG quality for a served page. */
const PAGE_QUALITY = 78

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  const page = Number(getRouterParam(event, 'n'))

  if (!Number.isInteger(id) || id < 1) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid document id.' })
  }

  const row = getForm(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: `No document #${id}.` })

  // Bounded before it reaches the filesystem: the page number is user input.
  if (!Number.isInteger(page) || page < 1 || page > Math.max(1, row.pageCount)) {
    throw createError({ statusCode: 400, statusMessage: `Document #${id} has no page ${page}.` })
  }

  if (row.status !== 'under_validation') {
    throw createError({
      statusCode: 404,
      statusMessage: `#${id} is ${row.status}, not waiting for review — its scan has moved on.`,
    })
  }

  const { queue } = useRuntimeConfig()
  const stem = basename(row.filename, extname(row.filename))
  const pdfPath = join(resolve(process.cwd(), queue.processedDir), `${stem}.pdf`)

  const workDir = join(tmpdir(), `page-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })

  try {
    const [image] = await rasterizePdf(pdfPath, workDir, {
      format: 'jpeg',
      maxEdgePx: PAGE_MAX_EDGE_PX,
      quality: PAGE_QUALITY,
      page,
    })

    if (!image) {
      throw createError({ statusCode: 404, statusMessage: `Page ${page} of #${id} produced no image.` })
    }

    setHeader(event, 'content-type', 'image/jpeg')
    setHeader(event, 'cache-control', 'private, max-age=3600')
    return image
  }
  finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
})
