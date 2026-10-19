// These are snapshots of explicit inspection requests, not live player state.
// Keep summaries separate from last_response so its JSON remains available.
const inspections = {
	'playlists/info': {
		variable: 'playlist_info_summary',
		name: 'Last requested playlist information (button summary)',
		format: (reply) => playlistSummary(reply.playlist),
	},
	'playlists/track/info': {
		variable: 'track_info_summary',
		name: 'Last requested track information (button summary)',
		format: (reply) => trackSummary(reply.track),
	},
	'player/fileinfo': {
		variable: 'file_info_summary',
		name: 'Last requested playing file information (button summary)',
		format: (reply) => fileSummary(reply.file_info),
	},
	'playlists/properties/get': {
		variable: 'playlist_properties_summary',
		name: 'Last requested playlist properties (button summary)',
		format: (reply) => propertiesSummary(reply.playlist_properties),
	},
}

const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0
function shortText(value, limit = 32) {
	if (typeof value !== 'string') return ''
	const text = value.replace(/\s+/g, ' ').trim()
	const characters = Array.from(text)
	return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : text
}
function fileName(value) {
	return typeof value === 'string' ? shortText(value.split(/[\\/]/).pop()) : ''
}
function playlistSummary(playlist) {
	if (!object(playlist)) return 'No playlist information'
	const lines = [shortText(playlist.name) || 'Playlist']
	if (Number.isInteger(playlist.track_count) && playlist.track_count >= 0)
		lines.push(`${playlist.track_count} ${playlist.track_count === 1 ? 'track' : 'tracks'}`)
	else lines.push('Track count unavailable')
	return lines.join('\n')
}
function trackSummary(track) {
	if (!object(track)) return 'No track information'
	return [shortText(track.title) || fileName(track.file_path) || 'Title unavailable', shortText(track.artist)]
		.filter(Boolean)
		.join('\n')
}
function fileSummary(info) {
	if (info === null) return 'No playing file'
	if (!object(info)) return 'No file information'
	const audio = []
	if (positive(info.sample_rate)) audio.push(`${Number((info.sample_rate / 1000).toFixed(3))} kHz`)
	if (positive(info.bit_depth)) audio.push(`${info.bit_depth}-bit`)
	return [shortText(info.codec), audio.join(' / ')].filter(Boolean).join('\n') || 'Audio details unavailable'
}
function propertiesSummary(properties) {
	if (!object(properties) || !object(properties.values) || !object(properties.available))
		return 'No playlist properties'
	const available = Object.keys(properties.values).filter((id) => properties.available[id] === true)
	let custom = 0,
		inherited = 0
	for (const id of ['grouping_override', 'format_override', 'view_override']) {
		if (!available.includes(id)) continue
		if (properties.values[id] === true) custom++
		else if (properties.values[id] === false) inherited++
	}
	const count = `${available.length} ${available.length === 1 ? 'property' : 'properties'}`
	return `${count}\n${custom + inherited ? `${custom} custom / ${inherited} inherited` : 'Overrides unavailable'}`
}

export function initialInspectionResults() {
	return Object.fromEntries(Object.values(inspections).map(({ variable }) => [variable, 'Press to read']))
}

export function inspectionVariableDefinitions() {
	return Object.fromEntries(Object.values(inspections).map(({ variable, name }) => [variable, { name }]))
}

export function updateInspectionResult(results, action, reply) {
	const inspection = inspections[action]
	if (!inspection) return false
	if (!reply || reply.error) return failInspectionResult(results, action)
	results[inspection.variable] = inspection.format(reply)
	return true
}

export function failInspectionResult(results, action) {
	const inspection = inspections[action]
	if (!inspection) return false
	results[inspection.variable] = 'Read failed\nSee last error'
	return true
}
