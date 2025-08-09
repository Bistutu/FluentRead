<template>
  <h1 class="title">流畅阅读 <span class="version">V{{version}}</span></h1>
</template>

<script lang="ts" setup>
const version = process.env.VUE_APP_VERSION
</script>

<style scoped>
.title {
  font-size: 1.75em;
  margin: 0.5em 0;
  color: var(--fr-text-color-primary);
  font-weight: 600;
}

.version {
  font-size: 0.5em;
  opacity: 0.8;
}
</style>
