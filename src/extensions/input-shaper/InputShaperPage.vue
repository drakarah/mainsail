<template>
    <div>
        <v-alert v-if="!resultsDir" type="warning" text>{{ $t('InputShaper.ResultsOutsideConfig') }}</v-alert>

        <panel
            :icon="mdiSineWave"
            :title="$t('InputShaper.Title')"
            :loading="loading"
            card-class="input-shaper-tools-panel">
            <template #buttons>
                <v-btn v-if="shaperRunning" text tile color="error" @click="abortDialog = true">
                    <v-icon left small>{{ mdiStop }}</v-icon>
                    {{ $t('InputShaper.Abort') }}
                </v-btn>
                <v-btn
                    v-else-if="targets.length > 1"
                    text
                    tile
                    :disabled="busy"
                    @click="openRunDialog('shaper', null, true)">
                    <v-icon left small>{{ mdiPlaylistPlay }}</v-icon>
                    {{ $t('InputShaper.CalibrateAll') }}
                </v-btn>
                <v-btn icon tile :disabled="loading" @click="refresh">
                    <v-icon>{{ mdiRefresh }}</v-icon>
                </v-btn>
            </template>
            <v-card-text>
                <v-alert v-if="loadError" type="error" dense text>{{ loadError }}</v-alert>
                <v-alert v-if="klipperStopped" type="error" dense text>
                    {{ $t('InputShaper.KlipperStoppedAlert') }}
                    <template #append>
                        <v-btn small text @click="restartFirmware">{{ $t('InputShaper.RestartFirmware') }}</v-btn>
                    </template>
                </v-alert>
                <v-alert v-if="lostRun" type="warning" dense text>
                    {{ $t('InputShaper.LostTrack') }}
                    <template #append>
                        <v-btn small text @click="finishRun(lostRun, null)">{{ $t('InputShaper.CheckResults') }}</v-btn>
                        <v-btn small text @click="deleteRun(lostRun.id)">{{ $t('InputShaper.Discard') }}</v-btn>
                    </template>
                </v-alert>
                <v-alert v-if="retentionTooLow" type="info" dense text dismissible @input="dismissHint('retention')">
                    {{ $t('InputShaper.RetentionHint', { count: resultsToKeep }) }}
                </v-alert>
                <v-row>
                    <v-col v-for="target in targets" :key="target.id" cols="12" sm="6" lg="4" xl="3">
                        <input-shaper-tool-card
                            :target="target"
                            :values="valuesFor(target)"
                            :runs="runsFor(target.id)"
                            :available-files="availableFiles"
                            :progress="progressFor(runsFor(target.id).find((run) => run.status === 'running'))"
                            :is-active="target.toolNumber !== null && target.toolNumber === activeToolNumber"
                            :disabled="busy"
                            @calibrate="openRunDialog('shaper', target)"
                            @review="reviewTargetId = target.id" />
                    </v-col>
                </v-row>
            </v-card-text>
        </panel>

        <panel :icon="mdiCogs" :title="$t('InputShaper.MachineTitle')" card-class="input-shaper-machine-panel">
            <template #buttons>
                <v-btn v-if="machineRunning" text tile color="error" @click="abortDialog = true">
                    <v-icon left small>{{ mdiStop }}</v-icon>
                    {{ $t('InputShaper.Abort') }}
                </v-btn>
            </template>
            <v-card-text>
                <v-row>
                    <v-col v-for="kind in machineKinds" :key="kind" cols="12" md="6">
                        <input-shaper-machine-card
                            :kind="kind"
                            :runs="db.runs.filter((run) => run.kind === kind).sort(byNewest)"
                            :files="files[kind]"
                            :progress="progressFor(runningRuns.find((run) => run.kind === kind))"
                            :disabled="busy"
                            @run="openRunDialog(kind, null)" />
                    </v-col>
                </v-row>
            </v-card-text>
        </panel>

        <panel
            v-if="unassigned.length"
            :icon="mdiFileQuestionOutline"
            :title="$t('InputShaper.Unassigned')"
            :collapsible="true"
            card-class="input-shaper-unassigned-panel">
            <v-card-text>
                <p class="text-body-2 text--secondary">{{ $t('InputShaper.UnassignedDescription') }}</p>
                <v-row v-for="group in unassigned" :key="group.key" dense align="center" class="mb-2">
                    <v-col cols="12" md="2" class="text-body-2">{{ formatDate(group.timestamp) }}</v-col>
                    <v-col v-for="file in group.files" :key="file" cols="6" md="3">
                        <input-shaper-graph :src="fileUrl(file)" :height="90" />
                    </v-col>
                    <v-col cols="12" md="4" class="d-flex align-center">
                        <v-select
                            v-model="assignTo[group.key]"
                            :items="targets.map((target) => ({ text: target.label, value: target.id }))"
                            :label="$t('InputShaper.AssignTo')"
                            dense
                            outlined
                            hide-details
                            class="mr-2" />
                        <v-btn small text color="primary" :disabled="!assignTo[group.key]" @click="assignGroup(group)">
                            {{ $t('InputShaper.Assign') }}
                        </v-btn>
                        <v-btn small icon :title="$t('InputShaper.Dismiss')" @click="ignoreGroup(group.key)">
                            <v-icon small>{{ mdiEyeOff }}</v-icon>
                        </v-btn>
                    </v-col>
                </v-row>
            </v-card-text>
        </panel>

        <v-dialog v-model="abortDialog" max-width="460">
            <v-card>
                <v-card-title class="text-h6">{{ $t('InputShaper.AbortTitle') }}</v-card-title>
                <v-card-text class="body-2">{{ $t('InputShaper.AbortDescription') }}</v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn text @click="abortDialog = false">{{ $t('Buttons.Cancel') }}</v-btn>
                    <v-btn text color="error" @click="abort">
                        <v-icon left small>{{ mdiAlertOctagonOutline }}</v-icon>
                        {{ $t('InputShaper.EmergencyStop') }}
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <input-shaper-run-dialog
            v-model="runDialog.show"
            :kind="runDialog.kind"
            :target="runDialog.target"
            :targets="targets"
            :accel-chips="accelChips"
            :active-tool-number="activeToolNumber"
            :homed="homed"
            :multi="runDialog.multi"
            @start="startRun" />

        <input-shaper-result-dialog
            v-if="reviewTarget"
            :value="!!reviewTarget"
            :target="reviewTarget"
            :runs="runsFor(reviewTarget.id).filter((run) => run.status !== 'running')"
            :values="valuesFor(reviewTarget)"
            :available-files="availableFiles"
            :is-active="reviewTarget.toolNumber !== null && reviewTarget.toolNumber === activeToolNumber"
            :busy="busy"
            @input="reviewTargetId = $event ? reviewTargetId : null"
            @delete-run="deleteRun"
            @saved="markSaved" />
    </div>
