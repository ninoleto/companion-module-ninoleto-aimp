import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import AimpControl from '../src/main.js'
import { AimpWsClient, validateEndpoint } from '../src/ws-client.js'
import { createMockContext } from './context.js'
import { startMockWsServer } from './mock-ws-server.js'

async function waitFor(fn, timeout = 4000) {
	const end = Date.now() + timeout
	while (Date.now() < end) {
		if (fn()) return
		await new Promise((r) => setTimeout(r, 5))
	}
	throw new Error('Test condition timed out')
}
async function fixture(t, count = 1, config = {}) {
	const received = []
	const player = {
		event: 'status',
		state: 'paused',
		volume: 33,
		muted: false,
		position: 10,
		duration: 200,
		shuffle: false,
		repeat: false,
		auto_jump: true,
		playing_playlist: { id: 0, aimp_id: 'pl0', name: 'Main' },
		playing_track: { id: 0, file_path: 'C:/music/0.mp3', title: 'Zero', artist: 'Artist' },
		focus_playlist: { id: 0, aimp_id: 'pl0', name: 'Main' },
		focus_track: null,
	}
	const playlists = Array.from({ length: 6 }, (_, id) => ({
		id,
		aimp_id: `pl${id}`,
		name: `Playlist ${id}`,
		track_count: id === 0 ? count : 1,
	}))
	const allTracks = (id) =>
		Array.from({ length: playlists[id].track_count }, (_, index) => ({
			id: index,
			file_path: `C:/music/${index}.mp3`,
			title: `Song ${index}`,
			artist: `Artist ${id}`,
		}))
	const server = await startMockWsServer(
		(cmd, c) => {
			received.push(cmd)
			const action = cmd.action
			if (action === 'player/status') return c.send({ ...player, action })
			if (action === 'playlists/get') return c.send({ action, playlists })
			if (action === 'playlists/tracks/get')
				return c.send({
					action,
					playlist_id: cmd.playlist_id,
					total: playlists[cmd.playlist_id].track_count,
					tracks: allTracks(cmd.playlist_id).slice(cmd.offset, cmd.offset + cmd.limit),
				})
			if (action === 'player/volume/set') {
				player.volume = cmd.volume
				return c.send({ action, volume: cmd.volume })
			}
			if (action === 'player/volume/get') return c.send({ action, volume: player.volume, muted: player.muted })
			if (action === 'player/mute') {
				player.muted = !player.muted
				return c.send({ action, muted: player.muted })
			}
			if (action === 'player/position/set') {
				player.position = cmd.position
				return c.send({ action, position: cmd.position })
			}
			if (action === 'player/play') player.state = 'playing'
			if (action === 'player/pause') player.state = 'paused'
			if (action === 'player/stop') player.state = 'stopped'
			for (const [route, field] of [
				['shuffle', 'shuffle'],
				['repeat', 'repeat'],
				['auto-jump', 'auto_jump'],
			]) {
				if (action === `player/${route}/toggle`) player[field] = !player[field]
				if (action === `player/${route}/get` || action === `player/${route}/toggle`)
					return c.send({ action, [field]: player[field] })
			}
			c.send({ action, ok: true })
		},
		(c) => c.send({ ...player, event: 'connected' }),
	)
	const { context, state } = createMockContext()
	context.label = 'My AIMP'
	const instance = new AimpControl(context)
	t.after(async () => {
		await instance.destroy()
		await server.close()
	})
	await instance.init({ host: '127.0.0.1', port: server.port, ...config })
	await waitFor(
		() =>
			state.variables.library_status === 'Library ready' || state.variables.library_status?.startsWith('Track limit'),
	)
	return { instance, state, player, received, server, playlists, allTracks }
}

test('pages beyond 1000 tracks; generates all six playlist groups and one Play preset per loaded track', async (t) => {
	const f = await fixture(t, 1005)
	assert.equal(f.instance.tracksCache.pl0.length, 1005)
	assert.equal(f.state.variables.loaded_track_count, 1010)
	assert.equal(f.state.presets.structure.find((s) => s.id === 'playlists').definitions.length, 6)
	assert.equal(Object.keys(f.state.presets.presets).filter((id) => id.startsWith('tr_')).length, 1010)
	assert.deepEqual(
		f.received.filter((c) => c.action === 'playlists/tracks/get' && c.playlist_id === 0).map((c) => c.offset),
		[0, 250, 500, 750, 1000],
	)
})

test('rapid rotary volume and seek actions accumulate using authoritative replies', async (t) => {
	const f = await fixture(t)
	await Promise.all(Array.from({ length: 8 }, () => f.state.actions.volume_up.callback({ options: { step: 1 } })))
	assert.deepEqual(
		f.received.filter((c) => c.action === 'player/volume/set').map((c) => c.volume),
		[34, 35, 36, 37, 38, 39, 40, 41],
	)
	await Promise.all(
		Array.from({ length: 3 }, () => f.state.actions.seek_relative.callback({ options: { seconds: 5 } })),
	)
	assert.equal(f.player.position, 25)
	await f.state.actions.seek_relative.callback({ options: { seconds: -100 } })
	assert.equal(f.player.position, 0)
	await f.state.actions.seek_relative.callback({ options: { seconds: 1000 } })
	assert.equal(f.player.position, 200)
})

test('explicit on/off is idempotent and play/pause toggles get fresh player state', async (t) => {
	const f = await fixture(t)
	for (let i = 0; i < 2; i++) await f.state.actions.mute_set.callback({ options: { enabled: true } })
	assert.equal(f.received.filter((c) => c.action === 'player/mute').length, 1)
	for (let i = 0; i < 2; i++) await f.state.actions.shuffle_set.callback({ options: { enabled: true } })
	assert.equal(f.received.filter((c) => c.action === 'player/shuffle/toggle').length, 1)
	await Promise.all([
		f.state.actions.play_pause.callback({ options: {} }),
		f.state.actions.play_pause.callback({ options: {} }),
	])
	assert.deepEqual(
		f.received.filter((c) => ['player/play', 'player/pause'].includes(c.action)).map((c) => c.action),
		['player/play', 'player/pause'],
	)
})

