import test from 'node:test'
import assert from 'node:assert/strict'
import AimpControl from '../src/main.js'
import { createMockContext } from './context.js'
import { startMockWsServer } from './mock-ws-server.js'
import {
	initialFeatureState,
	getFeatureActions,
	getFeatureFeedbacks,
	getFeatureVariableValues,
	getFeatureVariableDefinitions,
} from '../src/feature-controls.js'
import { initializeMedia, applyMediaMessage, refreshMedia, stopMedia } from '../src/media-controls.js'
import {
	initializeMusicLibrary,
	applyMusicLibraryMessage,
	queryMusicLibrary,
	stopMusicLibrary,
} from '../src/sdk-library.js'
import { initialLibraryToolsState, applyLibraryToolsMessage } from '../src/library-tools.js'

export const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII='
const cap = {
	media: {
		artwork: true,
		lyrics: true,
		synchronized_lyrics: true,
		max_artwork_bytes: 262144,
		max_artwork_dimension: 144,
	},
	music_library: {
		available: true,
		commands: [
			'musiclibrary/storages/get',
			'musiclibrary/fields/get',
			'musiclibrary/query',
			'musiclibrary/query/get',
			'musiclibrary/query/cancel',
			'musiclibrary/row/play',
			'musiclibrary/row/add',
			'musiclibrary/row/queue',
		],
		storages: [{ id: 'local', name: 'Local library', can_query: true, paging: 'cursor' }],
	},
	library: {
		available: true,
		commands: ['playlists/track/copy-to', 'playlists/selection/set', 'playlists/source/create'],
		source_types: [{ id: 'folders', label: 'Folders' }],
	},
	tags: {
		available: true,
		fields: [
			{ id: 'title', label: 'Title', type: 'string', max_length: 4096 },
			{ id: 'year', label: 'Year', type: 'integer', min: 0, max: 9999 },
		],
	},
	app_control: {
		notifications: true,
		action_lookup: true,
		action_execute: true,
		quit: true,
		windows: [{ id: 'main', available: true }],
	},
	skins: {
		available: true,
		selection: true,
		color: { hue: { available: true, min: 0, max: 255 }, intensity: { available: true, min: 0, max: 100 } },
	},
}
function fixture() {
	const calls = []
	const i = {
		features: { ...initialFeatureState(), capabilities: structuredClone(cap) },
		state: { connected: true, playerState: 'paused' },
		config: { autoMedia: false },
		_epoch: 1,
		_publish() {},
		_register() {},
		playlistChoices: [{ id: 'music', label: 'Music' }],
		_playlistIndex: (id) => (id === 'music' ? 4 : undefined),
		libraryTools: initialLibraryToolsState(),
		calls,
	}
	initializeMedia(i)
	initializeMusicLibrary(i)
	i._send = async (action, params) => {
		calls.push([action, params])
		return { action, ok: true }
	}
	return i
}
const action = (i, id, options) => getFeatureActions(i)[id].callback({ options })
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(fn, limit = 2500) {
	const end = Date.now() + limit
	while (!fn() && Date.now() < end) await wait(10)
	assert.ok(fn(), 'condition timed out')
}

test('artwork responses are keyed to the current track, cached, bounded and returned through a value feedback', () => {
	const i = fixture()
	applyMediaMessage(i, { action: 'media/get', media: { track_key: 'track-A' } })
	applyMediaMessage(i, {
		action: 'media/artwork/get',
		media: { track_key: 'track-A' },
		artwork: { track_key: 'track-A', status: 'ready', revision: 1, mime: 'image/png', data_base64: png },
	})
	assert.equal(getFeatureFeedbacks(i).feature_artwork.callback(), `data:image/png;base64,${png}`)
	applyMediaMessage(i, { action: 'extensions/get', media: { track_key: 'track-B' } })
	assert.equal(getFeatureFeedbacks(i).feature_artwork.callback(), '')
	applyMediaMessage(i, {
		action: 'media/artwork/get',
		media: { track_key: 'track-A' },
		artwork: { track_key: 'track-A', status: 'ready', mime: 'image/png', data_base64: png },
	})
	assert.equal(i.mediaState.track_key, 'track-B')
	assert.equal(getFeatureFeedbacks(i).feature_artwork.callback(), '')
	applyMediaMessage(i, {
		action: 'extensions/get',
		media: { track_key: 'track-A', artwork: { status: 'idle', revision: 0 } },
	})
	assert.equal(getFeatureFeedbacks(i).feature_artwork.callback(), `data:image/png;base64,${png}`)
	applyMediaMessage(i, {
		action: 'media/artwork/get',
		artwork: { track_key: 'track-A', status: 'ready', mime: 'image/jpeg', data_base64: png },
	})
	assert.equal(i.mediaState.artwork.status, 'error')
	assert.equal(getFeatureFeedbacks(i).feature_artwork.callback(), '')
	stopMedia(i)
})

