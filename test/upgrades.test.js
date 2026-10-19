import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UpgradeScripts } from '../src/main.js'

const literal = (value) => ({ isExpression: false, value })
const action = (id, options, actionId = 'feature_app_command') => ({
	id,
	controlId: 'bank:39-2-6',
	actionId,
	options,
})
const upgrade = (actions) => UpgradeScripts[0]({}, { config: null, secrets: null, actions, feedbacks: [] })

test('existing interface buttons gain required values without changing command or confirmation', () => {
	const actions = [
		action('about', { command: literal('about') }),
		action('edited', { command: literal('add_files'), confirm: literal(true) }),
		action('empty', { command: literal('dsp_manager'), param: literal(undefined), confirm: literal(null) }),
	]
	const before = structuredClone(actions)
	const result = upgrade(actions)
	assert.equal(result.updatedConfig, null)
	assert.equal(result.updatedSecrets, null)
	assert.deepEqual(result.updatedFeedbacks, [])
	assert.equal(result.updatedActions.length, 3)
	assert.deepEqual(result.updatedActions[0].options, {
		command: literal('about'),
		param: literal(0),
		confirm: literal(false),
	})
	assert.deepEqual(result.updatedActions[1].options, {
		command: literal('add_files'),
		confirm: literal(true),
		param: literal(0),
	})
	assert.deepEqual(result.updatedActions[2].options.param, literal(0))
	assert.deepEqual(result.updatedActions[2].options.confirm, literal(false))
	assert.deepEqual(actions, before, 'do not mutate incoming saved controls')
	assert.deepEqual(upgrade(result.updatedActions).updatedActions, [], 'migration is idempotent')
})

test('migration preserves configured DSP tabs, expressions, and unrelated actions', () => {
	const actions = [
		action('dsp', { command: literal('dsp_manager'), param: literal(3), confirm: literal(false) }),
		action('expr', {
			command: { isExpression: true, value: '$(custom:command)' },
			param: { isExpression: true, value: '$(custom:tab)' },
			confirm: literal(true),
		}),
		action('other', {}, 'volume_set'),
	]
	const before = structuredClone(actions)
	assert.deepEqual(upgrade(actions).updatedActions, [])
	assert.deepEqual(actions, before)
})
