<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

interface Cell {
  t?: string
  k?: string
  cs?: number
  options?: string[]
  value?: string
}

interface PageDef {
  marker: string
  title?: string
  sub?: string
  table?: Cell[][]
  notes?: { title: string; sub: string; items: { label: string; value: string }[] }
  blank?: boolean
}

/* ---------- form data (Shree Arihant Mitra Mandal registration form) ---------- */
const H = (t: string, cs?: number): Cell => ({ t, k: 'hdr', cs })
const N = (t: string): Cell => ({ t, k: 'num' })
const L = (t: string): Cell => ({ t, k: 'lbl' })
const D = (t = ''): Cell => ({ t, k: 'data' })
const SEL = (options: string[]): Cell => ({ k: 'select', options, value: '' })
const E = (): Cell => ({ t: '', k: '' })
const fiveD = (): Cell[] => [D(), D(), D(), D(), D()]
const fiveSel = (options: string[]): Cell[] => [SEL(options), SEL(options), SEL(options), SEL(options), SEL(options)]
const personHead = (): Cell[] => [
  E(),
  E(),
  H('Head of the Family'),
  H('Person - 2'),
  H('Person - 3'),
  H('Person - 4'),
  H('Person - 5'),
]

const PAGE1: Cell[][] = [
  [H('Details', 2), H('First Name'), H('Middle Name'), H('Last Name'), H('FORM NO :'), D()],
  [N('1'), L('Grand Father of Head of the Family:'), D(), D(), D(), L('Village:'), D()],
  [N('2'), L('Father of Head of the Family :'), D(), D(), D(), L('Total Members in Family:'), D()],
  personHead(),
  [N('3'), L('Name:'), ...fiveD()],
  [N('4'), L('Father / Husband Name:'), ...fiveD()],
  [N('5'), L('Surname:'), ...fiveD()],
  [N('6'), L("Relation with 'Head':"), ...fiveD()],
  [N('7'), L('Gender:'), ...fiveSel(['Male', 'Female'])],
  [N('8'), L('Member of Arihant Mandal'), ...fiveSel(['Yes', 'No'])],
  [N('9'), L('Date of Birth (DD/MM/YYYY):'), ...fiveD()],
  [N('10'), L('Level of Education:'), ...fiveSel(['Under Graduate', 'Graduate', 'Post Graduate', 'Doctorate'])],
  [N('11'), L('Field of Education:'), ...fiveD()],
  [N('12'), L('Other Educational Qualification:'), ...fiveD()],
  [N('13'), L('Type of Occupation:'), ...fiveSel(['Business', 'Job', 'House Wife', 'Student', 'Other'])],
  [N('14'), L('Field of Occupation:'), ...fiveD()],
  [N('15'), L('Company Name :'), ...fiveD()],
  [N('16'), L('Blood Group:'), ...fiveD()],
  [N('17'), L('Marital Status :'), ...fiveSel(['Married', 'Unmarried'])],
  [N('18'), L('Date of Marriage:'), ...fiveD()],
  [N('19'), L('Name of Father :'), ...fiveD()],
  [N('20'), L('Name of Mother :'), ...fiveD()],
]

const PAGE2: Cell[][] = [
  personHead(),
  [N('21'), L('Native Village of Father:'), ...fiveD()],
  [N('22'), L('Home Address:'), ...fiveD()],
  [E(), L('Land-mark :'), ...fiveD()],
  [E(), L('Area'), ...fiveD()],
  [E(), L('City:'), ...fiveD()],
  [E(), L('State'), ...fiveD()],
  [E(), L('Country:'), ...fiveD()],
  [E(), L('Pin Code:'), ...fiveD()],
  [N('23'), L('Office Address:'), ...fiveD()],
  [E(), L('Area:'), ...fiveD()],
  [E(), L('City:'), ...fiveD()],
  [E(), L('State:'), ...fiveD()],
  [E(), L('Country:'), ...fiveD()],
  [E(), L('Pin Code:'), ...fiveD()],
  [N('24'), L('Residence Phone No:'), ...fiveD()],
  [N('25'), L('Office Phone No:'), ...fiveD()],
  [N('26'), L('Mobile No1:'), ...fiveD()],
  [N('27'), L('Mobile No2:'), ...fiveD()],
  [N('28'), L('Email Address:'), ...fiveD()],
  [N('29'), L('Website Address:'), ...fiveD()],
  [N('30'), L('Other Achievements:'), ...fiveD()],
]