test('lightweight ready summaries still fetch image/lyrics content once and plain lyrics have readable variables', async () => {
	const i = fixture()
	i._ws = {
		isOpen: true,
		send: async (action, params) => {
			i.calls.push([action, params])
			const result =
				action === 'media/artwork/get'
					? { action, artwork: { track_key: 'A', status: 'ready', mime: 'image/png', data_base64: png } }
					: {
							action,
							lyrics: {
								track_key: 'A',
								status: 'ready',
								type: 'plain',
								text: '\nFirst lyric\nSecond lyric',
								lines: [],
								line_count: 2,
							},
						}
			applyMediaMessage(i, result)
			return result
		},
	}
	applyMediaMessage(i, {
		action: 'extensions/get',
		media: {
			track_key: 'A',
			artwork: { status: 'ready', revision: 1 },
			lyrics: { status: 'ready', type: 'plain', revision: 1 },
		},
	})
	await refreshMedia(i, false)
	await refreshMedia(i, false)
	assert.equal(i.calls.length, 2)
	assert.equal(getFeatureVariableValues(i).lyrics_current, 'First lyric')
	assert.match(getFeatureVariableValues(i).lyrics_excerpt, /Second lyric/)
	assert.equal(JSON.stringify(getFeatureVariableValues(i)).includes(png), false)
	stopMedia(i)
})

test('AIMP loading errors are retried before capability discovery and do not disable legacy controls', async (t) => {
	let statusCalls = 0
	const server = await startMockWsServer((cmd, c) => {
		if (cmd.action === 'player/status')
			return c.send(
				++statusCalls === 1
					? { action: cmd.action, error: { code: 'AIMP_LOADING' } }
					: { action: cmd.action, event: 'status', state: 'stopped', volume: 40 },
			)
		if (cmd.action === 'playlists/get') return c.send({ action: cmd.action, playlists: [] })
		c.send({ action: cmd.action, error: { code: 'UNKNOWN_ACTION' } })
	})
	const { context, state } = createMockContext(),
		i = new AimpControl(context)
	t.after(async () => {
		await i.destroy()
		await server.close()
	})
	await i.init({ host: '127.0.0.1', port: server.port })
	await until(() => state.variables.library_status === 'Library ready' && !i._starting)
	assert.ok(statusCalls >= 2)
	assert.equal(state.variables.connected, true)
	assert.equal(state.variables.last_command_error, '')
	assert.ok(state.actions.play_pause)
	assert.equal(i.features.capabilities, null)
})

