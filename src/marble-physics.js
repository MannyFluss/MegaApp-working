export const WIDTH = 960;
export const HEIGHT = 640;
export const MARBLE_RADIUS = 8;
export const RAIL_RADIUS = 6.5;
export const MAX_MARBLES = 32;
export const MAX_TRACKS = 32;
export const MAX_POINTS_PER_TRACK = 128;
export const MAX_TOTAL_POINTS = 2048;
export const MAX_EMITTERS = 4;
export const MAX_SPEED = 1200;

const MAX_SUBSTEP = 1 / 240;
const MAX_FRAME_DT = 0.25;
const CELL_SIZE = 64;
const RESTITUTION = 0.42;
const MIN_SOUND_IMPACT = 35;
const MIN_BOUNCE_IMPACT = 24;
const SOUND_COOLDOWN = 0.14;
const CONTACT_RELEASE_TIME = 0.06;
const POSITION_SLOP = 0.001;
const CONTACT_MARGIN = 0.5;
const SLEEP_LIMIT = 6;
const MAX_AGE = 45;

function freezeScene(scene) {
  for (const track of scene.tracks) {
    track.points.forEach(Object.freeze);
    Object.freeze(track.points);
    Object.freeze(track);
  }
  scene.emitters.forEach(Object.freeze);
  Object.freeze(scene.tracks);
  Object.freeze(scene.emitters);
  return Object.freeze(scene);
}

export const DEMO_SCENE = freezeScene({
  version: 1,
  tracks: [
    {
      id: "first-light",
      note: 0,
      points: [
        { x: 120, y: 140 },
        { x: 390, y: 158 },
        { x: 470, y: 177 },
      ],
    },
    {
      id: "answer",
      note: 2,
      points: [
        { x: 390, y: 244 },
        { x: 690, y: 214 },
      ],
    },
    {
      id: "little-river",
      note: 4,
      points: [
        { x: 230, y: 302 },
        { x: 455, y: 329 },
        { x: 535, y: 341 },
      ],
    },
    {
      id: "turnaround",
      note: 5,
      points: [
        { x: 475, y: 415 },
        { x: 775, y: 372 },
      ],
    },
    {
      id: "downstream",
      note: 3,
      points: [
        { x: 330, y: 459 },
        { x: 550, y: 482 },
        { x: 650, y: 491 },
      ],
    },
    {
      id: "last-song",
      note: 7,
      points: [
        { x: 560, y: 567 },
        { x: 850, y: 534 },
      ],
    },
    {
      id: "high-harmony",
      note: 6,
      points: [
        { x: 685, y: 142 },
        { x: 835, y: 178 },
      ],
    },
    {
      id: "side-note",
      note: 1,
      points: [
        { x: 720, y: 282 },
        { x: 885, y: 305 },
      ],
    },
  ],
  emitters: [
    { x: 180, y: 55 },
    { x: 725, y: 65 },
  ],
  gravity: 480,
  volume: 0.28,
});

function record(value, fields, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error(`${name} must be a plain object.`);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key))
  )
    throw new Error(`${name} has missing or unexpected fields.`);
  for (const field of fields) {
    const property = Object.getOwnPropertyDescriptor(value, field);
    if (!property || !("value" in property))
      throw new Error(`${name}.${field} must be a stored value.`);
  }
  return value;
}

function number(value, minimum, maximum, name) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    throw new Error(`${name} must be a number from ${minimum} to ${maximum}.`);
  return value;
}

