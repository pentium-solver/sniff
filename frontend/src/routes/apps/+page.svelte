<script lang="ts">
	import { api } from '$lib/api';
	import { pkg } from '$lib/stores';
	import type { AppItem } from '$lib/types';
	import { apiPut } from '$lib/api';

	let apps: AppItem[] = $state([]);
	let loading = $state(true);
	let filter = $state('');

	async function load() {
		loading = true;
		try {
			apps = await api('/apps');
		} catch (e) {
			console.error('apps load:', e);
		} finally {
			loading = false;
		}
	}

	load();

	let filtered = $derived(
		filter
			? apps.filter(
					(a) =>
						a.Name.toLowerCase().includes(filter.toLowerCase()) ||
						a.ID.toLowerCase().includes(filter.toLowerCase())
				)
			: apps
	);

	async function selectApp(id: string) {
		await apiPut('/settings', { key: 'package', value: id });
		pkg.set(id);
	}
</script>

<div class="flex-1 flex flex-col overflow-hidden p-5">
	<div class="flex items-center gap-3 mb-3">
		<h2 class="text-sm font-bold text-text">Installed Apps</h2>
		<span class="text-xs text-muted">{apps.length} apps</span>
	</div>

	<input
		type="text"
		placeholder="Filter apps..."
		class="mb-3 w-full max-w-md bg-panel-2 border border-border rounded px-3 py-1.5 text-xs font-mono text-text outline-none focus:border-accent placeholder:text-muted"
		bind:value={filter}
	/>

	{#if loading}
		<p class="text-xs text-muted">Loading apps (this may take a moment)...</p>
	{:else}
		<div class="flex-1 overflow-auto">
			<div class="space-y-px max-w-2xl">
				{#each filtered as app}
					<button
						class="w-full flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-panel-2 transition-colors text-left"
						class:bg-accent-dim={$pkg === app.ID}
						onclick={() => selectApp(app.ID)}
					>
						<span class="text-xs text-text-secondary truncate flex-1">{app.Name}</span>
						<span class="text-[11px] font-mono text-muted truncate max-w-[300px]">{app.ID}</span>
						{#if app.PID > 0}
							<span class="text-[10px] font-mono text-good bg-good-dim rounded px-1.5 py-px shrink-0">PID {app.PID}</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