test('music-library asynchronous cursor pages and cached previous pages retain safe selected-row actions', async () => {
	const i = fixture(),
		queries = new Map()
	i._ws = { isOpen: true }
	i._send = async (command, params) => {
		i.calls.push([command, params])
		let reply = { action: command, ok: true }
		if (command === 'musiclibrary/query') {
			const id = params.cursor ? 'page2' : 'page1'
			const q = { id, status: 'pending', storage_id: 'local', offset: id === 'page1' ? 0 : 1, limit: 1 }
			queries.set(id, {
				...q,
				status: 'complete',
				count: 1,
				has_more: id === 'page1',
				next_cursor: id === 'page1' ? 'cursor-2' : null,
				rows: [{ row_id: 'row-0', title: id, artist: 'Artist', can_play: true, can_add: true, can_queue: true }],
			})
			reply.music_library = { query: q }
		} else if (command === 'musiclibrary/query/get') reply.music_library = { query: queries.get(params.query_id) }
		applyMusicLibraryMessage(i, reply)
		return reply
	}
	await queryMusicLibrary(i, { storage_id: 'local', search: '', limit: 1, offset: 0 })
	await until(() => i.musicLibrary.query.status === 'complete')
	assert.equal(getFeatureVariableValues(i).ml_row_1_title, 'page1')
	await action(i, 'feature_ml_next_page', {})
	await until(() => i.musicLibrary.query.status === 'complete')
	assert.equal(getFeatureVariableValues(i).ml_row_1_title, 'page2')
	assert.deepEqual(
		i.calls.find(([cmd, p]) => cmd === 'musiclibrary/query' && p.cursor),
		['musiclibrary/query', { cursor: 'cursor-2' }],
	)
	await assert.rejects(action(i, 'feature_ml_play', { row_id: 'row-0', query_id: 'page1' }), /expired query/)
	await action(i, 'feature_ml_select_row', { index: 0 })
	await action(i, 'feature_ml_play', { row_id: '__selected__' })
	assert.deepEqual(i.calls.at(-1), ['musiclibrary/row/play', { query_id: 'page2', row_id: 'row-0' }])
	await action(i, 'feature_ml_previous_page', {})
	assert.equal(i.musicLibrary.query.id, 'page1')
	assert.equal(getFeatureVariableValues(i).ml_row_1_title, 'page1')
	const queryStarts = i.calls.filter(([cmd]) => cmd === 'musiclibrary/query').length
	await action(i, 'feature_ml_next_page', {})
	assert.equal(i.musicLibrary.query.id, 'page2')
	assert.deepEqual(i.calls.at(-1), ['musiclibrary/query/get', { query_id: 'page2' }])
	assert.equal(
		i.calls.filter(([cmd]) => cmd === 'musiclibrary/query').length,
		queryStarts,
		'A consumed provider cursor must not be reused',
	)
	i.musicLibrary.query.has_more = true
	i.musicLibrary.query.next_offset = null
	await assert.rejects(action(i, 'feature_ml_next_page', {}), /provider limits/)
	stopMusicLibrary(i)
})

test('file-tag editing requires explicit confirmation and carries the freshly resolved file identity', async () => {
	const i = fixture()
	i._send = async (command, params) => {
		i.calls.push([command, params])
		return command === 'tags/get'
			? { tags: { file_path: 'C:/Music/original.flac', fields: { title: 'Old' } } }
			: { ok: true }
	}
	await assert.rejects(
		action(i, 'feature_tags_write', { target: 'focused', field: 'title', value: 'New', confirm: false }),
		/confirmation/,
	)
	assert.equal(i.calls.length, 0)
	await action(i, 'feature_tags_write', { target: 'focused', field: 'title', value: 'New', confirm: true })
	assert.deepEqual(i.calls, [
		['tags/get', { target: 'focused' }],
		[
			'tags/write',
			{ target: 'focused', fields: { title: 'New' }, confirm: true, expected_file_path: 'C:/Music/original.flac' },
		],
	])
	await assert.rejects(
		action(i, 'feature_tags_write', { target: 'focused', field: 'year', value: '-1', confirm: true }),
		/between/,
	)
	assert.equal(i.calls.length, 2)
})