</template>

<script lang="ts">
import { Component, Mixins, Watch } from 'vue-property-decorator'
import {
    mdiAlertOctagonOutline,
    mdiCogs,
    mdiEyeOff,
    mdiFileQuestionOutline,
    mdiPlaylistPlay,
    mdiRefresh,
    mdiSineWave,
    mdiStop,
} from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import InputShaperMixin from './inputShaperMixin'
import { consoleRecorder, seedConsoleRecorder, startConsoleRecorder } from './consoleRecorder'
import InputShaperGraph from './InputShaperGraph.vue'
import InputShaperMachineCard from './InputShaperMachineCard.vue'
import InputShaperResultDialog from './InputShaperResultDialog.vue'
import InputShaperRunDialog, { RunRequest } from './InputShaperRunDialog.vue'
import InputShaperToolCard from './InputShaperToolCard.vue'
import {
    accelChipRegex,
    ConsoleLine,
    findToolAccelChip,
    parseResultTimestamp,
    parseRunProgress,
    printerShaperKeys,
    readTargetValues,
    resultGroupKey,
    roundShaperValues,
    RunKind,
    runKindFolders,
    RunProgress,
    ShakeTuneDb,
    ShakeTuneRun,
    ShaperTarget,
    ShaperValues,
    toolShaperKeys,
} from './inputShaper'

