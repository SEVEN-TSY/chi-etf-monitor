<script setup lang="ts">
import { computed, ref } from 'vue'
import { area } from 'd3-shape'
import { scaleLinear } from 'd3-scale'
import { useElementWidth } from '../composables/useElementWidth'
import type { Point, Range } from '../domain/types'

const props = defineProps<{ points: Point[]; range: Range }>()
const emit = defineEmits<{ change: [range: Range] }>()
const element = ref<HTMLElement | null>(null)
const width = useElementWidth(element)
const max = computed(() => Math.max(0, props.points.length - 1))
const left = 14
const right = computed(() => Math.max(15, width.value - 14))
const x = computed(() => scaleLinear().domain([0, Math.max(1, max.value)]).range([left, right.value]))
const y = computed(() => scaleLinear().domain([0, Math.max(1, ...props.points.map(p => p.total ?? 0))]).range([47, 10]))
const path = computed(() => area<Point>().defined(p => p.total !== null).x(p => x.value(p.i)).y0(48).y1(p => y.value(p.total!))(props.points) ?? '')
const ticks = computed(() => {
  const count = width.value < 460 ? 3 : 6
  return [...new Set(Array.from({ length: count }, (_, i) => Math.round(max.value * i / (count - 1))))]
})
let gesture: { id: number; start: number; range: Range; mode: 'start' | 'end' | 'pan' } | null = null
function down(event: PointerEvent, mode: 'start' | 'end' | 'pan') {
  if (event.button !== 0) return
  gesture = { id: event.pointerId, start: event.clientX, range: [...props.range], mode }
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!gesture || gesture.id !== event.pointerId) return
  const delta = (event.clientX - gesture.start) / (right.value - left) * max.value
  const [from, to] = gesture.range
  const minSpan = Math.min(5, max.value)
  if (gesture.mode === 'pan') emit('change', [from + delta, to + delta])
  else if (gesture.mode === 'start') emit('change', [Math.max(0, Math.min(to - minSpan, from + delta)), to])
  else emit('change', [from, Math.min(max.value, Math.max(from + minSpan, to + delta))])
}
function up(event: PointerEvent) {
  gesture = null
  const target = event.currentTarget as Element
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}
function wheel(event: WheelEvent) {
  const bounds = element.value!.getBoundingClientRect()
  const px = event.clientX - bounds.left, py = event.clientY - bounds.top
  if (px < left || px > right.value || py < 7 || py > 49) return
  event.preventDefault()
  const [from, to] = props.range, span = to - from
  const anchor = Math.min(to, Math.max(from, x.value.invert(px)))
  const nextSpan = Math.max(Math.min(5, max.value), Math.min(max.value, span * Math.exp(Math.max(-1, Math.min(1, event.deltaY * .002)))))
  const fraction = span > 0 ? (anchor - from) / span : .5
  emit('change', [anchor - nextSpan * fraction, anchor + nextSpan * (1 - fraction)])
}
function key(event: KeyboardEvent, edge: 'start' | 'end') {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const [from, to] = props.range, step = event.key === 'ArrowLeft' ? -1 : 1
  if (event.shiftKey) emit('change', [from + step, to + step])
  else if (edge === 'start') emit('change', [event.key === 'Home' ? 0 : Math.min(to - Math.min(5, max.value), Math.max(0, from + step)), to])
  else emit('change', [from, event.key === 'End' ? max.value : Math.max(from + Math.min(5, max.value), Math.min(max.value, to + step))])
}
</script>
<template>
  <div ref="element" class="time-navigator" aria-label="时间范围" @wheel="wheel">
    <svg :viewBox="`0 0 ${width} 78`" height="78" class="navigator-svg" role="img" aria-label="全年总份额缩略图">
      <rect :x="left" y="7" :width="right-left" height="42" class="navigator-track" />
      <path :d="path" fill="var(--series-1)" fill-opacity=".2" />
      <g v-for="(i, j) in ticks" :key="i"><text :x="x(i)" y="70" :text-anchor="j === 0 ? 'start' : j === ticks.length-1 ? 'end' : 'middle'" class="axis-tick">{{ points[i]?.day.slice(5) }}</text></g>
    </svg>
    <div class="navigator-window" :style="{ left: x(range[0]) + 'px', width: Math.max(0, x(range[1])-x(range[0])) + 'px' }" @pointerdown="down($event, 'pan')" @pointermove="move" @pointerup="up" @pointercancel="up"></div>
    <button type="button" class="navigator-handle" :style="{ left: x(range[0]) + 'px' }" aria-label="调整起始日期" @pointerdown="down($event, 'start')" @pointermove="move" @pointerup="up" @pointercancel="up" @keydown="key($event, 'start')">Ⅱ</button>
    <button type="button" class="navigator-handle" :style="{ left: x(range[1]) + 'px' }" aria-label="调整结束日期" @pointerdown="down($event, 'end')" @pointermove="move" @pointerup="up" @pointercancel="up" @keydown="key($event, 'end')">Ⅱ</button>
  </div>
</template>
