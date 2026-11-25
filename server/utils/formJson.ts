import { createError } from 'h3'

import type { FieldValues, FormPage } from './formTemplate'
import { buildFormPages, resolveOption } from './formTemplate'

/**
 * Filling the master form from an extraction's JSON.
 *
 * Upstream reads a scanned form against a schema and writes a JSON of named
 * fields — `head_of_family.blood_group`, `family_metadata.ancestral_village` —
 * with no knowledge of this app or its slot keys. This module is the one place
 * those two vocabularies are lined up.
 *
 * The alignment is a *declared table*, not a search: every slot names the path
 * it comes from, once, below. Nothing here infers a mapping from a label, so a
 * field the extraction renames goes empty and visible rather than landing
 * quietly in the wrong slot.
 *
 * Three details of the format shape the code:
 *
 *  - Each scalar field is followed by `<field>_citations`, listing where on the
 *    scan it was read. That is where slot provenance comes from.
 *  - `head_of_family` spells out every field, `null` included. Entries in
 *    `family_members` omit theirs entirely, so a path may be *absent* rather
 *    than null — both mean the same thing here.
 *  - `<field>_meta.verification.feedback` explains, in prose, why a field could
 *    not be read. Those explanations are kept for the empty slots, because
 *    afterwards nothing else can say why a slot is blank.
 */

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

/** What one hydration run produced, and what it could not place. */
export interface JsonHydration {
  values: FieldValues
  /** The scan page each value was read off, keyed as {@link values} is. */
  valuePages: Record<string, number>
  /** Person columns filled from `family_members`, the Head aside. */
  membersMapped: number
  /** `member_role`s that answered to no column, so their person was left out. */
  membersDropped: string[]
  /** Why a slot is empty, in the extraction's own words. */
  notes: string[]
}

/** A field as the extraction records it: the value, and the two siblings about it. */
interface ExtractedField {
  value: unknown
  citations: string[]
  /** Prose explaining an absent value. Only the top-level sections carry it. */
  feedback: string
}

type Mapping = readonly (readonly [slot: string, path: string])[]

/* ------------------------------------------------------------------ *
 * The mapping
 * ------------------------------------------------------------------ */

/** Slots belonging to the household rather than to any one person. */
const HOUSEHOLD: Mapping = [
  ['form_no', 'form_metadata.form_number'],
  ['village', 'family_metadata.ancestral_village'],
  ['total_members', 'family_metadata.total_members'],
  ['grandfather.first', 'family_metadata.grandfather_of_head.first_name'],
  ['grandfather.middle', 'family_metadata.grandfather_of_head.middle_name'],
  ['grandfather.last', 'family_metadata.grandfather_of_head.last_name'],
  ['father.first', 'family_metadata.father_of_head.first_name'],
  ['father.middle', 'family_metadata.father_of_head.middle_name'],
  ['father.last', 'family_metadata.father_of_head.last_name'],
]

/**
 * The 39 slots every person column declares, as suffixes.
 *
 * Read against one person object — `head_of_family`, or an entry of
 * `family_members` — and prefixed with that person's column: `p3` + `.name`.
 */
const PER_PERSON: Mapping = [
  /* --- page 1, rows 1-20 --- */
  ['name', 'name'],
  ['father_husband', 'father_or_husband_name'],
  ['surname', 'surname'],
  ['relation', 'relation_with_head'],
  ['gender', 'gender'],
  ['member', 'is_member_of_organization'],
  ['dob', 'date_of_birth'],
  ['education_level', 'education.level_of_education'],
  ['education_field', 'education.field_of_education'],
  ['other_qualification', 'education.other_qualifications'],
  ['occupation_type', 'occupation.occupation_type'],
  ['occupation_field', 'occupation.field_of_occupation'],
  ['company', 'occupation.company_name'],
  ['blood_group', 'blood_group'],
  ['marital_status', 'marital_status'],
  ['marriage_date', 'date_of_marriage'],
  ['father_name', 'parents.father_name'],
  ['mother_name', 'parents.mother_name'],

  /* --- page 2, rows 21-30 --- */
  ['native_village', 'native_village_of_father'],
  ['home_address', 'home_address.address_line'],
  ['home_landmark', 'home_address.landmark'],
  ['home_area', 'home_address.area'],
  ['home_city', 'home_address.city'],
  ['home_state', 'home_address.state'],
  ['home_country', 'home_address.country'],
  ['home_pin', 'home_address.pincode'],
  // The office block has no landmark, on the paper or here.
  ['office_address', 'office_address.address_line'],
  ['office_area', 'office_address.area'],
  ['office_city', 'office_address.city'],
  ['office_state', 'office_address.state'],
  ['office_country', 'office_address.country'],
  ['office_pin', 'office_address.pincode'],
  ['residence_phone', 'contact_information.residence_phone'],
  ['office_phone', 'contact_information.office_phone'],
  ['mobile1', 'contact_information.mobile_1'],
  ['mobile2', 'contact_information.mobile_2'],
  ['email', 'contact_information.email'],
  ['website', 'contact_information.website'],
  ['achievements', 'achievements'],
]

