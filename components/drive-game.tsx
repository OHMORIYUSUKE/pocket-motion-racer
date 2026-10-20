'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Copy,
  Gauge,
  Gamepad2,
  Maximize2,
  Smartphone,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import * as THREE from 'three';

type Controls = {
  steer: number;
  throttle: number;
  brake: number;
  horn: number;
  start: number;
};
type DriveAudio = {
  engine: OscillatorNode;
  engineGain: GainNode;
  brake: OscillatorNode;
  brakeGain: GainNode;
};
type PeerRole = 'host' | 'controller';
type RacePhase = 'waiting' | 'countdown' | 'racing' | 'finished';
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const formatTime = (milliseconds: number) => {
  const minutes = Math.floor(milliseconds / 60000),
    seconds = Math.floor((milliseconds % 60000) / 1000),
    hundredths = Math.floor((milliseconds % 1000) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
};
const toBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
};
const fromBase64Url = (value: string) => {
  const base64 =
      value.replaceAll('-', '+').replaceAll('_', '/') +
      '='.repeat((4 - (value.length % 4)) % 4),
    binary = atob(base64),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
async function pack(value: RTCSessionDescriptionInit) {
  const kind = value.type === 'offer' ? 'o' : 'a',
    source = new TextEncoder().encode(value.sdp || '');
  if (!('CompressionStream' in window)) return `j${kind}${toBase64Url(source)}`;
  const compressed = await new Response(
    new Blob([source]).stream().pipeThrough(new CompressionStream('deflate')),
  ).arrayBuffer();
  return `z${kind}${toBase64Url(new Uint8Array(compressed))}`;
}
async function unpack(value: string): Promise<RTCSessionDescriptionInit> {
  const input = value.trim(),
    compressed = input[0] === 'z',
    type = input[1] === 'o' ? 'offer' : 'answer',
    bytes = fromBase64Url(input.slice(2));
  const data = compressed
    ? await new Response(
        new Blob([bytes])
          .stream()
          .pipeThrough(new DecompressionStream('deflate')),
      ).arrayBuffer()
    : bytes.buffer;
  return { type, sdp: new TextDecoder().decode(data) };
}

function waitIce(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', done);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, 3500);
  });
}

