// Playlist/source/tag operations exposed only when advertised by the native bridge.
import { formatCommandError } from './command-diagnostics.js'

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const num = (id, label, value, min = 0, max = 999999) => ({
	type: 'number',
	id,
	label,
	default: value,
	min,
	max,
	step: 1,
})
const text = (id, label, value = '') => ({ type: 'textinput', id, label, default: value })
const drop = (id, label, choices, value = choices[0]?.id ?? '') => ({
	type: 'dropdown',
	id,
	label,
	default: value,
	choices,
})
const check = (id, label, value = false) => ({ type: 'checkbox', id, label, default: value })
const def = (name, options, callback) => ({
	name,
	options,
	callback: async ({ options = {} } = {}) => callback(options),
})
const modes = () =>
	drop('mode', 'Operation', [
		{ id: 'on', label: 'On' },
		{ id: 'off', label: 'Off' },
	])
function finite(v, min, max, integer = true) {
	const n = Number(v)
	if (v === '' || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n)))
		throw new Error(`Value must be ${integer ? 'an integer ' : ''}between ${min} and ${max}.`)
	return n
}
const confirmed = (o) => {
	if (o.confirm !== true)
		throw new Error('This action changes saved file data. Enable its confirmation checkbox before executing.')
}
export function initialLibraryToolsState() {
	return { properties: {}, groups: { items: [] }, source: {}, tags: { fields: {} }, app_action: null }
}
export function applyLibraryToolsMessage(instance, msg) {
	instance.libraryTools ||= initialLibraryToolsState()
	let changed = false
	for (const [wire, key] of [
		['playlist_properties', 'properties'],
		['groups', 'groups'],
		['playlist_source', 'source'],
		['tags', 'tags'],
		['app_action', 'app_action'],
	])
		if (object(msg[wire])) {
			instance.libraryTools[key] = msg[wire]
			changed = true
		}
	return changed
}
function playlistOptions(instance, id = 'playlistId', label = 'Playlist') {
	return drop(
		id,
		label,
		instance.playlistChoices?.length ? instance.playlistChoices : [{ id: '', label: '(load a playlist first)' }],
	)
}
function playlistIndex(instance, id) {
	const n = instance._playlistIndex(id)
	if (!Number.isInteger(n) || n < 0)
		throw new Error('Playlist no longer exists. Refresh the library and choose it again.')
	return n
}
function targets(instance, kind) {
	return [
		drop(
			'target',
			'Target',
			(kind === 'track' ? ['focused', 'playing', 'explicit'] : ['active', 'focused', 'playing', 'explicit']).map(
				(id) => ({
					id,
					label: id === 'explicit' ? 'Playlist / track specified below' : id.charAt(0).toUpperCase() + id.slice(1),
				}),
			),
		),
		{
			...playlistOptions(instance, 'playlistId', 'Playlist (explicit target only)'),
			// This source field is unused for active/focused/playing targets.
			// Accept a saved stale value at the host parser; target() still resolves
			// and validates every explicit source before sending a command.
			// Destination selectors keep their strict live-list validation.
			allowCustom: true,
		},
		...(kind === 'track' ? [num('trackId', 'Track index (0-based; explicit target only)', 0)] : []),
	]
}
function target(instance, kind, o) {
	const mode = o.target || (kind === 'track' ? 'focused' : 'active')
	if (
		!(kind === 'track' ? ['focused', 'playing', 'explicit'] : ['active', 'focused', 'playing', 'explicit']).includes(
			mode,
		)
	)
		throw new Error('Select a valid target.')
	return mode === 'explicit'
		? {
				target: mode,
				playlist_id: playlistIndex(instance, o.playlistId),
				...(kind === 'track' ? { track_id: finite(o.trackId, 0, 999999) } : {}),
			}
		: { target: mode }
}
function nonempty(value, label, max = 4096) {
	if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > max)
		throw new Error(`${label} is required and must be no longer than ${max} UTF-8 bytes.`)
	return value
}
function catalog(value) {
	return Array.isArray(value) ? value : Object.entries(value || {}).map(([id, d]) => ({ id, ...d }))
}
const propertyOverrides = {
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
function propertyValue(descriptor, value) {
	const label = descriptor.label || descriptor.id
	if (descriptor.type === 'boolean') {
		if (typeof value !== 'boolean') throw new Error(`${label}: choose On or Off.`)
		return value
	}
	if (descriptor.type === 'string') {
		if (
			typeof value !== 'string' ||
			value.includes('\0') ||
			Buffer.byteLength(value, 'utf8') > (descriptor.max_length ?? 4096) ||
			(descriptor.id === 'name' && !value.trim())
		)
			throw new Error(`${label}: enter valid text within ${descriptor.max_length ?? 4096} UTF-8 bytes.`)
		return value
	}
	if (descriptor.type === 'enum') {
		if (!descriptor.choices?.some((choice) => choice.id === value))
			throw new Error(`${label}: select a supported value.`)
		return value
	}
	if (!['number', 'string'].includes(typeof value)) throw new Error(`${label}: enter an integer.`)
	return finite(value, descriptor.min ?? -2147483648, descriptor.max ?? 2147483647)
}
function checkedReply(reply) {
	if (reply?.error) throw new Error(formatCommandError(reply.error))
	return reply
}
function propertyReadback(reply, index, parameter, expected) {
	checkedReply(reply)
	const properties = reply?.playlist_properties
	if (!properties || properties.playlist_id !== index)
		throw new Error('AIMP returned a different or unidentified playlist. Refresh the library and retry.')
	if (properties.available?.[parameter] === false || !Object.hasOwn(properties.values || {}, parameter))
		throw new Error(`Playlist property ${parameter} is unavailable on this playlist or AIMP version.`)
	if (arguments.length > 3 && properties.values[parameter] !== expected)
		throw new Error(
			`AIMP did not apply playlist property ${parameter}; the returned value was ${JSON.stringify(properties.values[parameter])}.`,
		)
	return properties
}
async function setPlaylistProperty(instance, descriptor, options) {
	// Validate before enabling an override: malformed templates must not change settings.
	const value = propertyValue(descriptor, options.value)
	const commands = instance.features?.capabilities?.library?.commands || []
	if (
		!['playlists/info', 'playlists/properties/get', 'playlists/properties/set'].every((cmd) => commands.includes(cmd))
	)
		throw new Error('This plugin cannot safely read and update playlist properties.')
	const selection = target(instance, 'playlist', options)
	const info = checkedReply(await instance._send('playlists/info', selection))?.playlist
	if (!Number.isInteger(info?.id) || info.id < 0 || typeof info.aimp_id !== 'string' || !info.aimp_id)
		throw new Error('AIMP could not identify the target playlist. Refresh the library and retry.')
	const identity = info.aimp_id
	if (selection.target === 'explicit' && identity !== String(options.playlistId))
		throw new Error('The selected playlist changed. Refresh the library and choose it again.')
	if (['focused_index', 'playback_cursor', 'playing_index'].includes(descriptor.id)) {
		if (!Number.isInteger(info.track_count) || value < -1 || value >= info.track_count)
			throw new Error(`Track index must be between -1 and ${(info.track_count ?? 0) - 1} for this playlist.`)
	}
	if (instance._playlistIndex(identity) !== info.id && typeof instance._refreshPlaylists === 'function')
		await instance._refreshPlaylists(true)
	let confirmedIndex = info.id
	async function pinnedTarget() {
		const index = playlistIndex(instance, identity)
		if (index !== confirmedIndex) {
			const current = checkedReply(
				await instance._send('playlists/info', { target: 'explicit', playlist_id: index }),
			)?.playlist
			if (current?.aimp_id !== identity || current.id !== index)
				throw new Error('The target playlist changed. Refresh the library and retry.')
			confirmedIndex = index
		}
		return { target: 'explicit', playlist_id: index }
	}
	const initialTarget = await pinnedTarget()
	const initial = propertyReadback(
		await instance._send('playlists/properties/get', initialTarget),
		initialTarget.playlist_id,
		descriptor.id,
	)
	const override = propertyOverrides[descriptor.id]
	if (override && initial.values[override] !== true) {
		if (initial.available?.[override] === false || !Object.hasOwn(initial.values, override))
			throw new Error(`AIMP cannot enable ${override} for this playlist; no settings were changed.`)
		const params = await pinnedTarget()
		propertyReadback(
			await instance._send('playlists/properties/set', { ...params, parameter: override, value: true }),
			params.playlist_id,
			override,
			true,
		)
	}
	const params = await pinnedTarget()
	const reply = await instance._send('playlists/properties/set', { ...params, parameter: descriptor.id, value })
	propertyReadback(reply, params.playlist_id, descriptor.id, value)
	return reply
}
export function getLibraryToolActions(instance) {
	const lib = instance.features?.capabilities?.library,
		commands = new Set(lib?.commands || []),
		defs = {}
	const add = (id, command, name, options, params) => {
		if (commands.has(command))
			defs[id] = def(name, options, async (o) => {
				if (!instance.features?.capabilities?.library?.commands?.includes(command))
					throw new Error('This playlist operation is unavailable in the current plugin.')
				return instance._send(command, typeof params === 'function' ? await params(o) : params)
			})
	}
	add(
		'feature_playlist_import',
		'playlists/import',
		'Playlist: import saved playlist file / URL',
		[text('uri', 'Playlist file path or URL on AIMP computer'), check('activate', 'Activate imported playlist', true)],
		(o) => ({ uri: nonempty(o.uri, 'Playlist file'), activate: !!o.activate }),
	)
	for (const operation of ['move', 'copy'])
		add(
			`feature_track_${operation}_to`,
			`playlists/track/${operation}-to`,
			`Track: ${operation} to another playlist`,
			[
				...targets(instance, 'track'),
				playlistOptions(instance, 'destinationId', 'Destination playlist'),
				...(operation === 'copy' ? [num('position', 'Insert position (-1 = append)', -1, -1)] : []),
			],
			(o) => ({
				...target(instance, 'track', o),
				destination_playlist_id: playlistIndex(instance, o.destinationId),
				...(operation === 'copy' ? { insert_at: finite(o.position, -1, 999999) } : {}),
			}),
		)
	add(
		'feature_track_selected',
		'playlists/track/selected',
		'Track: select / deselect',
		[...targets(instance, 'track'), check('selected', 'Selected', true)],
		(o) => ({ ...target(instance, 'track', o), value: !!o.selected }),
	)
	add(
		'feature_track_refresh',
		'playlists/track/refresh',
		'Track: reload file information',
		targets(instance, 'track'),
		(o) => target(instance, 'track', o),
	)
	add(
		'feature_selection_set',
		'playlists/selection/set',
		'Playlist selection: all / none / invert',
		[
			...targets(instance, 'playlist'),
			drop('mode', 'Selection', [
				{ id: 'all', label: 'Select all' },
				{ id: 'none', label: 'Deselect all' },
				{ id: 'invert', label: 'Invert selection' },
			]),
		],
		(o) => ({ ...target(instance, 'playlist', o), mode: o.mode }),
	)
	add(
		'feature_groups_get',
		'playlists/groups/get',
		'Playlist groups: inspect page (last_response)',
		[
			...targets(instance, 'playlist'),
			num('offset', 'First group index', 0),
			num('limit', 'Groups per page', 100, 1, 250),
		],
		(o) => ({
			...target(instance, 'playlist', o),
			offset: finite(o.offset, 0, 999999),
			limit: finite(o.limit, 1, 250),
		}),
	)
	add(
		'feature_group_set',
		'playlists/group/set',
		'Playlist group: expand / select',
		[
			...targets(instance, 'playlist'),
			num('group', 'Group index (0-based)', 0),
			drop('parameter', 'Property', [
				{ id: 'expanded', label: 'Expanded' },
				{ id: 'selected', label: 'Selected' },
			]),
			check('value', 'Enabled', true),
		],
		(o) => ({
			...target(instance, 'playlist', o),
			group_index: finite(o.group, 0, 999999),
			parameter: o.parameter,
			value: !!o.value,
		}),
	)
	add(
		'feature_groups_merge',
		'playlists/groups/merge',
		'Playlist groups: merge groups',
		[...targets(instance, 'playlist'), num('group', 'Group index (-1 = all)', -1, -1)],
		(o) => ({
			...target(instance, 'playlist', o),
			...(Number(o.group) === -1 ? {} : { group_index: finite(o.group, 0, 999999) }),
		}),
	)
	add(
		'feature_playlist_properties_get',
		'playlists/properties/get',
		'Playlist: inspect display / playback properties',
		targets(instance, 'playlist'),
		(o) => target(instance, 'playlist', o),
	)
	for (const d of catalog(lib?.playlist_properties).filter((d) => d.available !== false && d.writable !== false)) {
		const options =
			d.type === 'boolean'
				? [check('value', 'Enabled', true)]
				: d.type === 'enum'
					? [drop('value', d.label || d.id, d.choices || [])]
					: d.type === 'string'
						? [text('value', d.label || d.id)]
						: [num('value', d.label || d.id, d.default ?? d.min ?? 0, d.min ?? -2147483648, d.max ?? 2147483647)]
		if (commands.has('playlists/properties/set'))
			defs[`feature_playlist_property_${d.id}`] = def(
				`Playlist property: ${d.label || d.id}`,
				[
					...targets(instance, 'playlist'),
					...options,
					{
						type: 'static-text',
						id: 'property_help',
						label: 'How this setting works',
						value: `Active means the playlist tab selected in AIMP. ${propertyOverrides[d.id] ? 'This action enables the required per-playlist override, then applies and checks this setting. Other playlists and global settings are unchanged.' : 'This action applies and checks the selected playlist property.'} ${d.type === 'string' ? 'Enter the required text or AIMP formatting template above; this action does not open an editor.' : d.type === 'boolean' ? 'On and Off set a value; pressing the same value again has no additional effect.' : 'Indices are 0-based; -1 means no item. These properties are not transport Play commands.'}`,
					},
				],
				(o) => setPlaylistProperty(instance, d, o),
			)
	}
	add(
		'feature_playlist_sort_template',
		'playlists/sort/template',
		'Playlist: sort using AIMP format template',
		[...targets(instance, 'playlist'), text('template', 'AIMP sort template')],
		(o) => ({ ...target(instance, 'playlist', o), template: nonempty(o.template, 'Sort template') }),
	)
	add(
		'feature_playlist_refresh',
		'playlists/refresh',
		'Playlist: refresh file information',
		[
			...targets(instance, 'playlist'),
			drop('mode', 'Tracks', [
				{ id: 'all', label: 'All tracks' },
				{ id: 'selected', label: 'Selected tracks' },
				{ id: 'missing', label: 'Missing file information' },
			]),
		],
		(o) => ({ ...target(instance, 'playlist', o), mode: o.mode }),
	)
	add(
		'feature_source_get',
		'playlists/source/get',
		'Playlist source: inspect synchronization source',
		targets(instance, 'playlist'),
		(o) => target(instance, 'playlist', o),
	)
	const sourceTypes = catalog(lib?.source_types).map((d) =>
		typeof d === 'string' ? { id: d, label: d } : { id: d.id, label: d.label || d.id },
	)
	if (sourceTypes.length)
		add(
			'feature_source_create',
			'playlists/source/create',
			'Playlist source: create folder / playlist source',
			[
				...targets(instance, 'playlist'),
				drop('kind', 'Source type', sourceTypes),
				text('uri', 'Playlist file / URL (playlist source only)'),
				text('folders', 'Folders JSON [{"path":"D:\\\\Music","recursive":true}]', '[]'),
				check('autosync', 'Synchronize automatically'),
				check('startup', 'Synchronize at AIMP startup'),
				text('sort_template', 'AIMP sort template (optional)'),
			],
			(o) => {
				const params = {
					...target(instance, 'playlist', o),
					kind: o.kind,
					autosync: !!o.autosync,
					autosync_on_startup: !!o.startup,
				}
				if (o.kind === 'playlist') params.uri = nonempty(o.uri, 'Playlist source')
				else if (o.kind === 'folders') {
					let folders
					try {
						folders = JSON.parse(o.folders)
					} catch {
						throw new Error('Folders must be a JSON array of path / recursive objects.')
					}
					if (
						!Array.isArray(folders) ||
						!folders.length ||
						folders.length > 64 ||
						folders.some(
							(f) => !object(f) || typeof f.path !== 'string' || !f.path.trim() || typeof f.recursive !== 'boolean',
						)
					)
						throw new Error('Provide 1–64 folders, each with a path and boolean recursive value.')
					params.folders = folders
				} else throw new Error('Select a supported source type.')
				if (o.sort_template) params.sort_template = String(o.sort_template)
				return params
			},
		)
	add(
		'feature_source_set',
		'playlists/source/set',
		'Playlist source: configure autosync / sorting',
		[
			...targets(instance, 'playlist'),
			drop('parameter', 'Property', [
				{ id: 'autosync', label: 'Automatic synchronization' },
				{ id: 'autosync_on_startup', label: 'Synchronize at startup' },
				{ id: 'sort_template', label: 'Sort template' },
			]),
			check('enabled', 'Enabled'),
			text('template', 'Sort template'),
		],
		(o) => ({
			...target(instance, 'playlist', o),
			parameter: o.parameter,
			value: o.parameter === 'sort_template' ? String(o.template || '') : !!o.enabled,
		}),
	)
	add(
		'feature_source_sync',
		'playlists/source/sync',
		'Playlist source: synchronize now',
		targets(instance, 'playlist'),
		(o) => target(instance, 'playlist', o),
	)
	add(
		'feature_source_clear',
		'playlists/source/clear',
		'Playlist source: remove synchronization source',
		targets(instance, 'playlist'),
		(o) => target(instance, 'playlist', o),
	)
	const tags = instance.features?.capabilities?.tags
	if (tags?.available) {
		defs.feature_tags_get = def('Tags: read file tags (last_response)', targets(instance, 'track'), (o) =>
			instance._send('tags/get', target(instance, 'track', o)),
		)
		const fields = catalog(tags.fields).filter((d) => d.writable !== false)
		defs.feature_tags_write = def(
			'Tags: write one file tag (changes the media file)',
			[
				...targets(instance, 'track'),
				drop(
					'field',
					'Tag field',
					fields.map((d) => ({ id: d.id, label: d.label || d.id })),
				),
				text('value', 'New tag value (empty text clears a text tag)'),
				check('confirm', 'I intend to modify the media file on disk'),
			],
			async (o) => {
				confirmed(o)
				const field = catalog(instance.features?.capabilities?.tags?.fields).find(
					(d) => d.id === o.field && d.writable !== false,
				)
				if (!field) throw new Error('Tag field is unavailable.')
				let value = o.value
				if (field.type === 'number' || field.type === 'integer')
					value = finite(value, field.min ?? 0, field.max ?? 2147483647, field.type === 'integer')
				else if (typeof value !== 'string' || value.length > (field.max_length || 4096))
					throw new Error('Tag value exceeds its supported length.')
				const params = target(instance, 'track', o)
				const reply = await instance._send('tags/get', params)
				if (!reply?.tags?.file_path) throw new Error('Cannot resolve the file to edit; no tags were written.')
				return instance._send('tags/write', {
					...params,
					fields: { [field.id]: value },
					confirm: true,
					expected_file_path: reply.tags.file_path,
				})
			},
		)
	}
	return defs
}
export function getLibraryToolFeedbacks(instance) {
	return {
		feature_source_autosync: {
			type: 'boolean',
			name: 'Playlist source: autosync enabled',
			options: [],
			defaultStyle: { bgcolor: 0x126941, color: 0xffffff },
			callback: () => !!instance.state.connected && instance.libraryTools?.source.autosync === true,
		},
	}
}
export function getLibraryToolVariableDefinitions() {
	return Object.fromEntries(
		Object.entries({
			playlist_group_count: 'Last inspected playlist group count',
			playlist_source_type: 'Last inspected playlist source type',
			playlist_source_autosync: 'Playlist source autosync',
			playlist_source_startup: 'Playlist source sync at startup',
			playlist_source_sort: 'Playlist source sort template',
			tags_file_path: 'Last inspected tag file path',
			tags_count: 'Last inspected file tag count',
		}).map(([id, name]) => [id, { name }]),
	)
}
export function getLibraryToolVariableValues(instance) {
	const s = instance.libraryTools || initialLibraryToolsState(),
		c = instance.state.connected
	return {
		playlist_group_count: c ? (s.groups.count ?? s.groups.total ?? 0) : 0,
		playlist_source_type: c ? s.source.kind || s.source.factory_id || '' : '',
		playlist_source_autosync: c && !!s.source.autosync,
		playlist_source_startup: c && !!s.source.autosync_on_startup,
		playlist_source_sort: c ? s.source.sort_template || '' : '',
		tags_file_path: c ? s.tags.file_path || '' : '',
		tags_count: c ? s.tags.tag_count || 0 : 0,
	}
}