/** The Diksha block printed under the table. Family-level, not per person. */
const NOTES: Mapping = [
  ['notes.sansaari_naam', 'diksha_information.sansaari_naam'],
  ['notes.guru_naam', 'diksha_information.guru_naam'],
  ['notes.gaam', 'diksha_information.gaam'],
  ['notes.samuday', 'diksha_information.samuday'],
  ['notes.diksharthi_naam', 'diksha_information.diksharthi_naam'],
  ['notes.diksha_date', 'diksha_information.diksha_date_and_tithi'],
]

/** Pulls the column number out of `"Person - 3"`. */
const MEMBER_ROLE_COLUMN = /(\d+)/

/* ------------------------------------------------------------------ *
 * Hydrating
 * ------------------------------------------------------------------ */

/**
 * Reads an extraction into template slot values.
 *
 * Async because the template is the authority on two things this needs and must
 * not restate: which slots are dropdowns, and which page each slot sits on.
 */
export async function hydrateFromJson(raw: string): Promise<JsonHydration> {
  const root = parseDocument(raw)
  const pages = await buildFormPages()
  const options = optionsBySlot(pages)
  const pageOf = pageBySlot(pages)

  const values: FieldValues = {}
  const valuePages: Record<string, number> = {}
  const notes: string[] = []

  const take = (slot: string, field: ExtractedField): void => {
    const text = asText(field.value)
    const choices = options.get(slot)
    const value = choices ? resolveOption(text, choices) : text

    if (!value) {
      // An explanation is only worth keeping where a slot ended up empty.
      if (field.feedback) notes.push(`${slot}: ${field.feedback}`)
      return
    }

    values[slot] = value

    // Provenance. Where the extraction cited nothing, fall back to the page the
    // template itself puts this slot on: the form's layout is fixed and
    // server-owned, so that is a fact rather than a guess. Leaving it unstamped
    // would be worse than wrong — an empty entry is how the console reports
    // "a human typed this", which an extracted value must never claim.
    const page = pageFromCitations(field.citations) ?? pageOf.get(slot)
    if (page) valuePages[slot] = page
  }

  for (const [slot, path] of HOUSEHOLD) take(slot, readField(root, path))
  for (const [slot, path] of NOTES) take(slot, readField(root, path))

  const columns = personColumns(pages)
  const head = columns[0]
  if (head) {
    const person = readObject(root, 'head_of_family')
    if (person) for (const [suffix, path] of PER_PERSON) take(`${head}.${suffix}`, readField(person, path))
  }

  const { placed, dropped } = placeMembers(readArray(root, 'family_members'), columns.slice(1))
  for (const [column, person] of placed) {
    for (const [suffix, path] of PER_PERSON) take(`${column}.${suffix}`, readField(person, path))
  }

  return { values, valuePages, membersMapped: placed.size, membersDropped: dropped, notes }
}

/**
 * Decides which person column each member belongs in.
 *
 * `member_role` is preferred over the array's own order because it is the
 * paper's column heading. When the extraction skips a column — *Person - 2*
 * blank but *Person - 3* filled — position alone would slide everyone one
 * column left and file Person 3's answers under the `p2` heading. The annotator
 * is reading the form against the scan side by side, and a shifted column is
 * worse than a missing one: it looks right.
 *
 * Order is the fallback, taking whatever columns the roles left free, so a
 * member with no usable role is still placed rather than discarded.
 */
