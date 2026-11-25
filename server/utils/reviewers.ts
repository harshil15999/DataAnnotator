import { getHeader, type H3Event } from 'h3'

import { apiError } from './errors'

/**
 * The names in `REVIEWERS`, read on every request so an edit needs only a restart
 * and no rebuild. Throws if a name repeats, because a repeated name would make two
 * reviewers look like one.
 */
export function reviewerList(): string[] {
  const names = (process.env.REVIEWERS ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)

  const repeated = names.filter((name, index) => names.indexOf(name) !== index)
  if (repeated.length) {
    throw new Error(`REVIEWERS repeats: ${[...new Set(repeated)].join(', ')}`)
  }

  return names
}

/** The reviewer named in the `X-Reviewer` header, or a 400 that lists the valid names. */
export function requireReviewer(event: H3Event): string {
  const name = (getHeader(event, 'x-reviewer') ?? '').trim()
  const names = reviewerList()

  if (!name || !names.includes(name)) {
    throw apiError(400, 'unknown_reviewer', 'Unknown reviewer. Pick your name from the list.', { reviewers: names })
  }

  return name
}
