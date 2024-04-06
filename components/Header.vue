<template>
  <h1 style="font-size: 1.75em">流畅阅读 <span style="font-size: 0.5em">V{{version}}</span></h1>
</template>

<script lang="ts" setup>
import {app} from "../entrypoints/utils/constant";

const version = app.version
</script>

<style scoped>

</style>
