<script setup lang="ts">
import type { Ref } from 'vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

/* ---------- server contract (see server/api/form.get.ts) ---------- */

/** One fillable slot the master template declares. */
interface FieldSpec {
  key: string
  options?: string[]
  summary?: string
}

interface FormPage {
  /** Page banner, e.g. "PAGE 1 / 3". */
  marker: string
  title: string
  sub: string
  /** The page's body with its slots filled in. Each slot is editable. */
  html: string
  blank: boolean
  fields: FieldSpec[]
}

interface OcrResponse {
  pages: FormPage[]
  values: Record<string, string>
  totalPages: number
  filledFields: number
  totalFields: number
}

/* ---------- reactive app state ---------- */
/** True once GET PDF has put a queued document on screen. */
const loaded = ref(false)
const statusClass = ref('')
const statusText = ref('READY · model loaded')
const inputBadgeClass = ref('badge empty')
const inputBadgeText = ref('EMPTY')
const outBadgeClass = ref('badge waiting')
const outBadgeText = ref('WAITING')
const toastText = ref('Copied to clipboard')
const toastShow = ref(false)

/* ---------- the form being annotated ---------- */
/**
 * The master form, as the server rendered it. It is fetched blank the moment
 * the console loads and re-rendered with a document's values once one is taken
 * from the queue, so the panel always holds the same complete, editable form —
 * the extraction only decides how much of it arrives pre-filled.
 */
const formPages = ref<FormPage[]>([])
/**
 * Slots the user has typed into. A model answer that lands afterwards fills the
 * rest of the form without overwriting a correction already made by hand.
 */
const editedKeys = ref(new Set<string>())

/* ---------- the validation queue ---------- */
/** The document handed over by GET PDF, or null when none is being checked. */
const queueId = ref<number | null>(null)
const queueBusy = ref(false)
const queueStats = ref<Record<string, number> | null>(null)

const scanRef = ref<HTMLElement | null>(null)
const ocrRef = ref<HTMLElement | null>(null)
const ocrBodyRef = ref<HTMLElement | null>(null)
/** The queued document's own filename, shown in the panel header. */
const fileName = ref('')

/* ---------- the document being validated, page by page ---------- */
/**
 * One image URL per page of the scan, so it can be laid out beside the form page
 * for page. The watcher rendered these at ingest; each URL is served by
 * `GET /api/validation/[id]/page/[n]`.
 */
const docPages = ref<string[]>([])
/** The page both panels are showing. They never show different pages. */
const currentPage = ref(0)

const scanShow = computed(() => loaded.value)
/**
 * How many pages the pager walks through.
 *
 * The form's length normally, but a document with more pages than the form still
 * gets all of its pages looked at rather than being silently truncated.
 */
const pageCount = computed(() => Math.max(formPages.value.length, docPages.value.length))
/** The scan for the page on screen, if the document has one that far in. */
const currentScan = computed(() => docPages.value[currentPage.value] ?? null)
/**
 * The page banner. Both panels show the same one so the two sides always agree
 * on which page is open, including before any document has been fetched.
 */
const pageLabel = computed(() => `PAGE ${pageCount.value ? currentPage.value + 1 : 0} / ${pageCount.value}`)
/** True once the form is on screen, which is as soon as the template loads. */
const ocrShow = computed(() => formPages.value.length > 0)

function setStatus(cls: string, txt: string) {
  statusClass.value = cls
  statusText.value = txt
}

function showToast(msg: string) {
  toastText.value = msg
  toastShow.value = true
  setTimeout(() => {
    toastShow.value = false
  }, 1600)
}

/* ---------- the master form ---------- */

/**
 * Renders a form the server has filled in, and remembers which slots it filled.
 * Corrections already typed by hand are re-applied afterwards, so a model answer
 * arriving mid-edit adds to the form rather than overwriting the user.
 */
async function renderForm(result: OcrResponse) {
  const corrections = editedKeys.value.size ? readFormValues(editedKeys.value) : null

  formPages.value = result.pages
  if (currentPage.value >= pageCount.value) currentPage.value = 0

  await nextTick()
  if (corrections) writeFormValues(corrections)
  validateForm()
}

/**
 * Loads the blank master form. The panel shows it before any document exists,
 * so the form is always there to be filled in by hand, whether or not a
 * document was ever read into it.
 */
async function loadBlankForm() {
  try {
    await renderForm(await $fetch<OcrResponse>('/api/form'))
  }
  catch (error: unknown) {
    setStatus('', `FAILED · could not load the form template · ${readErrorMessage(error)}`)
  }
}

/* ---------- the validation queue ---------- */

/** One document from the queue: an OcrResponse plus where it came from. */
interface ValidationDocument extends OcrResponse {
  id: number
  filename: string
  pageUrls: string[]
}

async function refreshQueueStats() {
  queueStats.value = await $fetch<Record<string, number>>('/api/validation/stats').catch(() => null)
}

/**
 * Takes the next document waiting to be checked and puts it on screen.
 *
 * The pages and the scan go through the same refs a dropped file uses, so the
 * form rendering, the pager and the crosshair need no queue-specific handling.
 */
