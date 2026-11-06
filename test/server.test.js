import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test, { mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import
{
  acceptChunk,
  addresses,
  applyConfig,
  cameraView,
  clientBlocked,
  collectLan,
  configFile,
  contentType,
  createContext,
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
from '../server.js'

const queuedLimit = 2 * 1024 * 1024
const publicDir = path.dirname(resolvePublic('/'))

function response()
{
  return (
  {
    status: 0,
    headers: null,
    body: undefined,
    ended: false,
    socket: null,
    events: {},
    writeHead(status, headers)
    {
      this.status = status
      this.headers = headers
    }
    ,
    end(body)
    {
      this.ended = true
      this.body = body
    }
    ,
    on(name, fn)
    {
      this.events[name] = fn
    }
  }
  )
}

function request(method, url)
{
  return (
  {
    method,
    url
  }
  )
}

function fakeProcess()
{
  const proc =
  {
    kills: [],
    stdout: { on() {} },
    stderr: { on() {} },
    on() {},
    kill(signal)
    {
      proc.kills.push(signal)
    }
  }
  return proc
}

function silence(fn)
{
  const original = console.error
  const lines = []
  console.error = (line) =>
  {
    lines.push(line)
  }
  try
  {
    fn(lines)
  }
  finally
  {
    console.error = original
  }
}

test('a fresh pull starts from a stopped context', () =>
{
  const ctx = createContext({ id: '239', url: 'rtsp://camera/live' }, () => fakeProcess())
  assert.equal(ctx.state.running, false)
  assert.equal(ctx.state.bytes, 0)
  assert.equal(ctx.state.startedAt, 0)
  assert.equal(ctx.state.restarts, 0)
  assert.equal(ctx.stopped, false)
  assert.equal(ctx.restarting, false)
}
)

test('importing the server does not listen', () =>
{
  assert.equal(server.listening, false)
}
)

test('redact hides rtsp urls', () =>
{
  assert.equal(redact('see rtsp://user:secret@host/live'), 'see rtsp://***')
  assert.equal(redact('plain'), 'plain')
}
)

test('ffmpeg args copy the video url', () =>
{
  const args = ffmpegArgs('rtsp://camera/live')
  assert.equal(args.includes('rtsp://camera/live'), true)
  assert.equal(args[args.indexOf('-c:v') + 1], 'copy')
  assert.equal(args.at(-1), 'pipe:1')
}
)

test('a client is dropped only when it cannot take more data', () =>
{
  assert.equal(clientBlocked({ destroyed: true, writableEnded: false, writableLength: 0 }), true)
  assert.equal(clientBlocked({ destroyed: false, writableEnded: true, writableLength: 0 }), true)
  assert.equal(clientBlocked({ destroyed: false, writableEnded: false, writableLength: queuedLimit }), false)
  assert.equal(clientBlocked({ destroyed: false, writableEnded: false, writableLength: queuedLimit + 1 }), true)
  assert.equal(clientBlocked({ destroyed: false, writableEnded: false, writableLength: 0 }), false)
}
)

test('fanout writes to a live client and drops a blocked one', () =>
{
  const dropped =
  {
    destroyed: false,
    writableEnded: true,
    writableLength: 0,
    destroyCount: 0,
    destroy()
    {
      this.destroyCount += 1
    }
  }
  const live =
  {
    destroyed: false,
    writableEnded: false,
    writableLength: 0,
    chunks: [],
    write(chunk)
    {
      this.chunks.push(chunk)
    }
  }
  const clients = new Set([dropped, live])
  fanout(clients, Buffer.from('abc'))
  assert.equal(clients.has(dropped), false)
  assert.equal(dropped.destroyCount, 1)
  assert.deepEqual(live.chunks, [Buffer.from('abc')])
}
)

test('chunk bytes are counted', () =>
{
  const live =
  {
    destroyed: false,
    writableEnded: false,
    writableLength: 0,
    write() {}
  }
  const ctx =
  {
    lastData: 0,
    state: { bytes: 4 },
    clients: new Set([live])
  }
  acceptChunk(ctx, Buffer.from('abcd'))
  assert.equal(ctx.state.bytes, 8)
  assert.equal(ctx.lastData > 0, true)
}
)

test('ffmpeg logs are redacted and blank lines are skipped', () =>
{
  silence((lines) =>
  {
    logFfmpeg({ camera: { id: '239' } }, Buffer.from('rtsp://user:secret@host/x'))
    logFfmpeg({ camera: { id: '239' } }, Buffer.from('   '))
    assert.equal(lines.length, 1)
    assert.equal(lines[0].includes('secret'), false)
    assert.equal(lines[0].includes('rtsp://***'), true)
  }
  )
}
)

test('a stalled pull is killed and a fresh one is not', () =>
{
  const proc = {}
  assert.equal(streamStalled(null, 0, 99999), false)
  assert.equal(streamStalled(proc, 0, 12000), false)
  assert.equal(streamStalled(proc, 0, 12001), true)
  assert.equal(streamStalled(proc, 5000, 17000), false)
  assert.equal(streamStalled(proc, 5000, 17001), true)
  const ctx = { proc: fakeProcess(), lastData: 0 }
  const now = Date.now
  Date.now = () => 12001
  try
  {
    watchPull(ctx)
  }
  finally
  {
    Date.now = now
  }
  assert.deepEqual(ctx.proc.kills, ['SIGKILL'])
}
)

test('launch does nothing after stop and otherwise starts ffmpeg', () =>
{
  let calls = 0
  launch(
  {
    stopped: true,
    spawnProcess()
    {
      calls += 1
    }
  }
  )
  assert.equal(calls, 0)

  const proc = fakeProcess()
  const ctx =
  {
    stopped: false,
    camera: { id: '239', url: 'rtsp://camera/live' },
    state: { running: false, startedAt: 0, bytes: 0, restarts: 0 },
    lastData: 0,
    proc: null,
    spawnProcess(command, args)
    {
      calls += 1
      assert.equal(command, 'ffmpeg')
      assert.equal(args.includes('rtsp://camera/live'), true)
      return proc
    }
  }
  launch(ctx)
  assert.equal(calls, 1)
  assert.equal(ctx.state.running, true)
  assert.equal(ctx.proc, proc)
}
)

test('a failed spawn restarts once even if exit follows the error', () =>
{
  const broken =
  {
    stopped: false,
    restarting: false,
    camera: { id: '239', url: 'rtsp://camera/live' },
    state: { running: true, restarts: 0, bytes: 0, startedAt: 0 },
    proc: null,
    timer: null,
    lastData: 0,
    clients: new Set([{}]),
    spawnProcess()
    {
      throw new Error('spawn ffmpeg ENOENT')
    }
  }
  silence(() =>
  {
    launch(broken)
  }
  )
  clearTimeout(broken.timer)
  assert.equal(broken.state.running, false)
  assert.equal(broken.state.restarts, 1)

  const handlers = {}
  const proc =
  {
    stdout: { on() {} },
    stderr: { on() {} },
    on(name, fn)
    {
      handlers[name] = fn
    }
    ,
    kill() {}
  }
  const ctx =
  {
    stopped: false,
    restarting: false,
    camera: { id: '239', url: 'rtsp://camera/live' },
    state: { running: false, restarts: 0, bytes: 0, startedAt: 0 },
    proc: null,
    timer: null,
    lastData: 0,
    clients: new Set([{}]),
    spawnProcess()
    {
      return proc
    }
  }
  silence((lines) =>
  {
    launch(ctx)
    handlers.error(new Error('rtsp://user:secret@host broke'))
    handlers.exit()
    assert.equal(lines.some((line) => line.includes('secret')), false)
    assert.equal(lines.some((line) => line.includes('broke')), true)
    assert.equal(lines.some((line) => line.includes('Error:')), false)
  }
  )
  clearTimeout(ctx.timer)
  assert.equal(ctx.state.restarts, 1)
  assert.equal(ctx.proc, null)
}
)

test('restart is skipped once the pull is stopped', () =>
{
  const stopped =
  {
    stopped: true,
    proc: {},
    state: { running: true, restarts: 0 },
    timer: null
  }
  scheduleRestart(stopped)
  assert.equal(stopped.state.running, false)
  assert.equal(stopped.proc, null)
  assert.equal(stopped.state.restarts, 0)

  const live =
  {
    stopped: false,
    proc: {},
    state: { running: true, restarts: 1 },
    timer: null,
    clients: new Set([{}])
  }
  scheduleRestart(live)
  clearTimeout(live.timer)
  assert.equal(live.state.restarts, 2)
  assert.equal(live.timer !== null, true)
}
)

test('a scheduled restart launches again and clears the guard', () =>
{
  mock.timers.enable({ apis: ['setTimeout'] })
  let launches = 0
  const ctx =
  {
    stopped: false,
    restarting: false,
    camera: { id: '239', url: 'rtsp://camera/live' },
    state: { running: true, restarts: 0, bytes: 0, startedAt: 0 },
    proc: {},
    timer: null,
    lastData: 0,
    clients: new Set([{}]),
    spawnProcess()
    {
      launches += 1
      return fakeProcess()
    }
  }
  try
  {
    scheduleRestart(ctx)
    assert.equal(ctx.restarting, true)
    mock.timers.tick(1200)
    assert.equal(ctx.restarting, false)
    assert.equal(launches, 1)
    assert.equal(ctx.state.running, true)
  }
  finally
  {
    mock.timers.reset()
    clearTimeout(ctx.timer)
  }
}
)

test('stop ends viewers and signals ffmpeg', () =>
{
  const ended = []
  const ctx =
  {
    stopped: false,
    proc: fakeProcess(),
    timer: setTimeout(() => {}, 60000),
    clients: new Set([
      {
        end()
        {
          ended.push(1)
        }
      }
    ])
  }
  let cleared = false
  const watch = setInterval(() => {}, 60000)
  const original = clearInterval
  clearInterval = (id) =>
  {
    cleared = true
    original(id)
  }
  try
  {
    stopPull(ctx, watch)
  }
  finally
  {
    clearInterval = original
    clearInterval(watch)
    clearTimeout(ctx.timer)
  }
  assert.equal(ctx.stopped, true)
  assert.equal(cleared, true)
  assert.deepEqual(ctx.proc.kills, ['SIGTERM'])
  assert.deepEqual(ended, [1])
  assert.equal(ctx.clients.size, 0)
}
)

test('an idle pull does not schedule another ffmpeg', () =>
{
  const ctx =
  {
    stopped: false,
    proc: {},
    state: { running: true, restarts: 3 },
    timer: null,
    clients: new Set()
  }
  scheduleRestart(ctx)
  assert.equal(ctx.state.running, false)
  assert.equal(ctx.proc, null)
  assert.equal(ctx.state.restarts, 3)
  assert.equal(ctx.timer, null)
}
)

test('a viewer who stays keeps a scheduled restart', () =>
{
  mock.timers.enable({ apis: ['setTimeout'] })
  let spawned = 0
  let onExit = null
  const proc =
  {
    stdout: { on() {} },
    stderr: { on() {} },
    on(name, fn)
    {
      if (name === 'exit')
      {
        onExit = fn
      }
    }
    ,
    kill() {}
  }
  const pull = createPull({ id: '239', url: 'rtsp://camera/live' }, () =>
  {
    spawned += 1
    return proc
  }
  )
  const viewer = () =>
  {
    return {
      events: {},
      end()
      {
      }
      ,
      on(name, fn)
      {
        this.events[name] = fn
      }
    }
  }
  try
  {
    const staying = viewer()
    const leaving = viewer()
    pull.subscribe(staying)
    pull.subscribe(leaving)
    onExit()
    assert.equal(pull.state.restarts, 1)
    leaving.events.close()
    mock.timers.tick(1200)
    assert.equal(spawned, 2)
    assert.equal(pull.state.running, true)
  }
  finally
  {
    pull.stop()
    mock.timers.reset()
  }
}
)

test('ffmpeg waits for a viewer and stops after the last one leaves', () =>
{
  mock.timers.enable({ apis: ['setTimeout'] })
  const kills = []
  let spawned = 0
  let onExit = null
  const proc =
  {
    stdout: { on() {} },
    stderr: { on() {} },
    on(name, fn)
    {
      if (name === 'exit')
      {
        onExit = fn
      }
    }
    ,
    kill(signal)
    {
      kills.push(signal)
    }
  }
  const pull = createPull({ id: '239', url: 'rtsp://camera/live' }, () =>
  {
    spawned += 1
    return proc
  }
  )
  const viewer = () =>
  {
    return {
      events: {},
      end()
      {
      }
      ,
      on(name, fn)
      {
        this.events[name] = fn
      }
    }
  }
  try
  {
    assert.equal(spawned, 0)
    const first = viewer()
    const second = viewer()
    pull.subscribe(first)
    pull.subscribe(second)
    assert.equal(spawned, 1)
    assert.equal(pull.state.running, true)
    first.events.close()
    mock.timers.tick(5000)
    assert.deepEqual(kills, [])
    second.events.close()
    mock.timers.tick(4999)
    const third = viewer()
    pull.subscribe(third)
    mock.timers.tick(5000)
    assert.deepEqual(kills, [])
    assert.equal(spawned, 1)
    third.events.close()
    mock.timers.tick(5000)
    assert.deepEqual(kills, ['SIGTERM'])
    onExit()
    assert.equal(pull.state.restarts, 0)
    assert.equal(pull.state.running, false)
  }
  finally
  {
    pull.stop()
    mock.timers.reset()
  }
}
)

test('createPull subscribes and stops without a real camera', () =>
{
  const pull = createPull({ id: '239', url: 'rtsp://camera/live' }, () => fakeProcess())
  const res =
  {
    events: {},
    on(name, fn)
    {
      this.events[name] = fn
    }
  }
  pull.subscribe(res)
  assert.equal(pull.viewers(), 1)
  res.events.close()
  assert.equal(pull.viewers(), 0)
  pull.stop()
}
)

test('status snapshot reports uptime only while running', () =>
{
  assert.equal(uptimeMs({ running: false, startedAt: 10 }, 50), 0)
  assert.equal(uptimeMs({ running: true, startedAt: 10 }, 50), 40)
  const pull =
  {
    camera: { id: '239', name: 'front', host: '10.0.0.8', channel: '101' },
    state: { running: true, bytes: 9, startedAt: 10, restarts: 2 },
    viewers()
    {
      return 4
    }
  }
  assert.equal(cameraView(pull, 50).uptimeMs, 40)
  assert.deepEqual(snapshot(new Map([['239', pull]]), 50).cameras[0].viewers, 4)
}
)

test('public paths stay inside the public directory', () =>
{
  assert.equal(publicName('/'), 'index.html')
  assert.equal(publicName('/app.js'), 'app.js')
  assert.equal(insidePublic(publicDir), true)
  assert.equal(insidePublic(path.join(publicDir, 'app.js')), true)
  assert.equal(insidePublic(path.resolve(publicDir, '..', 'server.js')), false)
  assert.equal(resolvePublic('/').endsWith(path.join('public', 'index.html')), true)
  assert.equal(resolvePublic('/../server.js'), '')
  assert.equal(refuseFile(''), true)
  assert.equal(refuseFile(path.join(publicDir, 'app.js')), false)
  assert.equal(refuseFile(path.join(publicDir, 'README')), true)
}
)

test('content type falls back for unknown extensions', () =>
{
  assert.equal(contentType('a.js').includes('javascript'), true)
  assert.equal(contentType('a.bin'), 'application/octet-stream')
}
)

test('sendFile serves a real asset and misses the rest', () =>
{
  const found = response()
  sendFile(found, resolvePublic('/index.html'))
  assert.equal(found.status, 200)
  assert.equal(Buffer.isBuffer(found.body), true)

  const missing = response()
  sendFile(missing, path.join(publicDir, 'missing.js'))
  assert.equal(missing.status, 404)
}
)

test('basic auth rejects a missing or wrong secret', () =>
{
  applyConfig(
  {
    port: 8090,
    access:
    {
      user: 'wall',
      password: 'secret'
    }
  }
  )
  try
  {
    const missing = response()
    handleRequest({ method: 'GET', url: '/api/status', headers: {} }, missing)
    assert.equal(missing.status, 401)

    const wrong = response()
    handleRequest(
    {
      method: 'GET',
      url: '/api/status',
      headers:
      {
        authorization: 'Basic bm9wZTpub3Bl'
      }
    }
    , wrong)
    assert.equal(wrong.status, 401)

    const accepted = response()
    handleRequest(
    {
      method: 'GET',
      url: '/api/status',
      headers:
      {
        authorization: 'Basic ' + Buffer.from('wall:secret').toString('base64')
      }
    }
    , accepted)
    assert.equal(accepted.status, 200)
  }
  finally
  {
    applyConfig({ port: 8090 })
  }
}
)

test('routes reject bad methods, missing files, and unknown streams', () =>
{
  pulls.clear()
  const denied = response()
  handleRequest(request('POST', '/api/status'), denied)
  assert.equal(denied.status, 405)

  const status = response()
  handleRequest(request('GET', '/api/status'), status)
  assert.equal(status.status, 200)
  assert.equal(JSON.parse(status.body).cameras.length, 0)

  const missing = response()
  handleRequest(request('GET', '/missing.js'), missing)
  assert.equal(missing.status, 404)

  const bare = response()
  handleRequest(request('GET', '/vendor'), bare)
  assert.equal(bare.status, 404)

  const page = response()
  handleRequest(request('GET', '/'), page)
  assert.equal(page.status, 200)
}
)

test('a known stream is subscribed and a socket gets nodelay', () =>
{
  pulls.clear()
  const pull = createPull({ id: '239', url: 'rtsp://camera/live' }, () => fakeProcess())
  pulls.set('239', pull)
  try
  {
    const missing = response()
    openStream(missing, 'missing')
    assert.equal(missing.status, 404)

    const quiet = response()
    openStream(quiet, '239')
    assert.equal(quiet.status, 200)
    assert.equal(pull.viewers(), 1)

    const res = response()
    res.socket =
    {
      nodelay: false,
      setNoDelay(value)
      {
        this.nodelay = value
      }
    }
    openStream(res, '239')
    assert.equal(res.socket.nodelay, true)
  }
  finally
  {
    pull.stop()
    pulls.clear()
  }
}
)

test('the request router opens a stream by its id', () =>
{
  pulls.clear()
  const pull = createPull({ id: '239', url: 'rtsp://camera/live' }, () => fakeProcess())
  pulls.set('239', pull)
  try
  {
    const res = response()
    handleRequest(
    {
      method: 'GET',
      url: '/stream/239',
      headers: {}
    }
    , res)
    assert.equal(res.status, 200)
    assert.equal(pull.viewers(), 1)
  }
  finally
  {
    pull.stop()
    pulls.clear()
  }
}
)

test('lan addresses ignore internal and non-ipv4 entries', () =>
{
  assert.equal(lanAddress({ family: 'IPv4', internal: false }), true)
  assert.equal(lanAddress({ family: 'IPv4', internal: true }), false)
  assert.equal(lanAddress({ family: 'IPv6', internal: false }), false)
  const found = []
  collectLan(null, found)
  collectLan([
    { family: 'IPv4', internal: true, address: '127.0.0.1' },
    { family: 'IPv4', internal: false, address: '10.0.0.8' }
  ], found)
  assert.deepEqual(found, ['10.0.0.8'])
  assert.equal(Array.isArray(addresses()), true)
}
)

test('shutdown stops pulls once and exits with zero', async () =>
{
  mock.timers.enable({ apis: ['setTimeout'] })
  pulls.clear()
  const codes = []
  try
  {
    shutdown((code) =>
    {
      codes.push(code)
    }
    )
    shutdown((code) =>
    {
      codes.push(code)
    }
    )
    await new Promise((resolve) =>
    {
      setImmediate(resolve)
    }
    )
    mock.timers.tick(800)
  }
  finally
  {
    mock.timers.reset()
  }
  assert.deepEqual(codes, [0, 0])
}
)

test('the published example keeps camera urls as placeholders', () =>
{
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.example.json')
  const example = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(example.host, '0.0.0.0')
  assert.equal(example.port, 8090)
  assert.equal(example.cameras.length > 0, true)
  for (const camera of example.cameras)
  {
    assert.equal(camera.url.startsWith('rtsp://user:password@192.0.2.'), true)
    assert.equal(camera.host.startsWith('192.0.2.'), true)
  }
}
)

test('config file and direct-run follow the process entry', () =>
{
  const savedEnv = process.env.CAMERA_WALL_CONFIG
  const savedArgv = process.argv[1]
  try
  {
    delete process.env.CAMERA_WALL_CONFIG
    assert.equal(configFile(), path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.json'))
    process.env.CAMERA_WALL_CONFIG = 'C:\\tmp\\wall.json'
    assert.equal(configFile(), 'C:\\tmp\\wall.json')
    assert.deepEqual(applyConfig({}), { host: '0.0.0.0', port: 8090 })
    assert.deepEqual(applyConfig({ host: '127.0.0.1', port: 8091 }), { host: '127.0.0.1', port: 8091 })
    process.argv[1] = ''
    assert.equal(isDirectRun(), false)
    process.argv[1] = fileURLToPath(new URL('../public/app.js', import.meta.url))
    assert.equal(isDirectRun(), false)
    process.argv[1] = fileURLToPath(new URL('../server.js', import.meta.url))
    assert.equal(isDirectRun(), true)
  }
  finally
  {
    if (savedEnv === undefined)
    {
      delete process.env.CAMERA_WALL_CONFIG
    }
    else
    {
      process.env.CAMERA_WALL_CONFIG = savedEnv
    }
    process.argv[1] = savedArgv
    applyConfig({ port: 8090 })
  }
}
)

test('ready log follows the configured host and port', () =>
{
  const lines = []
  const original = console.log
  console.log = (line) =>
  {
    lines.push(line)
  }
  try
  {
    logReady({ host: '0.0.0.0', port: 8090 }, [{ host: '10.0.0.5', channel: '101' }], [])
    logReady({ host: '0.0.0.0', port: 8090 }, [], ['192.0.2.10'])
    logReady({ host: '::', port: 8090 }, [], ['192.0.2.30'])
    logReady({ host: '192.0.2.20', port: 8091 }, [], ['10.0.0.8'])
  }
  finally
  {
    console.log = original
  }
  assert.deepEqual(lines, [
    '监控墙 http://127.0.0.1:8090',
    '待命 10.0.0.5:554/Streaming/Channels/101',
    '监控墙 http://192.0.2.10:8090',
    '监控墙 http://192.0.2.30:8090',
    '监控墙 http://192.0.2.20:8091'
  ])
}
)
