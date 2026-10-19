// Run after npm run package. Uses the real Companion host wrapper against the
// extracted distribution. --features exercises protocol 2; --advanced includes
// advanced presets. The server is simulated; this does not test Windows/AIMP.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { x } from 'tar'
import { InstanceWrapper, registerLoggingSink } from '@companion-module/host'
import { validateNumberValue, validateDropdownValue, validateCheckboxValue } from '@companion-module/host/validate'
import { startMockWsServer } from './mock-ws-server.js'
import {
	makeFeatureFixture,
	makeMediaFixture,
	makeMusicLibraryFixture,
	makeLibraryToolsFixture,
} from './feature-fixture.js'

const featuresEnabled = process.argv.includes('--features')
const advancedPresets = process.argv.includes('--advanced')
const beta3Mode = process.argv.includes('--beta3')
const featureState = makeFeatureFixture(!beta3Mode)
const mediaState = makeMediaFixture(),
	musicState = makeMusicLibraryFixture(),
	libraryTools = makeLibraryToolsFixture()
const feedbackValues = {}
let playlistInventory = [{ id: 0, aimp_id: 'music', name: 'Music', track_count: 2 }]
const removalModel = { queue: [0, 1, 2], readOnly: false, results: [] }
const playlistProperties = {
	playlist_id: 0,
	values: { name: 'Music', grouping_override: false, format_override: false, view_override: false, view_marks: false },
	available: { name: true, grouping_override: true, format_override: true, view_override: true, view_marks: true },
}
const mediaSummary = () => {
	const { data_base64, ...artwork } = mediaState.artwork
	const { text, lines, ...lyrics } = mediaState.lyrics
	return {
		track_key: mediaState.track_key,
		artwork: { ...artwork, track_key: mediaState.track_key },
		lyrics: { ...lyrics, track_key: mediaState.track_key },
	}
}
const dir = await mkdtemp(join(tmpdir(), 'aimp-package-'))
const received = [],
	warnings = [],
	expectedCommandWarnings = [],
	values = {},
	variableIds = new Set()
let definitions = [],
	presets = {},
	feedbacks = [],
	wrapper
