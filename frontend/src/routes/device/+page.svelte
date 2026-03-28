<script lang="ts">
	import { api, apiPost } from '$lib/api';
	import type { DeviceInfo } from '$lib/types';

	let info: DeviceInfo | null = $state(null);
	let connected = $state(false);
	let error = $state('');
	let loading = $state(true);
	let startingFrida = $state(false);
	let clearingProxy = $state(false);

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await api('/device');
			connected = res.connected;
			if (res.connected) {
				info = res.info;
			} else {
				error = res.error || 'Not connected';
			}
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	}

	load();

	async function startFrida() {
		startingFrida = true;
		try {
			await apiPost('/device/frida/start', {});
			setTimeout(load, 2000);
		} catch (e: any) {
			error = e.message;
		} finally {
			startingFrida = false;
		}
	}

	async function clearProxy() {
		clearingProxy = true;
		try {
			await apiPost('/device/proxy/clear', {});
			setTimeout(load, 500);
		} catch (e: any) {
			error = e.message;
		} finally {
			clearingProxy = false;
		}
	}

	function statusColor(ok: boolean): string {
		return ok ? 'text-good' : 'text-bad';
	}
</script>

<div class="flex-1 overflow-auto p-5">
	<div class="flex items-center gap-3 mb-5">
		<h2 class="text-sm font-bold text-text">Device</h2>
		<button
			class="text-[11px] text-muted border border-border rounded px-2 py-0.5 bg-panel-2 hover:bg-panel-3 hover:text-text font-medium"
			onclick={load}
		>Refresh</button>
	</div>

	{#if loading}
		<p class="text-xs text-muted">Loading device info...</p>
	{:else if !connected}
		<div class="rounded-md border border-border bg-panel-2 p-4 max-w-md">
			<p class="text-xs text-bad font-medium">{error || 'No ADB device connected'}</p>
			<p class="text-xs text-muted mt-2">Connect your Android device via USB and enable USB debugging.</p>
		</div>
	{:else if info}
		<div class="space-y-1 max-w-lg">
			<div class="flex px-3 py-1.5 text-xs">
				<span class="w-36 text-muted font-medium">Model</span>
				<span class="text-text-secondary font-mono">{info.Model}</span>
			</div>
			<div class="flex px-3 py-1.5 text-xs">
				<span class="w-36 text-muted font-medium">Android</span>
				<span class="text-text-secondary font-mono">{info.Android}</span>
			</div>
			<div class="flex px-3 py-1.5 text-xs">
				<span class="w-36 text-muted font-medium">SDK</span>
				<span class="text-text-secondary font-mono">{info.SDK}</span>
			</div>
			<div class="flex px-3 py-1.5 text-xs">
				<span class="w-36 text-muted font-medium">SELinux</span>
				<span class="text-text-secondary font-mono">{info.SELinux}</span>
			</div>
			<div class="flex px-3 py-1.5 text-xs">
				<span class="w-36 text-muted font-medium">Frida Server</span>
				<span class="font-mono {statusColor(info.FridaRunning)}">
					{info.FridaRunning ? 'Running' : 'Stopped'}
				</span>
				{#if !info.FridaRunning}
					<button
						class="ml-3 text-[11px] text-accent border border-border rounded px-2 py-0.5 bg-panel-2 hover:bg-panel-3 font-medium"
						onclick={startFrida}
						disabled={startingFrida}
					>{startingFrida ? 'Starting...' : 'Start'}</button>
				{/if}
			</div>
			<div class="flex px-3 py-1.5 text-xs">
				<span class="w-36 text-muted font-medium">Proxy</span>
				<span class="text-text-secondary font-mono">{info.Proxy || 'none'}</span>
				{#if info.Proxy}
					<button
						class="ml-3 text-[11px] text-warn border border-border rounded px-2 py-0.5 bg-panel-2 hover:bg-panel-3 font-medium"
						onclick={clearProxy}
						disabled={clearingProxy}
					>{clearingProxy ? 'Clearing...' : 'Clear'}</button>
				{/if}
			</div>
			<div class="flex px-3 py-1.5 text-xs">
				<span class="w-36 text-muted font-medium">Host IP</span>
				<span class="text-text-secondary font-mono">{info.HostIP}</span>
			</div>
		</div>
	{/if}
</div>
