<template>
    <v-card outlined class="input-shaper-tool-card d-flex flex-column fill-height">
        <v-card-title class="py-2 text-subtitle-1">
            <v-icon left small>{{ target.toolNumber !== null ? mdiPrinter3dNozzle : mdiPrinter3d }}</v-icon>
            {{ target.label }}
            <v-chip v-if="isActive" x-small color="primary" class="ml-2">{{ $t('InputShaper.Active') }}</v-chip>
            <v-spacer />
            <span v-if="target.accelChip" class="text-caption text--secondary">{{ target.accelChip }}</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pb-2 flex-grow-1">
            <table class="input-shaper-values mb-3">
                <tr v-for="axis in ['x', 'y']" :key="axis">
                    <th>{{ axis.toUpperCase() }}</th>
                    <td>{{ formatValue(values, `type_${axis}`) }}</td>
                    <td>{{ formatValue(values, `freq_${axis}`) }}</td>
                    <td class="text--secondary">ζ {{ formatValue(values, `damping_${axis}`) }}</td>
                </tr>
            </table>
            <div v-if="!hasValues" class="text-caption text--secondary mb-3">{{ $t('InputShaper.NoValues') }}</div>

            <input-shaper-progress v-if="runningRun && progress" :run="runningRun" :progress="progress" />

            <template v-else-if="latestRun">
                <v-row dense>
                    <v-col v-for="graph in latestGraphs" :key="graph.path" cols="6">
                        <input-shaper-graph :src="graph.src" :label="graph.label" :height="110" />
                    </v-col>
                </v-row>
                <div class="text-caption text--secondary mt-1">
                    {{ $t('InputShaper.LastRun', { date: formatDate(latestRun.startedAt) }) }}
                </div>
                <v-alert
                    v-if="latestRun.status === 'failed'"
                    dense
                    text
                    :type="latestRun.aborted ? 'info' : 'error'"
                    class="mt-2 mb-0 text-body-2">
                    {{ latestRun.error || $t('InputShaper.RunFailed') }}
                </v-alert>
                <v-alert v-else-if="restartPending" dense text type="success" class="mt-2 mb-0 text-body-2">
                    {{ $t('InputShaper.SavedPendingRestart', { file: latestRun.saved.file }) }}
                </v-alert>
                <v-alert v-else-if="hasNewRecommendation" dense text type="warning" class="mt-2 mb-0 text-body-2">
                    {{ $t('InputShaper.NewRecommendation') }}
                    <div v-for="(rec, axis) in latestRun.recommendations" :key="axis" class="font-weight-medium">
                        {{ axis.toUpperCase() }}: {{ rec.type.toUpperCase() }} @ {{ rec.freq.toFixed(1) }} Hz
                        <span v-if="rec.damping !== null">· ζ {{ rec.damping.toFixed(3) }}</span>
                        <div v-if="rec.lowVibrations" class="font-weight-regular text-caption">
                            {{
                                $t('InputShaper.LowVibrationsShort', {
                                    shaper: `${rec.lowVibrations.type.toUpperCase()} @ ${rec.lowVibrations.freq.toFixed(1)} Hz`,
                                })
                            }}
                        </div>
                    </div>
                </v-alert>
                <div
                    v-else-if="latestRun.saved || Object.keys(latestRun.recommendations).length"
                    class="text-caption success--text mt-2 d-flex align-center">
                    <v-icon x-small color="success" class="mr-1">{{ mdiCheck }}</v-icon>
                    {{ $t('InputShaper.MatchesConfig') }}
                </div>
            </template>
            <div v-else class="text-body-2 text--secondary">{{ $t('InputShaper.NoResults') }}</div>
        </v-card-text>
        <v-card-actions>
            <v-btn small text color="primary" :disabled="disabled" @click="$emit('calibrate', target)">
                <v-icon left small>{{ mdiPlay }}</v-icon>
                {{ $t('InputShaper.Calibrate') }}
            </v-btn>
            <v-spacer />
            <v-btn small text :disabled="!latestRun" @click="$emit('review', target)">
                {{ $t('InputShaper.Review') }}
                <v-icon right small>{{ mdiChevronRight }}</v-icon>
            </v-btn>
        </v-card-actions>
    </v-card>
</template>

<script lang="ts">
import { Component, Mixins, Prop } from 'vue-property-decorator'
import { mdiCheck, mdiChevronRight, mdiPlay, mdiPrinter3d, mdiPrinter3dNozzle } from '@mdi/js'
import InputShaperMixin from './inputShaperMixin'
import InputShaperGraph from './InputShaperGraph.vue'
import InputShaperProgress from './InputShaperProgress.vue'
import {
    recommendationToValues,
    resultAxis,
    RunProgress,
    ShakeTuneRun,
    ShaperTarget,
    ShaperValues,
    valuesDiffer,
} from './inputShaper'

@Component({
    components: { InputShaperGraph, InputShaperProgress },
})
export default class InputShaperToolCard extends Mixins(InputShaperMixin) {
    mdiCheck = mdiCheck
    mdiChevronRight = mdiChevronRight
    mdiPlay = mdiPlay
    mdiPrinter3d = mdiPrinter3d
    mdiPrinter3dNozzle = mdiPrinter3dNozzle

    @Prop({ type: Object, required: true }) declare readonly target: ShaperTarget
    @Prop({ type: Object, required: true }) declare readonly values: ShaperValues
    // runs of this target, newest first
    @Prop({ type: Array, required: true }) declare readonly runs: ShakeTuneRun[]
    @Prop({ type: Array, required: true }) declare readonly availableFiles: string[]
    @Prop({ type: Object, default: null }) declare readonly progress: RunProgress | null
    @Prop({ type: Boolean, default: false }) declare readonly isActive: boolean
    @Prop({ type: Boolean, default: false }) declare readonly disabled: boolean

    get hasValues() {
        return Object.keys(this.values).length > 0
    }

    get runningRun() {
        return this.runs.find((run) => run.status === 'running') ?? null
    }

    get latestRun() {
        return this.runs.find((run) => run.status !== 'running') ?? null
    }

    get latestGraphs() {
        if (!this.latestRun) return []

        return this.latestRun.files.map((path) => ({
            path,
            label: (resultAxis(path) ?? '').toUpperCase(),
            src: this.availableFiles.includes(path) ? this.fileUrl(path) : null,
        }))
    }

    // saved to the config file, but klipper still runs with the old values until a firmware restart
    get restartPending() {
        const saved = this.latestRun?.saved
        return !!saved && valuesDiffer(this.values, saved.values)
    }

    get hasNewRecommendation() {
        // whatever was saved from this run is what the user chose, even if it isn't the recommendation
        if (!this.latestRun || this.latestRun.saved) return false
        return valuesDiffer(this.values, recommendationToValues(this.latestRun.recommendations))
    }
}
</script>

<style scoped>
.input-shaper-values {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
}

.input-shaper-values th {
    text-align: left;
    padding-right: 12px;
    font-weight: 500;
}

.input-shaper-values td {
    padding-right: 12px;
}
</style>
