import { describe, expect, it } from 'vitest'
import {
    applyShaperValues,
    ConsoleLine,
    findToolAccelChip,
    parseIncludes,
    parseResultTimestamp,
    parseRunProgress,
    planShaperSave,
    printerShaperKeys,
    readTargetValues,
    resultGroupKey,
    shaperValuesValid,
    ShaperTarget,
    toolShaperKeys,
    valuesDiffer,
} from '@/extensions/input-shaper/inputShaper'

const toolTarget: ShaperTarget = {
    id: 'T0',
    label: 'T0',
    section: 'tool T0',
    toolNumber: 0,
    accelChip: 'adxl345 T0',
    keys: toolShaperKeys,
    quoteType: true,
}

const printerTarget: ShaperTarget = {
    id: 'printer',
    label: 'Printer',
    section: 'input_shaper',
    toolNumber: null,
    accelChip: null,
    keys: printerShaperKeys,
    quoteType: false,
}

const toolCfg = [
    '[gcode_macro T0]',
    'gcode:',
    '  SELECT_TOOL T=0',
    '',
    '[tool T0]',
    'tool_number: 0',
    '',
    '# For InputShaper run per tool and enter the frequency here',
    "params_input_shaper_type_x: 'mzv'",
    'params_input_shaper_freq_x: 49.600',
    'params_input_shaper_damping_ratio_x: 0.046',
    "params_input_shaper_type_y: 'mzv'",
    'params_input_shaper_freq_y: 36.2 # measured',
    'params_input_shaper_damping_ratio_y: 0.073',
    '',
    '',
    '[tool_probe T0]',
    'tool: 0',
].join('\n')

const line = (seconds: number, type: string, message: string): ConsoleLine => ({
    date: new Date(1_000_000 + seconds * 1000),
    type,
    message,
})

describe('applyShaperValues', () => {
    it('replaces values in the tool section and keeps comments and quoting', () => {
        const { text, changes } = applyShaperValues(toolCfg, toolTarget, {
            type_x: 'ei',
            freq_x: 48.6,
            damping_x: 0.062,
            freq_y: 35.2,
        })

        expect(text).toContain("params_input_shaper_type_x: 'ei'")
        expect(text).toContain('params_input_shaper_freq_x: 48.6')
        expect(text).toContain('params_input_shaper_damping_ratio_x: 0.062')
        expect(text).toContain('params_input_shaper_freq_y: 35.2 # measured')
        expect(text).toContain('params_input_shaper_damping_ratio_y: 0.073')
        expect(text).toContain('# For InputShaper run per tool')
        expect(changes.map((c) => c.key)).toEqual([
            'params_input_shaper_type_x',
            'params_input_shaper_freq_x',
            'params_input_shaper_damping_ratio_x',
            'params_input_shaper_freq_y',
        ])
        expect(changes[1]).toMatchObject({ line: 10, oldValue: '49.600', newValue: '48.6' })
    })

    it('does not touch other sections or line endings', () => {
        const crlf = toolCfg.replace(/\n/g, '\r\n')
        const { text } = applyShaperValues(crlf, toolTarget, { freq_x: 50 })
        expect(text.split('\r\n').length).toBe(crlf.split('\r\n').length)
        expect(text).toContain('[tool_probe T0]\r\ntool: 0')
        expect(text).toContain('[gcode_macro T0]\r\ngcode:\r\n  SELECT_TOOL T=0')
    })

    it('adds missing keys at the end of the section', () => {
        const cfg = '[tool T1]\ntool_number: 1\n\n[tool_probe T1]\n'
        const target = { ...toolTarget, section: 'tool T1' }
        const { text, changes } = applyShaperValues(cfg, target, { type_x: 'mzv', freq_x: 50.6 })
        expect(text).toBe(
            "[tool T1]\ntool_number: 1\nparams_input_shaper_type_x: 'mzv'\nparams_input_shaper_freq_x: 50.6\n\n[tool_probe T1]\n"
        )
        expect(changes.every((c) => c.line === null)).toBe(true)
    })

    it('writes unquoted values for [input_shaper]', () => {
        const cfg = '[input_shaper]\nshaper_freq_x: 49.6 # center frequency\nshaper_type_x: mzv\n'
        const { text } = applyShaperValues(cfg, printerTarget, { type_x: 'EI', freq_x: 51.24 })
        expect(text).toBe('[input_shaper]\nshaper_freq_x: 51.2 # center frequency\nshaper_type_x: ei\n')
    })

    it('throws when the section does not exist', () => {
        expect(() => applyShaperValues(toolCfg, { ...toolTarget, section: 'tool T4' }, { freq_x: 1 })).toThrow()
    })
})

