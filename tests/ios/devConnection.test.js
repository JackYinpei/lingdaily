import { describe, expect, it } from 'vitest'
import { developmentConnection, isPrivateIPv4 } from '../../scripts/lib/ios-dev-connection.mjs'

const lan = address => [{ address, family: 'IPv4', internal: false }]

describe('explicit physical device development connection', () => {
  it('keeps the default server on loopback', () => {
    expect(developmentConnection({ interfaces: { en0: lan('192.168.31.16') } }))
      .toEqual({ hostname: '127.0.0.1', baseURL: 'http://localhost:8000' })
  })
  it('binds one private interface only after opting in', () => {
    expect(developmentConnection({ device: true, interfaces: { en0: lan('192.168.31.16'), utun0: lan('10.0.0.1') } }))
      .toEqual({ hostname: '192.168.31.16', baseURL: 'http://192.168.31.16:8000', allowsPhysicalDevice: true })
  })
  it('rejects public, malformed and ambiguous addresses', () => {
    for (const address of ['8.8.8.8', '127.0.0.1', '172.32.0.1', '192.168.1.256', '010.1.2.3', '::1']) {
      expect(isPrivateIPv4(address)).toBe(false)
      expect(() => developmentConnection({ device: true, interfaces: { en0: lan(address) } })).toThrow()
    }
    const interfaces = { en0: lan('192.168.31.16'), en1: lan('10.0.0.2') }
    expect(() => developmentConnection({ device: true, interfaces })).toThrow()
    expect(developmentConnection({ device: true, interfaces, interfaceName: 'en1' }).hostname).toBe('10.0.0.2')
  })
})
