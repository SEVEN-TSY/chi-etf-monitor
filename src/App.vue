<script setup lang="ts">
import { computed } from 'vue'
import type { ChartSeries, Payload, RateKey, TooltipRow } from './domain/types'
import { colors, number, percent, rates, signed } from './domain/format'
import { useDashboard } from './composables/useDashboard'
import { useAmvSync } from './composables/useAmvSync'
import MetricCards from './components/MetricCards.vue'
import TimeChart from './components/TimeChart.vue'
import TimeNavigator from './components/TimeNavigator.vue'
import FundComparison from './components/FundComparison.vue'
import ChartLegend from './components/ChartLegend.vue'
const props = defineProps<{ data: Payload }>()
const emit = defineEmits<{ refresh: [] }>()
const { model, selectedDay, period, fund, preset, range, visibleRates, detailsOpen, visiblePoints, metrics,
  detailDay, historyDays, selectedFund, comparisons, setPreset, setRange, toggleRate } = useDashboard(() => props.data)
const { status: amvStatus } = useAmvSync(metrics, () => emit('refresh'))
const stack = computed<ChartSeries[]>(() => model.funds.map((f, i) => ({ key: f.code, label: f.short, color: colors[i]!,
  kind: 'area', values: model.points.map(p => p.parts[f.code] ?? null) })))
