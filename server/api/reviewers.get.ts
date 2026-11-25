import { defineEventHandler } from 'h3'

import { reviewerList } from '../utils/reviewers'

/** The names a reviewer can pick at the start of the console. */
export default defineEventHandler(() => ({ reviewers: reviewerList() }))