test('playlist/source actions resolve live playlist IDs and media/tool variables exactly match definitions', async () => {
	const i = fixture()
	await action(i, 'feature_track_copy_to', { target: 'focused', destinationId: 'music', position: -1 })
	assert.deepEqual(i.calls.at(-1), [
		'playlists/track/copy-to',
		{ target: 'focused', destination_playlist_id: 4, insert_at: -1 },
	])
	await assert.rejects(
		action(i, 'feature_source_create', {
			target: 'active',
			kind: 'folders',
			folders: '[{"path":"D:/Music","recursive":"yes"}]',
		}),
		/boolean recursive/,
	)
	applyLibraryToolsMessage(i, {
		groups: { total: 5, items: [] },
		playlist_source: { attached: true, factory_id: 'folders', autosync: true },
	})
	assert.equal(getFeatureVariableValues(i).playlist_group_count, 5)
	assert.equal(getFeatureVariableValues(i).playlist_source_autosync, true)
	assert.deepEqual(
		Object.keys(getFeatureVariableValues(i)).sort(),
		Object.keys(getFeatureVariableDefinitions(i)).sort(),
	)
})

test('registered AIMP actions are checked before execution; skin changes are constrained to advertised values', async () => {
	const i = fixture()
	i._send = async (command, params) => {
		i.calls.push([command, params])
		return command === 'app/action/get' ? { app_action: { enabled: false, executable: true } } : { ok: true }
	}
	await assert.rejects(action(i, 'feature_app_action_execute', { id: 'registered.action' }), /disabled/)
	assert.equal(i.calls.length, 1)
	await assert.rejects(action(i, 'feature_app_quit', { confirm: false }), /confirmation/)
	await action(i, 'feature_skin_color_adjust', { parameter: 'hue', delta: -1 })
	assert.deepEqual(i.calls.at(-1), ['skins/color/adjust', { parameter: 'hue', delta: -1 }])
	await assert.rejects(action(i, 'feature_skin_set', { name: 'not-installed.acs5' }), /no longer installed/)
	await assert.rejects(action(i, 'feature_skin_color_set', { parameter: 'intensity', value: 101 }), /supported range/)
})

test('music-library provider operations require provider capability and database removal confirmation', async () => {
	const i = fixture()
	i.features.capabilities.music_library.commands.push(
		'musiclibrary/storage/select',
		'musiclibrary/storage/command',
		'musiclibrary/row/remove',
		'musiclibrary/row/mark',
		'musiclibrary/operation/get',
	)
	i.features.capabilities.music_library.storages[0].commands = { add_files: true, row_remove: true, row_mark: true }
	i.musicLibrary.query = { id: 'query', status: 'complete', storage_id: 'local', rows: [{ row_id: 'row-1' }] }
	i._send = async (command, params) => {
		i.calls.push([command, params])
		return {
			action: command,
			acknowledgement: 'queued',
			music_library: { operation: { id: 'op-1', command, status: 'queued' } },
		}
	}
	await assert.rejects(action(i, 'feature_ml_row_remove', { confirm: false }), /confirmation/)
	assert.equal(i.calls.length, 0)
	await action(i, 'feature_ml_row_remove', { confirm: true })
	assert.deepEqual(i.calls.at(-1), ['musiclibrary/row/remove', { query_id: 'query', row_id: 'row-1', confirm: true }])
	await action(i, 'feature_ml_row_mark', { value: 3.5 })
	assert.deepEqual(i.calls.at(-1), ['musiclibrary/row/mark', { query_id: 'query', row_id: 'row-1', value: 3.5 }])
	i.musicLibrary.query.rows[0].can_mark = false
	await assert.rejects(action(i, 'feature_ml_row_mark', { value: 3.5 }), /result does not support/)
	await action(i, 'feature_ml_storage_select', { storage_id: 'local' })
	assert.deepEqual(i.calls.at(-1), ['musiclibrary/storage/select', { storage_id: 'local' }])
	await assert.rejects(
		action(i, 'feature_ml_storage_command', { storage_id: 'local', command: 'reload_tags', files: '[]' }),
		/does not support/,
	)
	await action(i, 'feature_ml_storage_command', {
		storage_id: 'local',
		command: 'add_files',
		files: '["C:/Music/song.flac"]',
	})
	assert.deepEqual(i.calls.at(-1), [
		'musiclibrary/storage/command',
		{ storage_id: 'local', command: 'add_files', files: ['C:/Music/song.flac'] },
	])
	stopMusicLibrary(i, true)
})
