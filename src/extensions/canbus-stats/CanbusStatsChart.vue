<!--
    CanbusStatsChart.vue — a single echarts time-line chart for one named-line dataset
    (e.g. one canbus device, one MCU chart, or one aggregated stat).
    Why: the canbus-stats page renders many of these; each draws whatever `series` the
    parent passes, on one or two y-axes (axis: 'left' | 'right' per line).

    Design note: the series data lives INSIDE the `chartOptions` getter (same pattern as
    components/charts/TempChart.vue). vue-echarts re-applies the option with
    notMerge whenever the option reference changes, so the option object must always
    carry the full, consistent state — mixing an `:option` binding with a separate
    manual `setOption({ series })` would let the notMerge path wipe the lines.
-->
<template>
    <e-chart
        ref="chart"
        v-observe-visibility="visibilityChanged"
        :option="chartOptions"
        :autoresize="true"
        :init-options="{ renderer: 'svg' }"
        class="w-100"
        :style="{ height: `${height}px` }" />
</template>

<script lang="ts">
import Component from 'vue-class-component'
import { Mixins, Prop, Ref } from 'vue-property-decorator'
import BaseMixin from '@/components/mixins/base'
import ThemeMixin from '@/components/mixins/theme'
import type { ECBasicOption } from 'echarts/types/dist/shared.d'
import type { EChartRef } from '@/types/echarts'
import type { Point } from './buckets'

// one named line inside a chart
export interface CanbusChartSeries {
    name: string
    color: string
    data: Point[]
    // right y-axis for dual-axis charts (performance chart, host chart)
    axis?: 'left' | 'right'
}

@Component
export default class CanbusStatsChart extends Mixins(BaseMixin, ThemeMixin) {
    // named line datasets to draw
    @Prop({ type: Array as () => CanbusChartSeries[], required: true }) declare readonly series: CanbusChartSeries[]
    @Prop({ default: '' }) declare readonly yLabel: string
    // optional second (right) y-axis label — enables the dual-axis layout
    @Prop({ default: null }) declare readonly yLabel2: string | null
    @Prop({ default: null }) declare readonly yMax: number | null
    @Prop({ type: Number, default: 220 }) declare readonly height: number

    @Ref('chart') readonly chart!: EChartRef | undefined

    // echarts series entries mapped from the incoming named datasets
    get mappedSeries() {
        return this.series.map((s) => ({
            name: s.name,
            type: 'line' as const,
            showSymbol: false,
            sampling: 'lttb' as const,
            lineStyle: { color: s.color, width: 1.5 },
            itemStyle: { color: s.color },
            yAxisIndex: s.axis === 'right' ? 1 : 0,
            data: s.data.map((p) => [p.x, p.y] as [number, number]),
        }))
    }

    // full option; a new reference on every evaluation, which is what makes
    // vue-echarts re-apply it (see component doc)
    get chartOptions(): ECBasicOption {
        return {
            animation: false,
            grid: {
                top: 10,
                right: this.yLabel2 ? 10 : 0,
                bottom: 0,
                left: 10,
                containLabel: true,
            },
            tooltip: {
                trigger: 'axis',
                borderWidth: 0,
            },
            xAxis: {
                type: 'time',
                axisLabel: {
                    color: this.fgColorHi,
                    hideOverlap: true,
                    // same convention as TempChart.vue: 12h/24h follows the UI setting
                    formatter: this.hours12Format ? '{hh}:{mm}' : '{HH}:{mm}',
                },
            },
            yAxis: [
                {
                    type: 'value',
                    name: this.yLabel,
                    nameTextStyle: { color: this.fgColorHi },
                    axisLabel: { color: this.fgColorHi },
                    max: this.yMax,
                    splitLine: { lineStyle: { color: this.fgColorFaint } },
                },
                ...(this.yLabel2
                    ? [
                          {
                              type: 'value',
                              name: this.yLabel2,
                              nameTextStyle: { color: this.fgColorHi },
                              axisLabel: { color: this.fgColorHi },
                              splitLine: { show: false },
                          },
                      ]
                    : []),
            ],
            series: this.mappedSeries,
        }
    }

    beforeDestroy(): void {
        this.chart?.dispose()
    }

    visibilityChanged(visible: boolean): void {
        if (visible) this.chart?.resize()
    }
}
</script>