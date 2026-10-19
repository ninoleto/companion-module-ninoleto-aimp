// Native Companion 5 graphics with a curated browser. Advanced mode exposes the full catalogue.
import { createHash } from 'node:crypto'
import { stylePreset } from './preset-style.js'
import { appendFeaturePresets } from './feature-presets.js'

const colors = {
	transport: 0x203547,
	volume: 0x164c68,
	modes: 0x563364,
	seek: 0x755324,
	focus: 0x274b52,
	library: 0x3f4168,
	info: 0x252e38,
	green: 0x167044,
	orange: 0xa45a14,
	red: 0x9c3029,
}
const digest = (s) => createHash('sha256').update(s).digest('hex').slice(0, 24)
export function updatePresets(instance) {
	const presets = {},
		structure = []
	const variable = (id) => `$(${instance.label || 'aimp-control'}:${id})`
	const action = (actionId, options = {}) => ({ actionId, options })
	const feedback = (feedbackId, options = {}, bgcolor = colors.green, extra = {}) => ({
		feedbackId,
		options,
		style: { bgcolor, color: 0xffffff, ...extra },
	})
	const disconnected = {
		feedbackId: 'is_connected',
		options: {},
		isInverted: true,
		style: { bgcolor: 0x333333, color: 0x999999 },
	}
	function section(id, name, description) {
		const s = { id, name, definitions: [] }
		if (description) s.description = description
		structure.push(s)
		return s.definitions
	}
	function add(group, id, name, text, actionId, options = {}, color = colors.transport, feedbacks = []) {
		presets[id] = {
			type: 'simple',
			name,
			style: { text, size: 'auto', color: 0xffffff, bgcolor: color },
			steps: [{ down: actionId ? [action(actionId, options)] : [], up: [] }],
			feedbacks: [...feedbacks, disconnected],
		}
		group.push(id)
		return presets[id]
	}
	const transport = section('transport', 'Transport')
	add(transport, 'play_pause', 'Play / Pause', 'PLAY\nPAUSE', 'play_pause', {}, colors.transport, [
		feedback('is_playing', {}, colors.green, { text: 'PAUSE' }),
		feedback('is_paused', {}, colors.orange, { text: 'RESUME' }),
	])
	for (const [id, text, fb] of [
		['play', 'PLAY', 'is_playing'],
		['pause', 'PAUSE', 'is_paused'],
		['stop', 'STOP', 'is_stopped'],
		['prev', 'PREVIOUS', ''],
		['next', 'NEXT', ''],
	]) {
		add(transport, id, text, text, id, {}, id === 'stop' ? colors.red : colors.transport, fb ? [feedback(fb)] : [])
	}
	const volume = section('volume', 'Volume and Mute')
	for (const step of [1, 5, 10])
		for (const up of [false, true])
			add(
				volume,
				`volume_${up ? 'up' : 'down'}_${step}`,
				`Volume ${up ? '+' : '−'}${step}%`,
				`VOL ${up ? '+' : '−'}${step}\n${variable('volume_pct')}%`,
				up ? 'volume_up' : 'volume_down',
				{ step },
				colors.volume,
			)
	for (const n of [0, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100])
		add(volume, `volume_${n}`, `Set volume ${n}%`, `VOL\n${n}%`, 'set_volume', { volume: n }, colors.volume, [
			feedback('volume_is', { volume: n }),
		])
	add(volume, 'mute_toggle', 'Mute toggle', 'MUTE', 'mute_toggle', {}, colors.volume, [
		feedback('is_muted', {}, colors.orange),
	])
	for (const enabled of [true, false])
		add(
			volume,
			`mute_${enabled ? 'on' : 'off'}`,
			enabled ? 'Mute on' : 'Mute off',
			enabled ? 'MUTE\nON' : 'MUTE\nOFF',
			'mute_set',
			{ enabled },
			colors.volume,
			[{ ...feedback('is_muted', {}, colors.orange), isInverted: !enabled }],
		)
	const modes = section('modes', 'Playback Modes')
	for (const [id, label, fb] of [
		['shuffle', 'SHUFFLE', 'is_shuffled'],
		['repeat', 'REPEAT\nTRACK', 'is_repeat'],
		['auto_jump', 'AUTO\nADVANCE', 'is_auto_jump'],
	]) {
		add(modes, `${id}_toggle`, `${label.replace('\n', ' ')} toggle`, label, `${id}_toggle`, {}, colors.modes, [
			feedback(fb),
		])
		for (const enabled of [true, false])
			add(
				modes,
				`${id}_${enabled ? 'on' : 'off'}`,
				`${label.replace('\n', ' ')} ${enabled ? 'on' : 'off'}`,
				`${label}\n${enabled ? 'ON' : 'OFF'}`,
				`${id}_set`,
				{ enabled },
				colors.modes,
				[{ ...feedback(fb), isInverted: !enabled }],
			)
	}
	const seek = section('seek', 'Seek and Restart')
	add(seek, 'restart', 'Restart current track', 'RESTART\nTRACK', 'seek_seconds', { position: 0 }, colors.seek)
	for (const seconds of [-60, -30, -10, -5, -1, 1, 5, 10, 30, 60])
		add(
			seek,
			`seek_${seconds}`,
			`Seek ${seconds > 0 ? '+' : ''}${seconds}s`,
			`${seconds > 0 ? '+' : ''}${seconds}s`,
			'seek_relative',
			{ seconds },
			colors.seek,
		)
	for (const percent of [0, 25, 50, 75, 90])
		add(
			seek,
			`seek_pct_${percent}`,
			`Seek to ${percent}%`,
			`SEEK\n${percent}%`,
			'seek_percent',
			{ percent },
			colors.seek,
		)
	const focus = section(
		'focus',
		'Focus Navigation',
		'Select playlists and tracks without interrupting playback. Press Play focused to start the selection.',
	)
	for (const [id, text] of [
		['focus_playlist_prev', 'PLAYLIST\nPREV'],
		['focus_playlist_next', 'PLAYLIST\nNEXT'],
		['focus_track_prev', 'SELECT\nPREV'],
		['focus_track_next', 'SELECT\nNEXT'],
		['focus_play', 'PLAY\nFOCUSED'],
	])
		add(focus, id, text.replace('\n', ' '), text, id, {}, colors.focus)
	add(
		focus,
		'focus_playlist_display',
		'Focused playlist',
		`SELECTED\n${variable('focus_playlist_name')}`,
		'refresh_focus',
		{},
		colors.focus,
	)
	add(
		focus,
		'focus_track_display',
		'Focused track',
		`${variable('focus_track_artist')}\n${variable('focus_track_title')}`,
		'focus_play',
		{},
		colors.focus,
	)
	const rotary = section(
		'rotary',
		'Rotary Encoders',
		'Turn left/right to adjust. The button press action is shown in each preset name.',
	)
	function encoder(id, name, text, left, right, press, color) {
		const p = add(rotary, id, name, text, null, {}, color)
		p.options = { rotaryActions: true }
		p.steps = [{ down: press ? [press] : [], up: [], rotate_left: [left], rotate_right: [right] }]
	}
	for (const step of [1, 5])
		encoder(
			`rotary_volume_${step}`,
			`Volume ±${step}% / press mute`,
			`VOLUME\n${variable('volume_pct')}%`,
			action('volume_down', { step }),
			action('volume_up', { step }),
			action('mute_toggle'),
			colors.volume,
		)
	for (const seconds of [1, 5, 10])
		encoder(
			`rotary_seek_${seconds}`,
			`Seek ±${seconds}s / press play-pause`,
			`${variable('position_fmt')}\n/ ${variable('duration_fmt')}`,
			action('seek_relative', { seconds: -seconds }),
			action('seek_relative', { seconds }),
			action('play_pause'),
			colors.seek,
		)
	encoder(
		'rotary_tracks',
		'Track selection / press play focused',
		`SELECT\n${variable('focus_track_title')}`,
		action('focus_track_prev'),
		action('focus_track_next'),
		action('focus_play'),
		colors.focus,
	)
	encoder(
		'rotary_playlists',
		'Playlist selection / press play focused',
		`PLAYLIST\n${variable('focus_playlist_name')}`,
		action('focus_playlist_prev'),
		action('focus_playlist_next'),
		action('focus_play'),
		colors.focus,
	)
	const info = section('info', 'Live Displays')
	for (const [id, name, text] of [
		['now_playing', 'Now playing', `${variable('playing_track_artist')}\n${variable('playing_track_title')}`],
		['next_track', 'Next track', `NEXT\n${variable('next_track_artist')}\n${variable('next_track_title')}`],
		['playing_playlist', 'Playing playlist', `PLAYLIST\n${variable('playing_playlist_name')}`],
		['elapsed', 'Elapsed time', `ELAPSED\n${variable('position_fmt')}`],
		['remaining', 'Remaining time', `REMAINING\n${variable('remaining_fmt')}`],
		['duration', 'Track duration', `DURATION\n${variable('duration_fmt')}`],
		[
			'progress',
			'Track progress',
			`${variable('position_fmt')} / ${variable('duration_fmt')}\n${variable('progress_pct')}%`,
		],
		['volume_display', 'Volume display', `VOLUME\n${variable('volume_pct')}%`],
		['player_state', 'Player state', `AIMP\n${variable('player_state')}`],
	])
		add(
			info,
			`display_${id}`,
			name,
			text,
			'refresh_status',
			{},
			colors.info,
			id === 'remaining' ? [feedback('remaining_below', { seconds: 10 }, colors.orange)] : [],
		)
	const utility = section('utility', 'Connection and Refresh')
	for (const [id, name] of [
		['refresh_status', 'PLAYER STATUS'],
		['refresh_library', 'REFRESH LIBRARY'],
		['refresh_volume', 'READ VOLUME'],
		['refresh_focus', 'READ FOCUS'],
		['refresh_shuffle', 'READ SHUFFLE'],
		['refresh_repeat', 'READ REPEAT'],
		['refresh_auto_jump', 'READ AUTO ADVANCE'],
	])
		add(utility, id, name, name.replaceAll(' ', '\n'), id, {}, colors.info)
	const connection = add(
		utility,
		'connection_status',
		'Connection diagnostic',
		variable('connection_status'),
		'refresh_status',
		{},
		colors.red,
		[feedback('is_connected', {}, colors.green, { text: 'AIMP\nCONNECTED' })],
	)
	connection.feedbacks = connection.feedbacks.filter((f) => f !== disconnected)
	add(
		utility,
		'library_status',
		'Library status',
		`${variable('library_status')}\n${variable('playlist_count')} PL / ${variable('loaded_track_count')} TR`,
		'refresh_library',
		{},
		colors.info,
	)
	add(utility, 'last_error', 'Last command error', variable('last_command_error'), 'refresh_status', {}, colors.info, [
		feedback('command_error', {}, colors.red),
	])
	const templates = section(
		'custom',
		'Configurable Buttons',
		'Drag a button onto a page and select the playlist/track or edit its options.',
	)
	const first = instance.playlistChoices[0]?.id || ''
	const firstTrack = instance.tracksCache[first]?.[0]?.id || ''
	for (const [id, name, options] of [
		['playlist_play', 'PLAY PLAYLIST', { playlistId: first }],
		['playlist_resume', 'RESUME PLAYLIST', { playlistId: first }],
		['playlist_select', 'SELECT PLAYLIST', { playlistId: first }],
		['playlist_action', 'PLAY / SELECT PLAYLIST', { playlistId: first, action: 'play' }],
		['playlist_track_next', 'NEXT IN PLAYLIST', { playlistId: first }],
		['playlist_track_prev', 'PREV IN PLAYLIST', { playlistId: first }],
		['track_action', 'PLAY TRACK NUMBER', { playlistId: first, trackId: 0, action: 'play' }],
		['track_action_browse', 'PLAY TRACK PATH', { playlistId: first, trackId: firstTrack, action: 'play' }],
		[
			'track_browse',
			'BROWSE / PLAY TRACK',
			{ track: firstTrack ? JSON.stringify([first, firstTrack]) : '', action: 'play' },
		],
		['playlist_info', 'READ PLAYLIST INFO', { playlistId: first }],
		['track_info', 'READ TRACK INFO', { playlistId: first, trackId: 0 }],
	])
		add(templates, `custom_${id}`, name, name.replaceAll(' ', '\n'), id, options, colors.library)
	const playlistGroups = [],
		trackGroups = []
	for (const pl of instance.playlistChoices) {
		const key = digest(pl.id),
			ids = []
		for (const [id, label] of [
			['playlist_play', 'PLAY'],
			['playlist_resume', 'RESUME'],
			['playlist_select', 'SELECT'],
			['playlist_track_prev', 'PREV'],
			['playlist_track_next', 'NEXT'],
		]) {
			add(
				ids,
				`pl_${key}_${id}`,
				`${label} ${pl.label}`,
				`${label}\n${pl.label}`,
				id,
				{ playlistId: pl.id },
				colors.library,
				[feedback(id === 'playlist_select' ? 'focus_playlist_is' : 'playing_playlist_is', { playlistId: pl.id })],
			)
		}
		playlistGroups.push({ id: `playlist_${key}`, type: 'simple', name: pl.label, presets: ids })
		if (instance.config?.trackPresets !== false) {
			const tracks = instance.tracksCache[pl.id] || []
			for (let page = 0; page < tracks.length; page += 100) {
				const trackIds = []
				for (const t of tracks.slice(page, page + 100))
					for (const operation of ['play', 'select']) {
						add(
							trackIds,
							`tr_${key}_${digest(t.id)}_${operation}`,
							`${operation === 'play' ? 'Play' : 'Select'} ${t.label}`,
							`${operation === 'play' ? 'PLAY' : 'SELECT'} ${t.index + 1}\n${t.artist}\n${t.title || t.path}`,
							'track_action_browse',
							{ playlistId: pl.id, trackId: t.id, action: operation },
							colors.library,
							[
								feedback(operation === 'play' ? 'playing_track_is' : 'focus_track_is', {
									playlistId: pl.id,
									trackId: t.id,
								}),
							],
						)
					}
				trackGroups.push({
					id: `tracks_${key}_${page}`,
					type: 'simple',
					name: `${pl.label} · ${page + 1}–${Math.min(page + 100, tracks.length)}`,
					presets: trackIds,
				})
			}
		}
	}
	structure.push({
		id: 'playlists',
		name: 'Your Playlists',
		description: 'Generated for every loaded playlist after connection.',
		definitions: playlistGroups,
	})
	structure.push({
		id: 'tracks',
		name: 'Your Tracks',
		description:
			'Play and Select buttons for every loaded track, grouped by playlist and pages of 100. Refresh library after editing a playlist.',
		definitions: trackGroups,
	})
	// Build every supported variant, then publish only the selected catalogue.
	// Every action remains available in the button editor.
	const categories = new Map()
	for (const group of structure) {
		for (const def of group.definitions) {
			for (const id of typeof def === 'string' ? [def] : def.presets) categories.set(id, group.id)
		}
	}
	for (const [id, preset] of Object.entries(presets)) {
		presets[id] = stylePreset(
			id,
			preset,
			{ playlists: 'library', tracks: 'library', custom: 'library', rotary: 'volume', utility: 'info' }[
				categories.get(id)
			] || categories.get(id),
			variable,
		)
	}
	const shown = new Set()
	const curated = []
	function show(id, name, ids, description) {
		const definitions = ids.filter((key) => presets[key] && !shown.has(key))
		definitions.forEach((key) => shown.add(key))
		if (definitions.length) curated.push({ id, name, ...(description ? { description } : {}), definitions })
	}
	show('transport', 'Transport', ['play_pause', 'stop', 'prev', 'next', 'restart'])
	show('volume', 'Volume', [
		'volume_down_5',
		'volume_up_5',
		'mute_toggle',
		'display_volume_display',
		'volume_25',
		'volume_50',
		'volume_75',
		'volume_100',
	])
	show('modes', 'Playback modes', ['shuffle_toggle', 'repeat_toggle', 'auto_jump_toggle'])
	show('seek', 'Seek', [
		'seek_-30',
		'seek_-10',
		'seek_-5',
		'seek_5',
		'seek_10',
		'seek_30',
		'seek_pct_25',
		'seek_pct_50',
		'seek_pct_75',
	])
	show(
		'focus',
		'Selection',
		[
			'focus_playlist_prev',
			'focus_playlist_next',
			'focus_track_prev',
			'focus_track_next',
			'focus_play',
			'focus_playlist_display',
			'focus_track_display',
		],
		'Browse without changing playback; Play focused starts the selection.',
	)
	show(
		'rotary',
		'Encoders',
		['rotary_volume_1', 'rotary_seek_5', 'rotary_tracks', 'rotary_playlists'],
		'Turn to adjust. Press for mute, play/pause, or play selection.',
	)
	show('info', 'Live displays', [
		'display_now_playing',
		'display_next_track',
		'display_elapsed',
		'display_remaining',
		'display_progress',
		'display_playing_playlist',
	])
	show('utility', 'Connection and library', ['connection_status', 'refresh_library', 'library_status', 'last_error'])
	const all = instance.config?.advancedPresets === true
	for (const source of structure.filter((s) => ['playlists', 'tracks'].includes(s.id))) {
		const definitions = source.definitions.map((group) => ({
			...group,
			presets: group.presets.filter((id) =>
				source.id === 'tracks'
					? id.endsWith('_play')
					: id.endsWith('_playlist_play') || id.endsWith('_playlist_resume'),
			),
		}))
		for (const group of definitions) group.presets.forEach((id) => shown.add(id))
		curated.push({
			id: source.id,
			name: source.name,
			description:
				source.id === 'tracks'
					? 'One Play button per track. Selection variants are available with advanced presets.'
					: 'Play from the start, or resume each playlist.',
			definitions: definitions.filter((g) => g.presets.length),
		})
	}
	if (all) {
		for (const source of structure) {
			const ids = source.definitions.flatMap((def) => (typeof def === 'string' ? [def] : def.presets))
			show(`advanced_${source.id}`, `Advanced · ${source.name}`, ids)
		}
	}
	const finalPresets = Object.fromEntries([...shown].map((id) => [id, presets[id]]))
	appendFeaturePresets(instance, curated, finalPresets)
	instance.setPresetDefinitions(curated, finalPresets)
}