describe('saving to [input_shaper] with a SAVE_CONFIG block', () => {
    const autosave = [
        '#*# <---------------------- SAVE_CONFIG ---------------------->',
        '#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.',
        '#*#',
        '#*# [probe]',
        '#*# z_offset = -0.570',
        '#*#',
        '#*# [input_shaper]',
        '#*# shaper_type_x = mzv',
        '#*# shaper_freq_x = 49.6',
        '#*# shaper_type_y = mzv',
        '#*# shaper_freq_y = 36.6',
        '#*#',
    ]

    it('changes the values where klipper reads them from', () => {
        const printerCfg = ['[printer]', 'kinematics: corexy', '', ...autosave].join('\n')
        const plan = planShaperSave([{ path: 'printer.cfg', text: printerCfg }], printerTarget, {
            type_x: 'ei',
            freq_x: 48.6,
            damping_x: 0.062,
        })
        const lines = plan.files[0].text.split('\n')

        expect(lines).toContain('#*# shaper_type_x = ei')
        expect(lines).toContain('#*# shaper_freq_x = 48.6')
        // added inside the SAVE_CONFIG section, right after its other keys
        expect(lines[lines.indexOf('#*# shaper_freq_y = 36.6') + 1]).toBe('#*# damping_ratio_x = 0.062')
        expect(lines).toContain('#*# z_offset = -0.570')
    })

    it('splits keys over a normal section and the SAVE_CONFIG block', () => {
        const included = '[input_shaper]\ndamping_ratio_x: 0.05 # measured\n'
        const printerCfg = ['[include input_shaper.cfg]', '', ...autosave].join('\n')
        const plan = planShaperSave(
            [
                { path: 'input_shaper.cfg', text: included },
                { path: 'printer.cfg', text: printerCfg },
            ],
            printerTarget,
            { freq_x: 48.6, damping_x: 0.062, damping_y: 0.07 }
        )

        expect(plan.files.map((file) => file.path).sort()).toEqual(['input_shaper.cfg', 'printer.cfg'])
        expect(plan.files.find((file) => file.path === 'input_shaper.cfg')?.text).toBe(
            '[input_shaper]\ndamping_ratio_x: 0.062 # measured\ndamping_ratio_y: 0.070\n'
        )
        expect(plan.files.find((file) => file.path === 'printer.cfg')?.text).toContain('#*# shaper_freq_x = 48.6')
    })

    it('never adds lines below the SAVE_CONFIG marker for a normal section', () => {
        const printerCfg = ['[input_shaper]', '', ...autosave.slice(0, 6)].join('\n')
        const { text } = applyShaperValues(printerCfg, printerTarget, { freq_x: 50 })
        expect(text.split('\n').slice(0, 3)).toEqual(['[input_shaper]', 'shaper_freq_x: 50', ''])
    })
})

