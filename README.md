# 监控墙

在浏览器里同时看多路摄像头的主码流。服务端用 ffmpeg 把 RTSP 转成 MPEG-TS，页面用 [mpegts.js](https://github.com/xqq/mpegts.js) 1.8.0 播放。摄像头地址只留在服务端配置里，页面拿到的是 `/stream/<id>`。

## 准备

需要 Node.js 和 ffmpeg，并且 ffmpeg 在 `PATH` 里。

```bash
cp config.example.json config.json
```

然后编辑 `config.json`：

- `host`：本机监听地址。`0.0.0.0` 表示所有网卡，启动时会列出每块网卡的地址。只想绑一块网卡时，写成那块网卡的 IP。
- `port`：本机端口。
- `access`：网页的 HTTP 基本认证。删掉这一段，页面就不需要登录。
- `cameras`：每一路摄像头。`id` 只用字母、数字、`_` 和 `-`。`url` 是给 ffmpeg 的 RTSP 地址，用户名和口令写在这里。`host` 和 `channel` 只用于页面和日志。

海康主码流常见路径是 `/Streaming/Channels/101`。示例里的 `192.0.2.0/24` 是文档地址，换成自己的摄像头。

`config.json` 已在 `.gitignore` 里。里面有摄像头口令，不要提交。

换配置文件路径时设置 `CAMERA_WALL_CONFIG`。

## 运行

```bash
npm start
```

终端会打印局域网地址。打开页面、播放器连上某一路时才开始拉流；最后一位观众离开 5 秒后停止。观看过程中拉流中断会自动重连。页面每秒刷新码率和状态，点「全屏」放大一路。

## 测试

```bash
npm test
```