const rateSeries = computed<ChartSeries[]>(() => rates.filter(r => visibleRates.value.includes(r.key)).map(r => ({ ...r, values: model.points.map(p => p[r.key]) })))
const history = computed<ChartSeries[]>(() => [
  { key: 'delta', label: '每日增减 · 右轴', color: colors[2]!, kind: 'bar', secondary: true, values: historyDays.value.map((_, i) => model.interval(fund.value, i, 1)?.delta ?? null) },
  { key: 'total', label: '总份额 · 左轴', color: colors[0]!, values: historyDays.value.map(d => model.observation(d, fund.value)?.shares ?? null) },
])
const historyLegend = [
  { key: 'total', label: '总份额 · 左轴', color: colors[0]! },
  { key: 'positive', label: '每日增加 · 右轴', color: colors[2]! },
  { key: 'negative', label: '每日减少 · 右轴', color: colors[1]! },
]
function totalTooltip(index: number): TooltipRow[] {
  const point = model.points[index]!
  return [...model.funds.map((f, i) => ({ label: f.short, value: number(point.parts[f.code]), color: colors[i] })),
    { label: '总份额（亿份）', value: number(point.total) }, { label: '每日增减（亿份）', value: signed(point.delta) }]
}
function rateTooltip(index: number): TooltipRow[] {
  return rates.filter(r => visibleRates.value.includes(r.key)).map(r => ({ label: r.label, value: percent(model.points[index]?.[r.key]), color: r.color }))
}
function historyTooltip(index: number): TooltipRow[] {
  const row = model.observation(historyDays.value[index]!, fund.value)
  return [{ label: '总份额（亿份）', value: number(row?.shares) },
    { label: '每日增减（亿份）', value: signed(model.interval(fund.value, index, 1)?.delta) },
    { label: '数据口径', value: row?.status ?? '缺失' }]
}
const shortcuts = [{ key: '1m', label: '近1月' }, { key: '3m', label: '近3月' }, { key: 'ytd', label: '全年' }] as const
</script>
<template>
  <main class="etf-dashboard">
    <header class="page-header">
      <div><div class="page-eyebrow">ETF MONITOR</div><h1>ETF总体份额与增减率</h1>
        <p>{{ model.dates[0] }}—{{ model.latest }} · {{ model.dates.length }}个交易日<span v-if="model.points.at(-1)?.total === null"> · 最新日期待齐/复核</span></p>
      </div>
      <div class="data-date" aria-live="polite"><span class="status-dot"></span>数据日期：{{ metrics?.day ?? '—' }}</div>
    </header>
    <template v-if="model.dates.length">
      <MetricCards :point="metrics" :amv-status="amvStatus" />
      <section class="panel" aria-labelledby="total-heading">
        <div class="panel-header"><h2 id="total-heading">总份额</h2><div class="range-presets" aria-label="时间范围">
          <button v-for="shortcut in shortcuts" :key="shortcut.key" type="button" :aria-pressed="preset === shortcut.key" @click="setPreset(shortcut.key)">{{ shortcut.label }}</button>
        </div></div>
        <TimeChart :dates="model.dates" :series="stack" :range="range" :selected-day="selectedDay" stacked pannable :height="310" label="8只ETF每日总份额堆叠面积图" unit="总份额（亿份）" :tooltip="totalTooltip" @select="selectedDay = $event" @pan="setRange" />
        <ChartLegend :items="stack" />
      </section>
      <section class="panel" aria-labelledby="rate-heading">
        <div class="panel-header"><h2 id="rate-heading">增减率</h2></div>
        <TimeChart :dates="model.dates" :series="rateSeries" :range="range" :selected-day="selectedDay" pannable zero :height="270" label="总份额单日增减率及5日、20日均线" unit="份额增减率（%）" :tooltip="rateTooltip" @select="selectedDay = $event" @pan="setRange" />
        <ChartLegend :items="[...rates]" :active="visibleRates" @toggle="toggleRate($event as RateKey)" />
      </section>
      <section class="panel navigator-panel" aria-labelledby="range-heading">
        <div class="panel-header"><h2 id="range-heading">时间范围</h2><span class="range-caption" aria-live="polite">{{ visiblePoints[0]?.day }}—{{ visiblePoints.at(-1)?.day }} · {{ visiblePoints.length }}个交易日</span></div>
        <TimeNavigator :points="model.points" :range="range" @change="setRange" />
      </section>
      <section class="panel detail-panel" aria-labelledby="detail-heading">
        <div class="panel-header">
          <button id="detail-heading" type="button" class="details-toggle" :aria-expanded="detailsOpen" aria-controls="fund-details-content" @click="detailsOpen = !detailsOpen">
            <span class="disclosure" :class="{ open: detailsOpen }">›</span>单只ETF与区间对比<span class="detail-date"> · {{ detailDay }}</span>
          </button>
          <select v-model="period" aria-label="比较区间"><option :value="1">单日</option><option :value="5">5交易日</option><option :value="20">20交易日</option></select>
        </div>
        <div v-if="detailsOpen" id="fund-details-content" class="detail-content">
          <FundComparison :values="comparisons" :day="detailDay" @select="fund = $event" />
          <ChartLegend :items="[{ key: 'up', label: '份额增加', color: colors[0]! }, { key: 'down', label: '份额减少', color: colors[1]! }]" />
          <div class="history-header"><h3>{{ selectedFund.name }}</h3><label>历史走势<select v-model="fund" aria-label="历史走势ETF"><option v-for="f in model.funds" :key="f.code" :value="f.code">{{ f.name }} {{ f.code }}</option></select></label></div>
          <TimeChart :dates="historyDays" :series="history" :range="[0, Math.max(0, historyDays.length-1)]" :height="320" :label="selectedFund.name + '总份额与每日增减'" unit="总份额（亿份）" secondary-unit="每日增减（亿份）" :tooltip="historyTooltip" />
          <ChartLegend :items="historyLegend" />
        </div>
      </section>
    </template>
    <div v-else class="panel" role="status">尚无份额记录，请先运行数据采集。</div>
    <footer class="page-footer"><span>采集：{{ (data.fetched ?? data.generated).slice(0, 16).replace('T', ' ') }} 北京时间</span><span>来源：<a href="https://www.sse.com.cn/market/funddata/volumn/etfvolumn/" target="_blank" rel="noreferrer">上交所</a> · <a href="https://www.szse.cn/market/fund/volume/etf/index.html" target="_blank" rel="noreferrer">深交所</a> · 指南针0AMV</span></footer>
  </main>
</template>
