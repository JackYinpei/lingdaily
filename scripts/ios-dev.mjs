import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { networkInterfaces } from 'node:os'
import nextEnv from '@next/env'
import { developmentConnection } from './lib/ios-dev-connection.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
nextEnv.loadEnvConfig(root, true)
const args = process.argv.slice(2)
if (args.some(arg => arg !== '--device')) {
  console.error('用法：npm run ios:dev [-- --device]')
  process.exit(1)
}
let connection
try {
  connection = developmentConnection({ device: args.includes('--device'), interfaces: networkInterfaces(), interfaceName: process.env.IOS_DEV_INTERFACE })
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
if (!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim()) {
  console.error('请先在本机 .env 中设置 GEMINI_API_KEY，再运行 npm run ios:dev。')
  process.exit(1)
}
const directory = path.join(root, '.ios-dev')
const file = path.join(directory, 'connection.json')
const deviceFile = path.join(directory, 'device-connection.json')
const tokenFile = path.join(directory, 'pairing-token')
fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
let accessToken
try { accessToken = fs.readFileSync(tokenFile, 'utf8').trim() } catch { /* First run. */ }
if (!/^[a-f0-9]{64}$/.test(accessToken || '')) {
  try { accessToken = JSON.parse(fs.readFileSync(file, 'utf8')).accessToken } catch { /* No older pairing. */ }
}
if (!/^[a-f0-9]{64}$/.test(accessToken || '')) accessToken = randomBytes(32).toString('hex')
fs.writeFileSync(tokenFile, accessToken, { mode: 0o600 })
fs.chmodSync(tokenFile, 0o600)
fs.writeFileSync(file, JSON.stringify({ baseURL: 'http://localhost:8000', accessToken }), { mode: 0o600 })
fs.chmodSync(file, 0o600)
if (connection.allowsPhysicalDevice) {
  fs.writeFileSync(deviceFile, JSON.stringify({ baseURL: connection.baseURL, accessToken, allowsPhysicalDevice: true }), { mode: 0o600 })
  fs.chmodSync(deviceFile, 0o600)
  console.log(`iOS 真机开发服务：${connection.baseURL}（同一局域网）。请在 Xcode 选择手机并重新运行 Debug App，允许本地网络访问。`)
} else {
  // A later ordinary simulator run must not accidentally pair a phone build.
  fs.rmSync(deviceFile, { force: true })
  console.log('iOS AI 开发服务：http://localhost:8000（仅本机）。保持此进程运行，然后在 Xcode 中运行 LingDaily。')
}
console.log('本机配对文件已生成；Gemini 密钥只留在 Node 服务端。停止本服务后，Xcode 新构建的 App 会改连线上服务。')
const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', connection.hostname, '--port', '8000'], {
  cwd: root, stdio: 'inherit',
  env: {
    ...process.env, NODE_ENV: 'development', IOS_PRACTICE_DEV_ENABLED: '1', IOS_PRACTICE_DEV_TOKEN: accessToken,
    // The existing web gateway failed locally. This per-feature override uses
    // the verified official endpoint without changing any web feature config.
    GEMINI_PRACTICE_BASE_URL: process.env.GEMINI_PRACTICE_BASE_URL || 'https://generativelanguage.googleapis.com',
  },
})
// Without a running local server the Debug build must fall back to production,
// so the bundled pairing only exists while this process is alive.
const removePairing = () => { for (const name of [file, deviceFile]) fs.rmSync(name, { force: true }) }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', code => { removePairing(); process.exit(code ?? 1) })
child.on('error', () => { console.error('无法启动本机 AI 服务。'); process.exit(1) })