const NOTES = {
  title: 'Extra Notes:-',
  sub: 'If there is any DIKSHA in family please provide details below and at back of the form.',
  items: [
    { label: '1) Sansaari naam:', value: '' },
    { label: '5) Guru Naam:', value: '' },
    { label: '2) Gaam:', value: '' },
    { label: '6) Samuday:', value: '' },
    { label: '3) Diksharthi naam:', value: '' },
    { label: '4) Diksha taarikh ane tithi:', value: '' },
  ],
}

const PAGES: PageDef[] = [
  {
    marker: 'PAGE 1 / 3',
    title: 'Shree Arihant Mitra Mandal — Registration Form',
    sub: '(Please fill this form in English)',
    table: PAGE1,
  },
  { marker: 'PAGE 2 / 3', sub: 'FORM NO: (Page 2)', table: PAGE2, notes: NOTES },
  { marker: 'PAGE 3 / 3', blank: true },
]

function serialize(): string {
  const out: string[] = []
  PAGES.forEach((p) => {
    out.push(`── ${p.marker} ──`)
    if (p.blank) {
      out.push('(no text detected)')
      return
    }
    if (p.title) out.push(p.title)
    if (p.sub) out.push(p.sub)
    if (p.table) p.table.forEach((r) => out.push(r.map((c) => c.t || '').filter(Boolean).join('  |  ')))
    if (p.notes) out.push(p.notes.title, p.notes.sub, ...p.notes.items.map((it) => `${it.label} ${it.value}`.trim()))
  })
  return out.join('\n')
}

const fullText = serialize()

/* ---------- reactive app state ---------- */
const mode = ref<'LONG' | 'BASE'>('LONG')
const ngramOn = ref(true)
const loaded = ref(false)
const running = ref(false)
const statusClass = ref('')
const statusText = ref('READY · model loaded')
const pageCount = ref(0)
const charCount = ref(0)
const inputBadgeClass = ref('badge empty')
const inputBadgeText = ref('EMPTY')
const outBadgeClass = ref('badge waiting')
const outBadgeText = ref('WAITING')
const progressWidth = ref('0%')
const revealCount = ref(0)
const hintShow = ref(false)
const toastText = ref('Copied to clipboard')
const toastShow = ref(false)

const scanRef = ref<HTMLElement | null>(null)
const ocrRef = ref<HTMLElement | null>(null)
const ocrBodyRef = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const docUrl = ref<string | null>(null)
const docKind = ref<'pdf' | 'image' | null>(null)
const fileName = ref('')
const dragActive = ref(false)

/* ---------- cursor-linked field editing ---------- */
const pdfOverlayRef = ref<HTMLElement | null>(null)
const pdfLineTop = ref(0)
const pdfPointerActive = ref(false)
const pdfEscaped = ref(false)
const pdfLineShow = computed(() => pdfPointerActive.value && !pdfEscaped.value)
const imgWrapRef = ref<HTMLElement | null>(null)
const imgPointer = ref<{ xPct: number; yPct: number } | null>(null)
const imgEscaped = ref(false)

/* mirrored pointer: right-panel hover/edit position, reflected onto the left panel */
const rightPointerPct = ref<{ xPct: number; yPct: number } | null>(null)
const rightPointerLocked = ref(false)

let timer: ReturnType<typeof setInterval> | null = null
let rowFlashTimer: ReturnType<typeof setTimeout> | null = null

const revealedPages = computed(() => PAGES.slice(0, revealCount.value))
const scanShow = computed(() => loaded.value)
const ocrShow = computed(() => revealCount.value > 0)

function setMode(m: 'LONG' | 'BASE') {
  mode.value = m
}

function toggleNgram() {
  ngramOn.value = !ngramOn.value
}

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

function triggerFilePicker() {
  fileInputRef.value?.click()
}

function handleFile(file: File) {
  const name = file.name.toLowerCase()
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf')
  const isImage = file.type.startsWith('image/') || /\.(jpe?g|png)$/.test(name)
  if (!isPdf && !isImage) {
    showToast('Please upload a PDF, JPG, or PNG file')
    return
  }
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (docUrl.value) URL.revokeObjectURL(docUrl.value)
  docUrl.value = URL.createObjectURL(file)
  docKind.value = isPdf ? 'pdf' : 'image'
  fileName.value = file.name
  imgPointer.value = null
  imgEscaped.value = false
  pdfPointerActive.value = false
  pdfEscaped.value = false

  loaded.value = true
  running.value = false
  inputBadgeClass.value = 'badge loaded'
  inputBadgeText.value = 'LOADED'
  pageCount.value = PAGES.length

  // OCR output is mocked (no live backend) — reveal it immediately, fully.
  revealCount.value = PAGES.length
  progressWidth.value = '100%'
  outBadgeClass.value = 'badge done'
  outBadgeText.value = 'DONE'
  hintShow.value = true
  charCount.value = fullText.replace(/\s/g, '').length
  setStatus('done', `COMPLETE · ${fileName.value} · 3 pages · 52 fields · 96.8% mean · 2.31s`)
}

function onFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) handleFile(file)
  input.value = ''
}

function onDragEnter(e: DragEvent) {
  e.preventDefault()
  dragActive.value = true
}

function onDragLeave(e: DragEvent) {
  e.preventDefault()
  dragActive.value = false
}

function onFileDrop(e: DragEvent) {
  e.preventDefault()
  dragActive.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) handleFile(file)
}

function startOcr() {
  if (!loaded.value) {
    showToast('Upload a document first')
    return
  }
  if (running.value) return
  running.value = true
  revealCount.value = 0
  hintShow.value = false
  outBadgeClass.value = 'badge busy'
  outBadgeText.value = 'RUNNING'
  progressWidth.value = '0%'

  const step = () => {
    if (revealCount.value >= PAGES.length) {
      if (timer) clearInterval(timer)
      running.value = false
      outBadgeClass.value = 'badge done'
      outBadgeText.value = 'DONE'
      hintShow.value = true
      charCount.value = fullText.replace(/\s/g, '').length
      setStatus('done', 'COMPLETE · 3 pages · 52 fields · 96.8% mean · 2.31s')
      return
    }
    setStatus('busy', `RECOGNIZING · page ${revealCount.value + 1}/3`)
    revealCount.value++
    progressWidth.value = `${(revealCount.value / PAGES.length) * 100}%`
    nextTick(() => {
      if (ocrRef.value) ocrRef.value.scrollTop = ocrRef.value.scrollHeight
    })
  }
  step()
  timer = setInterval(step, 700)
}

function stopOcr() {
  if (!running.value) return
  if (timer) clearInterval(timer)
  running.value = false
  outBadgeClass.value = 'badge waiting'
  outBadgeText.value = 'STOPPED'
  setStatus('', 'STOPPED by user')
}

function resetAll() {
  if (timer) clearInterval(timer)
  running.value = false
  loaded.value = false
  revealCount.value = 0
  hintShow.value = false
  inputBadgeClass.value = 'badge empty'
  inputBadgeText.value = 'EMPTY'
  outBadgeClass.value = 'badge waiting'
  outBadgeText.value = 'WAITING'
  progressWidth.value = '0%'
  pageCount.value = 0
  charCount.value = 0
  if (docUrl.value) {
    URL.revokeObjectURL(docUrl.value)
    docUrl.value = null
  }
  docKind.value = null
  fileName.value = ''
  pdfPointerActive.value = false
  pdfEscaped.value = false
  imgPointer.value = null
  imgEscaped.value = false
  setStatus('', 'READY · model loaded')
}

function domToText(): string {
  if (!ocrBodyRef.value) return fullText
  const out: string[] = []
  ocrBodyRef.value.querySelectorAll('.pageblock').forEach((pb) => {
    const mk = pb.querySelector('.marker')
    if (mk) out.push(`── ${mk.textContent} ──`)
    const ti = pb.querySelector('.doctitle')
    if (ti) out.push(ti.textContent || '')
    const sb = pb.querySelector('.docsub')
    if (sb) out.push(sb.textContent || '')
    const bl = pb.querySelector('.blank')
    if (bl) out.push(bl.textContent || '')
    pb.querySelectorAll('table tr').forEach((tr) => {
      const cells = rowToCells(tr)
      if (cells.length) out.push(cells.join('  |  '))
    })
    const nt = pb.querySelector('.notes')
    if (nt) out.push((nt as HTMLElement).innerText)
  })
  return out.join('\n')
}

function rowToCells(tr: Element): string[] {
  return [...tr.children]
    .map((td) => {
      const sel = td.querySelector('select')
      if (sel) return (sel as HTMLSelectElement).value
      return (td.textContent || '').trim()
    })
    .filter(Boolean)
}

