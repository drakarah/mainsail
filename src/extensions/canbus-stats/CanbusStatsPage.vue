<template>
    <div>
        <panel :title="$t('CanbusStats.Title')" :icon="mdiCableData" card-class="pb-2">
             <v-card-text>
            <v-row align="center" no-gutters>
                <v-col cols="12" sm="8">
                    <p class="body-2 text-primary--text mb-0">{{ $t('CanbusStats.Description') }}</p>
                </v-col>
                <v-col cols="12" sm="4" class="text-right">
                    <!-- <v-chip v-if="present" small color="success" class="mr-2">
                        <v-icon small left> {{ mdiCheck }} </v-icon>
                        {{ $t('CanbusStats.Live') }}
                    </v-chip> -->
                    <v-btn x-small color="warning" text @click="clearData">
                        <v-icon small left> {{ mdiDelete }} </v-icon>
                        {{ $t('CanbusStats.ClearData') }}
                    </v-btn>
                </v-col>
            </v-row>
            </v-card-text>
        </panel>

        <v-alert v-if="present && !hasAnyData" type="info" text class="mt-0">
            {{ $t('CanbusStats.NoDataYet') }}
        </v-alert>

        <panel  :icon="mdiChartLine" :title="$t('CanbusStats.ByMCUPanelTitle')" :collapsible="true" card-class="pb-2">
              <!-- CAN bus -->
            <template v-if="canbusDevices.length > 0">
            <div class="subheading pa-3">{{ $t('CanbusStats.CanbusSection') }}</div>
            <v-row>
                <v-col v-for="(dev, i) in canbusDevices" :key="dev" cols="12" md="3">
                    <panel
                        :title="stripName(dev)"
                        :icon="mdiCableData"
                        card-class="pb-2"
                        collapsible
                        :margin-bottom="i < canbusDevices.length - 1">
                        <canbus-stats-chart :series="seriesFor(dev, canbusDefs, ['left', 'left', 'left'])" :y-label="''" />
                        <div class="chips">
                            <v-chip
                                v-for="def in canbusDefs"
                                :key="def.key"
                                small
                                outlined
                                class="mt-2 mr-2 mb-2">
                                <v-tooltip bottom>
                                    <template #activator="{ on }">
                                        <span v-on="on">
                                            {{ $t(def.labelKey) }}:
                                            <b>{{ latestFor(dev, def.key) }}</b>
                                        </span>
                                    </template>
                                    {{ $t(def.tooltipKey) }}
                                </v-tooltip>
                            </v-chip>
                        </div>
                    </panel>
                </v-col>
            </v-row>
        </template>

        <!-- MCU -->
        <template v-if="mcuDevices.length > 0">
            <div class="subheading pa-3">{{ $t('CanbusStats.McuSection') }}</div>
            <v-row>
                <v-col v-for="dev in mcuDevices" :key="dev" cols="6">
                    <panel :title="stripName(dev)" :icon="mdiChip" card-class="pb-2" collapsible>
                        <v-row>
                            <v-col cols="12" md="4">
                                <div class="caption pa-1">{{ $t('CanbusStats.ErrorsChart') }}</div>
                                <canbus-stats-chart :series="seriesFor(dev, [errorDef, invalidDef], ['left', 'left'])" :y-label="'bytes'" />
                            </v-col>
                            <v-col cols="12" md="4">
                                <div class="caption pa-1">{{ $t('CanbusStats.TrafficChart') }}</div>
                                <canbus-stats-chart :series="seriesFor(dev, [writeDef, readDef], ['left', 'left'])" :y-label="'bytes'" />
                            </v-col>
                            <!-- <v-col cols="12" md="3">
                                <div class="caption pa-1">{{ $t('CanbusStats.PerfChart') }}</div>
                                <canbus-stats-chart
                                    :series="seriesFor(dev, [awakeDef, taskAvgDef, taskStdDef], ['left', 'right', 'right'])"
                                    :y-label="'%'"
                                    :y-label-2="'µs'"
                                    :y-max="100" />
                            </v-col> -->
                            <v-col cols="12" md="4">
                                <div class="caption pa-1">{{ $t('CanbusStats.LatencyChart') }}</div>
                                <canbus-stats-chart :series="seriesFor(dev, [srttDef, rtoDef], ['left', 'left'])" :y-label="'ms'" />
                            </v-col>
                        </v-row>
                        <div class="chips">
                            <v-chip
                                v-for="def in mcuDefs"
                                :key="def.key"
                                small
                                outlined
                                class="mt-2 mr-2 mb-2">
                                <v-tooltip bottom>
                                    <template #activator="{ on }">
                                        <span v-on="on">
                                            {{ $t(def.labelKey) }}:
                                            <b>{{ latestFor(dev, def.key) }}</b>&nbsp;
                                            <span class="text--secondary">{{ $t(def.yLabelKey) }}</span>
                                        </span>
                                    </template>
                                    {{ $t(def.tooltipKey) }}
                                </v-tooltip>
                            </v-chip>
                        </div>
                    </panel>
                </v-col>
            </v-row>
        </template>

        <!-- Host -->
        <template v-if="hasHostData">
            <div class="subheading pa-3">{{ $t('CanbusStats.HostSection') }}</div>
            <panel :title="$t('CanbusStats.HostPanelTitle')" :icon="mdiMonitor" card-class="pb-2" :margin-bottom="false">
                <canbus-stats-chart :series="hostSeries" :y-label="''" :y-label-2="'MiB'" />
            </panel>
        </template>

    </panel>


    <panel  :title="$t('CanbusStats.ByStatPanelTitle')"
            :icon="mdiChartLine"
            card-class="canbus-stats-by-stat-panel" :collapsible="true">
        <!-- By stat -->
        <template v-if="statDevices.length > 0">
            <!-- <div class="subheading pa-3">{{ $t('CanbusStats.ByStatSection') }}</div>
            <panel :title="$t('CanbusStats.ByStatPanelTitle')" card-class="pb-2" :margin-bottom="false"> -->
                <v-row>
                    <v-col v-for="def in allStatDefs" :key="def.key" cols="12" md="3">
                        <div class="caption pa-1">{{ $t(def.labelKey) }}</div>
                        <canbus-stats-chart :series="byStatSeries(def)" :y-label="$t(def.yLabelKey)" />
                    </v-col>
                </v-row>
            <!-- </panel> -->
        </template>

        <!-- Context -->
        <template v-if="contextKeys.length > 0">
            <!-- <div class="subheading pa-3">{{ $t('CanbusStats.ContextSection') }}</div> -->
            <!-- <panel :title="$t('CanbusStats.ContextPanelTitle')" card-class="pb-2" :margin-bottom="false"> -->
                <v-row>
                    <v-col v-if="sensorKeys.length > 0" cols="12" md="6">
                        <div class="caption pa-1">{{ $t('CanbusStats.TempChart') }}</div>
                        <canbus-stats-chart :series="sensorSeries" :y-label="'°C'" />
                    </v-col>
                    <v-col v-if="heaterKeys.length > 0" cols="12" md="6">
                        <div class="caption pa-1">{{ $t('CanbusStats.HeaterChart') }}</div>
                        <canbus-stats-chart :series="heaterSeries" :y-label="''" :y-max="1" />
                    </v-col>
                </v-row>
            <!-- </panel> -->
        </template>
        <!-- Local snack notification (Mainsail has no global snack bus) -->
        <v-snackbar v-model="snackbar" :timeout="3000" bottom>
            {{ snackText }}
        </v-snackbar>
    </panel>        

    </div>
