const number = (id, label, value, min, max) => ({ type: 'number', id, label, default: value, min, max })
function finite(value, min, max) {
	value = Number(value)
	if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Value must be between ${min} and ${max}.`)
	return value
}
export function extraActions(instance, choices, first) {
	const playlist = () => ({
		type: 'dropdown',
		id: 'playlistId',
		label: 'Playlist',
		choices,
		default: first,
		useCustom: true,
	})
	const plIndex = (id) => {
		const index = instance._playlistIndex(id)
		if (index == null) throw new Error('Playlist not found. Refresh the library and select a playlist.')
		return index
	}
	const mode = () => ({
		type: 'dropdown',
		id: 'action',
		label: 'Operation',
		default: 'play',
		choices: [
			{ id: 'play', label: 'Play' },
			{ id: 'select', label: 'Select without playing' },
		],
	})
	const defs = {
		seek_relative: {
			name: 'Seek: forward / backward by seconds',
			options: [number('seconds', 'Seconds (negative = backward)', 5, -36000, 36000)],
			callback: async ({ options }) => {
				const delta = finite(options.seconds, -36000, 36000)
				const position = Math.max(0, Math.min(instance.state.duration || 36000, instance.state.position + delta))
				await instance._send('player/position/set', { position })
			},
		},
		playlist_resume: {
			name: 'Playlist: resume',
			options: [playlist()],
			callback: async ({ options }) => instance._send('playlists/resume', { playlist_id: plIndex(options.playlistId) }),
		},
		refresh_status: {
			name: 'Refresh: player status',
			options: [],
			callback: async () => instance._send('player/status'),
		},
		refresh_library: {
			name: 'Refresh: playlists and all track lists',
			options: [],
			callback: async () => instance._refreshPlaylists(true),
		},
		refresh_volume: {
			name: 'Refresh: volume and mute',
			options: [],
			callback: async () => instance._send('player/volume/get'),
		},
		refresh_focus: {
			name: 'Refresh: playlist / track focus',
			options: [],
			callback: async () => instance._send('focus/get'),
		},
		playlist_info: {
			name: 'Inspect: playlist (last_response variable)',
			options: [playlist()],
			callback: async ({ options }) =>
				instance._send('playlists/get/one', { playlist_id: plIndex(options.playlistId) }),
		},
		track_info: {
			name: 'Inspect: track (last_response variable)',
			options: [playlist(), number('trackId', 'Track index (0-based)', 0, 0, 99999)],
			callback: async ({ options }) =>
				instance._send('playlists/track/get', {
					playlist_id: plIndex(options.playlistId),
					track_id: Math.trunc(finite(options.trackId, 0, 99999)),
				}),
		},
		track_action_browse: {
			name: 'Track: play / select by file path or saved track key',
			options: [
				playlist(),
				{ type: 'textinput', id: 'trackId', label: 'Track file path / saved key', default: '', useVariables: true },
				mode(),
			],
			callback: async ({ options }) => {
				const index = plIndex(options.playlistId)
				await instance._ensureTracksLoaded(options.playlistId)
				const track = instance._trackIndex(options.playlistId, options.trackId)
				if (track == null)
					throw new Error('Track not found in this playlist. Refresh the library; no track was played.')
				await instance._send(options.action === 'select' ? 'playlists/track/select' : 'playlists/track/play', {
					playlist_id: index,
					track_id: track,
				})
			},
		},
	}
	const trackCallback = defs.track_action_browse.callback
	const tracks = Object.entries(instance.tracksCache).flatMap(([id, list]) =>
		list.map((t) => ({ id: JSON.stringify([id, t.id]), label: `${instance._playlistNameById(id)} / ${t.label}` })),
	)
	defs.track_browse = {
		name: 'Track: browse all playlists and play / select',
		options: [
			{
				type: 'dropdown',
				id: 'track',
				label: 'Playlist / Track',
				choices: tracks.length ? tracks : [{ id: '', label: '(no tracks loaded)' }],
				default: tracks[0]?.id || '',
				useCustom: true,
				minChoicesForSearch: 5,
			},
			mode(),
		],
		callback: async ({ options }) => {
			const [playlistId, trackId] = JSON.parse(options.track)
			return trackCallback({ options: { playlistId, trackId, action: options.action } })
		},
	}
	for (const [id, label, get, toggle, wire] of [
		['mute', 'Mute', 'player/volume/get', 'player/mute', 'muted'],
		['shuffle', 'Shuffle', 'player/shuffle/get', 'player/shuffle/toggle', 'shuffle'],
		['repeat', 'Repeat track', 'player/repeat/get', 'player/repeat/toggle', 'repeat'],
		['auto_jump', 'Auto advance', 'player/auto-jump/get', 'player/auto-jump/toggle', 'auto_jump'],
	]) {
		defs[`${id}_set`] = {
			name: `${label}: set on / off`,
			options: [{ type: 'checkbox', id: 'enabled', label: 'Enabled', default: true }],
			callback: async ({ options }) => {
				const reply = await instance._send(get)
				if (!reply || typeof reply[wire] !== 'boolean')
					throw new Error(`Cannot read ${label} state; no toggle was sent.`)
				if (reply[wire] !== !!options.enabled) await instance._send(toggle)
			},
		}
		if (id !== 'mute')
			defs[`refresh_${id}`] = { name: `Refresh: ${label}`, options: [], callback: async () => instance._send(get) }
	}
	for (const [id, delta, label] of [
		['playlist_track_next', 1, 'next'],
		['playlist_track_prev', -1, 'previous'],
	]) {
		defs[id] = {
			name: `Playlist: play ${label} track`,
			options: [playlist()],
			callback: async ({ options }) => {
				const key = options.playlistId,
					playlist_id = plIndex(key)
				await instance._ensureTracksLoaded(key)
				const count = instance.tracksTotal[key]
				if (!Number.isInteger(count) || count <= 0)
					throw new Error('Playlist is empty or its track count is unavailable.')
				let current =
					instance.state.playingPlaylistId === key
						? instance.state.playingTrackIndex
						: instance.state.focusPlaylistId === key
							? instance.state.focusTrackIndex
							: -1
				if (!Number.isInteger(current) || current < 0) current = delta > 0 ? -1 : 0
				await instance._send('playlists/track/play', { playlist_id, track_id: (current + delta + count) % count })
			},
		}
	}
	return defs
}
