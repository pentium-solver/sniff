<script lang="ts">
	import { api, apiPut } from '$lib/api';
	import type { SettingsField } from '$lib/types';
	import { pkg } from '$lib/stores';

	let fields: SettingsField[] = $state([]);
	let editing: string | null = $state(null);
	let editValue = $state('');
	let saving = $state(false);

	async function load() {
		try {
			fields = await api('/settings');
		} catch (e) {
			console.error('settings load:', e);
		}
	}

	load();

	function startEdit(f: SettingsField) {
		editing = f.key;
		editValue = f.value;
	}

	async function save(key: string) {
		saving = true;
		try {
			await apiPut('/settings', { key, value: editValue });
			const idx = fields.findIndex((f) => f.key === key);
			if (idx >= 0) fields[idx].value = editValue;
			if (key === 'package') pkg.set(editValue);
			editing = null;
		} catch (e) {
			console.error('save:', e);
		} finally {
			saving = false;
		}
	}

	function cancel() {
		editing = null;
	}

	function handleKey(e: KeyboardEvent, key: string) {
		if (e.key === 'Enter') save(key);
		if (e.key === 'Escape') cancel();
	}
</script>

<div class="flex-1 overflow-auto p-5">
	<h2 class="text-sm font-bold text-text mb-4">Settings</h2>
	<div class="space-y-1 max-w-2xl">
		{#each fields as f}
			<div class="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-panel-2 group">
				<div class="w-48 shrink-0">
					<span class="text-xs font-medium text-muted">{f.label}</span>
				</div>
				{#if editing === f.key}
					<input
						type="text"
						class="flex-1 bg-panel-2 border border-border-light rounded px-2 py-1 text-xs font-mono text-text outline-none focus:border-accent"
						bind:value={editValue}
						onkeydown={(e) => handleKey(e, f.key)}
						autofocus
					/>
					<button
						class="text-[11px] text-good border border-border rounded px-2 py-0.5 bg-panel-2 hover:bg-panel-3 font-medium"
						onclick={() => save(f.key)}
						disabled={saving}
					>Save</button>
					<button
						class="text-[11px] text-muted border border-border rounded px-2 py-0.5 bg-panel-2 hover:bg-panel-3 font-medium"
						onclick={cancel}
					>Esc</button>
				{:else}
					<span class="flex-1 text-xs font-mono text-text-secondary truncate">{f.value || '-'}</span>
					<button
						class="text-[11px] text-muted border border-border rounded px-2 py-0.5 bg-panel-2 hover:bg-panel-3 hover:text-text font-medium opacity-0 group-hover:opacity-100 transition-opacity"
						onclick={() => startEdit(f)}
					>Edit</button>
				{/if}
			</div>
		{/each}
	</div>
</div>