</template>

<script lang="ts">
import Component from 'vue-class-component'
import { Mixins } from 'vue-property-decorator'
import BaseMixin from '@/components/mixins/base'
import { mdiChartLine, mdiCableData, mdiBus, mdiCheck, mdiChip, mdiDelete, mdiMonitor } from '@mdi/js'
import CanbusStatsChart from './CanbusStatsChart.vue'
import { CANBUS_STAT_DEFS, DEVICE_PALETTE, HOST_STAT_DEFS, MCU_STAT_DEFS, type Point, type StatDef } from './buckets'
import { getBuffers, getCanbusRevision, hasCanbusStats, resetBuffers, STORAGE_KEY } from './store'

@Component({
    components: { CanbusStatsChart },
})
export default class CanbusStatsPage extends Mixins(BaseMixin) {
    mdiChartLine = mdiChartLine
    mdiCheck = mdiCheck
    mdiChip = mdiChip
    mdiDelete = mdiDelete
    mdiMonitor = mdiMonitor
    mdiCableData = mdiCableData

    snackbar = false
    snackText = ''

    canbusDefs: StatDef[] = CANBUS_STAT_DEFS
    mcuDefs: StatDef[] = MCU_STAT_DEFS
    allStatDefs: StatDef[] = [...CANBUS_STAT_DEFS, ...MCU_STAT_DEFS]