interface ResultGroup {
    key: string
    timestamp: number
    files: string[]
}

@Component({
    components: {
        Panel,
        InputShaperGraph,
        InputShaperMachineCard,
        InputShaperResultDialog,
        InputShaperRunDialog,
        InputShaperToolCard,
    },
})
export default class InputShaperPage extends Mixins(InputShaperMixin) {
    mdiAlertOctagonOutline = mdiAlertOctagonOutline
    mdiCogs = mdiCogs
    mdiEyeOff = mdiEyeOff
    mdiFileQuestionOutline = mdiFileQuestionOutline
    mdiPlaylistPlay = mdiPlaylistPlay
    mdiRefresh = mdiRefresh
    mdiSineWave = mdiSineWave
    mdiStop = mdiStop

    machineKinds: RunKind[] = ['belts', 'vibrations']

    db: ShakeTuneDb = { runs: [] }
    files: Record<RunKind, string[]> = { shaper: [], belts: [], vibrations: [] }
    loading = false
    loadError: string | null = null
    finishing = false
    // retry finishing a run only after a pause when it failed (e.g. network), not on every console line
    finishRetryAt = 0
    // database writes are read-modify-write; one at a time so they can't overwrite each other
    dbQueue: Promise<unknown> = Promise.resolve()
    now = Date.now()
    timer: number | null = null

    runDialog: { show: boolean; kind: RunKind; target: ShaperTarget | null; multi: boolean } = {
        show: false,
        kind: 'shaper',
        target: null,
        multi: false,
    }
    reviewTargetId: string | null = null
    abortDialog = false
    assignTo: Record<string, string> = {}

    get accelChips(): string[] {
        return Object.keys(this.klipperConfig).filter((name) => accelChipRegex.test(name))
    }

    get targets(): ShaperTarget[] {
        const toolchanger = this.$store.state.printer.toolchanger
        const toolNames: string[] = toolchanger?.tool_names ?? []
        const toolNumbers: number[] = toolchanger?.tool_numbers ?? []

        if (!toolNames.length) {
            return [
                {
                    id: 'printer',
                    label: this.$t('InputShaper.Printer').toString(),
                    section: 'input_shaper',
                    toolNumber: null,
                    accelChip: null,
                    keys: printerShaperKeys,
                    quoteType: false,
                },
            ]
        }

        return toolNames.map((section, index) => {
            const label = section.replace(/^tool\s+/i, '')
            const accelChip = findToolAccelChip(this.klipperConfig, section)

            return {
                id: label,
                label,
                section,
                toolNumber: toolNumbers[index] ?? index,
                accelChip,
                keys: toolShaperKeys,
                quoteType: true,
            }
        })
    }

    get reviewTarget() {
        return this.targets.find((target) => target.id === this.reviewTargetId) ?? null
    }

    get activeToolNumber(): number | null {
        const number = this.$store.state.printer.toolchanger?.tool_number
        return typeof number === 'number' && number >= 0 ? number : null
    }

    get homed() {
        const axes: string = this.$store.state.printer.toolhead?.homed_axes ?? ''
        return ['x', 'y', 'z'].every((axis) => axes.includes(axis))
    }

    get resultsToKeep() {
        return parseInt(this.klipperConfig.shaketune?.number_of_results_to_keep ?? '10')
    }

    get retentionTooLow() {
        // every tool needs its own results, the default of 10 only keeps the last run or two per tool
        if ((this.db.dismissedHints ?? []).includes('retention')) return false
        return this.targets.length > 1 && this.resultsToKeep < this.targets.length * 4
    }

    get availableFiles() {
        return [...this.files.shaper, ...this.files.belts, ...this.files.vibrations]
    }

