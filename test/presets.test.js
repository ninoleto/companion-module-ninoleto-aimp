import test from 'node:test'
import assert from 'node:assert/strict'
import { updatePresets } from '../src/presets.js'
import { allFeedbackIds } from '../src/feedbacks.js'
import { iconImages } from '../src/preset-icons.js'

const longTitle = 'LIVE AT THE ARENA — An exceptionally long original track title with mixed CASE and punctuation!'
const playlistName = 'MY AIMP PLAYLIST — An exceptionally long user-supplied playlist name'

function fixture(advancedPresets = false) {
	let result
	const instance = {
		label: 'My AIMP',
		config: { advancedPresets },
		playlistChoices: [
			{ id: 'playlist-one', label: playlistName },
			{ id: 'playlist-two', label: 'SECOND PLAYLIST' },
		],
		tracksCache: {
			'playlist-one': [
				{
					id: 'C:\\Music\\one.flac',
					path: 'C:\\Music\\one.flac',
					index: 0,
					artist: 'THE ARTIST',
					title: longTitle,
					label: longTitle,
				},
				{
					id: 'C:\\Music\\two.flac',
					path: 'C:\\Music\\two.flac',
					index: 1,
					artist: 'Another artist',
					title: 'SECOND TRACK',
					label: 'SECOND TRACK',
				},
			],
			'playlist-two': [
				{
					id: 'C:\\Music\\three.flac',
					path: 'C:\\Music\\three.flac',
					index: 0,
					artist: '',
					title: 'Third track',
					label: 'Third track',
				},
			],
		},
		setPresetDefinitions(structure, presets) {
			result = { structure, presets }
		},
	}
	updatePresets(instance)
	return result
}

function references(structure) {
	return structure.flatMap((section) =>
		section.definitions.flatMap((entry) => (typeof entry === 'string' ? [entry] : entry.presets)),
	)
}

const element = (preset, id) => preset.elements.find((item) => item.id === id)
const downAction = (preset) => preset.steps[0]?.down[0]
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

test('curated browser contains one reference per control and one Play button per track', () => {
	const { structure, presets } = fixture()
	const refs = references(structure)
	assert.equal(refs.length, 46 + 2 * 2 + 3)
	assert.equal(new Set(refs).size, refs.length)
	assert.deepEqual(new Set(refs), new Set(Object.keys(presets)), 'every exported definition is shown exactly once')
	const trackPresets = Object.entries(presets).filter(([id]) => id.startsWith('tr_'))
	assert.equal(trackPresets.length, 3)
	assert.equal(new Set(trackPresets.map(([, preset]) => JSON.stringify(downAction(preset).options))).size, 3)
	for (const [id, preset] of trackPresets) {
		assert.ok(id.endsWith('_play'))
		assert.equal(downAction(preset).options.action, 'play')
	}
})

test('advanced browser retains the full catalogue without repeated references or changed IDs', () => {
	const curated = fixture()
	const { structure, presets } = fixture(true)
	const refs = references(structure)
	assert.equal(Object.keys(presets).length, 97 + 5 * 2 + 2 * 3)
	assert.equal(refs.length, Object.keys(presets).length)
	assert.equal(new Set(refs).size, refs.length)
	assert.deepEqual(new Set(refs), new Set(Object.keys(presets)))
	for (const [id, preset] of Object.entries(curated.presets))
		assert.deepEqual(presets[id], preset, `${id} changes when advanced presets are enabled`)
	const trackPresets = Object.entries(presets).filter(([id]) => id.startsWith('tr_'))
	assert.equal(trackPresets.filter(([id]) => id.endsWith('_play')).length, 3)
	assert.equal(trackPresets.filter(([id]) => id.endsWith('_select')).length, 3)
})

