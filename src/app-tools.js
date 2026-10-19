import { deferredCommandError, formatHresult } from './command-diagnostics.js'

const drop = (id, label, choices) => ({ type: 'dropdown', id, label, choices, default: choices[0]?.id || '' })
const text = (id, label, value = '') => ({ type: 'textinput', id, label, default: value })
const confirm = (label) => ({ type: 'checkbox', id: 'confirm', label, default: false })
const def = (name, options, callback) => ({
	name,
	options,
	callback: async ({ options = {} } = {}) => callback(options),
})
const checked = (o) => {
	if (o.confirm !== true) throw new Error('Enable this action’s confirmation checkbox before executing.')
}
const input = (value, label, maximum) => {
	if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > maximum)
		throw new Error(`${label} is required (maximum ${maximum} UTF-8 bytes).`)
	return value
}
export function getAppToolActions(instance) {
	const caps = instance.features?.capabilities,
		app = caps?.app_control,
		defs = {}
	if (app?.notifications) {
		defs.feature_app_notification = def(
			'AIMP: show notification',
			[
				text('text', 'Notification text'),
				{ type: 'checkbox', id: 'persistent', label: 'Keep notification visible', default: false },
			],
			(o) =>
				instance._send('app/notification', { text: input(o.text, 'Notification', 4096), persistent: !!o.persistent }),
		)
		defs.feature_app_notification_clear = def('AIMP: clear notification', [], () =>
			instance._send('app/notification/clear'),
		)
	}
	const windows = app?.windows?.filter((w) => w.available) || []
	if (windows.length)
		defs.feature_app_window = def(
			'AIMP window: show / hide / minimize / restore / focus',
			[
				drop(
					'window',
					'Window',
					windows.map((w) => ({ id: w.id, label: w.id })),
				),
				drop(
					'operation',
					'Operation',
					['show', 'hide', 'minimize', 'restore', 'foreground'].map((id) => ({ id, label: id })),
				),
			],
			(o) => {
				if (!instance.features.capabilities.app_control.windows.some((w) => w.id === o.window && w.available))
					throw new Error('This AIMP window is unavailable.')
				return instance._send('app/window', { window: o.window, operation: o.operation })
			},
		)
	if (app?.action_lookup)
		defs.feature_app_action_get = def(
			'AIMP action: inspect registered action by ID',
			[text('id', 'Registered AIMP action ID (from AIMP / plug-in documentation)')],
			(o) => instance._send('app/action/get', { id: input(o.id, 'Action ID', 512) }),
		)
	if (app?.action_execute)
		defs.feature_app_action_execute = def(
			'AIMP action: execute registered action by ID',
			[text('id', 'Registered AIMP action ID')],
			async (o) => {
				const id = input(o.id, 'Action ID', 512),
					reply = await instance._send('app/action/get', { id })
				if (!reply?.app_action?.executable || reply.app_action.enabled === false)
					throw new Error('This registered AIMP action is unavailable or disabled.')
				return instance._send('app/action/execute', { id })
			},
		)
	if (app?.quit)
		defs.feature_app_quit = def('AIMP: request application close', [confirm('I intend to close AIMP')], (o) => {
			checked(o)
			return instance._send('app/quit', { confirm: true })
		})
	const eq = caps?.equalizer,
		presets = instance.features?.equalizer?.presets || []
	if (presets.length)
		for (const operation of ['rename', 'delete']) {
			if (!eq?.[`preset_${operation}`]) continue
			defs[`feature_eq_preset_${operation}`] = def(
				`Equalizer preset: ${operation} (factory presets are not distinguished by AIMP)`,
				[
					drop(
						'name',
						'Existing preset',
						presets.map((name) => ({ id: name, label: name })),
					),
					...(operation === 'rename' ? [text('new_name', 'New preset name')] : []),
					confirm(`I intend to ${operation} this equalizer preset`),
				],
				(o) => {
					checked(o)
					if (!instance.features.equalizer.presets.includes(o.name))
						throw new Error('That equalizer preset is no longer available.')
					return instance._send(`equalizer/preset/${operation}`, {
						name: o.name,
						confirm: true,
						...(operation === 'rename' ? { new_name: input(o.new_name, 'New preset name', 512) } : {}),
					})
				},
			)
		}
	const skins = caps?.skins
	if (skins?.available) {
		defs.feature_skin_refresh = def('Skin: refresh installed skins and colors', [], () => instance._send('skins/get'))
		if (skins.selection)
			defs.feature_skin_set = def(
				'Skin: select installed skin',
				[
					drop('name', 'Installed skin', [
						{ id: '', label: 'AIMP default skin' },
						...(instance.features.skins?.installed || []).map((item) => ({
							id: item.name,
							label: item.title || item.name,
						})),
					]),
				],
				(o) => {
					if (o.name !== '' && !instance.features.skins?.installed?.some((item) => item.name === o.name))
						throw new Error('This skin is no longer installed.')
					return instance._send('skins/set', { name: o.name })
				},
			)
		defs.feature_skin_reapply = def('Skin: reapply current skin', [], () => instance._send('skins/reapply'))
		const colors = Object.entries(skins.color || {})
			.filter(([, d]) => d.available)
			.map(([id, d]) => ({ id, ...d }))
		for (const operation of ['set', 'adjust'])
			if (colors.length)
				defs[`feature_skin_color_${operation}`] = def(
					`Skin color: ${operation}`,
					[
						drop(
							'parameter',
							'Color parameter',
							colors.map((d) => ({ id: d.id, label: d.id })),
						),
						{
							type: 'number',
							id: operation === 'set' ? 'value' : 'delta',
							label: operation === 'set' ? 'Value' : 'Change',
							default: operation === 'set' ? 0 : 1,
							min: operation === 'set' ? 0 : -255,
							max: 255,
							step: 1,
						},
					],
					(o) => {
						const d = instance.features.capabilities.skins.color[o.parameter],
							key = operation === 'set' ? 'value' : 'delta',
							value = Number(o[key])
						if (
							!d?.available ||
							!Number.isInteger(value) ||
							value < (operation === 'set' ? d.min : d.min - d.max) ||
							value > (operation === 'set' ? d.max : d.max - d.min)
						)
							throw new Error('Skin color value is outside the supported range.')
						return instance._send(`skins/color/${operation}`, { parameter: o.parameter, [key]: value })
					},
				)
	}
	return defs
}
export function getAppToolVariableDefinitions() {
	return {
		skin_current: { name: 'Current AIMP skin' },
		skin_hue: { name: 'Skin hue (0–255)' },
		skin_intensity: { name: 'Skin intensity (0–100)' },
		aimp_loaded: { name: 'AIMP finished loading' },
		aimp_buffering: { name: 'AIMP buffering progress (0–100)' },
		app_registered_action_id: { name: 'Last registered action ID' },
		app_registered_action_status: { name: 'Last registered action completion status' },
		app_registered_action_error: { name: 'Last registered action failure detail' },
		app_registered_action_hresult: { name: 'Last registered action HRESULT (hex)' },
	}
}
export function getAppToolVariableValues(instance) {
	const s = instance.features?.app_control || {},
		c = instance.state.connected
	return {
		skin_current: c ? instance.features?.skins?.current || '' : '',
		skin_hue: c ? (instance.features?.skins?.hue ?? '') : '',
		skin_intensity: c ? (instance.features?.skins?.intensity ?? '') : '',
		aimp_loaded: c ? (s.loaded ?? '') : '',
		aimp_buffering: c ? (s.buffering ?? '') : '',
		app_registered_action_id: c ? s.last_action?.id || '' : '',
		app_registered_action_status: c ? s.last_action?.status || '' : '',
		app_registered_action_error: c ? deferredCommandError(s.last_action) : '',
		app_registered_action_hresult: c ? formatHresult(s.last_action?.hresult) : '',
	}
}
export function getAppToolFeedbacks(instance) {
	return {
		feature_skin_selected: {
			type: 'boolean',
			name: 'Skin: selected',
			options: [text('name', 'Installed skin filename (empty = default)')],
			defaultStyle: { bgcolor: 0x126941, color: 0xffffff },
			callback: ({ options }) => !!instance.state.connected && instance.features?.skins?.current === options.name,
		},
		feature_aimp_buffering: {
			type: 'boolean',
			name: 'AIMP: buffering media',
			options: [],
			defaultStyle: { bgcolor: 0xfbbf24, color: 0x000000 },
			callback: () =>
				!!instance.state.connected &&
				typeof instance.features?.app_control?.buffering === 'number' &&
				instance.features.app_control.buffering < 100 &&
				instance.features.app_control.buffering > 0,
		},
	}
}
