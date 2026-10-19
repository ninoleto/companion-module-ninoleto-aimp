import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFeaturePresets } from '../src/feature-presets.js'
import { getFeatureActions, getFeatureFeedbacks, getFeatureVariableValues } from '../src/feature-controls.js'
import { registerVariables } from '../src/variables.js'
import {
	makeFeatureFixture,
	makeMediaFixture,
	makeMusicLibraryFixture,
	makeLibraryToolsFixture,
} from './feature-fixture.js'

function fixture(advancedPresets = false, features = makeFeatureFixture()) {
	const instance = {
		label: 'My AIMP',
		config: { advancedPresets },
		features,
		mediaState: makeMediaFixture(),
		musicLibrary: makeMusicLibraryFixture(),
		libraryTools: makeLibraryToolsFixture(),
		state: { connected: true },
		playlistChoices: [{ id: 'music', label: 'Music' }],
		tracksCache: {},
	}
	const structure = [],
		presets = {}
	appendFeaturePresets(instance, structure, presets)
	return { instance, structure, presets }
}
const references = (structure) =>
	structure.flatMap((s) => s.definitions.flatMap((d) => (typeof d === 'string' ? [d] : d.presets)))
const actions = (preset) => preset.steps.flatMap((step) => Object.values(step).flat())

test('extended presets have unique references and valid action/feedback/variable contracts', () => {
	const { instance, structure, presets } = fixture(true)
	const actionDefs = getFeatureActions(instance),
		feedbackDefs = getFeatureFeedbacks(instance)
	let variables
	registerVariables({
		...instance,
		setVariableDefinitions(definitions) {
			variables = definitions
		},
	})
	const refs = references(structure)
	assert.equal(refs.length, new Set(refs).size)
	assert.deepEqual(new Set(refs), new Set(Object.keys(presets)))
	for (const [id, preset] of Object.entries(presets)) {
		for (const action of actions(preset)) {
			const definition = actionDefs[action.actionId]
			assert.ok(definition, `${id}: unknown action ${action.actionId}`)
			for (const [option, value] of Object.entries(action.options)) {
				const schema = definition.options.find((item) => item.id === option)
				assert.ok(schema, `${id}/${action.actionId}: unknown option ${option}`)
				if (schema.type === 'dropdown')
					assert.ok(
						schema.choices.some((item) => item.id === value),
						`${id}/${option}: invalid choice ${value}`,
					)
				if (schema.type === 'number')
					assert.ok(
						typeof value === 'number' && Number.isFinite(value) && value >= schema.min && value <= schema.max,
						`${id}/${option}: value out of range`,
					)
			}
		}
		for (const feedback of preset.feedbacks)
			assert.ok(
				feedback.feedbackId === 'is_connected' || feedbackDefs[feedback.feedbackId],
				`${id}: unknown feedback ${feedback.feedbackId}`,
			)
		for (const [, variable] of JSON.stringify(preset).matchAll(/\$\(My AIMP:([^)]*)\)/g))
			assert.ok(variables[variable], `${id}: unknown variable ${variable}`)
	}
})

test('legacy and explicitly unavailable features add no presets and preserve existing definitions', () => {
	for (const features of [
		undefined,
		{},
		{ capabilities: null },
		{
			capabilities: {
				audio: [{ id: 'pitch', supported: false }],
				equalizer: { available: false },
				player_options: { test: { available: false } },
			},
		},
	]) {
		const instance = { features, config: {} },
			structure = [{ id: 'existing', name: 'Existing', definitions: ['existing'] }]
		const presets = { existing: { name: 'Preserved exactly', any: [1, 2, 3] } }
		const before = structuredClone({ structure, presets })
		appendFeaturePresets(instance, structure, presets)
		assert.deepEqual({ structure, presets }, before)
	}
})

