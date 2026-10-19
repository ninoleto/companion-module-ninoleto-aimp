import assert from 'node:assert/strict'
import { test } from 'node:test'

import { InstanceStatus } from '@companion-module/base'

import AimpRemote from '../src/main.js'
import { startMockWsServer } from './mock-ws-server.js'

import { createMockContext } from './context.js'
import { makeFeatureFixture } from './feature-fixture.js'

async function waitFor(predicate, timeout = 2000) {
	const start = Date.now()
	while (Date.now() - start < timeout) {
		if (predicate()) return
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
	throw new Error('waitFor timed out')
}

test('boots over WebSocket, preloads tracks and drives actions', async (t) => {
	const received = []
	const server = await startMockWsServer(
		(command, connection) => {
			received.push(command)
			switch (command.action) {
				case 'player/status':
					connection.send({
						action: command.action,
						event: 'status',
						state: 'stopped',
						volume: 33,
						position: 1,
						duration: 10,
					})
					break
				case 'playlists/get':
					connection.send({
						action: 'playlists/get',
						playlists: [{ id: 0, aimp_id: 'pl1', name: 'Main', track_count: 1 }],
					})
					break
				case 'playlists/tracks/get':
					connection.send({
						action: 'playlists/tracks/get',
						playlist_id: command.playlist_id,
						total: 1,
						tracks: [{ id: 0, file_path: 'C:/music/a.mp3', title: 'Song A', artist: 'Artist' }],
					})
					break
				case 'player/play':
					connection.send({ action: 'player/play', state: 'playing' })
					break
				case 'capabilities/get':
					connection.send({ action: command.action, error: { code: 'UNKNOWN_ACTION' } })
					break
				default:
					connection.send({ action: command.action })
			}
		},
		(connection) => {
			connection.send({ event: 'connected', state: 'stopped', volume: 33, position: 1, duration: 10 })
		},
	)
	t.after(() => server.close())

	const { context, state } = createMockContext()
	const instance = new AimpRemote(context)
	t.after(() => instance.destroy())

	await instance.init({ host: '127.0.0.1', port: server.port })
	await waitFor(() => instance.playlistChoices.length === 1)
	await waitFor(() => (instance.tracksCache.pl1 ?? []).length === 1)

	assert.ok(state.statuses.includes(InstanceStatus.Ok))
	assert.equal(state.variables.player_state, 'stopped')
	assert.equal(state.variables.volume_pct, 33)
	assert.equal(instance.playlistChoices[0].label, 'Main')
	assert.ok(state.actions.playlist_play)
	await waitFor(() => received.some((command) => command.action === 'capabilities/get'))
	assert.equal(instance.features.capabilities, null)
	assert.equal(state.variables.last_command_error, '')
	assert.equal(state.variables.connected, true)
	assert.match(state.variables.feature_status, /Upgrade the AIMP plugin/)

	// Play/Pause toggle goes out as player/play while stopped.
	await state.actions.play_pause.callback({ options: {} })
	assert.ok(received.some((command) => command.action === 'player/play'))

	// The browse action resolves a file path back to a playlist track index.
	await state.actions.track_action_browse.callback({
		options: { playlistId: 'pl1', trackId: 'C:/music/a.mp3', action: 'play' },
	})
	const trackPlay = received.filter((command) => command.action === 'playlists/track/play')
	assert.deepEqual(trackPlay, [{ action: 'playlists/track/play', playlist_id: 0, track_id: 0 }])
})

test('retries track loading after a failed request', async (t) => {
	let failNextTrackRequest = true
	const server = await startMockWsServer((command, connection) => {
		if (command.action === 'player/status') {
			connection.send({ action: command.action, event: 'status', state: 'stopped', volume: 50 })
		} else if (command.action === 'playlists/get') {
			connection.send({
				action: 'playlists/get',
				playlists: [{ id: 0, aimp_id: 'pl1', name: 'Main', track_count: 1 }],
			})
		} else if (command.action === 'playlists/tracks/get') {
			if (failNextTrackRequest) {
				failNextTrackRequest = false
				connection.send({ action: 'playlists/tracks/get', error: { code: 'INTERNAL' } })
			} else {
				connection.send({
					action: 'playlists/tracks/get',
					total: 1,
					tracks: [{ id: 0, file_path: 'C:/b.mp3', title: 'B' }],
				})
			}
		} else connection.send({ action: command.action, error: { code: 'UNKNOWN_ACTION' } })
	})
	t.after(() => server.close())

	const { context } = createMockContext()
	const instance = new AimpRemote(context)
	t.after(() => instance.destroy())

	await instance.init({ host: '127.0.0.1', port: server.port })
	await waitFor(() => instance.tracksError.pl1 === true)

	// The failed load must not poison the cache with a sentinel.
	assert.equal(instance.tracksCache.pl1, undefined)
	assert.equal(instance._trackChoicesFor('pl1')[0].id, '__error__')

	await instance._ensureTracksLoaded('pl1')
	assert.equal((instance.tracksCache.pl1 ?? []).length, 1)
	assert.equal(instance.tracksError.pl1, undefined)
})

test('destroy tears the connection down', async (t) => {
	const server = await startMockWsServer()
	t.after(() => server.close())

	const { context } = createMockContext()
	const instance = new AimpRemote(context)
	await instance.init({ host: '127.0.0.1', port: server.port })
	await waitFor(() => instance._ws?.isOpen === true)

	await instance.destroy()
	assert.equal(instance._destroyed, true)
	assert.equal(instance._ws, null)
})

test('partial extension write errors publish authoritative readback without clearing the diagnostic', async (t) => {
	const { context, state } = createMockContext()
	const instance = new AimpRemote(context)
	t.after(() => instance.destroy())
	instance.config = {}
	instance._onMessage({ event: 'status', state: 'playing', volume: 50 })
	const features = makeFeatureFixture()
	instance._onMessage({
		action: 'capabilities/get',
		protocol_version: 2,
		plugin_version: '0.2.0',
		capabilities: features.capabilities,
	})
	instance._onMessage({ action: 'extensions/get', ...features })
	assert.equal(state.variables.audio_pitch, features.audio.pitch)
	assert.equal(state.variables.eq_preamp, features.equalizer.preamp)
	instance._onMessage({
		action: 'audio/reset',
		audio: { pitch: 0, speed: 1 },
		equalizer: { available: true, enabled: true, bands: [], presets: features.equalizer.presets },
		error: { code: 'AUDIO_RESET_PARTIALLY_FAILED', parameters: { chorus: -1 } },
	})
	assert.equal(state.variables.audio_pitch, 0)
	assert.equal(state.variables.audio_chorus, '')
	assert.equal(state.variables.eq_preamp, '')
	assert.equal(state.variables.last_command_error, 'audio/reset: AUDIO_RESET_PARTIALLY_FAILED')
	assert.equal(state.variables.connected, true)
	assert.ok(state.actions.play_pause)
	assert.ok(state.actions.pitch_adjust)
	instance._onMessage({
		action: 'app/command',
		acknowledgement: 'queued',
		last_app_command: { command: 'options', status: 'queued' },
	})
	assert.equal(state.variables.last_app_command_status, 'queued')
	instance._onMessage({ action: 'extensions/get', last_app_command: { command: 'options', status: 'completed' } })
	assert.equal(state.variables.last_app_command_status, 'completed')
})

test('Show About AIMP preset sends the exact command and distinguishes queued from completed', async (t) => {
	const received = []
	const features = makeFeatureFixture(false)
	let connection
	const server = await startMockWsServer((command, client) => {
		connection = client
		received.push(command)
		if (command.action === 'player/status')
			client.send({ action: command.action, event: 'status', state: 'stopped', volume: 50 })
		else if (command.action === 'playlists/get') client.send({ action: command.action, playlists: [] })
		else if (command.action === 'capabilities/get')
			client.send({ action: command.action, protocol_version: 2, capabilities: features.capabilities })
		else if (command.action === 'app/command')
			client.send({
				action: command.action,
				acknowledgement: 'queued',
				last_app_command: { command: command.command, status: 'queued' },
			})
		else client.send({ action: command.action })
	})
	t.after(() => server.close())
	const { context, state } = createMockContext()
	const instance = new AimpRemote(context)
	t.after(() => instance.destroy())
	await instance.init({ host: '127.0.0.1', port: server.port })
	await waitFor(() => state.presets?.presets.feature_app_command_about)
	const presetAction = state.presets.presets.feature_app_command_about.steps[0].down[0]
	await state.actions[presetAction.actionId].callback({ options: presetAction.options })
	assert.deepEqual(
		received.filter((command) => command.action === 'app/command'),
		[{ action: 'app/command', command: 'about' }],
	)
	assert.equal(state.variables.last_app_command_status, 'queued')
	assert.equal(state.variables.last_command_error, '')
	connection.send({
		action: 'extensions/get',
		last_app_command: { command: 'about', status: 'completed', hresult: 0 },
	})
	await waitFor(() => state.variables.last_app_command_status === 'completed')
	assert.equal(state.variables.last_app_command_hresult, '0x00000000')
	assert.equal(state.variables.last_app_command_error, '')
})

test('deferred interface failures report once and survive unrelated reads', async (t) => {
	const { context, state } = createMockContext()
	const instance = new AimpRemote(context)
	t.after(() => instance.destroy())
	const logs = []
	instance.log = (level, message) => logs.push({ level, message })
	instance.config = {}
	instance._onMessage({ event: 'status', state: 'playing', volume: 50 })
	const failed = {
		action: 'extensions/get',
		last_app_command: { command: 'about', status: 'failed', hresult: -2147467259 },
	}
	instance._onMessage(failed)
	const expected = 'app/command (about): AIMP command failed (HRESULT 0x80004005)'
	assert.equal(state.variables.last_command_error, expected)
	assert.equal(state.variables.last_app_command_status, 'failed')
	assert.equal(state.variables.last_app_command_hresult, '0x80004005')
	assert.equal(state.variables.last_app_command_error, 'AIMP command failed (HRESULT 0x80004005)')
	instance._onMessage(failed)
	instance._onMessage({ action: 'player/status', state: 'playing' })
	assert.deepEqual(logs, [{ level: 'warn', message: expected }])
	instance._ws = {
		isOpen: true,
		close() {},
		async send(action) {
			const reply = action === 'extensions/get' ? failed : { action, event: 'status', state: 'playing' }
			instance._onMessage(reply)
			return reply
		},
	}
	await instance._send('extensions/get')
	await instance._send('player/status')
	assert.equal(state.variables.last_command_error, expected)
	assert.equal(logs.length, 1)
	instance._onMessage({
		action: 'app/command',
		acknowledgement: 'queued',
		last_app_command: { command: 'about', status: 'queued' },
	})
	assert.equal(state.variables.last_app_command_hresult, '')
	assert.equal(state.variables.last_app_command_error, '')
	instance._onMessage(failed)
	assert.equal(logs.length, 2, 'a new execution with the same failure must be reported again')
})

test('deferred registered-action errors include the action ID and SDK detail', async (t) => {
	const { context, state } = createMockContext()
	const instance = new AimpRemote(context)
	t.after(() => instance.destroy())
	const logs = []
	instance.log = (level, message) => logs.push({ level, message })
	instance.config = {}
	instance._onMessage({ event: 'status', state: 'playing' })
	const failure = {
		action: 'extensions/get',
		app_control: {
			last_action: { id: 'aimp.example', status: 'failed', error: 'ACTION_DISABLED', hresult: -2147467259 },
		},
	}
	instance._onMessage(failure)
	instance._onMessage(failure)
	assert.equal(
		state.variables.last_command_error,
		'app/action/execute (aimp.example): ACTION_DISABLED (HRESULT 0x80004005)',
	)
	assert.equal(state.variables.app_registered_action_error, 'ACTION_DISABLED (HRESULT 0x80004005)')
	assert.equal(state.variables.app_registered_action_hresult, '0x80004005')
	assert.equal(logs.length, 1)
	instance._onMessage({ action: 'app/command', error: { code: 'APP_COMMAND_DISABLED', hresult: -2147467259 } })
	assert.equal(state.variables.last_command_error, 'app/command: APP_COMMAND_DISABLED (HRESULT 0x80004005)')
})
