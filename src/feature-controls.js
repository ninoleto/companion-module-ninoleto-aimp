import {
	getMediaActions,
	getMediaFeedbacks,
	getMediaVariableDefinitions,
	getMediaVariableValues,
} from './media-controls.js'
import {
	getMusicLibraryActions,
	getMusicLibraryFeedbacks,
	getMusicLibraryVariableDefinitions,
	getMusicLibraryVariableValues,
} from './sdk-library.js'
import {
	getLibraryToolActions,
	getLibraryToolFeedbacks,
	getLibraryToolVariableDefinitions,
	getLibraryToolVariableValues,
} from './library-tools.js'
import {
	getAppToolActions,
	getAppToolFeedbacks,
	getAppToolVariableDefinitions,
	getAppToolVariableValues,
} from './app-tools.js'
import { deferredCommandError, formatHresult } from './command-diagnostics.js'
// Optional AIMP SDK controls. The bridge's live capability catalog is authoritative.
// Kept separate from the existing transport/library controls to preserve saved buttons.
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const number = (id, label, value, min, max) => ({ type: 'number', id, label, default: value, min, max, step: 0.01 })
const dropdown = (id, label, choices, value = choices[0]?.id ?? '') => ({
	type: 'dropdown',
	id,
	label,
	choices,
	default: value,
})
const text = (id, label, value = '') => ({ type: 'textinput', id, label, default: value })
const modes = () =>
	dropdown('mode', 'Operation', [
		{ id: 'toggle', label: 'Toggle' },
		{ id: 'on', label: 'On' },
		{ id: 'off', label: 'Off' },
	])
const supported = (descriptor) => !!descriptor && descriptor.available !== false && descriptor.supported !== false
const choices = (descriptors) => descriptors.map((d) => ({ id: d.id, label: d.label || d.id }))
const booleanValue = (value) => {
	if (typeof value === 'boolean') return value
	if (value === 'true' || value === '1' || value === 1) return true
	if (value === 'false' || value === '0' || value === 0) return false
	throw new Error('Value must be true or false.')
}
function finite(value, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, integer = false) {
	if (value === '' || value === null || value === undefined || typeof value === 'boolean')
		throw new Error('A numeric value is required.')
	const result = Number(value)
	if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result)))
		throw new Error(`Value must be ${integer ? 'an integer ' : ''}between ${min} and ${max}.`)
	return result
}
const definition = (name, options, callback) => ({
	name,
	options,
	callback: async ({ options = {} } = {}) => callback(options),
})
const descriptorDefault = (d) => d.default ?? (d.min > 0 ? d.min : 0)
const eqBandCount = (instance) => {
	const count = instance.features?.capabilities?.equalizer?.band_count
	return Number.isInteger(count) && count >= 0 && count <= 256 ? count : 0
}

export function initialFeatureState() {
	return {
		protocol_version: 0,
		plugin_version: '',
		capabilities: null,
		audio: {},
		equalizer: { available: false, enabled: null, preamp: null, bands: [], presets: [], preset: null },
		player_options: {},
		app_options: {},
		recording: { enabled: null },
		loop: { stage: null, a: null, b: null },
		output: { current: null, devices: [] },
		queue: { count: null, items: [] },
		last_app_command: { command: '', status: '' },
		app_control: { loaded: null, buffering: null, last_action: null },
		skins: { available: false, current: '', installed: [], hue: null, intensity: null },
	}
}

export function featureCatalog(instance, section) {
	const catalog = instance.features?.capabilities?.[section]
	if (Array.isArray(catalog)) return catalog.filter(record).filter((d) => typeof d.id === 'string' && supported(d))
	if (record(catalog))
		return Object.entries(catalog)
			.filter(([, value]) => record(value) && supported(value))
			.map(([id, value]) => ({ ...value, id }))
	return []
}

export function applyFeatureMessage(instance, msg) {
	if (!record(msg)) return false
	instance.features ||= initialFeatureState()
	const state = instance.features
	let changed = false
	const assign = (key, value) => {
		if (JSON.stringify(state[key]) !== JSON.stringify(value)) {
			state[key] = value
			changed = true
		}
	}
	if (Number.isInteger(msg.protocol_version)) assign('protocol_version', msg.protocol_version)
	if (typeof msg.plugin_version === 'string') assign('plugin_version', msg.plugin_version)
	if (record(msg.capabilities)) assign('capabilities', msg.capabilities)
	for (const key of [
		'audio',
		'equalizer',
		'player_options',
		'app_options',
		'recording',
		'loop',
		'output',
		'queue',
		'last_app_command',
		'app_control',
		'skins',
	]) {
		if (!record(msg[key])) continue
		const patch = Object.fromEntries(
			Object.entries(msg[key]).filter(([id]) => !['__proto__', 'constructor', 'prototype'].includes(id)),
		)
		assign(
			key,
			key === 'audio' || key === 'last_app_command'
				? patch
				: key === 'equalizer'
					? { ...initialFeatureState().equalizer, ...patch }
					: { ...state[key], ...patch },
		)
	}
	return changed
}

