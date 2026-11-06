const samples = new Map()

const zone =
{
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
}

function showBanner(banner, text)
{
  banner.hidden = !text
  banner.textContent = text || ''
}

function tick(clock, now = new Date())
{
  clock.textContent = new Intl.DateTimeFormat('zh-CN', zone).format(now)
}

function formatRate(bps)
{
  if (bps >= 1000000)
  {
    return (bps / 1000000).toFixed(1) + ' Mb/s'
  }
  return Math.max(0, Math.round(bps / 1000)) + ' kb/s'
}

// 用相邻两次状态的字节差算码率。第一次只有一个样本，显示破折号。
function rateOf(cam, now, store = samples)
{
  const prev = store.get(cam.id)
  store.set(cam.id,
  {
    at: now,
    bytes: cam.bytes
  }
  )
  if (!prev)
  {
    return '—'
  }
  const dt = (now - prev.at) / 1000
  if (dt <= 0)
  {
    return '—'
  }
  return formatRate((cam.bytes - prev.bytes) * 8 / dt)
}

function summaryText(cameras)
{
  let online = 0
  for (const cam of cameras)
  {
    if (cam.running)
    {
      online += 1
    }
  }
  return online + ' / ' + cameras.length + ' 路拉取中'
}

function statsLine(cam, rate)
{
  const run = cam.running ? 'RTSP 拉取中' : 'RTSP 重连'
  return rate + ' · ' + run
}

function waitingText(cam)
{
  return cam.running ? '正在连接' : '摄像头重连中'
}

function paint(cameras, wall, summary, now = Date.now())
{
  summary.textContent = summaryText(cameras)
  for (const cam of cameras)
  {
    const tile = wall.querySelector('[data-id="' + cam.id + '"]')
    if (!tile)
    {
      continue
    }
    applyTile(tile, cam, rateOf(cam, now))
  }
}

// 更新码率和拉取状态。画面已经在播时不改覆盖层文字。
function applyTile(tile, cam, rate)
{
  tile.dataset.run = cam.running ? '1' : '0'
  tile.querySelector('.stats').textContent = statsLine(cam, rate)
  if (tile.dataset.mode === 'wait')
  {
    tile.querySelector('.state').textContent = waitingText(cam)
  }
}

function canPlayMpegts(mpegts)
{
  return Boolean(mpegts) && mpegts.getFeatureList().mseLivePlayback
}

// 播放器只连 /stream/<id>，不接触摄像头地址。
function playerSource(id)
{
  return (
  {
    type: 'mpegts',
    isLive: true,
    url: '/stream/' + id
  }
  )
}

