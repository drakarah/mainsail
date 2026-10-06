import type { VueConstructor } from 'vue'
import { extensionPanels, getExtensionSlotComponents } from './registry'

// Renders every component that extensions registered for the named slot, forwarding all attributes.
// Usage in upstream templates: <extension-slot name="start-print-dialog" :file="file" />
const ExtensionSlot = {
    name: 'ExtensionSlot',
    functional: true,
    props: { name: { type: String, required: true } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(h: any, ctx: any) {
        return getExtensionSlotComponents(ctx.props.name).map((component) =>
            h(component, { attrs: ctx.data.attrs, on: ctx.listeners })
        )
    },
}

export function installExtensions(Vue: VueConstructor) {
    Vue.component('ExtensionSlot', ExtensionSlot)

    // Dashboard resolves panels by name (`<component :is="xyz-panel">`), so a global registration is enough
    extensionPanels.forEach((panel) => Vue.component(`${panel.name}-panel`, panel.component))
}
