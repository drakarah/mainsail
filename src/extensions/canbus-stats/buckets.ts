// # canbus-stats/buckets.ts — 2-second bucket time-series aggregation for CAN bus / MCU stats
// # Why: ports the aggregation engine of the standalone klipper-comm-tracking dashboard
// # (stats.html) into Mainsail: raw moonraker status updates are aggregated into 2 s buckets
// # ('last' for cumulative counters, 'avg' for level/rate values) so long histories stay
// # memory-bounded while preserving correlation with prints.

// aggregation window size in ms
export const BUCKET_MS = 2_000

// gaps larger than this are real gaps (sleep, reconnect, clock skip), not omitted
// moonraker updates — carry-forward fill is capped to avoid fabricating millions of points
export const MAX_CARRY_MS = BUCKET_MS * 10

// 12 h of history — prune threshold (same as the standalone dashboard)
export const HISTORY_MS = 12 * 60 * 60 * 1000

// max points kept per series (HISTORY_MS / BUCKET_MS)
export const MAX_BUCKETS = HISTORY_MS / BUCKET_MS

export type BucketMode = 'last' | 'avg'

export interface Point {
    x: number
    y: number
}

// mutable per-series accumulator; one instance per (device, stat) pair, held outside vuex state
export interface BucketAccumulator {
    mode: BucketMode
    bucketEnd: number
    acc: number
    count: number
    lastEmitted: number
}

export interface StatDef {
    // object field key in the moonraker status (inside `last_stats` for mcu objects)
    key: string
    // i18n key of the short chart/legend label (translated in the UI layer)
    labelKey: string
    // i18n key of the y-axis unit label
    yLabelKey: string
    // 'last' for cumulative counters, 'avg' for level/rate values
    mode: BucketMode
    // optional unit conversion applied before storing
    scale?: (v: number) => number
    // line color
    color: string
    // i18n key of the tooltip describing the stat
    tooltipKey: string
}

// ported verbatim from klipper-comm-tracking/stats.html
export const MCU_STAT_DEFS: StatDef[] = [
    {
        key: 'bytes_retransmit',
        labelKey: 'CanbusStats.Labels.BytesRetransmit',
        yLabelKey: 'CanbusStats.Units.Bytes',
        mode: 'last',
        color: '#f28c28',
        tooltipKey: 'CanbusStats.Tooltips.BytesRetransmit',
    },
    {
        key: 'bytes_invalid',
        labelKey: 'CanbusStats.Labels.BytesInvalid',
        yLabelKey: 'CanbusStats.Units.Bytes',
        mode: 'last',
        color: '#e74c3c',
        tooltipKey: 'CanbusStats.Tooltips.BytesInvalid',
    },
    {
        key: 'retransmit_seq',
        labelKey: 'CanbusStats.Labels.RetransmitSeqs',
        yLabelKey: 'CanbusStats.Units.Seqs',
        mode: 'last',
        color: '#f1c40f',
        tooltipKey: 'CanbusStats.Tooltips.RetransmitSeqs',
    },
    {
        key: 'bytes_write',
        labelKey: 'CanbusStats.Labels.BytesWrite',
        yLabelKey: 'CanbusStats.Units.Bytes',
        mode: 'last',
        color: '#4d9de0',
        tooltipKey: 'CanbusStats.Tooltips.BytesWrite',
    },
    {
        key: 'bytes_read',
        labelKey: 'CanbusStats.Labels.BytesRead',
        yLabelKey: 'CanbusStats.Units.Bytes',
        mode: 'last',
        color: '#00d4aa',
        tooltipKey: 'CanbusStats.Tooltips.BytesRead',
    },
    {
        key: 'mcu_awake',
        labelKey: 'CanbusStats.Labels.McuAwake',
        yLabelKey: 'CanbusStats.Units.Percent',
        mode: 'avg',
        scale: (v) => v * 100,
        color: '#9b59b6',
        tooltipKey: 'CanbusStats.Tooltips.McuAwake',
    },
    {
        key: 'mcu_task_avg',
        labelKey: 'CanbusStats.Labels.TaskAvg',
        yLabelKey: 'CanbusStats.Units.Microseconds',
        mode: 'avg',
        scale: (v) => v * 1e6,
        color: '#3498db',
        tooltipKey: 'CanbusStats.Tooltips.TaskAvg',
    },
    {
        key: 'mcu_task_stddev',
        labelKey: 'CanbusStats.Labels.TaskStddev',
        yLabelKey: 'CanbusStats.Units.Microseconds',
        mode: 'avg',
        scale: (v) => v * 1e6,
        color: '#2980b9',
        tooltipKey: 'CanbusStats.Tooltips.TaskStddev',
    },
    {
        key: 'srtt',
        labelKey: 'CanbusStats.Labels.Srtt',
        yLabelKey: 'CanbusStats.Units.Milliseconds',
        mode: 'avg',
        scale: (v) => v * 1000,
        color: '#00d4aa',
        tooltipKey: 'CanbusStats.Tooltips.Srtt',
    },
    {
        key: 'rto',
        labelKey: 'CanbusStats.Labels.Rto',
        yLabelKey: 'CanbusStats.Units.Milliseconds',
        mode: 'avg',
        scale: (v) => v * 1000,
        color: '#f28c28',
        tooltipKey: 'CanbusStats.Tooltips.Rto',
    },
]

