// # canbus-stats/store.ts — vuex module + time-series buffers for the Canbus stats page
// # Why: the extension framework routes/visibility only reach root getters, so a small
// # runtime-registered module exposes the `canbusPresent` flag (nav visibility) and a
// # `revision` counter (chart refresh). The series buffers themselves live outside vuex state
// # on purpose: with 12 h of 2 s buckets per device/stat they would be too large to make
// # reactive — components re-read them on revision changes.

import { Module } from 'vuex'
import type { Store } from 'vuex'
import type { RootState } from '@/store/types'
import { BUCKET_MS, CANBUS_STAT_DEFS, flushBuckets, HISTORY_MS, isTrackedObject, makeBuckets, MAX_BUCKETS, MCU_STAT_DEFS, pushBucketed, type BucketAccumulator, type BucketMode, type Point } from './buckets'

// persistence key — deliberately separate from the standalone dashboard's `kct_v2`
export const STORAGE_KEY = 'mainsail_canbus_stats_v1'

const PERSIST_INTERVAL_MS = 30_000

// only the most recent 30 min is persisted — a full 12 h of buckets for every
// device/stat can exceed the ~5 MB localStorage quota on multi-MCU systems
// (a worst-case ~100-series setup would serialize ~4 MB even in one hour).
// Memory keeps the full 12 h history; this is only the reload-survival copy.
export const PERSIST_WINDOW_MS = 30 * 60 * 1000

export type DeviceSeries = Record<string, Point[]>

// deviceKey → series; deliberately not vue-reactive
let buffers: Record<string, DeviceSeries> = {}

// `${deviceKey}|${statKey}` → accumulator, kept outside vuex state as well
const accumulators = new Map<string, BucketAccumulator>()

let persistTimer: number | null = null
let persistDirty = false

/**
 * Get the current series buffers (read-only view for components).
 * @returns map of device object name → stat key → point series.
 */
export function getBuffers(): Record<string, DeviceSeries> {
    return buffers
}

/**
 * Drop every series and reset the presence flag. Used by the page's "Clear data" button.
 */
export function resetBuffers(): void {
    buffers = {}
    accumulators.clear()
}

export interface CanbusStatsState {
    // true when at least one canbus_stats* moonraker object is present
    canbusPresent: boolean
    // bumped once per processed status update; charts watch this
    revision: number
}

export interface CanbusStatsGetters {
    hasCanbusStats: boolean
    revision: number
}

/**
 * Build the namespaced `canbusStats` vuex module.
 * @returns the module to register on the root store.
 */
export function canbusStatsModule(): Module<CanbusStatsState, RootState> {
    return {
        namespaced: true,
        state: () => ({ canbusPresent: false, revision: 0 }),
        mutations: {
            setCanbusPresent(state: CanbusStatsState, present: boolean) {
                state.canbusPresent = present
            },
            bumpRevision(state: CanbusStatsState) {
                state.revision++
            },
        },
        getters: {
            hasCanbusStats: (state: CanbusStatsState): boolean => state.canbusPresent,
            revision: (state: CanbusStatsState): number => state.revision,
        },
    }
}

/**
 * Register the canbusStats module on the given store. Idempotent (dev HMR safety).
 * @pre store is the mainsail root store
 */
export function registerCanbusStatsStore(store: Store<RootState>): void {
    if (store.hasModule('canbusStats')) return
    store.registerModule('canbusStats', canbusStatsModule())
}

/**
 * Record one raw sample for a device/stat pair, aggregating it into its bucket series.
 * Applies the optional unit scale, flushes completed buckets, bumps the revision
 * (once per call batch — see notifyRevision) and marks persistence dirty.
 * @returns true when at least one new point entered the series.
 */
export function recordSample(
    deviceKey: string,
    statKey: string,
    mode: BucketMode,
    scale: ((v: number) => number) | undefined,
    ts: number,
    value: number
): boolean {
    const scaled = scale ? scale(value) : value
    const accKey = `${deviceKey}|${statKey}`
    let acc = accumulators.get(accKey)
    if (!acc) {
        acc = makeBuckets(mode)
        accumulators.set(accKey, acc)
    }

    let perDevice = buffers[deviceKey]
    if (!perDevice) {
        perDevice = {}
        buffers[deviceKey] = perDevice
    }
    let series = perDevice[statKey]
    if (!series) {
        series = []
        perDevice[statKey] = series
    }

    const added = pushBucketed(series, acc, ts, scaled)
    if (added) persistDirty = true

    return added
}


