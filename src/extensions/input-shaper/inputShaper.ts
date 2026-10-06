// Pure logic for the input shaper extension: types, Shake&Tune console parsing and config editing.
// Kept free of Vue/store imports so it can be unit tested.

export type RunKind = 'shaper' | 'belts' | 'vibrations'
export type ShaperAxis = 'x' | 'y'
export type ShaperKey = 'type_x' | 'freq_x' | 'damping_x' | 'type_y' | 'freq_y' | 'damping_y'
export const shaperKeys: ShaperKey[] = ['type_x', 'freq_x', 'damping_x', 'type_y', 'freq_y', 'damping_y']
export const shaperTypes = ['zv', 'mzv', 'zvd', 'ei', '2hump_ei', '3hump_ei']

// Shake&Tune result subfolders and the macro used for each kind of run
export const runKindFolders: Record<RunKind, string> = {
    shaper: 'input_shaper',
    belts: 'belts',
    vibrations: 'vibrations',
}
export const runKindCommands: Record<RunKind, string> = {
    shaper: 'AXES_SHAPER_CALIBRATION',
    belts: 'COMPARE_BELTS_RESPONSES',
    vibrations: 'CREATE_VIBRATIONS_PROFILE',
}

export interface ShaperRecommendation {
    type: string
    freq: number
    damping: number | null
    // when the best shaper for performance and for low vibrations differ, Shake&Tune reports both;
    // the performance one is the recommendation and this is the low vibrations one
    lowVibrations?: { type: string; freq: number; damping: number | null }
}

export type ShaperValues = Partial<Record<ShaperKey, string | number | null>>

// A place input shaper values can be saved to: a [tool Tn] section, or [input_shaper] without a toolchanger
export interface ShaperTarget {
    id: string
    label: string
    section: string
    toolNumber: number | null
    accelChip: string | null
    keys: Record<ShaperKey, string>
    quoteType: boolean
}

export const toolShaperKeys: Record<ShaperKey, string> = {
    type_x: 'params_input_shaper_type_x',
    freq_x: 'params_input_shaper_freq_x',
    damping_x: 'params_input_shaper_damping_ratio_x',
    type_y: 'params_input_shaper_type_y',
    freq_y: 'params_input_shaper_freq_y',
    damping_y: 'params_input_shaper_damping_ratio_y',
}
export const printerShaperKeys: Record<ShaperKey, string> = {
    type_x: 'shaper_type_x',
    freq_x: 'shaper_freq_x',
    damping_x: 'damping_ratio_x',
    type_y: 'shaper_type_y',
    freq_y: 'shaper_freq_y',
    damping_y: 'damping_ratio_y',
}

export interface ShakeTuneRun {
    id: string
    kind: RunKind
    // target id (e.g. 'T0'), null for machine wide runs
    target: string | null
    // tool that was picked up for the run, if any
    toolNumber: number | null
    axis: 'all' | ShaperAxis
    accelChip: string | null
    startedAt: number
    status: 'running' | 'done' | 'failed'
    // runs created by assigning existing result files instead of starting them from this screen
    imported?: boolean
    // runs started together as one script (calibrate all tools), in the order they run
    batch?: { id: string; index: number }
    // result files that existed before the run started, used to find the new ones afterwards
    existingFiles?: string[]
    // result png paths, relative to the config root
    files: string[]
    recommendations: Partial<Record<ShaperAxis, ShaperRecommendation>>
    log: string[]
    error?: string
    // stopped on purpose with the abort button
    aborted?: boolean
    // values saved to the config from this run; klipper only uses them after a firmware restart
    saved?: { at: number; file: string; values: ShaperValues }
}

export interface ShakeTuneDb {
    runs: ShakeTuneRun[]
    // result groups (e.g. inputshaper_20250824_120410) hidden from the unassigned list
    ignored?: string[]
    // hints the user closed, e.g. 'retention'
    dismissedHints?: string[]
}

