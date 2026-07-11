import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('canvas-confetti', () => ({ default: vi.fn() }))

import { GeminiLiveServiceImpl } from '@/app/lib/GeminiLiveService'

class FakeAudioContext {
  static instances = []

  constructor({ sampleRate }) {
    this.sampleRate = sampleRate
    this.state = 'suspended'
    this.currentTime = 2
    this.destination = {}
    this.bufferSources = []
    this.resume = vi.fn(async () => {
      this.state = 'running'
    })
    this.close = vi.fn(async () => {
      this.state = 'closed'
    })
    FakeAudioContext.instances.push(this)
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
