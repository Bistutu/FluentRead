export interface DebugEntry {
    timestamp: number;
    service: string;
    origin: string;
    request: any;
    response?: string;
    error?: string;
    duration?: number;
}

let latest: DebugEntry | null = null;

export function store(data: Omit<DebugEntry, 'timestamp'>): void {
    latest = { timestamp: Date.now(), ...data };
}

export function getLatest(): DebugEntry | null {
    return latest;
}
