import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: generate } } }))
vi.mock('@/app/lib/server/geminiConfig', () => ({
  getServerGeminiApiKey: () => 'fake-provider-secret', getServerGeminiBaseUrl: () => '',
}))

import { GET, POST } from '@/app/api/ios/practice/route'
import { POST as POST_SCENARIO } from '@/app/api/ios/scenario/route'
import { POST as POST_TRANSLATE } from '@/app/api/ios/translate/route'
import { POST as POST_SUGGEST } from '@/app/api/ios/suggest/route'
import { practiceRequestSchema, parsePracticeTurn, buildPracticeContext } from '@/app/lib/ios/practice'
import { authorizeDevelopmentPractice, createPracticeCoordinator } from '@/app/lib/server/iosPractice'

const token = 'a'.repeat(64)
const validTurn = {
  reply: 'Could you tell me when the draft will be ready?', translation: '初稿什么时候能完成？',
  hint: '告诉对方你预计的时间。', keywords: 'draft, ready, Thursday',
  suggestedReply: 'The draft will be ready on Thursday.', suggestedMeaning: '初稿周四会完成。', feedback: null,
}
const body = () => ({
  requestId: randomUUID(), sessionId: randomUUID(), action: 'start', stepIndex: 0,
  goal: 'Negotiate a Thursday deadline', context: 'Keep the tone friendly',
  scenario: { title: 'Deadline', partner: 'Alex', partnerRole: 'Colleague', setting: 'At work', goals: ['Explain', 'Propose', 'Confirm'] },
  messages: [],
})
const request = (payload = body(), credential = token) => new Request('http://localhost:8000/api/ios/practice', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` }, body: JSON.stringify(payload),
})

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('IOS_PRACTICE_DEV_ENABLED', '1')
  vi.stubEnv('IOS_PRACTICE_DEV_TOKEN', token)
  vi.stubEnv('AUTH_SECRET', 'synthetic-auth-secret-for-ios-session-tests')
  generate.mockResolvedValue({ text: JSON.stringify(validTurn), candidates: [{ finishReason: 'STOP' }], modelVersion: 'test-model' })
})
afterEach(() => vi.unstubAllEnvs())

describe('development boundary', () => {
  it('never accepts the local pairing token in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect((await POST(request())).status).toBe(401)
    expect((await GET(request())).status).toBe(401)
    expect(generate).not.toHaveBeenCalled()
  })
  it('requires explicit enabling and a valid pairing token', async () => {
    expect((await POST(request(body(), 'invalid'))).status).toBe(401)
    expect((await POST(request(body(), 'ÿ'.repeat(64)))).status).toBe(401)
    vi.stubEnv('IOS_PRACTICE_DEV_ENABLED', '')
    expect((await POST(request())).status).toBe(401)
    expect(generate).not.toHaveBeenCalled()
  })
  it('does not treat an arbitrary bearer token as a user session', () => {
    expect(() => authorizeDevelopmentPractice(request(body(), 'user-account-token'))).toThrow()
  })
})

describe('request and model contract', () => {
  it('passes custom goal and conversation as data and returns the real generated result', async () => {
    const input = body()
    const response = await POST(request(input))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ requestId: input.requestId, model: 'test-model', data: validTurn })
    const sent = generate.mock.calls[0][0]
    expect(JSON.parse(sent.contents[0].parts[0].text).learnerPersonalGoal).toBe(input.goal)
    expect(sent.config.systemInstruction).not.toContain(input.goal)
    expect(sent.config.systemInstruction).toContain('untrusted exercise data')
  })
  it('rejects malformed, unsupported and oversized input before using the model', async () => {
    const invalid = body()
    invalid.action = 'answer'
    expect(practiceRequestSchema.safeParse(invalid).success).toBe(false)
    expect((await POST(request(invalid))).status).toBe(400)
    expect((await POST(request({ ...body(), context: 'a'.repeat(50000) }))).status).toBe(413)
    expect((await POST(new Request('http://localhost/api/ios/practice', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: 'not json',
    }))).status).toBe(415)
    expect(generate).not.toHaveBeenCalled()
  })
  it('requires feedback for actual answers and rejects invented feedback for the opening', () => {
    expect(() => parsePracticeTurn(JSON.stringify(validTurn), 'answer')).toThrow()
    expect(() => parsePracticeTurn(JSON.stringify({ ...validTurn, feedback: { revised: 'Try', meaning: '试', note: '建议' } }), 'start')).toThrow()
  })
  it('labels learner vs partner explicitly and rejects copied partner feedback', () => {
    const input = { ...body(), action: 'answer', messages: [
      { role: 'partner', kind: 'prompt', text: 'When?', stepIndex: 0 },
      { role: 'user', kind: 'answer', text: 'Can we move it?', stepIndex: 0 },
      { role: 'user', kind: 'retry', text: 'Could we move it to Thursday?', stepIndex: 0 },
    ] }
    const context = buildPracticeContext(input)
    expect(context.learnerLatestAnswer).toBe('Could we move it to Thursday?')
    expect(context.learnerOriginalAnswer).toBe('Can we move it?')
    expect(context.conversation[0].speaker).toBe('ROLEPLAY_PARTNER')
    expect(context.conversation[1].speaker).toBe('LEARNER')
    expect(() => parsePracticeTurn(JSON.stringify({ ...validTurn,
      feedback: { revised: validTurn.reply, meaning: '错误的角色', note: '建议' },
    }), 'answer', context.learnerLatestAnswer)).toThrow('partner')
  })
  it('returns an error for a model failure, with no canned reply or provider secret', async () => {
    generate.mockRejectedValueOnce(new Error('fake-provider-secret at secret upstream URL'))
    const response = await POST(request())
    expect(response.status).toBe(502)
    const data = await response.json()
    expect(data.code).toBe('MODEL_UNAVAILABLE')
    expect(data.data).toBeUndefined()
    expect(JSON.stringify(data)).not.toContain('fake-provider-secret')
  })
  it('rejects invalid JSON and safety/truncation results', async () => {
    generate.mockResolvedValueOnce({ text: '{}', candidates: [{ finishReason: 'STOP' }] })
      .mockResolvedValueOnce({ text: '{}', candidates: [{ finishReason: 'STOP' }] })
    expect((await POST(request())).status).toBe(502)
    generate.mockResolvedValueOnce({ text: JSON.stringify(validTurn), candidates: [{ finishReason: 'MAX_TOKENS' }] })
    expect((await POST(request())).status).toBe(502)
  })
  it('permits one corrective generation for invalid model output', async () => {
    generate.mockResolvedValueOnce({ text: 'invalid', candidates: [{ finishReason: 'STOP' }] })
    expect((await POST(request())).status).toBe(200)
    expect(generate).toHaveBeenCalledTimes(2)
  })
})

describe('duplicate requests and cost limits', () => {
  it('coalesces in-flight retries and reuses successful results', async () => {
    const upstream = vi.fn(async () => ({ data: validTurn }))
    const perform = createPracticeCoordinator({ generate: upstream })
    const input = body()
    const [a, b] = await Promise.all([perform(input), perform(input)])
    expect(a).toEqual(b)
    await perform(input)
    expect(upstream).toHaveBeenCalledTimes(1)
    await expect(perform({ ...input, goal: 'Changed' })).rejects.toMatchObject({ status: 409 })
  })
  it('allows retry after a failure', async () => {
    const upstream = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: validTurn })
    const perform = createPracticeCoordinator({ generate: upstream })
    const input = body()
    await expect(perform(input)).rejects.toThrow('offline')
    await expect(perform(input)).resolves.toEqual({ data: validTurn })
    expect(upstream).toHaveBeenCalledTimes(2)
  })
  it('caps concurrent generation and requests per minute', async () => {
    let finish
    const pending = new Promise(resolve => { finish = resolve })
    const perform = createPracticeCoordinator({ generate: () => pending })
    const first = perform(body())
    const second = perform(body())
    await expect(perform(body())).rejects.toMatchObject({ status: 429 })
    finish({ data: validTurn })
    await Promise.all([first, second])
    const limited = createPracticeCoordinator({ generate: async () => ({}), now: () => 0 })
    for (let index = 0; index < 20; index++) await limited(body())
    await expect(limited(body())).rejects.toMatchObject({ status: 429 })
  })
})

describe('automatic vocabulary items', () => {
  const answerTurn = items => JSON.stringify({ ...validTurn,
    feedback: { revised: 'Could we push it to Thursday?', meaning: '能推到周四吗？', note: '用 push 表示推迟。', ...(items ? { items } : {}) } })
  it('keeps at most three unique items and defaults to none', () => {
    const item = (text, type = 'phrase') => ({ text, type, meaning: '含义' })
    const parsed = parsePracticeTurn(answerTurn([item('push it to'), item('Push it to'), item('deadline', 'word'), item('Could we…?', 'grammar'), item('extra')]), 'answer')
    expect(parsed.feedback.items.map(entry => entry.text)).toEqual(['push it to', 'deadline', 'Could we…?'])
    expect(parsePracticeTurn(answerTurn(), 'answer').feedback.items).toEqual([])
  })
  it('rejects unknown item types instead of guessing', () => {
    expect(() => parsePracticeTurn(answerTurn([{ text: 'x', type: 'idiom', meaning: '含义' }]), 'answer')).toThrow()
  })
})

describe('learner-described scenarios', () => {
  const step = index => ({ goal: ['说明情况', '商量方案', '确认安排'][index], prompt: 'Hi, what brings you here?', translation: '你好，有什么事？',
    hint: '先说明来意。', keywords: 'deposit · move out', expression: 'I would like to talk about my deposit.', meaning: '我想谈谈押金。' })
  const draft = { title: '要回押金', subtitle: '和房东商量退押金', category: '日常', partner: 'Morgan', partnerRole: '房东',
    setting: '你下周搬走，想确认押金何时退还。', steps: [0, 1, 2].map(step) }
  const scenarioRequest = (payload, credential = token) => new Request('http://localhost:8000/api/ios/scenario', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` }, body: JSON.stringify(payload),
  })
  it('shares the development boundary and validates before using the model', async () => {
    const input = { requestId: randomUUID(), description: '下周和房东谈退押金' }
    expect((await POST_SCENARIO(scenarioRequest(input, 'invalid'))).status).toBe(401)
    expect((await POST_SCENARIO(scenarioRequest({ ...input, description: '' }))).status).toBe(400)
    expect((await POST_SCENARIO(scenarioRequest({ ...input, description: 'a'.repeat(301) }))).status).toBe(400)
    vi.stubEnv('NODE_ENV', 'production')
    expect((await POST_SCENARIO(scenarioRequest(input))).status).toBe(401)
    expect(generate).not.toHaveBeenCalled()
  })
  it('passes the description as data and returns a validated three-step scenario', async () => {
    generate.mockResolvedValueOnce({ text: JSON.stringify(draft), candidates: [{ finishReason: 'STOP' }], modelVersion: 'test-model' })
    const input = { requestId: randomUUID(), description: '下周和房东谈退押金' }
    const response = await POST_SCENARIO(scenarioRequest(input))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ requestId: input.requestId, model: 'test-model', scenario: draft })
    const sent = generate.mock.calls[0][0]
    expect(JSON.parse(sent.contents[0].parts[0].text).learnerDescription).toBe(input.description)
    expect(sent.config.systemInstruction).not.toContain(input.description)
  })
  it('retries once, then fails for a scenario without exactly three steps', async () => {
    const short = JSON.stringify({ ...draft, steps: draft.steps.slice(0, 2) })
    generate.mockResolvedValue({ text: short, candidates: [{ finishReason: 'STOP' }] })
    const response = await POST_SCENARIO(scenarioRequest({ requestId: randomUUID(), description: '点咖啡' }))
    expect(response.status).toBe(502)
    expect(generate).toHaveBeenCalledTimes(2)
  })
})

