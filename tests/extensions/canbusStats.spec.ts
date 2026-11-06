// # canbus-stats.spec.ts — unit tests for the CAN bus stats extension core
// # Why: the aggregation (bucket modes, carry-forward, monotonic guard), the status-payload
// # routing, and the presence flag drive both the charts and the nav visibility; regressions
// # here would corrupt 12 h of diagnostic data silently.

import Vue from 'vue'
import Vuex from 'vuex'
import type { Module, Store } from 'vuex'

Vue.use(Vuex)

import { describe, expect, it, beforeEach } from 'vitest'
import {
    BUCKET_MS,
    CANBUS_STAT_DEFS,
    feedBuckets,
    HISTORY_MS,
    makeBuckets,
    MCU_STAT_DEFS,
    MAX_BUCKETS,
    type Point,
    pushBucketed,
    seedSeries,
} from '@/extensions/canbus-stats/buckets'
import {
    canbusStatsModule,
    getBuffers,
    handleStatusPayload,
    recordSample,
    resetBuffers,
} from '@/extensions/canbus-stats/store'
import canbusExtension from '@/extensions/canbus-stats/index'
import type { CanbusStatsState } from '@/extensions/canbus-stats/store'
import type { RootState } from '@/store/types'

const base = 1_700_000_000_000 // aligned to a 2 s boundary

// the canbusStats module is registered at runtime, so type the store loosely
/* eslint-disable @typescript-eslint/no-explicit-any */
type TStore = Store<Record<string, any>>
type RootStore = Store<RootState>

function freshStore(): TStore {
    return new Vuex.Store({}) as unknown as TStore
}

// the canbusStats module types its root state as RootState; bridge both views
const moduleFor = () => canbusStatsModule() as unknown as Module<CanbusStatsState, Record<string, any>>

const asRoot = (store: TStore): RootStore => store as unknown as RootStore

describe('feedBuckets', () => {
    it('emits a point when the first bucket closes (last mode)', () => {
        const b = makeBuckets('last')

        // bucket 1: two samples, last value wins
        const p1 = feedBuckets(b, base + 500, 10)
        expect(p1).toEqual([])
        const p2 = feedBuckets(b, base + 1500, 30)
        expect(p2).toEqual([])
        const p3 = feedBuckets(b, base + 2000, 99) // crosses the boundary
        expect(p3).toEqual([{ x: base, y: 30 }])
        expect(b.bucketEnd).toBe(base + BUCKET_MS * 2)
    })

    it('averages samples in avg mode', () => {
        const b = makeBuckets('avg')

        feedBuckets(b, base + 500, 10)
        feedBuckets(b, base + 1500, 30)
        const pts = feedBuckets(b, base + BUCKET_MS, 99)
        expect(pts).toEqual([{ x: base, y: 20 }])
    })

    it('carries forward the last value across an empty bucket', () => {
        const b = makeBuckets('last')

        expect(feedBuckets(b, base + 500, 7)).toEqual([])
        // three empty bucket crossings — every one must carry 7 forward
        const pts = feedBuckets(b, base + BUCKET_MS * 4, 8)
        expect(pts).toEqual([
            { x: base, y: 7 },
            { x: base + BUCKET_MS, y: 7 },
            { x: base + BUCKET_MS * 2, y: 7 },
            { x: base + BUCKET_MS * 3, y: 7 },
        ])
    })

    it('handles multiple bucket flushes when the clock skips', () => {
        const b = makeBuckets('avg')

        feedBuckets(b, base, 10)
        const pts = feedBuckets(b, base + BUCKET_MS * 5, 20) // skips 4 full buckets
        expect(pts.length).toBe(5)
        expect(pts[0]).toEqual({ x: base, y: 10 })
        // skipped buckets carry the seeded value forward
        expect(pts[1].y).toBe(10)
        expect(pts[4].x).toBe(base + BUCKET_MS * 4)
    })
})