export interface ConsoleLine {
    date: Date
    type: string
    message: string
}

export interface RunProgress {
    found: boolean
    // part of a multi tool script and waiting for the runs before it
    queued: boolean
    step: number
    steps: string[]
    done: boolean
    failed: boolean
    error: string | null
    recommendations: Partial<Record<ShaperAxis, ShaperRecommendation>>
    log: string[]
}

// "-> Best shaper: MZV @ 48.6 Hz (with a damping ratio of 0.062)", or when they differ
// "-> For performance: MZV @ 34.8 Hz (...)" followed by "-> For low vibrations: EI @ 41.0 Hz (...)"
const shaperRegex =
    /(Best shaper|For performance|For low vibrations):\s*([a-z0-9_]+)\s*@\s*([\d.]+)\s*Hz(?:.*?damping ratio of\s*([\d.]+))?/i

export function runSteps(kind: RunKind, axis: 'all' | ShaperAxis): string[] {
    if (kind !== 'shaper') return ['prepare', 'measure', 'analyze']

    const axes = axis === 'all' ? ['x', 'y'] : [axis]
    return ['prepare', ...axes.flatMap((a) => [`measure_${a}`, `analyze_${a}`])]
}

// Follows a Shake&Tune run through its console output. Shake&Tune only reports progress and the
// recommended shapers in the console, so this is the only way to get them.
// Several runs can be sent as one script (calibrate all tools); `index` selects which Shake&Tune
// invocation of that script to follow. Each invocation starts by printing its version.
export function parseRunProgress(
    kind: RunKind,
    axis: 'all' | ShaperAxis,
    startedAt: number,
    lines: ConsoleLine[],
    index = 0,
    toolNumber: number | null = null,
    previousToolNumber: number | null = null
): RunProgress {
    const steps = runSteps(kind, axis)
    const progress: RunProgress = {
        found: false,
        queued: false,
        step: 0,
        steps,
        done: false,
        failed: false,
        error: null,
        recommendations: {},
        log: [],
    }

    // clocks of the browser and the printer can differ a bit, so allow some slack
    const command = runKindCommands[kind].toLowerCase()
    let start = -1
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].date.getTime() < startedAt - 5 * 60 * 1000) break
        if (lines[i].type === 'command' && lines[i].message.toLowerCase().includes(command)) {
            start = i
            break
        }
    }

    // A script for several tools runs long enough for its command to drop out of the console history.
    // A later tool's part then starts at its tool change: the last one of this tool that came after the
    // previous tool's tool change, and not long before the script started (not an older manual change).
    let segmentIndex = index
    if (start === -1 && index > 0 && toolNumber !== null) {
        const lastSelection = (tool: number | null) => {
            if (tool === null) return -1
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].date.getTime() < startedAt - 60 * 1000) return -1
                const selected = lines[i].message.match(/Selected tool (\d+)\b/i)
                if (selected && parseInt(selected[1]) === tool) return i
            }
            return -1
        }
        const own = lastSelection(toolNumber)
        if (own !== -1 && own > lastSelection(previousToolNumber)) {
            start = own
            segmentIndex = 0
        }
    }

    if (start === -1) return progress
    progress.found = true

    const axes: ShaperAxis[] = axis === 'all' ? ['x', 'y'] : [axis]
    const expectedGraphs = kind === 'shaper' ? axes.length : 1
    let segment = -1
    let segmentGraphs = 0
    let axisIndex = 0
    let graphsDone = 0

    for (const line of lines.slice(start + 1)) {
        if (line.type === 'command') continue
        const message = line.message.replace(/^\/\/\s?/, '').trim()
        if (!message) continue

        if (/^Shake&Tune version:/i.test(message)) {
            segment++
            segmentGraphs = 0
            if (segment > segmentIndex) break
            // drop homing and tool change output from before the run itself
            if (segment === segmentIndex) progress.log = []
        }

        // klipper errors abort the rest of the script, including the runs after this one
        if (line.message.startsWith('!!')) {
            progress.failed = true
            progress.error = message.replace(/^!!\s*/, '')
            break
        }

        // without version lines (older Shake&Tune) everything belongs to the first run
        if (Math.max(segment, 0) < segmentIndex) {
            if (/graphs created successfully/i.test(message)) segmentGraphs++
            continue
        }

        progress.log.push(message)

        if (/^Error while/i.test(message)) {
            progress.failed = true
            progress.error = message
            break
        }

        if (/^Disabled \[input_shaper\]/i.test(message) || /^Measuring/i.test(message)) {
            progress.step = kind === 'shaper' ? 1 + axisIndex * 2 : 1
        } else if (/^Re-enabled \[input_shaper\]/i.test(message) || /generation\.\.\.$/i.test(message)) {
            progress.step = kind === 'shaper' ? 2 + axisIndex * 2 : 2
        }

        const shaper = message.match(shaperRegex)
        const axisName = axes[axisIndex]
        if (shaper && kind === 'shaper' && axisName) {
            const value = {
                type: shaper[2].toLowerCase(),
                freq: parseFloat(shaper[3]),
                damping: shaper[4] ? parseFloat(shaper[4]) : null,
            }
            const current = progress.recommendations[axisName]
            if (/low vibrations/i.test(shaper[1])) {
                if (current) current.lowVibrations = value
                else progress.recommendations[axisName] = { ...value }
            } else {
                progress.recommendations[axisName] = current?.lowVibrations
                    ? { ...value, lowVibrations: current.lowVibrations }
                    : value
            }
        }

        if (/graphs created successfully/i.test(message)) {
            graphsDone++
            axisIndex++
            if (graphsDone >= expectedGraphs) {
                progress.done = true
                progress.step = steps.length
                break
            }
        }
    }

    // waiting for an earlier run of the same script, unless that one just finished (tool change)
    const previousFinished = segment === segmentIndex - 1 && segmentGraphs >= expectedGraphs
    progress.queued = !progress.failed && Math.max(segment, 0) < segmentIndex && !previousFinished

    return progress
}

