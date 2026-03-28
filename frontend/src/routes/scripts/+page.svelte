<script lang="ts">
	import { api, apiPut } from '$lib/api';
	import type { FridaScript } from '$lib/types';

	let scripts: FridaScript[] = $state([]);
	let activeId = $state('universal');
	let loading = $state(true);

	async function load() {
		loading = true;
		try {
			const [scriptList, state] = await Promise.all([api('/scripts'), api('/state')]);
			scripts = scriptList;
			activeId = state.settings.frida_script_id || 'universal';
		} catch (e) {
			console.error('scripts load:', e);
		} finally {
			loading = false;
		}
	}

	load();

	async function select(id: string) {
		await apiPut('/settings', { key: 'frida_script_id', value: id });
		activeId = id;
	}

	function labelColor(label: string): string {
		const map: Record<string, string> = {
			BEST: 'bg-good-dim text-good',
			LIGHTWEIGHT: 'bg-accent-dim text-accent',
			'OKHTTP APPS': 'bg-warn-dim text-warn',
			DIAGNOSTIC: 'bg-panel-2 text-muted',
			'HYBRID APPS': 'bg-accent-dim text-accent',
			'RN APPS': 'bg-accent-dim text-accent',
			FLUTTER: 'bg-bad-dim text-bad',
			'APP-SPECIFIC': 'bg-bad-dim text-bad',
		};
		return map[label] || 'bg-panel-2 text-muted';
	}
</script>

<div class="flex-1 overflow-auto p-5">
	<h2 class="text-sm font-bold text-text mb-4">Frida Scripts</h2>

	{#if loading}
		<p class="text-xs text-muted">Loading scripts...</p>
	{:else}
		<div class="space-y-2 max-w-2xl">
			{#each scripts as script}
				<button
					class="w-full text-left rounded-md border border-border px-4 py-3 transition-colors hover:border-border-light"
					class:border-accent={activeId === script.ID}
					class:bg-accent-dim={activeId === script.ID}
					class:bg-panel={activeId !== script.ID}
					onclick={() => select(script.ID)}
				>
					<div class="flex items-center gap-2 mb-1">
						<span class="rounded px-1.5 py-px text-[10px] font-bold tracking-wide {labelColor(script.Label)}">{script.Label}</span>
						<span class="text-xs font-semibold text-text">{script.Name}</span>
						{#if activeId === script.ID}
							<span class="text-[10px] text-good font-semibold ml-auto">ACTIVE</span>
						{/if}
					</div>
					<p class="text-[11px] text-muted leading-relaxed">{script.Desc}</p>
				</button>
			{/each}
		</div>
	{/if}
</div>
