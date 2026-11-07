// # canbus-stats/index.ts — extension entry point for the Canbus stats page
// # Why: registers the extension through the fork's extension framework (same pattern as
// # input-shaper): a nav route visible only when canbus_stats* moonraker objects exist,
// # i18n locales, and a setup() hook that starts the status recorder from app start.

import { mdiCableData } from '@mdi/js'
import type { MainsailExtension } from '../types'

export default {
    name: 'canbus-stats',
    routes: [
        {
            name: 'canbusstats',
            title: 'CAN bus statistics',
            path: '/canbusStats',
            icon: mdiCableData,
            showInNavi: true,
            alwaysShow: false,
            position: 95,
            component: () => import('./CanbusStatsPage.vue'),
            // only show the page when at least one canbus_stats object is present
            visible: (getters) => {
                return getters['canbusStats/hasCanbusStats']
            },
        },
    ],
    locales: import.meta.glob('./locales/*.json'),
    // record the stats from app start, so long runs stay correlated even when the page opens later
    setup: () => {
        import('./recorder')
            .then((module) => module.startCanbusStatsRecorder())
            .catch((e) => window.console.error('canbus stats: could not start the recorder', e))
    },
} satisfies MainsailExtension