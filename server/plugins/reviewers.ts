import { reviewerList } from '../utils/reviewers'

// Fails the server at startup on a bad REVIEWERS list, rather than on the first request.
export default defineNitroPlugin(() => {
  reviewerList()
})
