import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('canvas-confetti', () => ({ default: vi.fn() }))

import { GeminiLiveServiceImpl } from '@/app/lib/GeminiLiveService'

describe('bounded correction tool results', () => {
  it('bounds client fields and normalizes categories before forwarding', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const onCorrection = vi.fn()
    const service = new GeminiLiveServiceImpl({ onCorrection })
    await service.handleCorrection({ original: 'x'.repeat(4000), corrected: 'y'.repeat(4000), explanation: 'z'.repeat(8000), category: 'unknown' })
    expect(onCorrection).toHaveBeenCalledWith({ original: 'x'.repeat(2000), corrected: 'y'.repeat(2000), explanation: 'z'.repeat(4000), category: 'other' })
  })

  it('does not forward empty, identical or malformed corrections', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const onCorrection = vi.fn()
    const service = new GeminiLiveServiceImpl({ onCorrection })
    for (const value of [null, {}, { original: 'same', corrected: 'same' }, { original: {}, corrected: 'text' }]) await service.handleCorrection(value)
    expect(onCorrection).not.toHaveBeenCalled()
  })
})

class FakeAudioContext {
  static instances = []

  constructor({ sampleRate }) {
    this.sampleRate = sampleRate
    this.state = 'suspended'
    this.currentTime = 2
    this.destination = {}
    this.bufferSources = []
    this.listeners = {}
    this.resume = vi.fn(async () => {
      this.state = 'running'
    })
    this.close = vi.fn(async () => {
      this.state = 'closed'
    })
    FakeAudioContext.instances.push(this)
  }

  addEventListener(type, handler) {
    (this.listeners[type] ||= []).push(handler)
  }

  removeEventListener(type, handler) {
    this.listeners[type] = (this.listeners[type] || []).filter((fn) => fn !== handler)
  }

  emit(type) {
    for (const handler of [...(this.listeners[type] || [])]) handler()
  }

  createGain() {
    return { gain: { value: 0 }, connect: vi.fn() }
  }

  createBuffer(_channels, length, sampleRate) {
    const channel = new Float32Array(length)
    return {
      duration: length / sampleRate,
      getChannelData: () => channel,
    }
  }

  createBufferSource() {
    const source = {
      addEventListener: vi.fn(),
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
    this.bufferSources.push(source)
    return source
  }

  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() }
  }

  createScriptProcessor() {
    return { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null }
  }
}

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 3
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = FakeWebSocket.CONNECTING
    this.send = vi.fn()
    this.close = vi.fn(() => {
      this.readyState = FakeWebSocket.CLOSED
    })
    FakeWebSocket.instances.push(this)
  }
}

function pcmBase64(...samples) {
  const bytes = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2))
  return bytes.toString('base64')
}

function createService() {
  const config = {
    onConnectionUpdate: vi.fn(),
    onError: vi.fn(),
    onMessage: vi.fn(),
    onPlaybackError: vi.fn(),
    onConnectionPhase: vi.fn(),
  }
  return { config, service: new GeminiLiveServiceImpl(config) }
}

async function waitForSocketCount(count) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (FakeWebSocket.instances.length >= count) return
    await Promise.resolve()
  }
  throw new Error(`Expected ${count} fake WebSocket instances`)
}

beforeEach(() => {
  FakeAudioContext.instances = []
  FakeWebSocket.instances = []
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  vi.stubGlobal('window', {
    AudioContext: FakeAudioContext,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  })
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      })),
    },
  })
})

