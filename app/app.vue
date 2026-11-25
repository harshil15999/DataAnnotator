<script setup lang="ts">
useHead({
  title: 'DataAnnotator — Document OCR console',
  meta: [
    {
      name: 'description',
      content:
        'Upload a filled-in registration form as a PDF or image. The values are read off it into the master form, where they can be corrected in place and exported as CSV.',
    },
  ],
})
</script>

<template>
  <div class="page">
    <NuxtRouteAnnouncer />
    <AppMain />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}
</style>
