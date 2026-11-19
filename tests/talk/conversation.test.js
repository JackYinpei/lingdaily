import { describe, expect, it } from 'vitest'

import {
  compactHistoryForKeepalive,
  compactNewsForKeepalive,
  ensureContextMessage,
  getNewsKey,
  mergeConversationHistory,
  reconcilePersistSnapshot,
  historyContainsSnapshot,
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
  it('handles empty histories', () => {
    expect(compactHistoryForKeepalive(null)).toEqual([])
    expect(compactHistoryForKeepalive([])).toEqual([])
  })

  it.each(['x', '語😊'])('truncates oversized latest exchanges without evicting any assistant replies (%s)', text => {
    const items = [
      message({ id: 'old', role: 'assistant', text: 'opener' }),
      message({ id: 'u', role: 'user', text: text.repeat(30000) }),
      message({ id: 'a1', role: 'assistant', text: text.repeat(15000) }),
      message({ id: 'a2', role: 'assistant', text: text.repeat(15000), isFinal: false }),
    ]
    const result = compactHistoryForKeepalive(items)
    expect(result.map(item => item.itemId)).toEqual(['u', 'a1', 'a2'])
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(40000)
    expect(result.every(item => item.content[0].text.length > 0)).toBe(true)
    expect(result[2].metadata.isFinal).toBe(false)
  })

  it('preserves a normal complete exchange unchanged', () => {
    const items = [message({ id: 'u', role: 'user', text: 'Hi' }), message({ id: 'a', role: 'assistant', text: 'Hello' })]
    expect(compactHistoryForKeepalive(items)).toEqual(items)
  })

  it('keeps valid correction cards alongside the latest oversized exchange', () => {
    const card = { itemId: 'c', type: 'correction', role: 'assistant', metadata: { isFinal: true }, correction: { original: 'I goes', corrected: 'I go', explanation: 'Base form', category: 'grammar' } }
    const compacted = compactHistoryForKeepalive([
      message({ id: 'u', role: 'user', text: 'x'.repeat(30000) }),
      message({ id: 'a', role: 'assistant', text: 'y'.repeat(15000) }), card,
    ])
    expect(compacted.map(item => item.itemId)).toEqual(['u', 'a', 'c'])
    expect(compacted.at(-1).correction).toEqual(card.correction)
    expect(new TextEncoder().encode(JSON.stringify(compacted)).byteLength).toBeLessThanOrEqual(40000)
  })
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

describe('unload snapshot reconciliation', () => {
  const user = message({ id: 'u', role: 'user', text: 'Hello' })
  const partial = message({ id: 'a', role: 'assistant', text: 'Partial', isFinal: false })
  const final = message({ id: 'a', role: 'assistant', text: 'Complete reply', isFinal: true })
  const pending = { news: { title: 'Topic' }, userId: 'account', identityGeneration: 1, topicGeneration: 2, history: [user, partial] }

  it('merges fresher live items by ID, preferring final then longer', () => {
    expect(reconcilePersistSnapshot(pending, { ...pending, history: [user, final] }).history).toEqual([user, final])
    expect(reconcilePersistSnapshot({ ...pending, history: [user] }, { ...pending, history: [user, partial] }).history).toEqual([user, partial])
    const longer = { ...partial, content: [{ type: 'output_text', text: 'Partial reply' }] }
    expect(reconcilePersistSnapshot(pending, { ...pending, history: [user, longer] }).history).toEqual([user, longer])
    expect(reconcilePersistSnapshot({ ...pending, history: [user, final] }, pending).history).toEqual([user, final])
  })

  it.each([
    { news: { title: 'Other topic' } }, { userId: 'other-account' }, { userId: null },
    { identityGeneration: 2 }, { topicGeneration: 3 },
  ])('never merges across topic/account generations: %o', difference => {
    expect(reconcilePersistSnapshot(pending, { ...pending, ...difference, history: [final] })).toBe(pending)
  })

  it('falls back to the only available snapshot', () => {
    expect(reconcilePersistSnapshot(null, pending)).toBe(pending)
    expect(reconcilePersistSnapshot(pending, null)).toBe(pending)
    expect(reconcilePersistSnapshot(null, null)).toBeNull()
  })
})

describe('already-persisted snapshots', () => {
  const partial = message({ id: 'a', role: 'assistant', text: 'Hello', isFinal: false })
  const final = message({ id: 'a', role: 'assistant', text: 'Hello there', isFinal: true })
  it('accepts equal or more complete saved items while ignoring system context', () => {
    expect(historyContainsSnapshot([final], [final])).toBe(true)
    expect(historyContainsSnapshot([final], [partial])).toBe(true)
    expect(historyContainsSnapshot([final], [message({ id: 'system', role: 'system', text: 'Context' }), partial])).toBe(true)
  })
  it('does not swallow missing IDs, incomplete finalization or changed corrections', () => {
    expect(historyContainsSnapshot([], [final])).toBe(false)
    expect(historyContainsSnapshot([partial], [final])).toBe(false)
    expect(historyContainsSnapshot([{ ...final, itemId: 'other' }], [final])).toBe(false)
    const card = { itemId: 'c', type: 'correction', role: 'assistant', correction: { original: 'old', corrected: 'new' } }
    expect(historyContainsSnapshot([card], [card])).toBe(true)
    expect(historyContainsSnapshot([card], [{ ...card, correction: { ...card.correction, corrected: 'different' } }])).toBe(false)
  })
})
