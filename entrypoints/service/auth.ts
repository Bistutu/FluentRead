export function appendOptionalBearer(headers: Headers, token?: string): void {
    const trimmedToken = token?.trim();
    appendOptionalHeader(headers, 'Authorization', trimmedToken ? `Bearer ${trimmedToken}` : '');
}

export function appendOptionalHeader(headers: Headers, name: string, value?: string): void {
    const trimmedValue = value?.trim();
    if (trimmedValue) headers.set(name, trimmedValue);
}
