<template>
  <div class="edit-translation-dialog">
    <el-dialog
      v-model="visible"
      title="修改译文"
      width="50%"
      :before-close="handleClose"
    >
      <el-form>
        <el-form-item label="原文">
          <el-input v-model="originalText" type="textarea" rows="3" readonly />
        </el-form-item>
        <el-form-item label="译文">
          <el-input v-model="translatedText" type="textarea" rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="handleClose">取消</el-button>
          <el-button type="primary" @click="handleSave">保存</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';

const visible = ref(false);
const originalText = ref('');
const translatedText = ref('');
const saveKey = ref('');

const handleClose = () => {
  visible.value = false;
};

const handleSave = () => {
    console.log('保存译文:', saveKey.value);
  if (saveKey.value) {
    const data = JSON.parse(localStorage.getItem(saveKey.value) || '{}');
    data.output = translatedText.value;
    localStorage.setItem(saveKey.value, JSON.stringify(data));
  }
  visible.value = false;
};

const show = (text: string, translation: string, key: string) => {
  originalText.value = text;
  translatedText.value = translation;
  saveKey.value = key;
  visible.value = true;
};

defineExpose({
  show
});
</script>

<style scoped>
.edit-translation-dialog {
  :deep(.el-dialog) {
    border-radius: 8px;
  }
}
</style>