function drawGame(
  canvas: HTMLCanvasElement,
  car: { x: number; z: number; angle: number; speed: number },
  time: number,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(devicePixelRatio, 2),
    w = canvas.clientWidth,
    h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const horizon = h * 0.35;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#9fdcff');
  sky.addColorStop(1, '#e3f6ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);
  ctx.fillStyle = '#87bd4b';
  ctx.fillRect(0, horizon, w, h - horizon);
  ctx.fillStyle = 'rgba(255,255,255,.82)';
  for (let i = 0; i < 5; i++) {
    const cx = ((i * 260 - car.x * 4) % (w + 320)) - 120,
      cy = 66 + (i % 2) * 34;
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.arc(cx + 30, cy - 8, 34, 0, Math.PI * 2);
    ctx.arc(cx + 65, cy + 2, 24, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#679f3d';
  for (let i = -1; i < 7; i++) {
    const cx = i * (w / 5) - ((car.x * 3) % (w / 5));
    ctx.beginPath();
    ctx.moveTo(cx - 140, horizon);
    ctx.quadraticCurveTo(cx, horizon - 110 - (i % 2) * 30, cx + 160, horizon);
    ctx.fill();
  }
  const turn =
    Math.sin((car.z + 40) * 0.012) * 90 + Math.sin(car.z * 0.004) * 45;
  ctx.fillStyle = '#4d5359';
  ctx.beginPath();
  ctx.moveTo(w / 2 - 53 + turn * 0.08, horizon);
  ctx.lineTo(w / 2 + 53 + turn * 0.08, horizon);
  ctx.lineTo(w + 210 + turn, h);
  ctx.lineTo(-210 + turn, h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#f1db62';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 50 + turn * 0.08, horizon);
  ctx.lineTo(-180 + turn, h);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w / 2 + 50 + turn * 0.08, horizon);
  ctx.lineTo(w + 180 + turn, h);
  ctx.stroke();
  const phase = (car.z * 8) % 110;
  for (let i = 0; i < 8; i++) {
    const y1 = horizon + ((i * 110 + phase) % (h - horizon + 110)),
      p = (y1 - horizon) / (h - horizon);
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 2 + p * 10;
    ctx.beginPath();
    ctx.moveTo(w / 2 + turn * p * 0.45, y1);
    ctx.lineTo(w / 2 + turn * p * 0.5, Math.min(h, y1 + 18 + p * 45));
    ctx.stroke();
  }
  for (let i = 0; i < 11; i++) {
    const p = (i * 0.19 + car.z * 0.0016) % 1,
      y = horizon + p * p * (h - horizon),
      side = i % 2 ? -1 : 1,
      x = w / 2 + side * (70 + p * p * w * 0.62) + turn * p,
      size = 5 + p * 32;
    ctx.fillStyle = i % 3 ? '#f5eee0' : '#ff8b67';
    ctx.fillRect(x - size / 2, y - size, size, size);
    ctx.fillStyle = '#467b33';
    ctx.beginPath();
    ctx.arc(x, y - size * 1.35, size * 0.65, 0, Math.PI * 2);
    ctx.fill();
  }
  const bob =
      Math.sin(time * 0.012 + car.speed) * Math.min(2, car.speed * 0.05),
    cx = w / 2 + clamp(car.x, -9, 9) * 6,
    cy = h * 0.79 + bob;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(clamp(car.angle, -0.42, 0.42) * 0.16);
  ctx.fillStyle = 'rgba(20,25,20,.28)';
  ctx.beginPath();
  ctx.ellipse(0, 31, 68, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#24282b';
  ctx.fillRect(-58, 12, 18, 35);
  ctx.fillRect(40, 12, 18, 35);
  const body = ctx.createLinearGradient(0, -60, 0, 42);
  body.addColorStop(0, '#ff7a54');
  body.addColorStop(1, '#df3d31');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(-57, -32, 114, 72, 23);
  ctx.fill();
  ctx.fillStyle = '#ffb18f';
  ctx.beginPath();
  ctx.roundRect(-40, -58, 80, 46, 18);
  ctx.fill();
  ctx.fillStyle = '#78b9d2';
  ctx.beginPath();
  ctx.roundRect(-30, -50, 60, 30, 10);
  ctx.fill();
  ctx.fillStyle = '#252a2d';
  ctx.fillRect(-42, 25, 84, 8);
  ctx.fillStyle = '#ffd550';
  ctx.beginPath();
  ctx.arc(-39, 12, 8, 0, Math.PI * 2);
  ctx.arc(39, 12, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

type ThreeWorld = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  car: THREE.Group;
  wheels: THREE.Mesh[];
  road: THREE.Group;
  sun: THREE.DirectionalLight;
  colliders: { x: number; z: number; radius: number }[];
};
type CarState = {
  x: number;
  z: number;
  angle: number;
  speed: number;
  worldX: number;
  worldZ: number;
  heading: number;
};
const TRACK_LENGTH = 520;
function trackPoint(t: number) {
  const width = 62 + Math.sin(t * 3) * 10 + Math.cos(t * 5) * 5,
    depth = 76 + Math.sin(t * 2 + 0.7) * 9 - Math.cos(t * 4) * 4;
  return { x: Math.sin(t) * width, z: Math.cos(t) * depth };
}
function trackPose(distance: number) {
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
const initialCar = (): CarState => {
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
};
const TRACK_MAP_PATH = Array.from({ length: 97 }, (_, index) => {
  const point = trackPoint((index / 96) * Math.PI * 2),
    x = 60 + point.x * 0.5,
    y = 60 - point.z * 0.47;
  return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
}).join(' ');
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

function createThreeWorld(canvas: HTMLCanvasElement): ThreeWorld {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9ddcff');
  scene.fog = new THREE.Fog('#cceaf0', 45, 210);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 500);
  scene.add(new THREE.HemisphereLight('#dff5ff', '#5f8c3e', 2.4));
  const sun = new THREE.DirectionalLight('#fff3d0', 3.8);
  sun.position.set(-35, 45, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  scene.add(sun);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 420),
    new THREE.MeshStandardMaterial({ color: '#75ad45', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const road = new THREE.Group();
  scene.add(road);
  const colliders: { x: number; z: number; radius: number }[] = [];
  const asphalt = new THREE.MeshStandardMaterial({
      color: '#41494d',
      roughness: 0.92,
    }),
    edge = new THREE.MeshStandardMaterial({ color: '#f7d84c', roughness: 0.8 }),
    white = new THREE.MeshStandardMaterial({
      color: '#fffbe8',
      roughness: 0.75,
    });
  const segments = 180,
    segmentDistance = TRACK_LENGTH / segments;
  for (let i = 0; i < segments; i++) {
    const current = trackPose(i * segmentDistance),
      next = trackPose((i + 1) * segmentDistance),
      x = (current.x + next.x) / 2,
      z = (current.z + next.z) / 2,
      segmentLength = Math.hypot(next.x - current.x, next.z - current.z),
      yaw = Math.atan2(-current.tx, -current.tz);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(18, 0.22, segmentLength + 0.2),
      asphalt,
    );
    slab.position.set(x, 0.06, z);
    slab.rotation.y = yaw;
    slab.receiveShadow = true;
    road.add(slab);
    for (const side of [-1, 1]) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.06, segmentLength),
        edge,
      );
      line.position.set(
        x + current.nx * side * 8.25,
        0.2,
        z + current.nz * side * 8.25,
      );
      line.rotation.y = yaw;
      road.add(line);
    }
    if (i % 2 === 0) {
      const dash = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.07, Math.min(2.2, segmentLength * 0.7)),
        white,
      );
      dash.position.set(x, 0.21, z);
      dash.rotation.y = yaw;
      road.add(dash);
    }
    if (i % 5 === 0) {
      for (const side of [-1, 1]) {
        const tree = new THREE.Group(),
          trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.28, 0.38, 2.2, 8),
            new THREE.MeshStandardMaterial({ color: '#805533' }),
          ),
          crown = new THREE.Mesh(
            new THREE.IcosahedronGeometry(1.55 + (i % 4) * 0.12, 1),
            new THREE.MeshStandardMaterial({
              color: i % 2 ? '#3c823d' : '#56a844',
              roughness: 1,
            }),
          );
        trunk.position.y = 1.1;
        crown.position.y = 3.25;
        trunk.castShadow = crown.castShadow = true;
        tree.add(trunk, crown);
        tree.position.set(
          x + current.nx * side * (12 + (i % 4) * 2),
          0,
          z + current.nz * side * (12 + (i % 4) * 2),
        );
        colliders.push({
          x: tree.position.x,
          z: tree.position.z,
          radius: 1.45,
        });
        road.add(tree);
      }
    }
    if (i % 18 === 0) {
      const height = 5 + (i % 9),
        side = i % 36 ? 1 : -1,
        building = new THREE.Mesh(
          new THREE.BoxGeometry(7, height, 7),
          new THREE.MeshStandardMaterial({
            color: i % 2 ? '#f2a66f' : '#f0dfb4',
            roughness: 0.9,
          }),
        );
      building.position.set(
        x + current.nx * side * 20,
        height / 2,
        z + current.nz * side * 20,
      );
      building.castShadow = true;
      colliders.push({
        x: building.position.x,
        z: building.position.z,
        radius: 4.1,
      });
      road.add(building);
    }
  }
  const start = trackPose(0),
    startYaw = Math.atan2(-start.tx, -start.tz),
    gate = new THREE.Group(),
    gateDark = new THREE.MeshStandardMaterial({
      color: '#182520',
      roughness: 0.48,
      metalness: 0.35,
    }),
    gateOrange = new THREE.MeshStandardMaterial({
      color: '#f05a3c',
      roughness: 0.42,
      metalness: 0.18,
    }),
    gateLight = new THREE.MeshStandardMaterial({ color: '#fff8df' });
  for (let row = 0; row < 2; row++)
    for (let column = 0; column < 12; column++) {
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.08, 0.75),
        (row + column) % 2 ? gateDark : gateLight,
      );
      tile.position.set(-8.25 + column * 1.5, 0.25, -0.38 + row * 0.75);
      gate.add(tile);
    }
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 5.8, 0.78),
      gateDark,
    );
    post.position.set(side * 9.05, 3.1, 0);
    post.rotation.z = side * 0.055;
    post.castShadow = true;
    gate.add(post);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 3.8, 0.12),
      gateOrange,
    );
    stripe.position.set(side * 8.98, 3.15, -0.43);
    stripe.rotation.z = side * 0.055;
    gate.add(stripe);
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.75, 0.42, 1.5),
      gateOrange,
    );
    base.position.set(side * 9.2, 0.22, 0);
    base.castShadow = true;
    gate.add(base);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(18.9, 1.45, 0.9), gateDark);
  beam.position.set(0, 6.2, 0);
  beam.castShadow = true;
  gate.add(beam);
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(1.45, 1.62, 1.02),
      gateOrange,
    );
    cap.position.set(side * 8.72, 6.2, 0);
    gate.add(cap);
  }
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 1024;
  signCanvas.height = 160;
  const signContext = signCanvas.getContext('2d');
  if (signContext) {
    signContext.fillStyle = '#182520';
    signContext.fillRect(0, 0, signCanvas.width, signCanvas.height);
    signContext.fillStyle = '#f05a3c';
    signContext.fillRect(0, 0, signCanvas.width, 12);
    signContext.fillRect(0, signCanvas.height - 12, signCanvas.width, 12);
    signContext.fillStyle = '#fff9ea';
    signContext.font = '900 76px Arial';
    signContext.textAlign = 'center';
    signContext.textBaseline = 'middle';
    signContext.fillText('START / FINISH', 512, 82);
  }
  const signTexture = new THREE.CanvasTexture(signCanvas);
  signTexture.colorSpace = THREE.SRGBColorSpace;
  const signMaterial = new THREE.MeshBasicMaterial({ map: signTexture });
  for (const direction of [-1, 1]) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(15.6, 1.08),
      signMaterial,
    );
    sign.position.set(0, 6.2, direction * 0.456);
    sign.rotation.y = direction > 0 ? 0 : Math.PI;
    gate.add(sign);
  }
  gate.position.set(start.x, 0, start.z);
  gate.rotation.y = startYaw;
  road.add(gate);
  const car = new THREE.Group();
  scene.add(car);
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: '#ef5139',
    roughness: 0.32,
    metalness: 0.08,
    clearcoat: 0.8,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.75, 4.15), bodyMat);
  body.position.y = 0.85;
  body.castShadow = true;
  car.add(body);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.38, 1.1), bodyMat);
  hood.position.set(0, 1.25, -1.25);
  hood.castShadow = true;
  car.add(hood);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.95, 0.95, 1.9),
    new THREE.MeshPhysicalMaterial({
      color: '#8fd8ec',
      roughness: 0.18,
      metalness: 0.05,
      transparent: true,
      opacity: 0.9,
    }),
  );
  cabin.position.set(0, 1.52, 0.15);
  cabin.castShadow = true;
  car.add(cabin);
  const bumper = new THREE.Mesh(
    new THREE.BoxGeometry(2.35, 0.24, 0.28),
    new THREE.MeshStandardMaterial({ color: '#22282a', roughness: 0.6 }),
  );
  bumper.position.set(0, 0.65, -2.12);
  car.add(bumper);
  const wheels: THREE.Mesh[] = [];
  const tireMat = new THREE.MeshStandardMaterial({
    color: '#202224',
    roughness: 0.88,
  });
  for (const x of [-1.28, 1.28])
    for (const z of [-1.25, 1.25]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 0.42, 16),
        tireMat,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.52, z);
      wheel.castShadow = true;
      wheels.push(wheel);
      car.add(wheel);
    }
  for (const x of [-0.77, 0.77]) {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 12, 8),
      new THREE.MeshStandardMaterial({
        color: '#fff2a6',
        emissive: '#ffcb4b',
        emissiveIntensity: 1.6,
      }),
    );
    lamp.position.set(x, 0.93, -2.08);
    car.add(lamp);
  }
  car.scale.setScalar(1.08);
  return { renderer, scene, camera, car, wheels, road, sun, colliders };
}

