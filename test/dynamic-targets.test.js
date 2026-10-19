import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	validateNumberValue,
	validateDropdownValue,
	validateCheckboxValue,
	validateTextValue,
} from '@companion-module/host/validate'
import { getFeatureActions } from '../src/feature-controls.js'
import { updatePresets } from '../src/presets.js'
import {
	makeFeatureFixture,
	makeMediaFixture,
	makeMusicLibraryFixture,
	makeLibraryToolsFixture,
} from './feature-fixture.js'

const validators = {
	number: validateNumberValue,
	dropdown: validateDropdownValue,
	checkbox: validateCheckboxValue,
	textinput: validateTextValue,
}
function parse(definition, options) {
	const parsed = {},
		errors = {}
	for (const field of definition.options) {
		if (field.type === 'static-text') continue
		assert.ok(validators[field.type], `Add host validation for ${field.type}`)
		const result = validators[field.type](options[field.id], field)
		parsed[field.id] = result.sanitisedValue
		if (result.validationError && !field.allowInvalidValues) errors[field.id] = result.validationError
	}
	return { parsed, errors }
}

const removeCases = [
	['feature_queue_remove_track', { action: 'queue/remove', target: 'focused' }],
	['feature_queue_remove', { action: 'queue/remove', queue_index: 0 }],
	['feature_queue_clear', { action: 'queue/clear' }],
	['feature_playlist_close', { action: 'playlists/close', target: 'active' }],
	['feature_playlist_clear', { action: 'playlists/clear', target: 'active' }],
	['feature_track_remove', { action: 'playlists/track/remove', target: 'focused' }],
]

function fixture() {
	const sent = []
	let indices = { old: 0 }
	const instance = {
		label: 'AIMP',
		config: { advancedPresets: true, trackPresets: false },
		features: makeFeatureFixture(),
		mediaState: makeMediaFixture(),
		musicLibrary: makeMusicLibraryFixture(),
		libraryTools: makeLibraryToolsFixture(),
		state: { connected: true },
		playlistChoices: [{ id: 'old', label: 'Old playlist' }],
		tracksCache: {},
		_playlistIndex: (id) => indices[id],
		_playlistNameById: (id) => id,
		setPresetDefinitions(_structure, definitions) {
			this.presets = definitions
		},
		async _send(action, options) {
			sent.push({ action, ...options })
			return { action, ok: true }
		},
	}
	updatePresets(instance)
	const savedPresets = structuredClone(instance.presets)
	function replacePlaylists(empty = false) {
		indices = empty ? {} : { current: 3 }
		instance.playlistChoices = empty ? [] : [{ id: 'current', label: 'Current playlist' }]
		return getFeatureActions(instance)
	}
	return { instance, sent, savedPresets, replacePlaylists }
}

test('reproduces pre-fix host rejection of an unused saved playlist, then validates all six saved remove presets', async () => {
	const { sent, savedPresets, replacePlaylists } = fixture()
	const actions = replacePlaylists()
	const playlistField = actions.feature_playlist_clear.options.find((field) => field.id === 'playlistId')
	assert.equal(
		validateDropdownValue('old', { ...playlistField, allowCustom: false }).validationError,
		'Value is not in the list of choices',
	)
	for (const [id] of removeCases) {
		const saved = savedPresets[id].steps[0].down[0]
		if (Object.hasOwn(saved.options, 'playlistId')) assert.equal(saved.options.playlistId, 'old')
		const result = parse(actions[saved.actionId], saved.options)
		assert.deepEqual(result.errors, {}, `${id}: unused source playlist must not block host parsing`)
		await actions[saved.actionId].callback({ options: result.parsed })
	}
	assert.deepEqual(
		sent,
		removeCases.map(([, packet]) => packet),
	)
})

test('dynamic active, focused, and playing targets ignore stale or blank saved source IDs', async () => {
	const { sent, replacePlaylists } = fixture()
	const actions = replacePlaylists()
	for (const [id, wire, modes] of [
		['feature_playlist_clear', 'playlists/clear', ['active', 'focused', 'playing']],
		['feature_playlist_close', 'playlists/close', ['active', 'focused', 'playing']],
		['feature_track_remove', 'playlists/track/remove', ['focused', 'playing']],
		['feature_queue_remove_track', 'queue/remove', ['focused', 'playing']],
	]) {
		for (const target of modes)
			for (const playlistId of ['old', '']) {
				const result = parse(actions[id], { target, playlistId, trackId: 0 })
				assert.deepEqual(result.errors, {})
				await actions[id].callback({ options: result.parsed })
				assert.deepEqual(sent.at(-1), { action: wire, target })
			}
	}
})

