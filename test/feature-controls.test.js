import test from 'node:test'
import assert from 'node:assert/strict'
import {
	initialFeatureState,
	applyFeatureMessage,
	featureCatalog,
	getFeatureActions,
	getFeatureFeedbacks,
	getFeatureVariableDefinitions,
	getFeatureVariableValues,
} from '../src/feature-controls.js'

function fixture() {
	const calls = []
	const instance = {
		features: initialFeatureState(),
		state: { connected: true },
		calls,
		playlistChoices: [{ id: 'playlist-guid', label: 'Music' }],
		currentPlaylistIndex: 3,
		_playlistIndex(id) {
			return id === 'playlist-guid' ? this.currentPlaylistIndex : undefined
		},
		async _send(command, params) {
			calls.push([command, params])
			const replies = {
				'player/options/get': { player_options: { auto_transition: false, auto_pause_ms: 200 } },
				'app/options/get': { app_options: { stay_on_top: true } },
				'recording/get': { recording: { enabled: false } },
				'queue/get': { queue: { suspended: true, count: 2 } },
			}
			return replies[command] || { action: command, ok: true }
		},
	}
	applyFeatureMessage(instance, {
		protocol_version: 2,
		plugin_version: '0.2.0',
		capabilities: {
			audio: [
				{
					id: 'pitch',
					label: 'Pitch',
					min: -10,
					max: 10,
					default: 0,
					step: 0.1,
					unit: '',
					type: 'number',
					supported: true,
				},
				{
					id: 'speed',
					label: 'Speed',
					min: 0.5,
					max: 1.5,
					default: 1,
					step: 0.01,
					unit: 'x',
					type: 'number',
					supported: true,
				},
				{
					id: 'tempo',
					label: 'Tempo',
					min: 0.8,
					max: 1.5,
					default: 1,
					step: 0.01,
					unit: 'x',
					type: 'number',
					supported: false,
				},
				{ id: 'equalizer_auto', label: 'Auto EQ', default: false, type: 'boolean', supported: true },
			],
			equalizer: {
				available: true,
				band_count: 2,
				min: -15,
				max: 15,
				step: 0.5,
				preamp: { min: -15, max: 15, default: 0, step: 0.5, unit: 'dB' },
			},
			player_options: {
				auto_transition: { label: 'Auto transition', type: 'boolean', available: true },
				auto_pause_ms: { label: 'Pause', type: 'integer', min: 0, max: 5000, unit: 'ms', available: true },
				action_on_end_of_track: {
					label: 'Track ending',
					type: 'enum',
					choices: [
						{ id: 0, label: 'Continue' },
						{ id: 1, label: 'Stop' },
					],
					available: true,
				},
				unsupported: { label: 'Not provided by AIMP', type: 'boolean', available: false },
			},
			app_options: { stay_on_top: { label: 'Always on top', type: 'boolean', available: true } },
			app_commands: {
				options: { label: 'Preferences', available: true },
				dsp_manager: { label: 'DSP manager', available: true, param_min: 0, param_max: 3 },
			},
			recording: { available: true },
			loop: { available: true, range: true, cycle: true },
			output: { available: true, list: true },
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
					'playlists/create',
					'playlists/rename',
					'playlists/close',
					'playlists/add',
					'playlists/clear',
					'playlists/sort',
					'playlists/info',
					'playlists/track/remove',
					'playlists/track/move',
					'playlists/track/enabled',
					'playlists/track/rating',
					'playlists/track/info',
					'player/fileinfo',
				],
				sort_modes: [
					{ id: 'title', label: 'Title' },
					{ id: 'reverse', label: 'Reverse' },
				],
				rating: { min: 0, max: 5, step: 0.5 },
				limits: { queue_page: 250 },
			},
		},
	})
	applyFeatureMessage(instance, {
		audio: { pitch: 0.5, speed: 1, equalizer_auto: true },
		equalizer: {
			available: true,
			enabled: true,
			preamp: -1,
			bands: [
				{ index: 0, frequency: 100, gain: 0 },
				{ index: 1, frequency: 10000, gain: 1.5 },
			],
			presets: ['Rock', 'Vocal'],
			preset: 'Rock',
		},
		player_options: { auto_transition: true, auto_pause_ms: 200, action_on_end_of_track: 1 },
		app_options: { stay_on_top: true },
		recording: { enabled: false },
		loop: { stage: 2, a: 3, b: 10 },
		output: { current: 'device:1', devices: [{ id: 'device:1', name: 'Speakers' }] },
		queue: { count: 2, suspended: false },
	})
	return instance
}
const run = (instance, id, options = {}) => getFeatureActions(instance)[id].callback({ options })

