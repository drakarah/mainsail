<template>
    <v-card outlined class="d-flex flex-column fill-height">
        <v-card-title class="py-2 text-subtitle-1">
            <v-icon left small>{{ icon }}</v-icon>
            {{ $t(`InputShaper.Machine.${kind}.Title`) }}
            <v-spacer />
            <v-select
                v-if="files.length > 1 && !progress"
                v-model="selected"
                :items="fileItems"
                dense
                hide-details
                class="input-shaper-machine__select mt-0 pt-0" />
        </v-card-title>
        <v-divider />
        <v-card-text class="flex-grow-1">
            <p class="text-body-2 text--secondary">{{ $t(`InputShaper.Machine.${kind}.Description`) }}</p>

            <input-shaper-progress v-if="runningRun && progress" :run="runningRun" :progress="progress" />

            <template v-else-if="selected">
                <input-shaper-graph :src="fileUrl(selected)" :label="selectedDate" :height="260" />
                <v-alert
                    v-if="selectedRun && selectedRun.status === 'failed'"
                    :type="selectedRun.aborted ? 'info' : 'error'"
                    dense
                    text
                    class="mt-3 mb-0">
                    {{ selectedRun.error || $t('InputShaper.RunFailed') }}
                </v-alert>
                <ul v-if="summary.length" class="input-shaper-summary text-body-2 mt-3">
                    <li v-for="(line, index) in summary" :key="index">{{ line }}</li>
                </ul>
            </template>
            <div v-else class="text-body-2 text--secondary">{{ $t('InputShaper.NoResults') }}</div>
        </v-card-text>
        <v-card-actions>
            <v-btn small text color="primary" :disabled="disabled" @click="$emit('run', kind)">
                <v-icon left small>{{ mdiPlay }}</v-icon>
                {{ $t('InputShaper.Run') }}
            </v-btn>
        </v-card-actions>
    </v-card>
</template>

<script lang="ts">
import { Component, Mixins, Prop, Watch } from 'vue-property-decorator'
import { mdiPlay, mdiVibrate, mdiVectorLine } from '@mdi/js'
import InputShaperMixin from './inputShaperMixin'
import InputShaperGraph from './InputShaperGraph.vue'
import InputShaperProgress from './InputShaperProgress.vue'
import { parseResultTimestamp, RunKind, RunProgress, ShakeTuneRun, summaryLines } from './inputShaper'

@Component({
    components: { InputShaperGraph, InputShaperProgress },
})
export default class InputShaperMachineCard extends Mixins(InputShaperMixin) {
    mdiPlay = mdiPlay

    @Prop({ type: String, required: true }) declare readonly kind: RunKind
    // runs of this kind, newest first
    @Prop({ type: Array, required: true }) declare readonly runs: ShakeTuneRun[]
    // result graphs in the folder of this kind, newest first
    @Prop({ type: Array, required: true }) declare readonly files: string[]
    @Prop({ type: Object, default: null }) declare readonly progress: RunProgress | null
    @Prop({ type: Boolean, default: false }) declare readonly disabled: boolean

    selected: string | null = null

    get icon() {
        return this.kind === 'belts' ? mdiVectorLine : mdiVibrate
    }

    get runningRun() {
        return this.runs.find((run) => run.status === 'running') ?? null
    }

    get fileItems() {
        return this.files.map((path) => ({ text: this.dateOf(path), value: path }))
    }

    get selectedDate() {
        return this.selected ? this.dateOf(this.selected) : ''
    }

    get selectedRun() {
        return this.runs.find((run) => this.selected && run.files.includes(this.selected)) ?? null
    }

    get summary() {
        return this.selectedRun ? summaryLines(this.selectedRun.log) : []
    }

    @Watch('files', { immediate: true })
    onFilesChanged() {
        if (!this.selected || !this.files.includes(this.selected)) this.selected = this.files[0] ?? null
    }

    dateOf(path: string) {
        const timestamp = parseResultTimestamp(path)
        return timestamp ? this.formatDate(timestamp) : path.slice(path.lastIndexOf('/') + 1)
    }
}
</script>

<style scoped>
.input-shaper-machine__select {
    max-width: 200px;
}

.input-shaper-summary {
    padding-left: 18px;
}
</style>
