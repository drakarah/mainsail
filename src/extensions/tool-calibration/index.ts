import { mdiAdjust } from '@mdi/js'
import type { ExtensionPredicate, MainsailExtension } from '../types'

// axiscope tool offset calibration page, embeds the axiscope web UI (port 3000) as an iframe
const hasAxiscope: ExtensionPredicate = (getters) => getters['printer/checkConfig']('axiscope')

const toolCalibration: MainsailExtension = {
    name: 'tool-calibration',
    routes: [
        {
            name: 'toolcalibration',
            title: 'Tool calibration',
            path: '/toolCalibration',
            icon: mdiAdjust,
            component: () => import('./ToolCalibrationPage.vue'),
            alwaysShow: true,
            showInNavi: true,
            position: 35,
            fullscreen: true,
            visible: hasAxiscope,
        },
    ],
    locales: import.meta.glob('./locales/*.json'),
}

export default toolCalibration
