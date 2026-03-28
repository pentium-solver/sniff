<script lang="ts">
	import KeyBadge from '$lib/components/KeyBadge.svelte';
	import { goto } from '$app/navigation';

	const modes = [
		{ key: 'h', mode: 'signup_handoff', label: 'Pilot signup handoff capture' },
		{ key: 'k', mode: 'linkedin_cronet', label: 'LinkedIn Cronet capture' },
		{ key: 'l', mode: 'linkedin_replay', label: 'LinkedIn Cronet + challenge trace' },
		{ key: 'y', mode: 'dailypay', label: 'DailyPay capture (APEX cert inject)' },
		{ key: 'w', mode: 'speedway', label: 'Speedway / 7-Eleven capture' },
		{ key: 'j', mode: 'papajohns', label: 'Papa Johns capture (Flutter)' },
	];

	function start(mode: string) {
		goto(`/capture?mode=${mode}`);
	}
</script>

<div class="flex-1 flex items-start justify-center pt-12 px-4">
	<div class="w-full max-w-lg">
		<h2 class="text-sm font-bold text-text mb-1">App-Specific Modes</h2>
		<p class="text-xs text-muted mb-5">Specialized capture modes for apps with custom networking stacks.</p>

		<div class="space-y-1">
			{#each modes as item}
				<button
					class="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-panel-2 transition-colors text-left"
					onclick={() => start(item.mode)}
				>
					<KeyBadge key={item.key} />
					<span class="text-sm text-text-secondary">{item.label}</span>
				</button>
			{/each}
		</div>

		<a href="/" class="inline-block mt-6 text-xs text-muted hover:text-text no-underline">&larr; Back to menu</a>
	</div>
</div>
