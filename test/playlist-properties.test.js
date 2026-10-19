import test from 'node:test'
import assert from 'node:assert/strict'
import { getLibraryToolActions } from '../src/library-tools.js'

const dependencies = {
	grouping: 'grouping_override',
	grouping_template: 'grouping_override',
	grouping_auto_merge: 'grouping_override',
	format_line1: 'format_override',
	format_line2: 'format_override',
	view_duration: 'view_override',
	view_expand_buttons: 'view_override',
	view_marks: 'view_override',
	view_numbers: 'view_override',
	view_numbers_absolute: 'view_override',
	view_second_line: 'view_override',
	view_switches: 'view_override',
}
const strings = new Set(['name', 'grouping_template', 'format_line1', 'format_line2'])
const indices = new Set(['focused_index', 'playback_cursor', 'playing_index'])
const descriptors = [
	...Object.keys(dependencies),
	'grouping_override',
	'format_override',
	'view_override',
	'read_only',
	'name',
	...indices,
].map((id) => ({
	id,
	label: id,
	type: strings.has(id) ? 'string' : indices.has(id) ? 'integer' : 'boolean',
	...(strings.has(id) ? { max_length: 4096 } : indices.has(id) ? { min: -1 } : {}),
}))

function fixture() {
	const calls = []
	const values = () =>
		Object.fromEntries(descriptors.map((d) => [d.id, d.type === 'boolean' ? false : d.type === 'string' ? '' : -1]))
	const playlists = [
		{ guid: 'alpha', name: 'Alpha', track_count: 3, values: values() },
		{ guid: 'beta', name: 'Beta', track_count: 2, values: values() },
	]
	const instance = {
		features: {
			capabilities: {
				library: {
					commands: ['playlists/info', 'playlists/properties/get', 'playlists/properties/set'],
					playlist_properties: descriptors,
				},
			},
		},
		playlistChoices: playlists.map((p) => ({ id: p.guid, label: p.name })),
		playlistsMap: {},
		_playlistIndex(id) {
			return this.playlistsMap[id]?.index
		},
	}
	const model = {
		calls,
		playlists,
		instance,
		active: 'alpha',
		before: null,
		after: null,
		syncMap() {
			instance.playlistsMap = Object.fromEntries(playlists.map((p, index) => [p.guid, { index }]))
		},
	}
	model.syncMap()
	instance._send = async (action, params) => {
		calls.push({ action, ...params })
		const override = await model.before?.(action, params)
		if (override) return override
		const index =
			params.target === 'explicit' ? params.playlist_id : playlists.findIndex((p) => p.guid === model.active)
		const playlist = playlists[index]
		assert.ok(playlist, 'fixture received a nonexistent playlist')
		let reply
		if (action === 'playlists/info') {
			reply = {
				playlist: { id: index, aimp_id: playlist.guid, name: playlist.name, track_count: playlist.track_count },
			}
		} else {
			if (action === 'playlists/properties/set') {
				// Model the documented SDK rule: dependent writes do not apply without their override.
				const prerequisite = dependencies[params.parameter]
				if (!prerequisite || playlist.values[prerequisite]) playlist.values[params.parameter] = params.value
			}
			reply = {
				playlist_properties: {
					playlist_id: index,
					values: structuredClone(playlist.values),
					available: Object.fromEntries(Object.keys(playlist.values).map((id) => [id, true])),
				},
			}
		}
		await model.after?.(action, params, reply)
		return reply
	}
	model.run = (parameter, value, options = {}) =>
		getLibraryToolActions(instance)[`feature_playlist_property_${parameter}`].callback({
			options: { target: 'active', value, ...options },
		})
	model.writes = () => calls.filter((c) => c.action === 'playlists/properties/set')
	return model
}

test('each dependent playlist setting enables its documented override and verifies the resulting value', async () => {
	for (const [parameter, prerequisite] of Object.entries(dependencies)) {
		const f = fixture()
		const value = strings.has(parameter) ? '%Artist - %Title' : true
		await f.run(parameter, value)
		assert.deepEqual(f.writes(), [
			{ action: 'playlists/properties/set', target: 'explicit', playlist_id: 0, parameter: prerequisite, value: true },
			{ action: 'playlists/properties/set', target: 'explicit', playlist_id: 0, parameter, value },
		])
		assert.equal(f.playlists[0].values[parameter], value)
		assert.equal(f.playlists[1].values[prerequisite], false)
	}
})

test('already-enabled overrides, direct override Off, and read-only settings retain their intended semantics', async () => {
	const f = fixture()
	f.playlists[0].values.view_override = true
	f.playlists[0].values.read_only = true
	await f.run('view_numbers', true)
	assert.deepEqual(
		f.writes().map((c) => c.parameter),
		['view_numbers'],
	)
	assert.equal(f.playlists[0].values.read_only, true)
	await f.run('view_override', false)
	assert.deepEqual(
		f.writes().map((c) => [c.parameter, c.value]),
		[
			['view_numbers', true],
			['view_override', false],
		],
	)
	await f.run('read_only', false)
	assert.equal(f.playlists[0].values.read_only, false)
})