registerLoggingSink((source, level, message) => {
	if (level === 'warn' || level === 'error') warnings.push({ source, level, message })
})
const server = await startMockWsServer((cmd, c) => {
	received.push(cmd)
	const action = cmd.action
	const snapshot = () => ({ audio: featureState.audio, equalizer: featureState.equalizer })
	if (action === 'player/status')
		c.send({ action, event: 'status', state: 'paused', volume: 30, muted: false, duration: 100, position: 10 })
	else if (action === 'playlists/get') c.send({ action, playlists: playlistInventory })
	else if (action === 'playlists/tracks/get') {
		const count = playlistInventory.find((playlist) => playlist.id === cmd.playlist_id)?.track_count || 0
		c.send({
			action,
			playlist_id: cmd.playlist_id,
			total: count,
			tracks: Array.from({ length: count }, (_, index) => ({
				id: index,
				file_path: `C:/song${index + 1}.mp3`,
				title: ['One', 'Two', 'Three'][index],
			})),
		})
	} else if (action === 'capabilities/get')
		c.send(
			featuresEnabled
				? {
						action,
						protocol_version: 2,
						plugin_version: featureState.plugin_version,
						capabilities: featureState.capabilities,
					}
				: { action, error: { code: 'UNKNOWN_ACTION' } },
		)
	else if (featuresEnabled && action === 'extensions/get')
		c.send({ action, ...featureState, ...(!beta3Mode ? { media: mediaSummary() } : {}) })
	else if (featuresEnabled && action === 'playlists/info')
		c.send({ action, playlist: { id: 0, aimp_id: 'music', name: 'Music', track_count: 2, read_only: false } })
	else if (
		featuresEnabled &&
		['queue/remove', 'queue/clear', 'playlists/track/remove', 'playlists/clear', 'playlists/close'].includes(action)
	) {
		// This model verifies module routing and reported SDK failures, not native
		// selection semantics. The new native focused-item handling has separate tests.
		const playlist = playlistInventory[0]
		if (removalModel.readOnly && ['playlists/track/remove', 'playlists/clear'].includes(action)) {
			c.send({ action, error: { code: 'AIMP_CALL_FAILED', hresult: -2147024891 } })
		} else {
			if (action === 'queue/remove') removalModel.queue.splice(cmd.queue_index ?? removalModel.queue.indexOf(0), 1)
			if (action === 'queue/clear') removalModel.queue.length = 0
			if (action === 'playlists/track/remove') playlist.track_count--
			if (action === 'playlists/clear') playlist.track_count = 0
			if (action === 'playlists/close') playlistInventory = []
			removalModel.results.push({
				action,
				playlist: playlist.aimp_id,
				queued: removalModel.queue.length,
				tracks: playlist.track_count,
				closed: action === 'playlists/close',
			})
			c.send(
				action.startsWith('queue/')
					? { action, ok: true, queue: { count: removalModel.queue.length } }
					: { action, ok: true, library_changed: true },
			)
		}
	} else if (featuresEnabled && action === 'playlists/track/info')
		c.send({
			action,
			track: { playlist_id: 0, track_id: 0, id: 0, title: 'One', artist: 'Test Artist', file_path: 'C:/song1.mp3' },
		})
	else if (featuresEnabled && action === 'player/fileinfo')
		c.send({ action, file_info: { codec: 'FLAC', sample_rate: 44100, bit_depth: 24, channels: 2 } })
	else if (featuresEnabled && !beta3Mode && action === 'playlists/properties/get')
		c.send({ action, playlist_properties: playlistProperties })
	else if (featuresEnabled && !beta3Mode && action === 'playlists/properties/set') {
		// The SDK can reject inherited settings until their playlist override is enabled.
		if (cmd.parameter === 'view_marks' && playlistProperties.values.view_override !== true)
			c.send({ action, error: { code: 'AIMP_CALL_FAILED', hresult: -2147024809 } })
		else {
			playlistProperties.values[cmd.parameter] = cmd.value
			c.send({ action, ok: true, library_changed: true, playlist_properties: playlistProperties })
		}
	} else if (featuresEnabled && action === 'app/command') {
		featureState.last_app_command = { command: cmd.command, status: 'queued' }
		c.send({ action, acknowledgement: 'queued', last_app_command: featureState.last_app_command })
	} else if (featuresEnabled && !beta3Mode && action === 'media/get') c.send({ action, media: mediaSummary() })
	else if (featuresEnabled && !beta3Mode && action === 'media/artwork/get')
		c.send({
			action,
			media: { track_key: mediaState.track_key },
			artwork: { ...mediaState.artwork, track_key: mediaState.track_key },
		})
	else if (featuresEnabled && !beta3Mode && action === 'media/lyrics/get')
		c.send({
			action,
			media: { track_key: mediaState.track_key },
			lyrics: {
				...(cmd.include_content === false ? mediaSummary().lyrics : mediaState.lyrics),
				track_key: mediaState.track_key,
			},
		})
	else if (featuresEnabled && !beta3Mode && action === 'musiclibrary/query')
		c.send({ action, music_library: { query: { ...musicState.query, status: 'pending', rows: [] } } })
	else if (featuresEnabled && !beta3Mode && action === 'musiclibrary/query/get')
		c.send({ action, music_library: { query: musicState.query } })
	else if (featuresEnabled && !beta3Mode && action === 'musiclibrary/storage/select')
		c.send({ action, music_library: { storages: musicState.storages, active_storage: cmd.storage_id } })
	else if (featuresEnabled && !beta3Mode && action === 'musiclibrary/row/mark')
		c.send({
			action,
			acknowledgement: 'queued',
			music_library: {
				operation: { id: 'op-mark', status: 'queued', command: 'row_mark', storage_id: musicState.storage_id },
			},
		})
	else if (featuresEnabled && !beta3Mode && action === 'musiclibrary/operation/get')
		c.send({
			action,
			music_library: {
				operation: { id: 'op-mark', status: 'completed', command: 'row_mark', storage_id: musicState.storage_id },
			},
		})
	else if (
		featuresEnabled &&
		!beta3Mode &&
		['musiclibrary/row/play', 'musiclibrary/row/add', 'musiclibrary/row/queue'].includes(action)
	)
		c.send({ action, ok: true })
	else if (featuresEnabled && !beta3Mode && action === 'tags/get') c.send({ action, tags: libraryTools.tags })
	else if (featuresEnabled && !beta3Mode && action === 'tags/write') {
		assert.equal(cmd.confirm, true)
		assert.equal(cmd.expected_file_path, libraryTools.tags.file_path)
		Object.assign(libraryTools.tags.fields, cmd.fields)
		c.send({ action, tags: { ...libraryTools.tags, saved: true } })
	} else if (featuresEnabled && !beta3Mode && action === 'app/action/get')
		c.send({ action, app_action: { id: cmd.id, name: 'Test registered action', enabled: true, executable: true } })
	else if (featuresEnabled && !beta3Mode && action === 'app/action/execute')
		c.send({
			action,
			acknowledgement: 'queued',
			app_control: { ...featureState.app_control, last_action: { id: cmd.id, status: 'queued' } },
		})
	else if (featuresEnabled && !beta3Mode && action === 'skins/color/adjust') {
		featureState.skins[cmd.parameter] += cmd.delta
		c.send({ action, skins: featureState.skins })
	} else if (featuresEnabled && action === 'audio/adjust') {
		const d = featureState.capabilities.audio.find((p) => p.id === cmd.parameter)
		featureState.audio[d.id] = Math.max(
			d.min,
			Math.min(d.max, Number((featureState.audio[d.id] + cmd.delta).toFixed(4))),
		)
		c.send({ action, ...snapshot() })
	} else if (featuresEnabled && action === 'audio/reset') {
		for (const d of featureState.capabilities.audio.filter((p) => !cmd.parameter || p.id === cmd.parameter))
			featureState.audio[d.id] = d.default
		c.send({ action, ...snapshot() })
	} else if (featuresEnabled && action === 'equalizer/band/adjust') {
		const band = featureState.equalizer.bands.find((b) => b.index === cmd.band)
		band.gain = Math.max(-15, Math.min(15, band.gain + cmd.delta))
		c.send({ action, ...snapshot() })
	} else if (action === 'playlists/track/play') c.send({ action, ok: true })
	else c.send({ action, error: { code: 'UNKNOWN_ACTION' } })
})
async function waitFor(predicate, description) {
	const end = Date.now() + 5000
	while (!predicate() && Date.now() < end) await new Promise((r) => setTimeout(r, 10))
	assert.ok(predicate(), `${description}: ${JSON.stringify({ values, warnings, received })}`)
}
let executionId = 0
async function execute(actionId, options) {
	const result = await wrapper.executeAction({ id: `test-${++executionId}`, controlId: '0/0/0', actionId, options })
	assert.equal(result.success, true, `${actionId}: host refused action`)
}
// Companion core validates every declared field before calling InstanceWrapper.
// Use the same primitive validators for these literal actions, without
// default merging: the wrapper alone does not cover this execution boundary.
function parseActionOptions(actionId, options) {
	const validators = {
		number: validateNumberValue,
		dropdown: validateDropdownValue,
		checkbox: validateCheckboxValue,
	}
	const definition = definitions.find((d) => d.id === actionId)
	assert.ok(definition, `Packaged module must declare ${actionId}`)
	const parsed = {},
		errors = {}
	for (const field of definition.options) {
		if (field.type === 'static-text') continue
		const validate = validators[field.type]
		assert.ok(validate, `Add host validation for new interface field type: ${field.type}`)
		const result = validate(options[field.id], field)
		parsed[field.id] = result.sanitisedValue
		if (result.validationError && !field.allowInvalidValues) errors[field.id] = result.validationError
	}
	return { parsed, errors }
}
const parseAppCommandOptions = (options) => parseActionOptions('feature_app_command', options)
try {
	const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
	await x({ file: resolve(`ninoleto-aimp-${pkg.version}.tgz`), cwd: dir })
	const manifest = JSON.parse(await readFile(join(dir, 'ninoleto-aimp/companion/manifest.json')))
	assert.equal(manifest.id, 'ninoleto-aimp')
	assert.equal(manifest.runtime.type, 'node22')
	assert.equal(manifest.runtime.apiVersion, '2.1.3')
	const { default: Module, UpgradeScripts } = await import(
		pathToFileURL(resolve(dir, 'ninoleto-aimp/companion', manifest.runtime.entrypoint))
	)
	assert.ok(Array.isArray(UpgradeScripts) && UpgradeScripts.length > 0, 'Package must export its migration scripts')
	const host = {
		setStatus(status, message) {
			values._status = { status, message }
		},
		setActionDefinitions(d) {
			definitions = d
		},
		setFeedbackDefinitions(d) {
			feedbacks = d
		},
		setVariableDefinitions(d, v) {
			variableIds.clear()
			for (const x of d) variableIds.add(x.id)
			for (const x of v) values[x.id] = x.value
		},
		setVariableValues(v) {
			for (const x of v) values[x.id] = x.value
		},
		setPresetDefinitions(_s, p) {
			presets = p
		},
		updateFeedbackValues(items) {
			for (const item of items) feedbackValues[item.id] = item.value
		},
		saveConfig() {},
		sendOSC() {},
		recordAction() {},
		setCustomVariable() {},
		setCompositeElementDefinitions() {},
	}
	wrapper = new InstanceWrapper('aimp-test', host, Module, UpgradeScripts, manifest.runtime.apiVersion)
	await wrapper.init({
		label: 'AIMPCustom',
		isFirstInit: false,
		config: { host: '127.0.0.1', port: server.port, advancedPresets },
		secrets: undefined,
		lastUpgradeIndex: -1,
	})
	await waitFor(() => values.library_status === 'Library ready', 'Library did not load')
	await waitFor(() => received.some((cmd) => cmd.action === 'capabilities/get'), 'Capability discovery did not run')
	assert.equal(values.connected, true)
	const fields = await wrapper.getConfigFields()
	assert.ok(fields.some((f) => f.id === 'host'))
	assert.ok(definitions.find((a) => a.id === 'track_browse'))
	assert.ok(presets.rotary_volume_1.steps[0].rotate_left.length)
	assert.ok(presets.display_elapsed.elements.find((e) => e.id === 'label').text.includes('$(AIMPCustom:position_fmt)'))
	await execute('track_browse', { track: JSON.stringify(['music', 'C:/song2.mp3']), action: 'play' })
	assert.ok(received.some((c) => c.action === 'playlists/track/play' && c.track_id === 1))
	if (featuresEnabled) {
		await waitFor(
			() =>
				values.audio_pitch === featureState.audio.pitch && Object.keys(presets).some((id) => id.startsWith('feature_')),
			'Feature catalog did not load',
		)
		// A beta.4 preset displayed param's default as zero but never stored it.
		assert.deepEqual(parseAppCommandOptions({ command: 'about' }).errors, { param: 'A value must be provided' })
		const oldAbout = {
			id: 'old-about',
			controlId: '39/2/6',
			actionId: 'feature_app_command',
			upgradeIndex: -1,
			options: { command: { isExpression: false, value: 'about' } },
		}
		const expressionAbout = {
			...oldAbout,
			id: 'expression-about',
			options: {
				command: { isExpression: true, value: '"about"' },
				param: { isExpression: true, value: '1 + 1' },
			},
		}
		const upgraded = await wrapper.upgradeActionsAndFeedbacks(-1, [oldAbout, expressionAbout], [])
		assert.equal(upgraded.latestUpgradeIndex, UpgradeScripts.length - 1)
		const migratedAbout = upgraded.updatedActions.find((action) => action.id === oldAbout.id)
		assert.deepEqual(migratedAbout.options, {
			command: { isExpression: false, value: 'about' },
			param: { isExpression: false, value: 0 },
			confirm: { isExpression: false, value: false },
		})
		const migratedExpression = upgraded.updatedActions.find((action) => action.id === expressionAbout.id)
		assert.deepEqual(migratedExpression.options.command, expressionAbout.options.command)
		assert.deepEqual(migratedExpression.options.param, expressionAbout.options.param)
		assert.deepEqual(migratedExpression.options.confirm, { isExpression: false, value: false })
		const migratedLiteralOptions = Object.fromEntries(
			Object.entries(migratedAbout.options).map(([id, option]) => {
				assert.equal(option.isExpression, false)
				return [id, option.value]
			}),
		)
		const migratedParsed = parseAppCommandOptions(migratedLiteralOptions)
		assert.deepEqual(migratedParsed.errors, {})
		assert.equal(migratedParsed.parsed.param, 0)
		await execute(migratedAbout.actionId, migratedParsed.parsed)
		const aboutPreset = presets.feature_app_command_about.steps[0].down[0]
		assert.deepEqual(aboutPreset.options, { command: 'about', confirm: false, param: 0 })
		const presetParsed = parseAppCommandOptions(aboutPreset.options)
		assert.deepEqual(presetParsed.errors, {})
		await execute(aboutPreset.actionId, presetParsed.parsed)
		assert.deepEqual(
			received.filter((cmd) => cmd.action === 'app/command'),
			[
				{ action: 'app/command', command: 'about' },
				{ action: 'app/command', command: 'about' },
			],
			'Migrated and new About buttons must send the exact native command without unused param or confirm',
		)
		assert.equal(values.last_app_command, 'about')
		assert.equal(values.last_app_command_status, 'queued')
		assert.equal(values.last_app_command_error, '')
		assert.equal(values.last_app_command_hresult, '')
		for (const [presetId, variable, expected] of [
			['feature_playlist_info', 'playlist_info_summary', 'Music\n2 tracks'],
			['feature_track_info', 'track_info_summary', 'One\nTest Artist'],
			['feature_file_info', 'file_info_summary', 'FLAC\n44.1 kHz / 24-bit'],
		]) {
			assert.equal(values[variable], 'Press to read')
			const action = presets[presetId].steps[0].down[0]
			const parsed = parseActionOptions(action.actionId, action.options)
			assert.deepEqual(parsed.errors, {})
			await execute(action.actionId, parsed.parsed)
			assert.equal(values[variable], expected, `${presetId}: successful callback must publish native reply data`)
		}
		const pitchBefore = featureState.audio.pitch
		await Promise.all(Array.from({ length: 10 }, () => execute('pitch_adjust', { delta: 0.1 })))
		await waitFor(
			() => values.audio_pitch === Number((pitchBefore + 1).toFixed(4)),
			'Rapid pitch rotary actions lost increments',
		)
		assert.equal(received.filter((c) => c.action === 'audio/adjust' && c.parameter === 'pitch').length, 10)
		await execute('pitch_reset', {})
		assert.equal(values.audio_pitch, 0)
		await execute('feature_eq_band_adjust', { band: 0, delta: 0.5 })
		assert.equal(values.eq_band_0, 0.5)
		assert.equal(values.last_command_error, '')
		assert.ok(definitions.some((d) => d.id === 'feature_playlist_add'))
		assert.ok(definitions.some((d) => d.id === 'feature_player_auto_crossfade_ms'))
		assert.ok(feedbacks.some((d) => d.id === 'feature_audio_active'))
		assert.ok(variableIds.has('audio_pitch_fmt'))
		assert.ok(variableIds.has('eq_band_19'))
		assert.ok(variableIds.has('app_option_stay_on_top_fmt'))
		if (!beta3Mode) {
			const propertyAction = 'feature_playlist_property_view_marks'
			const propertyOptions = { target: 'active', playlistId: 'music', value: true }
			const propertyParsed = parseActionOptions(propertyAction, propertyOptions)
			assert.deepEqual(propertyParsed.errors, {})
			const propertyStart = received.length
			await execute(propertyAction, propertyParsed.parsed)
			const writes = received.slice(propertyStart).filter((cmd) => cmd.action === 'playlists/properties/set')
			assert.deepEqual(writes, [
				{
					action: 'playlists/properties/set',
					target: 'explicit',
					playlist_id: 0,
					parameter: 'view_override',
					value: true,
				},
				{
					action: 'playlists/properties/set',
					target: 'explicit',
					playlist_id: 0,
					parameter: 'view_marks',
					value: true,
				},
			])
			assert.equal(playlistProperties.values.view_marks, true, 'Native-shaped server must apply the requested setting')
			assert.deepEqual(JSON.parse(values.last_response).playlist_properties, playlistProperties)
			assert.equal(values.last_command_error, '')
			const readProperties = parseActionOptions('feature_playlist_properties_get', {
				target: 'active',
				playlistId: 'music',
			})
			assert.deepEqual(readProperties.errors, {})
			await execute('feature_playlist_properties_get', readProperties.parsed)
			assert.equal(values.playlist_properties_summary, '5 properties\n1 custom / 2 inherited')
			await waitFor(
				() => values.artwork_status === 'ready' && values.lyrics_current === mediaState.lyrics.current.text,
				'Artwork / lyrics did not load',
			)
			await wrapper.updateFeedbacks({
				artwork: { id: 'artwork', controlId: '0/0/1', feedbackId: 'feature_artwork', options: {} },
			})
			await waitFor(
				() => String(feedbackValues.artwork).startsWith('data:image/png;base64,'),
				'Artwork value feedback did not publish image',
			)
			assert.ok(Object.values(presets).some((p) => p.localVariables?.some((v) => v.feedbackId === 'feature_artwork')))
			await execute('feature_ml_storage_select', { storage_id: musicState.storage_id })
			assert.equal(values.ml_active_storage, musicState.storage_id)
			await execute('feature_ml_search', { storage_id: musicState.storage_id, search: '', limit: 20 })
			await waitFor(
				() => values.ml_status === 'complete' && values.ml_row_2_title === musicState.query.rows[1].title,
				'Music-library async page did not load',
			)
			await execute('feature_ml_select_row', { index: 1 })
			await execute('feature_ml_play', { row_id: '__selected__' })
			assert.ok(
				received.some(
					(c) =>
						c.action === 'musiclibrary/row/play' &&
						c.row_id === musicState.query.rows[1].row_id &&
						c.query_id === musicState.query.id,
				),
			)
			await execute('feature_ml_row_mark', { value: 3.5 })
			assert.ok(
				received.some(
					(c) =>
						c.action === 'musiclibrary/row/mark' && c.value === 3.5 && c.row_id === musicState.query.rows[1].row_id,
				),
			)
			const originalRowIds = musicState.query.rows.map((row) => row.row_id)
			const originalQueryId = musicState.query.id
			Object.assign(musicState.query.rows[0], {
				title: '  ',
				artist: '',
				album: '',
				file_path: 'D:\\Music\\Untitled Recording.flac',
				values: {},
			})
			Object.assign(musicState.query.rows[1], { title: '', artist: '', album: '', file_path: '', values: {} })
			musicState.query.offset = 20
			await execute('feature_ml_search', { storage_id: musicState.storage_id, search: '', limit: 20 })
			await waitFor(
				() =>
					values.ml_status === 'complete' &&
					values.ml_row_1_title === 'Untitled Recording.flac' &&
					values.ml_row_2_title === 'Result 22',
				'Packaged music-library fallback labels did not reach host variables',
			)
			assert.equal(values.ml_row_1_artist, '')
			assert.equal(values.ml_row_2_artist, '')
			assert.ok(
				presets.feature_ml_row_0.elements
					.find((element) => element.id === 'label')
					.text.includes('$(AIMPCustom:ml_row_1_title)'),
			)
			assert.ok(
				presets.feature_ml_row_1.elements
					.find((element) => element.id === 'label')
					.text.includes('$(AIMPCustom:ml_row_2_title)'),
			)
			const fallbackPlayStart = received.length
			for (const index of [0, 1]) {
				await execute('feature_ml_select_row', { index })
				assert.equal(values.ml_selected_title, values[`ml_row_${index + 1}_title`])
				assert.equal(values.ml_selected_artist, '')
				assert.equal(values.ml_selected_path, musicState.query.rows[index].file_path)
				await execute('feature_ml_play', { row_id: '__selected__' })
			}
			assert.deepEqual(
				received.slice(fallbackPlayStart).filter((command) => command.action === 'musiclibrary/row/play'),
				originalRowIds.map((row_id) => ({ action: 'musiclibrary/row/play', query_id: originalQueryId, row_id })),
				'Fallback labels must not change query or provider row identities used for playback',
			)
			await execute('feature_tags_write', {
				target: 'focused',
				playlistId: 'music',
				trackId: 0,
				field: 'title',
				value: 'Verified tag',
				confirm: true,
			})
			assert.equal(libraryTools.tags.fields.title, 'Verified tag')
			await execute('feature_app_action_execute', { id: 'test.registered.action' })
			assert.equal(values.app_registered_action_status, 'queued')
			const beforeHue = featureState.skins.hue
			await execute('feature_skin_color_adjust', { parameter: 'hue', delta: 1 })
			assert.equal(values.skin_hue, beforeHue + 1)
			assert.equal(values.last_command_error, '')
		} else assert.ok(!definitions.some((d) => d.id === 'feature_ml_search'))
	} else {
		assert.equal(values.last_command_error, '')
		assert.ok(!definitions.some((d) => d.id === 'pitch_adjust'))
		assert.match(values.feature_status, /Upgrade the AIMP plugin/)
	}
	const presetsWithTwoTracks = Object.keys(presets).length
	if (featuresEnabled && advancedPresets) {
		const cases = [
			['feature_queue_remove_track', { action: 'queue/remove', target: 'focused' }],
			['feature_queue_remove', { action: 'queue/remove', queue_index: 0 }],
			['feature_queue_clear', { action: 'queue/clear' }],
			['feature_track_remove', { action: 'playlists/track/remove', target: 'focused' }],
			['feature_playlist_clear', { action: 'playlists/clear', target: 'active' }],
			['feature_playlist_close', { action: 'playlists/close', target: 'active' }],
		]
		// These simulate already placed buttons: saved options must not be rebuilt
		// when Companion receives an inventory with different playlist identities.
		const saved = cases.map(([id]) => structuredClone(presets[id].steps[0].down[0]))
		assert.equal(saved.filter((action) => action.options.playlistId === 'music').length, 4)
		playlistInventory = [{ id: 0, aimp_id: 'replacement', name: 'Replacement', track_count: 3 }]
		await execute('refresh_library', {})
		await waitFor(
			() =>
				definitions
					.find((definition) => definition.id === 'feature_playlist_clear')
					.options.find((field) => field.id === 'playlistId')
					.choices.some((choice) => choice.id === 'replacement'),
			'Replacement playlist did not reach host action definitions',
		)
		const parsedSaved = saved.map((action) => {
			const parsed = parseActionOptions(action.actionId, action.options)
			assert.deepEqual(parsed.errors, {}, `${action.actionId}: stale unused playlist ID blocked a placed button`)
			return { ...action, options: parsed.parsed }
		})
		const clear = parsedSaved.find((action) => action.actionId === 'feature_playlist_clear')
		removalModel.readOnly = true
		const warningStart = warnings.length
		const readOnlyStart = received.length
		await execute(clear.actionId, clear.options)
		assert.deepEqual(
			received.slice(readOnlyStart).filter((command) => command.action === 'playlists/clear'),
			[{ action: 'playlists/clear', target: 'active' }],
		)
		assert.equal(playlistInventory[0].track_count, 3, 'Simulated read-only failure must leave entries untouched')
		assert.match(values.last_command_error, /playlists\/clear: AIMP_CALL_FAILED.*0x80070005/)
		const reportedFailures = warnings.slice(warningStart)
		assert.ok(reportedFailures.length > 0)
		assert.ok(
			reportedFailures.every((warning) =>
				String(warning.message).includes('playlists/clear: AIMP_CALL_FAILED (HRESULT 0x80070005)'),
			),
		)
		expectedCommandWarnings.push(...reportedFailures)
		removalModel.readOnly = false
		const removeStart = received.length
		for (const action of parsedSaved) await execute(action.actionId, action.options)
		assert.deepEqual(
			received
				.slice(removeStart)
				.filter((command) =>
					['queue/remove', 'queue/clear', 'playlists/track/remove', 'playlists/clear', 'playlists/close'].includes(
						command.action,
					),
				),
			cases.map(([, packet]) => packet),
			'All six saved remove buttons must send their own exact requests after the original playlist disappears',
		)
		assert.deepEqual(removalModel.results, [
			{ action: 'queue/remove', playlist: 'replacement', queued: 2, tracks: 3, closed: false },
			{ action: 'queue/remove', playlist: 'replacement', queued: 1, tracks: 3, closed: false },
			{ action: 'queue/clear', playlist: 'replacement', queued: 0, tracks: 3, closed: false },
			{ action: 'playlists/track/remove', playlist: 'replacement', queued: 0, tracks: 2, closed: false },
			{ action: 'playlists/clear', playlist: 'replacement', queued: 0, tracks: 0, closed: false },
			{ action: 'playlists/close', playlist: 'replacement', queued: 0, tracks: 0, closed: true },
		])
		assert.equal(values.last_command_error, '')
	}
	assert.deepEqual(warnings, expectedCommandWarnings, 'Unexpected Companion host warning or command failure')
	console.log(
		JSON.stringify({
			package: manifest.version,
			features: featuresEnabled,
			beta3Compatibility: beta3Mode,
			advancedPresets,
			api: manifest.runtime.apiVersion,
			actions: definitions.length,
			feedbacks: feedbacks.length,
			presetsWithTwoTracks,
			variables: variableIds.size,
			hostWarnings: warnings.length - expectedCommandWarnings.length,
			expectedCommandWarnings: expectedCommandWarnings.length,
			packagedActionExecuted: true,
			packagedUpgradeScriptsExported: true,
			packagedAboutMigrationAndPresetValidated: featuresEnabled,
			packagedAboutCommandsExecuted: featuresEnabled,
			packagedInspectionSummariesExecuted: featuresEnabled,
			packagedPlaylistOverrideAndReadbackExecuted: featuresEnabled && !beta3Mode,
			packagedMusicLibraryFallbackLabelsAndPlaybackExecuted: featuresEnabled && !beta3Mode,
			packagedStaleRemovePresetsAndReadOnlyFailureExecuted: featuresEnabled && advancedPresets,
			pitchAndEqActionsExecuted: featuresEnabled,
			beta4MediaAndLibraryExecuted: featuresEnabled && !beta3Mode,
		}),
	)
} finally {
	await wrapper?.destroy()
	await server.close()
	await rm(dir, { recursive: true, force: true })
}