describe('Gemini Live output audio', () => {
  it('unlocks audio in the user gesture and schedules the first model chunk', async () => {
    const { service } = createService()

    service.primeOutputAudio()

    const context = service.outputAudioContext
    expect(context.sampleRate).toBe(24000)
    expect(context.resume).toHaveBeenCalledOnce()
    expect(context.bufferSources).toHaveLength(1)
    expect(context.bufferSources[0].start).toHaveBeenCalledWith(0)

    await service.handleServerMessage({
      serverContent: {
        modelTurn: {
          parts: [{
            inlineData: {
              mimeType: 'audio/pcm;rate=24000',
              data: pcmBase64(0, 1024),
            },
          }],
        },
      },
    })

    expect(context.bufferSources).toHaveLength(2)
    expect(context.bufferSources[1].start).toHaveBeenCalledWith(2.03)
  })

  it('buffers the first model chunk while suspended and flushes it on resume', async () => {
    const { config, service } = createService()
    const context = service.createOutputAudioContext()
    // Simulate a browser that keeps the output context suspended through the
    // connect gesture: resume() does not flip state to running on its own.
    context.resume = vi.fn(async () => {})
    context.state = 'suspended'
    service.outputAudioReadyPromise = Promise.resolve()

    await service.handleServerMessage({
      serverContent: {
        modelTurn: {
          parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcmBase64(0, 1024) } }],
        },
      },
    })

    // Nothing scheduled yet, but the chunk is retained rather than dropped.
    expect(context.bufferSources).toHaveLength(0)
    expect(service.pendingAudioParts).toHaveLength(1)
    expect(config.onPlaybackError).not.toHaveBeenCalled()

    // The context unlocks (e.g. mic resume or a later gesture) → buffered audio plays.
    context.state = 'running'
    context.emit('statechange')
    await Promise.resolve()

    expect(context.bufferSources).toHaveLength(1)
    expect(context.bufferSources[0].start).toHaveBeenCalledWith(2.03)
    expect(service.pendingAudioParts).toHaveLength(0)
  })

  it('does not schedule queued audio after the playback epoch is invalidated', async () => {
    const { service } = createService()
    const context = service.createOutputAudioContext()
    context.state = 'running'

    let releaseAudio
    service.outputAudioReadyPromise = new Promise((resolve) => {
      releaseAudio = resolve
    })
    const oldEpoch = service.playbackEpoch
    const pendingPlayback = service.playAudioParts(
      [{ data: pcmBase64(0, 1024) }],
      oldEpoch,
    )

    service.invalidatePlayback()
    releaseAudio()
    await pendingPlayback

    expect(service.playbackEpoch).toBe(oldEpoch + 1)
    expect(context.bufferSources).toHaveLength(0)
  })
})

describe('Gemini Live connection epochs', () => {
  it('makes late events from a superseded socket inert', async () => {
    const { config, service } = createService()

    const firstConnect = service.connect('first prompt', 'first-token')
    await waitForSocketCount(1)
    const oldSocket = FakeWebSocket.instances[0]

    const secondConnect = service.connect('second prompt', 'second-token')
    await waitForSocketCount(2)
    const currentSocket = FakeWebSocket.instances[1]

    expect(oldSocket.close).toHaveBeenCalledOnce()
    await oldSocket.onmessage({
      data: JSON.stringify({
        serverContent: { outputTranscription: { text: 'stale response' } },
      }),
    })
    oldSocket.onclose({ code: 1000, reason: 'superseded', wasClean: true })

    await expect(firstConnect).resolves.toBe(false)
    expect(config.onMessage).not.toHaveBeenCalled()
    expect(config.onConnectionUpdate).not.toHaveBeenCalledWith(false)
    expect(service.webSocket).toBe(currentSocket)

    currentSocket.readyState = FakeWebSocket.OPEN
    currentSocket.onopen()
    await currentSocket.onmessage({ data: JSON.stringify({ setupComplete: true }) })

    await expect(secondConnect).resolves.toBe(true)
    expect(config.onConnectionUpdate).toHaveBeenCalledWith(true)
    expect(service.webSocket).toBe(currentSocket)

    service.disconnect()
  })
})