test('invalid inputs are rejected before any request or override mutation', async () => {
	for (const [parameter, value] of [
		['view_numbers', 'true'],
		['view_numbers', undefined],
		['format_line1', null],
		['format_line1', 'bad\0text'],
		['format_line1', 'ž'.repeat(2049)],
		['name', ' '],
		['focused_index', null],
		['focused_index', NaN],
		['focused_index', 0.5],
		['focused_index', -2],
	]) {
		const f = fixture()
		await assert.rejects(f.run(parameter, value))
		assert.deepEqual(f.calls, [])
	}
})

test('out-of-range track indices are rejected after reading the playlist and before writing', async () => {
	for (const parameter of indices) {
		const f = fixture()
		await assert.rejects(f.run(parameter, 3), /Track index must be between -1 and 2/)
		assert.deepEqual(
			f.calls.map((c) => c.action),
			['playlists/info'],
		)
	}
})

test('switching active tabs between requests cannot redirect the property write', async () => {
	const f = fixture()
	f.after = (action) => {
		if (action === 'playlists/info') f.active = 'beta'
	}
	await f.run('view_numbers', true)
	assert.equal(f.playlists[0].values.view_numbers, true)
	assert.equal(f.playlists[1].values.view_numbers, false)
	assert.ok(f.calls.slice(1).every((c) => c.target === 'explicit' && c.playlist_id === 0))
})

test('known playlist reindexing resolves and verifies the captured GUID before the next write', async () => {
	const f = fixture()
	const original = f.playlists[0]
	f.after = (action, params) => {
		if (action === 'playlists/properties/set' && params.parameter === 'view_override') {
			f.playlists.reverse()
			f.syncMap()
		}
	}
	await f.run('view_numbers', true)
	assert.equal(f.writes()[1].playlist_id, 1)
	assert.equal(original.values.view_numbers, true)
	assert.equal(f.playlists[0].values.view_numbers, false)
	assert.deepEqual(f.calls.at(-2), { action: 'playlists/info', target: 'explicit', playlist_id: 1 })
})

test('a removed captured playlist stops the remaining writes', async () => {
	const f = fixture()
	f.after = (action, params) => {
		if (action === 'playlists/properties/set' && params.parameter === 'view_override') {
			f.playlists.shift()
			f.syncMap()
		}
	}
	await assert.rejects(f.run('view_numbers', true), /Playlist no longer exists/)
	assert.equal(f.writes().length, 1)
	assert.equal(f.playlists[0].values.view_numbers, false)
})

test('stale explicit selections fail before any write to a different playlist', async () => {
	const f = fixture()
	f.instance.playlistsMap.alpha.index = 1
	await assert.rejects(
		f.run('view_numbers', true, { target: 'explicit', playlistId: 'alpha' }),
		/selected playlist changed/,
	)
	assert.deepEqual(f.writes(), [])
})

test('missing identity, wrong readback target, unavailable property and unavailable prerequisite fail before writes', async () => {
	for (const variant of ['identity', 'target', 'property', 'prerequisite']) {
		const f = fixture()
		f.after = (action, params, reply) => {
			if (variant === 'identity' && action === 'playlists/info') delete reply.playlist.aimp_id
			if (action !== 'playlists/properties/get') return
			if (variant === 'target') reply.playlist_properties.playlist_id = 1
			if (variant === 'property') reply.playlist_properties.available.view_numbers = false
			if (variant === 'prerequisite') reply.playlist_properties.available.view_override = false
		}
		await assert.rejects(f.run('view_numbers', true))
		assert.deepEqual(f.writes(), [])
	}
})

test('prerequisite errors and ignored prerequisite writes stop the dependent write and never unlock a playlist', async () => {
	for (const variant of ['throw', 'error', 'unchanged']) {
		const f = fixture()
		f.playlists[0].values.read_only = true
		f.before = (action, params) => {
			if (action !== 'playlists/properties/set') return
			if (variant === 'throw') throw new Error('AIMP refused the override')
			if (variant === 'error') return { error: { code: 'AIMP_OPERATION_FAILED', hresult: -2147024891 } }
			return {
				playlist_properties: { playlist_id: 0, values: { view_override: false }, available: { view_override: true } },
			}
		}
		await assert.rejects(f.run('view_numbers', true), /refused|AIMP_OPERATION_FAILED|did not apply/)
		assert.deepEqual(
			f.writes().map((c) => c.parameter),
			['view_override'],
		)
		assert.equal(f.playlists[0].values.read_only, true)
	}
})

test('a successful transport response does not conceal a property readback mismatch', async () => {
	const f = fixture()
	f.before = (action, params) => {
		if (action === 'playlists/properties/set' && params.parameter === 'view_numbers')
			return {
				ok: true,
				playlist_properties: { playlist_id: 0, values: { view_numbers: false }, available: { view_numbers: true } },
			}
	}
	await assert.rejects(f.run('view_numbers', true), /did not apply playlist property view_numbers/)
	assert.equal(f.playlists[0].values.view_numbers, false)
})
