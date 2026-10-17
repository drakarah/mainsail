import type { ExtensionPredicate } from './types'

// printer/checkConfig throws while the printer's configfile hasn't been loaded yet (page load, reconnect)
export const hasConfig =
    (section: string): ExtensionPredicate =>
    (getters) => {
        try {
            return !!getters['printer/checkConfig'](section)
        } catch {
            return false
        }
    }