async function getPdf() {
  if (queueBusy.value) return
  queueBusy.value = true
  try {
    const doc = await $fetch<ValidationDocument | null>('/api/validation/next')
    if (!doc) {
      showToast('Nothing waiting to be validated')
      void refreshQueueStats()
      return
    }

    // Must come before renderForm: it re-applies edited slots after swapping
    // pages, so edits left over from the last document would leak into this one.
    editedKeys.value = new Set()

    queueId.value = doc.id
    fileName.value = doc.filename
    docPages.value = doc.pageUrls
    currentPage.value = 0
    scan.reset()
    form.reset()
    loaded.value = true
    inputBadgeClass.value = 'badge loaded'
    inputBadgeText.value = 'LOADED'
    outBadgeClass.value = 'badge done'
    outBadgeText.value = 'VALIDATE'

    await renderForm(doc)
    setStatus('done', `#${doc.id} · ${doc.filename} · ${doc.filledFields}/${doc.totalFields} fields read`)
    if (ocrRef.value) ocrRef.value.scrollTop = 0
    void refreshQueueStats()
  }
  catch (error: unknown) {
    showToast(`Could not get a document: ${readErrorMessage(error)}`)
  }
  finally {
    queueBusy.value = false
  }
}

/** Accepts the form as corrected, then moves straight on to the next one. */
async function approveDocument() {
  const id = queueId.value
  if (id === null || queueBusy.value) return
  queueBusy.value = true
  try {
    await $fetch(`/api/validation/${id}/approve`, {
      method: 'POST',
      body: { values: readFormValues() },
    })
    showToast(`Approved #${id}`)
  }
  catch (error: unknown) {
    showToast(`Could not approve: ${readErrorMessage(error)}`)
    return
  }
  finally {
    queueBusy.value = false
  }

  // Cleared before the next document is asked for, not after: the scan and the
  // values that were just approved should leave the screen with the document
  // they belong to. If nothing is waiting, what remains is the blank form rather
  // than an approved one that looks like it still needs checking.
  await clearWorkspace()
  setStatus('', `READY · approved #${id}`)
  await getPdf()
}

/** Puts the blank form back, discarding whatever was being edited. */
async function clearOutput() {
  editedKeys.value = new Set()
  outBadgeClass.value = 'badge waiting'
  outBadgeText.value = 'WAITING'
  await loadBlankForm()
}

/** Pulls a readable message out of whatever `$fetch` rejected with. */
function readErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      statusMessage?: string
      message?: string
      data?: { statusMessage?: string; message?: string }
    }
    return (
      candidate.data?.statusMessage
      ?? candidate.statusMessage
      ?? candidate.data?.message
      ?? candidate.message
      ?? 'The request failed.'
    )
  }
  return 'The request failed.'
}

/** Puts the console back to its empty state, without approving anything. */
/**
 * Empties both panels: no scan, no values, no document.
 *
 * Used when a document leaves the console, whichever way it goes. Approving one
 * has to clear it for the same reason abandoning one does — what is on screen
 * afterwards is either the next document or nothing, and the previous
 * annotator's answers must not be sitting there looking like either.
 */
async function clearWorkspace() {
  loaded.value = false
  docPages.value = []
  currentPage.value = 0
  scan.reset()
  form.reset()
  queueId.value = null
  fileName.value = ''
  inputBadgeClass.value = 'badge empty'
  inputBadgeText.value = 'EMPTY'
  await clearOutput()
}

async function resetAll() {
  await clearWorkspace()
  setStatus('', 'READY · nothing being validated')
}

/* ---------- reading the edited form back out ---------- */

/** The slot element for a key, on whichever page carries it. */
function slotElements(key: string): HTMLElement[] {
  const root = ocrBodyRef.value
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(`[data-field="${CSS.escape(key)}"]`))
}

/** Reads one slot, whether it is an editable cell or a dropdown. */
function readSlot(el: HTMLElement): string {
  const select = el.querySelector('select')
  const raw = select ? select.value : (el.textContent ?? '')
  return raw.replace(/\u00a0/g, ' ').trim()
}

/**
 * The form's current values, corrections included. Passing `keys` reads just
 * those slots. A key the template repeats across pages (the form number) is
 * reported once, from whichever copy of it holds a value.
 */
function readFormValues(keys?: Set<string>): Record<string, string> {
  const root = ocrBodyRef.value
  const values: Record<string, string> = {}
  if (!root) return values

  root.querySelectorAll<HTMLElement>('[data-field]').forEach((el) => {
    const key = el.dataset.field
    if (!key || (keys && !keys.has(key))) return
    const value = readSlot(el)
    if (value || !(key in values)) values[key] = value
  })

  return values
}

/** Writes values back into their slots, leaving every other slot untouched. */
function writeFormValues(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    for (const el of slotElements(key)) {
      const select = el.querySelector('select')
      if (select) select.value = value
      else el.textContent = value
    }
  }
}

/**
 * Copies an edited value into the slot's other copies.
 *
 * The form number is printed on both filled pages, so the same key has a cell on
 * each. Without this, correcting it on the page in view would silently leave the
 * other page disagreeing — and with one page on screen at a time, nothing would
 * show that it had. The edited element itself is skipped, so the caret stays put.
 */
function mirrorSlot(source: HTMLElement, key: string): void {
  for (const el of slotElements(key)) {
    if (el === source) continue
    const value = readSlot(source)
    const select = el.querySelector('select')
    if (select) select.value = value
    else if (el.textContent !== value) el.textContent = value
  }
}

