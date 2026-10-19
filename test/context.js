export function createMockContext() {
	const state = {
		statuses: [],
		actions: null,
		feedbacks: null,
		presets: null,
		variables: {},
	}

	const context = {
		id: 'test-instance',
		label: 'AIMP Test',
		_isInstanceContext: true,
		setActionDefinitions: (actions) => {
			state.actions = actions
		},
		setFeedbackDefinitions: (feedbacks) => {
			state.feedbacks = feedbacks
		},
		setPresetDefinitions: (structure, presets) => {
			state.presets = { structure, presets }
		},
		setVariableDefinitions: () => {},
		setVariableValues: (values) => Object.assign(state.variables, values),
		checkFeedbacks: () => {},
		checkAllFeedbacks: () => {},
		checkFeedbacksById: () => {},
		getVariableValue: () => undefined,
		saveConfig: () => {},
		updateStatus: (status) => state.statuses.push(status),
		subscribeActions: () => {},
		unsubscribeActions: () => {},
		unsubscribeFeedbacks: () => {},
		oscSend: () => {},
		recordAction: () => {},
	}

	return { context, state }
}
