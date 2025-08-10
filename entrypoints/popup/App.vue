<template>
  <div>
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
// Element Plus 基础与暗色变量
import 'element-plus/theme-chalk/base.css';
import 'element-plus/theme-chalk/dark/css-vars.css';

</script>

<style scoped>
@media screen and (max-height: 800px) {
  .popup-container {
    max-height: 90vh;
  }
}

@media screen and (max-width: 480px) {
  .popup-container {
    width: 95vw;
  }
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-thumb {
  background: #ddd;
  border-radius: 3px;
}

::-webkit-scrollbar-track {
  background: #f5f5f5;
  border-radius: 3px;
}

.el-main {
  min-height: 460px;
  height: auto;
}

.custom-padding {
  padding: 12px 16px;
}
</style>
