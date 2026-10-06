import Component from 'vue-class-component'
import { Mixins } from 'vue-property-decorator'
import BaseMixin from '@/components/mixins/base'
import { ShakeTuneApi } from './api'
import { ShaperKey, ShaperValues } from './inputShaper'

@Component
export default class InputShaperMixin extends Mixins(BaseMixin) {
    get api() {
        return new ShakeTuneApi(this.$store.getters['socket/getUrl'])
    }

    get klipperConfig(): Record<string, Record<string, string>> {
        return this.$store.state.printer.configfile?.config ?? {}
    }

    // Shake&Tune result folder relative to the config root, null if it lives somewhere else
    get resultsDir(): string | null {
        const folder = this.klipperConfig.shaketune?.result_folder ?? '~/printer_data/config/ShakeTune_results'
        const match = folder.match(/printer_data\/config\/(.+?)\/*$/)
        return match ? match[1] : null
    }

    fileUrl(path: string) {
        return this.api.fileUrl('config', path)
    }

    formatDate(timestamp: number) {
        return new Date(timestamp).toLocaleString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    formatValue(values: ShaperValues, key: ShaperKey) {
        const value = values[key]
        if (value === undefined || value === null || value === '') return '–'
        if (key.startsWith('type')) return String(value).toUpperCase()
        if (key.startsWith('damping')) return Number(value).toFixed(3)
        return `${Number(value).toFixed(1)} Hz`
    }

    sendGcode(gcode: string) {
        this.$store.dispatch('server/addEvent', { message: gcode, type: 'command' })
        this.$socket.emit('printer.gcode.script', { script: gcode })
    }
}