    // individual stat defs referenced by the per-MCU chart grid
    errorDef: StatDef = MCU_STAT_DEFS[0] // bytes_retransmit
    invalidDef: StatDef = MCU_STAT_DEFS[1] // bytes_invalid
    writeDef: StatDef = MCU_STAT_DEFS[3] // bytes_write
    readDef: StatDef = MCU_STAT_DEFS[4] // bytes_read
    awakeDef: StatDef = MCU_STAT_DEFS[5] // mcu_awake
    taskAvgDef: StatDef = MCU_STAT_DEFS[6] // mcu_task_avg
    taskStdDef: StatDef = MCU_STAT_DEFS[7] // mcu_task_stddev
    srttDef: StatDef = MCU_STAT_DEFS[8] // srtt
    rtoDef: StatDef = MCU_STAT_DEFS[9] // rto

    /**
     * Reactive handle on the canbusStats revision — forces re-reads of the
     * (deliberately non-reactive) buffers below.
     */
    get revision(): number {
        return getCanbusRevision(this.$store)
    }

    get present(): boolean {
        return hasCanbusStats(this.$store)
    }

    /**
     * Raw buffer snapshot.
     * @pre revision getter accessed somewhere in the same render pass (it is).
     */
    get buffers() {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        this.revision // dependency
        return getBuffers()
    }

    get canbusDevices(): string[] {
        return Object.keys(this.buffers).filter((k) => k.startsWith('canbus_stats'))
    }

    get mcuDevices(): string[] {
        return Object.keys(this.buffers).filter((k) => k.startsWith('mcu'))
    }

    get statDevices(): string[] {
        return Object.keys(this.buffers).filter((k) => k.startsWith('mcu') || k.startsWith('canbus_stats'))
    }

    get sensorKeys(): string[] {
        return Object.keys(this.buffers).filter((k) => k.startsWith('temperature_sensor'))
    }

    get heaterKeys(): string[] {
        return Object.keys(this.buffers).filter((k) => k === 'extruder' || /^extruder\d+$/.test(k) || k === 'heater_bed')
    }

    get contextKeys(): string[] {
        return [...this.sensorKeys, ...this.heaterKeys]
    }

    get hasAnyData(): boolean {
        const b = this.buffers
        return Object.keys(b).some((dev) => Object.values(b[dev]).some((s) => s.length > 0))
    }

    get hasHostData(): boolean {
        return (this.buffers['system_stats']?.sysload?.length ?? 0) > 0 || (this.buffers['system_stats']?.mem_avail?.length ?? 0) > 0
    }

    get hostSeries(): { name: string; color: string; data: Point[]; axis?: 'left' | 'right' }[] {
        const b = this.buffers['system_stats'] ?? {}
        const out: { name: string; color: string; data: Point[]; axis?: 'left' | 'right' }[] = []
        for (const def of HOST_STAT_DEFS) {
            const data = b[def.key]
            if (data && data.length > 0) {
                out.push({ name: this.$t(def.labelKey), color: def.color, data, axis: def.key === 'mem_avail' ? 'right' : 'left' })
            }
        }

        return out
    }