    // in the order they run: runs of one script (calibrate all) share startedAt
    get runningRuns() {
        return this.db.runs
            .filter((run) => run.status === 'running')
            .sort((a, b) => a.startedAt - b.startedAt || (a.batch?.index ?? 0) - (b.batch?.index ?? 0))
    }

    get consoleLines(): ConsoleLine[] {
        return consoleRecorder.lines
    }

    get progressById(): Record<string, RunProgress> {
        const result: Record<string, RunProgress> = {}
        this.runningRuns.forEach((run) => {
            const previous = this.db.runs.find(
                (other) => other.batch && other.batch.id === run.batch?.id && other.batch.index === run.batch.index - 1
            )
            const progress = parseRunProgress(
                run.kind,
                run.axis,
                run.startedAt,
                this.consoleLines,
                run.batch?.index,
                run.toolNumber,
                previous?.toolNumber ?? null
            )
            // runs finish in order, so an earlier run of the same script that's still running means waiting
            const waiting = this.runningRuns.some(
                (other) => other.batch?.id === run.batch?.id && (other.batch?.index ?? 0) < (run.batch?.index ?? 0)
            )
            result[run.id] = waiting && !progress.failed ? { ...progress, found: true, queued: true } : progress
        })
        return result
    }

    // a run that can't be followed anymore: its start isn't in the console history, or nothing happened for
    // a long time (e.g. klipper restarted while no page was open). Shake&Tune's quietest phase takes ~4 min.
    get lostRun() {
        const run = this.runningRuns[0]
        if (!run || this.now - run.startedAt < 2 * 60 * 1000) return null
        if (!this.progressById[run.id]?.found) return run

        const lastLine = this.consoleLines[this.consoleLines.length - 1]
        const quietFor = lastLine ? this.now - lastLine.date.getTime() : 0
        return quietFor > 10 * 60 * 1000 ? run : null
    }

    get klipperStopped() {
        return this.socketIsConnected && ['shutdown', 'error'].includes(this.klipperState)
    }

    get shaperRunning() {
        return this.runningRuns.some((run) => run.kind === 'shaper')
    }

    get machineRunning() {
        return this.runningRuns.some((run) => run.kind !== 'shaper')
    }

    get busy() {
        return this.runningRuns.length > 0 || this.printerIsPrinting || !this.klipperReadyForGui
    }

    get unassigned(): ResultGroup[] {
        const assigned = new Set(this.db.runs.flatMap((run) => run.files))
        const ignored = new Set(this.db.ignored ?? [])
        const groups = new Map<string, ResultGroup>()

        this.files.shaper
            .filter((path) => !assigned.has(path))
            .forEach((path) => {
                const key = resultGroupKey(path)
                if (ignored.has(key)) return
                if (!groups.has(key)) groups.set(key, { key, timestamp: parseResultTimestamp(path) ?? 0, files: [] })
                groups.get(key)?.files.push(path)
            })

        return [...groups.values()]
            .map((group) => ({ ...group, files: group.files.sort() }))
            .sort((a, b) => b.timestamp - a.timestamp)
    }

    progressFor(run: ShakeTuneRun | undefined) {
        return run ? (this.progressById[run.id] ?? null) : null
    }

    byNewest(a: ShakeTuneRun, b: ShakeTuneRun) {
        return b.startedAt - a.startedAt
    }

    runsFor(targetId: string) {
        return this.db.runs.filter((run) => run.kind === 'shaper' && run.target === targetId).sort(this.byNewest)
    }

    valuesFor(target: ShaperTarget) {
        const settings = this.$store.state.printer.configfile?.settings ?? {}
        return readTargetValues(settings[target.section.toLowerCase()], target)
    }

    mounted() {
        // normally already started at app start by the extension's setup, but the printer config (needed to
        // know Shake&Tune is there) can arrive after mainsail loaded the console history
        startConsoleRecorder()
        if (!consoleRecorder.lines.length) seedConsoleRecorder()
        this.timer = window.setInterval(() => (this.now = Date.now()), 30 * 1000)
    }

    beforeDestroy() {
        if (this.timer) window.clearInterval(this.timer)
    }