/**
 * Get the canbusStats module's revision counter through the typed store.
 * The module is registered at runtime, so the getter name is not part of RootState' typing;
 * components use this helper instead of an index cast.
 * @returns the current revision number (0 when the module is missing).
 */
export function getCanbusRevision(store: Store<RootState>): number {
    const getters = store.getters as Record<string, unknown>
    return typeof getters['canbusStats/revision'] === 'number' ? getters['canbusStats/revision'] : 0
}

/**
 * Get the canbusStats presence flag through the typed store.
 * @returns true when at least one canbus_stats object is present.
 */
export function hasCanbusStats(store: Store<RootState>): boolean {
    const getters = store.getters as Record<string, unknown>
    return getters['canbusStats/hasCanbusStats'] === true
}

/**
 * Bump the vuex revision counter so chart components re-read the buffers.
 * @pre module registered on the store
 */
export function notifyRevision(store: Store<RootState>): void {
    store.commit('canbusStats/bumpRevision', undefined, { root: true })
}

/**
 * Route one `printer/setData` payload (a notify_status_update snapshot) into the buffers.
 * Only fields actually present in the payload are recorded — moonraker omits unchanged
 * fields, and the carry-forward logic in feedBuckets keeps last-known values alive.
 * @returns true when the payload contained any recorded sample.
 */
export function handleStatusPayload(store: Store<RootState>, payload: Record<string, unknown>, ts: number): boolean {
    let changed = false

    for (const [name, raw] of Object.entries(payload)) {
        if (!isTrackedObject(name)) continue

        const data = raw as Record<string, unknown>
        if (!data || typeof data !== 'object') continue

        if (name.startsWith('canbus_stats')) {
            changed = handleCanbusStats(store, name, data, ts) || changed
        } else if (name.startsWith('mcu')) {
            const stats = data.last_stats as Record<string, unknown> | undefined
            if (stats) changed = handleMcuStats(store, name, stats, ts) || changed
        } else if (name === 'system_stats') {
            changed = handleSystemStats(store, data, ts) || changed
        } else if (name.startsWith('temperature_sensor')) {
            const t = data.temperature
            if (typeof t === 'number') changed = recordSample(name, 'temperature', 'avg', undefined, ts, t) || changed
        } else if (name === 'extruder' || /^extruder\d+$/.test(name) || name === 'heater_bed') {
            const p = data.power
            if (typeof p === 'number') changed = recordSample(name, 'power', 'avg', undefined, ts, p) || changed
        }
    }

    // moonraker omits unchanged fields, so a series can miss its own flush opportunity —
    // close every device's buckets on each payload (the standalone's global-timer equivalent)
    for (const dev of Object.keys(buffers)) {
        changed = flushDeviceSeries(dev, ts) || changed
    }

    if (changed) notifyRevision(store)

    return changed
}

/**
 * Close completed buckets for every series of one device, appending the points.
 * @returns true when at least one new point was added anywhere in the device.
 */
function flushDeviceSeries(dev: string, ts: number): boolean {
    const perStat = buffers[dev]
    if (!perStat) return false

    let changed = false
    for (const [statKey, series] of Object.entries(perStat)) {
        const acc = accumulators.get(`${dev}|${statKey}`)
        if (!acc) continue

        for (const p of flushBuckets(acc, ts)) {
            if (series.length === 0 || p.x > series[series.length - 1].x) {
                series.push(p)
                changed = true
            }
        }
        while (series.length > MAX_BUCKETS) {
            series.shift()
            changed = true
        }
    }

    return changed
}

/**
 * Record the canbus stat fields of one canbus_stats object and mark the presence flag.
 * @returns true when at least one value was recorded.
 */
function handleCanbusStats(store: Store<RootState>, name: string, data: Record<string, unknown>, ts: number): boolean {
    store.commit('canbusStats/setCanbusPresent', true, { root: true })

    let changed = false
    for (const def of CANBUS_STAT_DEFS) {
        const v = data[def.key]
        if (typeof v === 'number') changed = recordSample(name, def.key, def.mode, def.scale, ts, v) || changed
    }

    return changed
}

/**
 * Record the last_stats fields of one mcu object.
 * @returns true when at least one value was recorded.
 */
function handleMcuStats(store: Store<RootState>, name: string, stats: Record<string, unknown>, ts: number): boolean {
    let changed = false
    for (const def of MCU_STAT_DEFS) {
        const v = stats[def.key]
        if (typeof v === 'number') changed = recordSample(name, def.key, def.mode, def.scale, ts, v) || changed
    }

    return changed
}

/**
 * Record host system stats.
 * @returns true when at least one value was recorded.
 */
