<template>
    <v-dialog :value="value" max-width="520" @input="$emit('input', $event)">
        <v-card>
            <v-card-title class="text-h6">{{ title }}</v-card-title>
            <v-card-text>
                <p class="body-2">{{ description }}</p>

                <v-btn-toggle
                    v-if="kind === 'shaper'"
                    v-model="axis"
                    mandatory
                    dense
                    color="primary"
                    class="mb-4 d-flex">
                    <v-btn value="all" class="flex-grow-1">{{ $t('InputShaper.AxisBoth') }}</v-btn>
                    <v-btn value="x" class="flex-grow-1">X</v-btn>
                    <v-btn value="y" class="flex-grow-1">Y</v-btn>
                </v-btn-toggle>

                <template v-if="multi">
                    <div class="text-caption text--secondary">{{ $t('InputShaper.ToolsToCalibrate') }}</div>
                    <v-chip-group v-model="selectedTools" multiple column active-class="primary--text" class="mb-2">
                        <v-chip v-for="option in toolOptions" :key="option.value" :value="option.value" filter outlined>
                            {{ option.text }}
                        </v-chip>
                    </v-chip-group>
                </template>

                <v-select
                    v-else-if="!target && toolOptions.length"
                    v-model="toolNumber"
                    :items="toolOptions"
                    :label="$t('InputShaper.Tool')"
                    outlined
                    dense
                    hide-details
                    class="mb-4"
                    @change="onToolChange" />

                <v-select
                    v-if="!multi"
                    v-model="accelChip"
                    :items="accelChipItems"
                    :label="$t('InputShaper.AccelChip')"
                    outlined
                    dense
                    hide-details
                    class="mb-4" />

                <v-checkbox v-model="home" :label="$t('InputShaper.HomeFirst')" dense hide-details class="mt-0 mb-2" />

                <v-expansion-panels flat class="input-shaper-advanced">
                    <v-expansion-panel>
                        <v-expansion-panel-header class="px-0">
                            {{ $t('InputShaper.Advanced') }}
                        </v-expansion-panel-header>
                        <v-expansion-panel-content>
                            <v-row dense>
                                <v-col v-for="field in fields" :key="field.name" cols="6">
                                    <v-text-field
                                        v-model="params[field.name]"
                                        :label="field.name"
                                        :placeholder="field.placeholder"
                                        persistent-placeholder
                                        :suffix="field.unit"
                                        type="number"
                                        outlined
                                        dense
                                        hide-details />
                                </v-col>
                            </v-row>
                        </v-expansion-panel-content>
                    </v-expansion-panel>
                </v-expansion-panels>

                <div class="text-caption text--secondary mt-3">
                    <code>{{ gcodePreview }}</code>
                </div>
            </v-card-text>
            <v-card-actions>
                <v-spacer />
                <v-btn text @click="$emit('input', false)">{{ $t('Buttons.Cancel') }}</v-btn>
                <v-btn color="primary" text :disabled="!canStart" @click="start">
                    <v-icon left small>{{ mdiPlay }}</v-icon>
                    {{ $t('InputShaper.Start') }}
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import { Component, Prop, Vue, Watch } from 'vue-property-decorator'
import { mdiPlay } from '@mdi/js'
import { runKindCommands, RunKind, ShaperTarget } from './inputShaper'

export interface RunJob {
    target: string | null
    toolNumber: number | null
    accelChip: string | null
}

export interface RunRequest {
    kind: RunKind
    axis: 'all' | 'x' | 'y'
    // one job per tool, in the order they run
    jobs: RunJob[]
    gcode: string
}

interface Field {
    name: string
    placeholder: string
    unit?: string
}

const fieldsByKind: Record<RunKind, Field[]> = {
    shaper: [
        { name: 'FREQ_START', placeholder: 'config', unit: 'Hz' },
        { name: 'FREQ_END', placeholder: 'config', unit: 'Hz' },
        { name: 'HZ_PER_SEC', placeholder: '1' },
        { name: 'MAX_SMOOTHING', placeholder: 'none' },
        { name: 'Z_HEIGHT', placeholder: 'probe point', unit: 'mm' },
    ],
    belts: [
        { name: 'FREQ_START', placeholder: 'config', unit: 'Hz' },
        { name: 'FREQ_END', placeholder: 'config', unit: 'Hz' },
        { name: 'HZ_PER_SEC', placeholder: '1' },
        { name: 'Z_HEIGHT', placeholder: 'probe point', unit: 'mm' },
    ],
    vibrations: [
        { name: 'MAX_SPEED', placeholder: '200', unit: 'mm/s' },
        { name: 'SPEED_INCREMENT', placeholder: '2', unit: 'mm/s' },
        { name: 'ACCEL', placeholder: '3000', unit: 'mm/s²' },
        { name: 'SIZE', placeholder: '100', unit: 'mm' },
        { name: 'Z_HEIGHT', placeholder: '20', unit: 'mm' },
    ],
}

@Component
export default class InputShaperRunDialog extends Vue {
    mdiPlay = mdiPlay

