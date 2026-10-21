import * as THREE from 'three';

import {
  type CarState,
  type Collider,
  TRACK_LENGTH,
  trackPose,
} from '@/lib/game/track';

export type ThreeWorld = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  car: THREE.Group;
  wheels: THREE.Mesh[];
  road: THREE.Group;
  sun: THREE.DirectionalLight;
  colliders: Collider[];
};
/** 道路、障害物、ゲート、車、照明を含むThree.jsワールドを構築する。 */
export function createThreeWorld(canvas: HTMLCanvasElement): ThreeWorld {
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
  const colliders: Collider[] = [];
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

/** 車の状態へ3Dモデルと追従カメラを同期し、1フレーム描画する。 */
/** 車の状態へ3Dモデルと追従カメラを同期し、1フレーム描画する。 */
export function renderThree(
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

/** Three.jsで確保したGPUリソースを画面破棄時に解放する。 */
/** Three.jsで確保したGPUリソースを画面破棄時に解放する。 */
export function disposeThreeWorld(world: ThreeWorld) {
  world.renderer.dispose();
  world.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

/** PCのゲーム画面とスマホコントローラー画面を統括する。 */