function renderThree(
  world: ThreeWorld,
  state: CarState,
  canvas: HTMLCanvasElement,
) {
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  if (!w || !h) return;
  if (
    canvas.width !== Math.floor(w * world.renderer.getPixelRatio()) ||
    canvas.height !== Math.floor(h * world.renderer.getPixelRatio())
  ) {
    world.renderer.setSize(w, h, false);
    world.camera.aspect = w / h;
    world.camera.updateProjectionMatrix();
  }
  const forwardX = Math.sin(state.heading),
    forwardZ = Math.cos(state.heading),
    carX = state.worldX,
    carZ = state.worldZ;
  world.car.position.set(carX, 0.12, carZ);
  world.car.rotation.y = state.heading + Math.PI;
  world.car.rotation.z = -state.angle * 0.08;
  world.wheels.forEach((wheel) => (wheel.rotation.x -= state.speed * 0.018));
  const desired = new THREE.Vector3(
    carX - forwardX * 9.5,
    4.7,
    carZ - forwardZ * 9.5,
  );
  world.camera.position.lerp(desired, 0.075);
  world.camera.lookAt(carX + forwardX * 7, 1.05, carZ + forwardZ * 7);
  world.sun.position.set(carX - 30, 42, carZ + 25);
  world.sun.target.position.set(carX, 0, carZ);
  world.scene.add(world.sun.target);
  world.renderer.render(world.scene, world.camera);
}