test('an explicit deleted playlist is never substituted with the current playlist', async () => {
	const { sent, replacePlaylists } = fixture()
	const actions = replacePlaylists()
	for (const id of [
		'feature_playlist_clear',
		'feature_playlist_close',
		'feature_track_remove',
		'feature_queue_remove_track',
	]) {
		const result = parse(actions[id], { target: 'explicit', playlistId: 'old', trackId: 0 })
		assert.deepEqual(result.errors, {}, 'The callback must validate explicit identity against the live inventory')
		await assert.rejects(actions[id].callback({ options: result.parsed }), /Playlist not found/)
	}
	assert.deepEqual(sent, [], 'No destructive command may be sent for a deleted explicit source')
	const current = parse(actions.feature_track_remove, { target: 'explicit', playlistId: 'current', trackId: 2 })
	await actions.feature_track_remove.callback({ options: current.parsed })
	assert.deepEqual(sent, [{ action: 'playlists/track/remove', target: 'explicit', playlist_id: 3, track_id: 2 }])
})

test('dynamic targets still reach AIMP with an empty playlist inventory, while explicit ones fail locally', async () => {
	const { sent, replacePlaylists } = fixture()
	const actions = replacePlaylists(true)
	const dynamic = parse(actions.feature_playlist_clear, { target: 'active', playlistId: 'old' })
	assert.deepEqual(dynamic.errors, {})
	await actions.feature_playlist_clear.callback({ options: dynamic.parsed })
	assert.deepEqual(sent, [{ action: 'playlists/clear', target: 'active' }])
	await assert.rejects(
		actions.feature_playlist_clear.callback({ options: { target: 'explicit', playlistId: 'old' } }),
		/Playlist not found/,
	)
	assert.equal(sent.length, 1)
})

test('library-tool source selectors use dynamic targets and retain strict explicit identity checks', async () => {
	const { sent, replacePlaylists } = fixture()
	const actions = replacePlaylists()
	for (const [id, wire, modes] of [
		['feature_playlist_properties_get', 'playlists/properties/get', ['active', 'focused', 'playing']],
		['feature_source_sync', 'playlists/source/sync', ['active', 'focused', 'playing']],
		['feature_track_refresh', 'playlists/track/refresh', ['focused', 'playing']],
	]) {
		for (const target of modes) {
			const result = parse(actions[id], { target, playlistId: 'old', trackId: 0 })
			assert.deepEqual(result.errors, {})
			await actions[id].callback({ options: result.parsed })
			assert.deepEqual(sent.at(-1), { action: wire, target })
		}
		const explicit = parse(actions[id], { target: 'explicit', playlistId: 'old', trackId: 0 })
		assert.deepEqual(explicit.errors, {})
		const before = sent.length
		await assert.rejects(actions[id].callback({ options: explicit.parsed }), /Playlist no longer exists/)
		assert.equal(sent.length, before)
	}
})

test('move and copy destinations remain strict in both host parsing and callbacks', async () => {
	const { sent, replacePlaylists } = fixture()
	const actions = replacePlaylists()
	for (const operation of ['move', 'copy']) {
		const id = `feature_track_${operation}_to`
		const options = { target: 'focused', playlistId: 'old', trackId: 0, destinationId: 'old', position: -1 }
		const rejected = parse(actions[id], options)
		assert.deepEqual(rejected.errors, { destinationId: 'Value is not in the list of choices' })
		await assert.rejects(actions[id].callback({ options }), /Playlist no longer exists/)
		assert.equal(sent.length, operation === 'move' ? 0 : 1)
		const current = parse(actions[id], { ...options, destinationId: 'current' })
		assert.deepEqual(current.errors, {})
		await actions[id].callback({ options: current.parsed })
		assert.deepEqual(sent.at(-1), {
			action: `playlists/track/${operation}-to`,
			target: 'focused',
			destination_playlist_id: 3,
			...(operation === 'copy' ? { insert_at: -1 } : {}),
		})
	}
})
