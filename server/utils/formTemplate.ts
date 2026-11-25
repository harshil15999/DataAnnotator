import { createError } from 'h3'

/**
 * The fixed master form: loading it, reading its slots, and filling them in.
 *
 * The document's structure is known ahead of time and lives in
 * `server/assets/templates/registration-form.html`. Nothing upstream describes
 * the layout; it only supplies values for the slots declared there, so a page
 * that was read poorly (or not at all) still comes back as the same complete,
 * editable form.
 */

/** Where the template lives inside the `assets:server` storage mount. */
const TEMPLATE_KEY = 'templates/registration-form.html'

/** Matches one `<section class="page" ...>...</section>` and its attributes. */
const PAGE_SECTION = /<section\b([^>]*)>([\s\S]*?)<\/section\s*>/gi

/** Matches an element carrying a `data-field` slot, with its attributes. */
const SLOT_ELEMENT = /<(td|span)\b([^>]*\bdata-field="[^"]*"[^>]*)>([\s\S]*?)<\/\1\s*>/gi

/** One fillable slot declared by the template. */
export interface FieldSpec {
  /** Slot key, e.g. `p2.surname`. Unique per template. */
  key: string
  /** Allowed values, when the slot is a dropdown. */
  options?: string[]
  /** Label to show in the summary card, when the slot is worth surfacing. */
  summary?: string
}

/** One template page, filled in and ready to render. */
export interface FormPage {
  /** Page banner, e.g. "PAGE 1 / 3". */
  marker: string
  title: string
  sub: string
  /** The page's filled-in body. Slots are individually editable. */
  html: string
  /** True for a page the template declares as intentionally empty. */
  blank: boolean
  /** Slots declared on this page, in document order. */
  fields: FieldSpec[]
}

/** Values read off a document, keyed by {@link FieldSpec.key}. */
export type FieldValues = Record<string, string>

let cached: string | null = null

/**
 * Reads the template out of server assets. Cached after the first read: the
 * file ships with the build and cannot change under a running server.
 */
async function loadFormTemplate(): Promise<string> {
  if (cached !== null) return cached

  const raw = await useStorage('assets:server').getItem<string>(TEMPLATE_KEY)
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw createError({
      statusCode: 500,
      statusMessage: `The form template ${TEMPLATE_KEY} is missing or empty.`,
    })
  }

  // Comments carry prose about `data-field`, which the slot regexes must not see.
  cached = raw.replace(/<!--[\s\S]*?-->/g, '')
  return cached
}

/**
 * Splits the template into its pages and reads the slots declared on each.
 * Passing values fills those slots in; omitting them yields the blank form.
 */
export async function buildFormPages(values: FieldValues = {}): Promise<FormPage[]> {
  const template = await loadFormTemplate()
  const pages: FormPage[] = []

  PAGE_SECTION.lastIndex = 0
  for (const match of template.matchAll(PAGE_SECTION)) {
    const attrs = match[1] ?? ''
    const body = match[2] ?? ''

    pages.push({
      marker: readAttr(attrs, 'data-marker') || `PAGE ${pages.length + 1}`,
      title: readAttr(attrs, 'data-title'),
      sub: readAttr(attrs, 'data-sub'),
      blank: readAttr(attrs, 'data-blank') === 'true',
      html: fillSlots(body, values),
      fields: readFieldSpecs(body),
    })
  }

  if (pages.length === 0) {
    throw createError({
      statusCode: 500,
      statusMessage: 'The form template declares no pages.',
    })
  }

  return pages
}

/**
 * Every distinct slot across a set of pages, in document order.
 *
 * A key the template repeats — the form number, which both filled pages carry —
 * is one slot, so counting filled fields does not credit it twice.
 */
export function distinctFields(pages: FormPage[]): FieldSpec[] {
  const seen = new Set<string>()
  return pages
    .flatMap(page => page.fields)
    .filter(field => !seen.has(field.key) && seen.add(field.key))
}

/** The blank form's summary row: the header slots, with no values yet. */
export function summaryOf(pages: FormPage[], values: FieldValues = {}): SummaryField[] {
  return distinctFields(pages)
    .filter(field => field.summary)
    .map(field => ({
      key: field.key,
      label: field.summary as string,
      value: values[field.key] ?? '',
    }))
}

/** One slot worth showing in the summary card above the form. */
export interface SummaryField {
  key: string
  label: string
  value: string
}

/**
 * Reads the slot declarations out of a fragment. A key repeated across pages
 * (the form number, which both pages carry) is declared once.
 */
function readFieldSpecs(fragment: string): FieldSpec[] {
  const specs: FieldSpec[] = []
  const seen = new Set<string>()

  SLOT_ELEMENT.lastIndex = 0
  for (const match of fragment.matchAll(SLOT_ELEMENT)) {
    const attrs = match[2] ?? ''
    const key = readAttr(attrs, 'data-field')
    if (!key || seen.has(key)) continue
    seen.add(key)

    const options = splitOptions(readAttr(attrs, 'data-options'))
    const summary = readAttr(attrs, 'data-summary')
    specs.push({
      key,
      ...(options.length ? { options } : {}),
      ...(summary ? { summary } : {}),
    })
  }

  return specs
}