export default function DriveGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null),
    worldRef = useRef<ThreeWorld | null>(null),
    controls = useRef<Controls>({
      steer: 0,
      throttle: 0,
      brake: 0,
      horn: 0,
      start: 0,
    }),
    car = useRef<CarState>(initialCar()),
    pcRef = useRef<RTCPeerConnection | null>(null),
    channelRef = useRef<RTCDataChannel | null>(null),
    audioContextRef = useRef<AudioContext | null>(null),
    driveAudioRef = useRef<DriveAudio | null>(null),
    lastHornRef = useRef(0),
    lastStartRef = useRef(0),
    soundRef = useRef(true),
    racePhaseRef = useRef<RacePhase>('waiting'),
    raceStartRef = useRef(0),
    lapStartRef = useRef(0),
    completedLapsRef = useRef(0),
    countdownTimersRef = useRef<number[]>([]),
    connectionTimeoutRef = useRef<number | null>(null),
    currentRoll = useRef(0),
    centerRoll = useRef(0),
    needsCalibration = useRef(true);
  const [speed, setSpeed] = useState(0),
    [progress, setProgress] = useState(0),
    [lap, setLap] = useState(1),
    [sound, setSound] = useState(true),
    [controller, setController] = useState(false),
    [connected, setConnected] = useState(false),
    [pairOpen, setPairOpen] = useState(false),
    [pairRole, setPairRole] = useState<PeerRole>('host'),
    [code, setCode] = useState(''),
    [remoteCode, setRemoteCode] = useState(''),
    [connectionError, setConnectionError] = useState(''),
    [tilt, setTilt] = useState(0),
    [motionReady, setMotionReady] = useState(false),
    [calibrated, setCalibrated] = useState(false),
    [guideOpen, setGuideOpen] = useState(true),
    [racePhase, setRacePhase] = useState<RacePhase>('waiting'),
    [countdown, setCountdown] = useState(''),
    [elapsed, setElapsed] = useState(0),
    [lapTimes, setLapTimes] = useState<number[]>([]);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  const playHorn = useCallback(() => {
    if (!soundRef.current) return;
    const AudioContextClass =
      window.AudioContext ||
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!AudioContextClass) return;
    const context =
      audioContextRef.current ||
      (audioContextRef.current = new AudioContextClass());
    void context.resume();
    const now = context.currentTime,
      gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.018);
    gain.gain.setValueAtTime(0.18, now + 0.22);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    gain.connect(context.destination);
    [349, 440].forEach((frequency) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'square';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(now);
      oscillator.stop(now + 0.35);
    });
  }, []);
  const updateDriveAudio = useCallback(
    (throttle: number, braking: number, currentSpeed: number) => {
      const existing = driveAudioRef.current;
      if (!soundRef.current) {
        if (existing) {
          const now = existing.engine.context.currentTime;
          existing.engineGain.gain.setTargetAtTime(0.0001, now, 0.03);
          existing.brakeGain.gain.setTargetAtTime(0.0001, now, 0.02);
        }
        return;
      }
      if (!existing && throttle <= 0 && braking <= 0) return;
      let audio = existing;
      if (!audio) {
        const AudioContextClass =
          window.AudioContext ||
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
        if (!AudioContextClass) return;
        const context =
            audioContextRef.current ||
            (audioContextRef.current = new AudioContextClass()),
          engine = context.createOscillator(),
          engineGain = context.createGain(),
          engineFilter = context.createBiquadFilter(),
          brake = context.createOscillator(),
          brakeGain = context.createGain(),
          brakeFilter = context.createBiquadFilter();
        engine.type = 'sawtooth';
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 520;
        engineGain.gain.value = 0.0001;
        engine
          .connect(engineFilter)
          .connect(engineGain)
          .connect(context.destination);
        brake.type = 'sawtooth';
        brake.frequency.value = 1250;
        brakeFilter.type = 'bandpass';
        brakeFilter.frequency.value = 1450;
        brakeFilter.Q.value = 7;
        brakeGain.gain.value = 0.0001;
        brake
          .connect(brakeFilter)
          .connect(brakeGain)
          .connect(context.destination);
        engine.start();
        brake.start();
        audio = { engine, engineGain, brake, brakeGain };
        driveAudioRef.current = audio;
        void context.resume();
      }
      const now = audio.engine.context.currentTime,
        engineLevel = throttle > 0 ? 0.055 + throttle * 0.045 : 0.0001,
        brakeLevel = braking > 0 && currentSpeed > 1 ? 0.085 : 0.0001;
      audio.engine.frequency.setTargetAtTime(
        70 + throttle * 42 + currentSpeed * 4.2,
        now,
        0.06,
      );
      audio.engineGain.gain.setTargetAtTime(engineLevel, now, 0.045);
      audio.brake.frequency.setTargetAtTime(
        1180 + Math.min(currentSpeed, 26) * 15,
        now,
        0.025,
      );
      audio.brakeGain.gain.setTargetAtTime(brakeLevel, now, 0.018);
    },
    [],
  );
  useEffect(() => {
    if (controller) return;
    const unlockAudio = () => {
      const AudioContextClass =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (!AudioContextClass) return;
      const context =
        audioContextRef.current ||
        (audioContextRef.current = new AudioContextClass());
      void context.resume();
    };
    addEventListener('pointerdown', unlockAudio);
    return () => {
      removeEventListener('pointerdown', unlockAudio);
    };
  }, [controller]);
  useEffect(
    () => () => {
      driveAudioRef.current = null;
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== 'closed') void context.close();
    },
    [],
  );
  useEffect(() => {
    const isController =
      new URLSearchParams(location.search).get('controller') === '1';
    setController(isController);
    if (!isController) {
      setPairRole('host');
      setPairOpen(true);
    }
  }, []);
  useEffect(() => {
    if (controller || !canvasRef.current) return;
    const world = createThreeWorld(canvasRef.current);
    worldRef.current = world;
    return () => {
      world.renderer.dispose();
      world.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      worldRef.current = null;
    };
  }, [controller]);
  const beginCountdown = useCallback(() => {
    countdownTimersRef.current.forEach(clearTimeout);
    countdownTimersRef.current = [];
    car.current = initialCar();
    completedLapsRef.current = 0;
    racePhaseRef.current = 'countdown';
    setRacePhase('countdown');
    setCountdown('3');
    setElapsed(0);
    setLapTimes([]);
    setLap(1);
    setProgress(0);
    const schedule = (delay: number, action: () => void) => {
      countdownTimersRef.current.push(window.setTimeout(action, delay));
    };
    schedule(1000, () => setCountdown('2'));
    schedule(2000, () => setCountdown('1'));
    schedule(3000, () => setCountdown('GO!'));
    schedule(3800, () => {
      const now = performance.now();
      raceStartRef.current = now;
      lapStartRef.current = now;
      racePhaseRef.current = 'racing';
      setRacePhase('racing');
      setCountdown('');
    });
  }, []);
  useEffect(() => () => countdownTimersRef.current.forEach(clearTimeout), []);
  useEffect(
    () => () => {
      if (connectionTimeoutRef.current)
        clearTimeout(connectionTimeoutRef.current);
    },
    [],
  );
  const attachChannel = useCallback(
    (channel: RTCDataChannel) => {
      channelRef.current = channel;
      channel.onopen = () => {
        if (connectionTimeoutRef.current)
          clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
        setConnectionError('');
        setConnected(true);
        setPairOpen(false);
        const isController =
          new URLSearchParams(location.search).get('controller') === '1';
        if (isController) setGuideOpen(true);
      };
      channel.onclose = () => {
        setConnected(false);
        const isController =
          new URLSearchParams(location.search).get('controller') === '1';
        if (!isController) {
          setPairRole('host');
          setPairOpen(true);
        }
      };
      channel.onerror = () => {
        setConnectionError(
          '通信の開始に失敗しました。両方の画面を再読み込みして、もう一度お試しください。',
        );
        setPairOpen(true);
      };
      channel.onmessage = (e) => {
        try {
          const incoming = JSON.parse(e.data) as Controls;
          controls.current = incoming;
          if (incoming.horn > lastHornRef.current) playHorn();
          lastHornRef.current = incoming.horn;
          if (incoming.start > lastStartRef.current) beginCountdown();
          lastStartRef.current = incoming.start;
        } catch {}
      };
    },
    [beginCountdown, playHorn],
  );
  const watchPeerConnection = (pc: RTCPeerConnection) => {
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState !== 'failed') return;
      setConnected(false);
      setConnectionError(
        '接続に失敗しました。同じWi-Fiに接続していることを確認し、QRコードをもう一度読み取ってください。',
      );
      const isController =
        new URLSearchParams(location.search).get('controller') === '1';
      setPairRole(isController ? 'controller' : 'host');
      setPairOpen(true);
    });
  };
  const createOffer = async () => {
    try {
      setConnectionError('');
      pcRef.current?.close();
      const pc = new RTCPeerConnection({ iceServers: [] });
      pcRef.current = pc;
      watchPeerConnection(pc);
      attachChannel(
        pc.createDataChannel('drive', { ordered: false, maxRetransmits: 0 }),
      );
      await pc.setLocalDescription(await pc.createOffer());
      await waitIce(pc);
      setCode(await pack(pc.localDescription!));
    } catch {
      setConnectionError(
        '接続QRを作成できませんでした。ページを再読み込みして、もう一度お試しください。',
      );
    }
  };
  const acceptOffer = async (scannedCode?: string) => {
    try {
      setConnectionError('');
      const incoming = scannedCode || remoteCode;
      setRemoteCode(incoming);
      const pc = new RTCPeerConnection({ iceServers: [] });
      pcRef.current = pc;
      watchPeerConnection(pc);
      pc.ondatachannel = (e) => attachChannel(e.channel);
      await pc.setRemoteDescription(await unpack(incoming));
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIce(pc);
      setCode(await pack(pc.localDescription!));
    } catch {
      setCode('');
      setConnectionError(
        '接続QRを読み取れませんでした。PCに表示された「② 接続QR」をもう一度読み取ってください。',
      );
    }
  };
  const acceptAnswer = async (scannedCode?: string) => {
    try {
      setConnectionError('');
      const incoming = scannedCode || remoteCode;
      setRemoteCode(incoming);
      await pcRef.current?.setRemoteDescription(await unpack(incoming));
      if (connectionTimeoutRef.current)
        clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = window.setTimeout(() => {
        if (pcRef.current?.connectionState === 'connected') return;
        setConnectionError(
          '接続がタイムアウトしました。同じWi-Fiを確認し、最初から接続し直してください。',
        );
        setPairOpen(true);
      }, 12000);
    } catch {
      setConnectionError(
        '返答QRを読み取れませんでした。スマホに表示された「③ 返答QR」をもう一度読み取ってください。',
      );
    }
  };
  useEffect(() => {
    let frame = 0,
      last = performance.now(),
      hudTick = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.035, (now - last) / 1000);
      last = now;
      if (!controller && canvasRef.current) {
        const canDrive = racePhaseRef.current === 'racing',
          gas = canDrive ? controls.current.throttle : 0,
          brake = canDrive ? controls.current.brake : 0,
          steer = canDrive ? controls.current.steer : 0,
          s = car.current;
        updateDriveAudio(Number(gas), Number(brake), Math.abs(s.speed));
        s.speed += (gas * 24 - brake * 16 - s.speed * 0.18) * dt;
        s.speed = clamp(s.speed, -5, 48.5);
        s.angle += (steer * 1.8 - s.angle * 3.4) * dt;
        s.heading += steer * s.speed * 0.045 * dt;
        s.worldX += Math.sin(s.heading) * s.speed * dt;
        s.worldZ += Math.cos(s.heading) * s.speed * dt;
        const world = worldRef.current;
        if (world) {
          for (const collider of world.colliders) {
            const dx = s.worldX - collider.x,
              dz = s.worldZ - collider.z,
              minimumDistance = collider.radius + 1.3,
              distanceSquared = dx * dx + dz * dz;
            if (distanceSquared >= minimumDistance * minimumDistance) continue;
            const distance = Math.max(0.001, Math.sqrt(distanceSquared)),
              push = minimumDistance - distance,
              normalX =
                distanceSquared > 0.0001 ? dx / distance : -Math.sin(s.heading),
              normalZ =
                distanceSquared > 0.0001 ? dz / distance : -Math.cos(s.heading);
            s.worldX += normalX * push;
            s.worldZ += normalZ * push;
            s.speed *= -0.14;
            break;
          }
        }
        const projectedDistance = nearestTrackDistance(s.worldX, s.worldZ),
          previousWrapped =
            ((s.z % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
        let progressDelta = projectedDistance - previousWrapped;
        if (progressDelta > TRACK_LENGTH / 2) progressDelta -= TRACK_LENGTH;
        if (progressDelta < -TRACK_LENGTH / 2) progressDelta += TRACK_LENGTH;
        s.z += progressDelta;
        const pose = trackPose(s.z),
          dx = s.worldX - pose.x,
          dz = s.worldZ - pose.z;
        s.x = dx * pose.nx + dz * pose.nz;
        if (Math.abs(s.x) > 8.2) {
          s.speed *= Math.exp(-1.6 * dt);
          s.speed = clamp(s.speed, -4, 48.5);
        }
        if (racePhaseRef.current === 'racing') {
          const completed = Math.floor(Math.max(0, s.z) / TRACK_LENGTH);
          if (completed > completedLapsRef.current) {
            const lapTime = now - lapStartRef.current;
            completedLapsRef.current = completed;
            lapStartRef.current = now;
            setLapTimes((times) => [...times, lapTime]);
            if (completed >= 3) {
              const finalTime = now - raceStartRef.current;
              racePhaseRef.current = 'finished';
              setRacePhase('finished');
              setElapsed(finalTime);
              setLap(3);
              s.speed = 0;
            } else {
              setLap(completed + 1);
            }
          }
        }
        if (worldRef.current)
          renderThree(worldRef.current, s, canvasRef.current);
        if (now - hudTick > 90) {
          setSpeed(Math.max(0, Math.round(s.speed * 6.2)));
          setProgress(
            (((s.z % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH) /
              TRACK_LENGTH,
          );
          if (racePhaseRef.current === 'racing')
            setElapsed(now - raceStartRef.current);
          hudTick = now;
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [controller, updateDriveAudio]);
  useEffect(() => {
    if (!controller) return;
    const motion = (e: DeviceMotionEvent) => {
      const gravity = e.accelerationIncludingGravity;
      if (!gravity || gravity.x == null || gravity.y == null) return;
      const roll = Math.atan2(gravity.x, gravity.y);
      currentRoll.current = roll;
      if (!motionReady) return;
      if (needsCalibration.current) {
        centerRoll.current = roll;
        needsCalibration.current = false;
        setCalibrated(true);
        setTilt(0);
        controls.current.steer = 0;
        return;
      }
      const delta = Math.atan2(
          Math.sin(roll - centerRoll.current),
          Math.cos(roll - centerRoll.current),
        ),
        value = clamp(delta / (Math.PI / 4), -1, 1);
      setTilt(value);
      controls.current.steer = value;
    };
    addEventListener('devicemotion', motion);
    const timer = setInterval(() => {
      if (channelRef.current?.readyState === 'open')
        channelRef.current.send(JSON.stringify(controls.current));
    }, 33);
    return () => {
      removeEventListener('devicemotion', motion);
      clearInterval(timer);
    };
  }, [controller, motionReady]);
  const startRace = async () => {
    const alreadyReceivingMotion = motionReady;
    if (!alreadyReceivingMotion) {
      const permission = (
        DeviceMotionEvent as unknown as {
          requestPermission?: () => Promise<string>;
        }
      ).requestPermission;
      if (permission) {
        try {
          if ((await permission()) !== 'granted') return;
        } catch {
          return;
        }
      }
      setMotionReady(true);
    }
    controls.current.steer = 0;
    setTilt(0);
    if (alreadyReceivingMotion) {
      centerRoll.current = currentRoll.current;
      needsCalibration.current = false;
      setCalibrated(true);
    } else {
      needsCalibration.current = true;
      setCalibrated(false);
    }
    controls.current.start += 1;
    if (channelRef.current?.readyState === 'open')
      channelRef.current.send(JSON.stringify(controls.current));
  };
  const press = (key: 'throttle' | 'brake', value: number) => () => {
    controls.current[key] = value;
  };
  const honk = () => {
    controls.current.horn += 1;
    if (channelRef.current?.readyState === 'open')
      channelRef.current.send(JSON.stringify(controls.current));
  };
  const toggleFullscreen = async () => {
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => void;
    };
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
      return;
    }
    if (root.requestFullscreen) await root.requestFullscreen();
    else root.webkitRequestFullscreen?.();
  };
  const pairing = (
    <Pairing
      open={pairOpen}
      onClose={() => setPairOpen(false)}
      closable={pairRole === 'controller'}
      role={pairRole}
      error={connectionError}
      code={code}
      remoteCode={remoteCode}
      setRemoteCode={setRemoteCode}
      createOffer={createOffer}
      acceptOffer={acceptOffer}
      acceptAnswer={acceptAnswer}
    />
  );
  if (controller)
    return (
      <main className="controller-screen">
        <div className="controller-top">
          <div>
            <span className="eyebrow">POCKET DRIVER</span>
            <h1>MOTION DRIVE</h1>
          </div>
          <div className="controller-actions">
            <span className={`status-pill ${connected ? 'online' : ''}`}>
              <i />
              {connected ? '接続中' : '未接続'}
            </span>
            <button
              className="controller-fullscreen"
              type="button"
              onClick={toggleFullscreen}
              aria-label="全画面表示"
            >
              <Maximize2 />
            </button>
          </div>
        </div>
        <div className="controller-body">
          <button
            className="pedal brake"
            onPointerDown={press('brake', 1)}
            onPointerUp={press('brake', 0)}
            onPointerCancel={press('brake', 0)}
            onPointerLeave={press('brake', 0)}
          >
            <span>BRAKE</span>
            <small>ブレーキ</small>
          </button>
          <div className="tilt-zone">
            <div
              className="wheel"
              style={{ transform: `rotate(${-tilt * 80}deg)` }}
            >
              <span className="wheel-spoke spoke-left" />
              <span className="wheel-spoke spoke-right" />
              <span className="wheel-spoke spoke-bottom" />
              <button
                className="horn-button"
                type="button"
                onPointerDown={honk}
                aria-label="クラクション"
              >
                HORN
              </button>
            </div>
            <p>
              {!motionReady
                ? 'まっすぐ構えてSTARTを押す'
                : calibrated
                  ? 'スマホごとハンドルのように回す'
                  : '中央位置を検出しています…'}
            </p>
          </div>
          <button
            className="pedal gas"
            onPointerDown={press('throttle', 1)}
            onPointerUp={press('throttle', 0)}
            onPointerCancel={press('throttle', 0)}
            onPointerLeave={press('throttle', 0)}
          >
            <span>GO!</span>
            <small>アクセル</small>
          </button>
        </div>
        {connected && !guideOpen ? (
          <Button className="start-controller" onClick={startRace}>
            START
          </Button>
        ) : !connected ? (
          <Button
            className="pair-controller"
            variant="outline"
            onClick={() => {
              setPairRole('controller');
              setPairOpen(true);
            }}
          >
            <Camera /> カメラを開く
          </Button>
        ) : null}
        {connected && guideOpen && (
          <section className="prestart-guide" aria-label="スマホの構え方">
            <span className="eyebrow">HOW TO HOLD</span>
            <h2>スマホの構え方</h2>
            <div className="hold-steps">
              <div>
                <i className="hold-pictogram landscape-phone">
                  <Smartphone />
                </i>
                <b>横向きにする</b>
                <small>画面を自分へ向けます</small>
              </div>
              <div>
                <i className="hold-pictogram">
                  <Gamepad2 />
                </i>
                <b>胸の前で持つ</b>
                <small>両手で水平に構えます</small>
              </div>
              <div>
                <i className="hold-pictogram">
                  <Gauge />
                </i>
                <b>まっすぐ構える</b>
                <small>STARTで中央が決まります</small>
              </div>
            </div>
            <Button className="guide-ready" onClick={() => setGuideOpen(false)}>
              準備できた
            </Button>
          </section>
        )}
        <div className="portrait-notice">
          <div className={`portrait-icon ${connected ? 'connected' : ''}`}>
            {connected ? <Smartphone /> : <Camera />}
          </div>
          <b>{connected ? '接続完了' : 'QRコードでPCと接続'}</b>
          <span>
            {connected
              ? 'スマホを横向きにして運転を始めてください'
              : '縦向きのまま、PC画面のQRコードを読み取ってください'}
          </span>
          {!connected && (
            <Button
              className="portrait-pair-button"
              onClick={() => {
                setPairRole('controller');
                setPairOpen(true);
              }}
            >
              <Camera /> カメラを開く
            </Button>
          )}
        </div>
        {pairing}
      </main>
    );
  const mapPoint = trackPoint(progress * Math.PI * 2),
    markerX = 60 + mapPoint.x * 0.5,
    markerY = 60 - mapPoint.z * 0.47,
    completedTime = lapTimes.reduce((total, time) => total + time, 0),
    currentLapTime = Math.max(0, elapsed - completedTime);
  return (
    <main className="game-shell">
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label="ドライブゲーム画面"
      />
      {racePhase === 'waiting' && (
        <div className="race-message waiting-message">
          <small>READY?</small>
          <b>スマホのSTARTを押してください</b>
          <span>押した向きがハンドルの中央になります</span>
        </div>
      )}
      {racePhase === 'countdown' && (
        <div
          key={countdown}
          className={`countdown-display ${countdown === 'GO!' ? 'go' : ''}`}
        >
          {countdown}
        </div>
      )}
      {racePhase === 'finished' && (
        <div className="goal-overlay">
          <small>3 LAPS COMPLETE</small>
          <h2>GOAL!</h2>
          <b>{formatTime(elapsed)}</b>
          <div>
            {lapTimes.slice(0, 3).map((time, index) => (
              <span key={index}>
                LAP {index + 1} <strong>{formatTime(time)}</strong>
              </span>
            ))}
          </div>
          <p>スマホのSTARTで再スタート</p>
        </div>
      )}
      <header className="game-header">
        <div className="brand-mark">
          <span>R</span>
          <div>
            <b>ROLY-POLY</b>
            <small>POCKET RACING</small>
          </div>
        </div>
        <div className="header-actions">
          <span className={`status-pill ${connected ? 'online' : ''}`}>
            <i />
            {connected ? 'スマホ接続中' : 'スマホ未接続'}
          </span>
          <Button
            className="icon-btn"
            variant="outline"
            size="icon-lg"
            onClick={() => setSound(!sound)}
            aria-label="サウンド切替"
          >
            {sound ? <Volume2 /> : <VolumeX />}
          </Button>
          <Button
            className="icon-btn"
            variant="outline"
            size="icon-lg"
            onClick={() => document.documentElement.requestFullscreen?.()}
            aria-label="全画面"
          >
            <Maximize2 />
          </Button>
        </div>
      </header>
      <div className="lap-card">
        <span>LAP</span>
        <b>
          {lap} <em>/ 3</em>
        </b>
      </div>
      <div className="time-card">
        <span>
          LAP TIME{' '}
          <b>{formatTime(racePhase === 'finished' ? 0 : currentLapTime)}</b>
        </span>
        <span>
          TOTAL <b>{formatTime(elapsed)}</b>
        </span>
        {lapTimes.length > 0 && (
          <small>LAST {formatTime(lapTimes[lapTimes.length - 1])}</small>
        )}
      </div>
      <div className="speedometer">
        <Gauge />
        <div>
          <b>{String(speed).padStart(3, '0')}</b>
          <span>KM/H</span>
        </div>
      </div>
      <div className="minimap">
        <svg viewBox="0 0 120 120" aria-label="コースマップ">
          <path className="map-course" d={TRACK_MAP_PATH} />
          <line className="start-line" x1="53" y1="21" x2="67" y2="21" />
          <circle className="map-marker" cx={markerX} cy={markerY} r="6" />
        </svg>
        <span>YOU</span>
      </div>
      <div className="mobile-hint">
        <Gamepad2 />
        <span>PCの大きな画面で遊んでね</span>
      </div>
      {pairing}
    </main>
  );
}

function Pairing({
  open,
  onClose,
  closable,
  role,
  error,
  code,
  remoteCode,
  setRemoteCode,
  createOffer,
  acceptOffer,
  acceptAnswer,
}: {
  open: boolean;
  onClose: () => void;
  closable: boolean;
  role: PeerRole;
  error: string;
  code: string;
  remoteCode: string;
  setRemoteCode: (s: string) => void;
  createOffer: () => void;
  acceptOffer: (code?: string) => void;
  acceptAnswer: (code?: string) => void;
}) {
  if (!open) return null;
  const host = role === 'host';
  const controllerUrl =
    typeof location !== 'undefined'
      ? `${location.origin}${location.pathname}?controller=1`
      : '';
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="スマホ接続"
    >
      <section className="pair-modal">
        {closable && (
          <button className="modal-close" onClick={onClose} aria-label="閉じる">
            <X />
          </button>
        )}
        <span className="eyebrow">QR PAIRING</span>
        <h2>{host ? 'スマホをつなぐ' : 'PCにつなぐ'}</h2>
        <p className="pair-lead">
          同じWi-Fiにつないで、画面の案内どおりにQRを読み取ります。
        </p>
        {error && (
          <div className="pair-error" role="alert">
            <b>接続できませんでした</b>
            <span>{error}</span>
          </div>
        )}
        {host ? (
          <>
            <ol>
              <li>
                <b>1</b> URLのQRを標準カメラで読み、ページを開く
              </li>
              <li>
                <b>2</b> スマホ画面の「カメラを開く」を押し、PCの「②
                接続QR」を読む
              </li>
              <li>
                <b>3</b> スマホの返答QRをPCで読む
              </li>
            </ol>
            <QrDisplay
              value={controllerUrl}
              label="① スマホ用ページを開くURL"
              url
            />
            {!code || code.startsWith('コード') ? (
              <Button className="wide" onClick={createOffer}>
                ② 接続QRを表示
              </Button>
            ) : (
              <QrDisplay
                value={code}
                label="② スマホ画面内のカメラで読み取る"
              />
            )}
            <QrScanner
              label="③ スマホの返答QRを読み取る"
              onScan={acceptAnswer}
            />
          </>
        ) : (
          <>
            <ol>
              <li>
                <b>1</b> PC画面で「② 接続QRを表示」を押す
              </li>
              <li>
                <b>2</b> 下の「② 接続QRを読み取る」を押し、PCのQRを読む
              </li>
              <li>
                <b>3</b> 表示された「③ 返答QR」をPCのカメラに見せる
              </li>
            </ol>
            {!code ? (
              <QrScanner label="② 接続QRを読み取る" onScan={acceptOffer} />
            ) : (
              <QrDisplay value={code} label="③ 返答QRをPCのカメラに見せる" />
            )}
          </>
        )}
        <details className="manual-pair">
          <summary>カメラが使えない場合</summary>
          <textarea
            value={remoteCode}
            onChange={(e) => setRemoteCode(e.target.value)}
            placeholder="接続コードを貼り付け"
          />
          <Button
            className="wide"
            disabled={!remoteCode}
            onClick={() => (host ? acceptAnswer() : acceptOffer())}
          >
            {host ? '接続を完了' : '返答コードを作る'}
          </Button>
          {code && <CodeBox code={code} />}
        </details>
        <p className="pair-note">
          ①だけがURLです。②と返答QRは画面内のカメラで読み取ります。
        </p>
      </section>
    </div>
  );
}
function CodeBox({ code }: { code: string }) {
  return (
    <div className="code-box">
      <span>{code}</span>
      <button
        onClick={() => navigator.clipboard.writeText(code)}
        aria-label="コピー"
      >
        <Copy />
      </button>
    </div>
  );
}

function QrDisplay({
  value,
  label,
  url = false,
}: {
  value: string;
  label: string;
  url?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current)
      void QRCode.toCanvas(canvas.current, value, {
        width: url ? 420 : 480,
        margin: url ? 5 : 3,
        errorCorrectionLevel: url ? 'H' : 'L',
        color: { dark: '#000000', light: '#ffffff' },
      }).catch(() => undefined);
  }, [value, url]);
  return (
    <div className={`qr-display ${url ? 'url-qr' : ''}`}>
      <span>{label}</span>
      <canvas ref={canvas} />
      {url && <small>{value}</small>}
    </div>
  );
}

