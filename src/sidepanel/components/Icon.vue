<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 });
const paths: Record<string, string> = {
  lodestar: 'M8 20h8L14 9h-4L8 20Zm2-11V5h4v4M6 20h12M4 5l2 1M18 6l2-1M12 2v1',
  overview: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  inbox: 'M4 4h16v16H4V4Zm0 9h5l1 3h4l1-3h5',
  content: 'M5 3h9l5 5v13H5V3Zm9 0v5h5M8 12h8M8 16h6',
  history: 'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M9 15v6',
  back: 'm14 6-6 6 6 6M8 12h12',
  chevron: 'm9 5 7 7-7 7',
  people:
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-2a7 7 0 0 1 14 0v2M18 4a4 4 0 0 1 0 7M19 15a5 5 0 0 1 3 5',
  engagement: 'M7 10v11H3V10h4Zm0 0 4-7h2v6h5a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 2H7',
  views: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
};
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.content" />
  </svg>
</template>