function list(value, maximum, name, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    throw new Error(`${name} must contain ${minimum} to ${maximum} items.`);
  if (
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw new Error(`${name} must be a plain, dense array.`);
  const items = [];
  for (let i = 0; i < value.length; i++) {
    const property = Object.getOwnPropertyDescriptor(value, i);
    if (!property || !("value" in property))
      throw new Error(`${name} must be a plain, dense array.`);
    items.push(property.value);
  }
  return items;
}

function position(value, name) {
  record(value, ["x", "y"], name);
  return {
    x: number(value.x, 0, WIDTH, `${name}.x`),
    y: number(value.y, 0, HEIGHT, `${name}.y`),
  };
}

export function validateScene(input) {
  record(
    input,
    ["version", "tracks", "emitters", "gravity", "volume"],
    "Scene",
  );
  if (input.version !== 1)
    throw new Error("This scene version is not supported.");
  const ids = new Set();
  let totalPoints = 0;
  const tracks = list(input.tracks, MAX_TRACKS, "Tracks").map(
    (track, index) => {
      const name = `Track ${index + 1}`;
      record(track, ["id", "points", "note"], name);
      if (
        typeof track.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(track.id) ||
        ids.has(track.id)
      )
        throw new Error(
          `${name} needs a unique id of 1 to 64 letters, digits, underscores, or hyphens.`,
        );
      ids.add(track.id);
      if (!Number.isInteger(track.note) || track.note < 0 || track.note > 7)
        throw new Error(`${name}.note must be an integer from 0 to 7.`);
      const points = list(
        track.points,
        MAX_POINTS_PER_TRACK,
        `${name} points`,
        2,
      ).map((point, i) => position(point, `${name} point ${i + 1}`));
      totalPoints += points.length;
      if (totalPoints > MAX_TOTAL_POINTS)
        throw new Error(
          `A scene may contain at most ${MAX_TOTAL_POINTS} total track points.`,
        );
      if (
        !points.some(
          (point, i) =>
            i && (point.x !== points[i - 1].x || point.y !== points[i - 1].y),
        )
      )
        throw new Error(`${name} needs at least two distinct adjacent points.`);
      return { id: track.id, points, note: track.note };
    },
  );
  return {
    version: 1,
    tracks,
    emitters: list(input.emitters, MAX_EMITTERS, "Emitters").map((emitter, i) =>
      position(emitter, `Emitter ${i + 1}`),
    ),
    gravity: number(input.gravity, 100, 1200, "Gravity"),
    volume: number(input.volume, 0, 1, "Volume"),
  };
}

function segmentGrid(tracks) {
  const grid = new Map();
  for (const track of tracks) {
    for (let i = 1; i < track.points.length; i++) {
      const a = track.points[i - 1],
        b = track.points[i];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      if (!lengthSquared) continue;
      const segment = {
        a,
        b,
        dx,
        dy,
        lengthSquared,
        trackId: track.id,
        note: track.note,
      };
      const margin = MARBLE_RADIUS + RAIL_RADIUS + CONTACT_MARGIN;
      const x0 = Math.floor((Math.min(a.x, b.x) - margin) / CELL_SIZE);
      const x1 = Math.floor((Math.max(a.x, b.x) + margin) / CELL_SIZE);
      const y0 = Math.floor((Math.min(a.y, b.y) - margin) / CELL_SIZE);
      const y1 = Math.floor((Math.max(a.y, b.y) + margin) / CELL_SIZE);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(segment);
        }
    }
  }
  return grid;
}

export function createWorld(scene) {
  const validated = validateScene(scene);
  return {
    ...validated,
    marbles: [],
    time: 0,
    nextMarbleId: 1,
    grid: segmentGrid(validated.tracks),
  };
}

function limitSpeed(marble) {
  const speed = Math.hypot(marble.vx, marble.vy);
  if (speed > MAX_SPEED) {
    marble.vx *= MAX_SPEED / speed;
    marble.vy *= MAX_SPEED / speed;
  }
}

export function addMarble(world, x, y, { vx = 0, vy = 0 } = {}) {
  if (world.marbles.length >= MAX_MARBLES) return null;
  if (
    ![x, y, vx, vy].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  )
    return null;
  const marble = {
    id: world.nextMarbleId++,
    x: Math.max(MARBLE_RADIUS, Math.min(WIDTH - MARBLE_RADIUS, x)),
    y: Math.max(MARBLE_RADIUS, Math.min(HEIGHT, y)),
    vx,
    vy,
    radius: MARBLE_RADIUS,
    age: 0,
    sleepTime: 0,
    contacts: new Map(),
  };
  limitSpeed(marble);
  world.marbles.push(marble);
  return marble;
}

function walls(marble) {
  if (marble.x < marble.radius) {
    marble.x = marble.radius;
    marble.vx = Math.abs(marble.vx) * RESTITUTION;
  } else if (marble.x > WIDTH - marble.radius) {
    marble.x = WIDTH - marble.radius;
    marble.vx = -Math.abs(marble.vx) * RESTITUTION;
  }
  if (marble.y < marble.radius) {
    marble.y = marble.radius;
    marble.vy = Math.abs(marble.vy) * RESTITUTION;
  }
}

