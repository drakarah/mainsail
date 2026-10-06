<template>
    <v-dialog :value="value" max-width="620" @input="$emit('input', $event)">
        <v-card>
            <v-card-title class="text-h6">
                {{ saved ? $t('InputShaper.Saved') : $t('InputShaper.SaveTitle', { name: target.label }) }}
            </v-card-title>
            <v-card-text>
                <div v-if="loading" class="d-flex align-center py-4">
                    <v-progress-circular indeterminate size="20" width="2" class="mr-3" />
                    {{ $t('InputShaper.LookingForSection', { section: target.section }) }}
                </div>
                <v-alert v-else-if="error" type="error" dense text class="mb-0">{{ error }}</v-alert>
                <template v-else-if="saved">
                    <p class="body-2">{{ $t('InputShaper.SavedDescription', { file: changedFiles.join(', ') }) }}</p>
                    <v-alert v-if="printerIsPrinting" type="info" dense text class="mb-0">
                        {{ $t('InputShaper.RestartAfterPrint') }}
                    </v-alert>
                </template>
                <template v-else>
                    <p class="body-2">
                        <i18n path="InputShaper.SaveDescription">
                            <template #section>
                                <code>[{{ target.section }}]</code>
                            </template>
                        </i18n>
                    </p>
                    <v-simple-table v-if="changes.length" dense class="input-shaper-diff">
                        <tbody>
                            <tr v-for="change in changes" :key="change.file + change.key">
                                <td class="text--secondary">{{ change.file }}</td>
                                <td class="text--secondary">{{ change.line !== null ? change.line : '+' }}</td>
                                <td>{{ change.key }}</td>
                                <td>
                                    <span
                                        v-if="change.oldValue !== null"
                                        class="error--text text-decoration-line-through">
                                        {{ change.oldValue }}
                                    </span>
                                    <v-icon v-if="change.oldValue !== null" x-small>{{ mdiArrowRight }}</v-icon>
                                    <span class="success--text font-weight-medium">{{ change.newValue }}</span>
                                </td>
                            </tr>
                        </tbody>
                    </v-simple-table>
                    <v-alert v-else type="success" dense text class="mb-0">
                        {{ $t('InputShaper.NothingToSave') }}
                    </v-alert>
                </template>
            </v-card-text>
            <v-card-actions>
                <v-spacer />
                <template v-if="saved">
                    <v-btn text @click="$emit('input', false)">{{ $t('InputShaper.Later') }}</v-btn>
                    <v-btn text color="primary" :disabled="printerIsPrinting" @click="restart">
                        <v-icon left small>{{ mdiRestart }}</v-icon>
                        {{ $t('InputShaper.RestartFirmware') }}
                    </v-btn>
                </template>
                <template v-else>
                    <v-btn text @click="$emit('input', false)">{{ $t('Buttons.Cancel') }}</v-btn>
                    <v-btn
                        text
                        color="primary"
                        :disabled="loading || !!error || !changes.length"
                        :loading="saving"
                        @click="save">
                        <v-icon left small>{{ mdiContentSave }}</v-icon>
                        {{ $t('InputShaper.Save') }}
                    </v-btn>
                </template>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import { Component, Mixins, Prop, Watch } from 'vue-property-decorator'
import { mdiArrowRight, mdiContentSave, mdiRestart } from '@mdi/js'
import InputShaperMixin from './inputShaperMixin'
import { ConfigChange, planShaperSave, roundShaperValues, ShaperTarget, ShaperValues } from './inputShaper'

@Component
export default class InputShaperSaveDialog extends Mixins(InputShaperMixin) {
    mdiArrowRight = mdiArrowRight
    mdiContentSave = mdiContentSave
    mdiRestart = mdiRestart

    @Prop({ type: Boolean, default: false }) declare readonly value: boolean
    @Prop({ type: Object, required: true }) declare readonly target: ShaperTarget
    @Prop({ type: Object, required: true }) declare readonly values: ShaperValues

    loading = false
    saving = false
    saved = false
    error: string | null = null
    // config files that can hold the section: where it's defined, and printer.cfg for its SAVE_CONFIG block
    paths: string[] = []
    changes: ConfigChange[] = []

    get changedFiles() {
        return [...new Set(this.changes.map((change) => change.file))]
    }

    async plan() {
        const files = await Promise.all(
            this.paths.map(async (path) => ({ path, text: await this.api.readText('config', path) }))
        )
        const plan = planShaperSave(files, this.target, this.values)
        if (!plan.found)
            throw new Error(this.$t('InputShaper.SectionNotFound', { section: this.target.section }).toString())
        return plan
    }

    @Watch('value')
    async onOpen(open: boolean) {
        if (!open) return

        this.saved = false
        this.error = null
        this.changes = []
        this.loading = true
        try {
            const sectionFiles = await this.api.findSectionFiles(this.target.section)
            // printer.cfg is always needed for its SAVE_CONFIG block
            this.paths = [...new Set([...sectionFiles, 'printer.cfg'])]

            this.changes = (await this.plan()).changes
            // already in the config (e.g. saved by hand), so the run counts as saved
            if (!this.changes.length)
                this.$emit('saved', {
                    file: sectionFiles[sectionFiles.length - 1] ?? 'printer.cfg',
                    values: roundShaperValues(this.values),
                })
        } catch (e) {
            this.error = e instanceof Error ? e.message : String(e)
        } finally {
            this.loading = false
        }
    }

    async save() {
        if (!this.paths.length) return

        this.saving = true
        try {
            // re-read so edits made in the meantime are kept
            const plan = await this.plan()
            for (const file of plan.files) await this.api.writeText('config', file.path, file.text)
            this.changes = plan.changes
            this.saved = true
            this.$emit('saved', { file: this.changedFiles.join(', '), values: roundShaperValues(this.values) })
        } catch (e) {
            this.error = e instanceof Error ? e.message : String(e)
        } finally {
            this.saving = false
        }
    }

    restart() {
        this.$socket.emit('printer.firmware_restart', {}, { loading: 'firmwareRestart' })
        this.$emit('input', false)
    }
}
</script>

<style scoped>
.input-shaper-diff td {
    font-family: monospace;
    white-space: nowrap;
}
</style>
