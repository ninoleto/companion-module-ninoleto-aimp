export function getConfigFields() {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'AIMP Companion Control',
			width: 12,
			value:
				'Use AIMP Companion Control 0.3.0 or later for artwork, lyrics, music-library browsing, playlist sources and tag editing. The 0.2.0 plugin supports pitch, effects, EQ and queue controls. The 0.1.0 plugin still supports the existing playback controls. In AIMP, verify “WebSocket listening” in the plugin settings. Use 127.0.0.1 only when AIMP and Companion run on the same computer; for another computer, select the AIMP PC’s LAN interface and allow the Companion PC’s IP.',
		},
		{ type: 'textinput', id: 'host', label: 'AIMP computer: IPv4 address / hostname', default: '127.0.0.1', width: 9 },
		{ type: 'number', id: 'port', label: 'WebSocket port', default: 19122, min: 1, max: 65535, width: 3 },
		{
			type: 'number',
			id: 'trackLimit',
			label: 'Maximum tracks loaded per playlist',
			default: 10000,
			min: 100,
			max: 100000,
			width: 6,
		},
		{
			type: 'checkbox',
			id: 'trackPresets',
			label: 'Generate a Play preset for every loaded track',
			default: true,
			width: 12,
		},
		{
			type: 'checkbox',
			id: 'autoMedia',
			label: 'Load artwork and lyrics when the playing track changes',
			default: true,
			width: 12,
		},
		{
			type: 'checkbox',
			id: 'advancedPresets',
			label: 'Show advanced preset variants',
			default: false,
			width: 12,
		},
		{
			type: 'static-text',
			id: 'limits',
			label: 'Library presets',
			width: 12,
			value:
				'Everyday presets include supported audio controls and rotary encoders. Advanced adds explicit on/off, extra step sizes, playlist editing and query templates. All supported actions remain available in the button editor. New feature groups appear after capability discovery. Use “Refresh library” after external playlist edits. Some AIMP settings have no documented direct control API; settings-window buttons open those dialogs.',
		},
	]
}
