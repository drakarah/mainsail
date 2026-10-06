<template>
    <v-dialog
        :value="value"
        max-width="1200"
        :fullscreen="$vuetify.breakpoint.smAndDown"
        scrollable
        @input="$emit('input', $event)">
        <v-card v-if="run">
            <v-toolbar flat dense class="flex-grow-0">
                <v-toolbar-title class="text-subtitle-1">
                    {{ $t('InputShaper.ReviewTitle', { name: target.label }) }}
                </v-toolbar-title>
                <v-spacer />
                <v-btn icon :disabled="index >= runs.length - 1" @click="showRun(index + 1)">
                    <v-icon>{{ mdiChevronLeft }}</v-icon>
                </v-btn>
                <span class="text-body-2 mx-1">{{ formatDate(run.startedAt) }}</span>
                <v-btn icon :disabled="index <= 0" @click="showRun(index - 1)">
                    <v-icon>{{ mdiChevronRight }}</v-icon>
                </v-btn>
                <v-btn icon class="ml-2" @click="$emit('input', false)">
                    <v-icon>{{ mdiCloseThick }}</v-icon>
                </v-btn>
            </v-toolbar>
            <v-divider />
            <v-card-text class="pt-4">
                <v-row>
                    <v-col v-for="graph in graphs" :key="graph.path" cols="12" md="6">
                        <input-shaper-graph :src="graph.src" :label="graph.label" :height="320" />
                    </v-col>
                </v-row>

                <v-alert v-if="run.status === 'failed'" type="error" dense text class="mt-4">
                    {{ run.error || $t('InputShaper.RunFailed') }}
                </v-alert>
                <v-alert v-else-if="!hasRecommendation" type="info" dense text class="mt-4">
                    {{ $t('InputShaper.NoRecommendationRecorded') }}
                </v-alert>

                <v-simple-table dense class="mt-4 input-shaper-compare">
                    <thead>
                        <tr>
                            <th />
                            <th>{{ $t('InputShaper.Current') }}</th>
                            <th>{{ $t('InputShaper.Recommended') }}</th>
                            <th class="input-shaper-compare__new">{{ $t('InputShaper.NewValue') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in rows" :key="row.key">
                            <th>{{ row.label }}</th>
                            <td>{{ formatValue(values, row.key) }}</td>
                            <td>
                                {{ formatValue(recommended, row.key) }}
                                <span
                                    v-if="row.delta"
                                    :class="row.delta.startsWith('+') ? 'warning--text' : 'info--text'">
                                    ({{ row.delta }})
                                </span>
                            </td>
                            <td class="input-shaper-compare__new">
                                <v-select
                                    v-if="row.key.startsWith('type')"
                                    v-model="edit[row.key]"
                                    :items="shaperTypeItems"
                                    dense
                                    hide-details
                                    class="mt-0 pt-0" />
                                <v-text-field
                                    v-else
                                    v-model.number="edit[row.key]"
                                    type="number"
                                    :step="row.key.startsWith('freq') ? 0.1 : 0.001"
                                    :suffix="row.key.startsWith('freq') ? 'Hz' : ''"
                                    dense
                                    hide-details
                                    class="mt-0 pt-0" />
                            </td>
                        </tr>
                    </tbody>
                </v-simple-table>

                <div
                    v-for="alt in lowVibrationAlternatives"
                    :key="alt.axis"
                    class="d-flex align-center text-body-2 text--secondary mt-2">
                    {{
                        $t('InputShaper.LowVibrationsAlternative', {
                            axis: alt.axis.toUpperCase(),
                            shaper: `${alt.type.toUpperCase()} @ ${alt.freq.toFixed(1)} Hz`,
                        })
                    }}
                    <v-btn x-small text color="primary" class="ml-2" @click="useLowVibrations(alt)">
                        {{ $t('InputShaper.Use') }}
                    </v-btn>
                </div>

                <v-expansion-panels v-if="run.log.length" flat class="mt-4">
                    <v-expansion-panel>
                        <v-expansion-panel-header class="px-0">
                            {{ $t('InputShaper.ConsoleOutput') }}
                        </v-expansion-panel-header>
                        <v-expansion-panel-content>
                            <pre class="input-shaper-log">{{ run.log.join('\n') }}</pre>
                        </v-expansion-panel-content>
                    </v-expansion-panel>
                </v-expansion-panels>
            </v-card-text>
            <v-divider />
            <v-card-actions class="flex-wrap">
                <v-btn v-if="!confirmDelete" text small color="error" @click="confirmDelete = true">
                    <v-icon left small>{{ mdiDelete }}</v-icon>
                    {{ $t('InputShaper.DeleteRun') }}
                </v-btn>
                <v-btn v-else text small color="error" @click="deleteRun">
                    {{ $t('InputShaper.DeleteRunConfirm') }}
                </v-btn>
                <v-spacer />
                <v-tooltip top :disabled="canTry">
                    <template #activator="{ on }">
                        <div v-on="on">
                            <v-btn text :disabled="!canTry || busy" @click="tryNow">
                                <v-icon left small>{{ mdiFlask }}</v-icon>
                                {{ $t('InputShaper.TryNow') }}
                            </v-btn>
                        </div>
                    </template>
                    <span>{{ $t('InputShaper.TryNowOnlyActive', { name: target.label }) }}</span>
                </v-tooltip>
                <v-btn text color="primary" :disabled="!editComplete" @click="saveDialog = true">
                    <v-icon left small>{{ mdiContentSave }}</v-icon>
                    {{ $t('InputShaper.SaveToConfig') }}
                </v-btn>
            </v-card-actions>
        </v-card>
        <input-shaper-save-dialog v-model="saveDialog" :target="target" :values="edit" @saved="onSaved" />
    </v-dialog>
</template>

<script lang="ts">
import { Component, Mixins, Prop, Watch } from 'vue-property-decorator'
import { mdiChevronLeft, mdiChevronRight, mdiCloseThick, mdiContentSave, mdiDelete, mdiFlask } from '@mdi/js'
import InputShaperMixin from './inputShaperMixin'
import InputShaperGraph from './InputShaperGraph.vue'
import InputShaperSaveDialog from './InputShaperSaveDialog.vue'
import {
    recommendationToValues,
    resultAxis,
    ShakeTuneRun,
    shaperKeys,
    ShaperKey,
    shaperValuesValid,
    ShaperTarget,
    shaperTypes,
    ShaperValues,
} from './inputShaper'

@Component({
    components: { InputShaperGraph, InputShaperSaveDialog },
})
export default class InputShaperResultDialog extends Mixins(InputShaperMixin) {
    mdiChevronLeft = mdiChevronLeft
    mdiChevronRight = mdiChevronRight
    mdiCloseThick = mdiCloseThick
    mdiContentSave = mdiContentSave
    mdiDelete = mdiDelete
    mdiFlask = mdiFlask

    @Prop({ type: Boolean, default: false }) declare readonly value: boolean
    @Prop({ type: Object, required: true }) declare readonly target: ShaperTarget
    // finished runs of this target, newest first
    @Prop({ type: Array, required: true }) declare readonly runs: ShakeTuneRun[]
    @Prop({ type: Object, required: true }) declare readonly values: ShaperValues
    @Prop({ type: Array, required: true }) declare readonly availableFiles: string[]
    @Prop({ type: Boolean, default: false }) declare readonly isActive: boolean
    // printing or calibrating: no SET_INPUT_SHAPER in between
    @Prop({ type: Boolean, default: false }) declare readonly busy: boolean

    // by id: a run finishing while the dialog is open is inserted in front and moves the others
    runId: string | null = null
    edit: ShaperValues = {}
    saveDialog = false
    confirmDelete = false

    shaperTypeItems = shaperTypes.map((type) => ({ text: type.toUpperCase(), value: type }))

    get index() {
        return Math.max(
            0,
            this.runs.findIndex((run) => run.id === this.runId)
        )
    }

    get run(): ShakeTuneRun | null {
        return this.runs[this.index] ?? null
    }

    showRun(index: number) {
        this.runId = this.runs[index]?.id ?? null
    }

    get graphs() {
        return (this.run?.files ?? []).map((path) => ({
            path,
            label: this.$t('InputShaper.AxisGraph', { axis: (resultAxis(path) ?? '').toUpperCase() }).toString(),
            src: this.availableFiles.includes(path) ? this.fileUrl(path) : null,
        }))
    }

    get recommended(): ShaperValues {
        return recommendationToValues(this.run?.recommendations ?? {})
    }

    get hasRecommendation() {
        return Object.keys(this.recommended).length > 0
    }

    get rows() {
        return shaperKeys.map((key) => {
            const [kind, axis] = key.split('_')
            let delta = ''
            const current = this.values[key]
            const recommended = this.recommended[key]
            if (kind === 'freq' && typeof current === 'number' && typeof recommended === 'number') {
                const diff = recommended - current
                if (Math.abs(diff) >= 0.05) delta = `${diff > 0 ? '+' : ''}${diff.toFixed(1)}`
            }

            return { key, delta, label: this.$t(`InputShaper.Row.${kind}`, { axis: axis.toUpperCase() }) }
        })
    }

    get editComplete() {
        return shaperValuesValid(this.edit)
    }

    get canTry() {
        return this.target.toolNumber === null || this.isActive
    }

    @Watch('value', { immediate: true })
    onOpen(open: boolean) {
        if (!open) return
        this.showRun(0)
        this.resetEdit()
    }

    @Watch('run.id')
    resetEdit() {
        this.confirmDelete = false
        this.edit = { ...this.values, ...this.recommended }
    }

    @Watch('runs')
    onRunsChanged() {
        // e.g. the last run was deleted
        if (!this.runs.length) this.$emit('input', false)
        else if (!this.runs.some((run) => run.id === this.runId)) this.showRun(0)
    }

    // Shake&Tune's alternative when the best shaper for low vibrations differs from the one for performance
    get lowVibrationAlternatives() {
        return (['x', 'y'] as const).flatMap((axis) => {
            const alt = this.run?.recommendations[axis]?.lowVibrations
            return alt ? [{ axis, ...alt }] : []
        })
    }

    useLowVibrations(alt: { axis: 'x' | 'y'; type: string; freq: number; damping: number | null }) {
        const edit = { ...this.edit, [`type_${alt.axis}`]: alt.type, [`freq_${alt.axis}`]: alt.freq }
        if (alt.damping !== null) edit[`damping_${alt.axis}`] = alt.damping
        this.edit = edit
    }

    tryNow() {
        const args: string[] = []
        for (const axis of ['x', 'y']) {
            const upper = axis.toUpperCase()
            const type = this.edit[`type_${axis}` as ShaperKey]
            const freq = this.edit[`freq_${axis}` as ShaperKey]
            const damping = this.edit[`damping_${axis}` as ShaperKey]
            if (type) args.push(`SHAPER_TYPE_${upper}=${type}`)
            if (freq) args.push(`SHAPER_FREQ_${upper}=${freq}`)
            if (damping) args.push(`DAMPING_RATIO_${upper}=${damping}`)
        }
        if (args.length) this.sendGcode(`SET_INPUT_SHAPER ${args.join(' ')}`)
    }

    onSaved(saved: { file: string; values: ShaperValues }) {
        if (this.run) this.$emit('saved', { runId: this.run.id, ...saved })
    }

    deleteRun() {
        if (this.run) this.$emit('delete-run', this.run.id)
    }
}
</script>

<style scoped>
.input-shaper-compare {
    font-variant-numeric: tabular-nums;
}

.input-shaper-compare__new {
    width: 160px;
}

.input-shaper-log {
    font-size: 0.75rem;
    white-space: pre-wrap;
}
</style>