function collide(world, marble, segment, previous, seen, hits) {
  const t = Math.max(
    0,
    Math.min(
      1,
      ((marble.x - segment.a.x) * segment.dx +
        (marble.y - segment.a.y) * segment.dy) /
        segment.lengthSquared,
    ),
  );
  const x = segment.a.x + segment.dx * t;
  const y = segment.a.y + segment.dy * t;
  const dx = marble.x - x,
    dy = marble.y - y;
  const distance = Math.hypot(dx, dy);
  const collisionRadius = marble.radius + RAIL_RADIUS;
  if (distance > collisionRadius + CONTACT_MARGIN) return;
  seen.add(segment.trackId);
  let contact = marble.contacts.get(segment.trackId);
  if (!contact) {
    contact = { armed: true, absentFor: 0, lastHit: -Infinity };
    marble.contacts.set(segment.trackId, contact);
  }
  if (distance >= collisionRadius) return;

  let nx, ny;
  if (distance > 1e-9) {
    nx = dx / distance;
    ny = dy / distance;
  } else {
    // An exactly overlapping center has no radial direction. Use the previous
    // side of the rail, falling back to the side opposing current motion.
    const length = Math.sqrt(segment.lengthSquared);
    nx = -segment.dy / length;
    ny = segment.dx / length;
    const oldSide = (previous.x - x) * nx + (previous.y - y) * ny;
    const motion = marble.vx * nx + marble.vy * ny;
    if (oldSide < 0 || (Math.abs(oldSide) < 1e-9 && motion > 0)) {
      nx = -nx;
      ny = -ny;
    }
  }
  marble.x += nx * (collisionRadius - distance + POSITION_SLOP);
  marble.y += ny * (collisionRadius - distance + POSITION_SLOP);
  const normalSpeed = marble.vx * nx + marble.vy * ny;
  if (normalSpeed >= 0) return;
  const impact = -normalSpeed;
  if (
    impact >= MIN_SOUND_IMPACT &&
    contact.armed &&
    world.time - contact.lastHit >= SOUND_COOLDOWN
  ) {
    hits.push({
      x,
      y,
      note: segment.note,
      impact,
      trackId: segment.trackId,
      marbleId: marble.id,
    });
    contact.lastHit = world.time;
    contact.armed = false;
  }
  const bounce = impact >= MIN_BOUNCE_IMPACT ? RESTITUTION : 0;
  const tangentX = marble.vx - normalSpeed * nx;
  const tangentY = marble.vy - normalSpeed * ny;
  marble.vx = tangentX * 0.997 + impact * bounce * nx;
  marble.vy = tangentY * 0.997 + impact * bounce * ny;
}

export function stepWorld(world, dt, gravity = world.gravity) {
  const hits = [];
  if (typeof dt !== "number" || !Number.isFinite(dt) || dt <= 0) return hits;
  const elapsed = Math.min(dt, MAX_FRAME_DT);
  const steps = Math.ceil(elapsed / MAX_SUBSTEP);
  const h = elapsed / steps;
  const selectedGravity = Number.isFinite(gravity)
    ? gravity
    : Number.isFinite(world.gravity)
      ? world.gravity
      : 480;
  const acceleration = Math.max(0, Math.min(1200, selectedGravity));
  for (let step = 0; step < steps; step++) {
    world.time += h;
    for (const marble of world.marbles) {
      const previous = { x: marble.x, y: marble.y };
      marble.age += h;
      marble.vy += acceleration * h;
      limitSpeed(marble);
      marble.x += marble.vx * h;
      marble.y += marble.vy * h;
      walls(marble);
      const seen = new Set();
      // Three passes resolve corners and nearby rails. At the speed cap each
      // substep moves at most five pixels, below the circle's diameter.
      for (let pass = 0; pass < 3; pass++) {
        const key = `${Math.floor(marble.x / CELL_SIZE)},${Math.floor(marble.y / CELL_SIZE)}`;
        for (const segment of world.grid.get(key) || [])
          collide(world, marble, segment, previous, seen, hits);
      }
      walls(marble);
      limitSpeed(marble);
      for (const [id, contact] of marble.contacts) {
        if (seen.has(id)) contact.absentFor = 0;
        else {
          contact.absentFor += h;
          if (contact.absentFor >= CONTACT_RELEASE_TIME) contact.armed = true;
        }
      }
      if (seen.size && Math.hypot(marble.vx, marble.vy) < 12)
        marble.sleepTime += h;
      else marble.sleepTime = 0;
    }
    world.marbles = world.marbles.filter(
      (marble) =>
        marble.y <= HEIGHT + marble.radius &&
        marble.age < MAX_AGE &&
        marble.sleepTime < SLEEP_LIMIT,
    );
  }
  return hits;
}
