import { describe, expect, it, vi } from 'vitest'

import { sendTalkText, submitTextDraft } from '@/app/talk/_lib/textSubmission'

describe('talk send guards', () => {
  it.each([
    [{ connected: false }, '请先连接 Gemini Live，再发送消息。'],
    [{ service: null }, '请先连接 Gemini Live，再发送消息。'],
    [{ connecting: true }, '连接仍在建立，请连接完成后再发送。'],
    [{ restoring: true }, '正在恢复对话，请稍候再发送。'],
  ])('preserves input and prompts when blocked: %j', async (state, prompt) => {
    const service = { sendText: vi.fn() }
    const onError = vi.fn()
    const onAccepted = vi.fn()
    const sendTextMessage = input => sendTalkText({ input, service, connected: true, onError, ...state })
    await expect(submitTextDraft({ draft: 'hello', sendTextMessage, onAccepted })).resolves.toBe(false)
    expect(service.sendText).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(prompt)
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it.each([false, true, 'error'])('forwards acceptance or prompts after socket failure: %s', async result => {
    const service = { sendText: result === 'error' ? vi.fn().mockRejectedValue(new Error('closed')) : vi.fn().mockResolvedValue(result) }
    const onError = vi.fn()
    await expect(sendTalkText({ input: 'hello', service, connected: true, onError })).resolves.toBe(result === true)
    if (result === true) expect(onError).not.toHaveBeenCalled()
    else expect(onError).toHaveBeenCalledWith('请先连接 Gemini Live，再发送消息。')
  })
})

describe('text draft submission', () => {
  it('keeps the draft until sending is explicitly accepted', async () => {
    let accept
    const sendTextMessage = vi.fn(() => new Promise(resolve => { accept = resolve }))
    const onAccepted = vi.fn()
    const pending = submitTextDraft({ draft: '  hello  ', sendTextMessage, onAccepted })
    expect(sendTextMessage).toHaveBeenCalledWith('hello')
    expect(onAccepted).not.toHaveBeenCalled()
    accept(true)
    await expect(pending).resolves.toBe(true)
    expect(onAccepted).toHaveBeenCalledOnce()
  })

  it.each([false, undefined])('keeps the draft when send returns %s', async result => {
    const onAccepted = vi.fn()
    const sendTextMessage = vi.fn(async () => result)
    await expect(submitTextDraft({ draft: 'hello', sendTextMessage, onAccepted })).resolves.toBe(false)
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it('keeps the draft on a send error', async () => {
    const onAccepted = vi.fn()
    const sendTextMessage = vi.fn().mockRejectedValue(new Error('Socket closed'))
    await expect(submitTextDraft({ draft: 'hello', sendTextMessage, onAccepted })).resolves.toBe(false)
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it.each([
    { draft: '' },
    { draft: '   ' },
    { draft: '入力中', isComposing: true },
  ])('does not send empty or composing input: %j', async options => {
    const sendTextMessage = vi.fn()
    const onAccepted = vi.fn()
    await expect(submitTextDraft({ ...options, sendTextMessage, onAccepted })).resolves.toBe(false)
    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(onAccepted).not.toHaveBeenCalled()
  })
})
