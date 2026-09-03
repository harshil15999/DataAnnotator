<script setup lang="ts">
useHead({
  title: 'DEMO Unlimited OCR Streaming 🚀 - a Hugging Face Space by baohuynhbk14',
  meta: [
    {
      name: 'description',
      content:
        'Upload a photo, scanned page, or PDF file and the app will recognize all the text, titles, tables, and other elements. It returns the extracted content as clean markdown, provides bounding-box coordinates.',
    },
  ],
})
</script>

<template>
  <div class="page">
    <NuxtRouteAnnouncer />
    <SpaceHeader />
    <SpaceApp />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}
</style>
