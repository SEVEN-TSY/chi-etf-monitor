<script setup lang="ts">
import { computed, ref } from 'vue'
import { scaleLinear } from 'd3-scale'
import { useElementWidth } from '../composables/useElementWidth'
import { number, percent, signed } from '../domain/format'
import type { Change, Fund } from '../domain/types'
import TooltipPanel from './TooltipPanel.vue'
const props = defineProps<{ values: (Fund & { change: Change | null })[]; day: string }>()
const emit = defineEmits<{ select: [code: string] }>()
const element = ref<HTMLElement | null>(null)
const width = useElementWidth(element)
const left = computed(() => width.value < 480 ? 91 : 132)
const right = computed(() => Math.max(left.value + 12, width.value - 100))
const height = computed(() => 58 + props.values.length * 45)
const x = computed(() => {
  const numbers = [0, ...props.values.map(v => v.change?.delta ?? 0)]
  const min = Math.min(...numbers), max = Math.max(...numbers), span = Math.max(.01, max - min)
  return scaleLinear().domain([min - span * .08, max + span * .08]).nice(4).range([left.value, right.value])
})
const hover = ref<{ index: number; x: number; y: number } | null>(null)
const rows = computed(() => {
  const fund = hover.value ? props.values[hover.value.index] : null
  return fund ? [{ label: fund.short, value: fund.code }, { label: '份额增减', value: fund.change ? signed(fund.change.delta) + '亿份' : '—' },
    { label: '增减率', value: percent(fund.change?.rate) }] : []
})
function move(event: PointerEvent, index: number) {
  const bounds = element.value!.getBoundingClientRect()
  hover.value = { index, x: event.clientX - bounds.left, y: Math.min(height.value - 135, event.clientY - bounds.top) }
}
</script>
<template>
  <div ref="element" class="comparison-chart" @pointerleave="hover = null">
    <svg :viewBox="`0 0 ${width} ${height}`" :height="height" role="img" aria-label="8只ETF区间份额变化，单位亿份" class="plot-svg">
      <text :x="left" y="16" class="axis-unit">份额增减（亿份）</text>
      <line v-for="value in x.ticks(width < 480 ? 3 : 5)" :key="value" :x1="x(value)" :x2="x(value)" y1="25" :y2="height-32" class="grid-line" />
      <line :x1="x(0)" :x2="x(0)" y1="25" :y2="height-32" class="hover-guide" />
      <g v-for="(fund, i) in values" :key="fund.code">
        <text x="0" :y="i*45+43" class="fund-label">{{ fund.short }}</text>
        <text x="0" :y="i*45+59" class="axis-unit">{{ fund.code }}</text>
        <rect v-if="fund.change" :x="Math.min(x(0), x(fund.change.delta))" :y="i*45+31" :width="Math.max(.7, Math.abs(x(fund.change.delta)-x(0)))" height="25" rx="2" :fill="fund.change.delta >= 0 ? 'var(--series-1)' : 'var(--series-2)'" fill-opacity=".8" />
        <text :x="width-1" :y="i*45+43" text-anchor="end">{{ signed(fund.change?.delta) }}</text>
        <text :x="width-1" :y="i*45+59" text-anchor="end" class="axis-unit">{{ fund.change ? percent(fund.change.rate) : '待复核或不足' }}</text>
        <rect x="0" :y="i*45+25" :width="width" height="43" fill="transparent" data-chart-hit="" @pointermove="move($event, i)" @click="emit('select', fund.code)" />
      </g>
      <text v-for="value in x.ticks(width < 480 ? 3 : 5)" :key="value" :x="x(value)" :y="height-10" text-anchor="middle" class="axis-tick">{{ number(value, 1) }}</text>
    </svg>
    <TooltipPanel v-if="hover" :day="day" :rows="rows" :x="hover.x" :y="hover.y" :width="width" />
  </div>
</template>
