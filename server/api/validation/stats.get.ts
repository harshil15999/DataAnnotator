import { defineEventHandler } from 'h3'

import { approvalsByReviewer, countsByStatus } from '../../utils/db'

/**
 * How much work is waiting, done, and unreadable, and who has approved what.
 *
 * `byReviewer` counts approvals per reviewer name. The status counts are a
 * straight count: `under_validation` is real queue depth, not an estimate.
 */
export default defineEventHandler(async () => ({
  ...countsByStatus(),
  byReviewer: approvalsByReviewer(),
}))
