import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { canberraParts } from "../lib/clock";
import { CORE, GROUP_STUDY, OTHER_ROOMS, OUTLINE, type Rect, STACKS, VOIDS } from "../lib/floorplan";

// The core of the floor model. It draws Chifley Level 3 and its four
// bookable rooms and owns the one question every feature asks of a room:
// what does it look like right now? Features (src/scripts/floor3d-*.ts)
// don't draw rooms themselves; they get the Floor from `floorReady` and use
// its API: add to the scene, listen for selection and frames, hand it fresh
// bookings, or move the time it shows.

export interface RoomBooking {
  startTime: string;
  endTime: string;
  bookedBy: string;
}

// The board's rooms as index.astro renders them, carried on the figure's
// data-rooms attribute: the same bookings the list shows, so the model and
// the list can never disagree.
interface BoardRoom {
  id: number;
  code: string;
  active: boolean;
  who: string | null;
  bookings: RoomBooking[];
}

export interface FloorRoom {
  id: number;
  code: string;
  rect: Rect;
  mesh: THREE.Mesh;
  group: THREE.Group;
  tag: HTMLElement;
  bookings: RoomBooking[];
}

/** How a room looks: in use right now (red), booked at the time being
 *  viewed (ink), or free (green). */
export type RoomLook = "now" | "booked" | "free";

export interface Floor {
  figure: HTMLElement;
  stage: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  /** The date the board is showing, and whether that's today in Canberra. */
  date: string;
  isToday: boolean;
  rooms: FloorRoom[];
  /** Plan metres (src/lib/floorplan.ts) to world x/z; y is up. */
  toWorld: (x: number, y: number) => [number, number];
  /** World y of the floor's top surface, and a room's wall height. */
  floorY: number;
  wallHeight: number;
  reducedMotion: MediaQueryList;
  selected(): FloorRoom | null;
  onSelect(listener: (room: FloorRoom | null) => void): void;
  onFrame(listener: (seconds: number) => void): void;
  /** Called after any room's look is worked out again. */
  onChange(listener: () => void): void;
  /** Replace the bookings behind the model, by room id (live updates). */
  setBookings(byRoom: Record<number, RoomBooking[]>): void;
  /** Show the floor at a time of this date ("HH:MM"), or null for live. */
  setViewTime(time: string | null): void;
  viewTime(): string | null;
  lookOf(room: FloorRoom): { look: RoomLook; booking: RoomBooking | null };
}

let resolveFloor: (floor: Floor) => void;
/** Resolves once the model is mounted; never resolves without WebGL. */
export const floorReady = new Promise<Floor>((resolve) => {
  resolveFloor = resolve;
});

const INK = 0x23211d;
const LINE = 0xd8d2c4;
const SEAL = 0x8a3324;
const BOOKED = 0x4a4640;
const FREE = 0x4f9a64;

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

