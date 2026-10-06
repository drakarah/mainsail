import { mdiSineWave } from '@mdi/js'
import type { MainsailExtension } from '../types'

// Shake&Tune overview: input shaper calibration per tool, belts and vibrations graphs in one place
const inputShaper: MainsailExtension = {
    name: 'input-shaper',
    routes: [
        {
            name: 'inputshaper',
            title: 'Input Shaper',
            path: '/inputShaper',
            icon: mdiSineWave,
            component: () => import('./InputShaperPage.vue'),
            alwaysShow: false,
            showInNavi: true,
            position: 36,
            visible: (getters) => getters['printer/checkConfig']('shaketune'),
        },
    ],
    locales: import.meta.glob('./locales/*.json'),
    // record the console from app start, so long runs can be followed even when the page opens later
    setup: () => {
        import('./consoleRecorder')
            .then((module) => module.startConsoleRecorder())
            .catch((e) => window.console.error('input shaper: could not start the console recorder', e))
    },
}

export default inputShaper