// 直播低延迟：不攒缓冲，延迟超过 1.5 秒就追。
function playerConfig()
{
  return (
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

function destroyPlayer(player)
{
  if (!player)
  {
    return null
  }
  player.pause()
  player.unload()
  player.detachMediaElement()
  player.destroy()
  return null
}

// 显示失败，1.5 秒后再建一个播放器。
function failPlayback(session, text)
{
  session.tile.dataset.mode = 'bad'
  session.state.textContent = text
  clearTimeout(session.timer)
  session.timer = setTimeout(() =>
  {
    beginPlayback(session)
  }
  , 1500)
}

// 忽略已经拆掉的播放器抛出的错误。
function onPlayerError(session, token)
{
  if (token !== session.generation)
  {
    return
  }
  failPlayback(session, '信号中断，正在重连')
}

// 拆掉旧播放器再连这一路。generation 用来丢掉过期的错误回调。
function beginPlayback(session)
{
  session.generation += 1
  const token = session.generation
  session.player = destroyPlayer(session.player)
  if (!canPlayMpegts(session.mpegts))
  {
    session.tile.dataset.mode = 'bad'
    session.state.textContent = '当前浏览器不能播放'
    return
  }
  session.tile.dataset.mode = 'wait'
  session.state.textContent = '正在连接'
  const player = session.mpegts.createPlayer(
    playerSource(session.tile.dataset.id),
    playerConfig()
  )
  session.player = player
  player.attachMediaElement(session.video)
  player.on(session.mpegts.Events.ERROR, () =>
  {
    onPlayerError(session, token)
  }
  )
  player.load()
  const pending = player.play()
  if (pending && pending.catch)
  {
    pending.catch(() =>
    {
    }
    )
  }
}

function markLive(tile)
{
  tile.dataset.mode = 'live'
}

function bindPlayer(tile, mpegts)
{
  const video = tile.querySelector('video')
  const state = tile.querySelector('.state')
  const session =
  {
    tile,
    video,
    state,
    mpegts,
    player: null,
    timer: null,
    generation: 0
  }
  video.addEventListener('playing', () =>
  {
    markLive(tile)
  }
  )
  beginPlayback(session)
  return session
}

function toggleFullscreen(doc, tile)
{
  const action = doc.fullscreenElement === tile
    ? doc.exitFullscreen()
    : tile.requestFullscreen()
  if (action && action.catch)
  {
    action.catch(() =>
    {
    }
    )
  }
}

function renderTile(cam, doc, mpegts)
{
  const tile = doc.createElement('section')
  tile.className = 'tile'
  tile.dataset.id = cam.id
  tile.dataset.mode = 'wait'
  tile.dataset.run = '0'

  const video = doc.createElement('video')
  video.muted = true
  video.autoplay = true
  video.playsInline = true
  video.setAttribute('playsinline', '')

  const caption = doc.createElement('div')
  caption.className = 'caption'

  const label = doc.createElement('div')
  label.className = 'label'
  const dot = doc.createElement('span')
  dot.className = 'dot'
  const name = doc.createElement('strong')
  name.textContent = cam.name
  const channel = doc.createElement('em')
  channel.textContent = '主码流 ' + cam.channel
  label.append(dot, name, channel)

  const side = doc.createElement('div')
  const stats = doc.createElement('div')
  stats.className = 'stats'
  const button = doc.createElement('button')
  button.className = 'full'
  button.type = 'button'
  button.textContent = '全屏'
  button.addEventListener('click', () =>
  {
    toggleFullscreen(doc, tile)
  }
  )
  side.append(stats, button)

  const state = doc.createElement('div')
  state.className = 'state'
  state.textContent = '正在连接'

  caption.append(label, side)
  tile.append(video, caption, state)
  bindPlayer(tile, mpegts)
  return tile
}

// 按状态接口返回的摄像头建画面。每路立刻开始连接 /stream/<id>。
function build(cameras, wall, doc, mpegts)
{
  wall.replaceChildren()
  for (const cam of cameras)
  {
    wall.append(renderTile(cam, doc, mpegts))
  }
}

// GET /api/status。第一次成功才建画面，之后只刷新数字。
async function refresh(page)
{
  let data
  try
  {
    const res = await page.fetchStatus()
    data = await res.json()
  }
  catch (err)
  {
    page.fail('状态接口暂时连不上')
    return
  }
  page.fail('')
  if (!page.wall.childElementCount)
  {
    page.build(data.cameras)
  }
  page.paint(data.cameras)
}

// 页面入口。时钟和状态都是每秒一次。
function boot()
{
  const wall = document.querySelector('.wall')
  const banner = document.querySelector('#banner')
  const clock = document.querySelector('#clock')
  const summary = document.querySelector('#summary')
  const page =
  {
    wall,
    fetchStatus()
    {
      return fetch('/api/status',
      {
        cache: 'no-store'
      }
      )
    }
    ,
    fail(text)
    {
      showBanner(banner, text)
    }
    ,
    build(cameras)
    {
      build(cameras, wall, document, window.mpegts)
    }
    ,
    paint(cameras)
    {
      paint(cameras, wall, summary)
    }
  }
  tick(clock)
  setInterval(() =>
  {
    tick(clock)
  }
  , 1000)
  refresh(page)
  setInterval(() =>
  {
    refresh(page)
  }
  , 1000)
}

if (typeof document !== 'undefined')
{
  boot()
}

export
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