describe('Gemini Live microphone permission', () => {
  async function openSocket(service) {
    const connection = service.connect('prompt', 'token')
    await waitForSocketCount(FakeWebSocket.instances.length || 1)
    const socket = FakeWebSocket.instances.at(-1)
    socket.readyState = FakeWebSocket.OPEN
    socket.onopen()
    return { connection, socket }
  }

  it('waits for setupComplete before requesting the microphone', async () => {
    const { service } = createService()
    const { connection, socket } = await openSocket(service)
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    await socket.onmessage({ data: JSON.stringify({ setupComplete: true }) })
    await expect(connection).resolves.toBe(true)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
    service.disconnect()
  })

  it('does not time out while permission is pending and connects after approval', async () => {
    vi.useFakeTimers()
    try {
      let approve
      navigator.mediaDevices.getUserMedia.mockImplementation(() => new Promise(resolve => { approve = resolve }))
      const { service, config } = createService()
      const { connection, socket } = await openSocket(service)
      const setup = socket.onmessage({ data: JSON.stringify({ setupComplete: true }) })
      await Promise.resolve()
      expect(config.onConnectionPhase).toHaveBeenCalledWith('microphone')
      expect(service.micStreamHold).toBe(true)
      await vi.advanceTimersByTimeAsync(120000)
      expect(config.onError).not.toHaveBeenCalled()
      expect(config.onConnectionUpdate).not.toHaveBeenCalledWith(true)
      expect(socket.close).not.toHaveBeenCalled()
      expect(service.micStreamHold).toBe(true)
      approve({ getTracks: () => [{ stop: vi.fn() }] })
      await setup
      await expect(connection).resolves.toBe(true)
      expect(config.onConnectionUpdate).toHaveBeenCalledWith(true)
      expect(service.micStreamHold).toBe(true)
      service.disconnect()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['before approval', 'after approval'])('plays the first PCM received %s after a 29-second permission wait even with pending resume promises', async timing => {
    vi.useFakeTimers()
    const { service, config } = createService()
    try {
      let approve
      navigator.mediaDevices.getUserMedia.mockImplementation(() => new Promise(resolve => { approve = resolve }))
      service.primeOutputAudio()
      const { connection, socket } = await openSocket(service)
      const setup = socket.onmessage({ data: JSON.stringify({ setupComplete: true }) })
      await vi.advanceTimersByTimeAsync(29000)
      const context = service.outputAudioContext
      context.state = 'suspended'
      context.resume = vi.fn(() => new Promise(() => {}))
      const audio = () => socket.onmessage({ data: JSON.stringify({ serverContent: {
        outputTranscription: { text: 'Audible reply' },
        modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcmBase64(16384, -16384) } }] },
      } }) })
      let playback
      if (timing === 'before approval') {
        playback = audio()
        for (let i = 0; i < 15; i++) await Promise.resolve()
        expect(service.pendingAudioParts).toHaveLength(1)
        context.resume.mockImplementation(async () => { context.state = 'running' })
      }
      approve({ getTracks: () => [{ stop: vi.fn() }] })
      await setup
      await expect(connection).resolves.toBe(true)
      if (timing === 'after approval') {
        playback = audio()
        for (let i = 0; i < 15; i++) await Promise.resolve()
        expect(service.pendingAudioParts).toHaveLength(1)
        context.state = 'running'
        context.emit('statechange')
      }
      await playback
      expect(context.bufferSources).toHaveLength(2)
      expect(Array.from(context.bufferSources[1].buffer.getChannelData(0))).toEqual([0.5, -0.5])
      expect(service.pendingAudioParts).toHaveLength(0)
      expect(config.onPlaybackError).not.toHaveBeenCalled()
      expect(service.micStreamHold).toBe(true)
    } finally {
      service.disconnect()
      vi.useRealTimers()
    }
  })

  it.each(['running', 'suspended'])('retains a complete opening received as Blobs during permission with output %s', async outputState => {
    vi.useFakeTimers()
    const { service, config } = createService()
    try {
      let approve
      navigator.mediaDevices.getUserMedia.mockImplementation(() => new Promise(resolve => { approve = resolve }))
      service.primeOutputAudio()
      const { connection, socket } = await openSocket(service)
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
      expect(JSON.parse(socket.send.mock.calls[0][0]).setup.generationConfig.responseModalities).toEqual(['AUDIO'])
      const setup = socket.onmessage({ data: new Blob([JSON.stringify({ setupComplete: true })]) })
      for (let i = 0; i < 15; i++) await Promise.resolve()
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
      expect(service.micStreamHold).toBe(true)
      expect(config.onConnectionUpdate).not.toHaveBeenCalledWith(true)
      const context = service.outputAudioContext
      const epoch = service.playbackEpoch
      context.state = outputState
      context.resume = vi.fn(async () => {})
      for (const sample of [16384, -16384]) {
        await socket.onmessage({ data: new Blob([JSON.stringify({ serverContent: {
          modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcmBase64(sample) } }] },
          outputTranscription: { text: 'Opening reply' },
        } })]) })
        expect(service.micStreamHold).toBe(true)
      }
      await socket.onmessage({ data: new Blob([JSON.stringify({ serverContent: { turnComplete: true } })]) })
      expect(config.onMessage).toHaveBeenCalledWith('Opening reply', false, 'model')
      expect(service.micStreamHold).toBe(false)
      if (outputState === 'suspended') expect(service.pendingAudioParts).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(30000)
      expect(config.onConnectionUpdate).not.toHaveBeenCalledWith(true)
      context.resume.mockImplementation(async () => { context.state = 'running' })
      approve({ getTracks: () => [{ stop: vi.fn() }] })
      await setup
      await expect(connection).resolves.toBe(true)
      expect(service.playbackEpoch).toBe(epoch)
      expect(context.bufferSources).toHaveLength(3)
      expect(context.bufferSources.slice(1).map(source => Array.from(source.buffer.getChannelData(0)))).toEqual([[0.5], [-0.5]])
      for (const source of context.bufferSources.slice(1)) {
        expect(source.start).toHaveBeenCalledOnce()
        expect(source.stop).not.toHaveBeenCalled()
      }
      expect(service.pendingAudioParts).toHaveLength(0)
      expect(config.onPlaybackError).not.toHaveBeenCalled()
      expect(config.onError).not.toHaveBeenCalled()
    } finally {
      service.disconnect()
      vi.useRealTimers()
    }
  })

  it('still times out when the server never completes setup', async () => {
    vi.useFakeTimers()
    try {
      const { service, config } = createService()
      const { connection } = await openSocket(service)
      const rejected = expect(connection).rejects.toThrow('Gemini Live setup timed out')
      await vi.advanceTimersByTimeAsync(20000)
      await rejected
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
      expect(config.onConnectionUpdate).not.toHaveBeenCalledWith(true)
      expect(service.webSocket).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports microphone denial and does not connect', async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValue(new Error('Permission denied'))
    const { service, config } = createService()
    const { connection, socket } = await openSocket(service)
    await socket.onmessage({ data: JSON.stringify({ setupComplete: true }) })
    await expect(connection).resolves.toBe(false)
    expect(config.onError).toHaveBeenCalledWith('Could not access microphone.')
    expect(service.micStreamHold).toBe(false)
    expect(service.micStreamHoldTimer).toBeNull()
    expect(config.onConnectionUpdate).not.toHaveBeenCalledWith(true)
    expect(service.webSocket).toBeNull()
  })

  it.each(['cancel', 'supersede'])('stops late tracks after %s without connecting the old attempt', async action => {
    let approve
    navigator.mediaDevices.getUserMedia.mockImplementationOnce(() => new Promise(resolve => { approve = resolve }))
    const { service, config } = createService()
    const { connection, socket } = await openSocket(service)
    const setup = socket.onmessage({ data: JSON.stringify({ setupComplete: true }) })
    await Promise.resolve()
    let nextConnection
    if (action === 'cancel') service.disconnect()
    else nextConnection = service.connect('new prompt', 'new token')
    expect(service.micStreamHold).toBe(false)
    expect(service.micStreamHoldTimer).toBeNull()
    await expect(connection).resolves.toBe(false)
    const stop = vi.fn()
    approve({ getTracks: () => [{ stop }] })
    await setup
    expect(stop).toHaveBeenCalledOnce()
    expect(config.onConnectionUpdate).not.toHaveBeenCalledWith(true)
    if (nextConnection) {
      await waitForSocketCount(2)
      const nextSocket = FakeWebSocket.instances.at(-1)
      nextSocket.readyState = FakeWebSocket.OPEN
      nextSocket.onopen()
      await nextSocket.onmessage({ data: JSON.stringify({ setupComplete: true }) })
      await expect(nextConnection).resolves.toBe(true)
      expect(service.webSocket).toBe(nextSocket)
    }
    service.disconnect()
  })
})

