// Companion 5 native graphics. Font size is a percentage, not the legacy px size.
import { iconImages } from './preset-icons.js'

export const palette = {
	background: 0x121a25,
	border: 0x283545,
	text: 0xf1f5f9,
	transport: 0x34d399,
	volume: 0x38bdf8,
	modes: 0xc4a0ff,
	seek: 0xfbbf60,
	focus: 0x5ee0d0,
	library: 0x9aaeff,
	info: 0x8ea4bc,
	red: 0xfb7185,
}
const override = (elementId, elementProperty, value) => ({
	elementId,
	elementProperty,
	override: { isExpression: false, value },
})

function iconFor(id, actionId) {
	if (id.startsWith('rotary_')) return 'encoder'
	if (id === 'connection_status') return 'connection'
	if (id === 'last_error') return 'error'
	if (id.includes('remaining')) return 'remaining'
	if (/elapsed|duration|progress/.test(id)) return 'clock'
	if (/now_playing|next_track/.test(id)) return 'track'
	if (/track.*prev/.test(actionId)) return 'track-prev'
	if (/track.*next/.test(actionId)) return 'track-next'
	if (/playlist.*prev/.test(actionId)) return 'playlist-prev'
	if (/playlist.*next/.test(actionId)) return 'playlist-next'
	if (/mute/.test(id)) return 'mute'
	if (/volume_down/.test(id)) return 'volume-down'
	if (/volume_up/.test(id)) return 'volume-up'
	if (/volume/.test(id)) return 'volume'
	if (/shuffle/.test(id)) return 'shuffle'
	if (/repeat/.test(id)) return 'repeat'
	if (/auto_jump/.test(id)) return 'advance'
	if (id === 'restart' || id === 'seek_pct_0') return 'restart'
	if (id.startsWith('seek_-')) return 'rewind'
	if (id.startsWith('seek_')) return 'forward'
	if (/refresh|library_status/.test(id)) return 'refresh'
	if (id === 'focus_play' || id === 'focus_track_display') return 'focus'
	if (/playlist/.test(id) || id.startsWith('pl_')) return 'playlist'
	if (id.endsWith('_select')) return 'select'
	if (id.startsWith('tr_') || /track/.test(id)) return 'track'
	return (
		{ play_pause: 'play', play: 'play', pause: 'pause', stop: 'stop', prev: 'previous', next: 'next' }[id] || 'info'
	)
}

