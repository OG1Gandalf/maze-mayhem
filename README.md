# Maze Mayhem

A two-player online maze race for desktop and mobile browsers. Race to the glowing beacon in the centre of a 21×21 maze, shoot your rival, pick up cash, and deal with corrupt NPCs (MP, MLA, Businessman, Policeman) who hunt you down.

- **Frontend:** Vite + TypeScript, Three.js third-person view, Canvas minimap, plain CSS
- **Backend:** Node.js + Express + Socket.IO. The server is authoritative; clients only send inputs.
- **One process, one port:** Express serves the page and Socket.IO together, in dev and in production.

## Requirements

Node.js 20 or newer.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000 (Vite HMR + game server on one port)
```

Open the URL, enter a name, **Create room**, and share the 4-letter code. The second player opens the same address, enters the code and taps **Join**. Both press **I'm ready**, then a 3-2-1 countdown starts the race.

To test alone, open a second browser tab (each tab is its own player), or start a headless bot:

```bash
npx tsx scripts/bot.ts ABCD          # joins room ABCD, readies up, wanders and shoots
npx tsx scripts/bot.ts ABCD --idle   # joins and stands still (good target practice)
```

### Play from a phone on the same Wi-Fi

The server listens on `0.0.0.0` and prints your LAN address on startup:

```
  Maze Mayhem is running
  Local:   http://localhost:3000
  Network: http://192.168.1.23:3000   <- open this on your phone (same Wi-Fi)
```

1. Connect the phone to the same Wi-Fi network as the laptop.
2. Open the **Network** URL in the phone's browser.
3. If it doesn't load, allow incoming connections for Node in your firewall (macOS: System Settings → Network → Firewall), and make sure the network doesn't isolate clients (guest networks often do).

The room code screen has a copy button that copies an invite link (`/?room=ABCD`) which pre-fills the code.

### Production build

```bash
npm run build                # client -> dist/client, server bundle -> dist/server/index.js
PORT=8080 npm start          # serves everything from one Node process
```

`PORT` (default `3000`) and `HOST` (default `0.0.0.0`) are read from the environment. `GET /healthz` returns `{ ok, rooms }` for platform health checks. The client connects to Socket.IO on the same origin, so no URL needs configuring. Three.js is bundled by Vite (no CDN).

### Deploy on Render

Build-time tools (Vite, esbuild, TypeScript, Three.js) are in `dependencies`, so the build works even when Render skips devDependencies.

1. Push the repo to GitHub/GitLab.
2. In Render: **New → Blueprint** and pick the repo (it reads [`render.yaml`](render.yaml)), or **New → Web Service** with:
   - Runtime: Node
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Health check path: `/healthz`
3. Render sets `PORT` automatically. Open the `.onrender.com` URL and share room codes as usual.

Rooms live in memory, so run a single instance (or add sticky sessions plus a shared Socket.IO adapter if you scale out). On Render's free plan the service sleeps when idle and restarting clears any open rooms.

### Tests and checks

```bash
npm test             # Vitest: maze randomness/fairness, NPC pathfinding, negotiation, engine, sockets
npm run typecheck    # tsc --noEmit over client, server, shared and tests
```

## Controls

Moves are **relative to the character** (and the camera): one cell per press, ~150 ms animation, one extra press buffered.

| | Desktop | Mobile |
| --- | --- | --- |
| Step forward | ↑ or W | D-pad ▲ |
| Turn 90° left and step | ← or A | D-pad ◀ |
| Turn 90° right and step | → or D | D-pad ▶ |
| Turn around and step | ↓ or S | D-pad ▼ |
| Shoot | Space | FIRE (bottom-right) |
| Enlarge map | M | Tap the minimap |

Into a wall you only turn (so you can still aim). The camera swings to the new facing after each turn. Multi-touch is safe: you can hold Fire and a D-pad button at the same time. Page scroll and pinch-zoom are blocked while playing.

## Rules at a glance

- 10 HP each, ₹100 starting cash (change `CURRENCY` in [`shared/constants.ts`](shared/constants.ts)), ₹5–20 cash pickups in mirrored pairs.
- Shots fly along corridors, stop at walls, cost 1 HP per hit; 400 ms cooldown, unlimited ammo. You see a muzzle flash and a tracer.
- The minimap is rotated so “up” is the way you are facing. Explored cells stay bright (fog of war). The opponent appears on it only within 5 cells. Tap (or press M) to enlarge.
- Every game and rematch gets a **fresh crypto-random seed**. The result screen shows it so a maze can be reproduced.
- Each player has their own 4 NPCs (one per role) who **patrol and chase**. They are invisible to the opponent and can each be met once. They spawn more than 6 cells from either start, never enter the goal, and move slower than you (Policeman ~600 ms/cell, Businessman ~800).
  - **Negotiate** in 3 steps against a hidden price (±5% random wobble). Replies: *Not enough* (close), *Too much to ask* (way off). An offer under 40% of the price costs an extra step. On success you pay your whole offer (overpaying is wasted); on failure you keep your cash but take the penalty. Cash stacks fly to the NPC on Offer.
  - **Kill:** a short gunfire cinematic (draw, 4 shots, muzzle flash, camera shake). −2 HP (−3 HP for a Policeman, and the opponent is alerted). Once per NPC type.
  - **Walk away:** −1 HP. Not allowed with the Policeman.

| NPC | Price range | Speed | Bribe success | Bribe failure |
| --- | --- | --- | --- | --- |
| MP | 55-85 | 700 ms/cell | Shortest path shown for 12 s + ₹50 | Frozen for 5 s |
| Businessman | 40-65 | 800 ms/cell | 30 s of 2× speed + 1.5× the bribe back | Scammed: lose 30% of cash |
| MLA | 28-45 | 750 ms/cell | 3-4 walls removed towards the centre | Fined 25% of cash |
| Policeman | 12-25 | 600 ms/cell | Pass + 1 HP | **Arrested: you lose instantly** |

**Win** by reaching the centre first, or when the opponent dies, is arrested, or disconnects for more than 10 seconds. **Rematch** keeps the room and generates a new maze (new seed).

All tunable numbers live in [`shared/constants.ts`](shared/constants.ts).

## Architecture

```
shared/            Code and types used by both sides
  protocol.ts      Socket.IO event map + every message type
  maze.ts          Grid/wall bitmasks, BFS, line of sight, relative directions
  constants.ts     Game balance, currency symbol, NPC speeds
