<script setup lang="ts">
import App from './App.vue'
import { useDashboardData } from './composables/useDashboardData'
const { data, error, loading, refresh } = useDashboardData()
</script>
<template>
  <div v-if="error" class="connection-message" role="alert">
    <span>{{ data ? '数据暂未刷新：' : '' }}{{ error }}</span><button type="button" :disabled="loading" @click="refresh">重试</button>
  </div>
  <App v-if="data" :data="data" @refresh="refresh" />
  <div v-else-if="!error" class="connection-message" role="status">正在读取本地数据库…</div>
</template>
