export function formatHresult(value) {
	return Number.isInteger(value) && value >= -2147483648 && value <= 4294967295
		? `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
		: ''
}

export function formatCommandError(error) {
	if (!error || typeof error !== 'object') return String(error || '')
	const description = error.code || error.message || JSON.stringify(error)
	const hresult = formatHresult(error.hresult)
	return `${description}${hresult ? ` (HRESULT ${hresult})` : ''}`
}

export function deferredCommandError(command) {
	if (command?.status !== 'failed') return ''
	const error = command.error ? formatCommandError(command.error) : 'AIMP command failed'
	const hresult = formatHresult(command.hresult)
	return `${error}${hresult ? ` (HRESULT ${hresult})` : ''}`
}
