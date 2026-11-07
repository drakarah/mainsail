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

export type BucketMode = 'last' | 'avg' | 'sum'

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
    // short chart/legend label
    label: string
    // y-axis unit label
    yLabel: string
    // 'last' for cumulative counters, 'avg' for level/rate values
    mode: BucketMode
    // optional unit conversion applied before storing
    scale?: (v: number) => number
    // line color
    color: string
    // tooltip describing the stat
    tooltip: string
}

// ported verbatim from klipper-comm-tracking/stats.html
export const MCU_STAT_DEFS: StatDef[] = [
    {
        key: 'bytes_retransmit',
        label: 'Retransmit bytes',
        yLabel: 'bytes',
        mode: 'last',
        color: '#f28c28',
        tooltip:
            'Cumulative bytes retransmitted to the MCU because an acknowledgement was not received before the RTO timer expired (host→MCU direction). Any increase indicates packet loss — check USB cable quality, CPU load, and MCU power supply.',
    },
    {
        key: 'bytes_invalid',
        label: 'Invalid bytes',
        yLabel: 'bytes',
        mode: 'last',
        color: '#e74c3c',
        tooltip:
            'Cumulative bytes received from the MCU that were discarded — either because they failed the CRC check (bit errors caused by electrical noise or a defective cable) or because they arrived with an unexpected sequence number. Any non-zero value warrants investigation.',
    },
    {
        key: 'retransmit_seq',
        label: 'Retransmit seqs',
        yLabel: 'seqs',
        mode: 'last',
        color: '#f1c40f',
        tooltip:
            'The outgoing sequence number (send_seq) at the time of the most recent retransmit event. When this value changes, a retransmit just occurred. Use together with retransmit bytes to assess link reliability.',
    },
    {
        key: 'bytes_write',
        label: 'Bytes written',
        yLabel: 'bytes',
        mode: 'last',
        color: '#4d9de0',
        tooltip:
            'Cumulative bytes sent from the Klipper host to the MCU since the process started. Monotonically increasing.',
    },
    {
        key: 'bytes_read',
        label: 'Bytes read',
        yLabel: 'bytes',
        mode: 'last',
        color: '#00d4aa',
        tooltip:
            'Cumulative bytes received by the Klipper host from the MCU since the process started. Monotonically increasing.',
    },
    {
        key: 'mcu_awake',
        label: 'MCU awake %',
        yLabel: '%',
        mode: 'avg',
        scale: (v) => v * 100,
        color: '#9b59b6',
        tooltip:
            'Percentage of time the MCU spent outside its idle/sleep loop. Low values are normal. Sustained high values indicate the MCU is heavily loaded and may be unable to service all scheduled commands in time.',
    },
    {
        key: 'mcu_task_avg',
        label: 'Task avg µs',
        yLabel: 'µs',
        mode: 'avg',
        scale: (v) => v * 1e6,
        color: '#3498db',
        tooltip:
            'Average time in microseconds the MCU’s internal task scheduler takes to process a single command. Reported by the MCU firmware. Higher values reduce available headroom for real-time scheduling.',
    },
    {
        key: 'mcu_task_stddev',
        label: 'Task stddev µs',
        yLabel: 'µs',
        mode: 'avg',
        scale: (v) => v * 1e6,
        color: '#2980b9',
        tooltip:
            'Standard deviation of the MCU task processing time in microseconds. A high standard deviation indicates inconsistent scheduling latency which can cause timing jitter in stepper or heater control.',
    },
    {
        key: 'srtt',
        label: 'SRTT ms',
        yLabel: 'ms',
        mode: 'avg',
        scale: (v) => v * 1000,
        color: '#00d4aa',
        tooltip:
            'Smoothed round-trip time in milliseconds between host and MCU (host→MCU direction). Rising values indicate the host is getting slower at servicing the MCU, usually under CPU load.',
    },
    {
        key: 'rto',
        label: 'RTO ms',
        yLabel: 'ms',
        mode: 'avg',
        scale: (v) => v * 1000,
        color: '#f28c28',
        tooltip:
            'Retransmission timeout in milliseconds — the window before a frame is considered lost and retransmitted. Should stay near double the SRTT; if it grows, the link is having trouble.',
    },
]

// ported verbatim from klipper-comm-tracking/stats.html
export const CANBUS_STAT_DEFS: StatDef[] = [
    {
        key: 'rx_error',
        label: 'RX errors',
        yLabel: 'count',
        mode: 'last',
        color: '#e74c3c',
        tooltip:
            'Cumulative receive errors detected by the micro-controller CAN hardware. Increments on CRC errors, bit-stuffing errors, or framing errors on received frames.',
    },
    {
        key: 'tx_error',
        label: 'TX errors',
        yLabel: 'count',
        mode: 'last',
        color: '#f28c28',
        tooltip:
            'Cumulative transmit errors detected by the micro-controller CAN hardware. Increments when a transmitted frame is not acknowledged by any node on the bus. High values indicate missing bus termination, an open circuit, or a disconnected device. Note: rp2040/rp2350 MCUs always report this as 0.',
    },
    {
        key: 'tx_retries',
        label: 'TX retries',
        yLabel: 'count',
        mode: 'last',
        color: '#f1c40f',
        tooltip:
            'Number of CAN frame transmit attempts that were retried due to bus contention (arbitration loss) or transmission errors. Only reported as non-zero by rp2040/rp2350 micro-controllers; always 0 on other MCU types.',
    },
]

export const HOST_STAT_DEFS: StatDef[] = [
    {
        key: 'sysload',
        label: 'Sys load',
        yLabel: '',
        mode: 'avg',
        color: '#00d4aa',
        tooltip: 'Load average of the host system running Klipper (2 s bucket average).',
    },
    {
        key: 'mem_avail',
        label: 'Memory available',
        yLabel: 'MiB',
        mode: 'avg',
        scale: (v) => v / 1024,
        color: '#9b59b6',
        tooltip: 'Available memory of the host system in MiB (2 s bucket average).',
    },
]

export const SENSOR_STAT_DEFS: StatDef[] = [
    {
        key: 'temperature',
        label: 'Temperature',
        yLabel: '°C',
        mode: 'avg',
        color: '#f28c28',
        tooltip: 'Temperature reported by the sensor (2 s bucket average).',
    },
]

export const HEATER_STAT_DEFS: StatDef[] = [
    {
        key: 'power',
        label: 'Power',
        yLabel: '',
        mode: 'avg',
        color: '#e74c3c',
        tooltip: 'Heater power fraction 0–1 (2 s bucket average). Useful as context for CAN hiccups during prints.',
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
        } else if (b.mode === 'sum') {
            y = b.acc
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
 * Immediately emit a snapshot point at ts without waiting for the bucket to close.
 * Always advances bucketEnd to the next boundary >= ts, so a restored/stale bucketEnd
 * cannot later emit phantom backward-dated carry-forward points.
 * @returns true when a point was added.
 */
export function seedSeries(series: Point[], b: BucketAccumulator, ts: number, value: number): boolean {
    b.bucketEnd = (Math.floor(ts / BUCKET_MS) + 1) * BUCKET_MS
    b.lastEmitted = value

    if (series.length === 0 || ts > series[series.length - 1].x) {
        series.push({ x: ts, y: value })
        while (series.length > MAX_BUCKETS) series.shift()

        return true
    }

    return false
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