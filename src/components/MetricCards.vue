<script setup lang="ts">
import { computed } from 'vue'
import { colors, number, percent, signed } from '../domain/format'
import type { AmvCard, Point } from '../domain/types'
const props = defineProps<{ point?: Point; amv?: AmvCard; amvStatus?: string; latestAmvStatus?: string }>()
const amvValue = computed(() => props.amv?.latest?.changePercent ?? props.point?.amv)
function trend(value: number | null | undefined) {
  return value == null || value === 0 ? 'var(--text)' : value > 0 ? colors[0] : colors[1]
}
function activity(point?: Point) {
  if (point?.grossRate == null) return '待齐/复核'
  if (point.anomalyPercentile === null) return '历史不足60日'
  return point.grossRate > 0 && point.anomalyPercentile >= 95 ? '异常放量'
    : point.anomalyPercentile >= 80 ? '异动偏高' : '常态'
}
</script>
<template>
  <section class="metric-grid" aria-label="所选日监控指标" aria-live="polite">
    <div class="metric-card">
      <span>总份额</span>
      <strong>{{ number(point?.total) }}<small>亿份</small></strong>
      <p :style="{ color: trend(point?.delta) }">较前日{{ signed(point?.delta) }}亿份</p>
      <i :style="{ background: colors[0] }"></i>
    </div>
    <div class="metric-card">
      <span>单日增减率</span>
      <strong :style="{ color: trend(point?.rate) }">{{ percent(point?.rate) }}</strong>
      <p :style="{ color: trend(point?.rateChange) }">较前日{{ signed(point?.rateChange) }}个百分点</p>
      <i :style="{ background: colors[2] }"></i>
    </div>
    <div class="metric-card">
      <span>活跃市值·0AMV</span>
      <div class="amv-value">
        <strong :style="{ color: trend(amvValue) }">{{ percent(amvValue) }}</strong>
        <small v-if="amv?.latest" class="amv-close-date">{{ amv.latest.day }}收盘值</small>
      </div>
      <p v-if="amv?.latestTarget && amv.latest?.day !== amv.latestTarget" class="amv-note">{{ amv.latestTarget }}：{{ latestAmvStatus || '暂无当日数据' }}</p>
      <p v-else-if="amvValue == null">{{ amvStatus || '暂无当日数据' }}</p>
      <p v-if="amv?.trigger" class="amv-signal" :class="amv.trigger.type === 'daily-decline' ? 'amv-signal-short' : 'amv-signal-long'">
        <b class="amv-signal-label">{{ amv.trigger.type === 'daily-decline' ? '空：' : '多：' }}</b>
        <span>{{ amv.trigger.day }}{{ amv.trigger.type === 'daily-decline' ? '单日跌破−2.3%' : amv.trigger.type === 'daily-rise' ? '单日涨超4%' : '连续两日涨超4%' }}<template v-if="amv.trigger.type === 'daily-decline'"> · {{ percent(amv.trigger.changePercent) }}</template></span>
      </p>
      <p v-else-if="amv" class="amv-note">截至{{ amv.cutoff }}的可用历史中暂无触发</p>
      <i :style="{ background: colors[3] }"></i>
    </div>
    <div class="metric-card" :class="{ 'metric-unusual': point?.grossRate != null && point.grossRate > 0 && point.anomalyPercentile != null && point.anomalyPercentile >= 95 }">
      <span title="各ETF单日份额增减绝对值合计÷前日总份额；与此前60个交易日比较">申赎异动</span>
      <div class="activity-value"><strong>{{ number(point?.grossRate) }}<small>%</small></strong><span class="activity-label">{{ activity(point) }}</span></div>
      <p>{{ point?.anomalyPercentile != null ? '近60日' + number(point.anomalyPercentile, 0) + '分位' : '份额变化强度' }}</p>
      <div v-if="point" class="breadth" :aria-label="`份额增加${point.breadth.up}只、减少${point.breadth.down}只、持平${point.breadth.unchanged}只、待齐或复核${point.breadth.missing}只`">
        <span :style="{ color: colors[0] }">{{ point.breadth.up }}/{{ point.breadth.total }}增加</span>
        <span :style="{ color: colors[1] }">{{ point.breadth.down }}/{{ point.breadth.total }}减少</span>
        <span v-if="point.breadth.unchanged">{{ point.breadth.unchanged }}持平</span>
        <span v-if="point.breadth.missing">{{ point.breadth.missing }}待齐/复核</span>
      </div>
      <i :style="{ background: colors[5] }"></i>
    </div>
  </section>
</template>