/* ---------- marriage-date validation ---------- */

/** DD/MM/YYYY or DD-MM-YYYY with sane day/month ranges. */
function isDate(value: string): boolean {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value.trim())
  return !!m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12
}

/**
 * Flags each person's Date of Marriage cell red when it disagrees with their
 * Marital Status: married but blank, unmarried but filled, or a value that is
 * not a DD/MM/YYYY date. Runs over the hidden pages too, so a flag survives
 * paging away and back.
 */
function validateMarriage(): void {
  for (const p of ['p1', 'p2', 'p3', 'p4', 'p5']) {
    const cells = slotElements(`${p}.marriage_date`)
    if (!cells.length) continue
    const status = slotElements(`${p}.marital_status`)[0]
    const statusVal = status ? readSlot(status) : ''
    const date = readSlot(cells[0])
    const bad
      = (statusVal === 'Married' && date === '')
      || (statusVal === 'Unmarried' && date !== '')
      || (date !== '' && !isDate(date))
    for (const el of cells) el.classList.toggle('invalid', bad)
  }
}

function validateEmail(): void {
  for (const p of ['p1', 'p2', 'p3', 'p4', 'p5']) {
    const cells = slotElements(`${p}.email`)
    if (!cells.length) continue
    const v = (cells[0]!.innerText ?? '').replace(/ /g, ' ').trim()
    const bad = v !== '' && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)
    for (const el of cells) el.classList.toggle('invalid', bad)
  }
}

/** Every field rule, run together. Add new validate* calls here. */
function validateForm(): void {
  validateMarriage()
  validateEmail()
}

function scrollOcrTop() {
  ocrRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function scrollOcrBottom() {
  if (!ocrRef.value) return
  ocrRef.value.scrollTo({ top: ocrRef.value.scrollHeight, behavior: 'smooth' })
}

/* ---------- zooming and panning a panel ---------- */

/** Fit-to-width. Below this a page would be smaller than the panel showing it. */
const MIN_ZOOM = 1

/** Multiplier per wheel notch. Small enough that zooming feels continuous. */
const ZOOM_STEP = 1.12

/** Movement past this counts as a drag rather than a click. */
const DRAG_SLOP_PX = 4

/**
 * Ctrl-wheel to zoom, drag to move around, for one scrolling panel.
 *
 * Both panels want the same gesture, so it is written once. What differs is
 * only how the zoom is applied — the scan scales an image, the form scales a
 * page of markup — and whether a given press should pan at all, which the form
 * has to refuse over its editable cells or dragging to select text would move
 * the page instead.
 *
 * A bare wheel keeps its usual meaning, scrolling the panel, because that is how
 * you read down a page. Ctrl-wheel is the gesture the browser would otherwise
 * spend on zooming the whole console, which is never what is wanted here: it is
 * the document that needs a closer look, not the toolbar around it.
 */
function usePanZoom(
  panel: Ref<HTMLElement | null>,
  options: { max: number; canPan?: (target: HTMLElement) => boolean },
) {
  /** How much larger than fit-width the content is drawn. */
  const zoom = ref(MIN_ZOOM)

  /** True while a drag is in progress, so a cursor can say so. */
  const panning = ref(false)

  /** Where the drag started, and where the panel was scrolled to at the time. */
  let from: { x: number; y: number; left: number; top: number } | null = null

  /**
   * Whether the last gesture moved far enough to be a drag.
   *
   * A drag necessarily ends in a click, and that click must not also be read as
   * "act on whatever I released over".
   */
  let dragged = false

  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey) return
    e.preventDefault()

    const el = panel.value
    if (!el) return

    const previous = zoom.value
    const next = Math.min(
      options.max,
      Math.max(MIN_ZOOM, previous * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)),
    )
    if (next === previous) return

    // Hold the point under the cursor still, so zooming reads as leaning closer
    // to the page rather than the page sliding out from under the pointer.
    const rect = el.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top
    const atX = el.scrollLeft + offsetX
    const atY = el.scrollTop + offsetY
    const factor = next / previous

    zoom.value = next
    void nextTick(() => {
      el.scrollLeft = atX * factor - offsetX
      el.scrollTop = atY * factor - offsetY
    })
  }

  function onPointerDown(e: PointerEvent) {
    const el = panel.value
    if (e.button !== 0 || !el) return
    if (options.canPan && !options.canPan(e.target as HTMLElement)) return

    // Stops the browser starting its own drag or selection midway through.
    e.preventDefault()

    from = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    dragged = false
    panning.value = true
    // Capture, so a drag that leaves the panel keeps working until the button is up.
    el.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    const el = panel.value
    if (!from || !el) return

    const dx = e.clientX - from.x
    const dy = e.clientY - from.y
    if (!dragged && Math.hypot(dx, dy) > DRAG_SLOP_PX) dragged = true

    // The page follows the hand: drag left and the content goes left.
    el.scrollLeft = from.left - dx
    el.scrollTop = from.top - dy
  }

  function onPointerUp(e: PointerEvent) {
    if (!from) return
    panel.value?.releasePointerCapture(e.pointerId)
    from = null
    panning.value = false
  }

  /** Whether the gesture just finished was a drag. Reading it clears it. */
  function tookDrag(): boolean {
    const was = dragged
    dragged = false
    return was
  }

  /** Back to fit-width, at the top of the panel. */
  function reset() {
    zoom.value = MIN_ZOOM
    panel.value?.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
  }

  return { zoom, panning, onWheel, onPointerDown, onPointerMove, onPointerUp, tookDrag, reset }
}

