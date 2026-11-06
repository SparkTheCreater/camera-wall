# Camera Wall

Watch several IP camera main streams in one browser page. The server pulls RTSP with ffmpeg and remuxes it to MPEG-TS. The page plays that with [mpegts.js](https://github.com/xqq/mpegts.js) 1.8.0. Camera URLs stay on the server. The browser only receives `/stream/<id>`.

<p align="center">
  <img src="docs/preview.jpg" alt="Camera Wall with two live main streams">
</p>

## Features

- One tile per camera, with bitrate, pull state, and fullscreen.
- Pulls a camera only while someone is watching it. The last viewer leaving stops that pull after 5 seconds.
- Restarts a pull that dies while viewers are still connected.
- Optional HTTP basic authentication for the page and the streams.
- Camera passwords never appear in the page or in `/api/status`.

## Quick start

Requires Node.js and ffmpeg on `PATH`.

```bash
cp config.example.json config.json
npm start
```

Edit `config.json` before starting. The terminal prints a URL for each interface when `host` is `0.0.0.0`. Open that URL.

`config.json` is gitignored. It holds camera passwords. Do not commit it.

## Configuration

`config.example.json` is the full sample. The addresses there are documentation addresses from `192.0.2.0/24`. Replace them.

A minimal file:

```json
{
  "host": "0.0.0.0",
  "port": 8090,
  "cameras":
  [
    {
      "id": "gate",
      "name": "Gate",
      "host": "192.0.2.10",
      "channel": "101",
      "url": "rtsp://user:password@192.0.2.10:554/Streaming/Channels/101"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `host` | Address to listen on. `0.0.0.0` and `::` listen on every interface and the startup log lists each IPv4 address. Any other value binds that address only. |
| `port` | TCP port. |
| `access` | Optional HTTP basic auth. Remove the object to leave the page open. |
| `access.user` | User name for the page. |
| `access.password` | Password for the page. |
| `cameras` | One object per camera. The page builds one tile for each entry. |
| `cameras[].id` | Stream id. Letters, digits, `_`, and `-` only. Used in `/stream/<id>`. |
| `cameras[].name` | Label on the tile. |
| `cameras[].host` | Shown in the UI and the log. Not used to open the camera. |
| `cameras[].channel` | Shown in the UI and the log. |
| `cameras[].url` | RTSP URL passed to ffmpeg, including the user and password. |

Hikvision main streams are often `/Streaming/Channels/101`.

Set `CAMERA_WALL_CONFIG` to read a file other than `./config.json`.

## Behavior

Opening the page connects each player to `/stream/<id>`. That request starts ffmpeg for that camera. A request to the HTML page or `/api/status` does not.

The page refreshes bitrate and pull state once a second. Fullscreen toggles the tile.

When the last viewer of a camera disconnects, the server waits 5 seconds, then stops ffmpeg. A player reconnecting inside that window keeps the same pull. If ffmpeg exits while viewers remain, it is started again.

## Tests

```bash
npm test
```

---

# 监控墙

在一个浏览器页面里同时看多路网络摄像头的主码流。服务端用 ffmpeg 把 RTSP 转成 MPEG-TS，页面用 [mpegts.js](https://github.com/xqq/mpegts.js) 1.8.0 播放。摄像头地址只留在服务端，浏览器拿到的是 `/stream/<id>`。

<p align="center">
  <img src="docs/preview.jpg" alt="监控墙同时播放两路主码流">
</p>

## 功能

- 每路一个画面，显示码率、拉取状态，可以全屏。
- 有人看某一路才拉那一路。最后一位观众离开 5 秒后停止。
- 还有人在看时，拉流中断会重新拉起。
- 页面和视频流可以加 HTTP 基本认证。
- 摄像头口令不会出现在页面或 `/api/status` 里。

## 快速开始

需要 Node.js，并且 ffmpeg 在 `PATH` 里。

```bash
cp config.example.json config.json
npm start
```

启动前改好 `config.json`。`host` 为 `0.0.0.0` 时，终端会打印每块网卡的地址。打开其中的地址。

`config.json` 已在 `.gitignore` 里。里面有摄像头口令，不要提交。

## 配置

完整示例是 `config.example.json`。里面的地址属于文档用网段 `192.0.2.0/24`，换成自己的摄像头。

最少可以写成：

```json
{
  "host": "0.0.0.0",
  "port": 8090,
  "cameras":
  [
    {
      "id": "gate",
      "name": "大门",
      "host": "192.0.2.10",
      "channel": "101",
      "url": "rtsp://user:password@192.0.2.10:554/Streaming/Channels/101"
    }
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| `host` | 监听地址。`0.0.0.0` 和 `::` 表示所有网卡，启动日志会列出每个 IPv4 地址。写成其他地址就只绑那一个。 |
| `port` | 端口。 |
| `access` | 可选的 HTTP 基本认证。删掉这一段，页面就不需要登录。 |
| `access.user` | 网页用户名。 |
| `access.password` | 网页口令。 |
| `cameras` | 每一路摄像头。页面为每一项建一个画面。 |
| `cameras[].id` | 流编号。只能用字母、数字、`_` 和 `-`。对应 `/stream/<id>`。 |
| `cameras[].name` | 画面上的名字。 |
| `cameras[].host` | 显示在页面和日志里。不拿来连接摄像头。 |
| `cameras[].channel` | 显示在页面和日志里。 |
| `cameras[].url` | 交给 ffmpeg 的 RTSP 地址，用户名和口令写在这里。 |

海康主码流常见路径是 `/Streaming/Channels/101`。

要换配置文件路径，设置 `CAMERA_WALL_CONFIG`。

## 行为

打开页面后，每一路播放器会连接 `/stream/<id>`，这时才启动那一路的 ffmpeg。只打开 HTML 或请求 `/api/status` 不会拉流。

页面每秒刷新码率和拉取状态。点「全屏」放大当前这一路。

某一路的最后一位观众断开后，服务等 5 秒再停掉 ffmpeg。播放器在这 5 秒内重连，会继续用原来的拉流。还有人在看时，ffmpeg 自己退出会再启动。

## 测试

```bash
npm test
```
