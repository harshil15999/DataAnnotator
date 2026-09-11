// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    // The document queue. Folders carry the state; the database carries the
    // data. Every value is overridable at runtime as NUXT_QUEUE_<NAME>.
    queue: {
      dbFile: process.env.QUEUE_DB_FILE ?? '.data/forms.db',
      incomingDir: process.env.QUEUE_INCOMING_DIR ?? 'files/incoming',
      /**
       * The working folder, and the only one with anything to do in it.
       *
       * A document is exactly two files: a `<name>.json` extraction and the
       * `<name>.pdf` it was read from. The pair stays put once read and leaves
       * only when someone approves it, so this folder by itself answers "what
       * is still to be checked?".
       */
      processedDir: process.env.QUEUE_PROCESSED_DIR ?? 'files/processing',
      approvedDir: process.env.QUEUE_APPROVED_DIR ?? 'files/approved',
      failedDir: process.env.QUEUE_FAILED_DIR ?? 'files/failed',
      /** Set NUXT_QUEUE_WATCH=false to stop the folders being processed. */
      watch: process.env.QUEUE_WATCH !== 'false',
      pollMs: Number(process.env.QUEUE_POLL_MS ?? 3000),
    },
  },

  nitro: {
    // Both ship platform binaries and must not be bundled.
    externals: { external: ['pdf-poppler', 'better-sqlite3'] },
  },

  // ponytail: wide open so an ngrok tunnel (random host each run) isn't blocked.
  // Tighten to specific hosts if this ever leaves a trusted dev tunnel.
  vite: {
    server: { allowedHosts: true },
  },
})