test('all presets use native layered text at size 20 with shrink to fit and valid feedback targets', () => {
	const { presets } = fixture(true)
	const feedbackIds = new Set(allFeedbackIds())
	const overrideProperties = {
		box: new Set(['color']),
		image: new Set(['opacity', 'base64Image']),
		text: new Set(['color', 'text']),
	}
	for (const [id, preset] of Object.entries(presets)) {
		assert.equal(preset.type, 'layered', id)
		const elements = new Map(preset.elements.map((item) => [item.id, item]))
		assert.equal(elements.size, preset.elements.length, `${id}: repeated layer ID`)
		assert.ok(
			preset.elements.some((item) => item.type === 'text'),
			`${id}: missing text`,
		)
		for (const item of preset.elements.filter((item) => item.type === 'text')) {
			assert.equal(item.fontsize, 20, `${id}/${item.id}`)
			assert.equal(item.fontsizeAllowShrink, true, `${id}/${item.id}`)
		}
		for (const feedback of preset.feedbacks) {
			assert.ok(feedbackIds.has(feedback.feedbackId), `${id}: unknown feedback ${feedback.feedbackId}`)
			for (const override of feedback.styleOverrides) {
				const target = elements.get(override.elementId)
				assert.ok(target, `${id}: missing feedback target ${override.elementId}`)
				assert.ok(
					overrideProperties[target.type]?.has(override.elementProperty),
					`${id}: invalid ${target.type} override ${override.elementProperty}`,
				)
				assert.equal(override.override.isExpression, false)
				assert.ok(Object.hasOwn(override.override, 'value'))
			}
		}
	}
})

test('label formatting preserves connection-name case and the library warning variable', () => {
	const { presets } = fixture(true)
	const serialized = JSON.stringify(presets)
	const variables = [...serialized.matchAll(/\$\(([^:)]+):[^)]+\)/g)]
	assert.ok(variables.length > 10, 'fixture exercises variable-bearing labels and gauges')
	for (const [, connectionLabel] of variables) assert.equal(connectionLabel, 'My AIMP')
	assert.equal(element(presets.library_status, 'label').text, '$(My AIMP:library_status)')
	assert.ok(element(presets.display_elapsed, 'label').text.includes('$(My AIMP:position_fmt)'))
})

test('long track and playlist metadata retain original text in bounds separate from icons', () => {
	const { presets } = fixture(true)
	const track = Object.entries(presets).find(
		([id, preset]) => id.startsWith('tr_') && downAction(preset).options.trackId === 'C:\\Music\\one.flac',
	)?.[1]
	const playlist = Object.entries(presets).find(
		([id, preset]) => id.startsWith('pl_') && downAction(preset).options.playlistId === 'playlist-one',
	)?.[1]
	assert.ok(track)
	assert.ok(playlist)
	assert.equal(element(track, 'label').text, longTitle)
	assert.equal(element(playlist, 'label').text, playlistName)
	const metadataIds = [
		'display_now_playing',
		'display_next_track',
		'display_playing_playlist',
		'focus_playlist_display',
		'focus_track_display',
		'rotary_playlists',
		'library_status',
		'last_error',
	]
	for (const preset of [track, playlist, ...metadataIds.map((id) => presets[id])]) {
		const icon = element(preset, 'icon')
		for (const text of preset.elements.filter((item) => item.type === 'text'))
			assert.equal(intersects(text, icon), false, `${preset.name}/${text.id}: text bounds cross the icon`)
	}
})

test('playlist track navigation uses track icons and playlist selection uses playlist icons', () => {
	const { presets } = fixture(true)
	let checked = 0
	for (const preset of Object.values(presets)) {
		const expected = {
			playlist_track_prev: 'track-prev',
			playlist_track_next: 'track-next',
			focus_playlist_prev: 'playlist-prev',
			focus_playlist_next: 'playlist-next',
		}[downAction(preset)?.actionId]
		if (expected) {
			assert.equal(element(preset, 'icon').base64Image, iconImages[expected], preset.name)
			checked++
		}
	}
	assert.equal(checked, 8)
})
