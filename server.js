import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import
{
  spawn
}
from 'node:child_process'
import
{
  readFileSync
}
from 'node:fs'
import
{
  fileURLToPath,
  pathToFileURL
}
from 'node:url'
import
{
  timingSafeEqual
}
from 'node:crypto'

const root = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(root, 'public')
// 12 秒无数据视为卡死。观众还在时 1.2 秒后重拉。最后一位观众离开后再等 5 秒才停。
const stallMs = 12000
const restartMs = 1200
const idleMs = 5000
// 单个观众积压超过 2MB 就断开，避免慢客户端拖住所有路。
const maxQueued = 2 * 1024 * 1024

const types =
{
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
}

const pulls = new Map()
let access = null

// 配置路径。CAMERA_WALL_CONFIG 优先，否则用项目目录里的 config.json。
function configFile()
{
  return process.env.CAMERA_WALL_CONFIG || path.join(root, 'config.json')
}

// 读监听地址和端口。没有 access 时页面不需要登录。
function applyConfig(next)
{
  access = next.access || null
  return {
    host: next.host || '0.0.0.0',
    port: next.port || 8090
  }
}

function basicHeader(user, password)
{
  return 'Basic ' + Buffer.from(user + ':' + password).toString('base64')
}

// 比对整段 Basic 头。长度不同直接拒绝，避免 timingSafeEqual 抛错。
function authorized(req)
{
  if (!access)
  {
    return true
  }
  const header = req.headers.authorization || ''
  const expected = basicHeader(access.user, access.password)
  if (header.length !== expected.length)
  {
    return false
  }
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected))
}

function deny(res)
{
  res.writeHead(401,
  {
    'WWW-Authenticate': 'Basic realm="camera-wall"'
  }
  )
  res.end()
}

// 日志里的 RTSP 地址整段换成 rtsp://***，口令不落盘。
function redact(text)
{
  return text.replace(/rtsp:\/\/\S+/g, 'rtsp://***')
}

// 只复制视频，去掉音频，从 stdout 输出 MPEG-TS。不经 shell，URL 作为参数传入。
function ffmpegArgs(url)
{
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'warning',
    '-rtsp_transport', 'tcp',
    '-stimeout', '8000000',
    '-i', url,
    '-map', '0:v:0',
    '-c:v', 'copy',
    '-an',
    '-f', 'mpegts',
    '-mpegts_flags', 'resend_headers+pat_pmt_at_frames',
    'pipe:1'
  ]
}

function clientBlocked(res)
{
  return res.destroyed || res.writableEnded || res.writableLength > maxQueued
}

function releaseClient(clients, res)
{
  clients.delete(res)
  if (!res.destroyed)
  {
    res.destroy()
  }
}

// 把一块视频分给当前观众。写不进去的连接立刻丢掉。
function fanout(clients, chunk)
{
  for (const res of clients)
  {
    if (clientBlocked(res))
    {
      releaseClient(clients, res)
      continue
    }
    res.write(chunk)
  }
}

function acceptChunk(ctx, chunk)
{
  ctx.lastData = Date.now()
  ctx.state.bytes += chunk.length
  fanout(ctx.clients, chunk)
}

function logFfmpeg(ctx, buf)
{
  const line = redact(buf.toString()).trim()
  if (line)
  {
    console.error(`[${ctx.camera.id}] ${line}`)
  }
}

// 进程退出后的重拉。没有观众、正在关机、或已经排过一次，就不再启动。
function scheduleRestart(ctx)
{
  ctx.state.running = false
  ctx.proc = null
  if (ctx.stopped || ctx.restarting || ctx.clients.size === 0)
  {
    return
  }
  ctx.restarting = true
  ctx.state.restarts += 1
  clearTimeout(ctx.timer)
  ctx.timer = setTimeout(() =>
  {
    ctx.restarting = false
    launch(ctx)
  }
  , restartMs)
}

function onProcessError(ctx, err)
{
  logFfmpeg(ctx, Buffer.from(String(err && err.message || err)))
  scheduleRestart(ctx)
}

// 启动一路 ffmpeg。stdout 进观众，stderr 进日志。退出后交给 scheduleRestart。
function launch(ctx)
{
  if (ctx.stopped)
  {
    return
  }
  let proc
  try
  {
    proc = ctx.spawnProcess('ffmpeg', ffmpegArgs(ctx.camera.url),
    {
      stdio:
      [
        'ignore',
        'pipe',
        'pipe'
      ]
    }
    )
  }
  catch (err)
  {
    onProcessError(ctx, err)
    return
  }
  ctx.proc = proc
  ctx.state.running = true
  ctx.state.startedAt = Date.now()
  ctx.lastData = Date.now()
  proc.stdout.on('data', (chunk) =>
  {
    acceptChunk(ctx, chunk)
  }
  )
  proc.stderr.on('data', (buf) =>
  {
    logFfmpeg(ctx, buf)
  }
  )
  proc.on('error', (err) =>
  {
    onProcessError(ctx, err)
  }
  )
  proc.on('exit', () =>
  {
    scheduleRestart(ctx)
  }
  )
}

