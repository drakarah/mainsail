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
import { Mixins, Prop, Ref, Watch } from 'vue-property-decorator'
import BaseMixin from '@/components/mixins/base'
import ThemeMixin from '@/components/mixins/theme'
import type { ECBasicOption } from 'echarts/types/dist/shared.d'
import type { EChartRef } from '@/types/echarts'
import type { Point } from './buckets'
import { getCanbusRevision } from './store'

// one named line inside a chart
export interface CanbusChartSeries {
    name: string
    color: string
    data: Point[]
    // right y-axis for dual-axis charts (performance chart, host chart)
    axis?: 'left' | 'right'
}

const CHART_UPDATE_MS = 2_000

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

    private updateTimer: number | null = null

    // vuex revision of the canbusStats module — the reactive trigger for chart updates
    get revision(): number {
        return getCanbusRevision(this.$store)
    }

    // base option (axes/grid/tooltip); series are applied on demand via setOption
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
                    formatter: (value: number) => {
                        const d = new Date(value)
                        const p = (n: number) => n.toString().padStart(2, '0')
                        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
                    },
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
            series: [],
        }
    }

    mounted(): void {
        this.updateChart()
    }

    // the buffers grow on every status update; refresh the chart at most once per bucket
    @Watch('revision')
    onRevision(): void {
        if (this.updateTimer !== null) return

        this.updateTimer = window.setTimeout(() => {
            this.updateTimer = null
            this.updateChart()
        }, CHART_UPDATE_MS)
    }

    beforeDestroy(): void {
        if (this.updateTimer !== null) {
            window.clearTimeout(this.updateTimer)
            this.updateTimer = null
        }
        this.chart?.dispose()
    }

    visibilityChanged(visible: boolean): void {
        if (visible) this.chart?.resize()
    }

    private updateChart(): void {
        const echarts = this.chart?.chart
        if (!echarts) return

        const mapped = this.series.map((s) => ({
            name: s.name,
            type: 'line' as const,
            showSymbol: false,
            sampling: 'lttb' as const,
            lineStyle: { color: s.color, width: 1.5 },
            itemStyle: { color: s.color },
            yAxisIndex: s.axis === 'right' ? 1 : 0,
            data: s.data.map((p) => [p.x, p.y] as [number, number]),
        }))

        echarts.setOption({ series: mapped }, false, true)
    }
}
</script>