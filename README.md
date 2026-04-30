# PinAR

A GPS-based AR navigation app that lets you drop named pins at real-world locations and navigate back to them through your camera. Built with vanilla JS, [A-Frame](https://aframe.io/) 1.4.0, and AR.js. No bundler, no framework, no backend — all data lives in `localStorage`.

## Features

- **Drop pins** at your current GPS location with a custom name and emoji
- **AR beacons** — glowing 3D markers float in your camera feed, scaling with distance
- **Nav banner** — shows the nearest pin with a rotating directional arrow; tap to start navigation
- **Turn-by-turn** — progress bar fills as you close in; banner flashes green and vibrates on arrival
- **Compass strip** — floating pill with tick marks, cardinal directions, and coloured pin dots
- **Map view** — dark Leaflet map with pin markers, popups, and a recentre button
- **Share links** — encodes a pin as base64 JSON in a `?pin=` URL; recipients get an instant save + navigate prompt
- **Pin list** — sort by nearest or newest; navigate, share, or delete from one sheet

## Getting Started

No build step required. Serve the project root over HTTP — browsers block Geolocation on plain `file://` origins.

```bash
python -m http.server 8000
# or
npx http-server .
```

Open `http://localhost:8000` in a browser. On mobile you get full GPS and camera AR. On desktop, GPS and AR are unavailable but all UI interaction works.

**Production:** must be served over HTTPS. Browsers block Geolocation on non-`localhost` HTTP origins.

## Architecture

```
src/app.js              Bootstrap — instantiates modules, wires them together
modules/SensorLayer.js  GPS + compass; emits sensor:location, sensor:heading, sensor:error
modules/PinStore.js     Single source of truth; persists to localStorage (key: pinar_pins_v1)
modules/NavEngine.js    Pure math — Haversine distance, bearing, arrived detection (≤5 m)
modules/ARRenderer.js   A-Frame scene — creates/updates 3D beacon entities per pin
modules/MapView.js      Leaflet map — syncs markers, user dot, popups
modules/UILayer.js      All DOM/sheet/toast/compass/nav-banner interaction
modules/ShareModule.js  URL share — base64 JSON in ?pin= query param
```

Modules communicate exclusively via `CustomEvent` on `window`. `NavEngine` is stateless pure math with no DOM or events. Dev mode (`localhost`) exposes all instances as `window._pinar` for console debugging.

## Pin Schema

```js
{ id, name, emoji, lat, lng, color, createdAt }
```

The 7-colour palette auto-rotates by current pin count.

## Tech Stack

| Concern | Library |
|---|---|
| AR + 3D | A-Frame 1.4.0 + AR.js 3.4.5 |
| Map | Leaflet 1.9.4 + CartoDB Dark tiles |
| QR (share fallback) | qrcode 1.5.3 |
| Everything else | Vanilla JS, no build step |