describe('on-demand translation', () => {
  const translateRequest = (payload, credential = token) => new Request('http://localhost:8000/api/ios/translate', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` }, body: JSON.stringify(payload),
  })
  it('translates one line as data and returns the validated Chinese text', async () => {
    generate.mockResolvedValueOnce({ text: JSON.stringify({ translation: '你担心赶不上周五的截止日期吗？' }), candidates: [{ finishReason: 'STOP' }], modelVersion: 'test-model' })
    const input = { requestId: randomUUID(), text: 'Are you worried about meeting the Friday deadline?' }
    const response = await POST_TRANSLATE(translateRequest(input))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ requestId: input.requestId, model: 'test-model', translation: '你担心赶不上周五的截止日期吗？' })
    const sent = generate.mock.calls.at(-1)[0]
    expect(sent.config.systemInstruction).not.toContain(input.text)
    expect(sent.contents[0].parts[0].text).toContain(input.text)
  })
  it('requires a session and a bounded line', async () => {
    expect((await POST_TRANSLATE(translateRequest({ requestId: randomUUID(), text: 'Hi' }, 'invalid'))).status).toBe(401)
    expect((await POST_TRANSLATE(translateRequest({ requestId: randomUUID(), text: '' }))).status).toBe(400)
    expect((await POST_TRANSLATE(translateRequest({ requestId: randomUUID(), text: 'a'.repeat(1001) }))).status).toBe(400)
    expect(generate).not.toHaveBeenCalled()
  })
})

describe('stuck-in-call suggestion', () => {
  const suggestRequest = (payload, credential = token) => new Request('http://localhost:8000/api/ios/suggest', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` }, body: JSON.stringify(payload),
  })
  const input = () => ({
    requestId: randomUUID(), goal: '', context: '', stepIndex: 0,
    scenario: { title: 'Deadline', partner: 'Alex', partnerRole: 'Colleague', setting: '你负责的注册页周五上线，但验证码有问题。', goals: ['说明情况', '提出请求', '给出方案'] },
    messages: [{ role: 'partner', text: 'How is the sign-up page coming along?' }],
  })
  const suggestion = { hint: '先说页面做完了，再说验证码出了问题。', keywords: 'almost done · a bug', reply: 'It is almost done, but we found a bug.', meaning: '差不多做完了，但我们发现了一个问题。' }
  it('returns a Chinese-first suggestion from the learner side, passing the conversation as data', async () => {
    generate.mockResolvedValueOnce({ text: JSON.stringify(suggestion), candidates: [{ finishReason: 'STOP' }], modelVersion: 'test-model' })
    const body = input()
    const response = await POST_SUGGEST(suggestRequest(body))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ requestId: body.requestId, model: 'test-model', suggestion })
    const sent = generate.mock.calls.at(-1)[0]
    expect(sent.config.systemInstruction).toContain('THE LEARNER')
    expect(sent.config.systemInstruction).not.toContain('How is the sign-up page')
    expect(JSON.parse(sent.contents[0].parts[0].text)).toMatchObject({ currentTask: '说明情况' })
  })
  it('uses its own model setting, falling back to the practice model', async () => {
    generate.mockResolvedValue({ text: JSON.stringify(suggestion), candidates: [{ finishReason: 'STOP' }], modelVersion: 'test-model' })
    await POST_SUGGEST(suggestRequest(input()))
    expect(generate.mock.calls.at(-1)[0].model).toBe('gemini-3.1-flash-lite')
    vi.stubEnv('GEMINI_SUGGEST_MODEL', 'gemini-3.8-flash')
    await POST_SUGGEST(suggestRequest(input()))
    expect(generate.mock.calls.at(-1)[0].model).toBe('gemini-3.8-flash')
  })
  it('requires a session and at least one message', async () => {
    expect((await POST_SUGGEST(suggestRequest(input(), 'invalid'))).status).toBe(401)
    expect((await POST_SUGGEST(suggestRequest({ ...input(), messages: [] }))).status).toBe(400)
    expect(generate).not.toHaveBeenCalled()
  })
})