test('discovered catalog hides unsupported controls and preserves old plugin operation', () => {
	const instance = fixture(),
		actions = getFeatureActions(instance)
	assert.ok(actions.pitch_adjust)
	assert.ok(actions.feature_player_action_on_end_of_track)
	assert.equal(actions.tempo_adjust, undefined)
	assert.equal(actions.feature_player_unsupported, undefined)
	assert.deepEqual(
		featureCatalog(instance, 'app_options').map((d) => d.id),
		['stay_on_top'],
	)
	instance.features = initialFeatureState()
	assert.deepEqual(getFeatureActions(instance), {})
	assert.match(getFeatureVariableValues(instance).feature_status, /Upgrade the AIMP plugin/)
	assert.equal(getFeatureVariableValues(instance).eq_preamp, '')
})

test('audio rotary adjustments are atomic bridge commands, resets are neutral, and invalid input sends nothing', async () => {
	const instance = fixture()
	await run(instance, 'pitch_adjust', { delta: -0.1 })
	await run(instance, 'speed_reset')
	await run(instance, 'feature_audio_boolean', { parameter: 'equalizer_auto', mode: 'toggle' })
	assert.deepEqual(instance.calls, [
		['audio/adjust', { parameter: 'pitch', delta: -0.1 }],
		['audio/reset', { parameter: 'speed' }],
		['audio/toggle', { parameter: 'equalizer_auto' }],
	])
	await assert.rejects(run(instance, 'pitch_set', { value: 11 }), /between/)
	await assert.rejects(run(instance, 'feature_audio_set', { parameter: 'tempo', value: 1.2 }), /unavailable/)
	await assert.rejects(run(instance, 'pitch_set', { value: null }), /numeric/)
	assert.equal(instance.calls.length, 3)
	const stale = getFeatureActions(instance).pitch_adjust
	instance.features = initialFeatureState()
	await assert.rejects(stale.callback({ options: { delta: 0.1 } }), /unavailable/)
	assert.equal(instance.calls.length, 3)
})

test('authoritative audio/EQ snapshots clear failed reads and partial failure responses retain actual values', () => {
	const instance = fixture()
	assert.equal(
		applyFeatureMessage(instance, {
			audio: { pitch: 1 },
			equalizer: { available: true, enabled: true, bands: [{ index: 1, frequency: 10000, gain: 0 }], presets: [] },
			error: { code: 'PARTIALLY_FAILED' },
		}),
		true,
	)
	assert.deepEqual(instance.features.audio, { pitch: 1 })
	assert.equal(instance.features.equalizer.preamp, null)
	assert.equal(instance.features.equalizer.bands.length, 1)
	assert.equal(instance.features.recording.enabled, false)
	assert.equal(applyFeatureMessage(instance, { action: 'player/status', state: 'playing', volume: 50 }), false)
	assert.equal(
		applyFeatureMessage(instance, { last_app_command: { command: 'options', status: 'failed', hresult: -1 } }),
		true,
	)
	assert.equal(getFeatureVariableValues(instance).last_app_command_status, 'failed')
})

