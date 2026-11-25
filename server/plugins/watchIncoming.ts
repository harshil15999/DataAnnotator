import { mkdir, readFile, readdir, rename, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

import { deleteForm, findByFilename, insertFailed, insertForm, useDb } from '../utils/db'
import { buildFormPages } from '../utils/formTemplate'
import { hydrateFromJson } from '../utils/formJson'
import { buildResponse } from '../utils/formResult'
import { pdfPageCount } from '../utils/pdfPages'

/**
 * Watches the processing folder and reads whatever lands in it.
 *
 *   processing/ --(read ok)--> stays put, status 'under_validation'
 *               --(bad)------> failed/, status 'failed'
 *
 * A document is a **pair** sharing one name: `Form_2.json`, the extraction of a
 * scanned form into named fields, and `Form_2.pdf`, the scan it was read from.
 * The JSON supplies the values; the PDF is what the annotator checks them
 * against, a page at a time. Neither is much use alone, so a JSON without its
 * PDF is refused rather than half-processed.
 *
 * The JSON is what this loop triggers on. A PDF arriving first sits untouched —
 * the pair is usually copied in one file at a time, and picking the PDF up
 * early would read a document whose values had not arrived yet.
 *
 * **A document that reads cleanly does not move.** It waits in `processing/`
 * until a person accepts it, and approving is what files it away. So the folder
 * answers "what is still to do?" by itself, and only two things ever leave it:
 * work that was finished, and work that could not be started. Documents already
 * read are skipped on later passes — the database, not the folder, remembers
 * which those are.
 *
 * Nothing is rendered here. Page images are produced on request from the PDF
 * that is already sitting in the folder, so there is no second copy of the scan
 * to keep in step with the document it belongs to.
 */

/** Partial downloads and editor scratch files are not documents. */
const IGNORED_EXTENSIONS = new Set(['.part', '.crdownload', '.tmp', '.download'])

/** Every valid form is two sheets; see {@link ingestExtraction}. */
const EXPECTED_PAGES = 2

/**
 * Ticks a settled extraction waits for its scan before being called an orphan.
 *
 * At the default 3s poll this is about half a minute — long enough for a large
 * PDF copied after its JSON, short enough that a genuinely unpaired file does
 * not sit in the folder unexplained.
 */
const PAIR_GRACE_TICKS = 10

/** The document of a pair: the extraction this watcher triggers on. */
function isExtraction(filename: string): boolean {
  return /\.json$/i.test(filename)
}

interface Seen { size: number; mtimeMs: number }

/** The queue's folders, resolved to absolute paths. */
type Dirs = Record<'incoming' | 'processed' | 'approved' | 'failed', string>

export default defineNitroPlugin((nitroApp) => {
  const { queue } = useRuntimeConfig()
  if (!queue.watch) {
    console.log('[queue] watcher disabled (NUXT_QUEUE_WATCH=false)')
    return
  }

  // A dev reload re-runs plugins; without this each edit leaves another loop.
  const store = globalThis as Record<symbol, unknown>
  const GUARD = Symbol.for('dataannotator.queue.watcher')
  if (store[GUARD]) return

  const state = { stopped: false, timer: null as ReturnType<typeof setTimeout> | null }
  store[GUARD] = state

  const dirs = {
    incoming: resolve(process.cwd(), queue.incomingDir),
    processed: resolve(process.cwd(), queue.processedDir),
    approved: resolve(process.cwd(), queue.approvedDir),
    failed: resolve(process.cwd(), queue.failedDir),
  }

  /** Sizes seen last tick, so a file still being copied in is left alone. */
  const settling = new Map<string, Seen>()

  /** Ticks each settled extraction has spent waiting for its scan to show up. */
  const waiting = new Map<string, number>()

  const tick = async () => {
    if (state.stopped) return
    try {
      await scan(dirs, settling, waiting)
    }
    catch (error) {
      // One bad tick must never end the loop.
      console.error('[queue] scan failed:', (error as Error).message)
    }
    finally {
      if (!state.stopped) state.timer = setTimeout(tick, queue.pollMs)
    }
  }

  void (async () => {
    await Promise.all(Object.values(dirs).map(dir => mkdir(dir, { recursive: true })))
    useDb() // open and migrate now, so a bad database fails loudly at boot
    console.log(`[queue] watching ${queue.processedDir}/ every ${queue.pollMs}ms`)
    state.timer = setTimeout(tick, 500)
  })()

  // Fires on dev reload as well as shutdown.
  nitroApp.hooks.hook('close', () => {
    state.stopped = true
    if (state.timer) clearTimeout(state.timer)
    delete store[GUARD]
  })
})

/** One pass over the processing folder. Sequential, so pairs are filed in order. */
async function scan(dirs: Dirs, settling: Map<string, Seen>, waiting: Map<string, number>): Promise<void> {
  const entries = await readdir(dirs.processed, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue
    if (IGNORED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue

    // The extraction is the document here; the PDF beside it is the scan it was
    // read from, and is filed away with it rather than picked up on its own.
    if (!isExtraction(entry.name)) continue

    const path = join(dirs.processed, entry.name)

    // A document that has been read stays in this folder until someone approves
    // it, so meeting one again is the ordinary case rather than a duplicate.
    // Checked before anything else, so a folder full of waiting work costs a
    // lookup per pass and nothing more.
    const existing = findByFilename(entry.name)
    if (existing && existing.status !== 'failed') continue

    if (!(await hasSettled(path, settling))) continue

    // Both halves have to hold still, not just the one that triggers the scan.
    // The extraction is a few tens of kilobytes and the scan is several
    // megabytes, so dropping the pair in together finishes the JSON long before
    // the PDF — checking only the JSON would read a half-written scan, or miss
    // it entirely, and reject a pair that was merely still arriving.
    const stem = basename(entry.name, extname(entry.name))
    const pdfPath = join(dirs.processed, `${stem}.pdf`)
    const pdfPresent = await stat(pdfPath).then(info => info.isFile()).catch(() => false)

    if (pdfPresent) {
      if (!(await hasSettled(pdfPath, settling))) continue
      waiting.delete(path)
    }
    else {
      // Give the scan time to arrive before calling the extraction an orphan;
      // whichever file is copied second, the pair is only judged once both have
      // had a fair chance to land.
      const ticks = (waiting.get(path) ?? 0) + 1
      waiting.set(path, ticks)
      if (ticks < PAIR_GRACE_TICKS) continue
      waiting.delete(path)
      // Out of patience — fall through, and let the ingest reject it by name.
    }

    settling.delete(path)
    settling.delete(pdfPath)

    if (existing) {
      // Putting a failed pair back is how you retry it: the old row goes, and
      // the document is read again from scratch.
      console.log(`[queue] ${entry.name}: retrying #${existing.id}`)
      deleteForm(existing.id)
    }

    await ingestExtraction(path, entry.name, dirs)
  }
}

/**
 * Whether a file has stopped changing since the last tick.
 *
 * A file still being copied in has a different size or mtime than it did a
 * moment ago. Reading one at that point yields a truncated document, which is
 * indistinguishable from a corrupt one by the time anything notices.
 */
async function hasSettled(path: string, settling: Map<string, Seen>): Promise<boolean> {
  const info = await stat(path).catch(() => null)
  if (!info || info.size === 0) return false

  const previous = settling.get(path)
  settling.set(path, { size: info.size, mtimeMs: info.mtimeMs })

  return previous !== undefined
    && previous.size === info.size
    && previous.mtimeMs === info.mtimeMs
}

/**
 * Reads one extraction and its scan, and records the pair as a document.
 *
 * Everything that can disqualify the pair is checked before any work is done,
 * so a bad document costs a `pdfinfo` call rather than a rasterize: the scan
 * has to be there, and it has to be the right length. The page count is the
 * cheapest honest signal that something is wrong — every valid form is two
 * sheets, so a document of any other length is a mis-scan or a mismatched pair,
 * and is better looked at by hand than half-annotated.
 *
 * A failure never reaches `insertForm` — it is filed straight to `failed/` with
 * the reason, and that is the end of it. Success is the only way in to the
 * review queue.
 */
async function ingestExtraction(path: string, filename: string, dirs: Dirs): Promise<void> {
  const stem = basename(filename, extname(filename))
  const pdfName = `${stem}.pdf`
  const pdfPath = join(dirs.processed, pdfName)

  /** Files the pair, records why, and gives up on it. */
  const reject = async (reason: string): Promise<void> => {
    console.error(`[queue] ${filename}: ${reason}`)
    insertFailed(filename, reason)
    await moveTo(path, dirs.failed, filename).catch(() => {})
    // The scan goes with it, so a retry means dropping the pair in again whole.
    await moveTo(pdfPath, dirs.failed, pdfName).catch(() => {})
  }

  if (!(await stat(pdfPath).then(info => info.isFile()).catch(() => false))) {
    await reject(`No scan beside this extraction. Expected ${pdfName} in the same folder.`)
    return
  }

  const pageCount = await pdfPageCount(pdfPath)
  if (pageCount === null) {
    await reject(`${pdfName} could not be read. It may be empty or corrupt.`)
    return
  }
  if (pageCount !== EXPECTED_PAGES) {
    await reject(`Expected a ${EXPECTED_PAGES}-page form, got ${pageCount}.`)
    return
  }

  console.log(`[queue] reading ${filename} with ${pdfName}`)

  let hydration
  let result
  try {
    hydration = await hydrateFromJson(await readFile(path, 'utf8'))
    result = buildResponse(await buildFormPages(hydration.values), hydration.values)
  }
  catch (error) {
    await reject(readErrorMessage(error))
    return
  }

  const row = insertForm({
    filename,
    pageCount,
    filledFields: result.filledFields,
    totalFields: result.totalFields,
    values: hydration.values,
    valuePages: hydration.valuePages,
  })
  console.log(`[queue] ${filename}: #${row.id}, ${result.filledFields}/${result.totalFields} fields — waiting for review`)
  if (hydration.membersDropped.length) {
    console.warn(`[queue] ${filename}: left out, no column free: ${hydration.membersDropped.join(', ')}`)
  }

  // Nothing is moved. The pair stays where it is until someone approves it.
}

/** Moves a file, not clobbering anything already sitting at the target. */
async function moveTo(from: string, toDir: string, filename: string): Promise<void> {
  await mkdir(toDir, { recursive: true })
  let target = join(toDir, filename)

  const stem = basename(filename, extname(filename))
  const extension = extname(filename)
  let suffix = 1
  while (await stat(target).then(() => true).catch(() => false)) {
    target = join(toDir, `${stem} (${++suffix})${extension}`)
  }

  await rename(from, target)
}

function readErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { statusMessage?: string; message?: string }
    return candidate.statusMessage ?? candidate.message ?? 'Unknown error'
  }
  return String(error)
}
