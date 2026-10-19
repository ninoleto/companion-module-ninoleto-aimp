// Capability-driven additions. Existing beta.2 presets keep their IDs and artwork.
// All graphics are native Companion 5 layers; every text layer uses 20 / shrink-to-fit.
import { createHash } from 'node:crypto'
import { palette } from './preset-style.js'
import { iconImages } from './preset-icons.js'
import { featureIcons } from './feature-icons.js'

const action = (actionId, options = {}) => ({ actionId, options })
const override = (elementId, elementProperty, value) => ({
	elementId,
	elementProperty,
	override: { isExpression: false, value },
})
const available = (descriptor) =>
	Boolean(descriptor) && descriptor.available !== false && descriptor.supported !== false
const entries = (catalog) =>
	Array.isArray(catalog) ? catalog.map((item) => [item.id, item]) : Object.entries(catalog || {})
const key = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '_')
const hash = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 20)
const pretty = (value) =>
	String(value)
		.replaceAll('_', ' ')
		.replace(/^./, (c) => c.toUpperCase())
const shortFrequency = (frequency, band) =>
	Number.isFinite(Number(frequency)) && Number(frequency) > 0
		? Number(frequency) >= 1000
			? `${Number(frequency) / 1000} kHz`
			: `${frequency} Hz`
		: `Band ${band + 1}`

/**
 * Append supported features to an already curated preset browser.
 * Legacy bridges do not advertise capabilities and receive no extra controls.
 */