async function copyOutput() {
  let txt = fullText
  const showingOcr = ocrShow.value
  if (showingOcr) txt = domToText()
  try {
    await navigator.clipboard.writeText(txt)
  } catch {
    // clipboard unavailable — ignore
  }
  showToast(showingOcr ? 'Copied OCR text (with edits)' : 'Load a document and run OCR first')
}

function scrollOcrTop() {
  ocrRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function scrollOcrBottom() {
  if (!ocrRef.value) return
  ocrRef.value.scrollTo({ top: ocrRef.value.scrollHeight, behavior: 'smooth' })
}

function fitScan() {
  scanRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

/* ---------- cursor-linked field editing ---------- */
function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function jumpToMatchingField(proportion: number) {
  if (!ocrShow.value || !ocrBodyRef.value || !ocrRef.value) return
  const rows = Array.from(ocrBodyRef.value.querySelectorAll('table.ftab tr')) as HTMLElement[]
  if (!rows.length) return
  const idx = Math.min(rows.length - 1, Math.max(0, Math.floor(proportion * rows.length)))
  const row = rows[idx]
  if (!row) return
  row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  row.classList.add('row-flash')
  if (rowFlashTimer) clearTimeout(rowFlashTimer)
  rowFlashTimer = setTimeout(() => row.classList.remove('row-flash'), 1200)
  const target = row.querySelector('[contenteditable="true"], select') as HTMLElement | null
  if (target) {
    setTimeout(() => {
      target.focus()
      if (target.getAttribute('contenteditable') === 'true') placeCaretAtEnd(target)
    }, 300)
  }
}

/* image uploads: real DOM element, pixel-accurate mouse tracking */
function onImagePointerMove(e: MouseEvent) {
  const el = imgWrapRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const xPct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100))
  const yPct = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100))
  imgPointer.value = { xPct, yPct }
}

function onImagePointerLeave() {
  imgPointer.value = null
}

function onImageClick(e: MouseEvent) {
  const el = imgWrapRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const proportion = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
  jumpToMatchingField(proportion)
}

/* right panel (OCR table) hover/edit position, mirrored as a pointer on the
   left panel. Hovering tracks the mouse live; focusing an editable field
   locks the pointer to that field's position until focus moves elsewhere. */
function onOcrPointerMove(e: MouseEvent) {
  if (rightPointerLocked.value) return
  const el = ocrRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const xPct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100))
  const yPct = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100))
  rightPointerPct.value = { xPct, yPct }
}

function onOcrPointerLeave() {
  if (rightPointerLocked.value) return
  rightPointerPct.value = null
}

function onOcrFocusIn(e: FocusEvent) {
  const el = ocrRef.value
  const target = e.target as HTMLElement | null
  if (!el || !target || typeof target.matches !== 'function') return
  if (!target.matches('[contenteditable="true"], select')) return
  const panelRect = el.getBoundingClientRect()
  const fieldRect = target.getBoundingClientRect()
  const xPct = Math.min(100, Math.max(0, ((fieldRect.left + fieldRect.width / 2 - panelRect.left) / panelRect.width) * 100))
  const yPct = Math.min(100, Math.max(0, ((fieldRect.top + fieldRect.height / 2 - panelRect.top) / panelRect.height) * 100))
  rightPointerPct.value = { xPct, yPct }
  rightPointerLocked.value = true
}

function onOcrFocusOut() {
  rightPointerLocked.value = false
}

/* PDF uploads: native iframe viewer swallows events, so a transparent overlay
   is used just to show a tracking line (no reliable click-to-field mapping).
   Pressing Escape while the cursor is away from the reader dismisses the line
   for good (until a new document is loaded) — hovering it again will not
   bring it back. */
function onPdfOverlayEnter() {
  pdfPointerActive.value = true
}

function onPdfOverlayMove(e: MouseEvent) {
  const el = pdfOverlayRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  pdfLineTop.value = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100))
  pdfPointerActive.value = true
}

function onPdfOverlayLeave() {
  pdfPointerActive.value = false
}

function onWindowKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (!pdfPointerActive.value) pdfEscaped.value = true
  if (!imgPointer.value) imgEscaped.value = true
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  if (rowFlashTimer) clearTimeout(rowFlashTimer)
  if (docUrl.value) URL.revokeObjectURL(docUrl.value)
  window.removeEventListener('keydown', onWindowKeydown)
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
      <div class="header-sep" />
      <div class="seg" role="tablist" aria-label="Mode">
        <button :class="{ on: mode === 'LONG' }" role="tab" :aria-selected="mode === 'LONG'" @click="setMode('LONG')">
          Long
        </button>
        <button :class="{ on: mode === 'BASE' }" role="tab" :aria-selected="mode === 'BASE'" @click="setMode('BASE')">
          Base
        </button>
      </div>
      <div class="header-sep" />
      <div class="ngram">
        <span class="lab">NGRAM</span>
        <button class="sw" :aria-pressed="ngramOn" aria-label="Toggle n-gram" @click="toggleNgram" />
      </div>

      <div class="grow" />

      <div class="actions">
        <button class="btn" @click="resetAll">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 4v6h6" />
            <path d="M20 20v-6h-6" />
            <path d="M20 9a8 8 0 0 0-14-3L4 8M4 15a8 8 0 0 0 14 3l2-2" />
          </svg>
          RESET
        </button>
        <button class="btn" @click="copyOutput">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h8" />
          </svg>
          COPY
        </button>
        <button class="btn stop" @click="stopOcr">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
          STOP
        </button>
      </div>
    </div>

    <!-- STATUS -->
    <div class="status">
      <span class="st"><span class="d" :class="statusClass" /><span>{{ statusText }}</span></span>
      <div class="right">
        <span>MODEL <b>baidu/Unlimited-OCR</b></span>
        <span>MODE <b>{{ mode }}</b></span>
        <span>PAGES <b>{{ pageCount }}</b></span>
        <span><b>{{ charCount }}</b> chars</span>
      </div>
    </div>
    <div class="progress"><i :style="{ width: progressWidth }" /></div>

    <!-- WORKSPACE -->
    <div class="work">
      <!-- LEFT / ORIGINAL DOCUMENT -->
      <div class="col left">
        <div class="colhead">
          <span class="t">INPUT · ORIGINAL</span>
          <span class="badge" :class="inputBadgeClass.replace('badge ', '')">{{ inputBadgeText }}</span>
          <div class="icons">
            <button title="Upload" @click="triggerFilePicker">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 15V4M12 4l-4 4M12 4l4 4" />
                <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
              </svg>
            </button>
            <button title="Fit to width" @click="fitScan">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
                <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
              </svg>
            </button>
          </div>
        </div>

        <input
          ref="fileInputRef"
          type="file"
          accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png"
          class="file-input-hidden"
          @change="onFileInputChange"
        >

        <div
          v-if="!loaded"
          class="drop"
          :class="{ dragover: dragActive }"
          @click="triggerFilePicker"
          @dragenter="onDragEnter"
          @dragover.prevent
          @dragleave="onDragLeave"
          @drop="onFileDrop"
        >
          <div class="big">📄</div>
          <div class="h">Drop your document here</div>
          <div class="s">or click anywhere to browse</div>
          <div class="fmts">
            <span class="fmt">PDF</span><span class="fmt">JPG</span><span class="fmt">PNG</span>
          </div>
        </div>

        <div ref="scanRef" class="viewer scan" :class="{ show: scanShow }" aria-label="Original uploaded document">
          <template v-if="docKind === 'pdf' && docUrl">
            <iframe :src="docUrl" class="pdf-frame" title="Uploaded PDF preview" />
            <div
              ref="pdfOverlayRef"
              class="pdf-pointer-overlay"
              :class="{ escaped: pdfEscaped }"
              title="Move to track position · press Esc while outside to hide the line for good"
              @mouseenter="onPdfOverlayEnter"
              @mousemove="onPdfOverlayMove"
              @mouseleave="onPdfOverlayLeave"
            >
              <div v-if="pdfLineShow" class="pdf-pointer-line" :style="{ top: pdfLineTop + '%' }" />
            </div>
            <div v-if="rightPointerPct" class="edit-link-line" :style="{ top: rightPointerPct.yPct + '%' }" />
            <div
              v-if="rightPointerPct"
              class="edit-link-dot"
              :style="{ top: rightPointerPct.yPct + '%', left: rightPointerPct.xPct + '%' }"
            />
          </template>
          <div
            v-else-if="docKind === 'image' && docUrl"
            ref="imgWrapRef"
            class="scan-image-wrap"
            :class="{ escaped: imgEscaped }"
            title="Click a spot to jump to the matching field · press Esc while outside to hide the crosshair for good"
            @mousemove="onImagePointerMove"
            @mouseleave="onImagePointerLeave"
            @click="onImageClick"
          >
            <img :src="docUrl" class="scan-image" alt="Uploaded document page" draggable="false">
            <template v-if="imgPointer && !imgEscaped">
              <div class="scan-crosshair-h" :style="{ top: imgPointer.yPct + '%' }" />
              <div class="scan-crosshair-v" :style="{ left: imgPointer.xPct + '%' }" />
              <div class="scan-crosshair-dot" :style="{ top: imgPointer.yPct + '%', left: imgPointer.xPct + '%' }" />
            </template>
            <template v-if="rightPointerPct">
              <div class="edit-link-h" :style="{ top: rightPointerPct.yPct + '%' }" />
              <div class="edit-link-v" :style="{ left: rightPointerPct.xPct + '%' }" />
              <div
                class="edit-link-dot"
                :style="{ top: rightPointerPct.yPct + '%', left: rightPointerPct.xPct + '%' }"
              />
            </template>
          </div>
        </div>

        <div class="promptbar">
          <span class="lab">PROMPT</span>
          <input value="document parsing." aria-label="Prompt">
        </div>
      </div>

      <!-- RIGHT / OCR OUTPUT (annotatable) -->
      <div class="col">
        <div class="colhead">
          <span class="t">OCR OUTPUT · ANNOTATABLE</span>
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
            <div class="h">OCR output will appear here</div>
            <div class="s">Upload a document to see OCR output</div>
          </div>
          <div
            ref="ocrRef"
            class="viewer ocr"
            :class="{ show: ocrShow }"
            @mousemove="onOcrPointerMove"
            @mouseleave="onOcrPointerLeave"
            @focusin="onOcrFocusIn"
            @focusout="onOcrFocusOut"
          >
            <div class="hint" :class="{ show: hintShow }">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
              EDITABLE — click any field to correct the recognized text
            </div>
            <div ref="ocrBodyRef" class="ocr-body">
              <div v-for="(page, pi) in revealedPages" :key="pi" class="pageblock">
                <div class="marker">{{ page.marker }}</div>
                <template v-if="page.blank">
                  <div class="blank">(no text detected)</div>
                </template>
                <template v-else>
                  <div v-if="page.title" class="doctitle">{{ page.title }}</div>
                  <div v-if="page.sub" class="docsub">{{ page.sub }}</div>
                  <table v-if="page.table" class="ftab">
                    <colgroup>
                      <col style="width: 22px" /><col style="width: 30%" /><col /><col /><col /><col /><col />
                    </colgroup>
                    <tbody>
                      <tr v-for="(row, ri) in page.table" :key="ri">
                        <td
                          v-for="(cell, ci) in row"
                          :key="ci"
                          :class="cell.k"
                          :colspan="cell.cs || undefined"
                          :contenteditable="cell.k === 'data' || cell.k === 'opt'"
                          spellcheck="false"
                        >
                          <select v-if="cell.k === 'select'" v-model="cell.value" class="cellselect">
                            <option value="" disabled>Select…</option>
                            <option v-for="opt in cell.options" :key="opt" :value="opt">{{ opt }}</option>
                          </select>
                          <template v-else>{{ cell.t }}</template>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-if="page.notes" class="notes">
                    <div class="nt">{{ page.notes.title }}</div>
                    <div class="sb">{{ page.notes.sub }}</div>
                    <div class="grid">
                      <div v-for="(it, ii) in page.notes.items" :key="ii">
                        <span class="notelbl">{{ it.label }}</span>
                        <span class="notedata" contenteditable="true" spellcheck="false">{{ it.value }}</span>
                      </div>
                    </div>
                  </div>
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
.seg {
  display: inline-flex;
  gap: 2px;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: var(--bg);
  padding: 3px;
  font-family: var(--mono);
  font-size: 12px;
}
.seg button {
  background: transparent;
  color: var(--muted);
  border: 0;
  border-radius: 5px;
  padding: 5px 14px;
  letter-spacing: 0.02em;
}
.seg button.on {
  background: var(--card);
  color: var(--ink);
  font-weight: 500;
}
.ngram {
  display: inline-flex;
  align-items: center;
  gap: 9px;
}
.ngram .lab {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--dim);
}
.sw {
  width: 38px;
  height: 20px;
  border-radius: 999px;
  border: 0;
  padding: 0;
  background: var(--teal);
  position: relative;
  transition: background 0.18s;
}
.sw::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 20px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #06110e;
  transition: left 0.18s;
}
.sw[aria-pressed='false'] {
  background: var(--line-2);
}
.sw[aria-pressed='false']::after {
  left: 2px;
  background: var(--dim);
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
.btn.stop {
  background: var(--red);
  color: #fff;
  border-color: transparent;
}
.btn.stop:hover {
  filter: brightness(1.08);
  color: #fff;
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
.status .st .d.busy {
  background: var(--orange);
  box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.16);
  animation: pulse 1s infinite;
}
.status .st .d.done {
  background: var(--teal);
  box-shadow: 0 0 0 3px rgba(0, 212, 170, 0.16);
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
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
.progress {
  height: 2px;
  background: var(--bg);
}
.progress > i {
  display: block;
  height: 100%;
  width: 0;
  background: var(--teal);
  transition: width 0.35s ease;
}

/* ---------- workspace ---------- */
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
.badge.busy {
  color: var(--orange);
  background: var(--orange-fill);
  border: 1px solid var(--orange);
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

/* drop zone */
.drop {
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
  cursor: pointer;
  background: var(--panel);
  transition:
    border-color 0.15s,
    background 0.15s;
}
.drop:hover,
.drop.dragover {
  border-color: rgba(0, 212, 170, 0.4);
  background: #0d1015;
}
.file-input-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.drop .big {
  font-size: 40px;
  color: var(--dim);
  line-height: 1;
  margin-bottom: 8px;
}
.drop .h {
  font-size: 15px;
  color: var(--muted);
  font-weight: 500;
}
.drop .s {
  font-size: 11px;
  color: var(--dim);
}
.fmts {
  display: flex;
  gap: 7px;
  margin-top: 12px;
  flex-wrap: wrap;
  justify-content: center;
}
.fmt {
  font-family: var(--mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--dim);
  padding: 3px 8px;
  border: 1px solid var(--line-2);
  border-radius: 3px;
}

/* ---------- viewer (both sides) ---------- */
.viewer {
  flex: 1;
  min-height: 420px;
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
  background: #525659;
  padding: 0;
  position: relative;
}
.pdf-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

/* PDF pointer overlay (native iframe swallows mouse events, so this just
   shows a lightweight tracking line — no reliable click-to-field mapping) */
.pdf-pointer-overlay {
  position: absolute;
  inset: 0;
  cursor: crosshair;
  z-index: 2;
}
.pdf-pointer-overlay.escaped {
  cursor: default;
}
.pdf-pointer-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 2px dashed var(--teal);
  box-shadow: 0 0 8px rgba(0, 212, 170, 0.55);
  pointer-events: none;
}

/* image uploads: real DOM content, pixel-accurate pointer tracking + click-to-jump */
.scan-image-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  cursor: crosshair;
  background: #1a1a1a;
}
.scan-image-wrap.escaped {
  cursor: default;
}
.scan-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  user-select: none;
}
.scan-crosshair-h {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 1.5px dashed var(--teal);
  box-shadow: 0 0 6px rgba(0, 212, 170, 0.6);
  pointer-events: none;
}
.scan-crosshair-v {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1.5px dashed var(--teal);
  box-shadow: 0 0 6px rgba(0, 212, 170, 0.6);
  pointer-events: none;
}
.scan-crosshair-dot {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--teal);
  box-shadow: 0 0 8px rgba(0, 212, 170, 0.85);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/* mirrored pointer: reflects the right panel's hover/edit position onto the
   left panel, in the orange accent so it's distinct from the teal direct-hover
   indicators above */