export function recommendationToValues(recommendations: Partial<Record<ShaperAxis, ShaperRecommendation>>) {
    const values: ShaperValues = {}
    for (const axis of ['x', 'y'] as ShaperAxis[]) {
        const rec = recommendations[axis]
        if (!rec) continue
        values[`type_${axis}` as ShaperKey] = rec.type
        values[`freq_${axis}` as ShaperKey] = rec.freq
        if (rec.damping !== null) values[`damping_${axis}` as ShaperKey] = rec.damping
    }
    return values
}

// Reads the current values of a target from klipper's parsed configfile settings
export function readTargetValues(settings: Record<string, unknown> | undefined, target: ShaperTarget) {
    const values: ShaperValues = {}
    for (const key of shaperKeys) {
        const raw = settings?.[target.keys[key]]
        if (raw === undefined || raw === null || raw === '') continue

        const value = String(raw).replace(/^['"]|['"]$/g, '')
        values[key] = key.startsWith('type') ? value.toLowerCase() : parseFloat(value)
    }
    return values
}

// Rounded the way they are written to the config, so saved and loaded values compare equal
export function roundShaperValues(values: ShaperValues): ShaperValues {
    const rounded: ShaperValues = {}
    for (const key of shaperKeys) {
        const value = values[key]
        if (value === undefined || value === null || value === '') continue
        if (key.startsWith('type')) rounded[key] = String(value).toLowerCase()
        else
            rounded[key] =
                Math.round(Number(value) * (key.startsWith('damping') ? 1000 : 10)) /
                (key.startsWith('damping') ? 1000 : 10)
    }
    return rounded
}

export function valuesDiffer(a: ShaperValues, b: ShaperValues): boolean {
    const ra = roundShaperValues(a)
    const rb = roundShaperValues(b)
    return shaperKeys.some((key) => ra[key] !== undefined && rb[key] !== undefined && ra[key] !== rb[key])
}

// Values klipper accepts; anything else would keep klipper from starting after a restart
export function shaperValuesValid(values: ShaperValues): boolean {
    return shaperKeys.every((key) => {
        const value = values[key]
        if (value === undefined || value === null || value === '') return false
        if (key.startsWith('type')) return shaperTypes.includes(String(value).toLowerCase())
        const number = Number(value)
        if (!isFinite(number)) return false
        return key.startsWith('damping') ? number > 0 && number < 1 : number >= 0
    })
}

export interface ConfigChange {
    file: string
    key: string
    line: number | null
    oldValue: string | null
    newValue: string
}

function escapeRegex(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sectionPattern(section: string) {
    const name = section.trim().split(/\s+/).map(escapeRegex).join('\\s+')
    return `\\[\\s*${name}\\s*\\]`
}

export function sectionRegex(section: string) {
    return new RegExp(`^${sectionPattern(section)}`, 'i')
}

// the SAVE_CONFIG block at the end of printer.cfg, e.g. "#*# [input_shaper]"
export function autosaveSectionRegex(section: string) {
    return new RegExp(`^#\\*#\\s*${sectionPattern(section)}`, 'i')
}

export function formatConfigValue(key: ShaperKey, value: string | number, quoteType: boolean) {
    if (key.startsWith('type')) return quoteType ? `'${String(value).toLowerCase()}'` : String(value).toLowerCase()
    if (key.startsWith('damping')) return Number(value).toFixed(3)
    return String(Math.round(Number(value) * 10) / 10)
}

interface Region {
    file: number
    start: number
    end: number
    autosave: boolean
}

interface ParsedFile {
    path: string
    eol: string
    lines: string[]
}

// every occurrence of the section in a file; klipper merges them and the last value of a key wins
function findRegions(file: ParsedFile, index: number, section: string, autosave: boolean): Region[] {
    const header = autosave ? autosaveSectionRegex(section) : sectionRegex(section)
    // a normal section also ends where the SAVE_CONFIG block starts
    const next = autosave ? /^#\*#\s*\[/ : /^(\[|#\*#)/
    const regions: Region[] = []

    file.lines.forEach((line, start) => {
        if (!header.test(line)) return
        let end = file.lines.findIndex((other, i) => i > start && next.test(other))
        if (end === -1) end = file.lines.length
        regions.push({ file: index, start, end, autosave })
    })
    return regions
}

function keyRegex(name: string, autosave: boolean) {
    return autosave
        ? new RegExp(`^(#\\*#\\s*${escapeRegex(name)}\\s*[:=]\\s*)(.*?)\\s*$`, 'i')
        : new RegExp(`^(${escapeRegex(name)}\\s*[:=]\\s*)(.*?)(\\s+[#;].*)?$`, 'i')
}

function findKey(files: ParsedFile[], region: Region, name: string) {
    const regex = keyRegex(name, region.autosave)
    const lines = files[region.file].lines
    for (let i = region.start + 1; i < region.end; i++) {
        const match = lines[i].match(regex)
        if (!match) continue

        // a value can continue on indented lines below the key
        let continuation = 0
        while (!region.autosave && i + 1 + continuation < region.end && /^[ \t]+\S/.test(lines[i + 1 + continuation]))
            continuation++
        return { index: i, match, continuation }
    }
    return null
}

// Plans writing shaper values into klipper config files, keeping comments and everything else untouched.
// `input` must be in klipper's parse order. Each key is changed where klipper reads it from: the
// SAVE_CONFIG block at the end of printer.cfg when it's there, else the last occurrence of the section.
// Missing keys are added to the last normal section (or the SAVE_CONFIG block when there is none).
export function planShaperSave(input: { path: string; text: string }[], target: ShaperTarget, values: ShaperValues) {
    const files: ParsedFile[] = input.map((file) => ({
        path: file.path,
        eol: file.text.includes('\r\n') ? '\r\n' : '\n',
        lines: file.text.split(/\r?\n/),
    }))
    const regions = (autosave: boolean) =>
        files.flatMap((file, index) => findRegions(file, index, target.section, autosave))
    const lastMainRegion = () => regions(false).pop()
    const found = !!(lastMainRegion() ?? regions(true)[0])

    const changes: ConfigChange[] = []
    const additions: { name: string; value: string }[] = []

    // keeps the line numbers of earlier changes right when lines are added or removed
    const shiftChanges = (path: string, from: number, count: number) =>
        changes.forEach((change) => {
            if (change.file === path && change.line !== null && change.line > from) change.line += count
        })

    for (const key of shaperKeys) {
        const value = values[key]
        if (value === undefined || value === null || value === '') continue

        // regions are looked up again for every key, as removed continuation lines move them
        const name = target.keys[key]
        let hit: { region: Region; index: number; match: RegExpMatchArray; continuation: number } | null = null
        for (const region of [...regions(true), ...regions(false).reverse()]) {
            const keyHit = findKey(files, region, name)
            if (keyHit) {
                hit = { region, ...keyHit }
                break
            }
        }

        // values in the SAVE_CONFIG block are written the way klipper writes them there
        const autosave = hit?.region.autosave ?? !lastMainRegion()
        const newValue = formatConfigValue(key, value, target.quoteType && !autosave)

        if (!hit) {
            additions.push({ name, value: newValue })
            continue
        }

        const file = files[hit.region.file]
        const continuationLines = file.lines.slice(hit.index + 1, hit.index + 1 + hit.continuation)
        const oldValue = [hit.match[2], ...continuationLines]
            .map((part) => part.trim())
            .filter(Boolean)
            .join(' ')
        if (oldValue === newValue && !hit.continuation) continue

        changes.push({ file: file.path, key: name, line: hit.index + 1, oldValue, newValue })
        // "key:" with its value on the next line has no space after the separator yet
        const prefix = /\s$/.test(hit.match[1]) ? hit.match[1] : `${hit.match[1]} `
        file.lines[hit.index] = prefix + newValue + (hit.match[3] ?? '')
        if (hit.continuation) {
            file.lines.splice(hit.index + 1, hit.continuation)
            shiftChanges(file.path, hit.index + 1, -hit.continuation)
        }
    }

    const addRegion = lastMainRegion() ?? regions(true)[0]
    if (additions.length && addRegion) {
        const file = files[addRegion.file]
        let insertAt = addRegion.start + 1
        for (const name of Object.values(target.keys)) {
            const keyHit = findKey(files, addRegion, name)
            if (keyHit) insertAt = Math.max(insertAt, keyHit.index + 1 + keyHit.continuation)
        }
        if (insertAt === addRegion.start + 1 && !addRegion.autosave) {
            // after the last non empty line of the section
            insertAt = addRegion.end
            while (insertAt > addRegion.start + 1 && file.lines[insertAt - 1].trim() === '') insertAt--
        }

        const lines = additions.map((add) =>
            addRegion.autosave ? `#*# ${add.name} = ${add.value}` : `${add.name}: ${add.value}`
        )
        file.lines.splice(insertAt, 0, ...lines)
        shiftChanges(file.path, insertAt, lines.length)
        additions.forEach((add) =>
            changes.push({ file: file.path, key: add.name, line: null, oldValue: null, newValue: add.value })
        )
    }

    const changedFiles = new Set(changes.map((change) => change.file))
    return {
        found,
        changes,
        files: files
            .filter((file) => changedFiles.has(file.path))
            .map((file) => ({ path: file.path, text: file.lines.join(file.eol) })),
    }
}

// Single file version of planShaperSave
export function applyShaperValues(text: string, target: ShaperTarget, values: ShaperValues) {
    const plan = planShaperSave([{ path: '', text }], target, values)
    if (!plan.found) throw new Error(`Section [${target.section}] not found`)

    return { text: plan.files[0]?.text ?? text, changes: plan.changes }
}

// Klipper [include] lines of a config file, resolved relative to the file's folder
export function parseIncludes(text: string, filePath: string): string[] {
    const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/') + 1) : ''
    const includes: string[] = []
    for (const match of text.matchAll(/^\[include\s+([^\]]+?)\s*\]/gim)) {
        const parts = (dir + match[1]).split('/')
        const resolved: string[] = []
        for (const part of parts) {
            if (part === '..') resolved.pop()
            else if (part !== '.' && part !== '') resolved.push(part)
        }
        includes.push(resolved.join('/'))
    }
    return includes
}

export function globToRegex(glob: string) {
    const pattern = glob
        .split('')
        .map((char) => {
            if (char === '*') return '[^/]*'
            if (char === '?') return '[^/]'
            return escapeRegex(char)
        })
        .join('')
    return new RegExp(`^${pattern}$`)
}

// Shake&Tune file names look like inputshaper_20250824_120410_axis_X.png
export function parseResultTimestamp(filename: string): number | null {
    const match = filename.match(/_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/)
    if (!match) return null
    const [, y, mo, d, h, mi, s] = match.map(Number)
    return new Date(y, mo - 1, d, h, mi, s).getTime()
}

export function resultGroupKey(filename: string) {
    const name = filename.slice(filename.lastIndexOf('/') + 1)
    return name.replace(/(_axis_[xy])?\.png$/i, '')
}

export function resultAxis(filename: string): ShaperAxis | null {
    const match = filename.match(/_axis_([xy])\.png$/i)
    return match ? (match[1].toLowerCase() as ShaperAxis) : null
}

// The interesting part of a run's console output, without Shake&Tune's bookkeeping messages
export function summaryLines(log: string[]) {
    const noise = [
        /^Shake&Tune version/i,
        /^Warning: unable to retrieve Shake&Tune version/i,
        /^(Disabled|Re-enabled) \[input_shaper\]/i,
        /graphs created successfully/i,
        /generation\.\.\.$/i,
    ]
    return log.filter((line) => !noise.some((regex) => regex.test(line)))
}

export const accelChipRegex = /^(adxl345|lis2dw|lis3dh|mpu9250|mpu6050|icm20948|bmi160)(\s|$)/i

function mcuOfPin(pin: string | undefined) {
    if (!pin) return null
    return pin.includes(':')
        ? pin
              .split(':')[0]
              .replace(/^[!^~\s]+/, '')
              .trim()
        : 'mcu'
}

// The accelerometer of a tool: named after the tool (e.g. [adxl345 T0]), or else the one on the same
// MCU as the tool's extruder (setups where every tool file has a plain [adxl345])
export function findToolAccelChip(config: Record<string, Record<string, string>>, toolSection: string) {
    const label = toolSection.replace(/^tool\s+/i, '').toLowerCase()
    const chips = Object.keys(config).filter((name) => accelChipRegex.test(name))

    const byName = chips.find((chip) => chip.split(/\s+/)[1]?.toLowerCase() === label)
    if (byName) return byName

    const extruder = config[toolSection]?.extruder
    const toolMcu = mcuOfPin(extruder ? config[extruder]?.step_pin : undefined)
    if (!toolMcu || toolMcu === 'mcu') return null

    return (
        chips.find((chip) => {
            const settings = config[chip] ?? {}
            return mcuOfPin(settings.cs_pin ?? (settings.i2c_mcu ? `${settings.i2c_mcu}:` : undefined)) === toolMcu
        }) ?? null
    )
}