/** Convert our logical button definition to independently editable C5 layers. */
export function stylePreset(id, preset, category, variable) {
	const actionId = preset.steps[0]?.down[0]?.actionId || ''
	const accent =
		id === 'stop'
			? palette.red
			: /volume/.test(id)
				? palette.volume
				: /rotary_seek/.test(id)
					? palette.seek
					: /rotary_(tracks|playlists)/.test(id)
						? palette.focus
						: palette[category] || palette.info
	const icon = iconFor(id, actionId)
	let text = preset.style.text
	// Keep each common button to two lines; variants identify their difference.
	if (id === 'play_pause') text = 'Play / Pause'
	if (id.startsWith('rotary_volume_')) text = `±${id.split('_').at(-1)}%\n${variable('volume_pct')}%`
	if (id.startsWith('rotary_seek_')) text = `±${id.split('_').at(-1)}s\n${variable('position_fmt')}`
	if (id === 'rotary_tracks') text = `Track\n${variable('focus_track_number')}`
	if (id === 'rotary_playlists') text = variable('focus_playlist_name')
	if (id === 'display_progress') text = `Progress\n${variable('progress_pct')}%`
	if (id === 'library_status') text = variable('library_status')
	if (id === 'connection_status') text = 'AIMP\nOffline'
	if (id === 'last_error') text = variable('last_command_error')
	if (id === 'display_now_playing') text = variable('playing_track_title')
	if (id === 'display_next_track') text = variable('next_track_title')
	if (id === 'display_playing_playlist') text = variable('playing_playlist_name')
	if (id === 'focus_playlist_display') text = variable('focus_playlist_name')
	if (id === 'focus_track_display') text = variable('focus_track_title')
	if (id.startsWith('tr_')) {
		const lines = text.split('\n')
		text = `${lines[0].replace('PLAY', 'Play').replace('SELECT', 'Select')}\n${lines.slice(2).join(' ')}`
	}
	// Original labels were all caps. Variables and user track/playlist names stay intact.
	if (!id.startsWith('tr_') && !id.startsWith('pl_')) {
		text = text
			.split(/(\$\([^)]*\))/g)
			.map((part) =>
				part.startsWith('$(')
					? part
					: part.replace(/\b[A-Z][A-Z ]+\b/g, (s) =>
							s.trim() === 'AIMP' ? s : s.charAt(0) + s.slice(1).toLowerCase(),
						),
			)
			.join('')
	}
	const metadata =
		id.startsWith('tr_') ||
		id.startsWith('pl_') ||
		/now_playing|next_track|playing_playlist|focus_.*display|rotary_playlists|library_status|last_error/.test(id) ||
		text.split('\n').length > 2
	let heading =
		{
			display_now_playing: 'Playing',
			display_next_track: 'Next',
			display_playing_playlist: 'Playlist',
			focus_playlist_display: 'Selected',
			focus_track_display: 'Selected',
			rotary_playlists: 'Turn · list',
			library_status: 'Library',
			last_error: 'Status',
		}[id] || ''
	if (id.startsWith('tr_') || id.startsWith('pl_')) {
		const lines = text.split('\n')
		heading = lines
			.shift()
			.replace('PLAY', 'Play')
			.replace('RESUME', 'Resume')
			.replace('SELECT', 'Select')
			.replace('PREV', 'Previous')
			.replace('NEXT', 'Next')
		text = lines.join('\n')
	}
	const elements = [
		{
			type: 'box',
			id: 'background',
			name: 'Background',
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			color: palette.background,
			borderWidth: 1,
			borderColor: palette.border,
			borderPosition: 'inside',
		},
		{
			type: 'box',
			id: 'accent',
			name: 'Category / active colour',
			x: 10,
			y: 7,
			width: 80,
			height: 2,
			color: accent,
			cornerRadius: 50,
		},
		{
			type: 'image',
			id: 'icon',
			name: 'Icon',
			x: metadata && heading ? 8 : metadata ? 41 : 28,
			y: metadata ? 11 : 14,
			width: metadata ? 18 : 44,
			height: metadata ? 18 : 38,
			base64Image: iconImages[icon],
			fillMode: 'fit',
			halign: 'center',
			valign: 'center',
		},
		// Long metadata gets its own bounded region so wrapping cannot cross the icon.
		{
			type: 'text',
			id: 'label',
			name: 'Text · 20 · shrink to fit',
			x: 6,
			y: metadata ? 31 : 12,
			width: 88,
			height: metadata ? 62 : 82,
			text,
			fontsize: 20,
			fontsizeAllowShrink: true,
			font: 'companion-sans',
			weight: 'normal',
			color: palette.text,
			halign: 'center',
			valign: metadata ? 'center' : 'bottom',
		},
	]
	if (metadata && heading)
		elements.push({
			type: 'text',
			id: 'heading',
			name: 'Caption · 20 · shrink to fit',
			x: 30,
			y: 11,
			width: 64,
			height: 60,
			text: heading,
			fontsize: 20,
			fontsizeAllowShrink: true,
			font: 'companion-sans',
			weight: 'normal',
			color: accent,
			halign: 'left',
			valign: 'top',
		})
	const feedbacks = preset.feedbacks.map((fb) => {
		const off = fb.feedbackId === 'is_connected' && fb.isInverted
		const error = fb.feedbackId === 'command_error'
		const activeColor = off ? 0x526173 : error ? palette.red : fb.style.bgcolor === 0xa45a14 ? palette.seek : 0x34d399
		const styleOverrides = [
			override('background', 'color', off ? 0x161b23 : error ? 0x3c1d2b : 0x17362e),
			override('accent', 'color', activeColor),
		]
		if (off) {
			styleOverrides.push(override('icon', 'opacity', 35), override('label', 'color', 0x8994a3))
			if (metadata && heading) styleOverrides.push(override('heading', 'color', 0x8994a3))
		} else if (fb.style.text) {
			const replacement =
				fb.feedbackId === 'is_connected'
					? 'AIMP\nConnected'
					: fb.feedbackId === 'is_playing'
						? 'Pause'
						: fb.feedbackId === 'is_paused'
							? 'Resume'
							: fb.style.text
			styleOverrides.push(override('label', 'text', replacement))
			if (id === 'play_pause')
				styleOverrides.push(
					override('icon', 'base64Image', iconImages[fb.feedbackId === 'is_playing' ? 'pause' : 'play']),
				)
		}
		return {
			feedbackId: fb.feedbackId,
			options: fb.options,
			...(fb.isInverted === undefined ? {} : { isInverted: fb.isInverted }),
			styleOverrides,
		}
	})
	if (id === 'last_error')
		feedbacks.unshift({
			feedbackId: 'command_error',
			options: {},
			isInverted: true,
			styleOverrides: [override('label', 'text', 'No errors')],
		})
	const meter = /^(display_volume_display|rotary_volume_)/.test(id)
		? 'volume_pct'
		: /^(display_(progress|elapsed|remaining)|rotary_seek_)/.test(id)
			? 'progress_pct'
			: null
	if (meter)
		elements.push({
			type: 'gauge',
			id: 'meter',
			name: 'Live level',
			x: 10,
			y: 96,
			width: 80,
			height: 3,
			orientation: 'horizontal',
			min: 0,
			max: 100,
			value: { isExpression: true, value: variable(meter) },
			stops: [{ value: 0, color: accent, gradient: false }],
			trackStyle: 'dimmed',
			trackAmount: 15,
			fillEnabled: true,
		})
	return {
		type: 'layered',
		name: preset.name,
		elements,
		canvas: { decoration: 'none', showStatusIcons: 'default' },
		steps: preset.steps,
		feedbacks,
	}
}