function streamStalled(proc, lastData, now)
{
  return Boolean(proc) && now - lastData > stallMs
}

// 超过 12 秒没有数据就 SIGKILL。进程退出后，还有观众才会重拉。
function watchPull(ctx)
{
  if (streamStalled(ctx.proc, ctx.lastData, Date.now()))
  {
    ctx.proc.kill('SIGKILL')
  }
}

function stopProcess(ctx)
{
  clearTimeout(ctx.timer)
  ctx.restarting = false
  if (ctx.proc)
  {
    ctx.proc.kill('SIGTERM')
  }
}

// 还有观众或正在关机时不动。没人看就取消待重连，5 秒后停掉 ffmpeg。
function releaseIfIdle(ctx)
{
  if (ctx.clients.size > 0 || ctx.stopped)
  {
    return
  }
  clearTimeout(ctx.timer)
  ctx.restarting = false
  if (!ctx.proc)
  {
    return
  }
  clearTimeout(ctx.idleTimer)
  ctx.idleTimer = setTimeout(() =>
  {
    ctx.idleTimer = null
    stopProcess(ctx)
  }
  , idleMs)
}

// 登记一位观众。这是第一次有人看、且当前没有进程时，才启动拉流。
function subscribe(ctx, res)
{
  clearTimeout(ctx.idleTimer)
  ctx.idleTimer = null
  ctx.clients.add(res)
  const leave = () =>
  {
    if (!ctx.clients.delete(res))
    {
      return
    }
    releaseIfIdle(ctx)
  }
  res.on('close', leave)
  res.on('error', leave)
  if (ctx.stopped || ctx.proc || ctx.restarting)
  {
    return
  }
  launch(ctx)
}

// 关机时停掉这一路。stopped 之后不会再被观众重新拉起。
function stopPull(ctx, watch)
{
  ctx.stopped = true
  clearTimeout(ctx.timer)
  clearTimeout(ctx.idleTimer)
  clearInterval(watch)
  if (ctx.proc)
  {
    ctx.proc.kill('SIGTERM')
  }
  for (const res of ctx.clients)
  {
    res.end()
  }
  ctx.clients.clear()
}

function createContext(camera, spawnProcess)
{
  return (
  {
    camera,
    clients: new Set(),
    state:
    {
      running: false,
      bytes: 0,
      startedAt: 0,
      restarts: 0
    },
    proc: null,
    stopped: false,
    restarting: false,
    timer: null,
    idleTimer: null,
    lastData: Date.now(),
    spawnProcess
  }
  )
}

// 只建立一路的状态和看门狗，不在这里启动 ffmpeg。
function createPull(camera, spawnProcess = spawn)
{
  const ctx = createContext(camera, spawnProcess)
  const watch = setInterval(() =>
  {
    watchPull(ctx)
  }
  , 2000)
  return (
  {
    camera,
    state: ctx.state,
    viewers()
    {
      return ctx.clients.size
    }
    ,
    subscribe(res)
    {
      subscribe(ctx, res)
    }
    ,
    stop()
    {
      stopPull(ctx, watch)
    }
  }
  )
}

function uptimeMs(state, now)
{
  if (!state.running)
  {
    return 0
  }
  return now - state.startedAt
}

// 状态接口里的一路。不含 RTSP 地址。
function cameraView(pull, now)
{
  return (
  {
    id: pull.camera.id,
    name: pull.camera.name,
    host: pull.camera.host,
    channel: pull.camera.channel,
    running: pull.state.running,
    bytes: pull.state.bytes,
    viewers: pull.viewers(),
    uptimeMs: uptimeMs(pull.state, now),
    restarts: pull.state.restarts
  }
  )
}

function snapshot(source = pulls, now = Date.now())
{
  const cameras = []
  for (const pull of source.values())
  {
    cameras.push(cameraView(pull, now))
  }
  return (
  {
    cameras
  }
  )
}

function sendJson(res, body)
{
  res.writeHead(200,
  {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }
  )
  res.end(JSON.stringify(body))
}

function publicName(pathname)
{
  if (pathname === '/')
  {
    return 'index.html'
  }
  return pathname.replace(/^\/+/, '')
}

function insidePublic(file)
{
  return file === publicDir || file.startsWith(publicDir + path.sep)
}

// 静态文件必须落在 public 目录内，否则当找不到。
function resolvePublic(pathname)
{
  const file = path.resolve(publicDir, publicName(pathname))
  if (!insidePublic(file))
  {
    return ''
  }
  return file
}

