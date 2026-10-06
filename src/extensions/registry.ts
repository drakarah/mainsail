import type VueI18n from 'vue-i18n'
import type { AppRoute } from '@/routes'
import type { ExtensionComponent, ExtensionPanel, ExtensionRoute, MainsailExtension } from './types'
import toolchanger from './toolchanger'
import toolCalibration from './tool-calibration'

// Enable or disable extensions here
export const extensions: MainsailExtension[] = [toolchanger, toolCalibration]

export const extensionRoutes: ExtensionRoute[] = extensions.flatMap((ext) => ext.routes ?? [])

export const extensionPanels: ExtensionPanel[] = extensions.flatMap((ext) => ext.panels ?? [])

export const extensionPanelNames: string[] = extensionPanels.map((panel) => panel.name)

export const extensionMetadata: string[] = extensions.flatMap((ext) => ext.metadata ?? [])

export function getExtensionSlotComponents(slot: string): ExtensionComponent[] {
    return extensions.flatMap((ext) => ext.slots?.[slot] ?? [])
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isExtensionRouteVisible(route: AppRoute, getters: any): boolean {
    const visible = (route as ExtensionRoute).visible
    return visible ? visible(getters) : true
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isExtensionPanelVisible(name: string, getters: any): boolean {
    const panel = extensionPanels.find((panel) => panel.name === name)
    return panel?.visible ? panel.visible(getters) : true
}

export async function mergeExtensionLocales(i18n: VueI18n, lang: string) {
    for (const ext of extensions) {
        const loader = Object.entries(ext.locales ?? {}).find(([path]) => path.endsWith(`/${lang}.json`))?.[1]
        if (!loader) continue

        const messages = (await loader()) as { default: VueI18n.LocaleMessageObject }
        i18n.mergeLocaleMessage(lang, messages.default)
    }
}
