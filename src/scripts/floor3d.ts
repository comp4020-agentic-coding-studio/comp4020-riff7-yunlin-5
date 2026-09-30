import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { CORE, GROUP_STUDY, OTHER_ROOMS, OUTLINE, type Rect, STACKS, VOIDS } from "../lib/floorplan";

// The board's rooms as index.astro renders them, carried on the figure's
// data-rooms attribute: the same "happening now" answer the list shows, so
// the model and the list can never disagree.
interface BoardRoom {
  id: number;
  code: string;
  active: boolean;
  who: string | null;
}

const INK = 0x23211d;
const LINE = 0xd8d2c4;
const SEAL = 0x8a3324;

const SLAB = 0.4;
const WALL = 2.8;
const SHELF = 1.6;

// Plan space (x east, y south, see src/lib/floorplan.ts) laid into world
// space so the floor's long axis runs across the screen: north to the right,
// east toward the viewer, which is where the group study rooms sit.
const CENTRE_X = 18.7;
const CENTRE_Y = 43.85;
const toWorld = (x: number, y: number): [number, number] => [CENTRE_Y - y, x - CENTRE_X];

function box(rect: Rect, height: number, material: THREE.Material): THREE.Mesh {
  const [xa, za] = toWorld(rect.x0, rect.y0);
  const [xb, zb] = toWorld(rect.x1, rect.y1);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(xb - xa), height, Math.abs(zb - za)), material);
  mesh.position.set((xa + xb) / 2, SLAB + height / 2, (za + zb) / 2);
  return mesh;
}

function outlined(mesh: THREE.Mesh, colour: number): THREE.Group {
  const group = new THREE.Group();
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: colour }),
  );
  edges.position.copy(mesh.position);
  group.add(mesh, edges);
  return group;
}

function label(text: string, className: string, rect: Rect, height: number): CSS2DObject {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  const [xa, za] = toWorld(rect.x0, rect.y0);
  const [xb, zb] = toWorld(rect.x1, rect.y1);
  const object = new CSS2DObject(el);
  object.position.set((xa + xb) / 2, SLAB + height + 0.6, (za + zb) / 2);
  return object;
}

function slab(): THREE.Group {
  const shape = new THREE.Shape();
  OUTLINE.forEach(([x, y], i) => {
    const [wx, wz] = toWorld(x, y);
    // ExtrudeGeometry builds in its own XY plane; rotating it flat below
    // maps shape-y to world -z.
    if (i === 0) shape.moveTo(wx, -wz);
    else shape.lineTo(wx, -wz);
  });
  for (const v of VOIDS) {
    const hole = new THREE.Path();
    const corners: [number, number][] = [
      [v.x0, v.y0],
      [v.x1, v.y0],
      [v.x1, v.y1],
      [v.x0, v.y1],
    ];
    corners.forEach(([x, y], i) => {
      const [wx, wz] = toWorld(x, y);
      if (i === 0) hole.moveTo(wx, -wz);
      else hole.lineTo(wx, -wz);
    });
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: SLAB, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: INK }));
  const group = new THREE.Group();
  group.add(mesh, edges);
  return group;
}

const CAMERA_KEY = "floor3d-camera";

function mount(figure: HTMLElement): void {
  const stage = figure.querySelector<HTMLElement>(".floor3d-stage");
  if (!stage) return;
  const board: BoardRoom[] = JSON.parse(figure.dataset.rooms ?? "[]");

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    // No WebGL: the list below the figure already says everything the
    // model does, so the model just steps aside.
    figure.hidden = true;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.setAttribute("aria-hidden", "true");
  stage.append(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = "floor3d-labels";
  stage.append(labels.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(30, 60, 40);
  scene.add(sun);

  scene.add(slab());

  const shelf = new THREE.MeshLambertMaterial({ color: LINE });
  for (const s of STACKS) scene.add(outlined(box(s.rect, SHELF, shelf), 0xa39c8c));
  const core = new THREE.MeshLambertMaterial({ color: 0xe4dfd3 });
  for (const c of CORE) scene.add(outlined(box(c.rect, WALL, core), 0xa39c8c));
  const other = new THREE.MeshLambertMaterial({ color: 0xebe6da });
  for (const o of OTHER_ROOMS) {
    scene.add(outlined(box(o.rect, WALL, other), 0xa39c8c));
    scene.add(label(o.label, "floor3d-label floor3d-label--quiet", o.rect, WALL));
  }

  // The bookable rooms: the only things on the floor that can go red, and
  // only while a booking in them is happening right now.
  const pickable: THREE.Mesh[] = [];
  for (const room of GROUP_STUDY) {
    const onBoard = board.find((b) => b.code === room.code);
    const active = onBoard?.active ?? false;
    const material = new THREE.MeshLambertMaterial({ color: active ? SEAL : 0xffffff });
    const mesh = box(room.rect, WALL, material);
    if (onBoard) {
      mesh.userData.roomId = onBoard.id;
      pickable.push(mesh);
    }
    scene.add(outlined(mesh, INK));
    const text = active && onBoard?.who ? `${room.label} · ${onBoard.who}` : room.label;
    scene.add(label(text, `floor3d-label${active ? " floor3d-label--now" : ""}`, room.rect, WALL));
  }

  const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.minDistance = 15;
  controls.maxDistance = 160;

  // The board reloads itself whenever any booking changes (see index.astro),
  // so the view a person has turned to is kept across that reload.
  const [gx, gz] = toWorld(29.3, 26.5);
  let restored = false;
  try {
    const saved = JSON.parse(sessionStorage.getItem(CAMERA_KEY) ?? "null");
    if (saved) {
      camera.position.fromArray(saved.position);
      controls.target.fromArray(saved.target);
      restored = true;
    }
  } catch {
    // storage unavailable: fall through to the default view
  }
  if (!restored) {
    // The whole floor in frame, nudged toward the group study rooms.
    controls.target.set(gx * 0.25, 0, gz * 0.25);
    camera.position.set(gx * 0.25, 95, 100);
  }
  controls.update();
  controls.addEventListener("end", () => {
    try {
      sessionStorage.setItem(
        CAMERA_KEY,
        JSON.stringify({ position: camera.position.toArray(), target: controls.target.toArray() }),
      );
    } catch {
      // not worth failing over
    }
  });

  const resize = () => {
    const { width, height } = stage.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height);
    labels.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(stage);
  resize();

  // A click (not the end of a drag) on a bookable room picks it in the
  // booking form, so the model is a way into booking, not just a picture.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: [number, number] | null = null;
  const pick = (event: PointerEvent): THREE.Mesh | undefined => {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(pickable, false)[0]?.object as THREE.Mesh | undefined;
  };
  renderer.domElement.addEventListener("pointerdown", (e) => {
    downAt = [e.clientX, e.clientY];
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    renderer.domElement.style.cursor = pick(e) ? "pointer" : "grab";
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const hit = pick(e);
    if (!hit) return;
    const select = document.querySelector<HTMLSelectElement>("#roomId");
    if (select) select.value = String(hit.userData.roomId);
    const form = document.querySelector<HTMLElement>(".book-form");
    form?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.querySelector<HTMLInputElement>("#bookedBy")?.focus({ preventScroll: true });
  });

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });
}

for (const figure of document.querySelectorAll<HTMLElement>(".floor3d")) mount(figure);
