# Camera Wall

English | [中文](README.zh.md)

Put home cameras on one wall and show them together. Streams come in over RTSP. To turn RTSP on for a home camera, ask that brand's support.

Watch several IP camera main streams in one browser page. The server pulls RTSP with ffmpeg and remuxes it to MPEG-TS. The page plays that with [mpegts.js](https://github.com/xqq/mpegts.js) 1.8.0. Camera URLs stay on the server. The browser only receives `/stream/<id>`.

<p align="center">
  <img src="docs/preview.jpg" alt="Camera Wall with two live main streams">
</p>

## Features

- One tile per camera, with bitrate, pull state, and fullscreen.
- Splits the wall into equal cells from the camera count, as close to a square as that count allows. One camera fills the page. Two sit side by side. Three and four use two rows of two. Five and six use three columns. A narrow window stacks the tiles.
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

## License

This project is licensed under the [MIT License](LICENSE). Copyright (c) 2026 SparkTheCreater.

[mpegts.js](https://github.com/xqq/mpegts.js) in `public/vendor/mpegts.js` is included under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). Copyright (C) 2021 magicxqq.