// ported verbatim from klipper-comm-tracking/stats.html
export const CANBUS_STAT_DEFS: StatDef[] = [
    {
        key: 'rx_error',
        labelKey: 'CanbusStats.Labels.RxErrors',
        yLabelKey: 'CanbusStats.Units.Count',
        mode: 'last',
        color: '#e74c3c',
        tooltipKey: 'CanbusStats.Tooltips.RxErrors',
    },
    {
        key: 'tx_error',
        labelKey: 'CanbusStats.Labels.TxErrors',
        yLabelKey: 'CanbusStats.Units.Count',
        mode: 'last',
        color: '#f28c28',
        tooltipKey: 'CanbusStats.Tooltips.TxErrors',
    },
    {
        key: 'tx_retries',
        labelKey: 'CanbusStats.Labels.TxRetries',
        yLabelKey: 'CanbusStats.Units.Count',
        mode: 'last',
        color: '#f1c40f',
        tooltipKey: 'CanbusStats.Tooltips.TxRetries',
    },
]

export const HOST_STAT_DEFS: StatDef[] = [
    {
        key: 'sysload',
        labelKey: 'CanbusStats.Labels.SysLoad',
        yLabelKey: 'CanbusStats.Units.None',
        mode: 'avg',
        color: '#00d4aa',
        tooltipKey: 'CanbusStats.Tooltips.SysLoad',
    },
    {
        key: 'mem_avail',
        labelKey: 'CanbusStats.Labels.MemoryAvailable',
        yLabelKey: 'CanbusStats.Units.Mebibytes',
        mode: 'avg',
        scale: (v) => v / 1024,
        color: '#9b59b6',
        tooltipKey: 'CanbusStats.Tooltips.MemoryAvailable',
    },
]

export const SENSOR_STAT_DEFS: StatDef[] = [
    {
        key: 'temperature',
        labelKey: 'CanbusStats.Labels.Temperature',
        yLabelKey: 'CanbusStats.Units.DegreesCelsius',
        mode: 'avg',
        color: '#f28c28',
        tooltipKey: 'CanbusStats.Tooltips.Temperature',
    },
]

export const HEATER_STAT_DEFS: StatDef[] = [
    {
        key: 'power',
        labelKey: 'CanbusStats.Labels.HeaterPower',
        yLabelKey: 'CanbusStats.Units.None',
        mode: 'avg',
        color: '#e74c3c',
        tooltipKey: 'CanbusStats.Tooltips.HeaterPower',
    },
]

