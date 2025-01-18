<template>
  <div class="common-layout">
    <el-container>
      <el-header class="custom-padding">
        <Header/>
      </el-header>
      <el-main class="custom-padding" style="min-height: 320px">
        <Main/>
      </el-main>
      <el-footer class="custom-padding">
        <Footer/>
      </el-footer>
    </el-container>
  </div>
</template>

<script lang="ts" setup>
import Header from '../../components/Header.vue';
import Main from "../../components/Main.vue";
import Footer from "../../components/Footer.vue";
import '../../styles/theme.css';

</script>

<style>
.common-layout {
  background-color: var(--el-bg-color);
  color: var(--el-text-color);
}
</style>