describe('pushBucketed / seedSeries', () => {
    it('respects the monotonic guard on series pushes', () => {
        const b = makeBuckets('last')
        const series: Point[] = []

        expect(pushBucketed(series, b, base + 100, 5)).toBe(false)
        expect(pushBucketed(series, b, base + BUCKET_MS + 100, 5)).toBe(true)
        // a point going backwards is skipped
        expect(pushBucketed(series, b, base + BUCKET_MS + 200, 5)).toBe(false)
        expect(series.length).toBe(1)
    })

    it('caps series length at MAX_BUCKETS', () => {
        const b = makeBuckets('last')
        const series: Point[] = []

        for (let i = 0; i < MAX_BUCKETS + 10; i++) {
            pushBucketed(series, b, base + i * BUCKET_MS, i)
        }
        expect(series.length).toBe(MAX_BUCKETS)
        expect(series[0].x).toBe(base + BUCKET_MS * 9)
    })

    it('seedSeries emits the snapshot and advances bucketEnd forward', () => {
        const b = makeBuckets('last')
        const series: Point[] = []

        expect(seedSeries(series, b, base + 1234, 42)).toBe(true)
        expect(series).toEqual([{ x: base + 1234, y: 42 }])
        // a later restore with an older ts must not add a backward point
        const b2 = makeBuckets('last')
        expect(seedSeries(series, b2, base, 1)).toBe(false)
        expect(series.length).toBe(1)
    })

    it('keeps history within the 12 h window', () => {
        expect(MAX_BUCKETS * BUCKET_MS).toBe(HISTORY_MS)
    })
})

describe('handleStatusPayload routing', () => {
    beforeEach(() => {
        resetBuffers()
    })

    it('records canbus stats and flips the presence flag', () => {
        const store = freshStore()
        store.registerModule('canbusStats', moduleFor())

        const changed = handleStatusPayload(
            asRoot(store),
            { canbus_stats: { rx_error: 3, tx_error: 1, tx_retries: 0 } },
            base
        )

        // first snapshot fills the open bucket — no point until it closes
        expect(changed).toBe(false)
        expect(store.state.canbusStats.canbusPresent).toBe(true)
        expect(store.getters['canbusStats/hasCanbusStats']).toBe(true)

        // a single point exists after one full bucket boundary crossing
        const next = handleStatusPayload(asRoot(store), { canbus_stats: { rx_error: 3 } }, base + BUCKET_MS)
        expect(next).toBe(true)
        const series = getBuffers()['canbus_stats'].rx_error
        expect(series.length).toBe(1)
        expect(series[0].y).toBe(3)
    })

    it('routes mcu last_stats, host stats, sensors and heater power to the right buffers', () => {
        const store = freshStore()
        store.registerModule('canbusStats', moduleFor())

        handleStatusPayload(
            asRoot(store),
            {
                mcu: { last_stats: { mcu_awake: 0.5, srtt: 0.001 } },
                'mcu x': { last_stats: { mcu_awake: 0.1 } },
                system_stats: { sysload: 2.5, mem_avail: 1024 },
                'temperature_sensor probe': { temperature: 42 },
                heater_bed: { power: 0.5 },
            },
            base
        )

        const buffers = getBuffers()
        expect(buffers['mcu'].mcu_awake).toHaveLength(0) // bucket not closed yet — nothing emitted
        // force a flush across the boundary
        handleStatusPayload(asRoot(store), { mcu: { last_stats: { mcu_awake: 0.5 } } }, base + BUCKET_MS)
        expect(buffers['mcu'].mcu_awake[0].y).toBeCloseTo(50) // scaled to %
        expect(buffers['mcu'].srtt[0].y).toBeCloseTo(1) // scaled to ms
        expect(buffers['mcu x'].mcu_awake.length).toBe(1)
        expect(buffers['system_stats'].sysload[0].y).toBeCloseTo(2.5)
        expect(buffers['system_stats'].mem_avail[0].y).toBeCloseTo(1) // KiB → MiB
        expect(buffers['temperature_sensor probe'].temperature[0].y).toBe(42)
        expect(buffers['heater_bed'].power[0].y).toBeCloseTo(0.5)
    })

    it('ignores missing fields and unknown objects, and does not record undefined', () => {
        const store = freshStore()
        store.registerModule('canbusStats', moduleFor())

        const changed = handleStatusPayload(asRoot(store), { configfile: { config: {} }, mcu: { last_stats: {} } }, base)
        expect(changed).toBe(false)
        expect(Object.keys(getBuffers())).toEqual([])

        // undefined fields must be ignored (moonraker omits unchanged fields)
        const changed2 = handleStatusPayload(asRoot(store), { canbus_stats: { rx_error: undefined } }, base)
        expect(changed2).toBe(false)
        // the canbus_stats object itself is present in the payload, so the flag flips
        expect(store.state.canbusStats.canbusPresent).toBe(true)
    })

    it('clears the presence flag on printer/reset', () => {
        const store = freshStore()
        store.registerModule('canbusStats', moduleFor())

        handleStatusPayload(asRoot(store), { canbus_stats: { rx_error: 0 } }, base)
        expect(store.state.canbusStats.canbusPresent).toBe(true)

        store.commit('canbusStats/setCanbusPresent', false)
        expect(store.getters['canbusStats/hasCanbusStats']).toBe(false)
    })

    it('bumps the revision counter when samples are recorded', () => {
        const store = freshStore()
        store.registerModule('canbusStats', moduleFor())

        const r0 = store.getters['canbusStats/revision']
        handleStatusPayload(asRoot(store), { mcu: { last_stats: { srtt: 0.001 } } }, base)
        handleStatusPayload(asRoot(store), { mcu: { last_stats: { srtt: 0.001 } } }, base + BUCKET_MS) // closes the first bucket
        expect(store.getters['canbusStats/revision']).toBe(r0 + 1)
    })
})

