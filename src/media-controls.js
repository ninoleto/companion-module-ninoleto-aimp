// Native AIMP artwork and lyrics only. No external artwork/lyrics URLs are fetched here.
const terminal = new Set(['ready', 'missing', 'error', 'idle'])
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const emptyArtwork = () => ({ track_key: '', status: 'idle', data_base64: '', mime: '', revision: 0 })
const emptyLyrics = () => ({
	track_key: '',
	status: 'idle',
	type: 'none',
	text: '',
	lines: [],
	current: null,
	previous: null,
	next: null,
	offset_ms: 0,
	line_count: 0,
	content_loaded: false,
})
export function initialMediaState() {
	return { track_key: '', artwork: emptyArtwork(), lyrics: emptyLyrics() }
}
export function initializeMedia(instance) {
	instance.mediaState = initialMediaState()
	instance._mediaCache = new Map()
	instance._mediaGeneration = 0
	instance._mediaTimers = new Map()
	instance._mediaStarted = new Set()
}
export function stopMedia(instance) {
	instance._mediaGeneration = (instance._mediaGeneration || 0) + 1
	for (const timer of instance._mediaTimers?.values() || []) clearTimeout(timer)
	instance._mediaTimers?.clear()
	clearInterval(instance._lyricsTimer)
	instance._lyricsTimer = null
}
function remember(instance) {
	const s = instance.mediaState
	if (!s.track_key) return
	instance._mediaCache.delete(s.track_key)
	instance._mediaCache.set(s.track_key, {
		artwork: terminal.has(s.artwork.status) ? { ...s.artwork } : emptyArtwork(),
		lyrics: terminal.has(s.lyrics.status) ? { ...s.lyrics } : emptyLyrics(),
	})
	while (instance._mediaCache.size > 8) instance._mediaCache.delete(instance._mediaCache.keys().next().value)
}
function setTrack(instance, key) {
	if (typeof key !== 'string' || key === instance.mediaState.track_key) return false
	remember(instance)
	stopMedia(instance)
	instance._mediaStarted.clear()
	const cached = instance._mediaCache.get(key)
	instance.mediaState = {
		track_key: key,
		artwork: cached?.artwork || emptyArtwork(),
		lyrics: cached?.lyrics
			? { ...cached.lyrics, content_loaded: false, current: null, previous: null, next: null }
			: emptyLyrics(),
	}
	if (key && instance.config?.autoMedia !== false)
		queueMicrotask(() => {
			refreshMedia(instance, false).catch(() => {})
		})
	return true
}
function validArtwork(data, cap) {
	if (data.status !== 'ready') return { ...emptyArtwork(), ...data, data_base64: '' }
	if (
		data.mime !== 'image/png' ||
		typeof data.data_base64 !== 'string' ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(data.data_base64)
	)
		return { ...emptyArtwork(), status: 'error', error: 'Invalid PNG artwork response' }
	const maximum = Math.min(262144, Number(cap?.max_artwork_bytes) || 262144)
	if (data.data_base64.length > Math.ceil(maximum / 3) * 4)
		return { ...emptyArtwork(), status: 'error', error: 'Artwork exceeds size limit' }
	const buffer = Buffer.from(data.data_base64, 'base64')
	if (
		buffer.length < 24 ||
		buffer.length > maximum ||
		!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	)
		return { ...emptyArtwork(), status: 'error', error: 'Invalid PNG artwork response' }
	const dimension = Math.min(144, Number(cap?.max_artwork_dimension) || 144)
	const width = buffer.readUInt32BE(16),
		height = buffer.readUInt32BE(20)
	if (!width || !height || width > dimension || height > dimension)
		return { ...emptyArtwork(), status: 'error', error: 'Artwork dimensions exceed limit' }
	return { ...data, width, height }
}
function syncLyricsTimer(instance) {
	const ready = instance.mediaState.lyrics.status === 'ready' && instance.mediaState.lyrics.type === 'synced'
	if (!ready) {
		clearInterval(instance._lyricsTimer)
		instance._lyricsTimer = null
		return
	}
	if (instance._lyricsTimer) return
	instance._lyricsTimer = setInterval(() => {
		if (
			instance._destroyed ||
			!instance.state.connected ||
			instance.state.playerState !== 'playing' ||
			instance._ws?.busy
		)
			return
		instance._ws?.send('media/lyrics/get', {
			expected_track_key: instance.mediaState.track_key,
			include_content: false,
		})
	}, 500)
}
export function applyMediaMessage(instance, msg) {
	if (!instance.mediaState) initializeMedia(instance)
	let changed = false
	const isContent = ['media/artwork/get', 'media/lyrics/get'].includes(msg.action)
	if (object(msg.media) && (!isContent || msg.error?.code === 'STALE_MEDIA_TRACK'))
		changed = setTrack(instance, msg.media.track_key) || changed
	const s = instance.mediaState
	for (const kind of ['artwork', 'lyrics']) {
		const full = object(msg[kind]) ? msg[kind] : null
		const summary = !isContent && object(msg.media?.[kind]) ? msg.media[kind] : null
		const data = full || summary
		if (!data || (full && data.track_key !== s.track_key) || !s.track_key) continue
		let next
		if (kind === 'artwork') {
			if (summary?.status === 'idle' && s.artwork.status === 'ready' && s.artwork.data_base64) continue
			next = full ? validArtwork(data, instance.features?.capabilities?.media) : { ...s.artwork, ...data }
			if (summary?.status === 'ready' && summary.revision !== s.artwork.revision && s.artwork.data_base64) {
				next.data_base64 = ''
				instance._mediaStarted.delete(`${s.track_key}:artwork`)
				if (instance.config?.autoMedia !== false)
					queueMicrotask(() => refreshMedia(instance, false, 'artwork').catch(() => {}))
			}
		} else {
			next = { ...s.lyrics, ...data }
			if (full && (Object.hasOwn(data, 'text') || Object.hasOwn(data, 'lines'))) next.content_loaded = true
			if (typeof next.text === 'string') next.text = next.text.slice(0, 65536)
			if (Array.isArray(next.lines)) next.lines = next.lines.slice(0, 1000)
		}
		if (JSON.stringify(next) !== JSON.stringify(s[kind])) {
			s[kind] = next
			changed = true
		}
	}
	if (changed) {
		remember(instance)
		syncLyricsTimer(instance)
	}
	return changed
}
async function fetchKind(instance, kind, refresh = false, deadline = Date.now() + 30000) {
	const key = instance.mediaState.track_key,
		epoch = instance._epoch,
		generation = instance._mediaGeneration
	if (!key || !instance._ws?.isOpen) return
	const response = await instance._ws.send(`media/${kind}/get`, {
		expected_track_key: key,
		...(refresh ? { refresh: true } : {}),
	})
	if (
		epoch !== instance._epoch ||
		generation !== instance._mediaGeneration ||
		key !== instance.mediaState.track_key ||
		!response
	)
		return
	if (response.error) {
		if (response.error.code !== 'STALE_MEDIA_TRACK') throw new Error(response.error.code || `${kind} request failed`)
		return
	}
	const status = response[kind]?.status
	if (status === 'pending') {
		if (Date.now() >= deadline) {
			instance.mediaState[kind] = {
				...instance.mediaState[kind],
				status: 'error',
				error: 'AIMP media request timed out',
			}
			instance._publish()
			return
		}
		clearTimeout(instance._mediaTimers.get(kind))
		instance._mediaTimers.set(
			kind,
			setTimeout(() => {
				instance._mediaTimers.delete(kind)
				if (generation === instance._mediaGeneration) fetchKind(instance, kind, false, deadline).catch(() => {})
			}, 500),
		)
	}
}
export async function refreshMedia(instance, force = true, only) {
	const cap = instance.features?.capabilities?.media
	if (!cap) throw new Error('Upgrade the AIMP plugin to 0.3.0 or later for artwork and lyrics.')
	if (!instance.mediaState.track_key) {
		const reply = await instance._ws?.send('media/get')
		if (!reply || !instance.mediaState.track_key) return
	}
	for (const kind of only ? [only] : ['artwork', 'lyrics']) {
		if (!cap[kind]) continue
		const id = `${instance.mediaState.track_key}:${kind}`
		if (
			!force &&
			(instance._mediaStarted.has(id) ||
				['missing', 'error'].includes(instance.mediaState[kind].status) ||
				(instance.mediaState[kind].status === 'ready' &&
					(kind === 'artwork' ? !!instance.mediaState[kind].data_base64 : instance.mediaState[kind].content_loaded)))
		)
			continue
		instance._mediaStarted.add(id)
		await fetchKind(instance, kind, force)
	}
}
export function getMediaActions(instance) {
	const cap = instance.features?.capabilities?.media,
		defs = {}
	if (cap?.artwork)
		defs.feature_artwork_refresh = {
			name: 'Artwork: refresh playing track cover',
			options: [],
			callback: async () => refreshMedia(instance, true, 'artwork'),
		}
	if (cap?.lyrics) {
		defs.feature_lyrics_refresh = {
			name: 'Lyrics: refresh playing track lyrics',
			options: [],
			callback: async () => refreshMedia(instance, true, 'lyrics'),
		}
		defs.feature_lyrics_poll = {
			name: 'Lyrics: refresh current synchronized line',
			options: [],
			callback: async () =>
				instance._send('media/lyrics/get', {
					expected_track_key: instance.mediaState.track_key,
					include_content: false,
				}),
		}
	}
	return defs
}
export function getMediaFeedbacks(instance) {
	return {
		feature_artwork: {
			type: 'value',
			name: 'Artwork: playing track cover image',
			options: [],
			callback: () => {
				const a = instance.mediaState?.artwork
				return instance.state.connected && a?.status === 'ready' && a.data_base64
					? `data:image/png;base64,${a.data_base64}`
					: ''
			},
		},
		feature_artwork_available: {
			type: 'boolean',
			name: 'Artwork: cover available',
			options: [],
			defaultStyle: { bgcolor: 0x126941, color: 0xffffff },
			callback: () =>
				!!instance.state.connected &&
				instance.mediaState?.artwork.status === 'ready' &&
				!!instance.mediaState?.artwork.data_base64,
		},
		feature_lyrics_current_available: {
			type: 'boolean',
			name: 'Lyrics: current line / plain lyrics available',
			options: [],
			defaultStyle: { bgcolor: 0x126941, color: 0xffffff },
			callback: () =>
				!!instance.state.connected &&
				!!(
					instance.mediaState?.lyrics.current?.text ||
					(instance.mediaState?.lyrics.type === 'plain' && instance.mediaState?.lyrics.text)
				),
		},
		feature_lyrics_available: {
			type: 'boolean',
			name: 'Lyrics: available',
			options: [],
			defaultStyle: { bgcolor: 0x126941, color: 0xffffff },
			callback: () => !!instance.state.connected && instance.mediaState?.lyrics.status === 'ready',
		},
	}
}
export function getMediaVariableDefinitions() {
	return Object.fromEntries(
		Object.entries({
			artwork_status: 'Artwork retrieval status',
			artwork_track_key: 'Playing media identity',
			lyrics_status: 'Lyrics retrieval status',
			lyrics_type: 'Lyrics type (synced/plain/none)',
			lyrics_current: 'Current synchronized lyric line',
			lyrics_previous: 'Previous synchronized lyric line',
			lyrics_next: 'Next synchronized lyric line',
			lyrics_excerpt: 'First 240 characters of plain lyrics',
			lyrics_text: 'Lyrics text (up to 64 KiB)',
			lyrics_offset_ms: 'Lyrics time offset (ms)',
			lyrics_line_index: 'Current lyric line index (0-based; -1 if none)',
			lyrics_line_count: 'Lyrics line count',
		}).map(([id, name]) => [id, { name }]),
	)
}
export function getMediaVariableValues(instance) {
	const s = instance.mediaState || initialMediaState(),
		connected = !!instance.state.connected,
		l = s.lyrics
	return {
		artwork_status: connected ? s.artwork.status : 'disconnected',
		artwork_track_key: connected ? s.track_key : '',
		lyrics_status: connected ? l.status : 'disconnected',
		lyrics_type: connected ? l.type : 'none',
		lyrics_current: connected
			? l.current?.text || (l.type === 'plain' ? l.text?.split(/\r?\n/).find((line) => line.trim()) || '' : '')
			: '',
		lyrics_previous: connected ? l.previous?.text || '' : '',
		lyrics_next: connected ? l.next?.text || '' : '',
		lyrics_excerpt: connected ? (l.text || '').slice(0, 240) : '',
		lyrics_text: connected ? l.text || '' : '',
		lyrics_offset_ms: connected ? l.offset_ms || 0 : 0,
		lyrics_line_index: connected ? (l.current?.index ?? -1) : -1,
		lyrics_line_count: connected ? l.line_count || 0 : 0,
	}
}
