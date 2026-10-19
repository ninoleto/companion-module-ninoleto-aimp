import assert from 'node:assert/strict'
import { test } from 'node:test'
import AimpRemote from '../src/main.js'
import {
	initialInspectionResults,
	inspectionVariableDefinitions,
	updateInspectionResult,
} from '../src/inspection-results.js'
import { createMockContext } from './context.js'

// Native 0.3.0 shapes from library_controls.cpp: PlaylistInfo, TrackInfo,
// ReadInfo (player/fileinfo), and PropertyState. No metadata is nested in track.
const replies = {
	'playlists/info': {
		action: 'playlists/info',
		playlist: { id: 0, aimp_id: 'music', name: 'Evening Music', track_count: 12, duration: 3456, read_only: false },
	},
	'playlists/track/info': {
		action: 'playlists/track/info',
		track: {
			playlist_id: 0,
			track_id: 2,
			id: 2,
			title: 'Last Light',
			artist: 'The Ensemble',
			file_path: 'C:\\Music\\Last Light.flac',
			enabled: true,
			rating: 3.5,
		},
	},
	'player/fileinfo': {
		action: 'player/fileinfo',
		file_info: { title: 'Last Light', codec: 'FLAC', channels: 2, sample_rate: 44100, bit_depth: 24, bitrate: 1450 },
	},
	'playlists/properties/get': {
		action: 'playlists/properties/get',
		playlist_properties: {
			playlist_id: 0,
			values: { name: 'Evening Music', grouping_override: true, format_override: false, view_override: false },
			available: { name: true, grouping_override: true, format_override: true, view_override: true, group_name: false },
		},
	},
}

function fixture(t) {
	const { context, state } = createMockContext()
	const instance = new AimpRemote(context)
	let nextReply
	instance._ws = {
		isOpen: true,
		close() {},
		async send(action) {
			if (nextReply instanceof Error) throw nextReply
			const reply = nextReply ?? structuredClone(replies[action] || { action })
			instance._onMessage(reply)
			return reply
		},
	}
	instance._scheduleStatus = () => {}
	instance._publish()
	t.after(() => instance.destroy())
	return { instance, values: state.variables, reply: (value) => (nextReply = value) }
}

test('inspection variables begin with a useful prompt and match the registered definitions', () => {
	const initial = initialInspectionResults()
	assert.equal(Object.keys(initial).length, 4)
	assert.deepEqual(Object.keys(initial), Object.keys(inspectionVariableDefinitions()))
	assert.ok(Object.values(initial).every((value) => value === 'Press to read'))
})

test('explicit native reads publish independent summaries and retain their original JSON', async (t) => {
	const { instance, values } = fixture(t)
	for (const action of Object.keys(replies)) {
		await instance._send(action)
		assert.equal(values.last_response, JSON.stringify(replies[action]))
	}
	assert.equal(values.playlist_info_summary, 'Evening Music\n12 tracks')
	assert.equal(values.track_info_summary, 'Last Light\nThe Ensemble')
	assert.equal(values.file_info_summary, 'FLAC\n44.1 kHz / 24-bit')
	assert.equal(values.playlist_properties_summary, '4 properties\n1 custom / 2 inherited')
})

test('background replies and unrelated explicit commands cannot overwrite inspection snapshots', async (t) => {
	const { instance, values } = fixture(t)
	await instance._send('playlists/info')
	const previousJson = values.last_response
	instance._onMessage({ action: 'playlists/info', playlist: { name: 'Background Playlist', track_count: 500 } })
	instance._onMessage({ action: 'player/fileinfo', file_info: { codec: 'MP3', sample_rate: 48000, bit_depth: 16 } })
	instance._onMessage({ action: 'extensions/get', audio: { pitch: 2 } })
	assert.equal(values.playlist_info_summary, 'Evening Music\n12 tracks')
	assert.equal(values.file_info_summary, 'Press to read')
	assert.equal(values.last_response, previousJson)
	await instance._send('extensions/get')
	assert.equal(values.playlist_info_summary, 'Evening Music\n12 tracks')
	assert.equal(values.file_info_summary, 'Press to read')
})

test('null playing-file response and missing metadata are described without invented values', async (t) => {
	const { instance, values, reply } = fixture(t)
	reply({ action: 'player/fileinfo', file_info: null })
	await instance._send('player/fileinfo')
	assert.equal(values.file_info_summary, 'No playing file')
	reply({ action: 'player/fileinfo', file_info: { codec: '', sample_rate: 0, bit_depth: 0 } })
	await instance._send('player/fileinfo')
	assert.equal(values.file_info_summary, 'Audio details unavailable')
	reply({ action: 'playlists/track/info', track: { file_path: 'C:\\Music\\No Tags.mp3', artist: '' } })
	await instance._send('playlists/track/info')
	assert.equal(values.track_info_summary, 'No Tags.mp3')
	reply({ action: 'playlists/properties/get', playlist_properties: { playlist_id: 0, values: {}, available: {} } })
	await instance._send('playlists/properties/get')
	assert.equal(values.playlist_properties_summary, '0 properties\nOverrides unavailable')
})

test('failed reads replace only their own summary and keep previous successful response JSON', async (t) => {
	const { instance, values, reply } = fixture(t)
	await instance._send('playlists/info')
	await instance._send('playlists/track/info')
	const previousJson = values.last_response
	reply({ action: 'playlists/info', error: { code: 'PLAYLIST_NOT_FOUND' } })
	await instance._execute(() => instance._send('playlists/info'))
	assert.equal(values.playlist_info_summary, 'Read failed\nSee last error')
	assert.equal(values.track_info_summary, 'Last Light\nThe Ensemble')
	assert.equal(values.last_response, previousJson)
	assert.match(values.last_command_error, /PLAYLIST_NOT_FOUND/)
	reply(new Error('Connection closed before reply'))
	await instance._execute(() => instance._send('player/fileinfo'))
	assert.equal(values.file_info_summary, 'Read failed\nSee last error')
	assert.match(values.last_command_error, /Connection closed before reply/)
	reply(undefined)
	await instance._send('playlists/info')
	assert.equal(values.playlist_info_summary, 'Evening Music\n12 tracks')
})

test('disconnected reads report failure without fabricating a result', async (t) => {
	const { instance, values } = fixture(t)
	instance._ws.isOpen = false
	await instance._execute(() => instance._send('playlists/properties/get'))
	assert.equal(values.playlist_properties_summary, 'Read failed\nSee last error')
	assert.match(values.last_command_error, /not connected/)
	assert.equal(values.last_response, '')
})

test('summary shortening does not shorten or replace the existing 4096-character JSON response', async (t) => {
	const { instance, values, reply } = fixture(t)
	const longReply = {
		action: 'playlists/track/info',
		track: { title: 'A'.repeat(100), artist: 'B'.repeat(100), lyrics: 'C'.repeat(5000) },
	}
	reply(longReply)
	await instance._send('playlists/track/info')
	assert.equal(values.track_info_summary, `${'A'.repeat(31)}…\n${'B'.repeat(31)}…`)
	assert.equal(values.last_response, JSON.stringify(longReply).slice(0, 4096))
	assert.equal(values.last_response.length, 4096)
})

test('property summaries count only available values and known override states', () => {
	const results = initialInspectionResults()
	updateInspectionResult(results, 'playlists/properties/get', {
		playlist_properties: {
			values: { name: 'Main', grouping_override: true, format_override: false, view_override: false },
			available: { name: true, grouping_override: false, format_override: true },
		},
	})
	assert.equal(results.playlist_properties_summary, '2 properties\n0 custom / 1 inherited')
})