describe('recordSample', () => {
    beforeEach(() => {
        resetBuffers()
    })

    it('records scaled values into the right device/stat bucket', () => {
        recordSample('mcu', 'mcu_task_avg', 'avg', (v) => v * 1e6, base + 100, 0.0015)
        recordSample('mcu', 'mcu_task_avg', 'avg', (v) => v * 1e6, base + 1900, 0.0025)
        recordSample('mcu', 'mcu_task_avg', 'avg', (v) => v * 1e6, base + BUCKET_MS, 1) // flush

        expect(getBuffers()['mcu'].mcu_task_avg[0].y).toBeCloseTo(2000)
    })
})

describe('stat defs', () => {
    it('port matches the standalone dashboard (keys, modes, scales)', () => {
        expect(MCU_STAT_DEFS.map((d) => d.key)).toEqual([
            'bytes_retransmit',
            'bytes_invalid',
            'retransmit_seq',
            'bytes_write',
            'bytes_read',
            'mcu_awake',
            'mcu_task_avg',
            'mcu_task_stddev',
            'srtt',
            'rto',
        ])
        expect(CANBUS_STAT_DEFS.map((d) => d.key)).toEqual(['rx_error', 'tx_error', 'tx_retries'])

        const awake = MCU_STAT_DEFS.find((d) => d.key === 'mcu_awake')!
        expect(awake.mode).toBe('avg')
        expect(awake.scale!(0.5)).toBe(50)
        expect(MCU_STAT_DEFS.find((d) => d.key === 'bytes_retransmit')!.mode).toBe('last')
    })
})

describe('route visibility predicate', () => {
    it('is driven by the canbusStats presence getter', () => {
        const route = canbusExtension.routes![0]
        expect(route.name).toBe('canbusstats')
        expect(route.visible).toBeTypeOf('function')

        const visible = route.visible!
        expect(visible({ 'canbusStats/hasCanbusStats': true })).toBe(true)
        expect(visible({ 'canbusStats/hasCanbusStats': false })).toBe(false)
    })
})