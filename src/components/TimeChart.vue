<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { scaleLinear } from 'd3-scale'
import { area, line } from 'd3-shape'
import { useElementWidth } from '../composables/useElementWidth'
import { number } from '../domain/format'
import type { ChartSeries, Range, TooltipRow } from '../domain/types'
import TooltipPanel from './TooltipPanel.vue'

const props = withDefaults(defineProps<{
  dates: string[]; series: ChartSeries[]; range: Range; label: string; unit: string
  selectedDay?: string | null; stacked?: boolean; secondaryUnit?: string; height?: number
  tooltip: (index: number) => TooltipRow[]; pannable?: boolean; zero?: boolean
}>(), { height: 290 })
const emit = defineEmits<{ select: [day: string]; pan: [range: Range]; reset: [] }>()
const element = ref<HTMLElement | null>(null)
const width = useElementWidth(element)
const clipId = 'clip-' + useId().replace(/:/g, '')
const hover = ref<{ index: number; x: number; y: number } | null>(null)
const left = 64, top = 28
const right = computed(() => Math.max(left + 1, width.value - (props.secondaryUnit ? 64 : 18)))
const count = computed(() => Math.floor(props.range[1]) - Math.ceil(props.range[0]) + 1)
const allDates = computed(() => count.value <= 31)
const spacing = computed(() => (right.value - left) / Math.max(1, props.range[1] - props.range[0]))
const rotate = computed(() => allDates.value && spacing.value < 44)
const dateRows = computed(() => rotate.value ? Math.max(1, Math.ceil(18 / Math.max(1, spacing.value))) : 1)
const chartHeight = computed(() => props.height + (dateRows.value - 1) * 42)
const bottom = computed(() => props.height - (rotate.value ? 70 : 42))
const x = computed(() => scaleLinear().domain(props.range[0] === props.range[1] ? [props.range[0] - .5, props.range[1] + .5] : props.range).range([left + 3, right.value - 3]))
const indices = computed(() => Array.from({ length: Math.max(0, Math.ceil(props.range[1]) - Math.floor(props.range[0]) + 1) }, (_, i) => i + Math.floor(props.range[0])).filter(i => i >= 0 && i < props.dates.length))
const layers = computed(() => props.series.map((s, j) => ({ ...s, points: indices.value.map(i => {
  const valid = props.series.every(other => other.values[i] != null)
  const base = props.stacked ? props.series.slice(0, j).reduce((sum, other) => sum + (other.values[i] ?? 0), 0) : 0
  return { i, value: s.values[i] ?? null, base, end: props.stacked ? valid ? base + (s.values[i] ?? 0) : null : s.values[i] ?? null }
}) })))
function domain(secondary: boolean) {
  const values = layers.value.filter(s => !!s.secondary === secondary).flatMap(s => s.points.map(p => p.end).filter((v): v is number => v !== null))
  if (!values.length) return [0, 1]
  let min = Math.min(...values), max = Math.max(...values)
  if (props.stacked || props.zero || secondary) { min = Math.min(0, min); max = Math.max(0, max) }
  const padding = Math.max(max - min, Math.abs(max) * .02, .01) * .1
  return [props.stacked ? 0 : min - padding, max + padding]
}
const y = computed(() => scaleLinear().domain(domain(false)).nice(4).range([bottom.value - 2, top + 3]))
const y2 = computed(() => scaleLinear().domain(domain(true)).nice(4).range([bottom.value - 2, top + 3]))
const yTicks = computed(() => y.value.ticks(4))
const xTicks = computed(() => {
  const first = Math.ceil(props.range[0]), last = Math.floor(props.range[1])
  if (allDates.value) return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i)
  const n = width.value < 460 ? 3 : 6
  return [...new Set(Array.from({ length: n }, (_, i) => Math.round(first + (last - first) * i / (n - 1))))]
})
const paths = computed(() => layers.value.map(s => {
  const scale = s.secondary ? y2.value : y.value
  const curve = line<(typeof s.points)[number]>().defined(p => p.end !== null).x(p => x.value(p.i)).y(p => scale(p.end!))
  const fill = area<(typeof s.points)[number]>().defined(p => p.end !== null).x(p => x.value(p.i)).y0(p => scale(p.base)).y1(p => scale(p.end!))
  return { ...s, path: curve(s.points) ?? '', area: fill(s.points) ?? '' }
}))
const selectedIndex = computed(() => props.dates.indexOf(props.selectedDay ?? ''))
const selectedVisible = computed(() => selectedIndex.value >= props.range[0] && selectedIndex.value <= props.range[1])
const markers = computed(() => hover.value ? layers.value.map(s => ({ key: s.key, color: s.color, value: s.points.find(p => p.i === hover.value!.index)?.end, secondary: s.secondary })) : [])
const barsWidth = computed(() => Math.max(1, Math.min(18, spacing.value * .8)))
function position(event: PointerEvent | MouseEvent) {
  const bounds = element.value!.getBoundingClientRect()
  const px = Math.min(right.value, Math.max(left, event.clientX - bounds.left))
  const index = Math.min(Math.floor(props.range[1]), Math.max(Math.ceil(props.range[0]), Math.round(x.value.invert(px))))
  hover.value = { index, x: event.clientX - bounds.left, y: Math.max(0, Math.min(bottom.value - 90, event.clientY - bounds.top)) }
}
let gesture: { id: number; clientX: number; range: Range; moved: boolean } | null = null
let suppressClick = false
function down(event: PointerEvent) {
  if (!props.pannable || event.button !== 0) return
  gesture = { id: event.pointerId, clientX: event.clientX, range: [...props.range], moved: false }
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!gesture) { position(event); return }
  const dx = event.clientX - gesture.clientX
  if (Math.abs(dx) > 3) gesture.moved = true
  if (gesture.moved) {
    hover.value = null
    const shift = dx / (right.value - left) * (gesture.range[1] - gesture.range[0])
    emit('pan', [gesture.range[0] - shift, gesture.range[1] - shift])
  }
}
function up(event: PointerEvent) {
  suppressClick = gesture?.moved ?? false
  gesture = null
  const target = event.currentTarget as Element
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}
function click(event: MouseEvent) {
  if (suppressClick) { suppressClick = false; return }
  position(event)
  const day = props.dates[hover.value!.index]
  if (day === props.selectedDay) reset()
  else if (day) emit('select', day)
}
function reset() {
  hover.value = null
  emit('reset')
}
function outside(event: Event) {
  if (!element.value?.contains(event.target as Node)) hover.value = null
}
function keyboard(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  const current = selectedVisible.value ? selectedIndex.value : Math.floor(props.range[1])
  const index = Math.min(Math.floor(props.range[1]), Math.max(Math.ceil(props.range[0]), current + (event.key === 'ArrowLeft' ? -1 : 1)))
  hover.value = { index, x: x.value(index), y: top }
  if (props.dates[index]) emit('select', props.dates[index]!)
}
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
const tick = (value: number) => Math.abs(value) >= 100 ? number(value, 0) : number(value, 2).replace(/\.?0+$/, '')
</script>
<template>
  <div ref="element" class="time-chart" @keydown="keyboard">
    <svg :viewBox="`0 0 ${width} ${chartHeight}`" :height="chartHeight" class="plot-svg" role="img" :aria-label="label" tabindex="0">
      <defs><clipPath :id="clipId"><rect :x="left" :y="top" :width="right-left" :height="bottom-top" /></clipPath></defs>
      <text :x="left" y="15" class="axis-unit">{{ unit }}</text>
      <text v-if="secondaryUnit" :x="right" y="15" text-anchor="end" class="axis-unit">{{ secondaryUnit }}</text>
      <g v-for="value in yTicks" :key="value" class="axis-tick">
        <line :x1="left" :x2="right" :y1="y(value)" :y2="y(value)" class="grid-line" />
        <text :x="left-10" :y="y(value)+4" text-anchor="end">{{ tick(value) }}</text>
      </g>
      <g v-if="secondaryUnit"><text v-for="value in y2.ticks(4)" :key="value" :x="right+8" :y="y2(value)+4" class="axis-tick">{{ tick(value) }}</text></g>
      <rect :x="left" :y="top" :width="right-left" :height="bottom-top" class="plot-frame" />
      <g :clip-path="`url(#${clipId})`">
        <template v-for="s in paths" :key="s.key">
          <path v-if="s.kind === 'area'" :d="s.area" :fill="s.color" fill-opacity=".6" />
          <template v-if="s.kind === 'bar'">
            <rect v-for="p in s.points.filter(p => p.value !== null)" :key="p.i" :x="x(p.i)-barsWidth/2" :width="barsWidth"
              :y="Math.min((s.secondary ? y2 : y)(0), (s.secondary ? y2 : y)(p.value!))"
              :height="Math.max(.5, Math.abs((s.secondary ? y2 : y)(0)-(s.secondary ? y2 : y)(p.value!)))"
              :fill="p.value! >= 0 ? 'var(--series-3)' : 'var(--series-2)'" fill-opacity=".48" />
          </template>
          <path v-else :d="s.path" fill="none" :stroke="s.color" :stroke-width="s.kind === 'area' ? 1.15 : 2" :stroke-dasharray="s.dash" />
          <template v-if="s.kind !== 'area' && s.kind !== 'bar' && count <= 40">
            <circle v-for="p in s.points.filter(p => p.value !== null)" :key="p.i" :cx="x(p.i)" :cy="(s.secondary ? y2 : y)(p.value!)" r="2.3" :fill="s.color" />
          </template>
        </template>
        <line v-if="selectedVisible" :x1="x(selectedIndex)" :x2="x(selectedIndex)" :y1="top" :y2="bottom" class="selection-guide" :data-selected-day="selectedDay" />
        <line v-if="hover" :x1="x(hover.index)" :x2="x(hover.index)" :y1="top" :y2="bottom" class="hover-guide" />
        <template v-if="hover"><circle v-for="m in markers.filter(m => m.value != null)" :key="m.key" :cx="x(hover.index)" :cy="(m.secondary ? y2 : y)(m.value!)" r="3.5" :fill="m.color" /></template>
      </g>
      <g v-for="(i, j) in xTicks" :key="i" class="axis-tick">
        <line :x1="x(i)" :x2="x(i)" :y1="bottom" :y2="bottom+4" class="grid-line" />
        <text :transform="`translate(${x(i)},${bottom+16+(rotate ? j % dateRows * 42 : 0)})${rotate ? ' rotate(-65)' : ''}`" :text-anchor="rotate ? 'end' : j === 0 ? 'start' : j === xTicks.length-1 ? 'end' : 'middle'">{{ dates[i]?.slice(5) }}</text>
      </g>
      <text :x="right" :y="chartHeight-4" text-anchor="end" class="axis-unit">交易日期</text>
      <rect :x="left" :y="top" :width="right-left" :height="bottom-top" fill="transparent" class="chart-hit" data-chart-hit=""
        @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @click="click" @pointerleave="hover = null" />
    </svg>
    <TooltipPanel v-if="hover" :day="dates[hover.index]!" :rows="tooltip(hover.index)" :x="hover.x" :y="hover.y" :width="width" />
  </div>
</template>