.edit-link-line,
.edit-link-h {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 2px dashed var(--orange);
  box-shadow: 0 0 8px rgba(255, 107, 53, 0.55);
  pointer-events: none;
}
.edit-link-v {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1.5px dashed var(--orange);
  box-shadow: 0 0 6px rgba(255, 107, 53, 0.55);
  pointer-events: none;
}
.edit-link-dot {
  position: absolute;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--orange);
  box-shadow: 0 0 8px rgba(255, 107, 53, 0.85);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.viewer.ocr {
  background: var(--panel);
  padding: 0;
}

/* hint banner (right) */
.hint {
  display: none;
  align-items: center;
  gap: 8px;
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 8px 14px;
  background: rgba(0, 212, 170, 0.07);
  border-bottom: 1px solid var(--line-2);
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--teal);
  letter-spacing: 0.02em;
}
.viewer.ocr .hint.show {
  display: flex;
}
.hint svg {
  width: 12px;
  height: 12px;
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

/* paper page */
.page.paper {
  background: var(--paper-2);
  color: var(--paper-ink);
  border-radius: 4px;
  padding: 20px 18px;
  box-shadow:
    0 2px 3px rgba(0, 0, 0, 0.18),
    0 16px 34px -18px rgba(0, 0, 0, 0.5);
  font-family: var(--sans);
}
.page.paper .doctitle {
  text-align: center;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.01em;
}
.page.paper .docsub {
  text-align: center;
  font-size: 10.5px;
  color: var(--paper-dim);
  font-style: italic;
  margin-top: 2px;
}
.page.paper .blank {
  text-align: center;
  color: var(--paper-dim);
  font-family: var(--mono);
  font-size: 11px;
  padding: 60px 0;
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

/* tables (shared) */
.ftab {
  width: 100%;
  border-collapse: collapse;
  font-size: 10.5px;
  margin: 8px 0;
  table-layout: fixed;
}
.ftab td {
  border: 1px solid var(--line-2);
  padding: 4px 6px;
  vertical-align: top;
  word-break: break-word;
}
.scan .ftab td {
  border-color: var(--paper-line);
}
.ftab td.num {
  width: 22px;
  text-align: center;
  color: var(--dim);
  font-family: var(--mono);
  font-size: 9.5px;
}
.scan .ftab td.num {
  color: var(--paper-dim);
}
.ftab td.lbl {
  font-weight: 500;
}
.ftab td.hdr {
  font-weight: 700;
  background: var(--card);
  font-size: 10px;
}
.scan .ftab td.hdr {
  background: var(--paper);
}
.ftab td.opt {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--muted);
  letter-spacing: -0.01em;
}
.scan .ftab td.opt {
  color: var(--paper-dim);
}
.ocr .ftab td.data,
.ocr .ftab td.opt {
  background: rgba(0, 212, 170, 0.04);
}

/* select (dropdown) cells */
.ftab td.select {
  padding: 2px 4px;
}
.cellselect {
  width: 100%;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-family: var(--mono);
  font-size: 9.5px;
  padding: 3px 4px;
  border-radius: 4px;
  cursor: pointer;
}
.ocr .ftab td.select {
  background: rgba(0, 212, 170, 0.04);
}
.ocr .ftab .cellselect {
  color: var(--muted);
  transition: background 0.12s;
}
.ocr .ftab .cellselect:hover {
  background: rgba(0, 212, 170, 0.09);
}
.ocr .ftab .cellselect:focus {
  outline: 1.5px solid var(--teal);
  outline-offset: -1px;
  background: rgba(0, 212, 170, 0.12);
  color: var(--ink);
}
.ocr .ftab .cellselect option {
  background: var(--panel);
  color: var(--ink);
}

/* editable cells (annotatable) */
.ocr .ftab td[contenteditable] {
  cursor: text;
  min-height: 20px;
  transition: background 0.12s;
}
.ocr .ftab td[contenteditable]:hover {
  background: rgba(0, 212, 170, 0.09);
}
.ocr .ftab td[contenteditable]:focus {
  outline: 1.5px solid var(--teal);
  outline-offset: -1px;
  background: rgba(0, 212, 170, 0.12);
  color: var(--ink);
}
.ocr .ftab td.data:empty::after {
  content: '·';
  color: var(--dim);
}

/* row highlight when jumped-to from the scan pointer */
@keyframes rowFlash {
  0%,
  100% {
    box-shadow: none;
  }
  50% {
    box-shadow: inset 0 0 0 9999px rgba(0, 212, 170, 0.18);
  }
}
.ocr .ftab tr.row-flash td {
  animation: rowFlash 1.2s ease;
}

/* notes block */
.notes {
  margin-top: 14px;
  font-size: 11px;
  line-height: 1.7;
}
.notes .nt {
  font-weight: 700;
}
.notes .grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 24px;
  margin-top: 6px;
  font-family: var(--mono);
  font-size: 10px;
}
.scan .notes {
  color: var(--paper-ink);
}
.ocr .notes {
  color: var(--muted);
}
.ocr .notes .nt {
  color: var(--ink);
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

/* prompt bar */
.promptbar {
  display: flex;
  align-items: center;
  gap: 12px;
  border-radius: 8px;
  padding: 4px 14px;
  background: var(--card);
}
.promptbar .lab {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--dim);
  flex: none;
}
.promptbar input {
  flex: 1;
  background: transparent;
  border: 0;
  color: var(--ink);
  font-family: var(--mono);
  font-size: 11px;
  padding: 9px 0;
  outline: none;
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
@media (prefers-reduced-motion: reduce) {
  .status .st .d.busy {
    animation: none;
  }
  .progress > i {
    transition: none;
  }
}
</style>
