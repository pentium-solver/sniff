<script lang="ts">
	let { text, mime = '' }: { text: string | null; mime?: string } = $props();

	function highlight(src: string): string {
		return src
			.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
			.replace(/("(?:\\.|[^"\\])*")\s*:/g, '<span class="text-[#79c0ff]">$1</span>:')
			.replace(/:\s*("(?:\\.|[^"\\])*")/g, ': <span class="text-[#a5d6ff]">$1</span>')
			.replace(/:\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g, ': <span class="text-[#79c0ff]">$1</span>')
			.replace(/:\s*(true|false)/g, ': <span class="text-[#ff7b72]">$1</span>')
			.replace(/:\s*(null)/g, ': <span class="text-muted">$1</span>');
	}

	function format(raw: string): string {
		const isJson = (mime && mime.includes('json')) || /^\s*[\[{]/.test(raw);
		if (isJson) {
			try {
				return highlight(JSON.stringify(JSON.parse(raw), null, 2));
			} catch {}
		}
		return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}
</script>

{#if text}
	<pre class="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-text-secondary">{@html format(text)}</pre>
{:else}
	<p class="text-muted text-xs">No body content</p>
{/if}
