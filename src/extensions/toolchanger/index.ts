import type { MainsailExtension } from '../types'

// klipper-toolchanger integration: tool panel, filament to tool mapping in the start print dialog
const toolchanger: MainsailExtension = {
    name: 'toolchanger',
    panels: [
        {
            name: 'toolchanger',
            component: () => import('./ToolchangerPanel.vue'),
            visible: (getters) => getters['printer/checkConfig']('toolchanger'),
        },
    ],
    slots: {
        'start-print-dialog': [() => import('./StartPrintDialogToolchanger.vue')],
    },
    metadata: ['filament_colors', 'filament_change_count'],
    locales: import.meta.glob('./locales/*.json'),
}

export default toolchanger
