import test from 'node:test'
import assert from 'node:assert/strict'
import {
	validateNumberValue,
	validateDropdownValue,
	validateMultiDropdownValue,
	validateCheckboxValue,
	validateTextValue,
	validateColorValue,
} from '@companion-module/host/validate'
import { updatePresets } from '../src/presets.js'
import { buildActions } from '../src/actions.js'
import { getFeatureActions } from '../src/feature-controls.js'
import { registerFeedbacks } from '../src/feedbacks.js'
import {
	makeFeatureFixture,
	makeMediaFixture,
	makeMusicLibraryFixture,
	makeLibraryToolsFixture,
} from './feature-fixture.js'

// Companion 5's VariablesAndExpressionParser visits every declared field and
// calls these host validators. It does not insert field.default for absent
// options. InstanceWrapper.executeAction alone bypasses that host-side stage.
const validators = {
	number: validateNumberValue,
	dropdown: validateDropdownValue,
	multidropdown: validateMultiDropdownValue,
	checkbox: validateCheckboxValue,
	textinput: validateTextValue,
	colorpicker: validateColorValue,
}

function parseLiteralOptions(definition, options = {}) {
	const errors = {},
		parsed = {}
	for (const field of definition.options) {
		if (field.type === 'static-text') continue
		const validate = validators[field.type]
		assert.ok(validate, `Add host validation for new field type: ${field.type}`)
		const value = options[field.id]
		assert.ok(
			!value || typeof value !== 'object' || !Object.hasOwn(value, 'isExpression'),
			'This contract test covers literal preset options; expressions need full host parser coverage',
		)
		const result = validate(value, field)
		parsed[field.id] = result.sanitisedValue
		if (result.validationError && !field.allowInvalidValues) errors[field.id] = result.validationError
	}
	return { errors, parsed }
}

function fixture(advancedPresets = false, features = makeFeatureFixture()) {
	const sent = []
	const instance = {
		label: 'AIMP',
		config: { advancedPresets, trackPresets: true },
		features,
		mediaState: makeMediaFixture(),
		musicLibrary: makeMusicLibraryFixture(),
		libraryTools: makeLibraryToolsFixture(),
		state: { connected: true },
		playlistChoices: [{ id: 'music', label: 'Music' }],
		tracksCache: {
			music: [
				{ id: 'C:/Music/one.mp3', path: 'C:/Music/one.mp3', index: 0, title: 'One', label: 'One' },
				{ id: 'C:/Music/two.mp3', path: 'C:/Music/two.mp3', index: 1, title: 'Two', label: 'Two' },
			],
		},
		_playlistNameById() {
			return 'Music'
		},
		setPresetDefinitions(_structure, definitions) {
			this.presets = definitions
		},
		setFeedbackDefinitions(definitions) {
			this.feedbacks = definitions
		},
		async _send(action, params) {
			sent.push({ action, ...params })
			return { action }
		},
	}
	updatePresets(instance)
	registerFeedbacks(instance)
	return { ...instance, actions: { ...buildActions(instance), ...getFeatureActions(instance) }, sent }
}

test('reproduces the beta.4 About preset failure before its callback can run', () => {
	const { actions } = fixture()
	const definition = actions.feature_app_command
	assert.equal(definition.options.find((field) => field.id === 'param').default, 0)
	const result = parseLiteralOptions(definition, { command: 'about' })
	assert.deepEqual(result.errors, { param: 'A value must be provided' })
})

for (const advanced of [false, true]) {
	for (const mode of ['legacy', 'beta3', 'beta4']) {
		test(`all ${mode} ${advanced ? 'advanced' : 'curated'} preset action and feedback fields pass host validation`, () => {
			const features = mode === 'legacy' ? undefined : makeFeatureFixture(mode === 'beta4')
			const { presets, actions, feedbacks } = fixture(advanced, features ?? { capabilities: null })
			let checkedActions = 0,
				checkedFeedbacks = 0
			for (const [presetId, preset] of Object.entries(presets)) {
				for (const step of preset.steps) {
					for (const event of ['down', 'up', 'rotate_left', 'rotate_right']) {
						for (const action of step[event] || []) {
							const definition = actions[action.actionId]
							assert.ok(definition, `${presetId}/${event}: unknown action ${action.actionId}`)
							assert.deepEqual(
								parseLiteralOptions(definition, action.options).errors,
								{},
								`${presetId}/${event}/${action.actionId}: host rejected preset fields`,
							)
							checkedActions++
						}
					}
				}
				for (const feedback of preset.feedbacks || []) {
					const definition = feedbacks[feedback.feedbackId]
					assert.ok(definition, `${presetId}: unknown feedback ${feedback.feedbackId}`)
					assert.deepEqual(
						parseLiteralOptions(definition, feedback.options).errors,
						{},
						`${presetId}/${feedback.feedbackId}: host rejected feedback fields`,
					)
					checkedFeedbacks++
				}
			}
			assert.ok(checkedActions > 0)
			assert.ok(checkedFeedbacks > 0)
		})
	}
}

test('About survives host option validation and sends exactly the native About command', async () => {
	const { presets, actions, sent } = fixture()
	const action = presets.feature_app_command_about.steps[0].down[0]
	assert.deepEqual(action.options, { command: 'about', confirm: false, param: 0 })
	const result = parseLiteralOptions(actions[action.actionId], action.options)
	assert.deepEqual(result.errors, {})
	await actions[action.actionId].callback({ options: result.parsed })
	assert.deepEqual(sent, [{ action: 'app/command', command: 'about' }])
})

test('cleanup presets pass host parsing but still require explicit confirmation before sending', async () => {
	const { presets, actions, sent } = fixture(true)
	const cleanup = presets.feature_app_command_cleanup_selected.steps[0].down[0]
	assert.equal(cleanup.options.confirm, false)
	const result = parseLiteralOptions(actions[cleanup.actionId], cleanup.options)
	assert.deepEqual(result.errors, {})
	await assert.rejects(actions[cleanup.actionId].callback({ options: result.parsed }), /confirmation checkbox/)
	assert.deepEqual(sent, [])
})
