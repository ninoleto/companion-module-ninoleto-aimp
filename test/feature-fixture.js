// Simulated bridge 0.2.0 fixture for contract tests and renderer previews.
// Descriptors mirror the SDK-backed catalog. EQ bands/presets/devices are examples,
// not a claim about the presets or hardware installed on a user's computer.
import { initialFeatureState } from '../src/feature-controls.js'
import { featureIcons } from '../src/feature-icons.js'

export function makeFeatureFixture(beta4 = true) {
	const state = initialFeatureState()
	const audio = [
		['balance', 'Balance', -1, 1, 0, 0.01, ''],
		['chorus', 'Chorus', 0, 1, 0, 0.01, ''],
		['echo', 'Echo', 0, 1, 0, 0.01, ''],
		['enhancer', 'Enhancer', 1, 4, 1, 0.05, ''],
		['flanger', 'Flanger', 0, 1, 0, 0.01, ''],
		['reverb', 'Reverb', 0, 1, 0, 0.01, ''],
		['pitch', 'Pitch', -10, 10, 0, 0.1, ''],
		['speed', 'Speed', 0.5, 1.5, 1, 0.01, 'x'],
		['tempo', 'Tempo', 0.8, 1.5, 1, 0.01, 'x'],
		['bass', 'Bass enhancement', 0, 2, 0, 0.05, ''],
		['equalizer_auto', 'Automatic equalizer preset', 0, 1, 0, 1, '', 'boolean'],
	].map(([id, label, min, max, neutral, step, unit, type = 'number']) => ({
		id,
		label,
		min,
		max,
		default: type === 'boolean' ? false : neutral,
		step,
		unit,
		type,
		supported: true,
	}))
	const player_options = {
		action_on_end_of_track: {
			label: 'After current track',
			type: 'enum',
			available: true,
			min: 0,
			max: 2,
			choices: [
				{ id: 0, label: 'Normal playback' },
				{ id: 1, label: 'Next track and stop' },
				{ id: 2, label: 'Next track and pause' },
			],
		},
		action_on_end_of_playlist: {
			label: 'After current playlist',
			type: 'enum',
			available: true,
			min: 0,
			max: 2,
			choices: [
				{ id: 0, label: 'Next playlist' },
				{ id: 1, label: 'Repeat playlist' },
				{ id: 2, label: 'Stop at playlist end' },
			],
		},
	}
	for (const [id, label] of [
		['repeat_single_file_playlists', 'Repeat single-track playlists'],
		['crossmixing', 'Cross-mixing'],
		['radio_capture_single_track', 'Record one radio track only'],
		['auto_transition', 'Automatic transition effects'],
		['manual_transition', 'Manual transition effects'],
	])
		player_options[id] = { label, type: 'boolean', available: true }
	for (const [id, label] of [
		['auto_crossfade_ms', 'Automatic crossfade'],
		['auto_fade_in_ms', 'Automatic fade in'],
		['auto_fade_out_ms', 'Automatic fade out'],
		['auto_pause_ms', 'Pause between tracks'],
		['manual_crossfade_ms', 'Manual crossfade'],
		['manual_fade_in_ms', 'Manual fade in'],
		['manual_fade_out_ms', 'Manual fade out'],
	])
		player_options[id] = { label, type: 'integer', available: true, min: 0, max: 2147483647, unit: 'ms', step: 100 }
	const app_options = Object.fromEntries(
		[
			['stay_on_top', 'Always on top'],
			['reverse_time', 'Show remaining time in AIMP'],
			['minimized_to_tray', 'Minimize AIMP to tray'],
			['visual_fullscreen', 'Fullscreen visualization'],
		].map(([id, label]) => [id, { label, type: 'boolean', available: true }]),
	)
	const app_commands = Object.fromEntries(
		[
			['quick_info', 'Show playing track info'],
			['about', 'Show About AIMP'],
			['options', 'Show AIMP settings'],
			['plugins', 'Show plug-in settings'],
			['scheduler', 'Show scheduler settings'],
			['visual_next', 'Next visualization'],
			['visual_prev', 'Previous visualization'],
			['visual_start', 'Start visualization'],
			['visual_stop', 'Stop visualization'],
			['play_previous_playlist', 'Play previous playlist'],
			['open_files', 'Open files dialog'],
			['open_folders', 'Open folders dialog'],
			['open_playlists', 'Open playlists dialog'],
			['save_playlist', 'Save playlist dialog'],
			['bookmarks', 'Show bookmarks'],
			['bookmark_playing', 'Bookmark playing track'],
			['bookmark_selected', 'Bookmark selected tracks'],
			['rescan_tags', 'Rescan active playlist tags'],
			['rescan_selected_tags', 'Rescan selected track tags'],
			['focus_playing', 'Focus playing track'],
			['enable_selected', 'Enable selected tracks'],
			['disable_selected', 'Disable selected tracks'],
			['add_files', 'Add files dialog'],
			['add_folders', 'Add folders dialog'],
			['add_playlists', 'Add playlists dialog'],
			['add_url', 'Add URL dialog'],
			['quick_tag_editor', 'Edit playing track tags'],
			['search', 'Show advanced search'],
			['dsp_manager', 'Show DSP manager'],
		].map(([id, label]) => [
			id,
			{ label, available: true, ...(id === 'dsp_manager' ? { param_min: 0, param_max: 3 } : {}) },
		]),
	)
	const frequencies = [
		31, 50, 63, 80, 100, 125, 200, 250, 315, 500, 630, 800, 1000, 2000, 3150, 4000, 6300, 8000, 12500, 16000,
	]
	state.protocol_version = 2
	state.plugin_version = '0.2.0-preview'
	state.capabilities = {
		audio,
		equalizer: {
			available: true,
			band_count: frequencies.length,
			preset_save: true,
			preset_save_preamp: false,
			preset_delete: false,
			min: -15,
			max: 15,
			step: 0.5,
			preamp: { min: -15, max: 15, default: 0, step: 0.5 },
		},
		player_options,
		app_options,
		app_commands,
		loop: { available: true, cycle: true, range: true },
		recording: { available: true },
		output: { available: true },
		library: {
			available: true,
			queue: true,
			queue_suspended: true,
			commands: [
				'queue/get',
				'queue/add',
				'queue/remove',
				'queue/clear',
				'queue/move',
				'queue/suspended',
				'playlists/info',
				'playlists/create',
				'playlists/rename',
				'playlists/close',
				'playlists/add',
				'playlists/clear',
				'playlists/sort',
				'playlists/track/info',
				'playlists/track/remove',
				'playlists/track/move',
				'playlists/track/enabled',
				'playlists/track/rating',
				'player/fileinfo',
				'player/play-file',
			],
			rating: { min: 0, max: 5, step: 0.5 },
			limits: { queue_page: 250 },
			sort_modes: [
				['title', 'Title'],
				['filename', 'File name'],
				['duration', 'Duration'],
				['artist', 'Artist'],
				['reverse', 'Reverse order'],
				['random', 'Randomize tracks'],
				['random_groups', 'Randomize groups'],
				['random_group_items', 'Randomize tracks within groups'],
				['random_all', 'Randomize groups and tracks'],
			].map(([id, label]) => ({ id, label })),
		},
	}
	state.audio = Object.fromEntries(audio.map((d) => [d.id, d.default]))
	Object.assign(state.audio, { pitch: 1.2, tempo: 1.05, speed: 1, balance: -0.1, reverb: 0.12, bass: 0.4 })
	state.equalizer = {
		available: true,
		enabled: true,
		preamp: -1.5,
		preset: 'Demo warm',
		presets: ['Demo flat', 'Demo warm', 'Demo vocal'],
		bands: frequencies.map((frequency, index) => ({
			index,
			frequency,
			gain: index === 2 ? 2.5 : index === 10 ? -1 : 0,
		})),
	}
	state.player_options = Object.fromEntries(
		Object.entries(player_options).map(([id, d]) => [id, d.type === 'boolean' ? false : 0]),
	)
	state.player_options.auto_crossfade_ms = 1500
	state.app_options = Object.fromEntries(Object.keys(app_options).map((id) => [id, false]))
	state.loop = { stage: 2, a: 10, b: 30 }
	state.recording = { enabled: false }
	state.output = {
		current: 'demo-speakers',
		devices: [
			{ id: 'demo-speakers', name: 'Studio speakers' },
			{ id: 'demo-headphones', name: 'Headphones' },
		],
	}
	state.queue = {
		count: 2,
		suspended: false,
		items: [
			{ queue_index: 0, playlist_id: 0, track_id: 0, title: 'Demo one' },
			{ queue_index: 1, playlist_id: 0, track_id: 1, title: 'Demo two' },
		],
	}
	if (!beta4) return state
	Object.assign(state.capabilities, makeBeta4Capabilities())
	Object.assign(state.capabilities.equalizer, {
		preset_rename: true,
		preset_delete: true,
		preset_builtin_distinction: false,
	})
	const playlistTools = makePlaylistToolCapabilities()
	const libraryCommands = [...state.capabilities.library.commands, ...playlistTools.commands]
	Object.assign(state.capabilities.library, playlistTools, { commands: libraryCommands })
	for (const [id, label] of [
		['cleanup_missing', 'Remove missing entries from active playlist'],
		['cleanup_non_selected', 'Remove unselected entries from active playlist'],
		['cleanup_selected', 'Remove selected entries from active playlist'],
		['cleanup_disabled', 'Remove disabled entries from active playlist'],
		['cleanup_duplicates', 'Remove duplicate entries from active playlist'],
		['sync_preimage', 'Synchronize active playlist with its source'],
	])
		state.capabilities.app_commands[id] = {
			label,
			available: true,
			requires_confirmation: true,
			deletes_disk_files: false,
			scope: 'active_playlist',
		}
	state.app_control = { loaded: true, buffering: 100, last_action: null }
	state.skins = {
		available: true,
		current: 'Demo.acs5',
		installed: [{ name: 'Demo.acs5', title: 'Demo graphite', author: 'Fixture', version: '1' }],
		hue: 160,
		intensity: 40,
	}
	state.plugin_version = '0.3.0'
	return state
}

