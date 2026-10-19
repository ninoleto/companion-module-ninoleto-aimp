// Optional Linux C++ test: actual ws client against the exact portable protocol
// source used in AimpCompanionControl 0.1.0. Does not exercise AIMP SDK or WinSock.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { AimpWsClient } from '../src/ws-client.js'
const dir = mkdtempSync(join(tmpdir(), 'aimp-native-'))
const binary = join(dir, 'probe')
const compile = spawnSync(
	'g++',
	[
		'-std=c++17',
		'-O2',
		'-Wall',
		'-Wextra',
		'-Werror',
		'test/native-fixture/probe.cpp',
		'test/native-fixture/protocol.cpp',
		'-o',
		binary,
	],
	{ encoding: 'utf8' },
)
assert.equal(compile.status, 0, compile.stderr || 'Requires a C++17 g++ compiler')
function probe(mode, input) {
	const result = spawnSync(binary, [mode], { input })
	assert.equal(result.status, 0, `Native ${mode} failed`)
	return result.stdout
}
const sockets = new Set(),
	failures = []
const server = createServer((socket) => {
	sockets.add(socket)
	socket.on('error', () => {})
	socket.on('close', () => sockets.delete(socket))
	let buffer = Buffer.alloc(0),
		ready = false
	socket.on('data', (data) => {
		try {
			buffer = Buffer.concat([buffer, data])
			if (!ready) {
				const end = buffer.indexOf('\r\n\r\n')
				if (end < 0) return
				const header = buffer.subarray(0, end + 4)
				const [status, key] = probe('handshake', header).toString().split('\n')
				assert.equal(status, '101')
				assert.doesNotMatch(header.toString(), /\r\nOrigin:/i)
				const accept = createHash('sha1')
					.update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
					.digest('base64')
				socket.write(
					`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
				)
				buffer = buffer.subarray(end + 4)
				ready = true
			}
			if (buffer.length < 6) return
			let len = buffer[1] & 127,
				head = 2
			if (len === 126) {
				if (buffer.length < 8) return
				len = buffer.readUInt16BE(2)
				head = 4
			}
			if (buffer.length < head + 4 + len) return
			const command = JSON.parse(probe('decode', buffer.subarray(0, head + 4 + len)))
			buffer = buffer.subarray(head + 4 + len)
			socket.write(
				probe(
					'frame',
					Buffer.from(JSON.stringify({ action: command.action, event: 'status', state: 'paused', volume: 41 })),
				),
			)
		} catch (err) {
			failures.push(err.message)
			socket.destroy()
		}
	})
})
let client
try {
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	client = new AimpWsClient({ port: server.address().port, requestTimeout: 1500 })
	client.connect()
	await once(client, 'open')
	const reply = await client.send('player/status')
	assert.deepEqual(failures, [])
	assert.equal(reply?.volume, 41)
	console.log(
		'Native protocol interoperability passed: real client handshake, masked request decode, native reply framing.',
	)
} finally {
	client?.close()
	for (const socket of sockets) socket.destroy()
	await new Promise((r) => server.close(r))
	rmSync(dir, { recursive: true, force: true })
}