test('every numeric audio control and EQ band has a genuine rotary with reset on press', () => {
	const { instance, structure, presets } = fixture()
	for (const descriptor of instance.features.capabilities.audio.filter((d) => d.type !== 'boolean')) {
		const rotary = presets[`feature_audio_${descriptor.id}_rotary`]
		assert.equal(rotary.steps[0].rotate_left[0].options.delta, -descriptor.step)
		assert.equal(rotary.steps[0].rotate_right[0].options.delta, descriptor.step)
		assert.equal(rotary.steps[0].down[0].actionId, 'feature_audio_reset')
		assert.equal(rotary.steps[0].down[0].options.parameter, descriptor.id)
		assert.ok(presets[`feature_audio_${descriptor.id}_down`])
		assert.ok(presets[`feature_audio_${descriptor.id}_up`])
		assert.ok(presets[`feature_audio_${descriptor.id}_reset`])
	}
	for (let band = 0; band < instance.features.capabilities.equalizer.band_count; band++) {
		const rotary = presets[`feature_eq_band_${band}_rotary`]
		assert.deepEqual(rotary.steps[0].down[0], { actionId: 'feature_eq_band_reset', options: { band } })
		assert.equal(rotary.steps[0].rotate_left[0].options.band, band)
		assert.equal(rotary.steps[0].rotate_right[0].options.band, band)
	}
	const pitchGroup = structure.find((s) => s.id === 'feature_pitch_rotary')
	assert.match(pitchGroup.name, /Rotary Encoders/)
	assert.deepEqual(
		new Set(pitchGroup.definitions),
		new Set(['pitch', 'tempo', 'speed'].map((p) => `feature_audio_${p}_rotary`)),
	)
	assert.ok(!Object.values(presets).some((p) => p.options?.rotaryActions), 'use C5 rotary step actions directly')
})

test('all new text layers retain size 20, shrink, readable regions and valid feedback targets', () => {
	const { presets } = fixture(true)
	for (const [id, preset] of Object.entries(presets)) {
		assert.equal(preset.type, 'layered', id)
		const elements = new Map(preset.elements.map((e) => [e.id, e]))
		assert.equal(elements.size, preset.elements.length, `${id}: duplicate layer`)
		for (const text of preset.elements.filter((e) => e.type === 'text')) {
			assert.equal(text.fontsize, 20, `${id}/${text.id}`)
			assert.equal(text.fontsizeAllowShrink, true, `${id}/${text.id}`)
			assert.ok(text.height >= 60, `${id}/${text.id}: C5 font scales to region height`)
		}
		for (const feedback of preset.feedbacks)
			for (const target of feedback.styleOverrides)
				assert.ok(elements.has(target.elementId), `${id}: missing feedback target ${target.elementId}`)
	}
})

test('remove, clear and close actions appear only in a separate advanced category', () => {
	const standard = fixture(),
		advanced = fixture(true)
	const destructive = new Set([
		'feature_queue_clear',
		'feature_queue_remove',
		'feature_queue_remove_track',
		'feature_playlist_clear',
		'feature_playlist_close',
		'feature_track_remove',
	])
	for (const preset of Object.values(standard.presets))
		for (const a of actions(preset)) assert.ok(!destructive.has(a.actionId))
	const category = advanced.structure.find((s) => s.id === 'feature_remove')
	assert.match(category.name, /Advanced.*Remove/)
	assert.deepEqual(
		new Set(category.definitions.flatMap((id) => actions(advanced.presets[id]).map((a) => a.actionId))),
		destructive,
	)
	for (const id of category.definitions)
		assert.equal(advanced.presets[id].elements.find((e) => e.id === 'accent').color, 0xfb7185)
	for (const [id, preset] of Object.entries(standard.presets))
		assert.deepEqual(advanced.presets[id], preset, `${id}: advanced mode changed a working preset`)
})

test('Int32 timing controls retain their SDK action bounds without unsupported gauge axes', () => {
	const { instance, presets } = fixture()
	const definitions = getFeatureActions(instance)
	const timings = Object.entries(instance.features.capabilities.player_options).filter(([, d]) => d.type === 'integer')
	assert.equal(timings.length, 7)
	for (const [id, descriptor] of timings) {
		assert.equal(descriptor.max, 2147483647)
		assert.equal(definitions[`feature_player_${id}`].options.find((o) => o.id === 'value').max, 2147483647)
		for (const suffix of ['down', 'up', 'rotary']) {
			const preset = presets[`feature_player_${id}_${suffix}`]
			assert.ok(preset)
			assert.ok(!preset.elements.some((e) => e.type === 'gauge'))
			assert.ok(preset.elements.some((e) => e.type === 'text' && e.text.includes(`$(My AIMP:player_option_${id}_fmt)`)))
		}
	}
	assert.ok(presets.feature_audio_pitch_rotary.elements.some((e) => e.type === 'gauge'))
	assert.ok(presets.feature_eq_band_0_rotary.elements.some((e) => e.type === 'gauge'))
	for (const preset of Object.values(presets))
		for (const element of preset.elements.filter((e) => e.type === 'gauge')) {
			assert.ok(element.min >= -1000000 && element.max <= 1000000)
		}
})