/** The scan. Far enough in to read a cramped hand in a box meant for four characters. */
const scan = usePanZoom(scanRef, { max: 6 })
const scanZoom = scan.zoom
const scanPanning = scan.panning

/**
 * The form. Panning is refused over anything editable, so dragging inside a cell
 * still selects its text and clicking still puts the caret where you aimed —
 * only the space around the cells moves the page.
 */
const form = usePanZoom(ocrRef, {
  max: 4,
  canPan: target => !target.closest('[contenteditable="true"], select, input, button'),
})
const formZoom = form.zoom
const formPanning = form.panning

/** Back to fit-to-width, at the top of the page. */
function fitScan() {
  scan.reset()
}

/* ---------- the page pair on screen ---------- */

/** Both panels move together, so there is one page number for the two of them. */
function goToPage(index: number) {
  currentPage.value = Math.min(pageCount.value - 1, Math.max(0, index))
  scanRef.value?.scrollTo({ top: 0 })
  ocrRef.value?.scrollTo({ top: 0 })
}

function prevPage() {
  goToPage(currentPage.value - 1)
}

function nextPage() {
  goToPage(currentPage.value + 1)
}

/**
 * Records which slot was edited so a hand-typed correction is not replaced when
 * a document's values land after the user has already started fixing the form;
 * see {@link renderForm}. Fires for dropdowns too, which emit `input` alongside
 * `change`.
 */
function onFormInput(e: Event) {
  const target = e.target as HTMLElement | null
  const slot = target?.closest?.('[data-field]') as HTMLElement | null
  const key = slot?.dataset.field
  if (slot && key) {
    editedKeys.value.add(key)
    mirrorSlot(slot, key)
  }
  validateForm()
}

onMounted(() => {
  // Attached by hand rather than with `@wheel`, and explicitly non-passive.
  // A passive wheel listener cannot call `preventDefault`, and without that the
  // browser keeps Ctrl-wheel for zooming the whole console — the handler would
  // run, the page would scale, and the scan would never zoom at all.
  scanRef.value?.addEventListener('wheel', scan.onWheel, { passive: false })
  ocrRef.value?.addEventListener('wheel', form.onWheel, { passive: false })

  void refreshQueueStats()
  // The form is the panel's content, not a result: it is on screen before any
  // document exists and stays there between documents.
  void loadBlankForm()
})

onBeforeUnmount(() => {
  scanRef.value?.removeEventListener('wheel', scan.onWheel)
  ocrRef.value?.removeEventListener('wheel', form.onWheel)
})
</script>