function handleSystemStats(store: Store<RootState>, data: Record<string, unknown>, ts: number): boolean {
    let changed = false
    const sysload = data.sysload
    if (typeof sysload === 'number') changed = recordSample('system_stats', 'sysload', 'avg', undefined, ts, sysload) || changed
    const mem = data.mem_avail
    if (typeof mem === 'number') changed = recordSample('system_stats', 'mem_avail', 'avg', (v) => v / 1024, ts, mem) || changed

    return changed
}


/**
 * Serialize the current buffers to localStorage (throttled caller). Only the most recent
 * PERSIST_WINDOW_MS of history is written, so the payload stays far below the browser
 * quota. On write failure the dirty flag is cleared — retrying the identical write every
 * tick would only spam the console.
 * @pre document/localStorage available; corrupt state is never thrown.
 */
export function persistNow(): void {
    if (typeof window === 'undefined') return

    try {
        const cutoff = Date.now() - PERSIST_WINDOW_MS
        const serialized: Record<string, Record<string, [number, number][]>> = {}
        for (const [device, perStat] of Object.entries(buffers)) {
            const perDevice: Record<string, [number, number][]> = {}
            for (const [stat, series] of Object.entries(perStat)) {
                // keep only the recent window in the persisted copy (memory keeps all)
                const pts = series.filter((p) => p.x >= cutoff).map((p) => [p.x, p.y] as [number, number])
                if (pts.length > 0) perDevice[stat] = pts
            }
            if (Object.keys(perDevice).length > 0) serialized[device] = perDevice
        }
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), series: serialized }))
        persistDirty = false
    } catch (e) {
        window.console.error('canbus stats: could not persist history', e)
        persistDirty = false
    }
}

/**
 * Check that a persisted series is an array of strict [finite x, finite y] pairs.
 */
function isPointArray(value: unknown): value is [number, number][] {
    if (!Array.isArray(value)) return false

    return value.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
}

/**
 * Load persisted buffers back into the buffers and recreate accumulators with a forward
 * bucketEnd (so the next feedBuckets call cannot emit phantom backward-dated points).
 * @pre document/localStorage available; silently does nothing on missing/corrupt storage.
 */
export function restoreFromStorage(): void {
    if (typeof window === 'undefined') return

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return

        const parsed = JSON.parse(raw) as { version?: number; series?: Record<string, Record<string, unknown>> }
        if (parsed?.version !== 1 || typeof parsed.series !== 'object' || parsed.series === null) return

        const now = Date.now()
        const cutoff = now - HISTORY_MS
        for (const [device, perStat] of Object.entries(parsed.series)) {
            if (typeof perStat !== 'object' || perStat === null) continue
            const perDevice: DeviceSeries = {}
            for (const [stat, pts] of Object.entries(perStat)) {
                if (!isPointArray(pts)) continue
                const series: Point[] = pts.map(([x, y]) => ({ x, y }))
                // prune anything older than the history window
                while (series.length > 0 && series[0].x < cutoff) series.shift()
                if (series.length === 0) continue
                perDevice[stat] = series

                const acc = makeBuckets(statModeForKey(stat))
                acc.bucketEnd = (Math.floor(now / BUCKET_MS) + 1) * BUCKET_MS
                // seed the carry-forward value so the first bucket close after a reload
                // emits the last known value instead of a spurious drop to zero
                acc.lastEmitted = series[series.length - 1].y
                accumulators.set(`${device}|${stat}`, acc)
            }

            if (Object.keys(perDevice).length > 0) buffers[device] = perDevice
        }
    } catch (e) {
        window.console.error('canbus stats: could not restore history', e)
    }
}

/**
 * Look up the bucket mode used for a given stat key (defaults to 'avg').
 */
function statModeForKey(statKey: string): BucketMode {
    for (const defs of [CANBUS_STAT_DEFS, MCU_STAT_DEFS]) {
        for (const def of defs) {
            if (def.key === statKey) return def.mode
        }
    }

    return 'avg'
}

/**
 * Start the throttled persistence timer (30 s). Idempotent.
 */
export function startPersistenceThrottle(): void {
    if (persistTimer !== null || typeof window === 'undefined') return

    persistTimer = window.setInterval(() => {
        if (persistDirty) persistNow()
    }, PERSIST_INTERVAL_MS)
}

/**
 * Stop the throttled persistence timer and flush any pending data.
 */
export function stopPersistenceThrottle(): void {
    if (persistTimer === null) return

    window.clearInterval(persistTimer)
    persistTimer = null
    if (persistDirty) persistNow()
}