    @Prop({ type: Boolean, default: false }) declare readonly value: boolean
    @Prop({ type: String, required: true }) declare readonly kind: RunKind
    // the tool/printer being calibrated, null for machine wide tests
    @Prop({ type: Object, default: null }) declare readonly target: ShaperTarget | null
    @Prop({ type: Array, required: true }) declare readonly targets: ShaperTarget[]
    @Prop({ type: Array, required: true }) declare readonly accelChips: string[]
    @Prop({ type: Number, default: null }) declare readonly activeToolNumber: number | null
    @Prop({ type: Boolean, default: false }) declare readonly homed: boolean
    // calibrate several tools one after another
    @Prop({ type: Boolean, default: false }) declare readonly multi: boolean

    axis: 'all' | 'x' | 'y' = 'all'
    toolNumber: number | null = null
    accelChip: string | null = null
    home = false
    params: Record<string, string> = {}
    selectedTools: number[] = []

    get fields() {
        return fieldsByKind[this.kind]
    }

    get title() {
        if (this.multi || (this.kind === 'shaper' && !this.target)) return this.$t('InputShaper.CalibrateAllTitle')
        if (this.target) return this.$t('InputShaper.CalibrateTitle', { name: this.target.label })
        return this.$t(`InputShaper.Machine.${this.kind}.Title`)
    }

    get toolOptions() {
        return this.targets
            .filter((target) => target.toolNumber !== null)
            .map((target) => ({ text: target.label, value: target.toolNumber }))
    }

    get minutes() {
        const perJob = this.kind === 'shaper' ? (this.axis === 'all' ? 7 : 4) : this.kind === 'belts' ? 5 : 17
        return perJob * Math.max(this.jobs.length, 1)
    }

    get description() {
        if (this.multi) {
            return this.$t('InputShaper.RunDescriptionAll', { count: this.jobs.length, minutes: this.minutes })
        }

        const tool = this.toolNumber !== null ? `T${this.toolNumber}` : ''
        const key = tool ? 'InputShaper.RunDescriptionTool' : 'InputShaper.RunDescription'
        return this.$t(key, { tool, minutes: this.minutes })
    }

    get jobs(): RunJob[] {
        if (!this.multi) {
            return [{ target: this.target?.id ?? null, toolNumber: this.toolNumber, accelChip: this.accelChip }]
        }

        // start with the active tool, that saves a tool change
        const isActive = (target: ShaperTarget) => Number(target.toolNumber === this.activeToolNumber)
        return this.targets
            .filter((target) => target.toolNumber !== null && this.selectedTools.includes(target.toolNumber))
            .sort((a, b) => isActive(b) - isActive(a))
            .map((target) => ({
                target: target.id,
                toolNumber: target.toolNumber,
                accelChip: target.accelChip,
            }))
    }

    get canStart() {
        return this.jobs.length > 0
    }

    // automatic leaves ACCEL_CHIP out, so Shake&Tune uses [resonance_tester] (e.g. accel_chip_x/accel_chip_y)
    get accelChipItems() {
        return [
            { text: this.$t('InputShaper.AccelChipAuto'), value: null },
            ...this.accelChips.map((chip) => ({ text: chip, value: chip })),
        ]
    }

    get gcodeLines() {
        const lines: string[] = []
        if (this.home) lines.push('G28')

        const args: string[] = []
        if (this.kind === 'shaper' && this.axis !== 'all') args.push(`AXIS=${this.axis.toUpperCase()}`)
        this.fields.forEach((field) => {
            const value = (this.params[field.name] ?? '').toString().trim()
            if (value !== '') args.push(`${field.name}=${value}`)
        })

        let currentTool = this.activeToolNumber
        this.jobs.forEach((job) => {
            if (job.toolNumber !== null && job.toolNumber !== currentTool) lines.push(`T${job.toolNumber}`)
            currentTool = job.toolNumber ?? currentTool

            const chip = job.accelChip ? [`ACCEL_CHIP="${job.accelChip}"`] : []
            lines.push([this.command, ...args, ...chip].join(' '))
        })
        return lines
    }

    // With show_macros_in_webui, Shake&Tune's commands are macros that pass parameters on to the real
    // _COMMAND without quotes, which breaks chip names with a space like "adxl345 T1". Call the real one.
    get command() {
        const command = runKindCommands[this.kind]
        const available = this.$store.state.printer.gcode?.commands ?? {}
        return `_${command}` in available ? `_${command}` : command
    }

    get gcodePreview() {
        return this.gcodeLines.join(' → ')
    }

    @Watch('value')
    onOpen(open: boolean) {
        if (!open) return

        this.axis = 'all'
        this.params = {}
        this.home = !this.homed
        this.toolNumber = this.target ? this.target.toolNumber : this.activeToolNumber
        this.selectedTools = this.toolOptions.map((option) => option.value as number)
        this.onToolChange()
    }

    onToolChange() {
        const target = this.target ?? this.targets.find((target) => target.toolNumber === this.toolNumber)
        this.accelChip = target?.accelChip ?? null
    }

    start() {
        if (!this.canStart) return

        const request: RunRequest = {
            kind: this.kind,
            axis: this.kind === 'shaper' ? this.axis : 'all',
            jobs: this.jobs,
            gcode: this.gcodeLines.join('\n'),
        }
        this.$emit('start', request)
        this.$emit('input', false)
    }
}
</script>

<style scoped>
.input-shaper-advanced ::v-deep .v-expansion-panel-content__wrap {
    padding: 0;
}
</style>