test('artwork uses a live value feedback with an editable title-overlay option', () => {
	const { instance, presets } = fixture()
	const preset = presets.feature_media_artwork
	assert.ok(preset)
	assert.deepEqual(
		preset.localVariables.find((v) => v.variableName === 'artwork'),
		{
			variableType: 'feedback',
			variableName: 'artwork',
			feedbackId: 'feature_artwork',
			options: {},
		},
	)
	assert.deepEqual(
		preset.localVariables.find((v) => v.variableName === 'show_title'),
		{
			variableType: 'simple',
			variableName: 'show_title',
			startupValue: true,
		},
	)
	const image = preset.elements.find((e) => e.id === 'artwork')
	assert.deepEqual(image.base64Image, { isExpression: true, value: '$(local:artwork)' })
	assert.equal(image.width, 100)
	assert.equal(image.height, 100)
	for (const id of ['label', 'artwork_shade'])
		assert.deepEqual(preset.elements.find((e) => e.id === id).enabled, {
			isExpression: true,
			value: '$(local:show_title)',
		})
	const feedback = getFeatureFeedbacks(instance).feature_artwork
	assert.equal(feedback.type, 'value')
	assert.match(feedback.callback({ options: {} }), /^data:image\/png;base64,/)
	instance.mediaState.artwork = { status: 'missing', data_base64: '' }
	assert.equal(feedback.callback({ options: {} }), '')
	assert.equal(preset.steps[0].down[0].actionId, 'feature_artwork_refresh')
})

test('lyrics and result buttons use live text rather than cached user metadata', () => {
	const { instance, presets } = fixture()
	assert.equal(presets.feature_lyrics_current.elements.find((e) => e.id === 'label').text, '$(My AIMP:lyrics_current)')
	assert.equal(presets.feature_lyrics_next.elements.find((e) => e.id === 'label').text, '$(My AIMP:lyrics_next)')
	const row = presets.feature_ml_row_0
	assert.deepEqual(row.steps[0].down[0], { actionId: 'feature_ml_select_row', options: { index: 0 } })
	assert.equal(row.elements.find((e) => e.id === 'label').text, '$(My AIMP:ml_row_1_artist)\n$(My AIMP:ml_row_1_title)')
	assert.ok(!JSON.stringify(row).includes('demo-query'))
	instance.musicLibrary.query.rows[0].title = 'A different result on a later page'
	assert.equal(getFeatureVariableValues(instance).ml_row_1_title, 'A different result on a later page')
	const next = {}
	appendFeaturePresets(instance, [], next)
	assert.deepEqual(next.feature_ml_row_0, row, 'copied result slots remain meaningful across queries')
	instance.musicLibrary.query.rows = []
	assert.equal(getFeatureFeedbacks(instance).feature_ml_row_available.callback({ options: { index: 0 } }), false)
})

test('disk writes, EQ removal, cleanup, and quitting require configured advanced presets', () => {
	const standard = fixture(),
		advanced = fixture(true)
	const sensitive = new Set([
		'feature_tags_write',
		'feature_eq_preset_delete',
		'feature_eq_preset_rename',
		'feature_app_quit',
		'feature_ml_row_remove',
	])
	for (const preset of Object.values(standard.presets))
		for (const a of actions(preset)) {
			assert.ok(!sensitive.has(a.actionId))
			if (a.actionId === 'feature_app_command')
				assert.ok(!standard.instance.features.capabilities.app_commands[a.options.command]?.requires_confirmation)
		}
	let configured = 0
	const groupFor = new Map(advanced.structure.flatMap((group) => group.definitions.map((id) => [id, group])))
	for (const [id, preset] of Object.entries(advanced.presets))
		for (const a of actions(preset)) {
			if (
				sensitive.has(a.actionId) ||
				(a.actionId === 'feature_app_command' &&
					advanced.instance.features.capabilities.app_commands[a.options.command]?.requires_confirmation)
			) {
				configured++
				assert.equal(a.options.confirm, false, `${id}: confirmation must start disabled`)
				assert.match(groupFor.get(id).name, /^Advanced/)
			}
		}
	assert.ok(configured >= 9)
	assert.ok(!advanced.presets.feature_app_command_sync_preimage, 'source sync already has a targeted preset')
})

