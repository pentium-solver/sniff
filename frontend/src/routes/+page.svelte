<script lang="ts">
	import { pkg } from '$lib/stores';
	import { api } from '$lib/api';
	import KeyBadge from '$lib/components/KeyBadge.svelte';

	let scriptLabel = $state('');
	let scriptName = $state('');
	let port = $state(0);
	let loaded = $state(false);

	async function load() {
		try {
			const s = await api('/state');
			pkg.set(s.settings.package || '');
			port = s.settings.port || 0;
			const scripts = await api('/scripts');
			const activeId = s.settings.frida_script_id || 'universal';
			const active = scripts.find((sc: any) => sc.ID === activeId);
			if (active) {
				scriptLabel = active.Label;
				scriptName = active.Name;
			}
		} catch (e) {
			console.error('menu load:', e);
		} finally {
			loaded = true;
		}
	}

	load();

	const menuItems = [
		{ href: '/capture', key: 'c', label: 'Start capture', desc: 'Standard SSL unpinning + proxy capture' },
		{ href: '/capture?mode=mitm_only', key: 'm', label: 'MITM only capture', desc: 'Proxy only, no Frida injection' },
		{ href: '/modes', key: 'n', label: 'App-specific modes', desc: 'LinkedIn, DailyPay, Papa Johns, etc.' },
		{ href: '/settings', key: 's', label: 'Settings', desc: 'Package, port, frida, export config' },
		{ href: '/scripts', key: 'f', label: 'Frida scripts', desc: 'Select SSL bypass script' },
		{ href: '/device', key: 'd', label: 'Device info', desc: 'ADB, Frida server, proxy status' },
		{ href: '/apps', key: 'a', label: 'Installed apps', desc: 'Browse and select target app' },
	];
</script>

<div class="flex-1 flex items-start justify-center pt-16 px-6">
	<div class="w-full max-w-xl">
		<h1 class="text-xl font-bold text-text mb-4 tracking-tight font-sans">Android HTTPS Interception</h1>

		{#if loaded}
			<div class="rounded-lg border border-border bg-panel px-4 py-3 mb-8 space-y-1">
				<div class="flex items-center gap-2 text-xs">
					<span class="text-muted font-medium w-16">Package</span>
					<span class="font-mono text-[12px] text-text-secondary">{$pkg || 'not set'}</span>
				</div>
				{#if scriptName}
					<div class="flex items-center gap-2 text-xs">
						<span class="text-muted font-medium w-16">Script</span>
						<span class="rounded px-1.5 py-px text-[10px] font-bold bg-good-dim text-good">{scriptLabel}</span>
						<span class="font-mono text-[12px] text-text-secondary">{scriptName}</span>
					</div>
				{/if}
				{#if port}
					<div class="flex items-center gap-2 text-xs">
						<span class="text-muted font-medium w-16">Port</span>
						<span class="font-mono text-[12px] text-text-secondary">{port}</span>
					</div>
				{/if}
			</div>
		{/if}

		<div class="space-y-0.5">
			{#each menuItems as item}
				<a
					href={item.href}
					class="flex items-center gap-3.5 px-3 py-2.5 rounded-lg hover:bg-panel-2 transition-colors no-underline group"
				>
					<KeyBadge key={item.key} />
					<div class="flex flex-col">
						<span class="text-[13px] font-medium text-text-secondary group-hover:text-text transition-colors">{item.label}</span>
						<span class="text-[11px] text-muted leading-tight">{item.desc}</span>
					</div>
				</a>
			{/each}
		</div>
	</div>
</div>