function placeMembers(
  members: Record<string, unknown>[],
  columns: string[],
): { placed: Map<string, Record<string, unknown>>; dropped: string[] } {
  const placed = new Map<string, Record<string, unknown>>()
  const leftover: Record<string, unknown>[] = []
  const dropped: string[] = []

  for (const member of members) {
    const column = columnFromRole(asText(member.member_role), columns)
    if (column && !placed.has(column)) placed.set(column, member)
    else leftover.push(member)
  }

  const free = columns.filter(column => !placed.has(column))
  for (const member of leftover) {
    const column = free.shift()
    if (column) placed.set(column, member)
    // Beyond the columns the form physically has, there is nowhere to put them.
    else dropped.push(asText(member.member_role) || '(unnamed member)')
  }

  return { placed, dropped }
}

/** `"Person - 3"` → `p3`, but only when the form actually has that column. */
function columnFromRole(role: string, columns: string[]): string | null {
  const digits = role.match(MEMBER_ROLE_COLUMN)?.[1]
  if (!digits) return null
  const column = `p${Number(digits)}`
  return columns.includes(column) ? column : null
}

/* ------------------------------------------------------------------ *
 * Reading the extraction
 * ------------------------------------------------------------------ */

/**
 * Reads one field, with the two siblings the format keeps beside it.
 *
 * A path may be absent rather than null — entries in `family_members` simply
 * omit the fields they have nothing for — and both are read as "no value".
 */
function readField(root: Record<string, unknown>, path: string): ExtractedField {
  const segments = path.split('.')
  const key = segments.pop() as string

  let parent: Record<string, unknown> | null = root
  for (const segment of segments) parent = parent && asObject(parent[segment])
  if (!parent) return { value: null, citations: [], feedback: '' }

  return {
    value: parent[key] ?? null,
    citations: asStringArray(parent[`${key}_citations`]),
    feedback: readFeedback(parent[`${key}_meta`]),
  }
}

/** The verification note explaining a value, when the extraction offers one. */
function readFeedback(meta: unknown): string {
  const verification = asObject(asObject(meta)?.verification)
  const feedback = verification?.feedback
  return typeof feedback === 'string' ? feedback.trim() : ''
}

/**
 * The value as the form will hold it.
 *
 * `null` and absence both mean the paper was blank there, which is an answer —
 * the slot stays empty rather than being filled with a plausible guess.
 */
function asText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value !== 'string') return ''
  // Trimmed at the ends only: a home address is written over two lines and the
  // break between them is part of the address.
  return value.trim()
}

/** The 1-based scan page a citation points at: `/page/0/Form/2` is page 1. */
function pageFromCitations(citations: string[]): number | null {
  for (const citation of citations) {
    const index = citation.match(/\/page\/(\d+)\b/)?.[1]
    if (index !== undefined) return Number(index) + 1
  }
  return null
}

/* ------------------------------------------------------------------ *
 * What the template knows
 * ------------------------------------------------------------------ */

/** The options each dropdown slot allows, so a value can be resolved to one. */
function optionsBySlot(pages: FormPage[]): Map<string, string[]> {
  const options = new Map<string, string[]>()
  for (const page of pages) {
    for (const field of page.fields) if (field.options) options.set(field.key, field.options)
  }
  return options
}

/** The page each slot sits on, for values the extraction left uncited. */
function pageBySlot(pages: FormPage[]): Map<string, number> {
  const pageOf = new Map<string, number>()
  pages.forEach((page, index) => {
    // First page wins, so a slot the form repeats reports where it first appears.
    for (const field of page.fields) if (!pageOf.has(field.key)) pageOf.set(field.key, index + 1)
  })
  return pageOf
}

/**
 * The person columns the template declares, in order: `p1`, `p2`, …
 *
 * Read off the template rather than hard-coded, so widening the form to more
 * people needs no change here.
 */
function personColumns(pages: FormPage[]): string[] {
  const columns = new Set<string>()
  for (const page of pages) {
    for (const field of page.fields) {
      const column = field.key.match(/^(p\d+)\./)?.[1]
      if (column) columns.add(column)
    }
  }
  return [...columns].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

function parseDocument(raw: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch (error) {
    throw createError({
      statusCode: 422,
      statusMessage: `The extraction is not valid JSON: ${(error as Error).message}`,
    })
  }

  const root = asObject(parsed)
  if (!root) {
    throw createError({
      statusCode: 422,
      statusMessage: 'The extraction should be a JSON object of named sections.',
    })
  }
  return root
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readObject(root: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return asObject(root[key])
}

function readArray(root: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = root[key]
  if (!Array.isArray(value)) return []
  return value.map(asObject).filter((entry): entry is Record<string, unknown> => entry !== null)
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}
