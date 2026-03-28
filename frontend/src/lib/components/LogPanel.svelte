<script lang="ts">
	import { logs } from '$lib/stores';
	import { tick } from 'svelte';

	let el: HTMLDivElement | undefined = $state();

	$effect(() => {
		// scroll to bottom on new logs
		$logs;
		tick().then(() => {
			if (el) el.scrollTop = el.scrollHeight;
		});
	});
</script>

<div bind:this={el} class="border-t border-border bg-panel max-h-[150px] overflow-y-auto font-mono text-[11px] px-3.5 py-1.5">
	{#each $logs as log}
		<div class="py-0.5"
			class:text-good={log.Style === 'green'}
			class:text-bad={log.Style === 'red'}
			class:text-warn={log.Style === 'yellow'}
			class:text-accent={log.Style === 'cyan'}
			class:text-muted={!log.Style}
		>
			[{log.Time}] {log.Msg}
		</div>
	{/each}
</div>