<template>
  <div class="app">
    <!-- TOP BAR -->
    <div class="topbar">
      <div class="logo">
        <div class="g">📄</div>
        <span class="nm">Unlimited<span class="o">-OCR</span></span>
      </div>

      <div class="grow" />

      <div class="actions">
        <button class="btn get" :disabled="queueBusy" title="Take the next document waiting to be validated" @click="getPdf">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 3v5h5" />
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          </svg>
          GET PDF
          <span v-if="queueStats?.under_validation" class="qcount">{{ queueStats.under_validation }}</span>
        </button>
        <button class="btn approve" :disabled="queueId === null || queueBusy" title="Accept this form and move on to the next" @click="approveDocument">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          APPROVE
        </button>
        <a class="btn" href="/api/validation/export?status=approved" title="One combined sheet of every approved form">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 4h7l2 3h7v13H4z" />
            <path d="M12 11v5M9.5 13.5 12 11l2.5 2.5" />
          </svg>
          EXPORT ALL
        </a>
        <div class="header-sep" />
        <button class="btn" @click="resetAll">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 4v6h6" />
            <path d="M20 20v-6h-6" />
            <path d="M20 9a8 8 0 0 0-14-3L4 8M4 15a8 8 0 0 0 14 3l2-2" />
          </svg>
          RESET
        </button>
      </div>
    </div>

    <!-- STATUS -->
    <div class="status">
      <span class="st"><span class="d" :class="statusClass" /><span>{{ statusText }}</span></span>
      <div class="right">
        <span>PAGE <b>{{ pageCount ? currentPage + 1 : 0 }}</b> / <b>{{ pageCount }}</b></span>
        <span v-if="queueStats">QUEUE <b>{{ queueStats.under_validation ?? 0 }}</b> · <b>{{ queueStats.approved ?? 0 }}</b> done<template v-if="queueStats.failed"> · <b>{{ queueStats.failed }}</b> failed</template></span>
      </div>
    </div>

    <!-- PAGER: the scan and the form are always turned together -->
    <div v-if="pageCount > 1" class="pager">
      <span class="pagerhint">scan and form move together</span>
      <button class="pagebtn" :disabled="currentPage === 0" aria-label="Previous page" @click="prevPage">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <div class="pagenums">
        <button
          v-for="n in pageCount"
          :key="n"
          class="pagenum"
          :class="{ on: currentPage === n - 1, missing: n - 1 >= docPages.length && docPages.length > 0 }"
          :aria-current="currentPage === n - 1"
          :title="n - 1 >= docPages.length && docPages.length > 0 ? `Page ${n}: no page this far into the document` : `Page ${n}`"
          @click="goToPage(n - 1)"
        >
          {{ n }}
        </button>
      </div>
      <button
        class="pagebtn"
        :disabled="currentPage >= pageCount - 1"
        aria-label="Next page"
        @click="nextPage"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>

    <!-- WORKSPACE -->
    <div class="work">
      <!-- LEFT / ORIGINAL DOCUMENT -->
      <div class="col left">
        <div class="colhead">
          <span class="t">INPUT · ORIGINAL</span>
          <span class="badge" :class="inputBadgeClass.replace('badge ', '')">{{ inputBadgeText }}</span>
          <div class="icons">
            <button title="Fit to width" @click="fitScan">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
                <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Nothing is being validated yet. Documents arrive through the queue,
             so there is nothing to click here — GET PDF is the way in. -->
        <div v-if="!loaded" class="idle">
          <div class="marker cornermarker">{{ pageLabel }}</div>
          <div class="big">📄</div>
          <div class="h">Nothing being validated</div>
          <div class="s">Press GET PDF to take the next document from the queue.</div>
        </div>

        <div
          ref="scanRef"
          class="viewer scan"
          :class="{ show: scanShow }"
          :aria-label="`Scanned document, page ${currentPage + 1}`"
          @pointerdown="scan.onPointerDown"
          @pointermove="scan.onPointerMove"
          @pointerup="scan.onPointerUp"
          @pointercancel="scan.onPointerUp"
        >
          <template v-if="!docPages.length">
            <div class="marker pendingmarker">{{ pageLabel }}</div>
            <div class="scan-pending">
              The scan could not be rendered. The form beside it is still yours to fill in.
            </div>
          </template>

          <template v-else-if="!currentScan">
            <div class="marker pendingmarker">{{ pageLabel }}</div>
            <div class="scan-pending">
              This document has {{ docPages.length }} page{{ docPages.length === 1 ? '' : 's' }} —
              there is no page {{ currentPage + 1 }} to show beside this one.
            </div>
          </template>

          <!-- the one page paired with the form on the right -->
          <div
            v-else-if="currentScan"
            class="scanpage"
            :class="{ pannable: scanZoom > MIN_ZOOM, panning: scanPanning }"
            title="Ctrl+scroll to zoom · drag to move around"
          >
            <div class="marker scanmarker">{{ pageLabel }}</div>
            <img
              :src="currentScan"
              class="scan-image"
              :style="{ width: `${scanZoom * 100}%` }"
              :alt="`Uploaded document, page ${currentPage + 1}`"
              draggable="false"
            >
          </div>
        </div>
      </div>

      <!-- RIGHT / OCR OUTPUT (annotatable) -->
      <div class="col">
        <div class="colhead">
          <span class="t">FORM · ANNOTATABLE</span>
          <span class="badge" :class="outBadgeClass.replace('badge ', '')">{{ outBadgeText }}</span>
          <div class="icons">
            <button title="Scroll to top" @click="scrollOcrTop">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
            <button title="Scroll to bottom" @click="scrollOcrBottom">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </button>
          </div>
        </div>

        <div class="output-wrap">
          <div class="empty-state" :class="{ hide: ocrShow }">
            <div class="big">▦</div>
            <div class="h">Loading the form…</div>
            <div class="s">The blank form appears here, ready to fill in</div>
          </div>
          <div
            ref="ocrRef"
            class="viewer ocr"
            :class="{ show: ocrShow, panning: formPanning }"
            @pointerdown="form.onPointerDown"
            @pointermove="form.onPointerMove"
            @pointerup="form.onPointerUp"
            @pointercancel="form.onPointerUp"
          >

            <div ref="ocrBodyRef" class="ocr-body" :style="{ zoom: formZoom }" @input="onFormInput" @change="onFormInput">



  
              <!-- the master form: every slot is edited in place -->
              <!--
                Every page is rendered and the ones off-view are hidden with
                v-show rather than dropped: an edit on page 1 has to survive a
                trip to page 3, and COPY and CSV read the whole form out of the
                DOM, not just the page on screen.
              -->
              <div
                v-for="(page, pi) in formPages"
                v-show="pi === currentPage"
                :key="pi"
                class="pageblock"
              >
                <div class="marker">{{ page.marker }}</div>
                <template v-if="page.blank">
                  <div class="blank">(this page of the form is intentionally empty)</div>
                </template>
                <template v-else>
                  <div v-if="page.title" class="doctitle">{{ page.title }}</div>
                  <div v-if="page.sub" class="docsub">{{ page.sub }}</div>
                  <!-- eslint-disable-next-line vue/no-v-html -->
                  <div class="docbody" v-html="page.html" />
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="toast" :class="{ show: toastShow }">{{ toastText }}</div>
</template>

