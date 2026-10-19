// AIMP Companion Control; derived from companion-module-aimp-audioplayer 2.0.1 (MIT).
import { InstanceBase, InstanceStatus } from '@companion-module/base'
import { buildInitialState } from './state.js'
import { getConfigFields } from './config.js'
import { registerVariables, updateVariables } from './variables.js'
import { registerFeedbacks, allFeedbackIds } from './feedbacks.js'
import { buildActions } from './actions.js'
import { updatePresets } from './presets.js'
import { AimpWsClient } from './ws-client.js'
import { initialFeatureState, applyFeatureMessage, getFeatureActions } from './feature-controls.js'
import { initializeMedia, stopMedia, applyMediaMessage } from './media-controls.js'
import { initializeMusicLibrary, stopMusicLibrary, applyMusicLibraryMessage } from './sdk-library.js'
import { initialLibraryToolsState, applyLibraryToolsMessage } from './library-tools.js'
import { deferredCommandError, formatCommandError } from './command-diagnostics.js'
import { initialInspectionResults, updateInspectionResult, failInspectionResult } from './inspection-results.js'

export { UpgradeScripts } from './upgrades.js'

export default class AimpControl extends InstanceBase {
	constructor(context) {
		super(context)
		this._epoch = 0
		this._destroyed = false
		this._ws = null
		this._actionChain = Promise.resolve()
		this._actionPending = 0
		this._resetCaches()
	}
	getConfigFields() {
		return getConfigFields()
	}
	async init(config) {
		this.config = { host: '127.0.0.1', port: 19122, trackLimit: 10000, trackPresets: true, ...config }
		this._destroyed = false
		registerVariables(this)
		this._register()
		this._connect()
	}
	async configUpdated(config) {
		this._teardown()
		this._resetCaches()
		await this.init(config)
	}
	async destroy() {
		this._destroyed = true
		this._teardown()
	}
	_register() {
		registerVariables(this)
		const actions = { ...buildActions(this), ...getFeatureActions(this) }
		for (const def of Object.values(actions)) {
			const callback = def.callback
			def.callback = (event, context) => this._execute(() => callback(event, context))
		}
		this.setActionDefinitions(actions)
		registerFeedbacks(this)
		updatePresets(this)
		this._publish()
	}
	_execute(fn) {
		if (this._actionPending >= 256) {
			this.log('warn', 'Action queue full; command was not sent.')
			return Promise.resolve()
		}
		const epoch = this._epoch
		this._actionPending++
		const next = this._actionChain
			.then(async () => {
				if (this._destroyed || epoch !== this._epoch) return
				try {
					await fn()
				} catch (err) {
					this.log('warn', err.message)
					this.state.lastCommandError = err.message
					this._publish()
				}
			})
			.finally(() => {
				this._actionPending--
			})
		this._actionChain = next.catch(() => {})
		return next
	}
	_publish() {
		updateVariables(this)
		this.checkFeedbacks(...allFeedbackIds(this))
	}
	_setConnection(status, text, connected = false) {
		this.state.connected = connected
		this.state.connectionStatus = text
		this.updateStatus(status, text)
		this._publish()
	}
	_connect() {
		let client
		try {
			client = new AimpWsClient({ host: this.config.host, port: this.config.port, log: (l, m) => this.log(l, m) })
		} catch (err) {
			this._setConnection(InstanceStatus.BadConfig, err.message)
			return
		}
		this._ws = client
		this.state.endpoint = client.url
		client.on('connecting', () => {
			if (this._ws === client && !this._destroyed)
				this._setConnection(InstanceStatus.Connecting, `Connecting to ${client.url}`)
		})
		client.on('open', () => {
			if (this._ws !== client || this._destroyed) return
			this._epoch++
			this._resetCaches()
			this.state.endpoint = client.url
			this._setConnection(InstanceStatus.Connecting, 'WebSocket open; waiting for AIMP player status')
			this._starting = true
			this._startupDeadline = Date.now() + 30000
			const epoch = this._epoch
			this._onConnected(epoch)
				.catch((err) => {
					if (epoch === this._epoch && !this._destroyed) {
						this.log('warn', err.message)
						this._setConnection(InstanceStatus.ConnectionFailure, err.message)
					}
				})
				.finally(() => {
					if (epoch === this._epoch) this._starting = false
				})
		})
		client.on('close', (reason) => {
			if (this._ws !== client || this._destroyed) return
			this._epoch++
			this._stopTimers()
			this._resetCaches()
			this.state.endpoint = client.url
			this._setConnection(InstanceStatus.ConnectionFailure, reason)
			this._register()
		})
		client.on('message', (msg) => {
			if (this._ws === client && !this._destroyed) this._onMessage(msg)
		})
		client.connect()
	}
	_stopTimers() {
		stopMedia(this)
		stopMusicLibrary(this, true)
		clearTimeout(this._startupTimer)
		this._startupResolve?.()
		this._startupResolve = null
		clearInterval(this._featuresTimer)
		clearTimeout(this._libraryRefreshTimer)
		clearInterval(this._inventoryTimer)
		clearInterval(this._heartbeatTimer)
		clearTimeout(this._statusTimer)
		this._inventoryTimer = this._heartbeatTimer = this._statusTimer = null
		this._featuresTimer = this._libraryRefreshTimer = null
	}
	_teardown() {
		this._epoch++
		this._stopTimers()
		const client = this._ws
		this._ws = null
		client?.close()
	}
	_resetCaches() {
		this._deferredFailureSignatures = new Map()
		this.inspectionResults = initialInspectionResults()
		if (this.mediaState) stopMedia(this)
		if (this.musicLibrary) stopMusicLibrary(this, true)
		initializeMedia(this)
		initializeMusicLibrary(this)
		this.libraryTools = initialLibraryToolsState()
		this.features = initialFeatureState()
		this._featureSignature = ''
		this.state = {
			...buildInitialState(),
			focusTrackIndex: -1,
			playingTrackIndex: -1,
			connected: false,
			connectionStatus: 'Disconnected',
			endpoint: '',
			lastCommandError: '',
			lastResponse: '',
			playlistCount: 0,
			loadedTrackCount: 0,
			libraryStatus: 'Waiting for connection',
		}
		this.playlistChoices = []
		this.playlistsMap = Object.create(null)
		this.tracksCache = Object.create(null)
		this.tracksMap = Object.create(null)
		this.tracksTotal = Object.create(null)
		this.tracksError = Object.create(null)
		this._tracksInflight = new Map()
		this._inventoryInflight = null
		this._lastLibrarySignature = ''
		this._browseActivePlaylist = null
	}
	async _startupSend(action, params) {
		const epoch = this._epoch
		do {
			const reply = await this._ws?.send(action, params)
			if (!this._starting || reply?.error?.code !== 'AIMP_LOADING') return reply
			if (Date.now() >= this._startupDeadline)
				throw new Error(
					'AIMP is still loading after 30 seconds. Reconnect this connection after AIMP finishes starting.',
				)
			this._setConnection(InstanceStatus.Connecting, 'AIMP is loading; waiting for its SDK services')
			await new Promise((resolve) => {
				this._startupResolve = resolve
				this._startupTimer = setTimeout(resolve, 500)
			})
		} while (epoch === this._epoch && !this._destroyed && this._ws?.isOpen)
		return null
	}
	async _onConnected(epoch) {
		const status = await this._startupSend('player/status')
		if (epoch !== this._epoch || this._destroyed) return
		if (!['playing', 'paused', 'stopped'].includes(status?.state)) {
			this._setConnection(
				InstanceStatus.ConnectionFailure,
				'WebSocket opened, but player/status was invalid. Check that this port belongs to AIMP Companion Control.',
			)
			return
		}
		this._heartbeatTimer = setInterval(() => {
			if (!this._ws?.busy) this._ws?.send('player/status')
		}, 5000)
		await this._refreshPlaylists()
		if (epoch !== this._epoch || this._destroyed) return
		await this._discoverFeatures(epoch)
		if (epoch !== this._epoch || this._destroyed) return
		this._inventoryTimer = setInterval(
			() => this._refreshPlaylists().catch((err) => this.log('warn', err.message)),
			30000,
		)
	}
	async _discoverFeatures(epoch) {
		const reply = await this._startupSend('capabilities/get')
		if (epoch !== this._epoch || this._destroyed) return
		if (!reply?.capabilities || Number(reply.protocol_version) < 2) {
			// The 0.1 bridge answers UNKNOWN_ACTION. Its established controls stay usable.
			this._register()
			return
		}
		await this._startupSend('extensions/get')
		if (epoch !== this._epoch || this._destroyed) return
		this._featuresTimer = setInterval(() => {
			if (epoch === this._epoch && !this._ws?.busy && this.state.connected) this._ws?.send('extensions/get')
		}, 2000)
	}
	_updateFeatures(msg) {
		const featuresChanged = applyFeatureMessage(this, msg)
		const mediaChanged = applyMediaMessage(this, msg)
		const libraryChanged = applyMusicLibraryMessage(this, msg)
		const toolsChanged = applyLibraryToolsMessage(this, msg)
		if (!featuresChanged && !mediaChanged && !libraryChanged && !toolsChanged) return
		const signature = JSON.stringify([
			this.features.capabilities,
			this.features.equalizer?.bands?.map((b) => [b.index, b.frequency]),
			this.features.equalizer?.presets,
			this.features.output?.devices,
			this.features.skins?.installed,
			this.musicLibrary.storages,
			this.musicLibrary.fields,
			this.musicLibrary.query?.id,
			this.musicLibrary.query?.rows?.map((r) => [r.row_id, r.title, r.artist]),
		])
		if (signature !== this._featureSignature) {
			this._featureSignature = signature
			this._register()
		}
	}
	_onMessage(msg) {
		if (!msg || typeof msg !== 'object') return
		// A multi-property write can fail after an earlier write succeeded. Apply
		// the plugin's authoritative readback even when the response has an error.
		this._updateFeatures(msg)
		this._reportDeferredFailures(msg)
		if (msg.error) {
			if (msg.error?.code === 'STALE_MEDIA_TRACK' || (this._starting && msg.error?.code === 'AIMP_LOADING')) {
				this._publish()
				return
			}
			if (msg.action === 'capabilities/get' && msg.error?.code === 'UNKNOWN_ACTION') return
			const reason = formatCommandError(msg.error)
			this.state.lastCommandError = `${msg.action || 'AIMP'}: ${reason}`
			this.log('warn', this.state.lastCommandError)
			this._publish()
			return
		}
		const full = typeof msg.event === 'string' && msg.event !== 'position'
		if (full && ['playing', 'paused', 'stopped'].includes(msg.state)) {
			this.state.playerState = msg.state
			if (!this.state.connected) this._setConnection(InstanceStatus.Ok, 'Connected to AIMP', true)
		}
		const playerReply = msg.action?.startsWith('player/')
		if (full || playerReply || msg.event === 'position') {
			for (const key of ['volume', 'position', 'duration'])
				if (typeof msg[key] === 'number' && Number.isFinite(msg[key])) this.state[key] = Math.max(0, msg[key])
			for (const [wire, state] of [
				['muted', 'muted'],
				['shuffle', 'shuffle'],
				['repeat', 'repeat'],
				['auto_jump', 'autoJump'],
			]) {
				if (msg[wire] !== undefined) this.state[state] = !!msg[wire]
			}
			if (playerReply && ['paused', 'stopped', 'playing'].includes(msg.state)) this.state.playerState = msg.state
		}
		for (const [wire, prefix] of [
			['playing_playlist', 'playingPlaylist'],
			['focus_playlist', 'focusPlaylist'],
		]) {
			if (Object.hasOwn(msg, wire)) {
				const p = msg[wire]
				this.state[prefix + 'Id'] = p ? String(p.aimp_id ?? p.id) : ''
				this.state[prefix + 'Name'] = p?.name || ''
			}
		}
		for (const [wire, prefix, playlist] of [
			['playing_track', 'playingTrack', 'playingPlaylistId'],
			['focus_track', 'focusTrack', 'focusPlaylistId'],
		]) {
			if (Object.hasOwn(msg, wire)) {
				const t = msg[wire]
				const cached = this.tracksCache[this.state[playlist]]?.find((x) => x.index === t?.id)
				this.state[prefix + 'Id'] = t ? cached?.id || t.file_path || String(t.id) : ''
				this.state[prefix + 'Title'] = t?.title || ''
				this.state[prefix + 'Artist'] = t?.artist || ''
				this.state[prefix + 'Index'] = t?.id ?? -1
			}
		}
		if (Object.hasOwn(msg, 'next_track')) {
			this.state.nextTrackTitle = msg.next_track?.title || ''
			this.state.nextTrackArtist = msg.next_track?.artist || ''
		}
		this._publish()
	}
	_reportDeferredFailures(msg) {
		for (const [source, command] of [
			['app/command', msg.last_app_command],
			['app/action/execute', msg.app_control?.last_action],
		]) {
			if (!command || typeof command !== 'object') continue
			const reason = deferredCommandError(command)
			if (!reason) {
				this._deferredFailureSignatures.delete(source)
				continue
			}
			const message = `${source} (${command.command || command.id || 'unknown'}): ${reason}`
			// Polls repeat the last result. Report each execution failure once,
			// without overwriting a newer error on every two-second state poll.
			if (this._deferredFailureSignatures.get(source) === message) continue
			this._deferredFailureSignatures.set(source, message)
			this.state.lastCommandError = message
			this.log('warn', message)
		}
	}
	async _send(action, params) {
		const epoch = this._epoch
		let reply
		try {
			if (!this._ws?.isOpen) throw new Error('AIMP is not connected. Check the connection status.')
			reply = await this._ws.send(action, params)
			if (epoch !== this._epoch || this._destroyed) return null
			if (!reply) throw new Error(`No response to ${action}; command was not replayed.`)
			if (reply.error) throw new Error(this.state.lastCommandError || `${action} failed`)
		} catch (error) {
			if (epoch === this._epoch && !this._destroyed && failInspectionResult(this.inspectionResults, action))
				this._publish()
			throw error
		}
		updateInspectionResult(this.inspectionResults, action, reply)
		// A successful read or queue acknowledgement does not prove that a
		// previous command succeeded. Keep its diagnostic until a later write.
		if (
			!action.endsWith('/get') &&
			!['player/status', 'playlists/get/one'].includes(action) &&
			reply.acknowledgement !== 'queued' &&
			!deferredCommandError(reply.last_app_command) &&
			!deferredCommandError(reply.app_control?.last_action)
		)
			this.state.lastCommandError = ''
		this.state.lastResponse = JSON.stringify(reply).slice(0, 4096)
		if (reply.library_changed) this._scheduleLibraryRefresh(reply.accepted ? 1000 : 100)
		if (
			[
				'player/play',
				'player/next',
				'player/prev',
				'focus/play',
				'playlists/play',
				'playlists/resume',
				'playlists/track/play',
			].includes(action)
		) {
			await this._ws.send('player/status')
		} else if (!action.endsWith('/get') && !['player/status', 'playlists/get/one'].includes(action))
			this._scheduleStatus()
		this._publish()
		return reply
	}
	_scheduleLibraryRefresh(delay = 100) {
		clearTimeout(this._libraryRefreshTimer)
		const epoch = this._epoch
		this._libraryRefreshTimer = setTimeout(async () => {
			this._libraryRefreshTimer = null
			if (epoch !== this._epoch || this._destroyed) return
			try {
				if (this._inventoryInflight) await this._inventoryInflight
				if (epoch === this._epoch && !this._destroyed) await this._refreshPlaylists(true)
			} catch (err) {
				this.log('warn', err.message)
			}
		}, delay)
	}
	_scheduleStatus() {
		if (this._statusTimer) return
		const epoch = this._epoch
		this._statusTimer = setTimeout(() => {
			this._statusTimer = null
			if (epoch === this._epoch && this._ws?.isOpen) this._ws.send('player/status')
		}, 75)
	}
	_playlistIndex(id) {
		return this.playlistsMap[id]?.index
	}
	_playlistNameById(id) {
		return this.playlistsMap[id]?.name || String(id)
	}
	_trackIndex(id, key) {
		return this.tracksMap[id]?.[key]
	}
	_trackIndexById(id, key) {
		return this._trackIndex(id, key) ?? -1
	}
	_trackChoicesFor(id) {
		if (this.tracksCache[id]?.length) return this.tracksCache[id]
		return [
			{
				id: this.tracksError[id] ? '__error__' : this.tracksCache[id] ? '__empty__' : '__loading__',
				label: this.tracksError[id]
					? '(load failed — Refresh library to retry)'
					: this.tracksCache[id]
						? '(empty playlist)'
						: '(loading)',
			},
		]
	}
	async _refreshPlaylists(force = false) {
		if (this._inventoryInflight) return this._inventoryInflight
		const promise = this._fetchInventory(force)
		this._inventoryInflight = promise
		try {
			return await promise
		} finally {
			if (this._inventoryInflight === promise) this._inventoryInflight = null
		}
	}
	async _fetchInventory(force) {
		const epoch = this._epoch
		const reply = await this._startupSend('playlists/get')
		if (epoch !== this._epoch || this._destroyed) return
		if (!Array.isArray(reply?.playlists)) {
			this.state.libraryStatus = 'Playlist load failed; press Refresh library to retry'
			this._publish()
			return
		}
		const list = reply.playlists.filter((p) => Number.isInteger(p.id) && p.id >= 0 && p.aimp_id != null)
		const signature = JSON.stringify(list.map((p) => [p.id, p.aimp_id, p.name, p.track_count]))
		let changed = force || signature !== this._lastLibrarySignature
		this._lastLibrarySignature = signature
		this.playlistChoices = list.map((p) => ({ id: String(p.aimp_id), label: p.name || `Playlist ${p.id + 1}` }))
		this.playlistsMap = Object.create(null)
		for (const p of list)
			this.playlistsMap[String(p.aimp_id)] = { index: p.id, name: p.name, aimpId: String(p.aimp_id) }
		for (const key of Object.keys(this.tracksCache))
			if (!this.playlistsMap[key]) {
				delete this.tracksCache[key]
				delete this.tracksMap[key]
				delete this.tracksTotal[key]
				delete this.tracksError[key]
			}
		this.state.playlistCount = list.length
		if (changed) {
			this.state.libraryStatus = 'Loading tracks'
			this._register()
		}
		for (const p of list) {
			const key = String(p.aimp_id)
			if (force || !this.tracksCache[key] || this.tracksTotal[key] !== p.track_count) {
				await this._loadTracks(key)
				changed = true
			}
			if (epoch !== this._epoch || this._destroyed) return
		}
		const limited = Object.keys(this.tracksCache).some((k) => this.tracksCache[k].length < this.tracksTotal[k])
		this.state.loadedTrackCount = Object.values(this.tracksCache).reduce((n, t) => n + t.length, 0)
		this.state.libraryStatus = Object.keys(this.tracksError).length
			? 'Some tracks failed to load; press Refresh library'
			: limited
				? 'Track limit reached; increase the connection limit for more presets'
				: 'Library ready'
		if (changed) this._register()
		else this._publish()
	}
	async _ensureTracksLoaded(id) {
		if (!this.tracksCache[id]) return this._loadTracks(String(id))
	}
	async _loadTracks(key) {
		if (this._tracksInflight.has(key)) return this._tracksInflight.get(key)
		const promise = this._fetchTracks(key)
		this._tracksInflight.set(key, promise)
		try {
			return await promise
		} finally {
			if (this._tracksInflight.get(key) === promise) this._tracksInflight.delete(key)
		}
	}
	async _fetchTracks(key) {
		const index = this._playlistIndex(key),
			epoch = this._epoch
		if (index == null) return
		const limit = Math.max(100, Math.min(100000, Math.floor(Number(this.config.trackLimit) || 10000)))
		const list = []
		let total = Infinity
		while (list.length < Math.min(total, limit)) {
			const reply = await this._startupSend('playlists/tracks/get', {
				playlist_id: index,
				offset: list.length,
				limit: Math.min(250, limit - list.length),
			})
			if (epoch !== this._epoch || this._destroyed) return
			if (
				!Array.isArray(reply?.tracks) ||
				reply.error ||
				(reply.playlist_id !== undefined && reply.playlist_id !== index)
			) {
				this.tracksError[key] = true
				return
			}
			total = Number.isInteger(reply.total) && reply.total >= 0 ? reply.total : list.length + reply.tracks.length
			if (reply.tracks.some((t, i) => !Number.isInteger(t.id) || t.id !== list.length + i)) {
				this.tracksError[key] = true
				return
			}
			if (!reply.tracks.length && list.length < total) {
				this.tracksError[key] = true
				return
			}
			list.push(...reply.tracks.slice(0, limit - list.length))
			if (!reply.tracks.length) break
		}
		const occurrences = new Map(),
			map = Object.create(null)
		const tracks = list.map((t) => {
			const path = t.file_path || String(t.id),
				n = occurrences.get(path) || 0
			occurrences.set(path, n + 1)
			const id = n ? `${path}::aimp-duplicate:${n}` : path
			map[id] = t.id
			return {
				id,
				index: t.id,
				path,
				title: t.title || '',
				artist: t.artist || '',
				label: `${t.id + 1}. ${[t.artist, t.title].filter(Boolean).join(' – ') || path}`,
			}
		})
		this.tracksCache[key] = tracks
		this.tracksMap[key] = map
		this.tracksTotal[key] = total
		delete this.tracksError[key]
		return true
	}
}
