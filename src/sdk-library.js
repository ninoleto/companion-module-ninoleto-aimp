// Asynchronous SDK music-library browsing; only provider-returned rows can be played.
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const displayText = (value) => (typeof value === 'string' ? value.trim() : '')
// Display fallbacks never replace the provider's row ID, path or metadata.
function resultDisplay(row, query, index) {
	if (!object(row)) return { title: '', artist: '', album: '', duration: '' }
	const path = displayText(row.file_path) || displayText(row.values?.FileName)
	const filename = displayText(path.split(/[\\/]/).pop())
	const offset = Number.isSafeInteger(query?.offset) && query.offset >= 0 ? query.offset : 0
	return {
		title: displayText(row.title) || displayText(row.values?.Title) || filename || `Result ${offset + index + 1}`,
		artist: displayText(row.artist) || displayText(row.values?.Artist),
		album: displayText(row.album) || displayText(row.values?.Album),
		duration: row.duration ?? '',
	}
}
const select = (id, label, choices, value = choices[0]?.id || '') => ({
	type: 'dropdown',
	id,
	label,
	choices,
	default: value,
})
const input = (id, label, value = '') => ({ type: 'textinput', id, label, default: value })
const num = (id, label, value, min, max) => ({ type: 'number', id, label, default: value, min, max, step: 1 })
const def = (name, options, callback) => ({
	name,
	options,
	callback: async ({ options = {} } = {}) => callback(options),
})
export function initialMusicLibraryState() {
	return {
		storages: [],
		storage_id: '',
		active_storage: '',
		fields: [],
		query: null,
		selected: 0,
		request: null,
		history: [],
		historyIndex: -1,
		error: '',
		operation: null,
		ui: { available: false, path: '' },
	}
}
export function initializeMusicLibrary(instance) {
	instance.musicLibrary = initialMusicLibraryState()
	instance._musicLibraryGeneration = 0
	instance._musicLibraryTimer = null
	instance._musicLibraryQueryId = null
}
export function stopMusicLibrary(instance, stopAll = false) {
	if (stopAll) {
		clearTimeout(instance._musicOperationTimer)
		instance._musicOperationTimer = null
	}
	clearTimeout(instance._musicLibraryTimer)
	instance._musicLibraryTimer = null
	instance._musicLibraryGeneration = (instance._musicLibraryGeneration || 0) + 1
}
function fail(condition, text) {
	if (condition) throw new Error(text)
}
function capability(instance) {
	const c = instance.features?.capabilities?.music_library
	fail(
		!c?.available,
		'AIMP music-library browsing is unavailable. Upgrade the plugin or enable a supported AIMP music-library provider.',
	)
	return c
}
function can(instance, command) {
	const c = capability(instance)
	fail(!c.commands?.includes(command), `${command} is not available in this AIMP library provider.`)
	return c
}
function storages(instance) {
	return (
		instance.musicLibrary?.storages.length
			? instance.musicLibrary.storages
			: instance.features?.capabilities?.music_library?.storages || []
	).filter((s) => s.can_query)
}
export function applyMusicLibraryMessage(instance, msg) {
	instance.musicLibrary ||= initialMusicLibraryState()
	const s = instance.musicLibrary,
		m = msg.music_library
	let changed = false
	if (msg.capabilities?.music_library?.storages) {
		s.storages = msg.capabilities.music_library.storages
		s.active_storage = msg.capabilities.music_library.active_storage || ''
		changed = true
	}
	if (!object(m)) return changed
	if (typeof m.active_storage === 'string') {
		s.active_storage = m.active_storage
		changed = true
	}
	if (Array.isArray(m.storages)) {
		s.storages = m.storages
		changed = true
	}
	if (object(m.fields)) {
		s.fields = m.fields.fields || []
		s.storage_id = m.fields.storage_id || s.storage_id
		s.schema = m.fields
		changed = true
	}
	if (object(m.ui)) {
		s.ui = m.ui
		changed = true
	}
	if (
		object(m.operation) &&
		(msg.action !== 'musiclibrary/operation/get' || !s.operation || s.operation.id === m.operation.id)
	) {
		s.operation = m.operation
		changed = true
	}
	if (object(m.query)) {
		const q = m.query
		if (msg.action === 'musiclibrary/query') instance._musicLibraryQueryId = q.id
		if (q.id !== instance._musicLibraryQueryId) return changed
		const prior = s.query?.id
		s.query = { ...q, rows: Array.isArray(q.rows) ? q.rows.slice(0, 100) : [] }
		if (q.storage_id) s.storage_id = q.storage_id
		if (prior !== q.id) s.selected = 0
		if (q.status === 'complete' && !s.history.includes(q.id)) {
			s.history = [...s.history.slice(0, s.historyIndex + 1), q.id].slice(-16)
			s.historyIndex = s.history.length - 1
		}
		s.error =
			q.status === 'failed' ? String(q.error?.message || q.error?.code || q.error || 'Library query failed') : ''
		changed = true
	}
	return changed
}
async function poll(instance, id, generation, deadline) {
	if (generation !== instance._musicLibraryGeneration || !instance._ws?.isOpen) return
	const reply = await instance._send('musiclibrary/query/get', { query_id: id })
	if (generation !== instance._musicLibraryGeneration || !reply) return
	if (reply.music_library?.query?.status === 'pending') {
		if (Date.now() >= deadline) {
			instance.musicLibrary.error = 'Music-library query timed out; cancel the query before retrying.'
			instance._publish()
			return
		}
		instance._musicLibraryTimer = setTimeout(() => {
			poll(instance, id, generation, deadline).catch((e) => {
				instance.musicLibrary.error = e.message
				instance._publish()
			})
		}, 500)
	}
}
export async function queryMusicLibrary(instance, params, { remember = true } = {}) {
	can(instance, 'musiclibrary/query')
	fail(
		instance.musicLibrary.query?.status === 'pending',
		'A music-library query is already running. Cancel it before starting another.',
	)
	stopMusicLibrary(instance)
	if (remember) {
		instance.musicLibrary.request = { ...params }
		instance.musicLibrary.history = []
		instance.musicLibrary.historyIndex = -1
	}
	const generation = instance._musicLibraryGeneration
	const response = await instance._send('musiclibrary/query', params)
	if (!response || generation !== instance._musicLibraryGeneration) return
	const query = response.music_library?.query
	fail(!query?.id, 'AIMP did not provide a music-library query ID.')
	if (query.status === 'pending')
		instance._musicLibraryTimer = setTimeout(() => {
			poll(instance, query.id, generation, Date.now() + 30000).catch((e) => {
				instance.musicLibrary.error = e.message
				instance._publish()
			})
		}, 500)
}
async function queueOperation(instance, command, params) {
	const reply = await instance._send(command, params)
	const operation = reply?.music_library?.operation
	if (!operation?.id || !['queued', 'executing'].includes(operation.status)) return reply
	clearTimeout(instance._musicOperationTimer)
	const epoch = instance._epoch,
		deadline = Date.now() + 60000
	const read = async () => {
		if (epoch !== instance._epoch || !instance._ws?.isOpen || instance.musicLibrary.operation?.id !== operation.id)
			return
		const current = await instance._send('musiclibrary/operation/get')
		if (epoch !== instance._epoch || Date.now() >= deadline) return
		if (['queued', 'executing'].includes(current?.music_library?.operation?.status))
			instance._musicOperationTimer = setTimeout(() => read().catch(() => {}), 1000)
	}
	instance._musicOperationTimer = setTimeout(() => read().catch(() => {}), 1000)
	return reply
}
function parsedArray(value, label, max) {
	let result
	try {
		result = JSON.parse(value || '[]')
	} catch {
		throw new Error(`${label} must be a JSON array.`)
	}
	fail(!Array.isArray(result) || result.length > max, `${label} must contain no more than ${max} entries.`)
	return result
}
function row(instance, id) {
	const s = instance.musicLibrary
	fail(s.query?.status !== 'complete', 'Run a music-library query and wait for its results.')
	const item =
		id === '__selected__' || id == null
			? s.query.rows[s.selected]
			: s.query.rows.find((r) => String(r.row_id) === String(id))
	fail(!item, 'This library row is no longer available. Refresh the query and choose a result.')
	return item
}
export function getMusicLibraryActions(instance) {
	const cap = instance.features?.capabilities?.music_library
	if (!cap?.available) return {}
	instance.musicLibrary ||= initialMusicLibraryState()
	const s = instance.musicLibrary,
		defs = {},
		available = new Set(cap.commands || [])
	const storageOptions = () =>
		select(
			'storage_id',
			'Music-library storage',
			storages(instance).map((item) => ({ id: item.id, label: item.name || item.id })),
		)
	const add = (id, wire, name, options, callback) => {
		if (available.has(wire)) defs[id] = def(name, options, callback)
	}
	add('feature_ml_storages', 'musiclibrary/storages/get', 'Music library: refresh storages', [], () =>
		instance._send('musiclibrary/storages/get'),
	)
	add(
		'feature_ml_storage_select',
		'musiclibrary/storage/select',
		'Music library: select active AIMP storage',
		[
			select(
				'storage_id',
				'Storage',
				(s.storages.length ? s.storages : cap.storages || []).map((storage) => ({
					id: storage.id,
					label: storage.name || storage.id,
				})),
			),
		],
		(o) => {
			fail(
				!(s.storages.length ? s.storages : cap.storages || []).some((storage) => storage.id === o.storage_id),
				'Select an available music-library storage.',
			)
			return instance._send('musiclibrary/storage/select', { storage_id: o.storage_id })
		},
	)
	add(
		'feature_ml_fields',
		'musiclibrary/fields/get',
		'Music library: inspect fields / filter operators',
		[storageOptions()],
		(o) => instance._send('musiclibrary/fields/get', { storage_id: o.storage_id }),
	)
	const searchOptions = [storageOptions(), input('search', 'Search text'), num('limit', 'Results per page', 20, 1, 100)]
	const search = async (o, advanced) => {
		const storage = storages(instance).find((item) => item.id === o.storage_id)
		fail(!storage, 'Select a queryable music-library storage.')
		fail(typeof o.search !== 'string' || o.search.length > 512, 'Search text must be no longer than 512 characters.')
		fail(!Number.isInteger(Number(o.limit)) || o.limit < 1 || o.limit > 100, 'Page size must be 1–100.')
		const params = { storage_id: o.storage_id, search: o.search, offset: 0, limit: Number(o.limit) }
		if (advanced) {
			params.filters = parsedArray(o.filters, 'Filters', 8)
			params.sort = parsedArray(o.sort, 'Sort fields', 3)
			params.match = o.match === 'any' ? 'any' : 'all'
		}
		await queryMusicLibrary(instance, params)
	}
	add('feature_ml_search', 'musiclibrary/query', 'Music library: search / browse first page', searchOptions, (o) =>
		search(o, false),
	)
	add(
		'feature_ml_query',
		'musiclibrary/query',
		'Music library: query with filters and sort',
		[
			...searchOptions,
			input('filters', 'Filters JSON (use Inspect fields for IDs/operators)', '[]'),
			input('sort', 'Sort JSON [{"field":"Artist","direction":"asc"}]', '[]'),
			select('match', 'Match filters', [
				{ id: 'all', label: 'All' },
				{ id: 'any', label: 'Any' },
			]),
		],
		(o) => search(o, true),
	)
	add('feature_ml_refresh', 'musiclibrary/query', 'Music library: refresh current search', [], () => {
		fail(!s.request, 'Start a music-library search first.')
		return queryMusicLibrary(instance, { ...s.request, offset: 0 })
	})
	add('feature_ml_next_page', 'musiclibrary/query', 'Music library: next results page', [], async () => {
		fail(s.query?.status !== 'complete', 'Wait for the current music-library query to finish.')
		if (s.historyIndex + 1 < s.history.length) {
			stopMusicLibrary(instance)
			const id = s.history[++s.historyIndex]
			instance._musicLibraryQueryId = id
			return instance._send('musiclibrary/query/get', { query_id: id })
		}
		fail(
			!s.query.has_more || (!s.query.next_cursor && !Number.isInteger(s.query.next_offset)),
			'There is no next music-library results page within the provider limits.',
		)
		return queryMusicLibrary(
			instance,
			s.query.next_cursor ? { cursor: s.query.next_cursor } : { ...s.request, offset: s.query.next_offset },
			{ remember: false },
		)
	})
	add('feature_ml_previous_page', 'musiclibrary/query/get', 'Music library: previous results page', [], async () => {
		fail(s.query?.status === 'pending' || s.historyIndex <= 0, 'There is no previous cached results page.')
		stopMusicLibrary(instance)
		const id = s.history[--s.historyIndex]
		instance._musicLibraryQueryId = id
		return instance._send('musiclibrary/query/get', { query_id: id })
	})
	add('feature_ml_cancel', 'musiclibrary/query/cancel', 'Music library: cancel running query', [], async () => {
		fail(!s.query?.id, 'There is no music-library query to cancel.')
		stopMusicLibrary(instance)
		const id = s.query.id,
			generation = instance._musicLibraryGeneration
		const reply = await instance._send('musiclibrary/query/cancel', { query_id: id })
		if (reply?.music_library?.query?.status === 'pending')
			instance._musicLibraryTimer = setTimeout(() => {
				poll(instance, id, generation, Date.now() + 30000).catch((e) => {
					s.error = e.message
					instance._publish()
				})
			}, 500)
		return reply
	})
	defs.feature_ml_select = def(
		'Music library: select previous / next result',
		[num('delta', 'Rows (negative = previous)', 1, -100, 100)],
		(o) => {
			fail(!s.query?.rows?.length, 'There are no music-library results.')
			const delta = Number(o.delta)
			fail(!Number.isInteger(delta), 'Row step must be an integer.')
			s.selected = Math.max(0, Math.min(s.query.rows.length - 1, s.selected + delta))
			instance._publish()
		},
	)
	defs.feature_ml_select_row = def(
		'Music library: select result in current page',
		[num('index', 'Page row (0-based)', 0, 0, 99)],
		(o) => {
			const index = Number(o.index)
			fail(!Number.isInteger(index) || index < 0 || index >= (s.query?.rows?.length || 0), 'This result slot is empty.')
			s.selected = index
			instance._publish()
		},
	)
	for (const operation of ['play', 'add', 'queue']) {
		const wire = `musiclibrary/row/${operation}`
		const options = [
			select('row_id', 'Result', [
				{ id: '__selected__', label: 'Currently selected result' },
				...(s.query?.rows || []).map((r, index) => {
					const display = resultDisplay(r, s.query, index)
					return {
						id: String(r.row_id),
						label: `${display.artist ? `${display.artist} — ` : ''}${display.title}`,
					}
				}),
			]),
		]
		options.push(
			input('query_id', 'Query ID (required for a fixed result; ignored for selected result)', s.query?.id || ''),
		)
		if (operation === 'add')
			options.push(
				select('playlistId', 'Destination playlist', [
					{ id: '__active__', label: 'Active AIMP playlist' },
					...(instance.playlistChoices || []),
				]),
			)
		if (operation === 'queue')
			options.push({
				type: 'checkbox',
				id: 'first',
				label: 'Place first in queue (track must already be in a loaded playlist)',
				default: false,
			})
		add(
			`feature_ml_${operation}`,
			wire,
			`Music library: ${operation === 'queue' ? 'queue loaded track' : operation} result`,
			options,
			(o) => {
				can(instance, wire)
				if (o.row_id !== '__selected__' && o.row_id != null && o.query_id !== s.query?.id)
					throw new Error('This saved result belongs to an expired query. Select a current result instead.')
				const item = row(instance, o.row_id)
				fail(
					item[`can_${operation}`] !== true,
					`This library row cannot be ${operation === 'queue' ? 'queued' : operation === 'play' ? 'played' : 'added'}.`,
				)
				const params = { query_id: s.query.id, row_id: item.row_id }
				if (operation === 'queue') params.first = !!o.first
				if (operation === 'add' && o.playlistId && o.playlistId !== '__active__') {
					const index = instance._playlistIndex(o.playlistId)
					fail(!Number.isInteger(index) || index < 0, 'Destination playlist is no longer available.')
					params.playlist_id = index
				}
				return instance._send(wire, params)
			},
		)
	}
	const operationStorages = s.storages.length ? s.storages : cap.storages || []
	const storageOperations = ['add_files', 'reload_tags', 'add_files_dialog', 'report_dialog'].filter((command) =>
		operationStorages.some((storage) => storage.commands?.[command]),
	)
	if (storageOperations.length)
		add(
			'feature_ml_storage_command',
			'musiclibrary/storage/command',
			'Music library storage: import / reload / open dialog',
			[
				select(
					'storage_id',
					'Storage',
					operationStorages.map((storage) => ({ id: storage.id, label: storage.name || storage.id })),
				),
				select(
					'command',
					'Command',
					storageOperations.map((id) => ({ id, label: id.replaceAll('_', ' ') })),
				),
				input('files', 'Files JSON (add_files only)', '[]'),
			],
			(o) => {
				const storage = operationStorages.find((item) => item.id === o.storage_id)
				fail(!storage?.commands?.[o.command], 'This storage does not support the selected operation.')
				const params = { storage_id: o.storage_id, command: o.command }
				if (o.command === 'add_files') {
					const files = parsedArray(o.files, 'Files', 100)
					fail(
						!files.length ||
							files.some((f) => typeof f !== 'string' || !f.trim() || Buffer.byteLength(f, 'utf8') > 16384),
						'Provide 1–100 nonempty file paths.',
					)
					params.files = files
				}
				return queueOperation(instance, 'musiclibrary/storage/command', params)
			},
		)
	for (const operation of ['remove', 'reload_tags', 'mark']) {
		if (!operationStorages.some((storage) => storage.commands?.[`row_${operation}`])) continue
		const options =
			operation === 'remove'
				? [
						{
							type: 'checkbox',
							id: 'confirm',
							label: 'Remove the selected database record (keeps the media file)',
							default: false,
						},
					]
				: operation === 'mark'
					? [{ ...num('value', 'Library rating (0 = unrated)', 0, 0, 5), step: 0.5 }]
					: []
		add(
			`feature_ml_row_${operation}`,
			`musiclibrary/row/${operation}`,
			`Music library selected record: ${operation.replaceAll('_', ' ')}`,
			options,
			(o) => {
				const item = row(instance, '__selected__'),
					storage = operationStorages.find((x) => x.id === s.query.storage_id)
				fail(!storage?.commands?.[`row_${operation}`], 'This storage does not support the selected record operation.')
				fail(item[`can_${operation}`] === false, 'This result does not support the selected record operation.')
				const params = { query_id: s.query.id, row_id: item.row_id }
				if (operation === 'remove') {
					fail(o.confirm !== true, 'Enable confirmation before removing the database record.')
					params.confirm = true
				}
				if (operation === 'mark') {
					const value = Number(o.value)
					fail(!Number.isFinite(value) || value < 0 || value > 5, 'Library rating must be from 0 to 5.')
					params.value = value
				}
				return queueOperation(instance, `musiclibrary/row/${operation}`, params)
			},
		)
	}
	add(
		'feature_ml_operation_refresh',
		'musiclibrary/operation/get',
		'Music library: refresh queued operation status',
		[],
		() => instance._send('musiclibrary/operation/get'),
	)
	add('feature_ml_ui_get', 'musiclibrary/ui/get', 'Music library: read grouping-tree path', [], () =>
		instance._send('musiclibrary/ui/get'),
	)
	add(
		'feature_ml_ui_path_set',
		'musiclibrary/ui/path/set',
		'Music library: focus grouping-tree path',
		[input('path', 'Grouping-tree path')],
		(o) => instance._send('musiclibrary/ui/path/set', { path: String(o.path || '') }),
	)
	return defs
}
export function getMusicLibraryFeedbacks(instance) {
	const fb = (name, callback) => ({
		type: 'boolean',
		name,
		options: [],
		defaultStyle: { bgcolor: 0x126941, color: 0xffffff },
		callback: () => !!instance.state.connected && callback(instance.musicLibrary || initialMusicLibraryState()),
	})
	return {
		feature_ml_row_available: {
			type: 'boolean',
			name: 'Music library: page slot contains a result',
			options: [num('index', 'Page row (0-based)', 0, 0, 99)],
			defaultStyle: { bgcolor: 0x126941, color: 0xffffff },
			callback: ({ options }) =>
				!!instance.state.connected && !!instance.musicLibrary?.query?.rows?.[Number(options.index)],
		},
		feature_ml_row_is_selected: {
			type: 'boolean',
			name: 'Music library: page slot selected',
			options: [num('index', 'Page row (0-based)', 0, 0, 99)],
			defaultStyle: { bgcolor: 0x126941, color: 0xffffff },
			callback: ({ options }) =>
				!!instance.state.connected &&
				!!instance.musicLibrary?.query?.rows?.[Number(options.index)] &&
				instance.musicLibrary.selected === Number(options.index),
		},
		feature_ml_pending: fb('Music library: query running', (s) => s.query?.status === 'pending'),
		feature_ml_has_next: fb(
			'Music library: more results available',
			(s) =>
				s.query?.status === 'complete' &&
				(s.historyIndex + 1 < s.history.length ||
					(s.query.has_more && (!!s.query.next_cursor || Number.isInteger(s.query.next_offset)))),
		),
		feature_ml_has_previous: fb('Music library: previous results page available', (s) => s.historyIndex > 0),
		feature_ml_has_results: fb('Music library: results available', (s) => !!s.query?.rows?.length),
		feature_ml_row_selected: {
			type: 'boolean',
			name: 'Music library: result selected',
			options: [input('row_id', 'Row ID')],
			defaultStyle: { bgcolor: 0x126941, color: 0xffffff },
			callback: ({ options }) =>
				!!instance.state.connected &&
				String(instance.musicLibrary?.query?.rows?.[instance.musicLibrary.selected]?.row_id) === String(options.row_id),
		},
	}
}
export function getMusicLibraryVariableDefinitions(instance) {
	const defs = Object.fromEntries(
		Object.entries({
			ml_operation_status: 'Queued music-library operation status',
			ml_operation_command: 'Queued music-library operation command',
			ml_operation_error: 'Queued music-library operation diagnostic',
			ml_ui_path: 'Music-library grouping-tree focus path',
			ml_status: 'Music-library query status',
			ml_error: 'Music-library diagnostic',
			ml_storage: 'Music-library storage ID',
			ml_active_storage: 'Active AIMP music-library storage ID',
			ml_search: 'Current music-library search',
			ml_result_count: 'Rows in current results page',
			ml_page_start: 'First result position (1-based)',
			ml_page_end: 'Last result position',
			ml_selected_number: 'Selected result position (1-based)',
			ml_selected_title: 'Selected library result display title (title, filename or result number)',
			ml_selected_artist: 'Selected library result artist',
			ml_selected_album: 'Selected library result album',
			ml_selected_path: 'Selected library result file URI',
			ml_selected_duration: 'Selected library result duration (s)',
			ml_has_more: 'More music-library results available',
		}).map(([id, name]) => [id, { name }]),
	)
	if (instance?.features?.capabilities?.music_library?.available)
		for (let index = 1; index <= 100; index++)
			for (const field of ['title', 'artist', 'album', 'duration'])
				defs[`ml_row_${index}_${field}`] = {
					name: `Music library page row ${index}: ${field === 'title' ? 'display title (title, filename or result number)' : field}`,
				}
	return defs
}
export function getMusicLibraryVariableValues(instance) {
	const s = instance.musicLibrary || initialMusicLibraryState(),
		q = s.query,
		r = q?.rows?.[s.selected],
		c = instance.state.connected
	const selectedDisplay = resultDisplay(r, q, s.selected)
	const values = {
		ml_operation_status: c ? s.operation?.status || '' : '',
		ml_operation_command: c ? s.operation?.command || '' : '',
		ml_operation_error: c ? String(s.operation?.error?.code || s.operation?.error || '') : '',
		ml_ui_path: c ? s.ui?.path || '' : '',
		ml_status: !c ? 'Disconnected' : q?.status || 'No query',
		ml_error: s.error,
		ml_storage: c ? s.storage_id : '',
		ml_active_storage: c ? s.active_storage || '' : '',
		ml_search: s.request?.search || '',
		ml_result_count: c ? (q?.count ?? q?.rows?.length ?? 0) : 0,
		ml_page_start: c && q?.rows?.length ? q.offset + 1 : 0,
		ml_page_end: c ? (q?.offset || 0) + (q?.rows?.length || 0) : 0,
		ml_selected_number: c && r ? q.offset + s.selected + 1 : 0,
		ml_selected_title: c ? selectedDisplay.title : '',
		ml_selected_artist: c ? selectedDisplay.artist : '',
		ml_selected_album: c ? selectedDisplay.album : '',
		ml_selected_path: c ? r?.file_path || '' : '',
		ml_selected_duration: c ? (r?.duration ?? '') : '',
		ml_has_more: c && !!q?.has_more,
	}
	if (instance.features?.capabilities?.music_library?.available)
		for (let index = 1; index <= 100; index++) {
			const display = resultDisplay(q?.rows?.[index - 1], q, index - 1)
			for (const field of ['title', 'artist', 'album', 'duration'])
				values[`ml_row_${index}_${field}`] = c ? display[field] : ''
		}
	return values
}