test('missing track never silently plays the first track; state clears on null and disconnect', async (t) => {
	const f = await fixture(t)
	await f.state.actions.track_action_browse.callback({
		options: { playlistId: 'pl0', trackId: 'missing', action: 'play' },
	})
	assert.ok(!f.received.some((c) => c.action === 'playlists/track/play'))
	assert.match(f.state.variables.last_command_error, /not found/)
	f.instance._onMessage({ event: 'focus_changed', ...f.player, playing_track: null, focus_playlist: null })
	assert.equal(f.state.variables.playing_track_title, '')
	assert.equal(f.state.variables.focus_playlist_id, '')
	for (const connection of f.server.connections) connection.drop()
	await waitFor(() => !f.state.variables.connected)
	assert.equal(f.state.feedbacks.is_playing.callback({ options: {} }), false)
	assert.equal(f.state.variables.playing_track_title, '')
})

test('limit is visible and track presets can be disabled without disabling track controls', async (t) => {
	const f = await fixture(t, 350, { trackLimit: 100, trackPresets: false })
	assert.equal(f.instance.tracksCache.pl0.length, 100)
	assert.match(f.state.variables.library_status, /limit reached/)
	assert.equal(Object.keys(f.state.presets.presets).filter((id) => id.startsWith('tr_')).length, 0)
	assert.ok(f.state.actions.track_action)
	f.instance._onMessage({ ...f.player, playing_track: { id: 99, file_path: 'C:/music/99.mp3' } })
	await f.state.actions.playlist_track_next.callback({ options: { playlistId: 'pl0' } })
	assert.ok(f.received.some((c) => c.action === 'playlists/track/play' && c.track_id === 100))
})

test('presets reference valid actions, options, feedbacks and connection labels', async (t) => {
	const f = await fixture(t)
	const used = new Set(),
		ids = new Set(Object.keys(f.state.presets.presets))
	for (const preset of Object.values(f.state.presets.presets)) {
		assert.equal(preset.type, 'layered')
		assert.doesNotMatch(JSON.stringify(preset.elements), /\$\(aimp-remote:/)
		for (const step of preset.steps)
			for (const list of Object.values(step))
				for (const action of list) {
					used.add(action.actionId)
					const def = f.state.actions[action.actionId]
					assert.ok(def, action.actionId)
					for (const option of def.options) {
						assert.ok(Object.hasOwn(action.options, option.id), `${action.actionId}.${option.id}`)
						if (option.type === 'dropdown' && !option.useCustom)
							assert.ok(
								option.choices.some((c) => c.id === action.options[option.id]),
								`${action.actionId}.${option.id} choice`,
							)
					}
				}
		for (const fb of preset.feedbacks) assert.ok(f.state.feedbacks[fb.feedbackId], fb.feedbackId)
	}
	for (const section of f.state.presets.structure)
		for (const def of section.definitions)
			for (const id of typeof def === 'string' ? [def] : def.presets) assert.ok(ids.has(id))
	assert.ok(
		f.state.presets.presets.display_elapsed.elements
			.find((e) => e.id === 'label')
			.text.includes('$(My AIMP:position_fmt)'),
	)
})

test(
	'all 31 bridge commands are exercised by user actions or inventory/status requests',
	{ timeout: 5000 },
	async (t) => {
		const f = await fixture(t)
		for (const def of Object.values(f.state.actions)) {
			const options = Object.fromEntries(def.options.map((o) => [o.id, o.default]))
			await def.callback({ options })
			if (Object.hasOwn(options, 'action')) await def.callback({ options: { ...options, action: 'select' } })
		}
		const expected = readFileSync(new URL('./bridge-commands.json', import.meta.url), 'utf8')
		const sent = new Set(f.received.map((c) => c.action))
		assert.deepEqual(
			JSON.parse(expected).filter((c) => !sent.has(c)),
			[],
		)
	},
)

test('timeout discards queued commands; late identical replies cannot match another request', async (t) => {
	const received = []
	const server = await startMockWsServer((c) => received.push(c))
	const client = new AimpWsClient({ port: server.port, requestTimeout: 40, reconnectDelay: 2000 })
	t.after(async () => {
		client.close()
		await server.close()
	})
	client.connect()
	await once(client, 'open')
	const responses = await Promise.all([client.send('player/play'), client.send('player/play')])
	assert.deepEqual(responses, [null, null])
	assert.equal(received.length, 1)
	assert.match(client.lastError, /No reply/)
})

test('HTTP-only endpoint returns an actionable diagnostic', async (t) => {
	const server = createServer((_req, res) => {
		res.writeHead(200)
		res.end('HTTP only')
	})
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	const client = new AimpWsClient({ port: server.address().port, reconnectDelay: 2000 })
	t.after(async () => {
		client.close()
		await new Promise((r) => server.close(r))
	})
	client.connect()
	const [reason] = await once(client, 'close')
	assert.match(reason, /HTTP 200/)
	assert.equal(client.isOpen, false)
})

test('endpoint validation rejects URL paths and invalid ports; localhost uses plugin IPv4', () => {
	assert.throws(() => validateEndpoint('ws://127.0.0.1:19122'))
	assert.throws(() => validateEndpoint('127.0.0.1', 0))
	assert.throws(() => validateEndpoint('127.0.0.1', 1.2))
	assert.equal(validateEndpoint('localhost').host, '127.0.0.1')
})
