<script setup lang="ts">
import Icon from './Icon.vue';
defineProps<{ active?: boolean }>();
defineEmits<{ 'open-settings': [] }>();
</script>
<template>
  <header class="topbar">
    <div class="brandrow">
      <Icon name="lodestar" :size="24" class="logo" />
      <div class="brand"><h1>Lodestar</h1></div>
      <span class="status" :class="{ idle: !active }"
        ><span class="dot" aria-hidden="true"></span>{{ active ? 'Работает' : 'Ожидание' }}</span
      >
      <button
        class="icon-button"
        data-testid="open-settings"
        title="Настройки"
        aria-label="Настройки"
        @click="$emit('open-settings')"
      >
        <Icon name="settings" />
      </button>
    </div>
  </header>
</template>