test('new browsing and skin encoders carry genuine rotary actions', () => {
	const { presets } = fixture()
	assert.deepEqual(presets.feature_ml_storage_select.steps[0].down[0], {
		actionId: 'feature_ml_storage_select',
		options: { storage_id: 'demo-library' },
	})
	assert.deepEqual(presets.feature_ml_rotary.steps[0], {
		down: [{ actionId: 'feature_ml_play', options: { row_id: '__selected__' } }],
		up: [],
		rotate_left: [{ actionId: 'feature_ml_select', options: { delta: -1 } }],
		rotate_right: [{ actionId: 'feature_ml_select', options: { delta: 1 } }],
	})
	for (const parameter of ['hue', 'intensity']) {
		const rotary = presets[`feature_skin_${parameter}_rotary`]
		assert.deepEqual(rotary.steps[0].rotate_left[0], {
			actionId: 'feature_skin_color_adjust',
			options: { parameter, delta: -1 },
		})
		assert.deepEqual(rotary.steps[0].rotate_right[0], {
			actionId: 'feature_skin_color_adjust',
			options: { parameter, delta: 1 },
		})
		assert.equal(rotary.steps[0].down[0].actionId, 'feature_skin_refresh', 'do not invent an SDK-neutral skin color')
	}
})

test('information controls keep their action IDs and show summaries in a separate information section', () => {
	const { structure, presets } = fixture(true)
	const info = structure.find((group) => group.id === 'feature_information')
	assert.match(info.name, /Information/)
	assert.match(info.description, /do not open an AIMP window/)
	assert.deepEqual(info.definitions, ['feature_playlist_info', 'feature_track_info', 'feature_file_info'])
	const management = structure.find((group) => group.id === 'feature_library')
	for (const id of ['playlist_info', 'track_info', 'file_info']) {
		assert.ok(!management.definitions.includes(`feature_${id}`))
		const preset = presets[`feature_${id}`]
		assert.equal(preset.steps[0].down[0].actionId, `feature_${id}`)
		assert.ok(preset.elements.find((element) => element.id === 'label').text.includes(`$(My AIMP:${id}_summary)`))
	}
	const properties = presets.feature_playlist_properties_get
	assert.equal(properties.steps[0].down[0].actionId, 'feature_playlist_properties_get')
	assert.equal(
		properties.elements.find((element) => element.id === 'label').text,
		'Read properties\n$(My AIMP:playlist_properties_summary)',
	)
})

test('setup templates and focused-track operations accurately describe what pressing them does', () => {
	const { structure, presets } = fixture(true)
	const label = (id) => presets[id].elements.find((element) => element.id === 'label').text
	assert.equal(label('feature_playlist_rename'), 'Rename\nSetup: name')
	assert.equal(label('feature_playlist_add'), 'Add media\nSetup: path')
	assert.equal(presets.feature_playlist_rename.steps[0].down[0].options.name, '')
	assert.equal(presets.feature_playlist_add.steps[0].down[0].options.uri, '')
	assert.equal(label('feature_track_enabled_on'), 'Enable\nFocused track')
	assert.equal(label('feature_track_enabled_off'), 'Disable\nFocused track')
	assert.equal(presets.feature_track_enabled_on.steps[0].down[0].options.target, 'focused')
	assert.equal(label('feature_playlist_property_read_only_on'), 'Read-only\nLocks editing')
	assert.equal(label('feature_playlist_property_read_only_off'), 'Read-only\nAllow editing')
	assert.equal(label('feature_app_quit'), 'Close AIMP\nSetup: confirm')
	assert.equal(presets.feature_app_quit.steps[0].down[0].options.confirm, false)
	assert.match(structure.find((group) => group.id === 'feature_app_quit').description, /one-time setup checkbox/)
	assert.match(
		structure.find((group) => group.id === 'feature_library').description,
		/do not open a name or file dialog/,
	)
	assert.match(
		structure.find((group) => group.id === 'feature_playlist_templates').description,
		/do not open a file or text-entry dialog/,
	)
})
