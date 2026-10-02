export const VIEW_WIDTH = 960;
export const VIEW_HEIGHT = 540;
export const TILE = 48;
export const RUN_SPEED = 290;
export const JUMP_SPEED = 570;
export const GRAVITY = 1500;

const PLAYER_WIDTH = 30;
const PLAYER_HEIGHT = 42;
const MAX_FALL_SPEED = 900;
const MAX_SUBSTEP = 1 / 120;
const MAX_FRAME_DT = 0.15;
const COYOTE_TIME = 0.1;
const JUMP_BUFFER_TIME = 0.13;
const JUMP_RELEASE_SPEED = 320;
const INVINCIBLE_TIME = 1.5;

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

const rect = (id, type, x, y, w, h) => ({ id, type, x, y, w, h });
const coinPositions = [
  [260, 384],
  [575, 310],
  [780, 260],
  [850, 370],
  [945, 326],
  [1070, 374],
  [1240, 384],
  [1490, 322],
  [1640, 276],
  [1815, 324],
  [1920, 326],
  [2035, 374],
  [2250, 374],
  [2520, 308],
  [2750, 260],
  [2915, 326],
  [3160, 304],
  [3595, 374],
  [3700, 326],
  [4050, 374],
];

/** Coordinates are logical pixels; x/y are top-left for rectangles, centers for coins. */
export const LEVEL = freeze({
  worldWidth: 4320,
  floorY: 432,
  spawn: { x: 96, y: 390 },
  ground: [
    rect("ground-1", "ground", 0, 432, 900, 108),
    rect("ground-2", "ground", 990, 432, 880, 108),
    rect("ground-3", "ground", 1970, 432, 900, 108),
    rect("ground-4", "ground", 2960, 432, 700, 108),
    rect("ground-5", "ground", 3740, 432, 580, 108),
  ],
  platforms: [
    rect("step-1", "platform", 500, 348, 192, 24),
    rect("step-2", "platform", 720, 300, 144, 24),
    rect("step-3", "platform", 1370, 360, 144, 24),
    rect("step-4", "platform", 1560, 312, 144, 24),
    rect("step-5", "platform", 1740, 360, 120, 24),
    rect("step-6", "platform", 2420, 348, 192, 24),
    rect("step-7", "platform", 2660, 300, 144, 24),
    rect("bonus-step", "platform", 3100, 348, 192, 24),
  ],
  blocks: [
    rect("brick-1", "brick", 288, 288, TILE, TILE),
    rect("question-1", "question", 336, 288, TILE, TILE),
    rect("brick-2", "brick", 384, 288, TILE, TILE),
    rect("question-2", "question", 1180, 288, TILE, TILE),
    rect("question-3", "question", 2330, 288, TILE, TILE),
    rect("question-4", "question", 3408, 288, TILE, TILE),
  ],
  coins: coinPositions.map(([x, y], i) => ({
    id: `coin-${i + 1}`,
    x,
    y,
    radius: 10,
  })),
  enemies: [
    {
      id: "blob-1",
      x: 520,
      y: 400,
      w: 38,
      h: 32,
      minX: 480,
      maxX: 740,
      speed: 54,
      direction: 1,
    },
    {
      id: "blob-2",
      x: 1420,
      y: 400,
      w: 38,
      h: 32,
      minX: 1280,
      maxX: 1570,
      speed: 62,
      direction: -1,
    },
    {
      id: "blob-3",
      x: 2500,
      y: 400,
      w: 38,
      h: 32,
      minX: 2360,
      maxX: 2690,
      speed: 58,
      direction: 1,
    },
    {
      id: "blob-4",
      x: 3910,
      y: 400,
      w: 38,
      h: 32,
      minX: 3800,
      maxX: 4020,
      speed: 64,
      direction: -1,
    },
  ],
  checkpoint: { x: 2160, y: 288, w: 24, h: 144, spawnX: 2200 },
  goal: { x: 4180, y: 240, w: 24, h: 192 },
});

const clone = (value) => structuredClone(value);
const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));
const overlaps = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const approach = (value, target, amount) =>
  value < target
    ? Math.min(target, value + amount)
    : Math.max(target, value - amount);

/**
 * The controller owns phase (ready/playing/paused); the engine sets won/gameover.
 * Entity arrays are mutable runtime copies. Collected coins and defeated enemies
 * remain in their arrays with collected/alive flags for simple rendering.
 */
