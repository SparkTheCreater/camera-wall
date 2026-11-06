import assert from 'node:assert/strict'
import test from 'node:test'
import
{
  applyTile,
  beginPlayback,
  bindPlayer,
  build,
  canPlayMpegts,
  destroyPlayer,
  failPlayback,
  formatRate,
  markLive,
  onPlayerError,
  paint,
  playerConfig,
  playerSource,
  rateOf,
  refresh,
  showBanner,
  statsLine,
  summaryText,
  tick,
  toggleFullscreen,
  waitingText
}
from '../public/app.js'

function element(tag)
{
  const el =
  {
    tag,
    className: '',
    dataset: {},
    textContent: '',
    hidden: false,
    children: [],
    attrs: {},
    listeners: {},
    type: '',
    muted: false,
    autoplay: false,
    playsInline: false,
    requested: false,
    setAttribute(name, value)
    {
      el.attrs[name] = value
    }
    ,
    append(...nodes)
    {
      el.children.push(...nodes)
    }
    ,
    replaceChildren()
    {
      el.children = []
    }
    ,
    addEventListener(name, fn)
    {
      el.listeners[name] = fn
    }
    ,
    querySelector(sel)
    {
      return find(el, sel)
    }
    ,
    requestFullscreen()
    {
      el.requested = true
      return Promise.resolve('requested')
    }
  }
  return el
}

function find(root, sel)
{
  const all = [root]
  for (const child of root.children || [])
  {
    all.push(child)
    for (const nested of child.children || [])
    {
      all.push(nested)
    }
  }
  return all.find((el) =>
  {
    if (sel === 'video')
    {
      return el.tag === 'video'
    }
    if (sel === '.state')
    {
      return el.className === 'state'
    }
    if (sel === '.stats')
    {
      return el.className === 'stats'
    }
    if (sel.startsWith('[data-id="'))
    {
      return el.dataset.id === sel.slice(10, -2)
    }
    return false
  }
  ) || null
}

test('banner hides only when the text is empty', () =>
{
  const banner = { hidden: false, textContent: 'old' }
  showBanner(banner, '断线')
  assert.equal(banner.hidden, false)
  assert.equal(banner.textContent, '断线')
  showBanner(banner, '')
  assert.equal(banner.hidden, true)
  assert.equal(banner.textContent, '')
}
)

test('clock uses shanghai time', () =>
{
  const clock = { textContent: '' }
  tick(clock, new Date('2026-11-05T15:30:45Z'))
  assert.equal(clock.textContent.includes('23:30:45'), true)
}
)

test('rates use bits and stay non-negative', () =>
{
  assert.equal(formatRate(1000000), '1.0 Mb/s')
  assert.equal(formatRate(999999), '1000 kb/s')
  assert.equal(formatRate(-1500), '0 kb/s')
}
)

test('rate needs two samples and a positive interval', () =>
{
  const store = new Map()
  const cam = { id: '239', bytes: 0 }
  assert.equal(rateOf(cam, 1000, store), '—')
  cam.bytes = 125000
  assert.equal(rateOf(cam, 1000, store), '—')
  cam.bytes = 250000
  assert.equal(rateOf(cam, 2000, store), '1.0 Mb/s')
  cam.bytes = 312500
  assert.equal(rateOf(cam, 2500, store), '1.0 Mb/s')
}
)

test('summary and tile text follow the pull state', () =>
{
  const cameras = [{ running: true }, { running: false }]
  assert.equal(summaryText(cameras), '1 / 2 路拉取中')
  assert.equal(statsLine({ running: true }, '1.0 Mb/s'), '1.0 Mb/s · RTSP 拉取中')
  assert.equal(statsLine({ running: false }, '0 kb/s'), '0 kb/s · RTSP 重连')
  assert.equal(waitingText({ running: true }), '正在连接')
  assert.equal(waitingText({ running: false }), '摄像头重连中')
}
)

