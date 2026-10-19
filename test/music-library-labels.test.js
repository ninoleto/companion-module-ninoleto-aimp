import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getMusicLibraryActions, getMusicLibraryVariableValues, initialMusicLibraryState } from '../src/sdk-library.js'

function fixture(rows, { offset = 0, selected = 0, connected = true } = {}) {
	const sent = []
	return {
		state: { connected },
		features: {
			capabilities: {
				music_library: { available: true, commands: ['musiclibrary/row/play'], storages: [] },
			},
		},
		musicLibrary: {
			...initialMusicLibraryState(),
			storage_id: 'test-storage',
			selected,
			query: { id: 'test-query', storage_id: 'test-storage', status: 'complete', offset, rows, count: rows.length },
		},
		sent,
		async _send(action, options) {
			sent.push({ action, ...options })
			return { action, ok: true }
		},
	}
}

function displayed(values, slot) {
	return Object.fromEntries(['title', 'artist', 'album'].map((field) => [field, values[`ml_row_${slot}_${field}`]]))
}

function selectedDisplay(values) {
	return Object.fromEntries(['title', 'artist', 'album'].map((field) => [field, values[`ml_selected_${field}`]]))
}

test('library row and selected labels prefer trimmed top-level strings over canonical provider fields', () => {
	const instance = fixture([
		{
			title: '  Display title  ',
			artist: '\tDisplay artist\n',
			album: ' Display album ',
			file_path: 'C:/Music/Fallback.flac',
			values: { Title: 'Provider title', Artist: 'Provider artist', Album: 'Provider album' },
		},
	])
	const values = getMusicLibraryVariableValues(instance)
	const expected = { title: 'Display title', artist: 'Display artist', album: 'Display album' }
	assert.deepEqual(displayed(values, 1), expected)
	assert.deepEqual(selectedDisplay(values), expected)
})

test('blank or non-string top-level metadata falls back to trimmed canonical values without stringifying objects', () => {
	const badValues = [undefined, null, '', ' \t\n ', 0, false, { text: 'Not a label' }, ['Not a label']]
	const rows = badValues.map((value, index) => ({
		row_id: `row-${index}`,
		title: value,
		artist: value,
		album: value,
		values: { Title: ` Title ${index} `, Artist: ` Artist ${index} `, Album: ` Album ${index} ` },
	}))
	const instance = fixture(rows)
	for (let index = 0; index < rows.length; index++) {
		instance.musicLibrary.selected = index
		const values = getMusicLibraryVariableValues(instance)
		const expected = { title: `Title ${index}`, artist: `Artist ${index}`, album: `Album ${index}` }
		assert.deepEqual(displayed(values, index + 1), expected)
		assert.deepEqual(selectedDisplay(values), expected)
	}
})

test('untitled rows show the basename from file_path before canonical FileName, retaining original playback paths', () => {
	const rows = [
		{ file_path: 'C:\\Music\\After Midnight.flac', values: { FileName: 'C:/Other/Wrong.mp3' } },
		{ title: ' ', file_path: '/home/music/First Light.ogg', values: { Title: '' } },
		{ title: null, file_path: '', values: { Title: null, FileName: 'D:\\Audio\\Untitled take.wav' } },
		{ file_path: null, values: { FileName: ' /music/Provider track.mp3 ' } },
	]
	const expected = ['After Midnight.flac', 'First Light.ogg', 'Untitled take.wav', 'Provider track.mp3']
	const instance = fixture(rows)
	const before = structuredClone(rows)
	for (let index = 0; index < rows.length; index++) {
		instance.musicLibrary.selected = index
		const values = getMusicLibraryVariableValues(instance)
		assert.equal(values[`ml_row_${index + 1}_title`], expected[index])
		assert.equal(values.ml_selected_title, expected[index])
		assert.equal(values.ml_selected_path, rows[index].file_path || '')
	}
	assert.deepEqual(rows, before, 'Display fallbacks must not replace provider paths or metadata')
})

test('canonical titles take precedence over filenames and canonical artist/album never become object strings', () => {
	const instance = fixture([
		{
			title: '',
			artist: undefined,
			album: null,
			file_path: 'C:/Music/Filename.mp3',
			values: { Title: ' Canonical title ', Artist: { Name: 'Invalid' }, Album: ['Invalid'] },
		},
	])
	const values = getMusicLibraryVariableValues(instance)
	assert.deepEqual(displayed(values, 1), { title: 'Canonical title', artist: '', album: '' })
	assert.deepEqual(selectedDisplay(values), displayed(values, 1))
})