export function createGame() {
  return {
    phase: "ready",
    worldWidth: LEVEL.worldWidth,
    floorY: LEVEL.floorY,
    player: {
      ...LEVEL.spawn,
      w: PLAYER_WIDTH,
      h: PLAYER_HEIGHT,
      vx: 0,
      vy: 0,
      grounded: true,
      facing: 1,
      invincible: 0,
    },
    solids: [
      ...clone(LEVEL.ground),
      ...clone(LEVEL.platforms),
      ...clone(LEVEL.blocks),
    ].map((solid) => ({ ...solid, used: false })),
    coins: clone(LEVEL.coins).map((coin) => ({ ...coin, collected: false })),
    enemies: clone(LEVEL.enemies).map((enemy) => ({ ...enemy, alive: true })),
    checkpoint: clone(LEVEL.checkpoint),
    goal: clone(LEVEL.goal),
    score: 0,
    coinCount: 0,
    lives: 3,
    deaths: 0,
    time: 0,
    cameraX: 0,
    checkpointActive: false,
    _jumpHeld: false,
    _jumpBuffer: 0,
    _coyote: COYOTE_TIME,
  };
}

export function restartGame(game) {
  Object.assign(game, createGame());
  return game;
}

function awardCoin(game, events, details) {
  game.coinCount++;
  game.score += 100;
  events.push({
    type: "coin",
    ...details,
    score: game.score,
    coinCount: game.coinCount,
  });
}

function jump(game, events) {
  // A tap may begin and end between animation frames, or finish while waiting
  // in the landing buffer. Its release must still shorten the eventual jump.
  game.player.vy = game._jumpHeld ? -JUMP_SPEED : -JUMP_RELEASE_SPEED;
  game.player.grounded = false;
  game._jumpBuffer = 0;
  game._coyote = 0;
  events.push({
    type: "jump",
    x: game.player.x + game.player.w / 2,
    y: game.player.y + game.player.h,
  });
}

function hurt(game, events, reason) {
  const player = game.player;
  game.lives--;
  game.deaths++;
  events.push({
    type: "hurt",
    reason,
    x: player.x + player.w / 2,
    y: player.y + player.h / 2,
    lives: game.lives,
  });
  if (game.lives <= 0) {
    game.lives = 0;
    game.phase = "gameover";
    player.vx = 0;
    player.vy = 0;
    return;
  }
  Object.assign(player, {
    x: game.checkpointActive ? game.checkpoint.spawnX : LEVEL.spawn.x,
    y: LEVEL.spawn.y,
    vx: 0,
    vy: 0,
    grounded: true,
    facing: 1,
    invincible: INVINCIBLE_TIME,
  });
  game._jumpBuffer = 0;
  game._coyote = COYOTE_TIME;
  game.cameraX = clamp(
    player.x - VIEW_WIDTH * 0.38,
    0,
    game.worldWidth - VIEW_WIDTH,
  );
}

function movePlayer(game, h, direction, events) {
  const player = game.player;
  const previous = { x: player.x, y: player.y };
  const acceleration = direction
    ? player.grounded
      ? 2100
      : 1800
    : player.grounded
      ? 2600
      : 800;
  player.vx = approach(player.vx, direction * RUN_SPEED, acceleration * h);
  if (direction) player.facing = direction;
  player.vy = Math.min(MAX_FALL_SPEED, player.vy + GRAVITY * h);

  player.x = clamp(player.x + player.vx * h, 0, game.worldWidth - player.w);
  for (const solid of game.solids) {
    if (!overlaps(player, solid)) continue;
    if (player.vx > 0 && previous.x + player.w <= solid.x + 0.01) {
      player.x = solid.x - player.w;
      player.vx = 0;
    } else if (player.vx < 0 && previous.x >= solid.x + solid.w - 0.01) {
      player.x = solid.x + solid.w;
      player.vx = 0;
    }
  }

  player.y += player.vy * h;
  player.grounded = false;
  for (const solid of game.solids) {
    if (!overlaps(player, solid)) continue;
    if (player.vy >= 0 && previous.y + player.h <= solid.y + 0.01) {
      player.y = solid.y - player.h;
      player.vy = 0;
      player.grounded = true;
    } else if (player.vy < 0 && previous.y >= solid.y + solid.h - 0.01) {
      player.y = solid.y + solid.h;
      player.vy = 0;
      if (solid.type === "question" && !solid.used) {
        solid.used = true;
        awardCoin(game, events, {
          source: "block",
          blockId: solid.id,
          x: solid.x + solid.w / 2,
          y: solid.y - 16,
        });
      }
    }
  }
  if (player.y < -120) {
    player.y = -120;
    player.vy = Math.max(0, player.vy);
  }
  return previous;
}

