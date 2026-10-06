import Vue from 'vue'
import axios from 'axios'
import store from '@/store'
import { ConsoleLine } from './inputShaper'

// Mainsail keeps only the last 500 console lines (and loads 100 on connect), while Shake&Tune prints a
// line per second while measuring. A calibration of several tools needs much more history than that, so
// this keeps its own copy of the console without the per second noise, from app start on.
// Only printers with [shaketune] are recorded.
const maxLines = 5000
const noise = /Testing frequency:/i

export const consoleRecorder = Vue.observable({ lines: [] as ConsoleLine[] })

let started = false

// the printer config only arrives after connecting
function enabled() {
    const config: Record<string, unknown> | undefined = store.state.printer?.configfile?.config
    return !!config && Object.keys(config).some((name) => name.toLowerCase() === 'shaketune')
}

function push(line: ConsoleLine) {
    if (noise.test(line.message)) return
    // frozen: lines never change, so vue doesn't need to make thousands of them reactive
    consoleRecorder.lines.push(Object.freeze(line))
    if (consoleRecorder.lines.length > maxLines)
        consoleRecorder.lines.splice(0, consoleRecorder.lines.length - maxLines)
}

// Loads moonraker's history, which has more lines than mainsail loads. On a reconnect the recorded lines
// can reach back further than that history, so those are kept.
export async function seedConsoleRecorder() {
    if (!enabled()) return

    try {
        const res = await axios.get(`${store.getters['socket/getUrl']}/server/gcode_store`, { params: { count: 1000 } })
        const history = ((res.data.result?.gcode_store ?? []) as { time: number; type: string; message: string }[])
            .filter((item) => !noise.test(item.message))
            .map((item) => Object.freeze({ date: new Date(item.time * 1000), type: item.type, message: item.message }))

        const firstHistoryTime = history[0]?.date.getTime() ?? Infinity
        const older = consoleRecorder.lines.filter((line) => line.date.getTime() < firstHistoryTime - 1000)
        consoleRecorder.lines = [...older, ...history].slice(-maxLines)
    } catch (e) {
        window.console.warn('input shaper: could not load the console history', e)
    }
}

export function startConsoleRecorder() {
    if (started) return
    started = true

    store.subscribe((mutation) => {
        // an error here would break mainsail's own console, so never let one out
        try {
            // mainsail (re)loads the console history after (re)connecting
            if (mutation.type === 'server/setGcodeStore') seedConsoleRecorder()
            else if (mutation.type === 'server/addEvent' && enabled()) {
                const { date, type, message } = mutation.payload
                push({ date: new Date(date), type, message })
            }
        } catch (e) {
            window.console.error('input shaper: console recorder failed', e)
        }
    })

    seedConsoleRecorder()
}
