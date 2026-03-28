import { flows, logs, capturing, captureMode, captureName } from './stores';
import type { Flow, LogEntry } from './types';

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
	const res = await fetch('/api' + path, opts);
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}

export async function apiPost<T = any>(path: string, body: any): Promise<T> {
	return api(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

export async function apiPut<T = any>(path: string, body: any): Promise<T> {
	return api(path, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

let eventSource: EventSource | null = null;

export function connectSSE() {
	if (eventSource) eventSource.close();
	eventSource = new EventSource('/api/events');

	eventSource.addEventListener('flow', (e) => {
		const flow: Flow = JSON.parse(e.data);
		flows.update((f) => [...f, flow]);
	});

	eventSource.addEventListener('log', (e) => {
		const entry: LogEntry = JSON.parse(e.data);
		logs.update((l) => [...l, entry]);
	});

	eventSource.addEventListener('state', (e) => {
		const s = JSON.parse(e.data);
		capturing.set(s.capturing);
		captureMode.set(s.captureMode || '');
		captureName.set(s.captureName || '');
	});

	eventSource.addEventListener('clear', () => {
		flows.set([]);
	});
}

export function formatBytes(b: number | null | undefined): string {
	if (b == null || b < 0) return '-';
	if (b === 0) return '0';
	if (b < 1024) return b + ' B';
	if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' K';
	return (b / (1024 * 1024)).toFixed(1) + ' M';
}