    // a shutdown, error or restart of klipper ends whatever script was running
    @Watch('klipperState')
    onKlipperStateChanged() {
        this.failRunsIfKlipperStopped()
    }

    failRunsIfKlipperStopped() {
        if (!this.socketIsConnected || !this.runningRuns.length) return
        if (!['shutdown', 'error', 'startup', 'disconnected'].includes(this.klipperState)) return

        const message = this.$store.state.server.klippy_message?.trim()
        this.failRunning(message || this.$t('InputShaper.KlipperStopped', { state: this.klipperState }).toString())
    }

    @Watch('resultsDir', { immediate: true })
    onResultsDirChanged() {
        if (this.resultsDir) this.refresh()
    }

    // finish runs in the order they ran, so each one claims its own result files
    @Watch('progressById')
    onProgressChanged() {
        const run = this.runningRuns[0]
        const progress = run ? this.progressById[run.id] : null
        if (Date.now() < this.finishRetryAt) return
        if (run && progress && (progress.done || progress.failed)) this.finishRun(run, progress)
    }

    updateDb(mutate: (db: ShakeTuneDb) => void): Promise<boolean> {
        const write = this.dbQueue.then(async () => {
            try {
                this.db = await this.api.updateDb(mutate)
                return true
            } catch (e) {
                this.$toast.error(e instanceof Error ? e.message : String(e))
                return false
            }
        })
        this.dbQueue = write
        return write
    }

    async listResults(kind: RunKind) {
        const files = await this.api.listFiles('config', `${this.resultsDir}/${runKindFolders[kind]}`)
        return files
            .filter((file) => file.path.toLowerCase().endsWith('.png'))
            .sort((a, b) => b.modified - a.modified)
            .map((file) => file.path)
    }

    async refresh() {
        if (!this.resultsDir) return

        this.loading = true
        this.loadError = null
        try {
            const [db, shaper, belts, vibrations] = await Promise.all([
                this.api.loadDb(),
                this.listResults('shaper'),
                this.listResults('belts'),
                this.listResults('vibrations'),
            ])
            this.db = db
            this.files = { shaper, belts, vibrations }
            this.failRunsIfKlipperStopped()
        } catch (e) {
            this.loadError = e instanceof Error ? e.message : String(e)
        } finally {
            this.loading = false
        }
    }

    openRunDialog(kind: RunKind, target: ShaperTarget | null, multi = false) {
        this.runDialog = { show: true, kind, target, multi }
    }

    async startRun(request: RunRequest) {
        if (this.busy) return

        try {
            const existingFiles = await this.listResults(request.kind)
            const startedAt = Date.now()
            const runs: ShakeTuneRun[] = request.jobs.map((job, index) => ({
                id: `${startedAt}-${index}`,
                kind: request.kind,
                target: job.target,
                toolNumber: job.toolNumber,
                axis: request.axis,
                accelChip: job.accelChip,
                startedAt,
                status: 'running',
                batch: request.jobs.length > 1 ? { id: `${startedAt}`, index } : undefined,
                existingFiles,
                files: [],
                recommendations: {},
                log: [],
            }))
            if (await this.updateDb((db) => db.runs.push(...runs))) this.sendGcode(request.gcode)
        } catch (e) {
            this.$toast.error(e instanceof Error ? e.message : String(e))
        }
    }

