export type Controls = {
  steer: number;
  throttle: number;
  brake: number;
  horn: number;
  start: number;
};

export type Collider = { x: number; z: number; radius: number };

export type CarState = {
  x: number;
  z: number;
  angle: number;
  speed: number;
  worldX: number;
  worldZ: number;
  heading: number;
};

export const TRACK_LENGTH = 520;

const PHYSICS = {
  acceleration: 24,
  braking: 16,
  rollingResistance: 0.18,
  maximumSpeed: 48.5,
  grassResistance: 1.6,
} as const;

/** 数値を指定範囲内に収める。 */
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

/** 角度から複雑な閉ループコースの中心座標を求める。 */
export function trackPoint(t: number) {
  const width = 62 + Math.sin(t * 3) * 10 + Math.cos(t * 5) * 5,
    depth = 76 + Math.sin(t * 2 + 0.7) * 9 - Math.cos(t * 4) * 4;
  return { x: Math.sin(t) * width, z: Math.cos(t) * depth };
}

/** コース距離から位置、接線、法線を含む走行姿勢を求める。 */
export function trackPose(distance: number) {
  const t =
    ((((distance % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH) /
      TRACK_LENGTH) *
    Math.PI *
    2;
  const point = trackPoint(t),
    before = trackPoint(t - 0.001),
    after = trackPoint(t + 0.001),
    rawX = after.x - before.x,
    rawZ = after.z - before.z,
    length = Math.hypot(rawX, rawZ);
  const tx = rawX / length,
    tz = rawZ / length;
  return { x: point.x, z: point.z, tx, tz, nx: -tz, nz: tx, t };
}

/** スタートラインに置かれた車の初期状態を生成する。 */
export function initialCar(): CarState {
  const start = trackPose(0);
  return {
    x: 0,
    z: 0,
    angle: 0,
    speed: 0,
    worldX: start.x,
    worldZ: start.z,
    heading: Math.atan2(start.tx, start.tz),
  };
}

/** 3Dコースと同じ数式からミニマップ用SVGパスを生成する。 */
export const TRACK_MAP_PATH = Array.from({ length: 97 }, (_, index) => {
  const point = trackPoint((index / 96) * Math.PI * 2),
    x = 60 + point.x * 0.5,
    y = 60 - point.z * 0.47;
  return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
}).join(' ');

/** ワールド座標に最も近いコース上の距離を近似探索する。 */
function nearestTrackDistance(x: number, z: number) {
  let bestIndex = 0,
    bestDistance = Infinity;
  for (let index = 0; index < 240; index++) {
    const pose = trackPose((index / 240) * TRACK_LENGTH),
      distance = (x - pose.x) ** 2 + (z - pose.z) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return (bestIndex / 240) * TRACK_LENGTH;
}

/** 1フレーム分の加減速、操舵、衝突、路面抵抗を車の状態へ反映する。 */
export function updateCarPhysics(
  state: CarState,
  input: Pick<Controls, 'steer' | 'throttle' | 'brake'>,
  colliders: Collider[],
  deltaTime: number,
) {
  state.speed +=
    (input.throttle * PHYSICS.acceleration -
      input.brake * PHYSICS.braking -
      state.speed * PHYSICS.rollingResistance) *
    deltaTime;
  state.speed = clamp(state.speed, -5, PHYSICS.maximumSpeed);
  state.angle += (input.steer * 1.8 - state.angle * 3.4) * deltaTime;
  state.heading += input.steer * state.speed * 0.045 * deltaTime;
  state.worldX += Math.sin(state.heading) * state.speed * deltaTime;
  state.worldZ += Math.cos(state.heading) * state.speed * deltaTime;

  for (const collider of colliders) {
    const dx = state.worldX - collider.x,
      dz = state.worldZ - collider.z,
      minimumDistance = collider.radius + 1.3,
      distanceSquared = dx * dx + dz * dz;
    if (distanceSquared >= minimumDistance * minimumDistance) continue;
    const distance = Math.max(0.001, Math.sqrt(distanceSquared)),
      push = minimumDistance - distance,
      normalX =
        distanceSquared > 0.0001 ? dx / distance : -Math.sin(state.heading),
      normalZ =
        distanceSquared > 0.0001 ? dz / distance : -Math.cos(state.heading);
    state.worldX += normalX * push;
    state.worldZ += normalZ * push;
    state.speed *= -0.14;
    break;
  }

  const projectedDistance = nearestTrackDistance(state.worldX, state.worldZ),
    previousWrapped = ((state.z % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
  let progressDelta = projectedDistance - previousWrapped;
  if (progressDelta > TRACK_LENGTH / 2) progressDelta -= TRACK_LENGTH;
  if (progressDelta < -TRACK_LENGTH / 2) progressDelta += TRACK_LENGTH;
  state.z += progressDelta;

  const pose = trackPose(state.z),
    dx = state.worldX - pose.x,
    dz = state.worldZ - pose.z;
  state.x = dx * pose.nx + dz * pose.nz;
  if (Math.abs(state.x) > 8.2) {
    state.speed *= Math.exp(-PHYSICS.grassResistance * deltaTime);
    state.speed = clamp(state.speed, -4, PHYSICS.maximumSpeed);
  }
}