<style>
/* Global tokens & resets (must be unscoped: :root/html/body live outside this component) */
:root {
  --bg: #0a0c10;
  --panel: #0f1117;
  --card: #161b22;
  --line: #1c2430;
  --line-2: #2a3347;
  --ink: #e8eaf0;
  --muted: #8892a4;
  --dim: #4a5568;
  --teal: #00d4aa;
  --teal-dim: #008f73;
  --orange: #ff6b35;
  --orange-fill: rgba(255, 107, 53, 0.08);
  --red: #ef4444;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
  --sans: 'Inter', system-ui, sans-serif;
  --paper: #efeadf;
  --paper-2: #f7f4ec;
  --paper-ink: #23211c;
  --paper-line: #b7b0a0;
  --paper-dim: #8a8375;
}
</style>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 15px;
  -webkit-font-smoothing: antialiased;
}
.app * {
  box-sizing: border-box;
}
.app button {
  font: inherit;
  cursor: pointer;
}
.app :focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 1px;
}

/* ---------- top bar ---------- */
.topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
  flex-wrap: wrap;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo .g {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  flex: none;
  display: grid;
  place-items: center;
  font-size: 18px;
}
.logo .nm {
  font-family: var(--sans);
  font-weight: 600;
  font-size: 14px;
  letter-spacing: -0.01em;
}
.logo .nm .o {
  color: var(--orange);
}
.header-sep {
  width: 1px;
  height: 24px;
  background: var(--line-2);
  flex: none;
}
.grow {
  flex: 1 1 auto;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 8px 13px;
  border-radius: 8px;
  background: var(--card);
  border: 1px solid var(--line-2);
  color: var(--muted);
  transition:
    filter 0.15s,
    color 0.15s,
    background 0.15s,
    border-color 0.15s;
}
.btn svg {
  width: 13px;
  height: 13px;
}
.btn:hover {
  color: var(--ink);
  border-color: var(--dim);
}
.btn.start {
  background: var(--teal);
  color: #001b15;
  border-color: transparent;
}
.btn.start:hover {
  filter: brightness(1.08);
  color: #001b15;
}
.btn.get {
  border-color: var(--line-2);
}
.btn.get:hover:not(:disabled) {
  border-color: var(--teal-dim);
}
.qcount {
  margin-left: 2px;
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--teal);
  color: #06110e;
  font-size: 9.5px;
  font-weight: 700;
}
.btn.approve {
  border-color: var(--teal-dim);
  color: var(--teal);
}
.btn.approve:hover:not(:disabled) {
  background: rgba(0, 212, 170, 0.12);
}
/* EXPORT ALL is an anchor, not a button: it must still sit on the same line. */
a.btn {
  text-decoration: none;
}
.btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
.btn:disabled:hover {
  color: var(--muted);
  border-color: var(--line-2);
  filter: none;
}

/* ---------- status strip ---------- */
.status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 16px;
  border-bottom: 1px solid var(--line-2);
  background: var(--panel);
  font-family: var(--mono);
  font-size: 11px;
  color: var(--dim);
  letter-spacing: 0.04em;
  flex-wrap: wrap;
}
.status .st {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
}
.status .st .d {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dim);
  box-shadow: none;
}
.status .st .d.done {
  background: var(--teal);
  box-shadow: 0 0 0 3px rgba(0, 212, 170, 0.16);
}
.status .right {
  margin-left: auto;
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
}
.status .right b {
  color: var(--muted);
  font-weight: 600;
}
.pager {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}
.pagebtn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--line-2);
  border-radius: 6px;
  background: var(--bg);
  color: var(--muted);
}
.pagebtn svg {
  width: 15px;
  height: 15px;
}
.pagebtn:hover:not(:disabled) {
  border-color: var(--teal-dim);
  color: var(--ink);
}
.pagebtn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.pagenums {
  display: flex;
  gap: 3px;
}
.pagenum {
  min-width: 26px;
  height: 26px;
  padding: 0 7px;
  border: 1px solid var(--line-2);
  border-radius: 6px;
  background: var(--bg);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
}
.pagenum:hover {
  border-color: var(--teal-dim);
  color: var(--ink);
}
.pagenum.on {
  border-color: var(--teal);
  background: rgba(0, 212, 170, 0.12);
  color: var(--ink);
  font-weight: 600;
}
/* A form page the document does not reach: still editable, just unpaired. */
.pagenum.missing:not(.on) {
  color: var(--dim);
  border-style: dashed;
}
.pagerhint {
  margin-right: auto;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--dim);
}

/* ---------- workspace ---------- */
/*
 * The workspace fills what the console leaves it and no more.
 *
 * Every box from here down to the two viewers is shrinkable — a grid or flex
 * item's automatic minimum is its content, and any pixel floor along the chain
 * puts a panel back over its container's height, at which point the column grows
 * to fit a zoomed scan instead of scrolling it. So there is no floor anywhere:
 * on a short window the panels get short, and each still scrolls its own
 * content, which is the behaviour wanted at every size.
 */
