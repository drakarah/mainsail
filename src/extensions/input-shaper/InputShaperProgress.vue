<template>
    <div v-if="progress.queued" class="input-shaper-progress d-flex align-center text-body-2 text--secondary">
        <v-icon small class="mr-2">{{ mdiClockOutline }}</v-icon>
        {{ $t('InputShaper.Queued') }}
    </div>
    <div v-else class="input-shaper-progress">
        <v-progress-linear :value="percent" :indeterminate="!progress.found" rounded height="6" class="mb-3" />
        <div v-for="(step, index) in progress.steps" :key="step" class="d-flex align-center py-1">
            <v-progress-circular v-if="index === progress.step" indeterminate size="16" width="2" class="mr-3" />
            <v-icon v-else small class="mr-3" :color="index < progress.step ? 'success' : ''">
                {{ index < progress.step ? mdiCheckCircle : mdiCircleOutline }}
            </v-icon>
            <span :class="index === progress.step ? '' : 'text--secondary'">
                {{ $t(`InputShaper.Steps.${stepKey(step)}`, { axis: stepAxis(step), tool: toolLabel }) }}
            </span>
        </div>
        <div class="text-caption text--secondary mt-2">
            {{ $t('InputShaper.StartedAt', { time: startedTime, minutes: estimatedMinutes }) }}
        </div>
        <div v-if="lastMessage" class="text-caption text--secondary text-truncate" :title="lastMessage">
            {{ lastMessage }}
        </div>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator'
import { mdiCheckCircle, mdiCircleOutline, mdiClockOutline } from '@mdi/js'
import { RunProgress, ShakeTuneRun } from './inputShaper'

// rough durations measured on a real machine, in minutes
const estimates = { shaper: 4, belts: 5, vibrations: 17 }

@Component
export default class InputShaperProgress extends Vue {
    mdiCheckCircle = mdiCheckCircle
    mdiCircleOutline = mdiCircleOutline
    mdiClockOutline = mdiClockOutline

    @Prop({ type: Object, required: true }) declare readonly run: ShakeTuneRun
    @Prop({ type: Object, required: true }) declare readonly progress: RunProgress

    get percent() {
        return (this.progress.step / this.progress.steps.length) * 100
    }

    get toolLabel() {
        return this.run.toolNumber !== null ? `T${this.run.toolNumber}` : ''
    }

    get startedTime() {
        return new Date(this.run.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }

    get estimatedMinutes() {
        const axes = this.run.kind === 'shaper' && this.run.axis === 'all' ? 2 : 1
        return estimates[this.run.kind] * axes
    }

    get lastMessage() {
        return this.progress.log[this.progress.log.length - 1] ?? ''
    }

    stepKey(step: string) {
        if (step === 'prepare') return this.run.toolNumber !== null ? 'PrepareTool' : 'Prepare'
        return step.startsWith('measure') ? 'Measure' : 'Analyze'
    }

    stepAxis(step: string) {
        const axis = step.split('_')[1]
        return axis ? axis.toUpperCase() : ''
    }
}
</script>