function label(text: string, className: string, rect: Rect, height: number, button = false): CSS2DObject {
  const el = document.createElement(button ? "button" : "div");
  if (el instanceof HTMLButtonElement) el.type = "button";
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
  const date = figure.dataset.date ?? "";

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
  const rooms: (FloorRoom & { lift: number })[] = [];
  for (const room of GROUP_STUDY) {
    const onBoard = board.find((b) => b.code === room.code);
    const mesh = box(room.rect, WALL, new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const group = outlined(mesh, INK);
    scene.add(group);
    const tag = label(room.label, "floor3d-label floor3d-label--room", room.rect, WALL, true);
    scene.add(tag);
    if (!onBoard) continue;
    mesh.userData.roomId = onBoard.id;
    pickable.push(mesh);
    rooms.push({
      id: onBoard.id,
      code: room.code,
      rect: room.rect,
      mesh,
      group,
      tag: tag.element,
      bookings: onBoard.bookings ?? [],
      lift: 1,
    });
  }

  // What each room looks like is decided here and only here. Live, a room is
  // red while a booking in it is happening now (today only). At a chosen
  // view time it's ink if booked then; red stays out of it, because red
  // means "now" and a view time isn't now.
  const isToday = date === canberraParts(new Date()).date;
  let viewTime: string | null = null;
  const covering = (bookings: RoomBooking[], time: string) =>
    bookings.find((b) => b.startTime <= time && time < b.endTime) ?? null;
  const lookOf = (room: FloorRoom): { look: RoomLook; booking: RoomBooking | null } => {
    if (viewTime === null) {
      const now = isToday ? covering(room.bookings, canberraParts(new Date()).time) : null;
      return now ? { look: "now", booking: now } : { look: "free", booking: null };
    }
    const at = covering(room.bookings, viewTime);
    return at ? { look: "booked", booking: at } : { look: "free", booking: null };
  };
  // One ordinary HTML card follows the selected room's existing screen label.
  // Selection stays on the map; only the explicit booking link leaves it.
  const info = document.createElement("section");
  info.className = "floor3d-info";
  info.id = "floor3d-info";
  info.hidden = true;
  info.tabIndex = -1;
  info.setAttribute("aria-labelledby", "floor3d-info-title");
  info.innerHTML = `
    <button type="button" class="floor3d-info__close" aria-label="Close room details">×</button>
    <h3 id="floor3d-info-title"></h3>
    <p class="floor3d-info__date"></p>
    <p class="floor3d-info__status" role="status"></p>
    <ul aria-label="Bookings for this day"></ul>
    <a href="#book">Book this room</a>`;
  stage.append(info);
  let detailRoom: FloorRoom | null = null;
  const renderInfo = () => {
    if (!detailRoom) return;
    info.querySelector("h3")!.textContent = `Room ${detailRoom.code}`;
    info.querySelector(".floor3d-info__date")!.textContent = date;
    const time = viewTime ?? (isToday ? canberraParts(new Date()).time : null);
    const current = time ? covering(detailRoom.bookings, time) : null;
    info.querySelector(".floor3d-info__status")!.textContent = time
      ? current ? `Booked at ${time} · until ${current.endTime}` : `Free at ${time}`
      : "Bookings for this day";
    const rows = detailRoom.bookings.map((booking) => {
      const item = document.createElement("li");
      item.textContent = `${booking.startTime}–${booking.endTime} · ${booking.bookedBy}`;
      return item;
    });
    if (!rows.length) {
      const empty = document.createElement("li");
      empty.textContent = "No bookings this day.";
      rows.push(empty);
    }
    info.querySelector("ul")!.replaceChildren(...rows);
  };
  const positionInfo = () => {
    if (info.hidden || !detailRoom) return;
    const anchor = detailRoom.tag.getBoundingClientRect();
    const bounds = stage.getBoundingClientRect();
    const x = anchor.left - bounds.left;
    const y = anchor.top - bounds.top;
    const width = info.offsetWidth;
    const height = info.offsetHeight;
    const left = x > stage.clientWidth - x - anchor.width ? x - width - 12 : x + anchor.width + 12;
    info.style.left = `${Math.max(8, Math.min(left, stage.clientWidth - width - 8))}px`;
    info.style.top = `${Math.max(8, Math.min(y - height / 2, stage.clientHeight - height - 8))}px`;
    info.style.visibility = anchor.width && x + anchor.width >= 0 && x <= stage.clientWidth
      && y + anchor.height >= 0 && y <= stage.clientHeight ? "visible" : "hidden";
  };
  const closeInfo = (restoreFocus = false) => {
    if (restoreFocus) detailRoom?.tag.focus({ preventScroll: true });
    detailRoom = null;
    info.hidden = true;
    for (const room of rooms) room.tag.setAttribute("aria-expanded", "false");
  };
  info.querySelector("button")!.addEventListener("click", () => closeInfo(true));
  stage.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !info.hidden) {
      event.stopPropagation();
      closeInfo(true);
    }
  });
  info.querySelector("a")!.addEventListener("click", () => {
    closeInfo();
    document.querySelector<HTMLInputElement>("#bookedBy")?.focus({ preventScroll: true });
  });

  // A taken room says when it frees up rather than who has it: the end of the
  // booking it's in, carried on through any booking that starts right then.
  const freesAt = (room: FloorRoom, booking: RoomBooking) => {
    let end = booking.endTime;
    for (let next = covering(room.bookings, end); next; next = covering(room.bookings, end)) end = next.endTime;
    return end >= "23:59" ? "busy rest of day" : `free at ${end}`;
  };
  const colours: Record<RoomLook, number> = { now: SEAL, booked: BOOKED, free: FREE };
  const changeListeners: (() => void)[] = [];
  const refresh = () => {
    // Green only means "free" when there's a time to be free at: today, or a
    // chosen view time. Another day with no time chosen stays plain.
    const hasTime = viewTime !== null || isToday;
    for (const room of rooms) {
      const { look, booking } = lookOf(room);
      const free = look === "free" && hasTime;
      (room.mesh.material as THREE.MeshLambertMaterial).color.setHex(
        look === "free" && !hasTime ? 0xffffff : colours[look],
      );
      room.tag.textContent = booking ? `${room.code} · ${freesAt(room, booking)}` : free ? `${room.code} · free` : room.code;
      room.tag.classList.toggle("floor3d-label--now", look === "now");
      room.tag.classList.toggle("floor3d-label--booked", look === "booked");
      room.tag.classList.toggle("floor3d-label--free", free);
    }
    renderInfo();
    for (const listener of changeListeners) listener();
  };
  refresh();
  // Live, "now" moves on its own: look again every so often, so a room goes
  // red (and stops) on the minute without waiting for a reload.
  setInterval(() => {
    if (viewTime === null) refresh();
  }, 20_000);

  // The room chosen in the booking form stands a little taller and takes a
  // ringed label: selection is a shape and ink, never the red, which stays
  // reserved for "happening now". #roomId is the one source of truth, and
  // the form and the model both speak to each other through its change event.
  const select = document.querySelector<HTMLSelectElement>("#roomId");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const selectListeners: ((room: FloorRoom | null) => void)[] = [];
  const selected = () => rooms.find((r) => r.id === Number(select?.value)) ?? null;
  const showSelected = () => {
    const chosen = selected();
    for (const r of rooms) {
      r.lift = r === chosen ? 1.4 : 1;
      r.tag.classList.toggle("floor3d-label--selected", r === chosen);
      if (reducedMotion.matches) r.group.scale.y = r.lift;
    }
    if (detailRoom && chosen) {
      detailRoom = chosen;
      renderInfo();
    }
    for (const r of rooms) r.tag.setAttribute("aria-expanded", String(r === detailRoom));
    for (const listener of selectListeners) listener(chosen);
  };
  select?.addEventListener("change", showSelected);
  showSelected();

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
  // Until someone turns the view themselves, it frames what fits the stage:
  // the whole floor on a wide one, and on a narrow (phone) one, where the
  // whole 88-metre floor would shrink the rooms to specks, the group study
  // rooms themselves.
  const frameDefault = () => {
    if (restored) return;
    if (camera.aspect >= 1.3) {
      controls.target.set(gx * 0.25, 0, gz * 0.25);
      camera.position.set(gx * 0.25, 72, 74);
    } else {
      controls.target.set(gx - 4, 0, gz);
      camera.position.set(gx - 4, 34, gz + 30);
    }
    controls.update();
  };
  controls.addEventListener("start", () => {
    restored = true;
  });
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
    frameDefault();
  };
  new ResizeObserver(resize).observe(stage);
  resize();

  // A click (not the end of a drag) on a bookable room picks it in the
  // booking form, so the model is a way into booking, not just a picture.
  const openInfo = (room: FloorRoom) => {
    detailRoom = room;
    if (select) {
      select.value = String(room.id);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    renderInfo();
    info.hidden = false;
    positionInfo();
    info.focus({ preventScroll: true });
  };
  for (const room of rooms) {
    room.tag.setAttribute("aria-label", `View room ${room.code}`);
    room.tag.setAttribute("aria-controls", info.id);
    room.tag.addEventListener("click", () => openInfo(room));
  }
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: [number, number] | null = null;
  const pick = (event: PointerEvent): THREE.Mesh | undefined => {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    // Picking can't lean on the render loop having run since the view last
    // moved (a backgrounded tab pauses it), so bring the camera up to date.
    controls.update();
    camera.updateMatrixWorld();
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
    if (!hit) return closeInfo();
    const room = rooms.find((r) => r.id === hit.userData.roomId);
    if (room) openInfo(room);
  });

  const frameListeners: ((seconds: number) => void)[] = [];
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const seconds = clock.getDelta();
    for (const r of rooms) r.group.scale.y += (r.lift - r.group.scale.y) * 0.15;
    for (const listener of frameListeners) listener(seconds);
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
    positionInfo();
  });

  resolveFloor({
    figure,
    stage,
    scene,
    camera,
    controls,
    renderer,
    date,
    isToday,
    rooms,
    toWorld,
    floorY: SLAB,
    wallHeight: WALL,
    reducedMotion,
    selected,
    onSelect: (listener) => {
      selectListeners.push(listener);
      listener(selected());
    },
    onFrame: (listener) => {
      frameListeners.push(listener);
    },
    onChange: (listener) => {
      changeListeners.push(listener);
    },
    setBookings: (byRoom) => {
      for (const r of rooms) r.bookings = byRoom[r.id] ?? [];
      refresh();
    },
    setViewTime: (time) => {
      viewTime = time;
      refresh();
    },
    viewTime: () => viewTime,
    lookOf,
  });
}

for (const figure of document.querySelectorAll<HTMLElement>(".floor3d")) mount(figure);
