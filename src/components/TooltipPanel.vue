<script setup lang="ts">
import type { TooltipRow } from '../domain/types'
defineProps<{ day: string; rows: TooltipRow[]; x: number; y: number; width: number }>()
</script>
<template>
  <div class="chart-tooltip" role="tooltip" :style="{ left: Math.max(0, Math.min(width - 236, x + 16)) + 'px', top: y + 16 + 'px' }">
    <div class="tooltip-date">{{ day }}</div>
    <div v-for="(row, i) in rows" :key="i" class="tooltip-row">
      <span><i v-if="row.color" :style="{ background: row.color }"></i>{{ row.label }}</span><strong>{{ row.value }}</strong>
    </div>
  </div>
</template>
