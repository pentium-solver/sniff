<script lang="ts">
	import { formatBytes } from '$lib/api';
	import type { Flow } from '$lib/types';

	let {
		flows,
		selected = -1,
		onselect
	}: {
		flows: Flow[];
		selected?: number;
		onselect: (idx: number) => void;
	} = $props();

	let sortCol: string | null = $state(null);
	let sortAsc = $state(true);

	let sorted = $derived.by(() => {
		const arr = flows.map((f, i) => ({ ...f, _index: i + 1 }));
		if (!sortCol) return arr;
		const col = sortCol;
		const dir = sortAsc ? 1 : -1;
		return arr.sort((a, b) => {
			const av = col === 'index' ? a._index : (a as any)[col];
			const bv = col === 'index' ? b._index : (b as any)[col];
			if (typeof av === 'string') return dir * av.localeCompare(bv);
			return dir * ((av ?? 0) - (bv ?? 0));
		});
	});

	function toggleSort(col: string) {
		if (sortCol === col) {
			sortAsc = !sortAsc;
		} else {
			sortCol = col;
			sortAsc = true;
		}
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

	function statusClass(s: number): string {
		const c = String(s)[0];
		if (c === '2') return 'text-good';
		if (c === '3') return 'text-warn';
		if (c === '4' || c === '5') return 'text-bad';
		return 'text-muted';
	}

	const cols = [
		{ key: 'index', label: '#', w: 'w-11' },
		{ key: 'status', label: 'Status', w: 'w-14' },
		{ key: 'method', label: 'Method', w: 'w-[72px]' },
		{ key: 'host', label: 'Host', w: 'w-40' },
		{ key: 'path', label: 'Path', w: '' },
		{ key: 'resp_size', label: 'Size', w: 'w-16' },
	];
</script>

<div class="flex-1 overflow-auto">
	<table class="w-full border-collapse text-xs">
		<thead class="sticky top-0 z-10">
			<tr>
				{#each cols as col}
					<th
						class="text-left bg-panel text-muted border-b-2 border-border px-2 py-2 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-text {col.w}"
						class:text-accent={sortCol === col.key}
						onclick={() => toggleSort(col.key)}
					>
						{col.label}
						<span class="ml-0.5 text-[10px] opacity-40" class:opacity-100={sortCol === col.key}>
							{sortCol === col.key ? (sortAsc ? '\u25B2' : '\u25BC') : '\u25B2'}
						</span>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each sorted as flow, idx (flow._index)}
				<tr
					class="cursor-pointer border-b border-border/30 transition-colors duration-75 hover:bg-accent/[.06]"
					class:bg-accent-dim={idx === selected}
					onclick={() => onselect(idx)}
				>
					<td class="px-2 py-1.5 text-muted w-11">{flow._index}</td>
					<td class="px-2 py-1.5 w-14 {statusClass(flow.status)}">{flow.status}</td>
					<td class="px-2 py-1.5 w-[72px]">
						<span class="inline-block rounded px-1.5 py-px text-[11px] font-semibold font-mono {methodClass(flow.method)}">
							{flow.method}
						</span>
					</td>
					<td class="px-2 py-1.5 w-40 text-text-secondary truncate" title={flow.host}>{flow.host}</td>
					<td class="px-2 py-1.5 text-text-secondary truncate max-w-0" title={flow.path}>{flow.path}</td>
					<td class="px-2 py-1.5 w-16 text-text-secondary">{formatBytes(flow.resp_size)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