    get sensorSeries(): { name: string; color: string; data: Point[] }[] {
        const b = this.buffers

        return this.sensorKeys
            .map((key, i) => {
                const data = b[key]?.temperature
                return data && data.length > 0
                    ? { name: key.replace('temperature_sensor', '').trim(), color: DEVICE_PALETTE[i % DEVICE_PALETTE.length], data }
                    : null
            })
            .filter((s): s is { name: string; color: string; data: Point[] } => s !== null)
    }

    get heaterSeries(): { name: string; color: string; data: Point[] }[] {
        const b = this.buffers

        return this.heaterKeys
            .map((key, i) => {
                const data = b[key]?.power
                return data && data.length > 0
                    ? { name: key, color: DEVICE_PALETTE[i % DEVICE_PALETTE.length], data }
                    : null
            })
            .filter((s): s is { name: string; color: string; data: Point[] } => s !== null)
    }

    /**
     * Build chart series for one device from the given stat defs.
     * @returns one series per def that has data; missing stats are skipped.
     */
    seriesFor(
        dev: string,
        defs: StatDef[],
        axes: ('left' | 'right')[]
    ): { name: string; color: string; data: Point[]; axis?: 'left' | 'right' }[] {
        const perStat = this.buffers[dev] ?? {}

        return defs
            .map((def, i) => {
                const data = perStat[def.key]
                return data && data.length > 0 ? { name: this.$t(def.labelKey), color: def.color, data, axis: axes[i] } : null
            })
            .filter((s): s is { name: string; color: string; data: Point[]; axis?: 'left' | 'right' } => s !== null)
    }

    /**
     * Build the "by stat" chart series: one dataset per device carrying that stat.
     */
    byStatSeries(def: StatDef): { name: string; color: string; data: Point[] }[] {
        const b = this.buffers

        return this.statDevices
            .map((dev, i) => {
                const data = b[dev]?.[def.key]
                if (!data || data.length === 0) return null
                // 'mcu x' -> 'x'; the default bus ('canbus_stats') and a plain 'mcu'
                // would strip to an empty name, so fall back to a readable label
                const stripped = dev.replace(/^(canbus_stats|mcu)/, '').trim()
                const name =
                    stripped === '' ? (dev === 'canbus_stats' ? this.$t('CanbusStats.BusName') : dev) : stripped
                return { name, color: DEVICE_PALETTE[i % DEVICE_PALETTE.length], data }
            })
            .filter((s): s is { name: string; color: string; data: Point[] } => s !== null)
    }

    stripName(dev: string): string {
        const name = dev.replace(/^(canbus_stats|mcu)/, '').trim()
        return name === '' ? "main" : name
    }

    /**
     * Format the latest value of a device/stat pair for the stat chips.
     */
    latestFor(dev: string, statKey: string): string {
        const data = this.buffers[dev]?.[statKey]
        if (!data || data.length === 0) return '—'

        const v = data[data.length - 1].y
        const def = this.canbusDefs.find((d) => d.key === statKey) ?? this.mcuDefs.find((d) => d.key === statKey)

        if (def?.yLabelKey === 'CanbusStats.Units.Bytes') {
            return this.formatBytes(v)
        }

        if (Number.isInteger(v)) return v.toString()

        return v.toFixed(1)
    }

    /**
     * Human-readable byte formatting for chips.
     */
    formatBytes(v: number): string {
        if (v >= 1e6) return (v / 1e6).toFixed(2) + ' ' + this.$t('CanbusStats.Units.Megabytes')

        if (v >= 1e3) return (v / 1e3).toFixed(1) + ' ' + this.$t('CanbusStats.Units.Kilobytes')

        return Math.round(v).toString() + ' ' + this.$t('CanbusStats.Units.B')
    }

    /**
     * Wipe all recorded history (memory + localStorage) and refresh the charts.
     */
    clearData(): void {
        resetBuffers()
        try {
            if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY)
        } catch (e) {
            // storage access can be blocked (private mode); in-memory buffers are already reset
            window.console.error('canbus stats: could not clear stored history', e)
        }
        this.$store.commit('canbusStats/bumpRevision', undefined, { root: true })
        this.snackText = this.$t('CanbusStats.DataCleared')
        this.snackbar = true
    }
}
</script>