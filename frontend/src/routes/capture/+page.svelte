<script lang="ts">
	import { page } from '$app/state';
	import { flows, logs, capturing, pkg, captureName } from '$lib/stores';
	import { api, apiPost } from '$lib/api';
	import FlowTable from '$lib/components/FlowTable.svelte';
	import FlowDetail from '$lib/components/FlowDetail.svelte';
	import LogPanel from '$lib/components/LogPanel.svelte';
	import type { Flow } from '$lib/types';

	let selectedIdx = $state(-1);
	let selectedFlow: Flow | null = $state(null);
	let showDetail = $state(false);
	let exporting = $state(false);
	let exportMsg = $state('');

	// Auto-start if mode param present and not already capturing
	let autoStarted = false;
	$effect(() => {
		const mode = page.url.searchParams.get('mode');
		if (mode && !$capturing && !autoStarted) {
			autoStarted = true;
			startCapture(mode);
		}
	});

	async function startCapture(mode = 'standard') {
		try {
			await apiPost('/capture/start', { mode, package: $pkg });
		} catch (e: any) {
			console.error('start:', e);
		}
	}

	async function stopCapture() {
		try {
			await apiPost('/capture/stop', {});
		} catch (e: any) {
			console.error('stop:', e);
		}
	}

	async function clearFlows() {
		try {
			await apiPost('/capture/clear', {});
			selectedIdx = -1;
			selectedFlow = null;
			showDetail = false;
		} catch (e: any) {
			console.error('clear:', e);
		}
	}

	async function exportFlows() {
		exporting = true;
		exportMsg = '';
		try {
			const res = await apiPost('/export', {});
			exportMsg = `Exported ${res.count} flows → ${res.path}`;
		} catch (e: any) {
			exportMsg = 'Export failed: ' + e.message;
		} finally {
			exporting = false;
		}
	}

	function onSelect(idx: number) {
		selectedIdx = idx;
		selectedFlow = $flows[idx] || null;
		showDetail = true;
	}
</script>

<div class="flex-1 flex flex-col min-h-0">
	<!-- Toolbar -->
	<div class="px-4 py-2 border-b border-border bg-panel flex items-center gap-2 shrink-0">
		{#if !$capturing}
			<button
				class="text-xs font-medium text-good border border-border rounded px-3 py-1 bg-panel-2 hover:bg-panel-3 transition-colors"
				onclick={() => startCapture()}
			>Start</button>
		{:else}
			<button
				class="text-xs font-medium text-bad border border-border rounded px-3 py-1 bg-panel-2 hover:bg-panel-3 transition-colors"
				onclick={stopCapture}
			>Stop</button>
		{/if}
		<button
			class="text-xs font-medium text-muted border border-border rounded px-3 py-1 bg-panel-2 hover:bg-panel-3 hover:text-text transition-colors"
			onclick={clearFlows}
		>Clear</button>
		<button
			class="text-xs font-medium text-muted border border-border rounded px-3 py-1 bg-panel-2 hover:bg-panel-3 hover:text-text transition-colors"
			onclick={exportFlows}
			disabled={exporting}
		>{exporting ? 'Exporting...' : 'Export'}</button>

		<div class="flex-1"></div>

		{#if exportMsg}
			<span class="text-[11px] text-muted font-mono">{exportMsg}</span>
		{/if}
		{#if $captureName}
			<span class="text-[11px] text-muted font-mono">{$captureName}</span>
		{/if}
		<span class="text-[11px] text-muted">{$flows.length} flows</span>
	</div>

	<!-- Main content -->
	<div class="flex-1 flex min-h-0">
		<!-- Flow list -->
		<div class="flex-1 flex flex-col min-w-0" class:max-w-[60%]={showDetail}>
			<FlowTable flows={$flows} selected={selectedIdx} onselect={onSelect} />
		</div>

		<!-- Detail panel -->
		{#if showDetail}
			<div class="w-[40%] min-w-[320px] border-l border-border flex flex-col overflow-hidden">
				<div class="flex items-center justify-between px-3 py-1.5 border-b border-border bg-panel shrink-0">
					<span class="text-[11px] text-muted font-medium">Detail</span>
					<button
						class="text-[11px] text-muted hover:text-text"
						onclick={() => { showDetail = false; selectedIdx = -1; selectedFlow = null; }}
					>Close</button>
				</div>
				<div class="flex-1 flex flex-col overflow-hidden">
					<FlowDetail flow={selectedFlow} />
				</div>
			</div>
		{/if}
	</div>

	<!-- Log panel -->
	<LogPanel />
</div>
