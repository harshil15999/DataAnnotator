import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { platform } from 'node:process'
import { promisify } from 'node:util'

import { createError } from 'h3'

/**
 * Rasterizing a PDF to one image per page.
 *
 * The preview endpoint wants pages small enough to ship to the browser; the
 * options cover reading density too, for a caller that needs it. Format and
 * size are the only difference, so the rendering itself lives here once.
 */

const execFileAsync = promisify(execFile)

/** Rendering density for reading, in dots per inch. */
const PDF_RENDER_DPI = 200

/** Guards against a runaway multi-hundred-page upload. */
const MAX_PAGES = 40

export interface RasterizeOptions {
  format: 'png' | 'jpeg'
  /**
   * Longest-edge pixel ceiling. Pages that would render smaller than this at
   * {@link PDF_RENDER_DPI} keep that density; larger ones are scaled to fit.
   */
  maxEdgePx: number
  /** JPEG quality, ignored for PNG. */
  quality?: number
  /**
   * Render only this page, 1-based. Omit for every page.
   *
   * Rendering the one page a request asked for costs a fraction of rendering
   * the document, which matters when the pages are produced on demand rather
   * than kept on disk.
   */
  page?: number
}

/** The slice of the untyped `pdf-poppler` CommonJS module this file uses. */
interface PdfPopplerModule {
  convert: (file: string, opts: {
    format: 'png' | 'jpeg' | 'tiff'
    /** Longest-edge pixel size handed to poppler's `-scale-to`. */
    scale?: number
    out_dir: string
    out_prefix: string
    /** 1-based page number, or null for every page. */
    page?: number | null
  }) => Promise<string>
}

/**
 * Renders every page of a PDF to an image, in page order.
 *
 * `pdf-poppler` bundles poppler binaries for Windows and macOS only; on every
 * other platform its entry module logs an error and calls `process.exit(1)` as
 * a side effect of being imported, which would take the Nitro server down with
 * it. So it is loaded lazily, and only where it is supported. On Linux we call
 * the system poppler (`pdftoppm` from `poppler-utils`) directly, which is the
 * same renderer the package wraps.
 */
export async function rasterizePdf(
  pdfPath: string,
  outDir: string,
  options: RasterizeOptions,
): Promise<Buffer[]> {
  const { format, maxEdgePx, quality, page } = options
  const outPrefix = 'page'
  const extension = format === 'jpeg' ? 'jpg' : 'png'
  const longestEdgePx = await estimateLongestEdgePx(pdfPath)
  const oversized = longestEdgePx !== null && longestEdgePx > maxEdgePx

  if (platform === 'win32' || platform === 'darwin') {
    // A non-literal specifier: the package ships no types, and a literal
    // import would also let the bundler pull in its platform-gated entry.
    const specifier = 'pdf-poppler'
    const mod = await import(/* @vite-ignore */ specifier)
    const pdfPoppler = (mod.default ?? mod) as PdfPopplerModule

    // pdf-poppler exposes `-scale-to` rather than `-r`, so the target density
    // is expressed as a longest-edge pixel count.
    await pdfPoppler.convert(pdfPath, {
      format,
      scale: Math.round(Math.min(maxEdgePx, longestEdgePx ?? 11 * PDF_RENDER_DPI)),
      out_dir: outDir,
      out_prefix: outPrefix,
      page: page ?? null,
    })
  }
  else {
    const densityArgs = oversized
      ? ['-scale-to', String(maxEdgePx)]
      : ['-r', String(PDF_RENDER_DPI)]
    const formatArgs = format === 'jpeg'
      ? ['-jpeg', ...(quality ? ['-jpegopt', `quality=${quality}`] : [])]
      : ['-png']

    // `-f`/`-l` bound the render to a single page when one was asked for.
    const pageArgs = page ? ['-f', String(page), '-l', String(page)] : []

    await execFileAsync(
      'pdftoppm',
      [...formatArgs, ...densityArgs, ...pageArgs, pdfPath, join(outDir, outPrefix)],
      { maxBuffer: 32 * 1024 * 1024 },
    ).catch((error: unknown) => {
      if ((error as { code?: string }).code === 'ENOENT') {
        throw createError({
          statusCode: 500,
          statusMessage:
            'poppler-utils is not installed. Install it (for example `sudo apt-get install poppler-utils`) to process PDF uploads.',
        })
      }
      throw error
    })
  }

  const produced = (await readdir(outDir))
    .filter(name => name.startsWith(outPrefix) && name.toLowerCase().endsWith(`.${extension}`))
    .sort(comparePageFilenames)

  if (produced.length === 0) {
    throw createError({
      statusCode: 422,
      statusMessage: 'The PDF produced no pages. It may be empty or corrupt.',
    })
  }

  const pages = produced.slice(0, MAX_PAGES)
  return Promise.all(pages.map(name => readFile(join(outDir, name))))
}

/**
 * How many pages a PDF has, from `pdfinfo`. Null when it cannot be read.
 *
 * Cheap enough to ask before committing to anything: the queue uses it to turn
 * away a document of the wrong length before spending a rasterize on it.
 */
export async function pdfPageCount(pdfPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('pdfinfo', [pdfPath], { maxBuffer: 1024 * 1024 })
    const pages = Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1])
    return Number.isInteger(pages) && pages > 0 ? pages : null
  }
  catch {
    return null
  }
}

/**
 * Longest edge in pixels the first page would render to at
 * {@link PDF_RENDER_DPI}, from `pdfinfo`. Returns null when the size cannot be
 * read, in which case the plain density setting is used.
 */
async function estimateLongestEdgePx(pdfPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('pdfinfo', [pdfPath], { maxBuffer: 1024 * 1024 })
    const match = stdout.match(/^Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/m)
    if (!match) return null
    const widthPt = Number(match[1])
    const heightPt = Number(match[2])
    if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt)) return null
    // PDF user-space units are 1/72 inch.
    return (Math.max(widthPt, heightPt) / 72) * PDF_RENDER_DPI
  }
  catch {
    return null
  }
}

/** Orders `page-2.png` before `page-10.png`, which a plain sort would not. */
function comparePageFilenames(a: string, b: string): number {
  const pageNumber = (name: string): number => Number(name.match(/(\d+)\.(?:png|jpe?g)$/i)?.[1] ?? 0)
  return pageNumber(a) - pageNumber(b) || a.localeCompare(b)
}

