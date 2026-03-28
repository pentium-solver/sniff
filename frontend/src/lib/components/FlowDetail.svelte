<script lang="ts">
	import { formatBytes } from '$lib/api';
	import type { Flow } from '$lib/types';
	import JsonView from './JsonView.svelte';

	let { flow }: { flow: Flow | null } = $props();

	let activeTab = $state('headers');

	const tabs = [
		{ id: 'headers', label: 'Headers' },
		{ id: 'query', label: 'Query' },
		{ id: 'reqBody', label: 'Request Body' },
		{ id: 'resBody', label: 'Response Body' },
	];

	let queryParams = $derived.by(() => {
		if (!flow) return [];
		try {
			const u = new URL(flow.url);
			const params: { name: string; value: string }[] = [];
			u.searchParams.forEach((v, k) => params.push({ name: k, value: v }));
			return params;
		} catch {
			return [];
		}
	});

	let reqHeaders = $derived(flow ? Object.entries(flow.req_headers || {}) : []);
	let resHeaders = $derived(flow ? Object.entries(flow.resp_headers || {}) : []);

	function statusClass(s: number): string {
		const c = String(s)[0];
		if (c === '2') return 'bg-good-dim text-good';
		if (c === '3') return 'bg-warn-dim text-warn';
		if (c === '4' || c === '5') return 'bg-bad-dim text-bad';
		return 'bg-panel-2 text-muted';
	}

	function methodClass(m: string): string {
		const map: Record<string, string> = {
			GET: 'bg-good-dim text-good',
			POST: 'bg-accent-dim text-accent',
			PUT: 'bg-warn-dim text-warn',
			PATCH: 'bg-warn-dim text-warn',
			DELETE: 'bg-bad-dim text-bad',
		};
		return map[m] || 'bg-panel-2 text-muted';
	}

	function copy(text: string) {
		navigator.clipboard.writeText(text);
	}

	function headerVal(headers: Record<string, string>, name: string): string {
		for (const [k, v] of Object.entries(headers)) {
			if (k.toLowerCase() === name.toLowerCase()) return v;
		}
		return '';
	}

	let tabCounts = $derived({
		headers: reqHeaders.length + resHeaders.length,
		query: queryParams.length,
		reqBody: flow?.req_body ? 1 : 0,
		resBody: flow?.resp_body ? 1 : 0,
	});
</script>