// color palette for the "by stat" multi-device charts (one color per device)
export const DEVICE_PALETTE = [
    '#4d9de0',
    '#00d4aa',
    '#f28c28',
    '#e74c3c',
    '#9b59b6',
    '#f1c40f',
    '#1abc9c',
    '#e67e22',
    '#3498db',
    '#2ecc71',
    '#e91e63',
    '#00bcd4',
]

// Create a bucket-series accumulator, aligned to the next BUCKET_MS boundary on first use.
export function makeBuckets(mode: BucketMode): BucketAccumulator {
    return { mode, bucketEnd: 0, acc: 0, count: 0, lastEmitted: 0 }
}

/**
 * Close every completed bucket of the accumulator, carrying forward the last value across
 * empty buckets. No sample is added — use feedBuckets when a value is being recorded.
 * @returns an array of {x, y} points for every bucket that just completed (x = bucket start ts).
 */
export function flushBuckets(b: BucketAccumulator, ts: number): Point[] {
    const pts: Point[] = []

    if (b.bucketEnd === 0) {
        // Align the first bucket end to the next BUCKET_MS boundary
        b.bucketEnd = (Math.floor(ts / BUCKET_MS) + 1) * BUCKET_MS
    }

    if (ts - b.bucketEnd > MAX_CARRY_MS) {
        // huge gap (e.g. machine slept, websocket reconnected): the series just stops
        // at the old data and resumes from now — no fabricated fill points
        b.bucketEnd = (Math.floor(ts / BUCKET_MS) + 1) * BUCKET_MS
        return pts
    }

    while (ts >= b.bucketEnd) {
        let y: number
        if (b.count === 0) {
            y = b.lastEmitted // no samples this bucket: carry forward last known value
        } else if (b.mode === 'avg') {
            y = b.acc / b.count
        } else {
            y = b.acc // 'last': acc holds the most-recent value seen this bucket
        }
        b.lastEmitted = y
        pts.push({ x: b.bucketEnd - BUCKET_MS, y })
        b.bucketEnd += BUCKET_MS
        b.acc = 0
        b.count = 0
    }

    return pts
}

/**
 * Feed one raw value into a bucket accumulator.
 * @returns an array of {x, y} points for every bucket that just completed (x = bucket start ts).
 * Empty buckets carry forward the last emitted value so cumulative counters don't dip.
 */
export function feedBuckets(b: BucketAccumulator, ts: number, value: number): Point[] {
    const pts = flushBuckets(b, ts)

    // Accumulate into the current (open) bucket
    if (b.mode === 'last') {
        b.acc = value // overwrite — keep only the most-recent value seen this bucket
    } else {
        b.acc += value
    }
    b.count++

    return pts
}

/**
 * Feed a raw value into a series, appending every completed bucket point.
 * Monotonic guard: points that would go backward (x <= last point's x) are skipped.
 * Trims the series to MAX_BUCKETS.
 * @returns true when at least one point was appended.
 */
export function pushBucketed(series: Point[], b: BucketAccumulator, ts: number, value: number): boolean {
    const pts = feedBuckets(b, ts, value)
    if (pts.length === 0) return false

    let added = false
    for (const p of pts) {
        if (series.length === 0 || p.x > series[series.length - 1].x) {
            series.push(p)
            added = true
        }
    }
    while (series.length > MAX_BUCKETS) series.shift()

    return added
}

/**
 * Check whether a klippy object name is tracked by this extension.
 * @returns true when status updates for this object are recorded into the buffers.
 */
export function isTrackedObject(name: string): boolean {
    return (
        name === 'mcu' ||
        name.startsWith('mcu ') ||
        name === 'canbus_stats' ||
        name.startsWith('canbus_stats ') ||
        name === 'system_stats' ||
        name.startsWith('temperature_sensor') ||
        name === 'extruder' ||
        /^extruder\d+$/.test(name) ||
        name === 'heater_bed'
    )
}