function requireFeature(instance, section) {
	const cap = instance.features?.capabilities?.[section]
	if (!cap || cap.available === false)
		throw new Error(
			`This AIMP bridge does not expose ${section}. Upgrade the AIMP plugin to 0.2.0 or newer, then reconnect.`,
		)
	return cap
}
function requireParameter(instance, section, parameter) {
	const item = featureCatalog(instance, section).find((d) => d.id === parameter)
	if (!item)
		throw new Error(
			`${parameter || section} is unavailable in the connected AIMP plugin. Upgrade the plugin or refresh its capabilities.`,
		)
	return item
}
function checkedValue(d, value) {
	if (d.type === 'boolean') return booleanValue(value)
	if (d.type === 'enum') {
		const entry = d.choices?.find((choice) => String(choice.id) === String(value))
		if (!entry) throw new Error(`Select a supported ${d.label || d.id} value.`)
		return entry.id
	}
	return finite(value, d.min, d.max, d.type === 'integer')
}
async function fresh(instance, command) {
	const reply = await instance._send(command)
	if (!reply || reply.error) throw new Error(`Cannot read current state for ${command}; no change was sent.`)
	applyFeatureMessage(instance, reply)
	return reply
}
function playlistOption(instance) {
	return {
		...dropdown(
			'playlistId',
			'Playlist (explicit target only)',
			instance.playlistChoices?.length ? instance.playlistChoices : [{ id: '', label: '(load a playlist first)' }],
		),
		// Active/focused/playing actions ignore this saved value. Keep a removed
		// playlist from blocking those modes in Companion's pre-callback parser.
		// Explicit targets still pass through playlistIndex(), which must resolve
		// a currently loaded playlist before any command is sent.
		allowCustom: true,
	}
}
function playlistIndex(instance, id) {
	const index = instance._playlistIndex(id)
	if (!Number.isInteger(index) || index < 0)
		throw new Error('Playlist not found. Refresh the library and select a playlist.')
	return index
}

