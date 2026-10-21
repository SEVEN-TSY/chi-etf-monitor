<script setup lang="ts">
import { rates, percent } from '../domain/format'
import type { Point } from '../domain/types'
defineProps<{ point?: Point }>()
</script>
<template>
  <section class="metric-grid" aria-label="份额增减率指标" aria-live="polite">
    <div v-for="rate in rates" :key="rate.key" class="metric-card">
      <span>{{ rate.label }}</span><strong :style="{ color: rate.color }">{{ percent(point?.[rate.key]) }}</strong>
      <i :style="{ background: rate.color }"></i>
    </div>
  </section>
</template>