.work {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 0;
}
@media (max-width: 820px) {
  .work {
    grid-template-columns: 1fr;
  }
}
.col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  /*
   * Both minimums are needed, and for the same reason: a grid item's automatic
   * minimum size is its content, so without these the column refuses to be
   * shorter or narrower than what is inside it. The panel would then grow to fit
   * a zoomed scan instead of scrolling it, and `overflow: auto` on the viewer
   * would never have anything to do vertically.
   */
  min-height: 0;
  padding: 14px;
  gap: 12px;
}
.col.left {
  border-right: 1px solid var(--line);
}
@media (max-width: 820px) {
  .col.left {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
}

.colhead {
  display: flex;
  align-items: center;
  gap: 10px;
}
.colhead .t {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--muted);
}
.badge {
  font-family: var(--mono);
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.05em;
  padding: 2px 7px;
  border-radius: 3px;
}
.badge.empty {
  color: var(--orange);
  background: var(--orange-fill);
  border: 1px solid var(--orange);
}
.badge.loaded {
  color: var(--teal);
  background: rgba(0, 212, 170, 0.08);
  border: 1px solid rgba(0, 212, 170, 0.5);
}
.badge.waiting {
  color: var(--dim);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line-2);
}
.badge.done {
  color: var(--teal);
  background: rgba(0, 212, 170, 0.08);
  border: 1px solid rgba(0, 212, 170, 0.5);
}
.colhead .icons {
  margin-left: auto;
  display: flex;
  gap: 8px;
  color: var(--dim);
}
.colhead .icons button {
  background: transparent;
  border: 0;
  color: inherit;
  padding: 3px;
  border-radius: 5px;
  display: grid;
  place-items: center;
}
.colhead .icons button:hover {
  color: var(--muted);
}
.colhead .icons svg {
  width: 15px;
  height: 15px;
}

/* Left panel between documents. Nothing here is interactive: documents arrive
   through the queue, so GET PDF is the only way to fill this panel. */
.idle {
  position: relative;
  flex: 1;
  min-height: 420px;
  border: 1.5px dashed var(--line-2);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
  padding: 0 24px;
  background: var(--panel);
}
.idle .big {
  font-size: 40px;
  color: var(--dim);
  line-height: 1;
  margin-bottom: 8px;
}
.idle .h {
  font-size: 15px;
  color: var(--muted);
  font-weight: 500;
}
.idle .s {
  font-size: 11px;
  color: var(--dim);
  max-width: 30ch;
  line-height: 1.5;
}

/* ---------- viewer (both sides) ---------- */
.viewer {
  flex: 1;
  /*
   * No pixel floor here. A minimum height on the panel is a minimum the panel
   * refuses to shrink below, which on a short window puts it back over its
   * container's height — and then the column grows to fit instead of the panel
   * scrolling, which is exactly the bug this chain exists to avoid. The floor
   * belongs on the workspace below, where overflowing means the page scrolls.
   */
  min-height: 0;
  height: 0;
  border: 1px solid var(--line-2);
  border-radius: 12px;
  overflow: auto;
  display: none;
  flex-direction: column;
}
.viewer.show {
  display: flex;
}
.viewer.scan {
  position: relative;
  background: #525659;
  padding: 0;
}
/*
 * The scan panel scrolls as a plain block rather than a flex column.
 *
 * As a flex item the page was sized by flex rules on the main axis, so a zoomed
 * image overflowed sideways (the stretched cross axis) but not downwards. In
 * normal flow the image is simply content: both axes overflow the same way, and
 * the panel scrolls in both.
 *
 * Needs `.show` on the selector — `.viewer` is `display: none` until then, and
 * this must not override that.
 */
.viewer.scan.show {
  display: block;
  /* The drag is ours; stop the browser treating it as a scroll gesture. */
  touch-action: none;
}
/* The page banner on a left panel with no image to overlay: the form beside it
   always names a page, so this side names one too. */
.cornermarker,
.pendingmarker {
  position: absolute;
  top: 10px;
  left: 14px;
  right: 14px;
  margin: 0;
  pointer-events: none;
}
.pendingmarker {
  color: var(--paper-dim);
}
.pendingmarker::before,
.pendingmarker::after {
  background: var(--paper-line);
}
.scan-pending {
  margin: 0 auto;
  padding: 24px;
  text-align: center;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #cfd4dc;
}

/* One page of the scan. It is a block in the flow, not a filled panel, so its
   height tracks the page image and page n can be lined up with form page n. */
/*
 * One page of the scan.
 *
 * Left at the panel's own width on purpose: the image's zoom is a percentage of
 * this box, so sizing it to its contents instead would make that percentage
 * circular. A zoomed image simply overflows it, and the panel scrolls.
 */
.scanpage {
  position: relative;
  background: #1a1a1a;
}
/* Zoomed in there is more page than panel, so the gesture becomes drag-to-move. */
.scanpage.pannable {
  cursor: grab;
}
.scanpage.panning {
  cursor: grabbing;
}
.scanmarker {
  position: absolute;
  top: 6px;
  left: 8px;
  right: 8px;
  z-index: 2;
  margin: 0;
  color: rgba(255, 255, 255, 0.75);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}
.scan-image {
  /* width is set inline from the zoom; overflow is what the panel scrolls */
  height: auto;
  min-width: 100%;
  display: block;
  user-select: none;
}
.viewer.ocr {
  background: var(--panel);
  padding: 0;
}
/* Dragging the form's margins moves the page; the cells keep their text cursor. */
.viewer.ocr.panning,
.viewer.ocr.panning * {
  cursor: grabbing;
}

.ocr-body {
  padding: 14px 16px 20px;
}

/* page marker */
.marker {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0 12px;
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.16em;
  color: var(--dim);
}
.marker::before,
.marker::after {
  content: '';
  height: 1px;
  flex: 1;
  background: var(--line-2);
}
.scan .marker {
  color: var(--paper-dim);
}
.scan .marker::before,
.scan .marker::after {
  background: var(--paper-line);
}

