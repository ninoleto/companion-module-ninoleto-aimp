// Derived from Bitfocus's AIMP module (MIT). No wire request IDs: serialize
// requests; discard the connection on timeout. Never replay playback commands.
import { EventEmitter } from 'node:events'
import WebSocket from 'ws'

export function validateEndpoint(host = '127.0.0.1', port = 19122) {
	host = String(host || '127.0.0.1').trim()
	if (host.toLowerCase() === 'localhost') host = '127.0.0.1'
	if (!/^[a-zA-Z0-9.-]+$/.test(host))
		throw new Error('Enter an IPv4 address or hostname without ws://, a path or port.')
	port = Number(port)
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535.')
	return { host, port }
}
export function describeError(error) {
	if (error.code === 'ECONNREFUSED')
		return 'Connection refused: check AIMP is running and Companion Control reports WebSocket listening on this address and port.'
	if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN')
		return 'Host name could not be resolved. Enter the AIMP computer’s IPv4 address.'
	if (error.code === 'ETIMEDOUT')
		return 'Connection timed out: check host, plugin listen interface, allowlist and firewall.'
	if (error.code === 'ECONNRESET')
		return 'Connection reset: check the plugin allowlist and whether another server owns the port.'
	return error.message || String(error)
}
export class AimpWsClient extends EventEmitter {
	constructor({ host, port, log, requestTimeout = 5000, reconnectDelay = 1000 } = {}) {
		super()
		Object.assign(this, validateEndpoint(host, port))
		this._log = log || (() => {})
		this.requestTimeout = requestTimeout
		this.initialBackoff = reconnectDelay
		this._backoff = reconnectDelay
		this._stopped = false
		this._ws = null
		this._open = false
		this._queue = []
		this._active = null
		this._reconnectTimer = null
		this.lastError = ''
	}
	get url() {
		return `ws://${this.host}:${this.port}/`
	}
	get isOpen() {
		return this._open
	}
	get busy() {
		return !!this._active || this._queue.length > 0
	}
	connect() {
		if (!this._stopped && !this._ws && !this._reconnectTimer) this._openSocket()
	}
	close() {
		this._stopped = true
		clearTimeout(this._reconnectTimer)
		this._reconnectTimer = null
		const ws = this._ws
		this._ws = null
		this._open = false
		if (ws) ws.terminate()
		this._settlePending()
	}
	send(action, params = {}) {
		if (!this.isOpen || !this._ws) {
			this._log('warn', `Cannot send ${action}: AIMP is not connected.`)
			return Promise.resolve(null)
		}
		if (this._queue.length >= 256) {
			this._log('warn', 'AIMP command queue is full; command was not sent.')
			return Promise.resolve(null)
		}
		return new Promise((resolve) => {
			this._queue.push({ action, params, resolve })
			this._drain()
		})
	}
	_drain() {
		if (this._active || !this.isOpen || !this._queue.length) return
		const entry = this._queue.shift()
		this._active = entry
		const ws = this._ws
		entry.timer = setTimeout(() => {
			this._drop(
				ws,
				`No reply to ${entry.action} within ${this.requestTimeout / 1000}s. Check the AIMP plugin; queued commands were discarded.`,
			)
		}, this.requestTimeout)
		try {
			ws.send(JSON.stringify({ ...entry.params, action: entry.action }), (err) => {
				if (err) this._drop(ws, describeError(err))
			})
		} catch (err) {
			this._drop(ws, describeError(err))
		}
	}
	_openSocket() {
		const ws = new WebSocket(this.url, {
			family: 4,
			perMessageDeflate: false,
			maxPayload: 4 * 1024 * 1024,
			handshakeTimeout: 8000,
		})
		this._ws = ws
		this.emit('connecting')
		this._log('debug', `Connecting to ${this.url}`)
		ws.on('open', () => {
			if (this._ws !== ws) return
			this._open = true
			this._backoff = this.initialBackoff
			this.lastError = ''
			this.emit('open')
		})
		ws.on('unexpected-response', (_req, response) => {
			response.resume()
			this._drop(
				ws,
				`WebSocket upgrade rejected (HTTP ${response.statusCode}). Check the port and plugin; an HTTP server cannot handle this connection.`,
			)
		})
		ws.on('message', (data, binary) => {
			if (this._ws !== ws) return
			let msg
			try {
				if (binary) throw new Error('binary frame')
				msg = JSON.parse(data.toString('utf8'))
				if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error('not an object')
			} catch {
				this._log('warn', 'Ignoring an invalid AIMP JSON message.')
				return
			}
			this.emit('message', msg)
			if (this._active && msg.action === this._active.action) {
				const entry = this._active
				this._active = null
				clearTimeout(entry.timer)
				entry.resolve(msg)
				this._drain()
			}
		})
		ws.on('error', (err) => this._drop(ws, describeError(err)))
		ws.on('close', (code, reason) =>
			this._drop(ws, `AIMP connection closed (${code}${reason.length ? ': ' + reason.toString() : ''}). Reconnecting.`),
		)
	}
	_drop(ws, reason) {
		if (this._ws !== ws) return
		this._ws = null
		this._open = false
		this.lastError = reason
		ws.terminate()
		this._settlePending()
		this._log('warn', reason)
		this.emit('close', reason)
		if (this._stopped || this._reconnectTimer) return
		const delay = this._backoff
		this._backoff = Math.min(delay * 2, 30000)
		this._reconnectTimer = setTimeout(() => {
			this._reconnectTimer = null
			this.connect()
		}, delay)
	}
	_settlePending() {
		if (this._active) {
			clearTimeout(this._active.timer)
			this._active.resolve(null)
			this._active = null
		}
		for (const entry of this._queue.splice(0)) entry.resolve(null)
	}
}
