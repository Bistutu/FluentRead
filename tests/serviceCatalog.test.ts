import { describe, expect, it } from 'vitest'
import {
  buildServiceGroups,
  cleanServiceLabel,
  filterModels,
  filterServiceGroups,
  splitModelOptions,
} from '@/entrypoints/utils/serviceCatalog'

const options = [
  { value: 'machine', label: '机器翻译', disabled: true },
  { value: 'microsoft', label: '微软翻译' },
  { value: 'chromeTranslator', label: 'Chrome内置AI翻译⭐' },
  { value: 'ai', label: 'AI翻译', disabled: true },
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek️' },
]

describe('service catalog helpers', () => {
  it('preserves divider-based service grouping', () => {
    expect(buildServiceGroups(options)).toEqual([
      {
        id: 'machine',
        label: '机器翻译',
        items: [
          { value: 'microsoft', label: '微软翻译' },
          { value: 'chromeTranslator', label: 'Chrome内置AI翻译' },
        ],
      },
      {
        id: 'ai',
        label: 'AI翻译',
        items: [
          { value: 'openai', label: 'OpenAI' },
          { value: 'deepseek', label: 'DeepSeek' },
        ],
      },
    ])
  })

  it('filters services without losing their category', () => {
    expect(filterServiceGroups(buildServiceGroups(options), 'open')).toEqual([
      { id: 'ai', label: 'AI翻译', items: [{ value: 'openai', label: 'OpenAI' }] },
    ])
  })

  it('filters model identifiers case-insensitively', () => {
    expect(filterModels(['gpt-5-mini', 'GPT-4o', '自定义模型'], 'gpt')).toEqual([
      'gpt-5-mini',
      'GPT-4o',
    ])
  })

  it('removes decorative recommendation stars from labels', () => {
    expect(cleanServiceLabel('硅基流动⭐️')).toBe('硅基流动')
  })

  it('keeps common models short and promotes the current selection', () => {
    const models = ['one', 'two', 'three', 'four', 'five', 'six']

    expect(splitModelOptions(models, 'six')).toEqual({
      common: ['one', 'two', 'three', 'six'],
      more: ['four', 'five'],
    })
  })

  it('does not create a more group for a short model list', () => {
    expect(splitModelOptions(['one', 'two'], 'two')).toEqual({
      common: ['one', 'two'],
      more: [],
    })
  })
})
