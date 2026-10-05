// A physical phone must reach the Mac, rather than its own localhost.
// Device mode is explicit and binds only one private LAN interface.
export function isPrivateIPv4(address) {
  const parts = address.split('.')
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return false
  const [a, b] = parts.map(Number)
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

export function developmentConnection({ device = false, interfaces = {}, interfaceName } = {}) {
  if (!device) return { hostname: '127.0.0.1', baseURL: 'http://localhost:8000' }
  const candidates = Object.entries(interfaces)
    .filter(([name]) => interfaceName ? name === interfaceName : /^en\d+$/.test(name))
    .flatMap(([name, addresses]) => addresses
      .filter(item => !item.internal && item.family === 'IPv4' && isPrivateIPv4(item.address))
      .map(item => ({ name, address: item.address })))
  if (candidates.length !== 1) throw new Error('请连接 Wi-Fi；有多个局域网接口时用 IOS_DEV_INTERFACE=en0 指定手机所在网络。')
  const hostname = candidates[0].address
  return { hostname, baseURL: `http://${hostname}:8000`, allowsPhysicalDevice: true }
}