describe('config edge cases', () => {
    it('edits the last occurrence of a section, the one klipper uses', () => {
        const plan = planShaperSave(
            [
                { path: 'tools/T0.cfg', text: '[tool T0]\ntool_number: 0\n' },
                { path: 'shaper.cfg', text: '[tool T0]\nparams_input_shaper_freq_x: 50\n' },
            ],
            toolTarget,
            { freq_x: 48.6, freq_y: 35.2 }
        )
        expect(plan.files.map((file) => file.path)).toEqual(['shaper.cfg'])
        expect(plan.files[0].text).toBe(
            '[tool T0]\nparams_input_shaper_freq_x: 48.6\nparams_input_shaper_freq_y: 35.2\n'
        )
    })

    it('replaces a value that continues on indented lines', () => {
        const cfg = '[input_shaper]\nshaper_freq_x:\n  50\nshaper_type_x: mzv\n'
        const { text, changes } = applyShaperValues(cfg, printerTarget, { freq_x: 48.6, type_x: 'ei' })
        expect(text).toBe('[input_shaper]\nshaper_freq_x: 48.6\nshaper_type_x: ei\n')
        expect(changes.find((c) => c.key === 'shaper_freq_x')).toMatchObject({ oldValue: '50', line: 2 })
        // the removed continuation line moved shaper_type_x up from line 4
        expect(changes.find((c) => c.key === 'shaper_type_x')).toMatchObject({ oldValue: 'mzv', line: 3 })
    })

    it('keeps ; comments', () => {
        const { text } = applyShaperValues('[input_shaper]\nshaper_freq_x: 50 ; tuned\n', printerTarget, {
            freq_x: 48.6,
        })
        expect(text).toBe('[input_shaper]\nshaper_freq_x: 48.6 ; tuned\n')
    })

    it('rejects values klipper would refuse', () => {
        const valid = { type_x: 'mzv', freq_x: 48.6, damping_x: 0.06, type_y: 'ei', freq_y: 35, damping_y: 0.1 }
        expect(shaperValuesValid(valid)).toBe(true)
        expect(shaperValuesValid({ ...valid, damping_x: 1.5 })).toBe(false)
        expect(shaperValuesValid({ ...valid, freq_y: -1 })).toBe(false)
        expect(shaperValuesValid({ ...valid, type_x: 'foo' })).toBe(false)
    })

    it('treats values that round to the same config value as equal', () => {
        expect(valuesDiffer({ damping_x: 0.0625 }, { damping_x: 0.063 })).toBe(false)
    })
})

