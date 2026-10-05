// IDs originate in local files or IPC. Keep them to a single filename.
export function assertStorageId(id: string): void {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    throw new Error('Invalid saved item ID')
  }
}

export function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
}

export function assertEntryText(text: string): void {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Writing cannot be empty')
}
