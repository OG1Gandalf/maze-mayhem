# Maze Mayhem

A two-player online maze race for desktop and mobile browsers. Race to the glowing centre of a 21×21 maze, shoot your rival, collect coins, and deal with corrupt NPCs (MP, MLA, Businessman, Policeman) by bribing, killing or walking away.

- **Frontend:** Vite + TypeScript, HTML5 Canvas, plain CSS
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

`PORT` (default `3000`) and `HOST` (default `0.0.0.0`) are read from the environment. `GET /healthz` returns `{ ok, rooms }` for platform health checks. The client connects to Socket.IO on the same origin, so no URL needs configuring.

### Deploy on Render

Build-time tools (Vite, esbuild, TypeScript) are in `dependencies`, so the build works even when Render skips devDependencies.

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
npm test             # Vitest: maze, negotiation, game engine, socket integration
npm run typecheck    # tsc --noEmit over client, server, shared and tests
```

## Controls

| | Desktop | Mobile |
| --- | --- | --- |
| Move / turn | Arrow keys (one cell per press) | ▲ / ▼ buttons (bottom-left); tap the left or right half of the screen for left/right |
| Shoot | Space | FIRE button (bottom-right) |
| Dialogues | Tab / Shift+Tab, Enter, arrow keys on the offer slider | Large buttons + slider |

Pressing a direction into a wall turns you without moving, so you can aim. One extra press made during the 120 ms move animation is buffered.

## Rules at a glance

- 10 HP each, 100 starting coins, 5-20 coin pickups scattered around (placed in mirrored pairs for fairness).
- Shots fly along corridors, stop at walls, cost 1 HP per hit; 400 ms cooldown, unlimited ammo.
- The minimap shows the whole maze, you and the goal. The opponent shows up (on the minimap and in your view) only within 5 cells; the server doesn't send their position otherwise.
- Each player has their own 4 NPCs (one per role) along their route. They're invisible to the opponent and can each be met once.
  - **Negotiate** in 3 steps against a hidden price (±5% random wobble). Replies: *Not enough* (close), *Too much to ask* (way off). An offer under 40% of the price costs an extra step. On success you pay your whole offer (overpaying is wasted); on failure you keep your coins but take the penalty.
  - **Kill:** −2 HP (−3 HP for a Policeman, and the opponent is alerted). Once per NPC type.
  - **Walk away:** −1 HP. Not allowed with the Policeman.

| NPC | Price range | Bribe success | Bribe failure |
| --- | --- | --- | --- |
| MP | 55-85 | Shortest path shown for 12 s + 50 coins | Frozen for 5 s |
| Businessman | 40-65 | 30 s of 2× speed + 1.5× the bribe back | Scammed: lose 30% of coins |
| MLA | 28-45 | 3-4 walls removed towards the centre | Fined 25% of coins |
| Policeman | 12-25 | Pass + 1 HP | **Arrested: you lose instantly** |

**Win** by reaching the centre first, or when the opponent dies, is arrested, or disconnects for more than 10 seconds. **Rematch** keeps the room and generates a new maze.

All tunable numbers live in [`shared/constants.ts`](shared/constants.ts).

## Architecture

```
shared/            Code and types used by both sides
  protocol.ts      Socket.IO event map + every message type
  maze.ts          Grid/wall bitmasks, BFS distances, shortest path
  constants.ts     Game balance and tuning
server/
  app.ts           Express + Socket.IO on one HTTP server, static hosting, /healthz
  index.ts         Production entry (serves dist/client)
  dev.ts           Dev entry (mounts Vite as middleware for HMR on the same port)
  rooms.ts         Networking: rooms, lobby, ready/countdown, reconnect grace, rematch
  game.ts          Authoritative engine: movement, projectiles, coins, NPCs, rewards, win conditions
  maze.ts          Recursive backtracker + loop carving + fairness check
  negotiation.ts   Pure 3-step bribe logic (seeded RNG, unit tested)
  npcText.ts       One line of flavour text per step
  rng.ts           Seeded PRNG (mulberry32)
  sanitize.ts      Display name / room code sanitising
client/src/
  main.ts          App state, socket wiring, render loop
  net.ts           Socket.IO client + session token storage
  input.ts         Keyboard, touch zones, on-screen buttons, gesture blocking
  render/pov.ts    Player-centred camera (about 9×9 cells), walls, avatars, shots, coins, NPCs
  render/minimap.ts Whole-maze overview
  render/tween.ts  Smooth cell-to-cell movement
  ui/              HUD, NPC dialogue, lobby/result screens
  audio.ts         WebAudio sound effects (no asset files)
tests/             Vitest suites
scripts/bot.ts     Headless test opponent
```

### How a game runs

1. **Lobby.** `room:create` / `room:join` return a seat token (kept in `sessionStorage`, so each tab is a separate player). The server broadcasts `lobby:state` whenever names, ready flags or connections change.
2. **Start.** When both players are ready, the server picks a random seed and generates a maze. If the start-to-centre shortest paths differ by more than 10%, it regenerates. It then places NPCs along each player's shortest route and coin pairs, sends `game:init` (maze + your slot), and counts down with `game:countdown` 3, 2, 1, 0.
3. **Play.** Clients send only `input:move`, `input:shoot`, `npc:action` and `npc:offer`. The engine validates everything (walls, cooldowns, freezes, open dialogues, coin balances). It ticks every 50 ms and sends each player a personalised `game:state`: your full status, the opponent's HP, their position only when within 5 cells, only your own NPCs, and your open encounter (never the hidden price). Moves also trigger an immediate state push so movement feels instant.
4. **Events.** `game:fx` drives sounds and hit flashes, `game:notify` feeds the notification list, `npc:result` reports encounter outcomes, `maze:update` broadcasts MLA shortcuts, and `game:over` carries the winner, reason and both players' stats.
5. **Disconnects.** A dropped socket starts a 10-second grace timer. Reconnecting (including a page reload) sends `room:resume` with the token, and the server re-sends `game:init` and current state. If the timer expires, that player forfeits.

### Socket protocol

| Direction | Event | Payload |
| --- | --- | --- |
| C → S | `room:create` | `{ name }` → ack `{ ok, code, slot, token }` |
| C → S | `room:join` | `{ name, code }` → ack (same shape, or `{ ok: false, error }`) |
| C → S | `room:resume` | `{ token }` → ack `{ ok }` |
| C → S | `room:leave`, `game:rematch` | none |
| C → S | `lobby:ready` | `boolean` |
| C → S | `input:move` | `'up' \| 'down' \| 'left' \| 'right'` |
| C → S | `input:shoot` | none |
| C → S | `npc:action` | `'negotiate' \| 'kill' \| 'walk'` |
| C → S | `npc:offer` | `number` (clamped to your coins) |
| S → C | `lobby:state` | `LobbyState` |
| S → C | `game:init` | `{ maze, you, names }` |
| S → C | `game:countdown` | `3 \| 2 \| 1 \| 0` |
| S → C | `game:state` | `StateMsg` (per player, about 20 Hz) |
| S → C | `maze:update` | `number[]` wall bitmasks |
| S → C | `game:fx` / `game:notify` / `npc:result` | effects, feed messages, encounter outcomes |
| S → C | `game:over` | `{ winner, reason, detail, names, stats }` |

Full types: [`shared/protocol.ts`](shared/protocol.ts).
