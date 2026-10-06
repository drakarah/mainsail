import axios from 'axios'
import { globToRegex, parseIncludes, sectionRegex, ShakeTuneDb } from './inputShaper'

// Moonraker database location of the run history; separate from the 'mainsail' namespace on purpose
const dbNamespace = 'mainsail_extensions'
const dbKey = 'input_shaper'

export interface RemoteFile {
    path: string
    modified: number
}

export class ShakeTuneApi {
    constructor(private apiUrl: string) {}

    async listFiles(root: string, dir: string): Promise<RemoteFile[]> {
        try {
            const res = await axios.get(`${this.apiUrl}/server/files/directory`, {
                params: { path: `${root}/${dir}`, extended: false },
            })
            const files = (res.data.result?.files ?? []) as { filename: string; modified: number }[]
            return files.map((file) => ({ path: `${dir}/${file.filename}`, modified: file.modified }))
        } catch (e) {
            // folder doesn't exist until Shake&Tune wrote its first result
            if (axios.isAxiosError(e) && [400, 404].includes(e.response?.status ?? 0)) return []
            throw e
        }
    }

    fileUrl(root: string, path: string) {
        return `${this.apiUrl}/server/files/${root}/${path.split('/').map(encodeURIComponent).join('/')}`
    }

    async readText(root: string, path: string): Promise<string> {
        const res = await axios.get(this.fileUrl(root, path), {
            params: { t: Date.now() },
            responseType: 'text',
            transformResponse: (data) => data,
        })
        return res.data as string
    }

    async writeText(root: string, path: string, text: string) {
        const slash = path.lastIndexOf('/')
        const formData = new FormData()
        formData.append('file', new File([text], path.slice(slash + 1)))
        formData.append('root', root)
        if (slash > -1) formData.append('path', path.slice(0, slash))

        await axios.post(`${this.apiUrl}/server/files/upload`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        })
    }

    async loadDb(): Promise<ShakeTuneDb> {
        try {
            const res = await axios.get(`${this.apiUrl}/server/database/item`, {
                params: { namespace: dbNamespace, key: dbKey },
            })
            return { runs: [], ...(res.data.result?.value ?? {}) }
        } catch (e) {
            if (axios.isAxiosError(e) && e.response?.status === 404) return { runs: [] }
            throw e
        }
    }

    // read-modify-write, so changes from other browsers in the meantime aren't lost
    async updateDb(mutate: (db: ShakeTuneDb) => void): Promise<ShakeTuneDb> {
        const db = await this.loadDb()
        mutate(db)
        await axios.post(`${this.apiUrl}/server/database/item`, { namespace: dbNamespace, key: dbKey, value: db })
        return db
    }

    // The config files that define a section, following the [include]s from printer.cfg the way klipper
    // parses them (depth first, at the position of the include). Klipper merges all occurrences and the
    // last value of a key wins, so the files are ordered by their last occurrence.
    async findSectionFiles(section: string): Promise<string[]> {
        const res = await axios.get(`${this.apiUrl}/server/files/list`, { params: { root: 'config' } })
        const allFiles = ((res.data.result ?? []) as { path: string }[]).map((file) => file.path)

        const header = sectionRegex(section)
        const occurrences: string[] = []
        const visiting = new Set<string>()

        const walk = async (file: string) => {
            // klipper refuses recursive includes; just don't loop
            if (visiting.has(file)) return
            visiting.add(file)

            const text = await this.readText('config', file)
            for (const line of text.split(/\r?\n/)) {
                if (header.test(line)) occurrences.push(file)

                for (const include of parseIncludes(line, file)) {
                    if (/[*?]/.test(include)) {
                        const regex = globToRegex(include)
                        for (const path of allFiles.filter((path) => regex.test(path)).sort()) await walk(path)
                    } else if (allFiles.includes(include)) {
                        await walk(include)
                    }
                }
            }

            visiting.delete(file)
        }
        await walk('printer.cfg')

        return [...new Set([...occurrences].reverse())].reverse()
    }
}
