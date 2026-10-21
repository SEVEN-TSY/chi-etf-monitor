<script setup lang="ts">
defineProps<{ items: { key: string; label: string; color: string; dash?: string }[]; active?: string[] }>()
defineEmits<{ toggle: [key: string] }>()
</script>
<template>
  <div class="chart-legend" aria-label="图例">
    <template v-for="item in items" :key="item.key">
      <button v-if="active" type="button" class="legend-item" :aria-pressed="active.includes(item.key)" @click="$emit('toggle', item.key)">
        <i :style="{ color: item.color, borderTopStyle: item.dash ? 'dashed' : 'solid' }"></i><span>{{ item.label }}</span>
      </button>
      <span v-else class="legend-item"><i :style="{ color: item.color, borderTopStyle: item.dash ? 'dashed' : 'solid' }"></i><span>{{ item.label }}</span></span>
    </template>
  </div>
</template>