export function getFeatureActions(instance) {
	const defs = {}
	const cap = instance.features?.capabilities
	if (!cap) return defs
	defs.feature_refresh = definition('Refresh: extended AIMP controls', [], async () => {
		await fresh(instance, 'extensions/get')
	})
	const audio = featureCatalog(instance, 'audio')
	const numericAudio = audio.filter((d) => d.type !== 'boolean')
	if (numericAudio.length) {
		const parameter = () => dropdown('parameter', 'Audio parameter', choices(numericAudio))
		const sendNumeric = async (operation, options) => {
			const d = requireParameter(instance, 'audio', options.parameter)
			if (d.type === 'boolean') throw new Error('Choose a numeric audio parameter.')
			const params = { parameter: d.id }
			if (operation === 'set') params.value = checkedValue(d, options.value)
			if (operation === 'adjust')
				params.delta = finite(options.delta, -Math.abs(d.max - d.min), Math.abs(d.max - d.min))
			return instance._send(`audio/${operation}`, params)
		}
		defs.feature_audio_set = definition(
			'Audio: set parameter',
			[parameter(), number('value', 'Value (in parameter units)', 0, -1000, 1000)],
			(o) => sendNumeric('set', o),
		)
		defs.feature_audio_adjust = definition(
			'Audio: adjust parameter',
			[parameter(), number('delta', 'Change (in parameter units)', 0.1, -1000, 1000)],
			(o) => sendNumeric('adjust', o),
		)
		defs.feature_audio_reset = definition(
			'Audio: reset parameter',
			[dropdown('parameter', 'Audio parameter', [{ id: '*', label: 'All sound effects' }, ...choices(audio)])],
			async (o) => {
				if (o.parameter === '*') {
					requireFeature(instance, 'audio')
					return instance._send('audio/reset')
				}
				requireParameter(instance, 'audio', o.parameter)
				return instance._send('audio/reset', { parameter: o.parameter })
			},
		)
		for (const id of ['pitch', 'tempo', 'speed', 'balance']) {
			const d = numericAudio.find((item) => item.id === id)
			if (!d) continue
			for (const operation of ['set', 'adjust', 'reset']) {
				const opts =
					operation === 'reset'
						? []
						: [
								number(
									operation === 'set' ? 'value' : 'delta',
									`${operation === 'set' ? 'Value' : 'Change'}${d.unit ? ` (${d.unit})` : ''}`,
									operation === 'set' ? descriptorDefault(d) : d.step,
									operation === 'set' ? d.min : -Math.abs(d.max - d.min),
									operation === 'set' ? d.max : Math.abs(d.max - d.min),
								),
							]
				defs[`${id}_${operation}`] = definition(`${d.label || id}: ${operation}`, opts, (o) =>
					sendNumeric(operation, { ...o, parameter: id }),
				)
			}
		}
	}
	const booleanAudio = audio.filter((d) => d.type === 'boolean')
	if (booleanAudio.length) {
		defs.feature_audio_boolean = definition(
			'Audio: switch effect on / off / toggle',
			[dropdown('parameter', 'Audio parameter', choices(booleanAudio)), modes()],
			async (o) => {
				const d = requireParameter(instance, 'audio', o.parameter)
				if (d.type !== 'boolean') throw new Error('Choose an on/off audio parameter.')
				if (o.mode === 'toggle') return instance._send('audio/toggle', { parameter: d.id })
				if (!['on', 'off'].includes(o.mode)) throw new Error('Choose On, Off or Toggle.')
				return instance._send('audio/set', { parameter: d.id, value: o.mode === 'on' })
			},
		)
	}
	if (cap.equalizer?.available) {
		const eq = cap.equalizer
		const bandCount = eqBandCount(instance)
		const band = () =>
			dropdown(
				'band',
				'Equalizer band',
				Array.from({ length: bandCount }, (_, index) => {
					const frequency = instance.features.equalizer.bands?.find((b) => b.index === index)?.frequency
					return {
						id: index,
						label: `Band ${index + 1}${frequency ? ` · ${frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`}` : ''}`,
					}
				}),
			)
		const bandIndex = (value) => {
			requireFeature(instance, 'equalizer')
			return finite(value, 0, eqBandCount(instance) - 1, true)
		}
		defs.feature_eq_enabled = definition('Equalizer: on / off / toggle', [modes()], async (o) => {
			requireFeature(instance, 'equalizer')
			if (o.mode === 'toggle') return instance._send('equalizer/toggle')
			if (!['on', 'off'].includes(o.mode)) throw new Error('Choose On, Off or Toggle.')
			return instance._send('equalizer/set', { enabled: o.mode === 'on' })
		})
		defs.feature_eq_reset = definition('Equalizer: reset all bands and preamp to flat', [], () => {
			requireFeature(instance, 'equalizer')
			return instance._send('equalizer/reset')
		})
		for (const operation of ['set', 'adjust', 'reset']) {
			const isSet = operation === 'set',
				valueKey = isSet ? 'value' : 'delta'
			const preamp = eq.preamp || { min: -15, max: 15, default: 0, step: 0.5 }
			defs[`feature_eq_preamp_${operation}`] = definition(
				`Equalizer preamp: ${operation}`,
				operation === 'reset'
					? []
					: [
							number(
								valueKey,
								`${isSet ? 'Gain' : 'Change'} (dB)`,
								isSet ? 0 : preamp.step,
								isSet ? preamp.min : preamp.min - preamp.max,
								isSet ? preamp.max : preamp.max - preamp.min,
							),
						],
				(o) => {
					const p = requireFeature(instance, 'equalizer').preamp || preamp
					return instance._send(
						`equalizer/preamp/${operation === 'reset' ? 'set' : operation}`,
						operation === 'reset'
							? { value: p.default ?? 0 }
							: { [valueKey]: finite(o[valueKey], isSet ? p.min : p.min - p.max, isSet ? p.max : p.max - p.min) },
					)
				},
			)
			if (bandCount > 0)
				defs[`feature_eq_band_${operation}`] = definition(
					`Equalizer band: ${operation}`,
					[
						band(),
						...(operation === 'reset'
							? []
							: [
									number(
										valueKey,
										`${isSet ? 'Gain' : 'Change'} (dB)`,
										isSet ? 0 : eq.step,
										isSet ? eq.min : eq.min - eq.max,
										isSet ? eq.max : eq.max - eq.min,
									),
								]),
					],
					(o) => {
						const b = bandIndex(o.band),
							current = requireFeature(instance, 'equalizer')
						return instance._send(`equalizer/band/${operation === 'reset' ? 'set' : operation}`, {
							band: b,
							...(operation === 'reset'
								? { value: 0 }
								: {
										[valueKey]: finite(
											o[valueKey],
											isSet ? current.min : current.min - current.max,
											isSet ? current.max : current.max - current.min,
										),
									}),
						})
					},
				)
		}
		if (eq.preset_save)
			defs.feature_eq_preset_save = definition(
				'Equalizer: save current bands as new preset (preamp not stored)',
				[text('name', 'New preset name')],
				(o) => {
					if (!requireFeature(instance, 'equalizer').preset_save)
						throw new Error('Saving equalizer presets is unavailable.')
					if (typeof o.name !== 'string' || !o.name.trim()) throw new Error('Enter a new equalizer preset name.')
					const name = o.name.trim()
					if (Buffer.byteLength(name, 'utf8') > 512)
						throw new Error('Equalizer preset names cannot exceed 512 UTF-8 bytes.')
					if (name.length > 128) throw new Error('Equalizer preset names cannot exceed 128 UTF-16 characters.')
					if (/[\\/:*?"<>|\x00-\x1f\x7f]/.test(name) || name.endsWith('.'))
						throw new Error('Use a preset name without path characters, control characters or a trailing dot.')
					if (instance.features.equalizer.presets?.some((existing) => existing.toLowerCase() === name.toLowerCase()))
						throw new Error('That preset already exists. Enter a new name; existing presets are not overwritten.')
					return instance._send('equalizer/preset/save', { name })
				},
			)
		const presets = instance.features.equalizer.presets || []
		if (presets.length)
			defs.feature_eq_preset = definition(
				'Equalizer: apply preset',
				[
					dropdown(
						'name',
						'Preset',
						presets.map((name) => ({ id: name, label: name })),
					),
				],
				(o) => {
					requireFeature(instance, 'equalizer')
					if (!instance.features.equalizer.presets.includes(o.name))
						throw new Error('Equalizer preset is no longer available. Refresh extended controls.')
					return instance._send('equalizer/preset/apply', { name: o.name })
				},
			)
	}
	for (const [section, prefix, label, wire] of [
		['player_options', 'player', 'Player option', 'player/options'],
		['app_options', 'app', 'AIMP option', 'app/options'],
	]) {
		for (const d of featureCatalog(instance, section)) {
			let opts
			if (d.type === 'boolean') opts = [modes()]
			else if (d.type === 'enum') opts = [dropdown('value', d.label || d.id, d.choices || [])]
			else
				opts = [
					dropdown('operation', 'Operation', [
						{ id: 'set', label: 'Set' },
						{ id: 'adjust', label: 'Adjust' },
					]),
					number(
						'value',
						`Value / change${d.unit ? ` (${d.unit})` : ''}`,
						descriptorDefault(d),
						-(d.max || 2147483647),
						d.max ?? 2147483647,
					),
				]
			defs[`feature_${prefix}_${d.id}`] = definition(`${label}: ${d.label || d.id}`, opts, async (o) => {
				const current = requireParameter(instance, section, d.id)
				let value
				if (current.type === 'boolean') {
					if (!['on', 'off', 'toggle'].includes(o.mode)) throw new Error('Choose On, Off or Toggle.')
					if (o.mode === 'toggle') {
						const reply = await fresh(instance, `${wire}/get`)
						if (typeof reply[section]?.[d.id] !== 'boolean')
							throw new Error('Current option value is unavailable; no toggle was sent.')
						value = !reply[section][d.id]
					} else value = o.mode === 'on'
				} else if (current.type !== 'enum' && o.operation === 'adjust') {
					const delta = finite(
						o.value,
						-(current.max - current.min),
						current.max - current.min,
						current.type === 'integer',
					)
					const reply = await fresh(instance, `${wire}/get`)
					const previous = reply[section]?.[d.id]
					if (typeof previous !== 'number' || !Number.isFinite(previous))
						throw new Error('Current option value is unavailable; no change was sent.')
					value = checkedValue(current, Math.max(current.min, Math.min(current.max, previous + delta)))
				} else {
					if (current.type !== 'enum' && o.operation !== 'set') throw new Error('Choose Set or Adjust.')
					value = checkedValue(current, o.value)
				}
				return instance._send(`${wire}/set`, { parameter: d.id, value })
			})
		}
	}
	const commands = featureCatalog(instance, 'app_commands')
	if (commands.length)
		defs.feature_app_command = definition(
			'AIMP interface: open window / run command',
			[
				dropdown('command', 'Command', choices(commands)),
				{
					type: 'checkbox',
					id: 'confirm',
					label: 'Confirm playlist cleanup / selected-item changes when required',
					default: false,
				},
				number(
					'param',
					'DSP manager tab (0: Common, 1: EQ, 2: Volume, 3: Crossfade; ignored for other commands)',
					0,
					0,
					3,
				),
			],
			(o) => {
				const d = requireParameter(instance, 'app_commands', o.command)
				if (d.requires_confirmation && o.confirm !== true)
					throw new Error('Enable the confirmation checkbox for this playlist operation.')
				return instance._send('app/command', {
					command: o.command,
					...(d.requires_confirmation ? { confirm: true } : {}),
					...(Number.isFinite(d.param_min)
						? { param: finite(o.param ?? d.param_min, d.param_min, d.param_max, true) }
						: {}),
				})
			},
		)
	if (cap.loop?.available) {
		if (cap.loop.cycle)
			defs.feature_loop_cycle = definition('A–B loop: mark A / mark B / clear at current position', [], () => {
				requireFeature(instance, 'loop')
				return instance._send('loop/cycle')
			})
		if (cap.loop.range) {
			defs.feature_loop_set = definition(
				'A–B loop: set range',
				[number('a', 'Start A (seconds)', 0, 0, 3600000), number('b', 'End B (seconds)', 10, 0, 3600000)],
				(o) => {
					requireFeature(instance, 'loop')
					const a = finite(o.a, 0, 3600000),
						b = finite(o.b, 0, 3600000)
					if (b <= a) throw new Error('Loop end B must be later than start A.')
					return instance._send('loop/set', { a, b })
				},
			)
			defs.feature_loop_clear = definition('A–B loop: clear', [], () => {
				requireFeature(instance, 'loop')
				return instance._send('loop/set', { a: null, b: null })
			})
		}
	}
	if (cap.recording?.available)
		defs.feature_recording = definition('Internet radio capture: on / off / toggle', [modes()], async (o) => {
			requireFeature(instance, 'recording')
			if (!['on', 'off', 'toggle'].includes(o.mode)) throw new Error('Choose On, Off or Toggle.')
			let enabled = o.mode === 'on'
			if (o.mode === 'toggle') {
				const reply = await fresh(instance, 'recording/get')
				if (typeof reply.recording?.enabled !== 'boolean')
					throw new Error('Radio capture state is unavailable; no toggle was sent.')
				enabled = !reply.recording.enabled
			}
			return instance._send('recording/set', { enabled })
		})
	if (cap.output?.available) {
		defs.feature_output_refresh = definition('Audio output: refresh devices', [], () => {
			requireFeature(instance, 'output')
			return fresh(instance, 'output/get')
		})
		const devices = instance.features.output.devices || []
		if (devices.length)
			defs.feature_output_set = definition(
				'Audio output: select device',
				[
					dropdown(
						'id',
						'Output device',
						devices.map((d) => ({ id: d.id, label: d.name || d.id })),
					),
				],
				(o) => {
					requireFeature(instance, 'output')
					if (!instance.features.output.devices.some((d) => d.id === o.id))
						throw new Error('Output device is no longer available. Refresh output devices.')
					return instance._send('output/set', { id: o.id })
				},
			)
	}
	Object.assign(
		defs,
		libraryActions(instance),
		getMediaActions(instance),
		getMusicLibraryActions(instance),
		getLibraryToolActions(instance),
		getAppToolActions(instance),
	)
	return defs
}

const activeStyle = { bgcolor: 0x126941, color: 0xffffff }
function feedback(name, options, callback) {
	return { type: 'boolean', name, options, defaultStyle: activeStyle, callback }
}
function isActive(value, baseline = 0) {
	return typeof value === 'boolean'
		? value
		: typeof value === 'number' && Number.isFinite(value) && Math.abs(value - baseline) > 0.00001
}
export function getFeatureFeedbacks(instance) {
	const audio = featureCatalog(instance, 'audio')
	const defs = {
		feature_available: feedback(
			'Extended controls: bridge supports this feature',
			[
				dropdown('feature', 'Feature', [
					{ id: 'audio', label: 'Audio effects' },
					{ id: 'equalizer', label: 'Equalizer' },
					{ id: 'recording', label: 'Radio capture' },
					{ id: 'loop', label: 'A–B loop' },
					{ id: 'output', label: 'Output selection' },
				]),
			],
			(fb) => {
				const d = instance.features?.capabilities?.[fb.options.feature]
				return !!d && d.available !== false && (!Array.isArray(d) || d.some(supported))
			},
		),
		feature_eq_enabled: feedback('Equalizer: enabled', [], () => instance.features?.equalizer.enabled === true),
		feature_recording_active: feedback(
			'Internet radio capture: active',
			[],
			() => instance.features?.recording.enabled === true,
		),
		feature_loop_active: feedback('A–B loop: both points set', [], () => instance.features?.loop.stage === 2),
		feature_loop_marked: feedback('A–B loop: A point set', [], () => instance.features?.loop.stage === 1),
		feature_queue_suspended: feedback('Queue: suspended', [], () => instance.features?.queue.suspended === true),
		feature_queue_has_items: feedback('Queue: contains tracks', [], () => Number(instance.features?.queue.count) > 0),
	}
	if (audio.length) {
		const parameter = () => dropdown('parameter', 'Audio parameter', choices(audio))
		defs.feature_audio_active = feedback('Audio: value differs from default / effect enabled', [parameter()], (fb) => {
			const d = audio.find((item) => item.id === fb.options.parameter)
			return !!d && isActive(instance.features?.audio[d.id], descriptorDefault(d))
		})
		defs.feature_audio_threshold = feedback(
			'Audio: compare value',
			[
				parameter(),
				dropdown('comparison', 'Comparison', [
					{ id: 'gte', label: 'At least (≥)' },
					{ id: 'lte', label: 'At most (≤)' },
					{ id: 'eq', label: 'Equals (=)' },
				]),
				number('value', 'Value', 0, -1000, 1000),
			],
			(fb) => {
				const value = instance.features?.audio[fb.options.parameter],
					target = Number(fb.options.value)
				if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(target)) return false
				return fb.options.comparison === 'gte'
					? value >= target
					: fb.options.comparison === 'lte'
						? value <= target
						: Math.abs(value - target) < 0.00001
			},
		)
	}
	const count = eqBandCount(instance)
	if (count > 0)
		defs.feature_eq_band_active = feedback(
			'Equalizer: band differs from flat',
			[number('band', 'Band index (0-based)', 0, 0, count - 1)],
			(fb) => isActive(instance.features?.equalizer.bands.find((b) => b.index === Number(fb.options.band))?.gain),
		)
	defs.feature_eq_preamp_active = feedback('Equalizer: preamp differs from zero', [], () =>
		isActive(instance.features?.equalizer.preamp),
	)
	for (const [section, prefix, label] of [
		['player_options', 'player', 'Player option'],
		['app_options', 'app', 'AIMP option'],
	]) {
		const descriptors = featureCatalog(instance, section)
		if (!descriptors.length) continue
		defs[`feature_${prefix}_option_active`] = feedback(
			`${label}: enabled`,
			[dropdown('option', 'Option', choices(descriptors.filter((d) => d.type === 'boolean')))],
			(fb) => instance.features?.[section][fb.options.option] === true,
		)
		defs[`feature_${prefix}_option_is`] = feedback(
			`${label}: equals value`,
			[dropdown('option', 'Option', choices(descriptors)), text('value', 'Value', '0')],
			(fb) => String(instance.features?.[section][fb.options.option]) === String(fb.options.value),
		)
	}
	const devices = instance.features?.output?.devices || []
	if (devices.length)
		defs.feature_output_is = feedback(
			'Audio output: device selected',
			[
				dropdown(
					'id',
					'Device',
					devices.map((d) => ({ id: d.id, label: d.name || d.id })),
				),
			],
			(fb) => instance.features?.output.current === fb.options.id,
		)
	for (const def of Object.values(defs)) {
		const callback = def.callback
		def.callback = (fb) => !!instance.state?.connected && callback(fb)
	}
	return {
		...defs,
		...getMediaFeedbacks(instance),
		...getMusicLibraryFeedbacks(instance),
		...getLibraryToolFeedbacks(instance),
		...getAppToolFeedbacks(instance),
	}
}

function formatted(value, unit = '') {
	if (typeof value === 'boolean') return value ? 'ON' : 'OFF'
	if (typeof value !== 'number' || !Number.isFinite(value)) return ''
	const display = String(Number(value.toFixed(3)))
	return unit === 'x' ? `${display}×` : `${display}${unit ? ` ${unit}` : ''}`
}
export function getFeatureVariableDefinitions(instance) {
	const defs = {
		bridge_version: { name: 'AIMP Companion Control plugin version' },
		bridge_protocol: { name: 'AIMP Companion Control protocol version' },
		feature_status: { name: 'Extended controls availability' },
		eq_enabled: { name: 'Equalizer enabled (true/false)' },
		eq_preamp: { name: 'Equalizer preamp (dB)' },
		eq_preamp_fmt: { name: 'Equalizer preamp with units' },
		eq_preset: { name: 'Equalizer selected preset' },
		recording_enabled: { name: 'Internet radio capture enabled (true/false)' },
		loop_stage: { name: 'A–B loop stage (0 clear, 1 A, 2 A+B)' },
		loop_a: { name: 'A–B loop start (seconds)' },
		loop_b: { name: 'A–B loop end (seconds)' },
		last_app_command: { name: 'Last AIMP interface command' },
		last_app_command_status: { name: 'Last AIMP interface command status (queued/executing/completed/failed)' },
		last_app_command_error: { name: 'Last AIMP interface command failure detail' },
		last_app_command_hresult: { name: 'Last AIMP interface command HRESULT (hex)' },
		output_device: { name: 'Current audio output device ID' },
		output_device_name: { name: 'Current audio output device name' },
		queue_count: { name: 'Playback queue item count' },
		queue_suspended: { name: 'Playback queue suspended (true/false)' },
	}
	for (const d of featureCatalog(instance, 'audio')) {
		defs[`audio_${d.id}`] = { name: `${d.label || d.id}${d.unit ? ` (${d.unit})` : ''}` }
		defs[`audio_${d.id}_fmt`] = { name: `${d.label || d.id} with units` }
	}
	for (let index = 0; index < eqBandCount(instance); index++) {
		defs[`eq_band_${index}`] = { name: `Equalizer band ${index + 1} gain (dB)` }
		defs[`eq_band_${index}_fmt`] = { name: `Equalizer band ${index + 1} gain with units` }
		defs[`eq_band_${index}_frequency`] = { name: `Equalizer band ${index + 1} frequency (Hz)` }
	}
	for (const [section, prefix] of [
		['player_options', 'player_option'],
		['app_options', 'app_option'],
	])
		for (const d of featureCatalog(instance, section)) {
			defs[`${prefix}_${d.id}`] = { name: d.label || d.id }
			defs[`${prefix}_${d.id}_fmt`] = { name: `${d.label || d.id} (formatted)` }
		}
	return {
		...defs,
		...getMediaVariableDefinitions(instance),
		...getMusicLibraryVariableDefinitions(instance),
		...getLibraryToolVariableDefinitions(instance),
		...getAppToolVariableDefinitions(instance),
	}
}
export function getFeatureVariableValues(instance) {
	const s = instance.features || initialFeatureState(),
		connected = !!instance.state?.connected
	const value = (v) => (connected && v !== null && v !== undefined ? v : '')
	const values = {
		bridge_version: s.plugin_version || '',
		bridge_protocol: s.protocol_version || '',
		feature_status: !connected
			? 'Disconnected'
			: s.capabilities
				? 'Extended controls available'
				: 'Upgrade the AIMP plugin to 0.2.0 for extended controls',
		eq_enabled: value(s.equalizer.enabled),
		eq_preamp: value(s.equalizer.preamp),
		eq_preamp_fmt: connected ? formatted(s.equalizer.preamp, 'dB') : '',
		eq_preset: value(s.equalizer.preset),
		recording_enabled: value(s.recording.enabled),
		loop_stage: value(s.loop.stage),
		loop_a: value(s.loop.a),
		loop_b: value(s.loop.b),
		last_app_command: value(s.last_app_command.command),
		last_app_command_status: value(s.last_app_command.status),
		last_app_command_error: connected ? deferredCommandError(s.last_app_command) : '',
		last_app_command_hresult: connected ? formatHresult(s.last_app_command.hresult) : '',
		output_device: value(s.output.current),
		output_device_name: value(s.output.devices?.find((d) => d.id === s.output.current)?.name),
		queue_count: value(s.queue.count),
		queue_suspended: value(s.queue.suspended),
	}
	for (const d of featureCatalog(instance, 'audio')) {
		values[`audio_${d.id}`] = value(s.audio[d.id])
		values[`audio_${d.id}_fmt`] = connected ? formatted(s.audio[d.id], d.unit) : ''
	}
	for (let index = 0; index < eqBandCount(instance); index++) {
		const band = s.equalizer.bands.find((b) => b.index === index)
		values[`eq_band_${index}`] = value(band?.gain)
		values[`eq_band_${index}_fmt`] = connected ? formatted(band?.gain, 'dB') : ''
		values[`eq_band_${index}_frequency`] = value(band?.frequency)
	}
	for (const [section, prefix] of [
		['player_options', 'player_option'],
		['app_options', 'app_option'],
	])
		for (const d of featureCatalog(instance, section)) {
			values[`${prefix}_${d.id}`] = value(s[section][d.id])
			values[`${prefix}_${d.id}_fmt`] = connected
				? d.choices?.find((item) => item.id === s[section][d.id])?.label || formatted(s[section][d.id], d.unit)
				: ''
		}
	return {
		...values,
		...getMediaVariableValues(instance),
		...getMusicLibraryVariableValues(instance),
		...getLibraryToolVariableValues(instance),
		...getAppToolVariableValues(instance),
	}
}

function libraryActions(instance) {
	const library = instance.features?.capabilities?.library
	if (!library?.available) return {}
	const defs = {}
	const commands = library.commands || []
	const command = async (name, params) => {
		const current = requireFeature(instance, 'library')
		if (!current.commands?.includes(name)) throw new Error(`${name} is unavailable in the current AIMP plugin.`)
		return instance._send(name, params)
	}
	const add = (id, wire, name, opts, getParams = () => undefined) => {
		if (commands.includes(wire)) defs[id] = definition(name, opts, async (o) => command(wire, await getParams(o)))
	}
	const targetOptions = (kind) => [
		dropdown(
			'target',
			'Target',
			kind === 'track'
				? [
						{ id: 'focused', label: 'Focused track' },
						{ id: 'playing', label: 'Playing track' },
						{ id: 'explicit', label: 'Selected playlist / track index below' },
					]
				: [
						{ id: 'active', label: 'Active playlist tab' },
						{ id: 'playing', label: 'Playing playlist' },
						{ id: 'focused', label: 'Focused playlist' },
						{ id: 'explicit', label: 'Selected playlist below' },
					],
		),
		playlistOption(instance),
		...(kind === 'track' ? [number('trackId', 'Track index (0-based; explicit target only)', 0, 0, 999999)] : []),
	]
	const target = (kind, o) => {
		const allowed = kind === 'track' ? ['focused', 'playing', 'explicit'] : ['active', 'focused', 'playing', 'explicit']
		const mode = o.target || allowed[0]
		if (!allowed.includes(mode)) throw new Error('Select a supported playlist or track target.')
		return mode === 'explicit'
			? {
					target: mode,
					playlist_id: playlistIndex(instance, o.playlistId),
					...(kind === 'track' ? { track_id: finite(o.trackId, 0, 999999, true) } : {}),
				}
			: { target: mode }
	}
	const checkedText = (value, label, maximumBytes = 4096) => {
		if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} cannot be empty.`)
		if (Buffer.byteLength(value, 'utf8') > maximumBytes)
			throw new Error(`${label} exceeds ${maximumBytes} UTF-8 bytes.`)
		return value.trim()
	}
	add('feature_queue_refresh', 'queue/get', 'Queue: refresh', [], () => ({
		offset: 0,
		limit: library.limits?.queue_page || 250,
	}))
	add(
		'feature_queue_add',
		'queue/add',
		'Queue: add track',
		[...targetOptions('track'), { type: 'checkbox', id: 'first', label: 'Place first in queue', default: false }],
		(o) => ({ ...target('track', o), first: !!o.first }),
	)
	add('feature_queue_remove_track', 'queue/remove', 'Queue: remove track', targetOptions('track'), (o) =>
		target('track', o),
	)
	add(
		'feature_queue_remove',
		'queue/remove',
		'Queue: remove by queue position',
		[number('index', 'Queue position (0-based)', 0, 0, 999999)],
		(o) => ({ queue_index: finite(o.index, 0, 999999, true) }),
	)
	add('feature_queue_clear', 'queue/clear', 'Queue: clear queued playback entries', [])
	add(
		'feature_queue_move',
		'queue/move',
		'Queue: move entry',
		[
			number('index', 'Current queue position (0-based)', 0, 0, 999999),
			number('destination', 'New queue position (0-based)', 0, 0, 999999),
		],
		(o) => ({ queue_index: finite(o.index, 0, 999999, true), target_index: finite(o.destination, 0, 999999, true) }),
	)
	add('feature_queue_suspended', 'queue/suspended', 'Queue: suspend / resume / toggle', [modes()], async (o) => {
		if (!['on', 'off', 'toggle'].includes(o.mode)) throw new Error('Choose On (suspend), Off (resume), or Toggle.')
		let value = o.mode === 'on'
		if (o.mode === 'toggle') {
			const reply = await fresh(instance, 'queue/get')
			if (typeof reply.queue?.suspended !== 'boolean')
				throw new Error('Queue suspension state is unavailable; no toggle was sent.')
			value = !reply.queue.suspended
		}
		return { value }
	})
	add(
		'feature_playlist_create',
		'playlists/create',
		'Playlist: create',
		[
			text('name', 'Playlist name', 'New playlist'),
			{ type: 'checkbox', id: 'activate', label: 'Activate new playlist', default: true },
		],
		(o) => ({ name: checkedText(o.name, 'Playlist name'), activate: !!o.activate }),
	)
	add(
		'feature_playlist_rename',
		'playlists/rename',
		'Playlist: rename',
		[...targetOptions('playlist'), text('name', 'New name')],
		(o) => ({ ...target('playlist', o), name: checkedText(o.name, 'Playlist name') }),
	)
	add(
		'feature_playlist_close',
		'playlists/close',
		'Playlist: close tab (preserves saved playlist file)',
		targetOptions('playlist'),
		(o) => target('playlist', o),
	)
	add(
		'feature_playlist_add',
		'playlists/add',
		'Playlist: add media file / stream URL',
		[
			...targetOptions('playlist'),
			text('uri', 'File path or URL on the AIMP computer'),
			number('position', 'Insert position (-1 = append)', -1, -1, 999999),
		],
		(o) => ({
			...target('playlist', o),
			uri: checkedText(o.uri, 'File path / URL'),
			insert_at: finite(o.position, -1, 999999, true),
		}),
	)
	add(
		'feature_playlist_clear',
		'playlists/clear',
		'Playlist: remove all entries (preserves media files)',
		targetOptions('playlist'),
		(o) => target('playlist', o),
	)
	add(
		'feature_playlist_sort',
		'playlists/sort',
		'Playlist: sort / reverse / randomize',
		[...targetOptions('playlist'), dropdown('mode', 'Sort mode', library.sort_modes || [])],
		(o) => {
			if (!instance.features.capabilities.library.sort_modes?.some((mode) => mode.id === o.mode))
				throw new Error('Select a supported playlist sort mode.')
			return { ...target('playlist', o), mode: o.mode }
		},
	)
	add(
		'feature_playlist_info',
		'playlists/info',
		'Inspect: extended playlist information (last_response)',
		targetOptions('playlist'),
		(o) => target('playlist', o),
	)
	add(
		'feature_track_remove',
		'playlists/track/remove',
		'Track: remove playlist entry (preserves media file)',
		targetOptions('track'),
		(o) => target('track', o),
	)
	add(
		'feature_track_move',
		'playlists/track/move',
		'Track: move within playlist',
		[...targetOptions('track'), number('destination', 'New track position (0-based)', 0, 0, 999999)],
		(o) => ({ ...target('track', o), target_index: finite(o.destination, 0, 999999, true) }),
	)
	add(
		'feature_track_enabled',
		'playlists/track/enabled',
		'Track: enable / disable playback',
		[...targetOptions('track'), { type: 'checkbox', id: 'enabled', label: 'Enabled for playback', default: true }],
		(o) => ({ ...target('track', o), value: !!o.enabled }),
	)
	const rating = library.rating || { min: 0, max: 5, step: 0.5 }
	add(
		'feature_track_rating',
		'playlists/track/rating',
		'Track: set rating',
		[
			...targetOptions('track'),
			{ ...number('rating', 'Rating (0 = unrated)', 0, rating.min, rating.max), step: rating.step },
		],
		(o) => ({ ...target('track', o), value: finite(o.rating, rating.min, rating.max) }),
	)
	add(
		'feature_track_info',
		'playlists/track/info',
		'Inspect: extended track information (last_response)',
		targetOptions('track'),
		(o) => target('track', o),
	)
	add('feature_file_info', 'player/fileinfo', 'Inspect: playing file decoder / audio metadata (last_response)', [])
	add(
		'feature_play_file',
		'player/play-file',
		'Play: media file / stream URL directly',
		[
			{
				...text('uri', 'Media file path or URL on the AIMP computer'),
				description: 'Ordinary media plays directly. AIMP imports playlist-file URLs into its playlists.',
			},
		],
		(o) => ({ uri: checkedText(o.uri, 'Media file path / URL', 16384) }),
	)
	return defs
}
