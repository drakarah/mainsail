// # canbus-stats/recorder.ts — wires the status-update recorder into the mainsail store
// # Why: Mainsail already subscribes to every klippy object, so this only needs to hook the
// # vuex `printer/setData` mutation (public store.subscribe API — no upstream file edits)
// # and aggregate each snapshot into the canbusStats buffers from app start. That keeps
// # CAN/MCU samples correlated with print history even when the page itself is closed,
// # mirroring input-shaper's consoleRecorder pattern.

import store from '@/store'

import { handleStatusPayload, registerCanbusStatsStore, restoreFromStorage, startPersistenceThrottle } from './store'

let started = false

/**
 * Start the CAN bus stats recorder on the mainsail root store. Idempotent: dev HMR may run
 * setup() twice; the first call wins.
 * @pre the store module is loaded (this module is lazy-imported from setup(), as consoleRecorder is)
 */
export function startCanbusStatsRecorder(): void {
    if (started) return
    started = true

    registerCanbusStatsStore(store)
    restoreFromStorage()
    startPersistenceThrottle()

    store.subscribe((mutation) => {
        // an error here would break mainsail's own status handling, so never let one out
        try {
            if (mutation.type === 'printer/setData') {
                const payload = mutation.payload as Record<string, unknown> | undefined
                if (payload && typeof payload === 'object') {
                    handleStatusPayload(store, payload, Date.now())
                }
            } else if (mutation.type === 'printer/reset') {
                // klippy went down (or disconnected): the nav item should hide again
                store.commit('canbusStats/setCanbusPresent', false, { root: true })
            }
        } catch (e) {
            window.console.error('canbus stats: recorder failed', e)
        }
    })
}