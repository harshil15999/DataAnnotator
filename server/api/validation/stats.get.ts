import { defineEventHandler } from 'h3'

import type { FormStatus } from '../../utils/db'
import { countsByStatus } from '../../utils/db'

/**
 * How much work is waiting, done, and unreadable.
 *
 * A straight count by status: `under_validation` is real queue depth, not an
 * estimate, because status is the only place "waiting" is ever recorded — a
 * document either reads cleanly and lands there, or fails and never does.
 */
export default defineEventHandler(async (): Promise<Record<FormStatus, number>> => {
  return countsByStatus()
})