function contentType(file)
{
  return types[path.extname(file)] || 'application/octet-stream'
}

function refuseFile(file)
{
  return !file || path.extname(file) === ''
}

function sendFile(res, file)
{
  let body
  try
  {
    body = readFileSync(file)
  }
  catch (err)
  {
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200,
  {
    'Content-Type': contentType(file),
    'Cache-Control': 'no-cache'
  }
  )
  res.end(body)
}

// GET /stream/:id
// 订阅这一路。第一个观众会把 ffmpeg 拉起来。未知 id 返回 404。
function openStream(res, id)
{
  const pull = pulls.get(id)
  if (!pull)
  {
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200,
  {
    'Content-Type': 'video/mp2t',
    'Cache-Control': 'no-cache, no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  }
  )
  if (res.socket)
  {
    res.socket.setNoDelay(true)
  }
  pull.subscribe(res)
}

// 只接受 GET。
// GET /api/status    各路是否在拉、字节数、观众数。不启动拉流。
// GET /stream/:id    该路的 MPEG-TS。会按需启动拉流。
// 其他路径           public 目录里的静态文件。/ 即 index.html。
function handleRequest(req, res)
{
  if (!authorized(req))
  {
    deny(res)
    return
  }
  if (req.method !== 'GET')
  {
    res.writeHead(405)
    res.end()
    return
  }
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/api/status')
  {
    sendJson(res, snapshot())
    return
  }
  const stream = url.pathname.match(/^\/stream\/([A-Za-z0-9_-]+)$/)
  if (stream)
  {
    openStream(res, stream[1])
    return
  }
  const file = resolvePublic(url.pathname)
  if (refuseFile(file))
  {
    res.writeHead(404)
    res.end()
    return
  }
  sendFile(res, file)
}

function lanAddress(item)
{
  return item.family === 'IPv4' && !item.internal
}

function collectLan(items, found)
{
  for (const item of items || [])
  {
    if (lanAddress(item))
    {
      found.push(item.address)
    }
  }
}

function addresses()
{
  const found = []
  for (const items of Object.values(os.networkInterfaces()))
  {
    collectLan(items, found)
  }
  return found
}

let closing = false

// 停掉所有拉流再关端口。关不干净时 800 毫秒后仍退出。
function shutdown(exit = process.exit)
{
  if (closing)
  {
    return
  }
  closing = true
  for (const pull of pulls.values())
  {
    pull.stop()
  }
  server.close(() =>
  {
    exit(0)
  }
  )
  setTimeout(() =>
  {
    exit(0)
  }
  , 800).unref()
}

// 绑在所有网卡上时，日志列出每块网卡；绑在具体地址上时只打印那个地址。
function advertisedHosts(endpoint, hosts)
{
  if (endpoint.host === '0.0.0.0' || endpoint.host === '::')
  {
    return hosts.length === 0 ? ['127.0.0.1'] : hosts
  }
  return [endpoint.host]
}

function logReady(endpoint, cameras, hosts = addresses())
{
  for (const host of advertisedHosts(endpoint, hosts))
  {
    console.log(`监控墙 http://${host}:${endpoint.port}`)
  }
  for (const camera of cameras)
  {
    console.log(`待命 ${camera.host}:554/Streaming/Channels/${camera.channel}`)
  }
}

// 读配置、登记每一路，然后监听。此时还没有 ffmpeg。
function main()
{
  const next = JSON.parse(readFileSync(configFile(), 'utf8'))
  const endpoint = applyConfig(next)
  for (const camera of next.cameras)
  {
    pulls.set(camera.id, createPull(camera))
  }
  process.on('SIGINT', () =>
  {
    shutdown()
  }
  )
  process.on('SIGTERM', () =>
  {
    shutdown()
  }
  )
  server.listen(endpoint.port, endpoint.host, () =>
  {
    logReady(endpoint, next.cameras)
  }
  )
}

function isDirectRun()
{
  const entry = process.argv[1]
  if (!entry)
  {
    return false
  }
  return import.meta.url === pathToFileURL(entry).href
}

const server = http.createServer(handleRequest)

if (isDirectRun())
{
  main()
}

export
{
  acceptChunk,
  addresses,
  applyConfig,
  authorized,
  cameraView,
  clientBlocked,
  collectLan,
  configFile,
  createContext,
  contentType,
  createPull,
  fanout,
  ffmpegArgs,
  handleRequest,
  insidePublic,
  isDirectRun,
  lanAddress,
  launch,
  logFfmpeg,
  logReady,
  openStream,
  publicName,
  pulls,
  redact,
  refuseFile,
  releaseClient,
  resolvePublic,
  scheduleRestart,
  sendFile,
  server,
  shutdown,
  snapshot,
  stopPull,
  streamStalled,
  uptimeMs,
  watchPull
}