{#if !flow}
	<div class="flex items-center justify-center h-full text-muted text-xs font-medium tracking-wide">
		Select a request to inspect
	</div>
{:else}
	<!-- URL bar -->
	<div class="px-4 py-2.5 border-b border-border bg-panel flex items-center gap-2 min-h-[42px]">
		<span class="inline-block rounded px-1.5 py-px text-xs font-semibold font-mono shrink-0 {methodClass(flow.method)}">
			{flow.method}
		</span>
		<span class="font-mono text-xs text-text break-all leading-snug">{flow.url}</span>
		<button
			class="ml-auto shrink-0 text-[11px] text-muted border border-border rounded px-2 py-0.5 bg-panel-2 hover:bg-panel-3 hover:text-text transition-colors font-medium"
			onclick={() => copy(flow.url)}
		>Copy</button>
		<span class="shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold font-mono {statusClass(flow.status)}">
			{flow.status}
		</span>
	</div>

	<!-- Meta -->
	<div class="px-4 py-2 border-b border-border bg-panel flex gap-5 flex-wrap text-xs">
		<span><span class="text-muted font-medium">Host:</span> <span class="text-text-secondary font-mono text-[11px]">{flow.host}</span></span>
		<span><span class="text-muted font-medium">Size:</span> <span class="text-text-secondary font-mono text-[11px]">{formatBytes(flow.resp_size)}</span></span>
		<span><span class="text-muted font-medium">Type:</span> <span class="text-text-secondary font-mono text-[11px]">{flow.content_type || '-'}</span></span>
	</div>

	<!-- Tabs -->
	<div class="flex border-b-2 border-border bg-panel px-2 overflow-x-auto shrink-0">
		{#each tabs as tab}
			<button
				class="relative border-0 bg-transparent text-muted px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors hover:text-text-secondary"
				class:text-text={activeTab === tab.id}
				onclick={() => (activeTab = tab.id)}
			>
				{tab.label}
				{#if (tabCounts as any)[tab.id]}
					<span class="ml-1 text-[10px] text-muted opacity-70">({(tabCounts as any)[tab.id]})</span>
				{/if}
				{#if activeTab === tab.id}
					<span class="absolute bottom-[-2px] left-0 right-0 h-0.5 bg-accent rounded-t"></span>
				{/if}
			</button>
		{/each}
	</div>

	<!-- Content -->
	<div class="flex-1 min-h-0 overflow-auto p-4">
		{#if activeTab === 'headers'}
			{#if reqHeaders.length}
				<div class="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2 pb-1 border-b border-border flex justify-between items-center">
					<span>Request Headers ({reqHeaders.length})</span>
					<button class="text-[11px] text-muted border border-border rounded px-2 py-0.5 bg-panel-2 hover:bg-panel-3 hover:text-text font-medium normal-case tracking-normal" onclick={() => copy(reqHeaders.map(([k,v]) => `${k}: ${v}`).join('\n'))}>Copy</button>
				</div>
				<table class="w-full border-collapse text-xs mb-4">
					<thead><tr>
						<th class="text-left text-muted font-semibold text-[11px] uppercase tracking-wide px-2 py-1.5 border-b border-border sticky top-0 bg-[#0b1016]">Name</th>
						<th class="text-left text-muted font-semibold text-[11px] uppercase tracking-wide px-2 py-1.5 border-b border-border sticky top-0 bg-[#0b1016]">Value</th>
					</tr></thead>
					<tbody>
						{#each reqHeaders as [k, v]}
							<tr class="hover:bg-accent/[.04]">
								<td class="px-2 py-1 border-b border-border/30 text-accent font-medium font-mono whitespace-nowrap w-[220px] min-w-[160px]">{k}</td>
								<td class="px-2 py-1 border-b border-border/30 text-text-secondary font-mono break-all">{v}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			{#if resHeaders.length}
				<div class="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2 pb-1 border-b border-border flex justify-between items-center">
					<span>Response Headers ({resHeaders.length})</span>
					<button class="text-[11px] text-muted border border-border rounded px-2 py-0.5 bg-panel-2 hover:bg-panel-3 hover:text-text font-medium normal-case tracking-normal" onclick={() => copy(resHeaders.map(([k,v]) => `${k}: ${v}`).join('\n'))}>Copy</button>
				</div>
				<table class="w-full border-collapse text-xs">
					<thead><tr>
						<th class="text-left text-muted font-semibold text-[11px] uppercase tracking-wide px-2 py-1.5 border-b border-border sticky top-0 bg-[#0b1016]">Name</th>
						<th class="text-left text-muted font-semibold text-[11px] uppercase tracking-wide px-2 py-1.5 border-b border-border sticky top-0 bg-[#0b1016]">Value</th>
					</tr></thead>
					<tbody>
						{#each resHeaders as [k, v]}
							<tr class="hover:bg-accent/[.04]">
								<td class="px-2 py-1 border-b border-border/30 text-accent font-medium font-mono whitespace-nowrap w-[220px] min-w-[160px]">{k}</td>
								<td class="px-2 py-1 border-b border-border/30 text-text-secondary font-mono break-all">{v}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		{:else if activeTab === 'query'}
			{#if queryParams.length === 0}
				<p class="text-muted text-xs">No query parameters</p>
			{:else}
				<table class="w-full border-collapse text-xs">
					<thead><tr>
						<th class="text-left text-muted font-semibold text-[11px] uppercase tracking-wide px-2 py-1.5 border-b border-border sticky top-0 bg-[#0b1016]">Name</th>
						<th class="text-left text-muted font-semibold text-[11px] uppercase tracking-wide px-2 py-1.5 border-b border-border sticky top-0 bg-[#0b1016]">Value</th>
					</tr></thead>
					<tbody>
						{#each queryParams as p}
							<tr class="hover:bg-accent/[.04]">
								<td class="px-2 py-1 border-b border-border/30 text-accent font-medium font-mono w-[220px]">{p.name}</td>
								<td class="px-2 py-1 border-b border-border/30 text-text-secondary font-mono break-all">{p.value}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		{:else if activeTab === 'reqBody'}
			<JsonView text={flow.req_body} mime={headerVal(flow.req_headers || {}, 'content-type')} />
		{:else if activeTab === 'resBody'}
			<JsonView text={flow.resp_body} mime={flow.content_type} />
		{/if}
	</div>
{/if}