    // progress is null when the user asks to check for results of a run that can't be followed anymore
    async finishRun(run: ShakeTuneRun, progress: RunProgress | null) {
        if (this.finishing) return
        this.finishing = true

        try {
            const listed = (await this.api.listFiles('config', `${this.resultsDir}/${runKindFolders[run.kind]}`))
                .filter((file) => file.path.toLowerCase().endsWith('.png'))
                .sort((a, b) => b.modified - a.modified)
            const expectedFiles = run.kind === 'shaper' && run.axis === 'all' ? 2 : 1
            const madeGraphs = !progress || progress.log.some((line) => /graphs created successfully/i.test(line))
            let incomplete = false

            const written = await this.updateDb((db) => {
                const stored = db.runs.find((item) => item.id === run.id)
                if (!stored || stored.status !== 'running') return

                // the oldest result group written since the run started that no other run claimed yet; with
                // several tools in one script the runs finish in order, so that's the group of this run
                const claimed = new Set([...(stored.existingFiles ?? []), ...db.runs.flatMap((item) => item.files)])
                const candidates = listed.filter(
                    (file) => !claimed.has(file.path) && file.modified * 1000 >= run.startedAt - 2 * 60 * 1000
                )
                const oldest = candidates[candidates.length - 1]
                const newFiles =
                    madeGraphs && oldest
                        ? candidates
                              .map((file) => file.path)
                              .filter((path) => resultGroupKey(path) === resultGroupKey(oldest.path))
                              .sort()
                        : []

                // checking by hand: only finish when all graphs are there, otherwise it's still running
                if (!progress && newFiles.length < expectedFiles) {
                    incomplete = true
                    return
                }

                stored.status = newFiles.length && !progress?.failed ? 'done' : 'failed'
                stored.files = newFiles
                stored.recommendations = progress?.recommendations ?? {}
                stored.log = (progress?.log ?? []).slice(-60)
                if (stored.status === 'failed')
                    stored.error = progress?.error ?? this.$t('InputShaper.NoResultFiles').toString()
                delete stored.existingFiles
            })

            if (!written) this.finishRetryAt = Date.now() + 30 * 1000
            if (incomplete) this.$toast.info(this.$t('InputShaper.NoCompleteResults').toString())
            this.files = { ...this.files, [run.kind]: listed.map((file) => file.path) }
        } catch (e) {
            this.finishRetryAt = Date.now() + 30 * 1000
            this.$toast.error(e instanceof Error ? e.message : String(e))
        } finally {
            this.finishing = false
        }
    }

    async markSaved(saved: { runId: string; file: string; values: ShaperValues }) {
        await this.updateDb((db) => {
            const run = db.runs.find((item) => item.id === saved.runId)
            if (run) run.saved = { at: Date.now(), file: saved.file, values: roundShaperValues(saved.values) }
        })
    }

    // ends every running and queued run, e.g. after an abort or when klipper stopped
    async failRunning(error: string, aborted = false) {
        await this.updateDb((db) => {
            db.runs
                .filter((run) => run.status === 'running')
                .forEach((run) => {
                    run.status = 'failed'
                    run.error = error
                    if (aborted) run.aborted = true
                    delete run.existingFiles
                })
        })
    }

    async abort() {
        this.abortDialog = false
        this.$socket.emit('printer.emergency_stop', {}, { loading: 'topbarEmergencyStop' })
        await this.failRunning(this.$t('InputShaper.Aborted').toString(), true)
    }

    restartFirmware() {
        this.$socket.emit('printer.firmware_restart', {}, { loading: 'firmwareRestart' })
    }

    async deleteRun(id: string) {
        await this.updateDb((db) => {
            db.runs = db.runs.filter((run) => run.id !== id)
        })
    }

    async assignGroup(group: ResultGroup) {
        const target = this.targets.find((target) => target.id === this.assignTo[group.key])
        if (!target) return

        const run: ShakeTuneRun = {
            id: `import-${group.key}`,
            kind: 'shaper',
            target: target.id,
            toolNumber: target.toolNumber,
            axis: 'all',
            accelChip: null,
            startedAt: group.timestamp,
            status: 'done',
            imported: true,
            files: group.files,
            recommendations: {},
            log: [],
        }
        await this.updateDb((db) => {
            db.runs = db.runs.filter((item) => item.id !== run.id)
            db.runs.push(run)
        })
    }

    async dismissHint(hint: string) {
        await this.updateDb((db) => {
            db.dismissedHints = [...new Set([...(db.dismissedHints ?? []), hint])]
        })
    }

    async ignoreGroup(key: string) {
        await this.updateDb((db) => {
            db.ignored = [...new Set([...(db.ignored ?? []), key])]
        })
    }
}
</script>