function collect(game, events) {
  const player = game.player;
  for (const coin of game.coins) {
    if (coin.collected) continue;
    const nearestX = clamp(coin.x, player.x, player.x + player.w);
    const nearestY = clamp(coin.y, player.y, player.y + player.h);
    if (
      (coin.x - nearestX) ** 2 + (coin.y - nearestY) ** 2 <=
      coin.radius ** 2
    ) {
      coin.collected = true;
      awardCoin(game, events, {
        source: "coin",
        coinId: coin.id,
        x: coin.x,
        y: coin.y,
      });
    }
  }
}

function updateEnemies(game, h, previous, events) {
  const player = game.player;
  for (const enemy of game.enemies) {
    if (!enemy.alive) continue;
    enemy.x += enemy.direction * enemy.speed * h;
    if (enemy.x <= enemy.minX) {
      enemy.x = enemy.minX;
      enemy.direction = 1;
    }
    if (enemy.x >= enemy.maxX) {
      enemy.x = enemy.maxX;
      enemy.direction = -1;
    }
    if (!overlaps(player, enemy)) continue;
    if (player.vy > 0 && previous.y + player.h <= enemy.y + 2) {
      enemy.alive = false;
      player.y = enemy.y - player.h;
      player.vy = -360;
      player.grounded = false;
      game.score += 200;
      events.push({
        type: "stomp",
        enemyId: enemy.id,
        x: enemy.x + enemy.w / 2,
        y: enemy.y,
        score: game.score,
      });
    } else if (player.invincible <= 0) {
      hurt(game, events, "enemy");
      return;
    }
  }
}

function followCamera(game, h) {
  const target = clamp(
    game.player.x + game.player.w / 2 - VIEW_WIDTH * 0.38,
    0,
    game.worldWidth - VIEW_WIDTH,
  );
  game.cameraX = clamp(
    game.cameraX + (target - game.cameraX) * Math.min(1, h * 9),
    0,
    game.worldWidth - VIEW_WIDTH,
  );
}

/**
 * dt is seconds. Inputs accept left/right plus jump (or jumpHeld), with optional
 * one-frame jumpPressed/jumpReleased. Held jump uses internal edges and never
 * automatically repeats on landing. Returns gameplay events for UI/audio.
 */
export function stepGame(game, input = {}, dt = 0) {
  const events = [];
  if (game.phase !== "playing") return events;
  const held = Boolean(input.jump ?? input.jumpHeld);
  const pressed = input.jumpPressed === true || (held && !game._jumpHeld);
  const released = input.jumpReleased === true || (!held && game._jumpHeld);
  game._jumpHeld = held;
  if (pressed) game._jumpBuffer = JUMP_BUFFER_TIME;
  if (released && game.player.vy < -JUMP_RELEASE_SPEED)
    game.player.vy = -JUMP_RELEASE_SPEED;
  if (typeof dt !== "number" || !Number.isFinite(dt) || dt <= 0) return events;
  const elapsed = Math.min(dt, MAX_FRAME_DT);
  const count = Math.ceil(elapsed / MAX_SUBSTEP);
  const h = elapsed / count;
  const direction = Number(Boolean(input.right)) - Number(Boolean(input.left));
  for (let i = 0; i < count && game.phase === "playing"; i++) {
    game.time += h;
    game.player.invincible = Math.max(0, game.player.invincible - h);
    if (game.player.grounded) game._coyote = COYOTE_TIME;
    else game._coyote = Math.max(0, game._coyote - h);
    if (game._jumpBuffer > 0 && game._coyote > 0) jump(game, events);
    game._jumpBuffer = Math.max(0, game._jumpBuffer - h);
    const previous = movePlayer(game, h, direction, events);
    if (game.player.grounded && game._jumpBuffer > 0) jump(game, events);
    collect(game, events);
    updateEnemies(game, h, previous, events);
    if (game.player.y > VIEW_HEIGHT + 120) hurt(game, events, "fall");
    if (game.phase !== "playing") break;
    if (!game.checkpointActive && overlaps(game.player, game.checkpoint)) {
      game.checkpointActive = true;
      events.push({
        type: "checkpoint",
        x: game.checkpoint.x,
        y: game.checkpoint.y,
      });
    }
    if (overlaps(game.player, game.goal)) {
      game.phase = "won";
      game.player.vx = 0;
      events.push({
        type: "win",
        x: game.goal.x,
        y: game.goal.y,
        score: game.score,
        time: game.time,
      });
    }
    followCamera(game, h);
  }
  return events;
}