describe('parseRunProgress', () => {
    // console output of a real Shake&Tune v6 run
    const run = [
        line(0, 'response', '// shaper_type_x:mzv shaper_freq_x:49.600 damping_ratio_x:0.046000'),
        line(10, 'command', 'T0\nAXES_SHAPER_CALIBRATION ACCEL_CHIP="adxl345 T0"'),
        line(11, 'response', '// Shake&Tune version: v6.0.0'),
        line(12, 'response', '// Disabled [input_shaper] for resonance testing'),
        line(140, 'response', '// Re-enabled [input_shaper]'),
        line(190, 'response', '// Recommended filters:'),
        line(190, 'response', '// -> Best shaper: MZV @ 48.6 Hz (with a damping ratio of 0.062)'),
        line(198, 'response', '// input shaper graphs created successfully!'),
        line(200, 'response', '// Disabled [input_shaper] for resonance testing'),
        line(330, 'response', '// Re-enabled [input_shaper]'),
        line(391, 'response', '// -> Best shaper: MZV @ 35.2 Hz (with a damping ratio of 0.062)'),
        line(398, 'response', '// input shaper graphs created successfully!'),
    ]

    it('follows the steps of a run', () => {
        expect(parseRunProgress('shaper', 'all', 1_000_000, run.slice(0, 4)).step).toBe(1)
        expect(parseRunProgress('shaper', 'all', 1_000_000, run.slice(0, 5)).step).toBe(2)
        expect(parseRunProgress('shaper', 'all', 1_000_000, run.slice(0, 9)).step).toBe(3)
        expect(parseRunProgress('shaper', 'all', 1_000_000, run.slice(0, 10)).step).toBe(4)
    })

    it('reads the recommendations per axis when the run is done', () => {
        const progress = parseRunProgress('shaper', 'all', 1_000_000, run)
        expect(progress.done).toBe(true)
        expect(progress.recommendations).toEqual({
            x: { type: 'mzv', freq: 48.6, damping: 0.062 },
            y: { type: 'mzv', freq: 35.2, damping: 0.062 },
        })
        expect(progress.log[0]).toBe('Shake&Tune version: v6.0.0')
    })

    it('reads both shapers when performance and low vibrations differ', () => {
        // real output of T1's Y axis
        const lines = [
            line(10, 'command', 'AXES_SHAPER_CALIBRATION AXIS=Y'),
            line(11, 'response', '// Shake&Tune version: v6.0.0'),
            line(12, 'response', '// Disabled [input_shaper] for resonance testing'),
            line(150, 'response', '// Recommended filters:'),
            line(150, 'response', '// -> For performance: MZV @ 34.8 Hz (with a damping ratio of 0.063)'),
            line(150, 'response', '// -> For low vibrations: EI @ 41.0 Hz (with a damping ratio of 0.063)'),
            line(156, 'response', '// input shaper graphs created successfully!'),
        ]
        expect(parseRunProgress('shaper', 'y', 1_000_000, lines).recommendations).toEqual({
            y: {
                type: 'mzv',
                freq: 34.8,
                damping: 0.063,
                lowVibrations: { type: 'ei', freq: 41.0, damping: 0.063 },
            },
        })
    })

    it('reports failures', () => {
        const failed = [
            line(10, 'command', 'AXES_SHAPER_CALIBRATION AXIS=X'),
            line(12, 'response', '// Disabled [input_shaper] for resonance testing'),
            line(150, 'response', '// Error while generating the graphs: something broke'),
        ]
        const progress = parseRunProgress('shaper', 'x', 1_000_000, failed)
        expect(progress.failed).toBe(true)
        expect(progress.error).toContain('something broke')
    })

    it('ignores commands from before the run was started', () => {
        const old = [line(-600, 'command', 'AXES_SHAPER_CALIBRATION')]
        expect(parseRunProgress('shaper', 'all', 1_000_000, old).found).toBe(false)
    })

    describe('calibrating several tools in one script', () => {
        const toolRun = (offset: number, freqX: number, freqY: number) => [
            line(offset, 'response', '// Shake&Tune version: v6.0.0'),
            line(offset + 1, 'response', '// Disabled [input_shaper] for resonance testing'),
            line(offset + 100, 'response', `// -> Best shaper: MZV @ ${freqX} Hz (with a damping ratio of 0.06)`),
            line(offset + 110, 'response', '// input shaper graphs created successfully!'),
            line(offset + 111, 'response', '// Disabled [input_shaper] for resonance testing'),
            line(offset + 200, 'response', `// -> Best shaper: EI @ ${freqY} Hz (with a damping ratio of 0.05)`),
            line(offset + 210, 'response', '// input shaper graphs created successfully!'),
        ]
        const script = [
            line(
                10,
                'command',
                'G28\nT0\n_AXES_SHAPER_CALIBRATION ACCEL_CHIP="adxl345 T0"\nT1\n_AXES_SHAPER_CALIBRATION'
            ),
            ...toolRun(20, 48.6, 35.2),
            line(240, 'response', 'echo: Picking up tool T1'),
        ]
        const parse = (lines: ConsoleLine[], index: number) =>
            parseRunProgress('shaper', 'all', 1_000_000, lines, index)

        it('keeps later tools queued while the first one runs', () => {
            const progress = parse(script.slice(0, 4), 1)
            expect(progress.queued).toBe(true)
            expect(progress.step).toBe(0)
        })

        it('shows the tool change of the next tool once the previous one finished', () => {
            const progress = parse(script, 1)
            expect(progress.queued).toBe(false)
            expect(progress.step).toBe(0)
            expect(parse(script, 0).done).toBe(true)
        })

        it('reads the recommendations of each tool separately', () => {
            const both = [...script, ...toolRun(250, 50.6, 36.0)]
            expect(parse(both, 0).recommendations.x?.freq).toBe(48.6)
            expect(parse(both, 1).recommendations).toEqual({
                x: { type: 'mzv', freq: 50.6, damping: 0.06 },
                y: { type: 'ei', freq: 36.0, damping: 0.05 },
            })
            expect(parse(both, 1).done).toBe(true)
        })

        it('follows a later tool when the script command dropped out of the console history', () => {
            // only the end of the history is left: the end of T1 and the tool change to T0
            const history = [
                line(200, 'response', '// input shaper graphs created successfully!'),
                line(210, 'response', '// Selected tool 0 (tool T0)'),
                ...toolRun(220, 48.2, 35.2),
            ]
            const progress = parseRunProgress('shaper', 'all', 1_000_000, history, 1, 0, 1)
            expect(progress.done).toBe(true)
            expect(progress.recommendations.x?.freq).toBe(48.2)
        })

        it('still follows a tool after the next tool was picked up', () => {
            const history = [
                line(210, 'response', '// Selected tool 0 (tool T0)'),
                ...toolRun(220, 48.2, 35.2),
                line(440, 'response', '// Selected tool 2 (tool T2)'),
                line(441, 'response', '// Shake&Tune version: v6.0.0'),
            ]
            const progress = parseRunProgress('shaper', 'all', 1_000_000, history, 1, 0, 1)
            expect(progress.done).toBe(true)
            expect(progress.recommendations.y?.freq).toBe(35.2)
        })

        it('does not mistake an older tool change of the same tool for the current one', () => {
            const history = [
                line(100, 'response', '// Selected tool 2 (tool T2)'),
                line(200, 'response', '// Selected tool 0 (tool T0)'),
                ...toolRun(220, 48.2, 35.2),
            ]
            expect(parseRunProgress('shaper', 'all', 1_000_000, history, 2, 2, 0).found).toBe(false)
        })

        it('fails the remaining tools when klipper aborts the script', () => {
            const aborted = [...script, line(245, 'response', '!! Cannot perform toolchange, tool not detected')]
            expect(parse(aborted, 0).done).toBe(true)
            expect(parse(aborted, 1).failed).toBe(true)
            expect(parse(aborted, 2).error).toContain('tool not detected')
        })
    })

    it('tracks a vibrations profile', () => {
        const vib = [
            line(10, 'command', 'CREATE_VIBRATIONS_PROFILE ACCEL_CHIP="adxl345 T0"'),
            line(800, 'response', '// Machine vibrations profile generation...'),
            line(1000, 'response', '// Vibrations peaks detected: 5 @ 40.7, 65.1 mm/s'),
            line(1010, 'response', '// vibrations profile graphs created successfully!'),
        ]
        const progress = parseRunProgress('vibrations', 'all', 1_000_000, vib)
        expect(progress.done).toBe(true)
        expect(progress.log).toContain('Vibrations peaks detected: 5 @ 40.7, 65.1 mm/s')
    })
})

