import { writable } from 'svelte/store';
import type { Flow, LogEntry } from './types';

export const flows = writable<Flow[]>([]);
export const logs = writable<LogEntry[]>([]);
export const capturing = writable(false);
export const captureMode = writable('');
export const captureName = writable('');
export const pkg = writable('');
export const selectedIndex = writable(-1);