function makePlaylistToolCapabilities() {
	const properties = [
		['name', 'Playlist name', 'string'],
		['group_name', 'Playlist group name', 'string'],
		['read_only', 'Read-only playlist', 'boolean'],
		['grouping_override', 'Override grouping', 'boolean'],
		['grouping', 'Group tracks', 'boolean'],
		['grouping_template', 'Grouping template', 'string'],
		['grouping_auto_merge', 'Automatically merge groups', 'boolean'],
		['format_override', 'Override track formatting', 'boolean'],
		['format_line1', 'Track first-line template', 'string'],
		['format_line2', 'Track second-line template', 'string'],
		['view_override', 'Override playlist view', 'boolean'],
		['view_duration', 'Show durations', 'boolean'],
		['view_expand_buttons', 'Show group expand buttons', 'boolean'],
		['view_marks', 'Show ratings', 'boolean'],
		['view_numbers', 'Show track numbers', 'boolean'],
		['view_numbers_absolute', 'Use absolute track numbers', 'boolean'],
		['view_second_line', 'Show second line', 'boolean'],
		['view_switches', 'Show playback switches', 'boolean'],
		['focused_index', 'Focused track index', 'integer'],
		['playback_cursor', 'Playback cursor', 'integer'],
		['playing_index', 'Playing track index', 'integer'],
	].map(([id, label, type]) => ({
		id,
		label,
		type,
		...(type === 'integer' ? { min: -1 } : type === 'string' ? { max_length: 4096 } : {}),
	}))
	return {
		playlist_properties: properties,
		source_types: [
			{ id: 'folders', label: 'Folders' },
			{ id: 'playlist', label: 'Playlist file or URL' },
		],
		commands: [
			'playlists/import',
			'playlists/track/move-to',
			'playlists/track/copy-to',
			'playlists/track/selected',
			'playlists/track/refresh',
			'playlists/selection/set',
			'playlists/groups/get',
			'playlists/group/set',
			'playlists/groups/merge',
			'playlists/properties/get',
			'playlists/properties/set',
			'playlists/sort/template',
			'playlists/refresh',
			'playlists/source/get',
			'playlists/source/create',
			'playlists/source/set',
			'playlists/source/sync',
		],
	}
}
export function makeBeta4Capabilities() {
	return {
		media: { artwork: true, lyrics: true, synchronized_lyrics: true, artwork_max_dimension: 144 },
		music_library: {
			available: true,
			storages: [
				{
					id: 'demo-library',
					name: 'Local music library',
					can_query: true,
					commands: {
						add_files: true,
						reload_tags: true,
						add_files_dialog: true,
						report_dialog: true,
						row_remove: true,
						row_reload_tags: true,
						row_mark: true,
					},
				},
			],
			commands: [
				'musiclibrary/storages/get',
				'musiclibrary/storage/select',
				'musiclibrary/fields/get',
				'musiclibrary/query',
				'musiclibrary/query/get',
				'musiclibrary/query/cancel',
				'musiclibrary/row/play',
				'musiclibrary/row/add',
				'musiclibrary/row/queue',
				'musiclibrary/storage/command',
				'musiclibrary/row/remove',
				'musiclibrary/row/reload_tags',
				'musiclibrary/row/mark',
				'musiclibrary/operation/get',
				'musiclibrary/ui/get',
				'musiclibrary/ui/path/set',
			],
		},
		tags: {
			available: true,
			requires_confirmation: true,
			requires_file_identity: true,
			commands: ['tags/get', 'tags/write'],
			fields: [
				{ id: 'title', label: 'Title', type: 'string', max_length: 4096 },
				{ id: 'artist', label: 'Artist', type: 'string', max_length: 4096 },
				{ id: 'rating', label: 'File tag rating', type: 'integer', min: 0, max: 5 },
				{ id: 'track_gain', label: 'Track ReplayGain', type: 'number', min: -1000, max: 1000 },
			],
		},
		app_control: {
			notifications: true,
			windows: ['main', 'playlist', 'equalizer'].map((id) => ({ id, available: true })),
			action_lookup: true,
			action_execute: true,
			quit: true,
		},
		skins: {
			available: true,
			list: true,
			selection: true,
			reapply: true,
			color: {
				hue: { available: true, min: 0, max: 255, step: 1 },
				intensity: { available: true, min: 0, max: 100, step: 1 },
			},
		},
	}
}
export function makeMediaFixture() {
	const line = (index, text) => ({ index, start_ms: index * 10000, end_ms: (index + 1) * 10000, text })
	const lines = [
		line(0, 'Through the evening light'),
		line(1, 'We follow a brighter sound'),
		line(2, 'Where the city meets the sky'),
	]
	return {
		track_key: 'demo-track-key',
		artwork: {
			track_key: 'demo-track-key',
			status: 'ready',
			mime: 'image/png',
			data_base64: featureIcons.artwork.split(',')[1],
			width: 144,
			height: 144,
			revision: 1,
		},
		lyrics: {
			status: 'ready',
			type: 'synced',
			track_key: 'demo-track-key',
			text: lines.map((entry) => entry.text).join('\n'),
			lines,
			previous: lines[0],
			current: lines[1],
			next: lines[2],
			offset_ms: 15000,
			line_count: 3,
		},
	}
}
export function makeMusicLibraryFixture() {
	const rows = [
		{
			row_id: 'row-0',
			record_id: 'record-0',
			file_path: 'C:/Music/Midnight.flac',
			title: 'Midnight colours',
			artist: 'Demo artist',
			album: 'Neon nights',
			duration: 240,
			can_play: true,
			can_add: true,
			can_queue: true,
			values: {},
		},
		{
			row_id: 'row-1',
			record_id: 'record-1',
			file_path: 'C:/Music/Dawn.flac',
			title: 'First light',
			artist: 'Another demo artist',
			album: 'Morning',
			duration: 180,
			can_play: true,
			can_add: true,
			can_queue: false,
			values: {},
		},
	]
	const storages = makeBeta4Capabilities().music_library.storages
	return {
		storage_id: storages[0].id,
		storages,
		fields: [{ id: 'Artist', name: 'Artist', type: 'string' }],
		query: {
			id: 'demo-query-1',
			storage_id: storages[0].id,
			status: 'complete',
			offset: 0,
			limit: 20,
			rows,
			count: rows.length,
			total: 42,
			has_more: true,
			next_offset: rows.length,
			next_cursor: 'demo-next-cursor',
		},
		selected: 0,
		request: { storage_id: storages[0].id, search: '', filters: [], sort: [], match: 'all', offset: 0, limit: 20 },
		history: ['demo-query-1'],
		historyIndex: 0,
		error: '',
	}
}
export function makeLibraryToolsFixture() {
	return {
		properties: { values: { grouping: true, view_duration: true }, available: { grouping: true, view_duration: true } },
		groups: { total: 2, items: [{ index: 0, name: 'Demo album', expanded: true, selected: false }] },
		source: {
			attached: true,
			kind: 'folders',
			autosync: true,
			autosync_on_startup: false,
			sort_template: '%Artist %Title',
		},
		tags: {
			file_path: 'C:/Music/Midnight.flac',
			tag_count: 2,
			fields: { title: 'Midnight colours', artist: 'Demo artist' },
		},
		app_action: null,
	}
}
