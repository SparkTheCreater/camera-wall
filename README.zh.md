# 监控墙

[English](README.md) | 中文

家用摄像头上墙，同步显示，基于 RTSP。家用摄像头如何打开 RTSP，可以咨询对应品牌的客服。

在一个浏览器页面里同时看多路网络摄像头的主码流。服务端用 ffmpeg 把 RTSP 转成 MPEG-TS，页面用 [mpegts.js](https://github.com/xqq/mpegts.js) 1.8.0 播放。摄像头地址只留在服务端，浏览器拿到的是 `/stream/<id>`。

<p align="center">
  <img src="docs/preview.jpg" alt="监控墙同时播放两路主码流">
</p>

## 功能

- 每路一个画面，显示码率、拉取状态，可以全屏。
- 按配置里的摄像头数量平均分屏，每格一样大，行列尽量接近正方形。1 路铺满，2 路并排，3 路和 4 路是两行两列，5 路和 6 路是三列。窗口很窄时改成上下排列。
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

## 流程

打开页面先看状态，然后每一路画面连接自己的流。这次连接才会启动 ffmpeg。

```mermaid
sequenceDiagram
  participant Browser as 浏览器
  participant Server as 服务
  participant FFmpeg as ffmpeg
  participant Camera as 摄像头
  Browser->>Server: GET /api/status
  Server-->>Browser: 各路未在拉
  Browser->>Server: GET /stream/id
  Server->>FFmpeg: 启动
  FFmpeg->>Camera: RTSP
  Camera-->>FFmpeg: 视频
  FFmpeg-->>Server: MPEG-TS
  Server-->>Browser: MPEG-TS
  Browser->>Server: 最后一位观众断开
  Note over Server: 等待 5 秒
  Server->>FFmpeg: 停止
```

拉流存在时，只在还有人看的情况下继续。

```mermaid
flowchart TD
  chunk["收到一块 MPEG-TS"] --> fanout["发给当前观众"]
  fanout --> slow{"某一位积压超过 2MB?"}
  slow -->|yes| drop["断开这一位"]
  slow -->|no| keep["保留这一位"]
  stall["12 秒没有数据"] --> kill["杀掉 ffmpeg"]
  kill --> viewers{"还有观众?"}
  viewers -->|yes| again["1.2 秒后重新启动"]
  viewers -->|no| stopped["保持停止"]
  leave["最后一位观众离开"] --> wait["等待 5 秒"]
  wait --> returned{"有人回来?"}
  returned -->|yes| keep
  returned -->|no| stopped
```

## 测试

```bash
npm test
```

## 协议

本项目以 [MIT License](LICENSE) 授权。Copyright (c) 2026 SparkTheCreater。

`public/vendor/mpegts.js` 中的 [mpegts.js](https://github.com/xqq/mpegts.js) 另行遵循 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)。Copyright (C) 2021 magicxqq。