describe('helpers', () => {
    it('reads values from klipper settings', () => {
        const settings = {
            params_input_shaper_type_x: "'mzv'",
            params_input_shaper_freq_x: '50.2',
            params_input_shaper_damping_ratio_x: '0.056',
        }
        expect(readTargetValues(settings, toolTarget)).toEqual({ type_x: 'mzv', freq_x: 50.2, damping_x: 0.056 })
    })

    it('compares values with tolerance', () => {
        expect(valuesDiffer({ freq_x: 49.6 }, { freq_x: 49.62 })).toBe(false)
        expect(valuesDiffer({ freq_x: 49.6 }, { freq_x: 48.6 })).toBe(true)
        expect(valuesDiffer({ type_x: 'mzv' }, { type_x: 'MZV' })).toBe(false)
        expect(valuesDiffer({ freq_x: 49.6 }, {})).toBe(false)
    })

    it('resolves includes relative to the file', () => {
        expect(
            parseIncludes('[include toolhead0.cfg]\n#[include old.cfg]\n[include ../x/*.cfg]', 'macros/a.cfg')
        ).toEqual(['macros/toolhead0.cfg', 'x/*.cfg'])
    })

    it('parses result file names', () => {
        const file = 'ShakeTune_results/input_shaper/inputshaper_20250824_120410_axis_X.png'
        expect(resultGroupKey(file)).toBe('inputshaper_20250824_120410')
        expect(new Date(parseResultTimestamp(file) as number).getHours()).toBe(12)
    })

    it('finds the accelerometer of a tool by name', () => {
        const config = { 'adxl345 T0': {}, 'adxl345 T1': {}, 'tool T1': { extruder: 'extruder1' } }
        expect(findToolAccelChip(config, 'tool T1')).toBe('adxl345 T1')
    })

    it('finds the accelerometer of a tool by the mcu of its extruder', () => {
        // klipper-toolchanger-easy examples use a plain [adxl345] in each tool file
        const config = {
            adxl345: { cs_pin: 'EBBT1: PB12' },
            'lis2dw T0': { cs_pin: 'EBBT0:gpio1' },
            'tool T0': { extruder: 'extruder' },
            'tool T1': { extruder: 'extruder1' },
            'tool T2': { extruder: 'extruder2' },
            extruder: { step_pin: 'EBBT0:gpio18' },
            extruder1: { step_pin: 'EBBT1: PD0' },
            extruder2: { step_pin: 'PB3' },
        }
        expect(findToolAccelChip(config, 'tool T1')).toBe('adxl345')
        expect(findToolAccelChip(config, 'tool T0')).toBe('lis2dw T0')
        expect(findToolAccelChip(config, 'tool T2')).toBe(null)
    })
})
