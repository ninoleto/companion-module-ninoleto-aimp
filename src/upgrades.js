// Companion 5 validates every option before invoking an action callback.
// Older interface presets omitted param, so the displayed default was never
// persisted and the action was rejected before it could reach AIMP.
function missingValue(option) {
	return option == null || (option.isExpression === false && option.value == null)
}

export const UpgradeScripts = [
	(_context, props) => {
		const updatedActions = []
		for (const action of props.actions) {
			if (action.actionId !== 'feature_app_command') continue
			const options = { ...action.options }
			let changed = false
			for (const [id, value] of Object.entries({ param: 0, confirm: false })) {
				if (!missingValue(options[id])) continue
				options[id] = { isExpression: false, value }
				changed = true
			}
			if (changed) updatedActions.push({ ...action, options })
		}
		return { updatedConfig: null, updatedSecrets: null, updatedActions, updatedFeedbacks: [] }
	},
]