test('paint skips unknown tiles and updates a waiting one', () =>
{
  const tile = element('section')
  tile.dataset.id = '239'
  tile.dataset.mode = 'wait'
  tile.append(element('div'))
  tile.children[0].className = 'stats'
  tile.append(element('div'))
  tile.children[1].className = 'state'
  const wall =
  {
    querySelector(sel)
    {
      return find(tile, sel)
    }
  }
  const summary = { textContent: '' }
  paint([{ id: '239', running: true, bytes: 0 }, { id: '228', running: false, bytes: 0 }], wall, summary, 1000)
  assert.equal(summary.textContent, '1 / 2 路拉取中')
  assert.equal(tile.dataset.run, '1')
  assert.equal(tile.querySelector('.state').textContent, '正在连接')
}
)

test('applyTile leaves the overlay alone once the picture is live', () =>
{
  const tile = element('section')
  tile.dataset.mode = 'live'
  tile.append(element('div'))
  tile.children[0].className = 'stats'
  const state = element('div')
  state.className = 'state'
  state.textContent = 'keep'
  tile.append(state)
  applyTile(tile, { running: false }, '0 kb/s')
  assert.equal(tile.dataset.run, '0')
  assert.equal(state.textContent, 'keep')
}
)

test('mpegts capability and player options stay explicit', () =>
{
  assert.equal(canPlayMpegts(null), false)
  assert.equal(canPlayMpegts({ getFeatureList: () => ({ mseLivePlayback: false }) }), false)
  assert.equal(canPlayMpegts({ getFeatureList: () => ({ mseLivePlayback: true }) }), true)
  assert.deepEqual(playerSource('239'),
  {
    type: 'mpegts',
    isLive: true,
    url: '/stream/239'
  }
  )
  assert.deepEqual(playerConfig(),
  {
    enableWorker: false,
    enableStashBuffer: false,
    stashInitialSize: 128,
    liveBufferLatencyChasing: true,
    liveBufferLatencyMaxLatency: 1.5,
    liveBufferLatencyMinRemain: 0.3,
    autoCleanupSourceBuffer: true,
    autoCleanupMaxBackwardDuration: 12,
    autoCleanupMinBackwardDuration: 6
  }
  )
}
)

test('destroy is a no-op without a player', () =>
{
  assert.equal(destroyPlayer(null), null)
  const calls = []
  const player =
  {
    pause() { calls.push('pause') },
    unload() { calls.push('unload') },
    detachMediaElement() { calls.push('detach') },
    destroy() { calls.push('destroy') }
  }
  assert.equal(destroyPlayer(player), null)
  assert.deepEqual(calls, ['pause', 'unload', 'detach', 'destroy'])
}
)

test('playback reports a missing decoder and ignores a stale error', () =>
{
  const session =
  {
    generation: 0,
    player: null,
    mpegts: null,
    tile: { dataset: { id: '239', mode: 'wait' } },
    state: { textContent: '' },
    video: {},
    timer: null
  }
  beginPlayback(session)
  assert.equal(session.generation, 1)
  assert.equal(session.tile.dataset.mode, 'bad')
  assert.equal(session.state.textContent, '当前浏览器不能播放')

  session.generation = 2
  onPlayerError(session, 1)
  assert.equal(session.state.textContent, '当前浏览器不能播放')
  onPlayerError(session, 2)
  assert.equal(session.state.textContent, '信号中断，正在重连')
  clearTimeout(session.timer)
}
)