/**
 * Fills every slot in a page body.
 *
 * A plain slot becomes a contenteditable cell holding its value; a slot with
 * options becomes a dropdown with the matching option selected. Both keep their
 * `data-field`, which is how the client reads the edited form back out.
 */
function fillSlots(body: string, values: FieldValues): string {
  SLOT_ELEMENT.lastIndex = 0
  return body.replace(SLOT_ELEMENT, (whole, tag: string, attrs: string) => {
    const key = readAttr(attrs, 'data-field')
    if (!key) return whole

    const options = splitOptions(readAttr(attrs, 'data-options'))
    const value = (values[key] ?? '').trim()

    if (options.length) {
      const selected = resolveOption(value, options)
      const rendered = [
        `<option value=""${selected ? '' : ' selected'}>Select…</option>`,
        ...options.map(option =>
          `<option value="${escapeHtml(option)}"${option === selected ? ' selected' : ''}>${escapeHtml(option)}</option>`,
        ),
      ].join('')
      // `data-field` stays on the cell, not the select: the client reads every
      // slot the same way, by walking the cells that carry the attribute.
      return `<${tag}${attrs}><select class="cellselect">${rendered}</select></${tag}>`
    }

    return `<${tag}${attrs} contenteditable="true" spellcheck="false">${escapeHtml(value)}</${tag}>`
  })
}

/**
 * Resolves a supplied value to one of a slot's options.
 *
 * Extraction spells a choice the way it reads it off the paper — "Under
 * graduate" for "Under Graduate", "Male " with the tick's trailing space — so an
 * exact comparison would throw away answers that are plainly right. The ladder
 * below widens from exact to approximate, and stops rather than guessing:
 * anything it cannot place leaves the dropdown unset, which is the annotator's
 * cue to choose. Inventing a choice is the one outcome worth avoiding, because a
 * wrong option looks just as settled as a right one.
 *
 * Exported so the ingest path and the render path resolve identically; whichever
 * one sees a value first, the form ends up showing the same option.
 */
export function resolveOption(value: string, options: string[]): string {
  const target = normalizeOption(value)
  if (!target || options.length === 0) return ''

  // 1. Exact, once case and punctuation are out of the way.
  const exact = options.find(option => normalizeOption(option) === target)
  if (exact) return exact

  // 2. Containment, but only when one option qualifies. Bare "graduate" sits
  //    inside three of the four education choices, and picking the first would
  //    be arbitrary — that case belongs to the scoring below.
  //
  //    Fragments shorter than this decide nothing: "f" appears in Female alone
  //    and would resolve, while "m" appears in both Male and Female and would
  //    not, so single letters would be answered or refused by coincidence
  //    rather than by evidence. Requiring a real fragment keeps that honest.
  const held = target.length >= MIN_CONTAINMENT_LENGTH
    ? options.filter((option) => {
        const candidate = normalizeOption(option)
        return candidate.includes(target) || target.includes(candidate)
      })
    : []
  if (held.length === 1) return held[0] as string

  // 3. Similarity, for the misreadings the first two steps cannot reach.
  const scored = options
    .map(option => ({ option, score: diceCoefficient(target, normalizeOption(option)) }))
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  const runnerUp = scored[1]
  if (!best || best.score < OPTION_MATCH_FLOOR) return ''
  // Two options fitting equally well is not an answer, it is a coin toss.
  if (runnerUp && best.score - runnerUp.score < OPTION_MATCH_MARGIN) return ''

  return best.option
}

/**
 * How close a value must be to an option before it counts as that option.
 *
 * Low enough to absorb a misread of a printed label — "Studnet" scores 0.5
 * against "Student", since a transposition breaks two bigrams at once. What
 * stops that generosity from inventing answers is not this number but the
 * margin below: a value has to fit one option clearly better than the rest.
 */
const OPTION_MATCH_FLOOR = 0.45

/** How far the best option must lead the next before the win is meaningful. */
const OPTION_MATCH_MARGIN = 0.05

/** Shortest fragment allowed to select an option by containment alone. */
const MIN_CONTAINMENT_LENGTH = 3

/** Case, spacing and punctuation all vary between extractions; none of it means anything. */
function normalizeOption(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Sørensen–Dice similarity over character bigrams, 0 to 1.
 *
 * Chosen over edit distance because it is insensitive to length: "Post Grad"
 * against "Post Graduate" scores on the run of shared pairs rather than being
 * punished for the four characters it is missing.
 */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const bigrams = (text: string): Map<string, number> => {
    const counts = new Map<string, number>()
    for (let index = 0; index < text.length - 1; index++) {
      const pair = text.slice(index, index + 2)
      counts.set(pair, (counts.get(pair) ?? 0) + 1)
    }
    return counts
  }

  const left = bigrams(a)
  const right = bigrams(b)
  let shared = 0
  for (const [pair, count] of left) shared += Math.min(count, right.get(pair) ?? 0)

  return (2 * shared) / (a.length - 1 + (b.length - 1))
}

function splitOptions(raw: string): string[] {
  return raw.split('|').map(option => option.trim()).filter(Boolean)
}

function readAttr(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))
  return match?.[1] ? decodeEntities(match[1]) : ''
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