function QrScanner({
  label,
  onScan,
}: {
  label: string;
  onScan: (value: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    scanCanvas = useRef<HTMLCanvasElement | null>(null),
    frame = useRef(0),
    stream = useRef<MediaStream | null>(null),
    onScanRef = useRef(onScan);
  const [active, setActive] = useState(false),
    [error, setError] = useState('');
  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setActive(false);
  }, []);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);
  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (!active || !video.current || !stream.current) return;
    let cancelled = false;
    const currentVideo = video.current;
    currentVideo.srcObject = stream.current;
    const scan = () => {
      if (cancelled) return;
      const v = video.current;
      if (!v || !v.videoWidth) {
        frame.current = requestAnimationFrame(scan);
        return;
      }
      const c =
        scanCanvas.current ||
        (scanCanvas.current = document.createElement('canvas'));
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx?.drawImage(v, 0, 0);
      const image = ctx?.getImageData(0, 0, c.width, c.height);
      const result =
        image &&
        jsQR(image.data, image.width, image.height, {
          inversionAttempts: 'attemptBoth',
        });
      if (result?.data) {
        stop();
        onScanRef.current(result.data);
        return;
      }
      frame.current = requestAnimationFrame(scan);
    };
    void currentVideo
      .play()
      .then(scan)
      .catch(() => {
        setError('カメラ映像を開始できませんでした');
        stop();
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame.current);
    };
  }, [active, stop]);
  const start = async () => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      setError('');
      setActive(true);
    } catch {
      setError('カメラを開けませんでした');
      setActive(false);
    }
  };
  return (
    <div className={`qr-scanner ${active ? 'active' : ''}`}>
      {active ? (
        <>
          <video ref={video} muted playsInline />
          <div className="scan-frame" />
          <button onClick={stop}>
            <X />
            中止
          </button>
        </>
      ) : (
        <Button className="scan-button" onClick={start}>
          <Camera />
          {label}
        </Button>
      )}
      {error && <small>{error}</small>}
    </div>
  );
}