test('a playable session loads and attaches', () =>
{
  let source = null
  let config = null
  let caught = false
  const player =
  {
    attachMediaElement() {},
    on() {},
    load() { this.loaded = true },
    play()
    {
      return { catch() { caught = true } }
    }
  }
  const session =
  {
    generation: 0,
    player: null,
    tile: { dataset: { id: '239', mode: '' } },
    state: { textContent: '' },
    video: {},
    timer: null,
    mpegts:
    {
      Events: { ERROR: 'error' },
      getFeatureList: () => ({ mseLivePlayback: true }),
      createPlayer(nextSource, nextConfig)
      {
        source = nextSource
        config = nextConfig
        return player
      }
    }
  }
  beginPlayback(session)
  assert.equal(session.tile.dataset.mode, 'wait')
  assert.equal(source.url, '/stream/239')
  assert.equal(config.isLive, undefined)
  assert.equal(config.enableWorker, false)
  assert.equal(player.loaded, true)
  assert.equal(caught, true)
  assert.equal(session.player, player)

  const quiet =
  {
    generation: 0,
    player: null,
    tile: { dataset: { id: '239', mode: '' } },
    state: { textContent: '' },
    video: {},
    timer: null,
    mpegts:
    {
      Events: { ERROR: 'error' },
      getFeatureList: () => ({ mseLivePlayback: true }),
      createPlayer()
      {
        return {
          attachMediaElement() {},
          on() {},
          load() {},
          play() {}
        }
      }
    }
  }
  beginPlayback(quiet)
  assert.equal(quiet.tile.dataset.mode, 'wait')
}
)

test('fullscreen toggles the current tile', () =>
{
  const tile = element('section')
  const doc =
  {
    fullscreenElement: null,
    exitCount: 0,
    exitFullscreen()
    {
      this.exitCount += 1
      return Promise.resolve('exited')
    }
  }
  toggleFullscreen(doc, tile)
  assert.equal(tile.requested, true)
  doc.fullscreenElement = tile
  toggleFullscreen(doc, tile)
  assert.equal(doc.exitCount, 1)
  toggleFullscreen(doc, { requestFullscreen() { return null } })
}
)

test('failure text is shown before the retry', () =>
{
  const session =
  {
    tile: { dataset: {} },
    state: { textContent: '' },
    timer: null
  }
  failPlayback(session, '信号中断，正在重连')
  assert.equal(session.tile.dataset.mode, 'bad')
  assert.equal(session.state.textContent, '信号中断，正在重连')
  clearTimeout(session.timer)
}
)

test('refresh builds once and reports a dead status call', async () =>
{
  const built = []
  const painted = []
  const failures = []
  const wall = { childElementCount: 0 }
  await refresh(
  {
    wall,
    async fetchStatus()
    {
      return { async json() { return { cameras: [{ id: '239' }] } } }
    }
    ,
    fail(text) { failures.push(text) },
    build(cameras) { built.push(cameras); wall.childElementCount = 1 },
    paint(cameras) { painted.push(cameras) }
  }
  )
  await refresh(
  {
    wall,
    async fetchStatus()
    {
      return { async json() { return { cameras: [{ id: '239' }] } } }
    }
    ,
    fail(text) { failures.push(text) },
    build(cameras) { built.push(cameras) },
    paint(cameras) { painted.push(cameras) }
  }
  )
  await refresh(
  {
    wall,
    fetchStatus() { return Promise.reject(new Error('down')) },
    fail(text) { failures.push(text) },
    build() {},
    paint() {}
  }
  )
  assert.equal(built.length, 1)
  assert.equal(painted.length, 2)
  assert.deepEqual(failures, ['', '', '状态接口暂时连不上'])
}
)

test('build creates one tile per camera', () =>
{
  const wall = element('main')
  const doc =
  {
    fullscreenElement: null,
    createElement: element,
    exitFullscreen() { return Promise.resolve() }
  }
  build([{ id: '239', name: 'front', channel: '101' }], wall, doc, null)
  const tile = wall.children[0]
  const video = tile.querySelector('video')
  assert.equal(wall.children.length, 1)
  assert.equal(tile.dataset.id, '239')
  assert.equal(tile.dataset.mode, 'bad')
  assert.equal(video.muted, true)
  assert.equal(video.autoplay, true)
  assert.equal(video.playsInline, true)
  assert.equal(video.attrs.playsinline, '')
  const channel = tile.children.find((child) => child.className === 'caption')
    .children.find((child) => child.className === 'label')
    .children.find((child) => child.tag === 'em')
  assert.equal(channel.textContent, '主码流 101')
  const session = bindPlayer(tile, null)
  assert.equal(session.generation, 1)
  markLive(tile)
  assert.equal(wall.children[0].dataset.mode, 'live')
}
)