test('EQ uses enumerated bands/presets and native atomic preamp and band adjustments', async () => {
	const instance = fixture()
	await run(instance, 'feature_eq_band_adjust', { band: 1, delta: 0.5 })
	await run(instance, 'feature_eq_preamp_adjust', { delta: -0.5 })
	await run(instance, 'feature_eq_enabled', { mode: 'toggle' })
	await run(instance, 'feature_eq_preset', { name: 'Vocal' })
	assert.deepEqual(instance.calls, [
		['equalizer/band/adjust', { band: 1, delta: 0.5 }],
		['equalizer/preamp/adjust', { delta: -0.5 }],
		['equalizer/toggle', undefined],
		['equalizer/preset/apply', { name: 'Vocal' }],
	])
	await assert.rejects(run(instance, 'feature_eq_band_set', { band: 2, value: 1 }), /between/)
	await assert.rejects(run(instance, 'feature_eq_preset', { name: 'Not enumerated' }), /no longer available/)
	assert.equal(instance.calls.length, 4)
})

test('new EQ presets never overwrite existing names and direct file playback requires an explicit URI', async () => {
	const instance = fixture()
	instance.features.capabilities.equalizer.preset_save = true
	instance.features.capabilities.library.commands.push('player/play-file')
	await run(instance, 'feature_eq_preset_save', { name: 'New custom curve' })
	await run(instance, 'feature_play_file', { uri: 'C:\\Music\\track.flac' })
	assert.deepEqual(instance.calls, [
		['equalizer/preset/save', { name: 'New custom curve' }],
		['player/play-file', { uri: 'C:\\Music\\track.flac' }],
	])
	await assert.rejects(run(instance, 'feature_eq_preset_save', { name: 'Rock' }), /already exists/)
	await assert.rejects(run(instance, 'feature_eq_preset_save', { name: 'é'.repeat(257) }), /512/)
	await assert.rejects(run(instance, 'feature_play_file', { uri: '' }), /empty/)
	assert.equal(instance.calls.length, 2)
})

test('option toggles read authoritative state, enums are constrained, and integer adjustments clamp to supported limits', async () => {
	const instance = fixture()
	await run(instance, 'feature_player_auto_transition', { mode: 'toggle' })
	await run(instance, 'feature_player_auto_pause_ms', { operation: 'adjust', value: -400 })
	await run(instance, 'feature_player_action_on_end_of_track', { value: '1' })
	assert.deepEqual(instance.calls, [
		['player/options/get', undefined],
		['player/options/set', { parameter: 'auto_transition', value: true }],
		['player/options/get', undefined],
		['player/options/set', { parameter: 'auto_pause_ms', value: 0 }],
		['player/options/set', { parameter: 'action_on_end_of_track', value: 1 }],
	])
	await assert.rejects(run(instance, 'feature_player_auto_pause_ms', { operation: 'set', value: 0.5 }), /integer/)
	await assert.rejects(run(instance, 'feature_player_action_on_end_of_track', { value: 999 }), /supported/)
	assert.equal(instance.calls.length, 5)
})

test('UI commands are enumerated and output devices must still exist at execution', async () => {
	const instance = fixture()
	await run(instance, 'feature_app_command', { command: 'dsp_manager', param: 2 })
	await run(instance, 'feature_app_command', { command: 'options', param: 3 })
	await run(instance, 'feature_output_set', { id: 'device:1' })
	assert.deepEqual(instance.calls, [
		['app/command', { command: 'dsp_manager', param: 2 }],
		['app/command', { command: 'options' }],
		['output/set', { id: 'device:1' }],
	])
	await assert.rejects(run(instance, 'feature_app_command', { command: 'shell', param: 0 }), /unavailable/)
	const stale = getFeatureActions(instance).feature_output_set
	instance.features.output.devices = []
	await assert.rejects(stale.callback({ options: { id: 'device:1' } }), /no longer available/)
	assert.equal(instance.calls.length, 3)
})