/* ocr page block */
.ocr .pageblock {
  margin-bottom: 8px;
}
.ocr .doctitle {
  font-family: var(--sans);
  font-weight: 700;
  font-size: 14px;
  color: var(--ink);
  margin-bottom: 2px;
}
.ocr .docsub {
  font-size: 11px;
  color: var(--muted);
  font-family: var(--mono);
  margin-bottom: 6px;
}
.ocr .blank {
  color: var(--dim);
  font-family: var(--mono);
  font-size: 11px;
  padding: 24px 4px;
  font-style: italic;
}

/* the master form
   It arrives as server-rendered HTML through v-html, so it carries no scope
   attribute: every rule below has to reach into it with :deep(). */
.docbody :deep(.ftab) {
  width: 100%;
  border-collapse: collapse;
  font-size: 10.5px;
  margin: 8px 0;
  table-layout: fixed;
}
.docbody :deep(.ftab td) {
  border: 1px solid var(--line-2);
  padding: 4px 6px;
  vertical-align: top;
  word-break: break-word;
}
.docbody :deep(.ftab td.num) {
  width: 22px;
  text-align: center;
  color: var(--dim);
  font-family: var(--mono);
  font-size: 9.5px;
}
.docbody :deep(.ftab td.lbl) {
  font-weight: 500;
}
.docbody :deep(.ftab td.hdr) {
  font-weight: 700;
  background: var(--card);
  font-size: 10px;
}

/* slots: the cells the extraction fills and the user corrects */
.docbody :deep(.ftab td.data),
.docbody :deep(.ftab td.select) {
  background: rgba(0, 212, 170, 0.04);
}
.docbody :deep(.ftab td.select) {
  padding: 2px 4px;
}
/* a slot whose value contradicts its person's marital status; see validateMarriage() */
.docbody :deep(.ftab td.invalid),
.docbody :deep(.ftab td.invalid:hover),
.docbody :deep(.ftab td.invalid:focus) {
  background: rgba(239, 68, 68, 0.16);
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.6);
}
.docbody :deep(.cellselect) {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-family: var(--mono);
  font-size: 9.5px;
  padding: 3px 4px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.12s;
}
.docbody :deep(.cellselect:hover) {
  background: rgba(0, 212, 170, 0.09);
}
.docbody :deep(.cellselect:focus) {
  outline: 1.5px solid var(--teal);
  outline-offset: -1px;
  background: rgba(0, 212, 170, 0.12);
  color: var(--ink);
}
.docbody :deep(.cellselect option) {
  background: var(--panel);
  color: var(--ink);
}
/* a slot nothing was read for still needs a visible target to click */
.docbody :deep(.ftab td.data:empty)::after,
.docbody :deep(.notedata:empty)::after {
  content: '·';
  color: var(--dim);
}



/* extra-notes block */
.docbody :deep(.notes) {
  margin-top: 14px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--muted);
}
.docbody :deep(.notes .nt) {
  font-weight: 700;
  color: var(--ink);
}
.docbody :deep(.notes .grid) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 24px;
  margin-top: 6px;
  font-family: var(--mono);
  font-size: 10px;
}
.docbody :deep(.notes .notedata) {
  display: inline-block;
  min-width: 96px;
  margin-left: 6px;
  border-bottom: 1px solid var(--line-2);
}

/* output empty-state */
.output-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.empty-state {
  flex: 1;
  min-height: 420px;
  border: 1px solid var(--line-2);
  border-radius: 12px;
  background: var(--panel);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
}
.empty-state.hide {
  display: none;
}
.empty-state .big {
  font-size: 36px;
  color: var(--dim);
  margin-bottom: 8px;
}
.empty-state .h {
  color: var(--muted);
  font-size: 13.5px;
}
.empty-state .s {
  color: var(--dim);
  font-size: 12px;
}

/* toast */
.toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translate(-50%, 12px);
  background: var(--card);
  border: 1px solid var(--line-2);
  color: var(--ink);
  padding: 9px 15px;
  border-radius: 9px;
  font-family: var(--mono);
  font-size: 12px;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.18s,
    transform 0.18s;
  z-index: 20;
}
.toast.show {
  opacity: 1;
  transform: translate(-50%, 0);
}
/* the editable form body */
.docbody {
  padding: 2px 0 6px;
  font-family: var(--sans);
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--ink);
}

/* editable regions: table cells and text blocks alike */
.doctitle[contenteditable],
.docsub[contenteditable],
.docbody :deep([contenteditable='true']) {
  outline: none;
  border-radius: 3px;
  transition: background 0.12s, box-shadow 0.12s;
  cursor: text;
}
.doctitle[contenteditable]:hover,
.docsub[contenteditable]:hover,
.docbody :deep([contenteditable='true']:hover) {
  background: rgba(0, 212, 170, 0.07);
}
.doctitle[contenteditable]:focus,
.docsub[contenteditable]:focus,
.docbody :deep([contenteditable='true']:focus) {
  background: rgba(0, 212, 170, 0.1);
  box-shadow: inset 0 0 0 1px var(--teal-dim);
}

/* page heading lines */
.ocr .doctitle[contenteditable],
.ocr .docsub[contenteditable] {
  padding: 1px 3px;
}
</style>
