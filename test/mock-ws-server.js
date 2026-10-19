// ─────────────────────────────────────────────
//  Minimal RFC 6455 WebSocket server for tests.
//
//  No dependencies: implements just enough of the protocol (handshake,
//  masked client frames, unmasked server frames) to exercise AimpWsClient.
// ─────────────────────────────────────────────

import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function encodeFrame(value) {
	const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')
	const length = data.length
	let header
	if (length < 126) {
		header = Buffer.from([0x81, length])
	} else if (length < 65536) {
		header = Buffer.alloc(4)
		header[0] = 0x81
		header[1] = 126
		header.writeUInt16BE(length, 2)
	} else {
		header = Buffer.alloc(10)
		header[0] = 0x81
		header[1] = 127
		header.writeBigUInt64BE(BigInt(length), 2)
	}
	return Buffer.concat([header, data])
}

function decodeFrames(buffer) {
	const frames = []
	let offset = 0
	while (offset + 2 <= buffer.length) {
		const b0 = buffer[offset]
		const b1 = buffer[offset + 1]
		const opcode = b0 & 0x0f
		const masked = (b1 & 0x80) !== 0
		let length = b1 & 0x7f
		let cursor = offset + 2
		if (length === 126) {
			if (cursor + 2 > buffer.length) break
			length = buffer.readUInt16BE(cursor)
			cursor += 2
		} else if (length === 127) {
			if (cursor + 8 > buffer.length) break
			length = Number(buffer.readBigUInt64BE(cursor))
			cursor += 8
		}
		let mask = null
		if (masked) {
			if (cursor + 4 > buffer.length) break
			mask = buffer.subarray(cursor, cursor + 4)
			cursor += 4
		}
		if (cursor + length > buffer.length) break
		const payload = Buffer.from(buffer.subarray(cursor, cursor + length))
		if (mask) {
			for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
		}
		frames.push({ opcode, payload })
		offset = cursor + length
	}
	return { frames, rest: buffer.subarray(offset) }
}

/**
 * Start a WebSocket server on a random loopback port.
 * @param {(command: object, connection: { send: (value: unknown) => void, drop: () => void }) => void} [onCommand]
 * @param {(connection: { send: (value: unknown) => void, drop: () => void }) => void} [onConnection]
 */
export async function startMockWsServer(onCommand, onConnection) {
	const connections = new Set()
	const server = createServer()

	server.on('upgrade', (request, socket) => {
		const key = request.headers['sec-websocket-key']
		if (!key) {
			socket.destroy()
			return
		}
		const accept = createHash('sha1')
			.update(key + WS_GUID)
			.digest('base64')
		socket.write(
			'HTTP/1.1 101 Switching Protocols\r\n' +
				'Upgrade: websocket\r\n' +
				'Connection: Upgrade\r\n' +
				`Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
		)

		const connection = {
			socket,
			send(value) {
				if (socket.destroyed) return
				socket.write(encodeFrame(typeof value === 'string' ? value : JSON.stringify(value)))
			},
			drop() {
				socket.destroy()
			},
		}
		connections.add(connection)
		socket.on('close', () => connections.delete(connection))
		socket.on('error', () => {})
		onConnection?.(connection)

		let buffer = Buffer.alloc(0)
		socket.on('data', (chunk) => {
			buffer = Buffer.concat([buffer, chunk])
			const { frames, rest } = decodeFrames(buffer)
			buffer = rest
			for (const frame of frames) {
				if (frame.opcode === 0x08) {
					socket.end()
				} else if (frame.opcode === 0x01) {
					let command
					try {
						command = JSON.parse(frame.payload.toString('utf8'))
					} catch {
						continue
					}
					onCommand?.(command, connection)
				}
			}
		})
	})

	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

	return {
		port: server.address().port,
		connections,
		close() {
			for (const connection of connections) connection.drop()
			return new Promise((resolve) => server.close(resolve))
		},
	}
}
