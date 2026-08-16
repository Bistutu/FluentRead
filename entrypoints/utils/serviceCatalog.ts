export interface ServiceOption {
  value: string
  label: string
  disabled?: boolean
}

export interface ServiceGroup {
  id: string
  label: string
  items: ServiceOption[]
}

export function cleanServiceLabel(label: string) {
  return label.replace(/[⭐️★]+/gu, '').trim()
}

export function buildServiceGroups(options: ServiceOption[]): ServiceGroup[] {
  const groups: ServiceGroup[] = []
  let current: ServiceGroup = { id: 'other', label: '其他服务', items: [] }

  for (const option of options) {
    if (option.disabled) {
      if (current.items.length) groups.push(current)
      current = {
        id: option.value,
        label: cleanServiceLabel(option.label),
        items: [],
      }
      continue
    }
    current.items.push({ ...option, label: cleanServiceLabel(option.label) })
  }

  if (current.items.length) groups.push(current)
  return groups
}

export function filterServiceGroups(groups: ServiceGroup[], query: string) {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) return groups

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${item.label}${item.value}`.toLocaleLowerCase().includes(keyword),
      ),
    }))
    .filter((group) => group.items.length > 0)
}

export function filterModels(modelOptions: string[], query: string) {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) return modelOptions
  return modelOptions.filter((model) => model.toLocaleLowerCase().includes(keyword))
}

export function splitModelOptions(modelOptions: string[], selectedModel = '', visibleCount = 4) {
  const common = modelOptions.slice(0, visibleCount)

  if (selectedModel && modelOptions.includes(selectedModel) && !common.includes(selectedModel)) {
    common.splice(Math.max(visibleCount - 1, 0), 1, selectedModel)
  }

  return {
    common,
    more: modelOptions.filter((model) => !common.includes(model)),
  }
}
