import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'

import { AimpWsClient } from '../src/ws-client.js'
import { startMockWsServer } from './mock-ws-server.js'

function makeClient(port) {
	return new AimpWsClient({ host: '127.0.0.1', port, log: () => {} })
}

async function waitFor(predicate, timeout = 2000) {
	const start = Date.now()
	while (Date.now() - start < timeout) {
		if (predicate()) return
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
	throw new Error('waitFor timed out')
}

test('connects, receives pushed events and resolves command replies', async (t) => {
	const server = await startMockWsServer((command, connection) => {
		if (command.action === 'playlists/get') {
			connection.send({
				action: 'playlists/get',
				playlists: [{ id: 0, aimp_id: 'pl-1', name: 'Main', track_count: 2 }],
			})
		} else if (command.action === 'player/play') {
			connection.send({ action: 'player/play', state: 'playing' })
		}
	})
	t.after(() => server.close())

	const client = makeClient(server.port)
	const messages = []
	client.on('message', (msg) => messages.push(msg))

	client.connect()
	await once(client, 'open')
	assert.equal(client.isOpen, true)

	for (const connection of server.connections) {
		connection.send({ event: 'connected', state: 'stopped', volume: 41 })
	}
	await waitFor(() => messages.some((msg) => msg.event === 'connected'))

	const playlists = await client.send('playlists/get')
	assert.equal(playlists.playlists[0].name, 'Main')

	const play = await client.send('player/play')
	assert.equal(play.state, 'playing')

	client.close()
	assert.equal(client.isOpen, false)
})

test('send resolves null when the client is not connected', async () => {
	const client = makeClient(1)
	assert.equal(await client.send('player/play'), null)
})

test('queues identical commands in order', async (t) => {
	const server = await startMockWsServer((command, connection) => {
		connection.send({ action: command.action, echo: command.seq })
	})
	t.after(() => server.close())

	const client = makeClient(server.port)
	client.connect()
	await once(client, 'open')

	const [first, second] = await Promise.all([
		client.send('player/volume/set', { seq: 1, volume: 10 }),
		client.send('player/volume/set', { seq: 2, volume: 20 }),
	])
	assert.equal(first.echo, 1)
	assert.equal(second.echo, 2)
	client.close()
})

test('reconnects after the server drops the connection', async (t) => {
	const server = await startMockWsServer()
	t.after(() => server.close())

	const client = makeClient(server.port)
	client.connect()
	await once(client, 'open')

	const reopened = once(client, 'open')
	for (const connection of server.connections) connection.drop()
	await once(client, 'close')
	await reopened

	assert.equal(client.isOpen, true)
	client.close()
})

test('resolves pending commands when the connection drops', async (t) => {
	const server = await startMockWsServer() // never replies
	t.after(() => server.close())

	const client = makeClient(server.port)
	client.connect()
	await once(client, 'open')

	const pending = client.send('player/play')
	for (const connection of server.connections) connection.drop()
	assert.equal(await pending, null)
	client.close()
})
