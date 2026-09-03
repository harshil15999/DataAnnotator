<script setup lang="ts">
interface Props {
  author?: string
  ownerAvatar?: string
  repoName?: string
  likes?: number
  hardware?: string
  activeTab?: 'app' | 'files' | 'community'
}

withDefaults(defineProps<Props>(), {
  author: 'baohuynhbk14',
  ownerAvatar:
    'https://cdn-avatars.huggingface.co/v1/production/uploads/6337f3e61718795719570051/awChBPiyTI4d9c3-lHLY0.jpeg',
  repoName: 'DEMO-Unlimited-OCR-Streaming',
  likes: 9,
  hardware: 'Zero',
  activeTab: 'app',
})

const liked = ref(false)
const likeCount = ref(9)

function toggleLike() {
  liked.value = !liked.value
  likeCount.value += liked.value ? 1 : -1
}
</script>

<template>
  <header class="space-header">
    <div class="space-header__row">
      <div class="space-header__crumbs">
        <NuxtLink to="/" class="space-header__logo-link">Spaces</NuxtLink>
        <span class="space-header__sep">/</span>
        <a :href="`https://huggingface.co/${author}`" class="space-header__author">{{ author }}</a>
        <span class="space-header__sep">/</span>
        <span class="space-header__repo">{{ repoName }}</span>

        <button type="button" class="space-header__copy" title="Copy space name to clipboard">
          ⧉
        </button>
      </div>

      <div class="space-header__badges">
        <div class="space-header__like">
          <button type="button" class="space-header__like-btn" :class="{ 'is-liked': liked }" @click="toggleLike">
            <span aria-hidden="true">♥</span>
            <span class="space-header__like-label">like</span>
          </button>
          <span class="space-header__like-count">{{ likeCount }}</span>
        </div>

        <div class="space-header__status">
          <span class="space-header__status-dot" />
          Running
          <span class="space-header__status-on">on</span>
          <strong class="space-header__status-hw">{{ hardware }}</strong>
        </div>
      </div>
    </div>

    <nav class="space-header__tabs">
      <a
        href="#"
        class="space-header__tab"
        :class="{ 'is-active': activeTab === 'app' }"
      >App</a>
      <a
        href="#"
        class="space-header__tab"
        :class="{ 'is-active': activeTab === 'files' }"
      >Files</a>
      <a
        href="#"
        class="space-header__tab"
        :class="{ 'is-active': activeTab === 'community' }"
      >Community</a>
    </nav>
  </header>
</template>

<style scoped>
.space-header {
  border-bottom: 1px solid var(--hf-gray-200, #e5e7eb);
  background: linear-gradient(to top, var(--hf-gray-50, #f9fafb), #fff);
  padding: 0.5rem 1rem 0;
}

.space-header__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0;
}

.space-header__crumbs {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 1.05rem;
  font-weight: 600;
  min-width: 0;
  flex-wrap: wrap;
}

.space-header__logo-link {
  font-weight: 700;
  color: var(--hf-gray-700, #374151);
}

.space-header__logo-link:hover {
  color: var(--hf-blue-600, #2563eb);
}

.space-header__sep {
  color: var(--hf-gray-300, #d1d5db);
}

.space-header__author {
  color: var(--hf-gray-500, #6b7280);
}

.space-header__author:hover {
  color: var(--hf-blue-600, #2563eb);
}

.space-header__repo {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  color: #111827;
}

.space-header__copy {
  border: none;
  background: transparent;
  color: var(--hf-gray-400, #9ca3af);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0.15rem 0.3rem;
}

.space-header__copy:hover {
  color: var(--hf-gray-600, #4b5563);
}

.space-header__badges {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.space-header__like {
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  border-radius: 0.375rem;
  border: 1px solid var(--hf-gray-200, #e5e7eb);
  font-size: 0.85rem;
  color: var(--hf-gray-500, #6b7280);
}

.space-header__like-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  border: none;
  background: transparent;
  padding: 0.3rem 0.6rem;
  cursor: pointer;
  color: inherit;
}

.space-header__like-btn.is-liked {
  color: #dc2626;
}

.space-header__like-count {
  border-left: 1px solid var(--hf-gray-200, #e5e7eb);
  padding: 0.3rem 0.6rem;
}

.space-header__status {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border-radius: 0.375rem;
  border: 1px solid var(--hf-green-100, #dcfce7);
  background: var(--hf-green-50, #f0fdf4);
  color: var(--hf-green-700, #15803d);
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 0.75rem;
  padding: 0.3rem 0.6rem;
}

.space-header__status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--hf-green-700, #15803d);
  display: inline-block;
}

.space-header__status-on {
  color: var(--hf-gray-500, #6b7280);
  font-family: inherit;
}

.space-header__status-hw {
  text-transform: uppercase;
  font-style: italic;
}

.space-header__tabs {
  display: flex;
  gap: 1.25rem;
  margin-top: 0.25rem;
}

.space-header__tab {
  padding: 0.6rem 0.1rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--hf-gray-500, #6b7280);
  border-bottom: 2px solid transparent;
}

.space-header__tab.is-active {
  color: #111827;
  border-bottom-color: #111827;
}

.space-header__tab:hover {
  color: var(--hf-blue-600, #2563eb);
}
</style>