test('library editing resolves playlist GUID at execution and preserves native focused/playing target semantics', async () => {
	const instance = fixture()
	const rename = getFeatureActions(instance).feature_playlist_rename
	instance.currentPlaylistIndex = 7
	await rename.callback({ options: { target: 'explicit', playlistId: 'playlist-guid', name: 'Music renamed' } })
	await run(instance, 'feature_queue_add', { target: 'playing', first: true })
	await run(instance, 'feature_track_rating', { target: 'focused', rating: 4.5 })
	await run(instance, 'feature_playlist_add', {
		target: 'explicit',
		playlistId: 'playlist-guid',
		uri: 'C:\\Music\\track.flac',
		position: -1,
	})
	assert.deepEqual(instance.calls, [
		['playlists/rename', { target: 'explicit', playlist_id: 7, name: 'Music renamed' }],
		['queue/add', { target: 'playing', first: true }],
		['playlists/track/rating', { target: 'focused', value: 4.5 }],
		['playlists/add', { target: 'explicit', playlist_id: 7, uri: 'C:\\Music\\track.flac', insert_at: -1 }],
	])
	await assert.rejects(
		run(instance, 'feature_track_move', { target: 'explicit', playlistId: 'missing', trackId: 0, destination: 1 }),
		/Playlist not found/,
	)
	await assert.rejects(run(instance, 'feature_playlist_sort', { target: 'active', mode: 'unsupported' }), /supported/)
	await assert.rejects(run(instance, 'feature_playlist_add', { target: 'active', uri: '', position: -1 }), /empty/)
	assert.equal(instance.calls.length, 4)
})

test('recording/queue toggles avoid stale state and loop rejects invalid ranges', async () => {
	const instance = fixture()
	await run(instance, 'feature_recording', { mode: 'toggle' })
	await run(instance, 'feature_queue_suspended', { mode: 'toggle' })
	await run(instance, 'feature_loop_clear')
	assert.deepEqual(instance.calls, [
		['recording/get', undefined],
		['recording/set', { enabled: true }],
		['queue/get', undefined],
		['queue/suspended', { value: false }],
		['loop/set', { a: null, b: null }],
	])
	await assert.rejects(run(instance, 'feature_loop_set', { a: 10, b: 5 }), /later/)
	assert.equal(instance.calls.length, 5)
})

test('all exposed feature variables have definitions, units are preserved, and disconnected feedback is false', () => {
	const instance = fixture(),
		defs = getFeatureVariableDefinitions(instance),
		values = getFeatureVariableValues(instance)
	assert.deepEqual(Object.keys(values).sort(), Object.keys(defs).sort())
	assert.equal(values.audio_speed_fmt, '1×')
	assert.equal(values.eq_band_1_fmt, '1.5 dB')
	assert.equal(values.player_option_action_on_end_of_track_fmt, 'Stop')
	assert.equal(values.app_option_stay_on_top_fmt, 'ON')
	const feedbacks = getFeatureFeedbacks(instance)
	assert.equal(feedbacks.feature_audio_active.callback({ options: { parameter: 'speed' } }), false)
	assert.equal(feedbacks.feature_audio_active.callback({ options: { parameter: 'pitch' } }), true)
	assert.equal(feedbacks.feature_eq_band_active.callback({ options: { band: 1 } }), true)
	assert.equal(feedbacks.feature_queue_has_items.callback({ options: {} }), true)
	instance.state.connected = false
	for (const [id, fb] of Object.entries(feedbacks).filter(([, fb]) => fb.type === 'boolean'))
		assert.equal(fb.callback({ options: Object.fromEntries(fb.options.map((o) => [o.id, o.default])) }), false, id)
	assert.equal(getFeatureVariableValues(instance).eq_preamp, '')
	assert.equal(getFeatureVariableValues(instance).audio_pitch, '')
})