async function connectService(service) {
  const connectPromise = service.connect('prompt', 'token')
  await waitForSocketCount(1)
  const socket = FakeWebSocket.instances[0]
  socket.readyState = FakeWebSocket.OPEN
  socket.onopen()
  await socket.onmessage({ data: JSON.stringify({ setupComplete: true }) })
  await expect(connectPromise).resolves.toBe(true)
  return socket
}

function sentMessages(socket) {
  return socket.send.mock.calls.map(([payload]) => JSON.parse(payload))
}

function emitMicFrame(service) {
  service.scriptProcessor.onaudioprocess({
    inputBuffer: { getChannelData: () => new Float32Array([0, 0.5, -0.5, 1]) },
  })
}

describe('Gemini Live text acceptance', () => {
  it('rejects a disconnected send without a local message', async () => {
    const { service, config } = createService()
    await expect(service.sendText('hello')).resolves.toBe(false)
    expect(config.onMessage).not.toHaveBeenCalled()
  })

  it.each(['closed', 'throws', 'empty'])('rejects %s sends without a local message', async condition => {
    const { service, config } = createService()
    const socket = await connectService(service)
    socket.send.mockClear()
    config.onMessage.mockClear()
    if (condition === 'closed') socket.readyState = FakeWebSocket.CLOSED
    if (condition === 'throws') socket.send.mockImplementation(() => { throw new Error('closed') })
    await expect(service.sendText(condition === 'empty' ? '   ' : 'hello')).resolves.toBe(false)
    expect(config.onMessage).not.toHaveBeenCalled()
    expect(service.micStreamHold).toBe(true)
    service.disconnect()
  })
})

