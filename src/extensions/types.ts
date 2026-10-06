import type { AsyncComponent } from 'vue'
import type { AppRoute } from '@/routes'

// Extensions get the root store getters, so predicates work both in components and inside vuex getters
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExtensionPredicate = (getters: any) => boolean

// Always use lazy components (() => import('./X.vue')) inside extensions. The registry is imported by
// low-level modules like store/variables.ts, so static component imports would create import cycles.
export type ExtensionComponent = AsyncComponent

export interface ExtensionRoute extends AppRoute {
    // hide the navigation entry when this returns false
    visible?: ExtensionPredicate
}

export interface ExtensionPanel {
    // dashboard panel name, rendered as `<name>-panel`; i18n title is Panels.<PascalName>Panel.Headline
    name: string
    component: ExtensionComponent
    // remove the panel from the dashboard when this returns false
    visible?: ExtensionPredicate
}

export interface MainsailExtension {
    name: string
    routes?: ExtensionRoute[]
    panels?: ExtensionPanel[]
    // named <extension-slot> outlets in upstream components, e.g. 'start-print-dialog'
    slots?: Record<string, ExtensionComponent[]>
    // extra gcode metadata keys requested from moonraker
    metadata?: string[]
    // result of import.meta.glob('./locales/*.json'), deep-merged into the upstream locale
    locales?: Record<string, () => Promise<unknown>>
}
