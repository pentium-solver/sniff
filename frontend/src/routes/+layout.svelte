<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { capturing, pkg } from '$lib/stores';
	import { api, connectSSE } from '$lib/api';

	let { children } = $props();

	const routeNames: Record<string, string> = {
		'/': '',
		'/settings': 'Settings',
		'/device': 'Device',
		'/apps': 'Apps',
		'/scripts': 'Scripts',
		'/capture': 'Capture',
		'/modes': 'Modes',
	};

	let currentName = $derived(routeNames[page.url.pathname] || '');
	let isCapturing = $state(false);

	onMount(async () => {
		try {
			const s = await api('/state');
			pkg.set(s.settings.package || '');
			capturing.set(s.capturing);
			isCapturing = s.capturing;
		} catch (e) {
			console.error('init:', e);
		}
		connectSSE();

		return capturing.subscribe((v) => {
			isCapturing = v;
		});
	});
</script>

<div class="flex flex-col h-screen bg-bg">
	<nav style="display:flex;align-items:center;gap:14px;padding:10px 20px;border-bottom:1px solid #30363d;background:#161b22;">
		<a href="/" style="font-family:monospace;font-weight:bold;font-size:15px;color:#58a6ff;text-decoration:none;">sniff-tui</a>
		{#if currentName}
			<span style="color:#8b949e;font-size:12px;">
				<a href="/" style="color:#8b949e;text-decoration:none;">Menu</a>
				<span style="margin:0 4px;opacity:0.5;">/</span>
				<span style="color:#c9d1d9;">{currentName}</span>
			</span>
		{/if}
		<div style="flex:1;"></div>
		<span style="padding:2px 12px;border-radius:9999px;font-size:11px;font-weight:600;background:{isCapturing ? 'rgba(63,185,80,0.15)' : '#1f2630'};color:{isCapturing ? '#3fb950' : '#8b949e'};border:1px solid {isCapturing ? '#3fb950' : '#30363d'};">
			{isCapturing ? 'Capturing' : 'Idle'}
		</span>
	</nav>

	<main class="flex-1 flex flex-col min-h-0 overflow-hidden">
		{@render children()}
	</main>
</div>