export function appendFeaturePresets(instance, structure, presets) {
	const features = instance.features
	const capabilities = features?.capabilities
	if (!capabilities) return
	const variable = (id) => `$(${instance.label || 'aimp-control'}:${id})`
	const advanced = instance.config?.advancedPresets === true
	const groups = new Map()
	const shown = new Set(
		structure.flatMap((section) =>
			section.definitions.flatMap((entry) => (typeof entry === 'string' ? [entry] : entry.presets || [])),
		),
	)
	function section(id, name, description) {
		if (!groups.has(id)) {
			const group = { id, name, description, definitions: [] }
			groups.set(id, group)
			structure.push(group)
		}
		return groups.get(id).definitions
	}
	function textElement(id, text, y, height, color = palette.text) {
		return {
			type: 'text',
			id,
			name: `${id === 'value' ? 'Live value' : 'Label'} · 20 · shrink to fit`,
			x: 5,
			y,
			width: 90,
			height,
			text,
			fontsize: 20,
			fontsizeAllowShrink: true,
			font: 'companion-sans',
			weight: 'normal',
			color,
			halign: 'center',
			valign: 'center',
		}
	}
	function button(group, id, name, label, primaryAction, options = {}) {
		const fullId = `feature_${id}`
		if (shown.has(fullId) || Object.hasOwn(presets, fullId)) return presets[fullId]
		const color = options.color ?? palette.modes
		const icon = featureIcons[options.icon] || iconImages[options.icon] || featureIcons.waveform
		const caption = `${label}${options.badge && options.badge !== '↔' ? ` ${options.badge}` : ''}`
		const elements = [
			{
				type: 'box',
				id: 'background',
				name: 'Background',
				x: 0,
				y: 0,
				width: 100,
				height: 100,
				color: palette.background,
				borderWidth: 1,
				borderColor: palette.border,
				borderPosition: 'inside',
			},
			{
				type: 'box',
				id: 'accent',
				name: 'Category / active colour',
				x: 10,
				y: 7,
				width: 80,
				height: 2,
				color,
				cornerRadius: 50,
			},
			{
				type: 'image',
				id: 'icon',
				name: 'Icon',
				x: 36,
				y: 11,
				width: 28,
				height: 22,
				base64Image: icon,
				fillMode: 'fit',
				halign: 'center',
				valign: 'center',
			},
			// C5 sizes the font as a percentage of this region's height. Keep the
			// region tall, with both lines together, so 20 remains legible at 72px.
			textElement('label', options.value ? `${caption}\n${options.value}` : caption, 34, 62),
		]
		// Companion's native gauge axis is limited to ±1,000,000. SDK timing
		// properties use Int32 bounds; retain their real action limits and live
		// text, but omit a gauge whose axis the host cannot represent.
		if (
			options.meter &&
			Number.isFinite(options.min) &&
			Number.isFinite(options.max) &&
			options.max > options.min &&
			options.min >= -1_000_000 &&
			options.max <= 1_000_000
		)
			elements.push({
				type: 'gauge',
				id: 'meter',
				name: 'Live value',
				x: 10,
				y: 97,
				width: 80,
				height: 2,
				orientation: 'horizontal',
				min: options.min,
				max: options.max,
				value: { isExpression: true, value: options.meter },
				stops: [{ value: options.min, color, gradient: false }],
				trackStyle: 'dimmed',
				trackAmount: 15,
				fillEnabled: true,
			})
		const feedbacks = (options.feedbacks || []).map(({ label: feedbackLabel, ...feedback }) => ({
			...feedback,
			styleOverrides: [
				override('background', 'color', options.danger ? 0x3c1d2b : 0x17362e),
				override('accent', 'color', options.danger ? palette.red : palette.transport),
				...(feedbackLabel ? [override('label', 'text', feedbackLabel)] : []),
			],
		}))
		feedbacks.push({
			feedbackId: 'is_connected',
			options: {},
			isInverted: true,
			styleOverrides: [
				override('background', 'color', 0x161b23),
				override('accent', 'color', 0x526173),
				override('icon', 'opacity', 35),
				override('label', 'color', 0x8994a3),
			],
		})
		const preset = {
			type: 'layered',
			name,
			elements,
			canvas: { decoration: 'none', showStatusIcons: 'default' },
			steps: [{ down: primaryAction ? [primaryAction] : [], up: [] }],
			feedbacks,
		}
		presets[fullId] = preset
		group.push(fullId)
		shown.add(fullId)
		return preset
	}
	function controls(group, rotaryGroup, id, name, descriptor, actions, options = {}) {
		const step = Math.abs(Number(descriptor.step)) || (descriptor.type === 'integer' ? 1 : 0.1)
		const common = { ...options, min: Number(descriptor.min), max: Number(descriptor.max) }
		const suffix = descriptor.unit ? ` ${descriptor.unit}` : ''
		button(group, `${id}_down`, `${name} −${step}${suffix}`, name, actions.adjust(-step), { ...common, badge: '−' })
		button(group, `${id}_up`, `${name} +${step}${suffix}`, name, actions.adjust(step), { ...common, badge: '+' })
		if (actions.reset)
			button(group, `${id}_reset`, `Reset ${name.toLowerCase()}`, `${name}\nReset`, actions.reset, {
				...common,
				icon: 'reset',
				value: undefined,
				meter: undefined,
			})
		const rotary = button(
			rotaryGroup,
			`${id}_rotary`,
			`${name} ±${step}${suffix} / press ${actions.reset ? 'reset' : 'read value'}`,
			name,
			actions.reset || actions.read,
			{ ...common, icon: 'encoder', badge: '↔' },
		)
		rotary.steps[0].rotate_left = [actions.adjust(-step)]
		rotary.steps[0].rotate_right = [actions.adjust(step)]
	}
	function booleanControl(group, id, name, toAction, feedbackId, feedbackOptions, options = {}) {
		const feedbacks = feedbackId ? [{ feedbackId, options: feedbackOptions }] : []
		button(group, `${id}_toggle`, `${name} on / off`, name, toAction('toggle'), { ...options, feedbacks })
		if (advanced) {
			const explicit = section(
				'feature_explicit',
				'Advanced · Explicit on / off',
				'Separate state-setting buttons for macros and automation.',
			)
			for (const mode of ['on', 'off'])
				button(explicit, `${id}_${mode}`, `${name} ${mode}`, `${name}\n${pretty(mode)}`, toAction(mode), {
					...options,
					feedbacks: feedbacks.map((feedback) => ({ ...feedback, ...(mode === 'off' ? { isInverted: true } : {}) })),
				})
		}
	}

	for (const [id, descriptor] of entries(capabilities.audio)) {
		if (!id || !available(descriptor)) continue
		const primary = ['pitch', 'tempo', 'speed'].includes(id)
		const group = section(
			primary ? 'feature_pitch' : 'feature_audio',
			primary ? 'Pitch, Tempo and Speed' : 'Sound Effects',
			primary
				? 'Pitch changes tone; tempo changes duration; speed changes both. Preset values come from AIMP.'
				: 'Only controls reported by the connected AIMP plugin are shown.',
		)
		const label = descriptor.label || pretty(id)
		const icon = primary ? id : id === 'balance' ? 'balance' : 'waveform'
		const feedbacks = [{ feedbackId: 'feature_audio_active', options: { parameter: id } }]
		if (descriptor.type === 'boolean') {
			booleanControl(
				group,
				`audio_${key(id)}`,
				label,
				(mode) => action('feature_audio_boolean', { parameter: id, mode }),
				'feature_audio_active',
				{ parameter: id },
				{ icon, color: palette.modes },
			)
			continue
		}
		const rotary = section(
			primary ? 'feature_pitch_rotary' : 'feature_audio_rotary',
			primary ? 'Rotary Encoders · Pitch / Tempo / Speed' : 'Rotary Encoders · Sound Effects',
			'Turn to adjust. Press to restore the control’s neutral value.',
		)
		controls(
			group,
			rotary,
			`audio_${key(id)}`,
			label,
			descriptor,
			{
				adjust: (delta) => action('feature_audio_adjust', { parameter: id, delta }),
				reset: action('feature_audio_reset', { parameter: id }),
			},
			{
				icon,
				color: primary ? palette.focus : palette.modes,
				value: variable(`audio_${id}_fmt`),
				meter: variable(`audio_${id}`),
				feedbacks,
			},
		)
	}

	const eq = capabilities.equalizer
	if (eq && available(eq)) {
		const group = section(
			'feature_equalizer',
			'Equalizer',
			'Equalizer, preamp, flat reset, and AIMP’s available presets.',
		)
		const bands = section(
			'feature_eq_bands',
			'Equalizer · Bands',
			'Per-band decrease, increase, and reset. Gain is measured in dB.',
		)
		const rotary = section(
			'feature_eq_rotary',
			'Rotary Encoders · Equalizer',
			'Each knob adjusts one band; press resets that band to 0 dB.',
		)
		booleanControl(
			group,
			'eq_enabled',
			'Equalizer',
			(mode) => action('feature_eq_enabled', { mode }),
			'feature_eq_enabled',
			{},
			{ icon: 'equalizer', color: palette.modes },
		)
		button(group, 'eq_reset', 'Reset entire equalizer to flat', 'Flat EQ', action('feature_eq_reset'), {
			icon: 'reset',
			color: palette.modes,
		})
		if (eq.preamp && available(eq.preamp))
			controls(
				group,
				rotary,
				'eq_preamp',
				'Preamp',
				{ ...eq.preamp, unit: 'dB', step: eq.preamp.step || 0.5 },
				{
					adjust: (delta) => action('feature_eq_preamp_adjust', { delta }),
					reset: action('feature_eq_preamp_reset'),
				},
				{
					icon: 'equalizer',
					color: palette.modes,
					value: variable('eq_preamp_fmt'),
					meter: variable('eq_preamp'),
					feedbacks: [{ feedbackId: 'feature_eq_preamp_active', options: {} }],
				},
			)
		const count = Math.max(0, Math.min(256, Number(eq.band_count ?? features.equalizer?.bands?.length) || 0))
		for (let index = 0; index < count; index++) {
			const band =
				features.equalizer?.bands?.find((entry) => Number(entry.index) === index) || features.equalizer?.bands?.[index]
			const frequency = band?.frequency ?? eq.frequencies?.[index]
			const label = shortFrequency(frequency, index)
			controls(
				bands,
				rotary,
				`eq_band_${index}`,
				label,
				{ min: eq.min ?? -15, max: eq.max ?? 15, step: eq.step || 0.5, unit: 'dB' },
				{
					adjust: (delta) => action('feature_eq_band_adjust', { band: index, delta }),
					reset: action('feature_eq_band_reset', { band: index }),
				},
				{
					icon: 'equalizer',
					color: palette.modes,
					value: variable(`eq_band_${index}_fmt`),
					meter: variable(`eq_band_${index}`),
					feedbacks: [{ feedbackId: 'feature_eq_band_active', options: { band: index } }],
				},
			)
		}
		const names = [
			...new Set(
				(features.equalizer?.presets || eq.presets || [])
					.map((preset) => (typeof preset === 'string' ? preset : preset.name))
					.filter(Boolean),
			),
		]
		if (names.length) {
			const presetGroup = section(
				'feature_eq_presets',
				'Equalizer · AIMP Presets',
				'The named equalizer presets supplied by the connected AIMP instance.',
			)
			for (const name of names)
				button(
					presetGroup,
					`eq_preset_${hash(name)}`,
					`EQ preset: ${name}`,
					name,
					action('feature_eq_preset', { name }),
					{ icon: 'equalizer', color: palette.modes },
				)
		}
		if (advanced && eq.preset_save === true) {
			const saveGroup = section(
				'feature_eq_save',
				'Advanced · Save Equalizer Preset',
				'Save the current bands with a new name. AIMP’s SDK does not store preamp in these presets; existing names are preserved.',
			)
			button(
				saveGroup,
				'eq_preset_save',
				'Save EQ bands as a new preset · enter name in action',
				'Save EQ\nEdit name',
				action('feature_eq_preset_save', { name: '' }),
				{ icon: 'equalizer', color: palette.modes },
			)
		}
	}

	for (const scope of ['player', 'app']) {
		for (const [id, descriptor] of entries(capabilities[`${scope}_options`])) {
			if (!id || !available(descriptor)) continue
			const label = descriptor.label || pretty(id)
			const group = section(
				scope === 'player' ? 'feature_player' : 'feature_app',
				scope === 'player' ? 'Playback and Mixing' : 'AIMP Options',
				'Live options exposed by the AIMP SDK on this installation.',
			)
			const actionId = `feature_${scope}_${id}`
			const color = scope === 'player' ? palette.seek : palette.library
			const icon = scope === 'player' ? 'mixing' : 'window'
			if (descriptor.type === 'boolean') {
				booleanControl(
					group,
					`${scope}_${key(id)}`,
					label,
					(mode) => action(actionId, { mode }),
					`feature_${scope}_option_active`,
					{ option: id },
					{ icon, color },
				)
			} else if (descriptor.type === 'enum') {
				for (const choice of descriptor.choices || [])
					button(
						group,
						`${scope}_${key(id)}_${key(choice.id)}`,
						`${label}: ${choice.label}`,
						`${label}\n${choice.label}`,
						action(actionId, { value: choice.id }),
						{
							icon,
							color,
							feedbacks: [
								{ feedbackId: `feature_${scope}_option_is`, options: { option: id, value: String(choice.id) } },
							],
						},
					)
			} else {
				const rotary = section(
					`feature_${scope}_rotary`,
					scope === 'player' ? 'Rotary Encoders · Playback and Mixing' : 'Rotary Encoders · AIMP Options',
					'Turn to adjust. The button name describes its press action.',
				)
				controls(
					group,
					rotary,
					`${scope}_${key(id)}`,
					label,
					descriptor,
					{
						adjust: (value) => action(actionId, { operation: 'adjust', value }),
						reset:
							descriptor.default !== undefined
								? action(actionId, { operation: 'set', value: descriptor.default })
								: undefined,
						read: action('feature_refresh'),
					},
					{ icon, color, value: variable(`${scope}_option_${id}_fmt`), meter: variable(`${scope}_option_${id}`) },
				)
			}
		}
	}

	// Application commands open or operate AIMP's own SDK-exposed windows/dialogs.
	for (const [id, descriptor] of entries(capabilities.app_commands)) {
		if (!id || !available(descriptor)) continue
		if (id === 'sync_preimage' && capabilities.library?.commands?.includes('playlists/source/sync')) continue
		if (descriptor.requires_confirmation) {
			if (advanced) {
				const cleanup = section(
					'feature_app_cleanup',
					'Advanced · Playlist Cleanup',
					'These actions change the active playlist. Configure and enable confirmation first; original media files are preserved.',
				)
				button(
					cleanup,
					`app_command_${key(id)}`,
					`${descriptor.label || pretty(id)} · confirm in action`,
					descriptor.label || pretty(id),
					action('feature_app_command', { command: id, confirm: false, param: 0 }),
					{ icon: 'remove', color: palette.red, danger: true },
				)
			}
			continue
		}
		const group = section(
			'feature_windows',
			'AIMP Windows and Dialogs',
			'Commands run on the computer hosting AIMP. Dialogs may require local interaction.',
		)
		button(
			group,
			`app_command_${key(id)}`,
			descriptor.label || pretty(id),
			descriptor.label || pretty(id),
			// Companion 5 validates every action field before invoking the module.
			// The editor's displayed default does not populate missing preset values.
			action('feature_app_command', { command: id, confirm: false, param: 0 }),
			{ icon: 'window', color: palette.library },
		)
	}
	if (capabilities.loop?.available) {
		const group = section(
			'feature_loop',
			'A–B Loop',
			'Repeat a section of the current track. AIMP reports the loop state and endpoints.',
		)
		if (capabilities.loop.cycle)
			button(group, 'loop_cycle', 'A–B loop: mark A / mark B / clear', 'Mark A', action('feature_loop_cycle'), {
				icon: 'loop',
				color: palette.focus,
				feedbacks: [
					{ feedbackId: 'feature_loop_active', options: {}, label: 'Clear A–B' },
					{ feedbackId: 'feature_loop_marked', options: {}, label: 'Mark B' },
				],
			})
		if (capabilities.loop.range) {
			button(group, 'loop_clear', 'Clear A–B loop', 'Clear loop', action('feature_loop_clear'), {
				icon: 'reset',
				color: palette.focus,
			})
			button(
				group,
				'loop_range',
				'A–B loop range · edit A and B in action settings',
				'Set A–B\nEdit range',
				action('feature_loop_set', { a: 0, b: 10 }),
				{ icon: 'loop', color: palette.focus },
			)
		}
	}
	if (capabilities.recording?.available) {
		const group = section(
			'feature_recording',
			'Internet Radio Capture',
			'Captures a supported internet radio stream using AIMP’s recording settings; this is not a microphone recorder.',
		)
		booleanControl(
			group,
			'recording',
			'Radio capture',
			(mode) => action('feature_recording', { mode }),
			'feature_recording_active',
			{},
			{ icon: 'record', color: palette.red, danger: true },
		)
	}
	if (capabilities.output?.available) {
		const group = section(
			'feature_output',
			'Audio Output',
			'Select one of the output devices reported by AIMP. Changing output may interrupt playback.',
		)
		button(
			group,
			'output_refresh',
			'Refresh available audio output devices',
			'Audio output',
			action('feature_output_refresh'),
			{ icon: 'output', color: palette.volume, value: variable('output_device_name') },
		)
		for (const device of features.output?.devices || [])
			button(
				group,
				`output_${hash(device.id)}`,
				`Audio output: ${device.name || device.id}`,
				device.name || String(device.id),
				action('feature_output_set', { id: device.id }),
				{
					icon: 'output',
					color: palette.volume,
					feedbacks: [{ feedbackId: 'feature_output_is', options: { id: device.id } }],
				},
			)
	}
	if (capabilities.library?.available) {
		const library = capabilities.library
		const commands = new Set(library.commands || [])
		const playlistId = instance.playlistChoices?.[0]?.id || ''
		const focused = { target: 'focused', playlistId, trackId: 0 }
		const active = { target: 'active', playlistId }
		const queueGroup = () =>
			section(
				'feature_queue',
				'Playback Queue',
				'Queue the focused track independently of playlist order. No media files are changed.',
			)
		const libraryGroup = () =>
			section(
				'feature_library',
				'Playlist and Track Management',
				'New playlist and focused-track controls work immediately. Buttons marked Setup require editing their action first; they do not open a name or file dialog.',
			)
		const informationGroup = () =>
			section(
				'feature_information',
				'Playlist and Track Information',
				'Press to read information onto the button. These controls show a summary here; they do not open an AIMP window.',
			)
		const removeGroup = () =>
			section(
				'feature_remove',
				'Advanced · Remove, Clear and Close',
				'Queue controls affect the playback queue. Close/Clear Playlist target the active AIMP tab. Unqueue/Remove Focused Track affect one focused track. No confirmation setup is required; original media files are preserved.',
			)
		function management(group, id, name, label, wire, actionId, options, appearance = {}) {
			if (commands.has(wire))
				button(group(), id, name, label, action(actionId, options), {
					icon: 'library',
					color: palette.library,
					...appearance,
				})
		}
		management(
			queueGroup,
			'queue_refresh',
			'Refresh playback queue',
			'Queue',
			'queue/get',
			'feature_queue_refresh',
			{},
			{
				icon: 'queue',
				value: variable('queue_count'),
				feedbacks: [{ feedbackId: 'feature_queue_has_items', options: {} }],
			},
		)
		management(
			queueGroup,
			'queue_add_focused',
			'Add focused track to end of queue',
			'Queue\nSelection',
			'queue/add',
			'feature_queue_add',
			{ ...focused, first: false },
			{ icon: 'queue' },
		)
		management(
			queueGroup,
			'queue_play_next',
			'Play focused track next · place first in queue',
			'Play next\nSelection',
			'queue/add',
			'feature_queue_add',
			{ ...focused, first: true },
			{ icon: 'queue' },
		)
		if (commands.has('queue/suspended'))
			booleanControl(
				queueGroup(),
				'queue_suspended',
				'Suspend queue',
				(mode) => action('feature_queue_suspended', { mode }),
				'feature_queue_suspended',
				{},
				{ icon: 'pause', color: palette.seek },
			)
		management(
			queueGroup,
			'queue_move',
			'Move queue entry · configure source and destination',
			'Move queue\nEdit positions',
			'queue/move',
			'feature_queue_move',
			{ index: 1, destination: 0 },
			{ icon: 'queue' },
		)
		management(
			libraryGroup,
			'playlist_create',
			'Create and activate a new playlist · edit name in action',
			'New playlist',
			'playlists/create',
			'feature_playlist_create',
			{ name: 'New playlist', activate: true },
			{ icon: 'add' },
		)
		management(
			libraryGroup,
			'playlist_rename',
			'Rename active playlist · enter new name in action',
			'Rename\nSetup: name',
			'playlists/rename',
			'feature_playlist_rename',
			{ ...active, name: '' },
		)
		management(
			libraryGroup,
			'playlist_add',
			'Add media file or stream URL · enter path or URL in action',
			'Add media\nSetup: path',
			'playlists/add',
			'feature_playlist_add',
			{ ...active, uri: '', position: -1 },
			{ icon: 'add' },
		)
		management(
			informationGroup,
			'playlist_info',
			'Read active playlist information onto this button',
			'Playlist',
			'playlists/info',
			'feature_playlist_info',
			active,
			{ icon: 'info', value: variable('playlist_info_summary') },
		)
		management(
			informationGroup,
			'track_info',
			'Read focused track information onto this button',
			'Track',
			'playlists/track/info',
			'feature_track_info',
			focused,
			{ icon: 'track', value: variable('track_info_summary') },
		)
		management(
			informationGroup,
			'file_info',
			'Read playing file audio metadata onto this button',
			'Audio file',
			'player/fileinfo',
			'feature_file_info',
			{},
			{ icon: 'track', value: variable('file_info_summary') },
		)
		management(
			libraryGroup,
			'track_move',
			'Move focused track to playlist start · edit destination in action',
			'Move track\nTo start',
			'playlists/track/move',
			'feature_track_move',
			{ ...focused, destination: 0 },
			{ icon: 'track' },
		)
		for (const enabled of [true, false])
			management(
				libraryGroup,
				`track_enabled_${enabled ? 'on' : 'off'}`,
				`${enabled ? 'Enable' : 'Disable'} focused track for playback`,
				`${enabled ? 'Enable' : 'Disable'}\nFocused track`,
				'playlists/track/enabled',
				'feature_track_enabled',
				{ ...focused, enabled },
				{ icon: 'track', color: enabled ? palette.transport : palette.seek },
			)
		if (commands.has('playlists/track/rating')) {
			const rating = library.rating || { min: 0, max: 5, step: 0.5 }
			const group = section(
				'feature_rating',
				'Track Rating',
				'Set the focused track’s rating. Half-star values can be entered in the action settings if supported.',
			)
			for (let value = Math.ceil(rating.min); value <= Math.floor(rating.max); value++)
				button(
					group,
					`track_rating_${value}`,
					`Rate focused track: ${value === 0 ? 'unrated' : value}`,
					value === 0 ? 'Unrated' : `${value} / ${rating.max}`,
					action('feature_track_rating', { ...focused, rating: value }),
					{ icon: 'track', color: palette.seek },
				)
		}
		if (commands.has('playlists/sort')) {
			const group = section(
				'feature_sort',
				'Playlist Sorting',
				'Reorders entries in the active playlist. Original media files are preserved.',
			)
			for (const mode of library.sort_modes || [])
				button(
					group,
					`playlist_sort_${key(mode.id)}`,
					`Sort active playlist: ${mode.label}`,
					mode.label,
					action('feature_playlist_sort', { ...active, mode: mode.id }),
					{ icon: 'library', color: palette.library },
				)
		}
		if (advanced) {
			management(
				() =>
					section(
						'feature_media_templates',
						'Advanced · Media Paths',
						'Set a file path or stream URL in the action before using the button.',
					),
				'play_file',
				'Play a file or stream URL · enter path in action',
				'Play media\nEdit path',
				'player/play-file',
				'feature_play_file',
				{ uri: '' },
				{ icon: 'play', color: palette.transport },
			)
			const appearance = { icon: 'remove', color: palette.red, danger: true }
			management(
				removeGroup,
				'queue_remove_track',
				'Remove focused track from playback queue',
				'Unqueue\nFocused track',
				'queue/remove',
				'feature_queue_remove_track',
				focused,
				appearance,
			)
			management(
				removeGroup,
				'queue_remove',
				'Remove first queue entry · edit position in action',
				'Remove first\nQueue item',
				'queue/remove',
				'feature_queue_remove',
				{ index: 0 },
				appearance,
			)
			management(
				removeGroup,
				'queue_clear',
				'Clear playback queue · preserves media files',
				'Clear queue',
				'queue/clear',
				'feature_queue_clear',
				{},
				appearance,
			)
			management(
				removeGroup,
				'playlist_close',
				'Close active playlist tab · preserves saved playlist file',
				'Close\nPlaylist',
				'playlists/close',
				'feature_playlist_close',
				active,
				appearance,
			)
			management(
				removeGroup,
				'playlist_clear',
				'Remove all entries from active playlist · preserves media files',
				'Clear\nPlaylist',
				'playlists/clear',
				'feature_playlist_clear',
				active,
				appearance,
			)
			management(
				removeGroup,
				'track_remove',
				'Remove focused playlist entry · preserves media file',
				'Remove\nFocused track',
				'playlists/track/remove',
				'feature_track_remove',
				focused,
				appearance,
			)
		}
	}
	const appControl = capabilities.app_control
	if (appControl) {
		const windows = appControl.windows?.filter((window) => window.available) || []
		if (windows.length) {
			const group = section(
				'feature_app_windows',
				'AIMP Window Controls',
				'Bring the main AIMP window forward, minimize it, or show an auxiliary window. Additional operations are available in the action settings.',
			)
			for (const window of windows) {
				const operation = window.id === 'main' ? 'foreground' : 'show'
				button(
					group,
					`window_${key(window.id)}_show`,
					`${window.id === 'main' ? 'Bring forward' : 'Show'} AIMP ${window.id} window`,
					`${window.id === 'main' ? 'Show AIMP' : pretty(window.id)}`,
					action('feature_app_window', { window: window.id, operation }),
					{ icon: 'window', color: palette.library },
				)
			}
			if (windows.some((window) => window.id === 'main'))
				button(
					group,
					'window_main_minimize',
					'Minimize AIMP main window',
					'Minimize\nAIMP',
					action('feature_app_window', { window: 'main', operation: 'minimize' }),
					{ icon: 'window', color: palette.library },
				)
		}
		if (advanced) {
			const group = section(
				'feature_app_templates',
				'Advanced · AIMP Application Actions',
				'Configure notification text or a registered AIMP action ID. Only documented IDs provided by AIMP or its plugins can be looked up or executed.',
			)
			if (appControl.notifications) {
				button(
					group,
					'app_notification',
					'Show AIMP notification · edit text',
					'Notification\nEdit text',
					action('feature_app_notification', { text: '', persistent: false }),
					{ icon: 'info', color: palette.library },
				)
				button(
					group,
					'app_notification_clear',
					'Clear AIMP notification',
					'Clear\nNotification',
					action('feature_app_notification_clear'),
					{ icon: 'info', color: palette.library },
				)
			}
			if (appControl.action_lookup)
				button(
					group,
					'app_action_get',
					'Inspect registered AIMP action · enter action ID',
					'Inspect action\nEdit ID',
					action('feature_app_action_get', { id: '' }),
					{ icon: 'info', color: palette.library },
				)
			if (appControl.action_execute)
				button(
					group,
					'app_action_execute',
					'Execute registered AIMP action · enter action ID',
					'AIMP action\nEdit ID',
					action('feature_app_action_execute', { id: '' }),
					{ icon: 'window', color: palette.seek },
				)
			if (appControl.quit) {
				const close = section(
					'feature_app_quit',
					'Advanced · Close AIMP',
					'Enable “I intend to close AIMP” in the placed button’s action before use. This is a one-time setup checkbox, not a confirmation dialog. Closing AIMP stops playback and disconnects this module.',
				)
				button(
					close,
					'app_quit',
					'Close AIMP · explicitly enable confirmation',
					'Close AIMP\nSetup: confirm',
					action('feature_app_quit', { confirm: false }),
					{ icon: 'power', color: palette.red, danger: true },
				)
			}
		}
	}
	if (capabilities.skins?.available === true) {
		const group = section(
			'feature_skins',
			'AIMP Skins',
			'Choose an installed skin, reapply it, or adjust colors exposed by AIMP. No skin is installed or removed by these controls.',
		)
		button(
			group,
			'skin_refresh',
			'Refresh installed AIMP skins and color state',
			'Refresh\nSkins',
			action('feature_skin_refresh'),
			{ icon: 'refresh', color: palette.library },
		)
		button(
			group,
			'skin_reapply',
			'Reapply the current AIMP skin',
			'Reapply\nCurrent skin',
			action('feature_skin_reapply'),
			{ icon: 'window', color: palette.library },
		)
		if (capabilities.skins.selection) {
			button(
				group,
				'skin_default',
				'Use AIMP default skin',
				'Default\nSkin',
				action('feature_skin_set', { name: '' }),
				{
					icon: 'window',
					color: palette.library,
					feedbacks: [{ feedbackId: 'feature_skin_selected', options: { name: '' } }],
				},
			)
			for (const skin of features.skins?.installed || [])
				button(
					group,
					`skin_${hash(skin.name)}`,
					`Use installed skin: ${skin.title || skin.name}`,
					skin.title || skin.name,
					action('feature_skin_set', { name: skin.name }),
					{
						icon: 'window',
						color: palette.library,
						feedbacks: [{ feedbackId: 'feature_skin_selected', options: { name: skin.name } }],
					},
				)
		}
		for (const [parameter, descriptor] of Object.entries(capabilities.skins.color || {})) {
			if (!descriptor.available) continue
			const rotary = section(
				'feature_skin_rotary',
				'Rotary Encoders · Skin Colors',
				'Turn to adjust the current skin’s color. Press refreshes the actual AIMP value; the SDK does not advertise a universal default color.',
			)
			controls(
				group,
				rotary,
				`skin_${key(parameter)}`,
				`Skin ${parameter}`,
				{ ...descriptor, type: 'integer', unit: parameter === 'intensity' ? '%' : '' },
				{
					adjust: (delta) => action('feature_skin_color_adjust', { parameter, delta }),
					read: action('feature_skin_refresh'),
				},
				{
					icon: 'window',
					color: palette.library,
					value: `${variable(`skin_${parameter}`)}${parameter === 'intensity' ? '%' : ''}`,
					meter: variable(`skin_${parameter}`),
				},
			)
		}
	}
	if (advanced && features.equalizer?.presets?.length) {
		const first = features.equalizer.presets[0]
		const group = section(
			'feature_eq_manage',
			'Advanced · Manage Equalizer Presets',
			'Choose a preset, then enable confirmation to rename or delete it. AIMP does not distinguish built-in presets from user presets.',
		)
		if (capabilities.equalizer?.preset_rename)
			button(
				group,
				'eq_preset_rename',
				'Rename equalizer preset · choose name and confirm',
				'Rename EQ\nEdit + confirm',
				action('feature_eq_preset_rename', { name: first, new_name: '', confirm: false }),
				{ icon: 'save', color: palette.seek },
			)
		if (capabilities.equalizer?.preset_delete)
			button(
				group,
				'eq_preset_delete',
				'Delete equalizer preset · choose name and confirm',
				'Delete EQ\nConfirm first',
				action('feature_eq_preset_delete', { name: first, confirm: false }),
				{ icon: 'remove', color: palette.red, danger: true },
			)
	}
	if (capabilities.library?.available === true) {
		const catalog = capabilities.library,
			commands = new Set(catalog.commands || [])
		const playlistId = instance.playlistChoices?.[0]?.id || ''
		const destinationId = instance.playlistChoices?.[1]?.id || playlistId
		const active = { target: 'active', playlistId },
			focused = { target: 'focused', playlistId, trackId: 0 }
		function tool(group, id, name, label, actionId, wire, options, appearance = {}) {
			if (commands.has(wire))
				return button(group(), id, name, label, action(actionId, options), {
					icon: 'library',
					color: palette.library,
					...appearance,
				})
		}
		const selection = () =>
			section(
				'feature_playlist_selection',
				'Playlist Selection',
				'Select entries in the active playlist without starting playback.',
			)
		for (const [mode, label] of [
			['all', 'Select all'],
			['none', 'Select none'],
			['invert', 'Invert selection'],
		])
			tool(
				selection,
				`selection_${mode}`,
				label,
				label,
				'feature_selection_set',
				'playlists/selection/set',
				{ ...active, mode },
				{ icon: 'selection' },
			)
		for (const selected of [true, false])
			tool(
				selection,
				`track_selected_${selected ? 'on' : 'off'}`,
				`${selected ? 'Select' : 'Deselect'} focused track`,
				`${selected ? 'Select' : 'Deselect'}\nFocused track`,
				'feature_track_selected',
				'playlists/track/selected',
				{ ...focused, selected },
				{ icon: 'selection' },
			)
		const organize = () =>
			section(
				'feature_playlist_organize',
				'Playlist Organization',
				'Copy or move the focused track between loaded playlists. Set destinations in the action.',
			)
		tool(
			organize,
			'track_copy_to',
			'Copy focused track to another playlist · choose destination',
			'Copy track\nEdit destination',
			'feature_track_copy_to',
			'playlists/track/copy-to',
			{ ...focused, destinationId, position: -1 },
			{ icon: 'copy' },
		)
		tool(
			organize,
			'track_move_to',
			'Move focused track to another playlist · choose destination',
			'Move track\nEdit destination',
			'feature_track_move_to',
			'playlists/track/move-to',
			{ ...focused, destinationId },
			{ icon: 'track-next', color: palette.seek },
		)
		const groups = () =>
			section(
				'feature_playlist_groups',
				'Playlist Groups',
				'Inspect groups, expand or collapse a chosen group, and merge groups. Group indices can be edited in each action.',
			)
		tool(
			groups,
			'groups_get',
			'Inspect active playlist groups',
			'Playlist\nGroups',
			'feature_groups_get',
			'playlists/groups/get',
			{ ...active, offset: 0, limit: 100 },
			{ icon: 'groups', value: variable('playlist_group_count') },
		)
		for (const value of [true, false])
			tool(
				groups,
				`group_expanded_${value ? 'on' : 'off'}`,
				`${value ? 'Expand' : 'Collapse'} playlist group · choose group index`,
				`${value ? 'Expand' : 'Collapse'}\nGroup`,
				'feature_group_set',
				'playlists/group/set',
				{ ...active, group: 0, parameter: 'expanded', value },
				{ icon: 'groups' },
			)
		const refresh = () =>
			section(
				'feature_playlist_refresh',
				'Playlist Information · Refresh',
				'Reload file metadata without changing media files.',
			)
		tool(
			refresh,
			'track_refresh',
			'Refresh focused track information',
			'Refresh\nFocused track',
			'feature_track_refresh',
			'playlists/track/refresh',
			focused,
			{ icon: 'refresh' },
		)
		for (const [mode, label] of [
			['all', 'All tracks'],
			['selected', 'Selection'],
			['missing', 'Missing info'],
		])
			tool(
				refresh,
				`playlist_refresh_${mode}`,
				`Refresh playlist information: ${label}`,
				`Refresh\n${label}`,
				'feature_playlist_refresh',
				'playlists/refresh',
				{ ...active, mode },
				{ icon: 'refresh' },
			)
		const sources = () =>
			section(
				'feature_playlist_sources',
				'Playlist Sources',
				'Inspect and synchronize an existing folder or playlist source. Source configuration templates are in advanced presets.',
			)
		tool(
			sources,
			'source_get',
			'Inspect playlist synchronization source',
			'Playlist\nSource',
			'feature_source_get',
			'playlists/source/get',
			active,
			{ icon: 'folder', value: variable('playlist_source_type') },
		)
		tool(
			sources,
			'source_sync',
			'Synchronize the active playlist with its existing source',
			'Sync\nPlaylist source',
			'feature_source_sync',
			'playlists/source/sync',
			active,
			{ icon: 'refresh' },
		)
		for (const enabled of [true, false])
			tool(
				sources,
				`source_autosync_${enabled ? 'on' : 'off'}`,
				`Playlist automatic synchronization ${enabled ? 'on' : 'off'}`,
				`Auto sync\n${enabled ? 'On' : 'Off'}`,
				'feature_source_set',
				'playlists/source/set',
				{ ...active, parameter: 'autosync', enabled, template: '' },
				{
					icon: 'folder',
					feedbacks: [{ feedbackId: 'feature_source_autosync', options: {}, ...(enabled ? {} : { isInverted: true }) }],
				},
			)
		if (advanced) {
			const details = () =>
				section(
					'feature_playlist_details',
					'Advanced · Playlist Properties',
					'Controls apply to the active playlist. Buttons marked Setup require editing their action value first. Read-only On locks playlist editing; turn it Off to allow changes.',
				)
			tool(
				details,
				'playlist_properties_get',
				'Read active playlist properties onto this button',
				'Read properties',
				'feature_playlist_properties_get',
				'playlists/properties/get',
				active,
				{ icon: 'info', value: variable('playlist_properties_summary') },
			)
			for (const [id, descriptor] of entries(catalog.playlist_properties)) {
				if (
					!available(descriptor) ||
					descriptor.writable === false ||
					(id === 'name' && commands.has('playlists/rename'))
				)
					continue
				const label = descriptor.label || pretty(id)
				if (descriptor.type === 'boolean')
					for (const value of [true, false])
						tool(
							details,
							`playlist_property_${key(id)}_${value ? 'on' : 'off'}`,
							`${label} ${value ? 'on' : 'off'}`,
							id === 'read_only'
								? `Read-only\n${value ? 'Locks editing' : 'Allow editing'}`
								: `${label}\n${value ? 'On' : 'Off'}`,
							`feature_playlist_property_${id}`,
							'playlists/properties/set',
							{ ...active, value },
							{ icon: 'window' },
						)
				else if (descriptor.type === 'enum')
					for (const choice of descriptor.choices || [])
						tool(
							details,
							`playlist_property_${key(id)}_${key(choice.id)}`,
							`${label}: ${choice.label}`,
							`${label}\n${choice.label}`,
							`feature_playlist_property_${id}`,
							'playlists/properties/set',
							{ ...active, value: choice.id },
							{ icon: 'window' },
						)
				else
					tool(
						details,
						`playlist_property_${key(id)}`,
						`${label} · set value in action`,
						`${label}\nSetup: value`,
						`feature_playlist_property_${id}`,
						'playlists/properties/set',
						{ ...active, value: descriptor.type === 'string' ? '' : (descriptor.default ?? descriptor.min ?? 0) },
						{ icon: 'window' },
					)
			}
			const organization = () =>
				section(
					'feature_playlist_templates',
					'Advanced · Playlist Templates',
					'Edit the placed button’s action to supply a path, group index, or AIMP formatting template. Setup buttons do not open a file or text-entry dialog.',
				)
			tool(
				organization,
				'playlist_import',
				'Import saved playlist file or URL · edit path in action',
				'Import playlist\nSetup: path',
				'feature_playlist_import',
				'playlists/import',
				{ uri: '', activate: true },
				{ icon: 'folder' },
			)
			tool(
				organization,
				'playlist_sort_template',
				'Sort playlist with an AIMP template · edit template',
				'Sort playlist\nSetup: template',
				'feature_playlist_sort_template',
				'playlists/sort/template',
				{ ...active, template: '' },
				{ icon: 'filter' },
			)
			for (const value of [true, false])
				tool(
					organization,
					`group_selected_${value ? 'on' : 'off'}`,
					`${value ? 'Select' : 'Deselect'} playlist group · choose group index`,
					`${value ? 'Select' : 'Deselect'}\nGroup`,
					'feature_group_set',
					'playlists/group/set',
					{ ...active, group: 0, parameter: 'selected', value },
					{ icon: 'groups' },
				)
			tool(
				organization,
				'groups_merge',
				'Merge all playlist groups',
				'Merge\nAll groups',
				'feature_groups_merge',
				'playlists/groups/merge',
				{ ...active, group: -1 },
				{ icon: 'groups', color: palette.seek },
			)
			const sourceTemplates = () =>
				section(
					'feature_source_templates',
					'Advanced · Playlist Sources',
					'Create a folder or playlist source and configure synchronization. Empty paths must be configured before these templates can run.',
				)
			for (const [id, descriptor] of entries(catalog.source_types))
				tool(
					sourceTemplates,
					`source_create_${key(id)}`,
					`Create ${descriptor.label || id} source · configure paths`,
					`Create source\n${descriptor.label || id}`,
					'feature_source_create',
					'playlists/source/create',
					{ ...active, kind: id, uri: '', folders: '[]', autosync: false, startup: false, sort_template: '' },
					{ icon: 'folder' },
				)
			for (const enabled of [true, false])
				tool(
					sourceTemplates,
					`source_startup_${enabled ? 'on' : 'off'}`,
					`Synchronize playlist at AIMP startup ${enabled ? 'on' : 'off'}`,
					`Sync at startup\n${enabled ? 'On' : 'Off'}`,
					'feature_source_set',
					'playlists/source/set',
					{ ...active, parameter: 'autosync_on_startup', enabled, template: '' },
					{ icon: 'folder' },
				)
			tool(
				sourceTemplates,
				'source_sort',
				'Set playlist source sort template',
				'Source sort\nEdit template',
				'feature_source_set',
				'playlists/source/set',
				{ ...active, parameter: 'sort_template', enabled: false, template: '' },
				{ icon: 'filter' },
			)
			tool(
				sourceTemplates,
				'source_clear',
				'Remove the playlist synchronization source',
				'Remove\nPlaylist source',
				'feature_source_clear',
				'playlists/source/clear',
				active,
				{ icon: 'remove', color: palette.red, danger: true },
			)
		}
	}
	if (capabilities.tags?.available === true) {
		const playlistId = instance.playlistChoices?.[0]?.id || '',
			target = { target: 'focused', playlistId, trackId: 0 }
		const read = section(
			'feature_tags_read',
			'File Tags · Inspect',
			'Read the focused track’s file tags. This does not modify the media file.',
		)
		button(
			read,
			'tags_get',
			'Read focused file tags into last_response',
			'Inspect\nFile tags',
			action('feature_tags_get', target),
			{ icon: 'tag', color: palette.library, value: variable('tags_count') },
		)
		if (advanced) {
			const field = entries(capabilities.tags.fields).find(
				([, descriptor]) => available(descriptor) && descriptor.writable !== false,
			)?.[0]
			if (field !== undefined) {
				const write = section(
					'feature_tags_write',
					'Advanced · Write File Tags',
					'These actions modify media files on disk. Select the field and value, then explicitly enable the confirmation checkbox. It is off in this template.',
				)
				button(
					write,
					'tags_write',
					'Write a file tag · configure field/value and explicitly confirm',
					'Write file tag\nEdit + confirm',
					action('feature_tags_write', { ...target, field, value: '', confirm: false }),
					{ icon: 'save', color: palette.red, danger: true },
				)
			}
		}
	}
	if (capabilities.music_library?.available === true) {
		const catalog = capabilities.music_library
		const commands = new Set(catalog.commands || [])
		const state = instance.musicLibrary || {}
		const storages = (state.storages?.length ? state.storages : catalog.storages || []).filter(
			(storage) => storage.can_query,
		)
		const firstStorage = storages.find((storage) => storage.id === state.storage_id)?.id || storages[0]?.id
		const browser = section(
			'feature_music_library',
			'Music Library · Browser',
			'Search AIMP’s library providers, browse result pages, then select a result to play, queue, or add. This is separate from loaded playlists.',
		)
		function ml(id, name, text, actionId, wire, options = {}, appearance = {}, group = browser) {
			if (!commands.has(wire)) return undefined
			return button(group, id, name, text, action(actionId, options), {
				icon: 'library',
				color: palette.library,
				...appearance,
			})
		}
		ml(
			'ml_storages',
			'Refresh AIMP music-library providers',
			'Library\nProviders',
			'feature_ml_storages',
			'musiclibrary/storages/get',
			{},
			{ icon: 'tree' },
		)
		for (const storage of storages)
			ml(
				`ml_browse_${hash(storage.id)}`,
				`Browse / search ${storage.name || storage.id} · edit search in action`,
				storage.name || String(storage.id),
				'feature_ml_search',
				'musiclibrary/query',
				{ storage_id: storage.id, search: '', limit: 20 },
				{ icon: 'search' },
			)
		ml(
			'ml_refresh',
			'Refresh the current music-library search',
			'Refresh\nSearch',
			'feature_ml_refresh',
			'musiclibrary/query',
			{},
			{ icon: 'refresh' },
		)
		ml(
			'ml_previous_page',
			'Previous music-library result page',
			'Previous\nPage',
			'feature_ml_previous_page',
			'musiclibrary/query/get',
			{},
			{ icon: 'previous', feedbacks: [{ feedbackId: 'feature_ml_has_previous', options: {} }] },
		)
		ml(
			'ml_next_page',
			'Next music-library result page',
			'Next\nPage',
			'feature_ml_next_page',
			'musiclibrary/query',
			{},
			{ icon: 'next', feedbacks: [{ feedbackId: 'feature_ml_has_next', options: {} }] },
		)
		for (const delta of [-1, 1])
			button(
				browser,
				`ml_select_${delta < 0 ? 'previous' : 'next'}`,
				`${delta < 0 ? 'Previous' : 'Next'} library result`,
				`${delta < 0 ? 'Previous' : 'Next'}\nResult`,
				action('feature_ml_select', { delta }),
				{ icon: delta < 0 ? 'track-prev' : 'track-next', color: palette.focus },
			)
		const selected = button(
			browser,
			'ml_selected',
			'Selected music-library result · press to refresh current search',
			variable('ml_selected_title'),
			commands.has('musiclibrary/query') ? action('feature_ml_refresh') : null,
			{ icon: 'track', color: palette.library, feedbacks: [{ feedbackId: 'feature_ml_has_results', options: {} }] },
		)
		selected.elements.find((element) => element.id === 'icon').enabled = false
		Object.assign(
			selected.elements.find((element) => element.id === 'label'),
			{ y: 12, height: 82, text: `${variable('ml_selected_artist')}\n${variable('ml_selected_title')}` },
		)
		ml(
			'ml_play',
			'Play selected music-library result',
			'Play\nResult',
			'feature_ml_play',
			'musiclibrary/row/play',
			{ row_id: '__selected__' },
			{ icon: 'play', color: palette.transport },
		)
		ml(
			'ml_queue',
			'Queue selected music-library result if already present in a loaded playlist',
			'Queue\nResult',
			'feature_ml_queue',
			'musiclibrary/row/queue',
			{ row_id: '__selected__', first: false },
			{ icon: 'queue' },
		)
		ml(
			'ml_add',
			'Add selected music-library result to the active playlist',
			'Add result\nTo playlist',
			'feature_ml_add',
			'musiclibrary/row/add',
			{ row_id: '__selected__', playlistId: '__active__' },
			{ icon: 'add' },
		)
		ml(
			'ml_cancel',
			'Cancel the running music-library search',
			'Cancel\nSearch',
			'feature_ml_cancel',
			'musiclibrary/query/cancel',
			{},
			{ icon: 'stop', color: palette.seek, feedbacks: [{ feedbackId: 'feature_ml_pending', options: {} }] },
		)
		button(
			browser,
			'ml_status',
			'Music-library result range and query status',
			`${variable('ml_page_start')}–${variable('ml_page_end')}`,
			commands.has('musiclibrary/query') ? action('feature_ml_refresh') : null,
			{ icon: 'info', color: palette.info, value: variable('ml_status') },
		)
		const rotaryGroup = section(
			'feature_ml_rotary',
			'Rotary Encoders · Music Library',
			'Turn to select a result on the current page. Press to play when the provider supports playback.',
		)
		const rotary = button(
			rotaryGroup,
			'ml_rotary',
			'Music-library result selection / press play',
			'Library result',
			commands.has('musiclibrary/row/play') ? action('feature_ml_play', { row_id: '__selected__' }) : null,
			{ icon: 'encoder', color: palette.library, value: variable('ml_selected_number') },
		)
		rotary.steps[0].rotate_left = [action('feature_ml_select', { delta: -1 })]
		rotary.steps[0].rotate_right = [action('feature_ml_select', { delta: 1 })]
		const rows = state.query?.rows || []
		if (rows.length) {
			const results = section(
				'feature_ml_results',
				'Music Library · Current Results',
				'One button per populated page slot. Press to select; Play / Queue / Add operate the selection. Titles follow the current results even on copied buttons.',
			)
			for (let index = 0; index < Math.min(rows.length, 100); index++) {
				const preset = button(
					results,
					`ml_row_${index}`,
					`Select music-library result ${index + 1}`,
					variable(`ml_row_${index + 1}_title`),
					action('feature_ml_select_row', { index }),
					{
						icon: 'track',
						color: palette.library,
						feedbacks: [{ feedbackId: 'feature_ml_row_is_selected', options: { index } }],
					},
				)
				preset.elements.find((element) => element.id === 'icon').enabled = false
				Object.assign(
					preset.elements.find((element) => element.id === 'label'),
					{
						y: 12,
						height: 82,
						text: `${variable(`ml_row_${index + 1}_artist`)}\n${variable(`ml_row_${index + 1}_title`)}`,
					},
				)
				preset.feedbacks.splice(preset.feedbacks.length - 1, 0, {
					feedbackId: 'feature_ml_row_available',
					options: { index },
					isInverted: true,
					styleOverrides: [
						override('background', 'color', 0x161b23),
						override('label', 'color', 0x8994a3),
						override('label', 'text', 'Empty result'),
					],
				})
			}
		}
		if (advanced && firstStorage !== undefined) {
			const advancedGroup = section(
				'feature_ml_query',
				'Advanced · Music Library Filters',
				'Configure provider-supported fields, operators, and sorting in the action. Inspect fields exposes the provider schema in last_response.',
			)
			ml(
				'ml_fields',
				'Inspect music-library fields and filter operators',
				'Inspect\nFields',
				'feature_ml_fields',
				'musiclibrary/fields/get',
				{ storage_id: firstStorage },
				{ icon: 'info' },
				advancedGroup,
			)
			ml(
				'ml_query',
				'Run a filtered music-library query · configure filters and sorting',
				'Filter library\nEdit query',
				'feature_ml_query',
				'musiclibrary/query',
				{ storage_id: firstStorage, search: '', limit: 20, filters: '[]', sort: '[]', match: 'all' },
				{ icon: 'filter' },
				advancedGroup,
			)
		}
		const operationStorages = state.storages?.length ? state.storages : catalog.storages || []
		const selectedStorage = operationStorages.find((storage) => storage.id === state.storage_id) || operationStorages[0]
		if (selectedStorage)
			ml(
				'ml_storage_select',
				`Activate AIMP library provider: ${selectedStorage.name || selectedStorage.id} · choose provider in action`,
				'Activate\nLibrary provider',
				'feature_ml_storage_select',
				'musiclibrary/storage/select',
				{ storage_id: selectedStorage.id },
				{ icon: 'tree' },
			)
		for (const storage of operationStorages) {
			for (const [command, label] of [
				['add_files_dialog', 'Import files'],
				['report_dialog', 'Library report'],
			]) {
				if (!storage.commands?.[command]) continue
				const group = section(
					'feature_ml_provider_tools',
					'Music Library · Provider Tools',
					'Open a provider’s own import or report dialog on the AIMP computer.',
				)
				ml(
					`ml_${command}_${hash(storage.id)}`,
					`${label}: ${storage.name || storage.id}`,
					`${label}\n${storage.name || storage.id}`,
					'feature_ml_storage_command',
					'musiclibrary/storage/command',
					{ storage_id: storage.id, command, files: '[]' },
					{ icon: command === 'add_files_dialog' ? 'folder' : 'library' },
					group,
				)
			}
		}
		if (operationStorages.some((storage) => storage.commands?.row_reload_tags))
			ml(
				'ml_row_reload_tags',
				'Reload tags for the selected library record',
				'Reload tags\nSelected result',
				'feature_ml_row_reload_tags',
				'musiclibrary/row/reload_tags',
				{},
				{ icon: 'refresh' },
			)
		if (operationStorages.some((storage) => storage.commands?.row_mark)) {
			const ratings = section(
				'feature_ml_ratings',
				'Music Library · Record Rating',
				'Set the selected database record’s rating. Playlist-entry ratings and file tags have separate controls.',
			)
			for (let value = 0; value <= 5; value++)
				ml(
					`ml_rating_${value}`,
					`Rate selected library record: ${value ? value : 'unrated'}`,
					value ? `Library rating\n${value} / 5` : 'Library rating\nUnrated',
					'feature_ml_row_mark',
					'musiclibrary/row/mark',
					{ value },
					{ icon: 'tag', color: palette.seek },
					ratings,
				)
		}
		ml(
			'ml_operation_status',
			'Refresh queued music-library operation status',
			'Library task',
			'feature_ml_operation_refresh',
			'musiclibrary/operation/get',
			{},
			{ icon: 'info', color: palette.info, value: variable('ml_operation_status') },
		)
		if (advanced) {
			const tools = section(
				'feature_ml_provider_templates',
				'Advanced · Music Library Provider Tools',
				'Configure import paths or a grouping-tree path. Provider operations affect the selected library database.',
			)
			for (const storage of operationStorages)
				for (const [command, label] of [
					['add_files', 'Import paths'],
					['reload_tags', 'Reload library tags'],
				]) {
					if (!storage.commands?.[command]) continue
					ml(
						`ml_${command}_${hash(storage.id)}`,
						`${label}: ${storage.name || storage.id} · configure action`,
						`${label}\n${storage.name || storage.id}`,
						'feature_ml_storage_command',
						'musiclibrary/storage/command',
						{ storage_id: storage.id, command, files: '[]' },
						{ icon: command === 'add_files' ? 'folder' : 'refresh' },
						tools,
					)
				}
			ml(
				'ml_ui_get',
				'Inspect AIMP library grouping-tree path',
				'Library tree\nInspect path',
				'feature_ml_ui_get',
				'musiclibrary/ui/get',
				{},
				{ icon: 'tree', value: variable('ml_ui_path') },
				tools,
			)
			ml(
				'ml_ui_path_set',
				'Focus AIMP library grouping-tree path · configure path',
				'Library tree\nEdit path',
				'feature_ml_ui_path_set',
				'musiclibrary/ui/path/set',
				{ path: '' },
				{ icon: 'tree' },
				tools,
			)
			if (operationStorages.some((storage) => storage.commands?.row_remove)) {
				const remove = section(
					'feature_ml_remove',
					'Advanced · Remove Library Record',
					'Removes the selected record from the library database, preserving the media file. Confirmation starts disabled.',
				)
				ml(
					'ml_row_remove',
					'Remove selected database record · explicitly confirm',
					'Remove record\nConfirm first',
					'feature_ml_row_remove',
					'musiclibrary/row/remove',
					{ confirm: false },
					{ icon: 'remove', color: palette.red, danger: true },
					remove,
				)
			}
		}
	}
	// Media metadata uses value feedbacks/local variables rather than rebuilding
	// preset image definitions on every artwork or lyric update.
	if (capabilities.media?.artwork === true) {
		const group = section(
			'feature_artwork',
			'Artwork',
			'Live artwork for the playing file. Set the button’s local show_title variable to false for artwork only. Press to refresh.',
		)
		const cover = button(
			group,
			'media_artwork',
			'Playing artwork · title overlay can be disabled',
			'Artwork',
			action('feature_artwork_refresh'),
			{ icon: 'artwork', color: palette.library },
		)
		cover.localVariables = [
			{ variableType: 'feedback', variableName: 'artwork', feedbackId: 'feature_artwork', options: {} },
			{ variableType: 'simple', variableName: 'show_title', startupValue: true },
		]
		const label = cover.elements.find((element) => element.id === 'label')
		Object.assign(label, {
			text: variable('playing_track_title'),
			y: 30,
			height: 65,
			valign: 'bottom',
			enabled: { isExpression: true, value: '$(local:show_title)' },
			outlineColor: 0xff000000,
		})
		cover.elements.splice(
			3,
			0,
			{
				type: 'image',
				id: 'artwork',
				name: 'Live artwork',
				x: 0,
				y: 0,
				width: 100,
				height: 100,
				base64Image: { isExpression: true, value: '$(local:artwork)' },
				fillMode: 'crop',
				halign: 'center',
				valign: 'center',
			},
			{
				type: 'box',
				id: 'artwork_shade',
				name: 'Title contrast',
				x: 0,
				y: 69,
				width: 100,
				height: 31,
				color: 0x061019,
				opacity: 82,
				enabled: { isExpression: true, value: '$(local:show_title)' },
			},
		)
		cover.feedbacks.push({
			feedbackId: 'is_connected',
			options: {},
			isInverted: true,
			styleOverrides: [override('artwork', 'opacity', 25)],
		})
		if (advanced)
			button(
				group,
				'media_artwork_status',
				'Artwork status · press to refresh',
				'Artwork status',
				action('feature_artwork_refresh'),
				{ icon: 'artwork', color: palette.library, value: variable('artwork_status') },
			)
	}
	if (capabilities.media?.lyrics === true) {
		const group = section(
			'feature_lyrics',
			'Lyrics',
			'Live lyrics for the playing file. Synchronized sources follow playback position; press to reload lyrics.',
		)
		function lyric(id, name, variableId) {
			const preset = button(group, id, name, variable(variableId), action('feature_lyrics_refresh'), {
				icon: 'lyrics',
				color: palette.focus,
			})
			preset.elements.find((e) => e.id === 'icon').enabled = false
			Object.assign(
				preset.elements.find((e) => e.id === 'label'),
				{ y: 12, height: 82 },
			)
			return preset
		}
		const current = lyric('lyrics_current', 'Current lyric · follows playback', 'lyrics_current')
		current.feedbacks.unshift({
			feedbackId: 'feature_lyrics_current_available',
			options: {},
			isInverted: true,
			styleOverrides: [override('label', 'text', 'No current lyric')],
		})
		if (capabilities.media.synchronized_lyrics === true) lyric('lyrics_next', 'Next lyric line', 'lyrics_next')
		if (advanced) {
			lyric('lyrics_previous', 'Previous lyric line', 'lyrics_previous')
			button(
				group,
				'lyrics_status',
				'Lyrics availability and type · press to reload',
				'Lyrics',
				action('feature_lyrics_refresh'),
				{ icon: 'lyrics', color: palette.focus, value: `${variable('lyrics_type')}\n${variable('lyrics_status')}` },
			)
		}
	}
	if (groups.size) {
		const extendedUtility = section(
			'feature_utilities',
			'Extended Controls · Refresh',
			'Refresh the connected AIMP plugin’s capability catalog and extended state.',
		)
		button(
			extendedUtility,
			'refresh_extended',
			'Refresh AIMP extended controls',
			'Refresh\nAIMP controls',
			action('feature_refresh'),
			{ icon: 'refresh', color: palette.info },
		)
	}
	if (advanced && entries(capabilities.audio).some(([, d]) => available(d) && d.type !== 'boolean')) {
		const resetGroup = section(
			'feature_audio_reset',
			'Advanced · Reset Sound Effects',
			'Restore all exposed sound effects to their neutral values. Equalizer bands are controlled separately.',
		)
		button(
			resetGroup,
			'audio_reset_all',
			'Reset every exposed sound effect to neutral',
			'Reset all\nSound effects',
			action('feature_audio_reset', { parameter: '*' }),
			{ icon: 'reset', color: palette.seek },
		)
	}
	// Do not leave empty groups when a service is present but has no usable controls.
	for (let index = structure.length - 1; index >= 0; index--)
		if (structure[index].id.startsWith('feature_') && !structure[index].definitions.length) structure.splice(index, 1)
}