server/
  app.ts           Express + Socket.IO on one HTTP server, static hosting, /healthz
  index.ts         Production entry (serves dist/client)
  dev.ts           Dev entry (mounts Vite as middleware for HMR on the same port)
  rooms.ts         Networking: rooms, lobby, countdown, reconnect grace, rematch, rate limit
  game.ts          Authoritative engine: movement, projectiles, cash, NPCs, rewards, win conditions
  npcAi.ts         Patrol / chase / intercept (BFS, never enters the goal)
  maze.ts          Recursive backtracker + loop carving + fairness check
  negotiation.ts   Pure 3-step bribe logic (seeded RNG, unit tested)
  npcText.ts       One line of flavour text per step
  rng.ts           Seeded PRNG + crypto-random seed per game
  sanitize.ts      Display name / room code sanitising
client/src/
  main.ts          App state, socket wiring, render loop
  net.ts           Socket.IO client + session token storage
  input.ts         Relative keyboard + full D-pad, Fire, gesture blocking
  three/world.ts   Third-person scene, camera, interpolation, kill cinematic
  three/maze3d.ts  Instanced walls, goal beacon, cash pickups, MP path, MLA sink
  three/humanoid.ts Procedural low-poly characters (players + four NPC outfits)
  three/fx.ts      Muzzle flash, tracers, PvP bullets, sparks
  three/common.ts  Shared geometries/materials, labels, world units
  render/minimap.ts Rotating fog-of-war minimap
  render/tween.ts  Smooth cell-to-cell movement
  ui/              HUD, cash-stack bribe dialogue, lobby/result screens
  audio.ts         WebAudio sound effects (no asset files)
tests/             Vitest suites
scripts/bot.ts     Headless test opponent
```

The 3D scene is a visual layer only: the server still owns the grid. Clients interpolate between cell positions (~150 ms) and never decide hits, cash or NPC outcomes.

### How a game runs

1. **Lobby.** `room:create` / `room:join` return a seat token (kept in `sessionStorage`, so each tab is a separate player). The server broadcasts `lobby:state` whenever names, ready flags or connections change.
2. **Start.** When both players are ready, the server picks a **crypto-random seed** and generates a maze. If the start-to-centre shortest paths differ by more than 10%, it regenerates. It then places NPCs along each player's likely route (more than 6 cells from both starts) and mirrored cash pairs, sends `game:init` (maze + your slot + seed), and counts down with `game:countdown` 3, 2, 1, 0.
3. **Play.** Clients send only `input:move` (relative: `forward` / `left` / `right` / `back`), `input:shoot`, `npc:action` and `npc:offer`. The engine validates everything (walls, cooldowns, freezes, cinematics, open dialogues, cash balances). It ticks every 50 ms (NPCs step on their own clocks) and sends each player a personalised `game:state`: your full status, the opponent's HP, their position only when nearby or in line of sight, only your own NPCs, and your open encounter (never the hidden price).
4. **Events.** `game:fx` drives sounds, muzzle flashes and the kill cinematic, `game:notify` feeds the notification list, `npc:result` reports encounter outcomes, `maze:update` broadcasts MLA shortcuts (3D walls sink, minimap updates), and `game:over` carries the winner, reason, both players' stats **and the seed**.
5. **Disconnects.** A dropped socket starts a 10-second grace timer. Reconnecting (including a page reload) sends `room:resume` with the token, and the server re-sends `game:init` and current state. If the timer expires, that player forfeits.

### Socket protocol

| Direction | Event | Payload |
| --- | --- | --- |
| C → S | `room:create` | `{ name }` → ack `{ ok, code, slot, token }` |
| C → S | `room:join` | `{ name, code }` → ack (same shape, or `{ ok: false, error }`) |
| C → S | `room:resume` | `{ token }` → ack `{ ok }` |
| C → S | `room:leave`, `game:rematch` | none |
| C → S | `lobby:ready` | `boolean` |
| C → S | `input:move` | `'forward' \| 'back' \| 'left' \| 'right'` (relative to facing) |
| C → S | `input:shoot` | none |
| C → S | `npc:action` | `'negotiate' \| 'kill' \| 'walk'` |
| C → S | `npc:offer` | `number` (clamped to your cash) |
| S → C | `lobby:state` | `LobbyState` |
| S → C | `game:init` | `{ maze, you, names, seed }` |
| S → C | `game:countdown` | `3 \| 2 \| 1 \| 0` |
| S → C | `game:state` | `StateMsg` (per player, about 20 Hz) |
| S → C | `maze:update` | `number[]` wall bitmasks |
| S → C | `game:fx` / `game:notify` / `npc:result` | effects, feed messages, encounter outcomes |
| S → C | `game:over` | `{ winner, reason, detail, names, stats, seed }` |

Full types: [`shared/protocol.ts`](shared/protocol.ts).
