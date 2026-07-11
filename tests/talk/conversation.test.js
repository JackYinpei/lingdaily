import { describe, expect, it } from 'vitest'

import {
  compactHistoryForKeepalive,
  compactNewsForKeepalive,
  ensureContextMessage,
  getNewsKey,
  mergeConversationHistory,
} from '@/app/talk/_lib/conversation'

function message({
  id,
  role,
  text,
  isFinal = true,
  manualInput = false,
  createdAt = '2026-07-11T00:00:00.000Z',
}) {
  return {
    itemId: id,
    role,
    content: [{
      type: role === 'user' ? 'input_text' : 'output_text',
      text,
    }],
    metadata: { isFinal, manualInput, createdAt },
  }
}

describe('conversation identity and reconciliation', () => {
  it('keeps existing news and scenario keys stable', () => {
    expect(getNewsKey({ _isScenario: true, _scenarioId: 'scenario-id' }))
      .toBe('scenario:scenario-id')
    expect(getNewsKey({
      originalTitle: 'Original title with spaces',
      title: 'Translated title',
      link: 'https://example.com/article',
    })).toBe('Originaltitlewithspaces')
  })

  it('updates a topic context without inserting a duplicate', () => {
    const previousContext = message({
      id: 'news-context-topic',
      role: 'system',
      text: 'old context',
    })
    const userMessage = message({ id: 'user-1', role: 'user', text: 'Hello' })
    const nextContext = {
      ...previousContext,
      content: [{ type: 'output_text', text: 'new context' }],
    }

    const result = ensureContextMessage([previousContext, userMessage], nextContext)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(nextContext)
    expect(result[1]).toEqual(userMessage)
  })

  it('removes a stale topic context when a scenario id is canonicalized', () => {
    const staleContext = {
      ...message({
        id: 'news-context-scenario:duplicate-id',
        role: 'system',
        text: 'stale context',
      }),
      metadata: { kind: 'news_context', newsKey: 'scenario:duplicate-id' },
    }
    const currentContext = {
      ...message({
        id: 'news-context-scenario:canonical-id',
        role: 'system',
        text: 'canonical context',
      }),
      metadata: { kind: 'news_context', newsKey: 'scenario:canonical-id' },
    }
    const userMessage = message({ id: 'user-1', role: 'user', text: 'Hello' })

    const result = ensureContextMessage([staleContext, userMessage], currentContext)

    expect(result).toEqual([currentContext, userMessage])
  })

  it('prefers a completed streamed item and removes a duplicate manual placeholder', () => {
    const partial = message({
      id: 'assistant-1',
      role: 'assistant',
      text: 'Hel',
      isFinal: false,
    })
    const completed = message({
      id: 'assistant-1',
      role: 'assistant',
      text: 'Hello!',
      isFinal: true,
    })
    const manual = message({
      id: 'manual-1',
      role: 'user',
      text: 'How are you?',
      manualInput: true,
    })
    const transcript = message({
      id: 'transcript-1',
      role: 'user',
      text: 'How are you?',
    })

    const result = mergeConversationHistory(
      [partial, manual],
      [completed, transcript],
    )

    expect(result).toEqual([completed, transcript])
  })
})

describe('keepalive payload compaction', () => {
  it('omits system context while retaining the latest real user turn', () => {
    const context = message({ id: 'context', role: 'system', text: 'x'.repeat(500) })
    const older = message({ id: 'assistant-old', role: 'assistant', text: 'y'.repeat(500) })
    const latestUser = message({ id: 'user-latest', role: 'user', text: 'latest turn' })

    const compacted = compactHistoryForKeepalive(
      [context, older, latestUser],
      450,
    )

    expect(compacted.some((item) => item.role === 'system')).toBe(false)
    expect(compacted.some((item) => item.itemId === latestUser.itemId)).toBe(true)
  })

  it('keeps scenario identity and truncates oversized untrusted fields', () => {
    const compacted = compactNewsForKeepalive({
      id: 'scenario-card',
      _isScenario: true,
      _scenarioId: 'scenario-id',
      _isUserGenerated: true,
      title: 't'.repeat(700),
      description: 'd'.repeat(700),
      _systemPrompt: 'p'.repeat(2500),
      _targetLanguageCode: 'ja',
      _nativeLanguageCode: 'zh-CN',
    })

    expect(compacted).toMatchObject({
      _isScenario: true,
      _scenarioId: 'scenario-id',
      _isUserGenerated: true,
      _targetLanguageCode: 'ja',
      _nativeLanguageCode: 'zh-CN',
    })
    expect(compacted.title).toHaveLength(500)
    expect(compacted.description).toHaveLength(500)
    expect(compacted._systemPrompt).toHaveLength(2000)
  })
})
