import { isCustomBodyMapping } from './custom-body'
import { defaultOption } from './option'

type ConfigRecord = Record<string, any>

const requiredConfigFields = ['on', 'service', 'display', 'from', 'to'] as const

function isRecord(value: unknown): value is ConfigRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isConfigImportValid(value: unknown): value is ConfigRecord {
  if (!isRecord(value)) return false
  if (!requiredConfigFields.every((field) => field in value)) return false
  if (typeof value.service !== 'string') return false
  return !('customBody' in value) || isCustomBodyMapping(value.customBody)
}

function removeDefaultEntries(target: ConfigRecord, key: 'system_role' | 'user_role', defaultValue: string) {
  const entries = target[key]
  if (!isRecord(entries)) return

  for (const [service, value] of Object.entries(entries)) {
    if (value === defaultValue) delete entries[service]
  }

  if (Object.keys(entries).length === 0) delete target[key]
}

function removeEmptyCustomBodies(target: ConfigRecord) {
  const entries = target.customBody
  if (!isRecord(entries)) return

  for (const [service, value] of Object.entries(entries)) {
    if (typeof value !== 'string' || !value.trim()) delete entries[service]
  }

  if (Object.keys(entries).length === 0) delete target.customBody
}

export function sanitizeConfigForExport(value: unknown): ConfigRecord {
  if (!isRecord(value)) throw new Error('配置必须是 JSON 对象')

  const sanitized = JSON.parse(JSON.stringify(value)) as ConfigRecord
  removeDefaultEntries(sanitized, 'system_role', defaultOption.system_role)
  removeDefaultEntries(sanitized, 'user_role', defaultOption.user_role)
  removeEmptyCustomBodies(sanitized)
  return sanitized
}