describe('Gemini Live first turn', () => {
  it('loads the full context before a short completed client turn without releasing the mic hold', async () => {
    const { service, config } = createService()
    const socket = await connectService(service)
    const text = '[System Initialize] ' + 'News and scenario context. '.repeat(120)
    socket.send.mockClear()

    await service.sendContextMessage(text)

    expect(sentMessages(socket)).toEqual([{
      clientContent: {
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: false,
      },
    }, {
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: 'Please respond aloud to the context above.' }] }],
        turnComplete: true,
      },
    }])
    expect(config.onMessage).not.toHaveBeenCalled()
    expect(service.micStreamHold).toBe(true)
    emitMicFrame(service)
    expect(socket.send).toHaveBeenCalledTimes(2)

    await socket.onmessage({ data: JSON.stringify({ serverContent: {
      modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcmBase64(16384) } }] },
    } }) })
    const source = service.outputAudioContext.bufferSources.at(-1)
    expect(Array.from(source.buffer.getChannelData(0))).toEqual([0.5])
    expect(source.start).toHaveBeenCalledOnce()
    expect(service.micStreamHold).toBe(true)
    await socket.onmessage({ data: JSON.stringify({ serverContent: { turnComplete: true } }) })
    expect(service.micStreamHold).toBe(false)

    service.disconnect()
  })

  it('sends the context and opening cue only after setup and microphone initialization resolve', async () => {
    const { service } = createService()
    let approve
    navigator.mediaDevices.getUserMedia.mockImplementation(() => new Promise(resolve => { approve = resolve }))
    service.primeOutputAudio()
    const connection = service.connect('prompt', 'token').then(() => service.sendContextMessage('Resume our conversation.'))
    await waitForSocketCount(1)
    const socket = FakeWebSocket.instances[0]
    socket.readyState = FakeWebSocket.OPEN
    socket.onopen()
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    const setup = socket.onmessage({ data: JSON.stringify({ setupComplete: true }) })
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
    expect(sentMessages(socket)).toHaveLength(1)
    expect(service.micStreamHold).toBe(true)
    approve({ getTracks: () => [{ stop: vi.fn() }] })
    await setup
    await connection
    expect(sentMessages(socket).map(msg => Object.keys(msg)[0])).toEqual(['setup', 'clientContent', 'clientContent'])
    expect(service.micStreamHold).toBe(true)

    service.disconnect()
  })

  it.each(['', '   ', null, undefined])('does not trigger a greeting for empty context %j', async text => {
    const { service } = createService()
    const socket = await connectService(service)
    socket.send.mockClear()
    await service.sendContextMessage(text)
    expect(socket.send).not.toHaveBeenCalled()
    service.disconnect()
  })

  it('does not send an opening cue when the context send fails', async () => {
    const { service } = createService()
    const socket = await connectService(service)
    socket.send.mockClear()
    socket.send.mockImplementationOnce(() => { throw new Error('closed during send') })
    await expect(service.sendContextMessage('Context')).rejects.toThrow('closed during send')
    expect(socket.send).toHaveBeenCalledOnce()
    expect(service.micStreamHold).toBe(true)
    service.disconnect()
  })

  it('does not send context or an opening cue on a closed or disconnected socket', async () => {
    const { service } = createService()
    await service.sendContextMessage('Context')
    const socket = await connectService(service)
    socket.send.mockClear()
    socket.readyState = FakeWebSocket.CLOSED
    await service.sendContextMessage('Context')
    expect(socket.send).not.toHaveBeenCalled()
    service.disconnect()
  })

  it('holds mic frames until the first model turn completes', async () => {
    const { service } = createService()
    const socket = await connectService(service)

    emitMicFrame(service)
    expect(sentMessages(socket).some((msg) => msg.realtimeInput?.audio)).toBe(false)

    await socket.onmessage({
      data: JSON.stringify({ serverContent: { turnComplete: true } }),
    })
    emitMicFrame(service)
    expect(sentMessages(socket).some((msg) => msg.realtimeInput?.audio)).toBe(true)

    service.disconnect()
  })

  it('releases the mic hold when the user sends a typed message', async () => {
    const { service } = createService()
    const socket = await connectService(service)
    expect(service.micStreamHold).toBe(true)

    await expect(service.sendText('hello')).resolves.toBe(true)

    expect(service.micStreamHold).toBe(false)
    emitMicFrame(service)
    expect(sentMessages(socket).some((msg) => msg.realtimeInput?.audio)).toBe(true)

    service.disconnect()
  })

  it('releases the mic hold via the fallback timer when no turn ever completes', async () => {
    vi.useFakeTimers()
    try {
      const { service } = createService()
      const socket = await connectService(service)
      expect(service.micStreamHold).toBe(true)

      vi.advanceTimersByTime(10000)

      expect(service.micStreamHold).toBe(false)
      emitMicFrame(service)
      expect(sentMessages(socket).some((msg) => msg.realtimeInput?.audio)).toBe(true)

      service.disconnect()
    } finally {
      vi.useRealTimers()
    }
  })
})