test('rows with no usable title or filename receive their absolute result position, not a row ID', () => {
	const rows = [
		{ row_id: 'opaque-id-a', title: {}, file_path: [], values: { Title: false, FileName: { path: 'invalid' } } },
		{ row_id: 'opaque-id-b', title: '\n ', artist: 42, album: [], values: null },
		{ row_id: 'opaque-id-c', values: { Title: [], Artist: '\t ', Album: false, FileName: 42 } },
	]
	const instance = fixture(rows, { offset: 40, selected: 1 })
	const values = getMusicLibraryVariableValues(instance)
	assert.deepEqual(displayed(values, 1), { title: 'Result 41', artist: '', album: '' })
	assert.deepEqual(displayed(values, 2), { title: 'Result 42', artist: '', album: '' })
	assert.deepEqual(displayed(values, 3), { title: 'Result 43', artist: '', album: '' })
	assert.deepEqual(selectedDisplay(values), displayed(values, 2))
	assert.equal(values.ml_selected_number, 42)
})

test('missing rows and an absent query keep row and selected display variables empty', () => {
	const instance = fixture([undefined, null], { offset: 20, selected: 1 })
	let values = getMusicLibraryVariableValues(instance)
	for (const slot of [1, 2, 3, 100]) assert.deepEqual(displayed(values, slot), { title: '', artist: '', album: '' })
	assert.deepEqual(selectedDisplay(values), { title: '', artist: '', album: '' })
	assert.equal(values.ml_selected_number, 0)
	instance.musicLibrary.query = null
	values = getMusicLibraryVariableValues(instance)
	assert.deepEqual(displayed(values, 1), { title: '', artist: '', album: '' })
	assert.deepEqual(selectedDisplay(values), { title: '', artist: '', album: '' })
})

test('disconnection hides fallback labels and selected metadata even while a cached page remains', () => {
	const instance = fixture(
		[
			{
				row_id: 'row-0',
				file_path: 'C:/Music/Cached.flac',
				duration: 180,
				values: { Artist: 'Artist', Album: 'Album' },
			},
		],
		{ connected: false },
	)
	const values = getMusicLibraryVariableValues(instance)
	assert.deepEqual(displayed(values, 1), { title: '', artist: '', album: '' })
	assert.deepEqual(selectedDisplay(values), { title: '', artist: '', album: '' })
	assert.equal(values.ml_selected_path, '')
	assert.equal(values.ml_selected_duration, '')
	assert.equal(values.ml_row_1_duration, '')
	assert.equal(values.ml_selected_number, 0)
})

test('display fallbacks preserve row IDs, query IDs, action IDs, and the provider-backed play request', async () => {
	const row = {
		row_id: 'opaque/provider-row-17',
		record_id: 'record-17',
		title: '',
		artist: null,
		album: '',
		file_path: 'D:\\Music\\Untitled Recording.flac',
		values: { Title: ' Provider title ', Artist: ' Provider artist ', Album: ' Provider album ' },
		can_play: true,
	}
	const instance = fixture([row], { offset: 60 })
	const before = structuredClone(instance.musicLibrary)
	const values = getMusicLibraryVariableValues(instance)
	assert.equal(values.ml_selected_title, 'Provider title')
	assert.equal(values.ml_selected_path, row.file_path)
	const actions = getMusicLibraryActions(instance)
	assert.ok(actions.feature_ml_play)
	assert.ok(actions.feature_ml_select)
	assert.ok(actions.feature_ml_select_row)
	const choices = actions.feature_ml_play.options.find((option) => option.id === 'row_id').choices
	assert.deepEqual(
		choices.map((choice) => choice.id),
		['__selected__', row.row_id],
	)
	assert.equal(choices[1].label, 'Provider artist — Provider title')
	await actions.feature_ml_play.callback({ options: { row_id: '__selected__' } })
	await actions.feature_ml_play.callback({ options: { row_id: row.row_id, query_id: 'test-query' } })
	assert.deepEqual(instance.sent, [
		{ action: 'musiclibrary/row/play', query_id: 'test-query', row_id: row.row_id },
		{ action: 'musiclibrary/row/play', query_id: 'test-query', row_id: row.row_id },
	])
	assert.deepEqual(instance.musicLibrary, before)
})
