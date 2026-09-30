import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { ARRIVALS, type Point, WAYPOINTS, describeWalk, routeTo, walkPoints } from "../lib/floorplan";
import { type Floor, type FloorRoom, floorReady } from "./floor3d";
import "../styles/floor3d-route.css";

// Directions to the room. When a room is chosen, a route draws itself along
// the floor from the lifts to that room's door, marks where the stairs join
// it, and then flows gently toward the door. The same way is written out in
// words beside the model (the sidebar’s .floor3d-route slot), so it doesn't
// depend on seeing the canvas. The walk itself (which waypoints, which
// door) comes from src/lib/floorplan.ts; this file only draws and says it.
//
// Colour: ink, and a muted ink for the quieter parts. Never the red, which
// means only "a booking happening right now".

const INK = 0x23211d;
const MUTED = 0x8c8578;
const LIFT = 0.05; // above the floor's top, clear of z-fighting
const WIDTH = 0.8;
const DASH = 1.5;
const GAP = 1;
const FLOW = 1.4; // metres a second

const vertexShader = /* glsl */ `
  attribute float along;
  varying float vAlong;
  void main() {
    vAlong = along;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Everything past `reveal` metres is not drawn yet; with a gap, the ribbon
// is cut into dashes that move forward as `offset` grows.
const fragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  uniform float reveal;
  uniform float offset;
  uniform float dash;
  uniform float gap;
  varying float vAlong;
  void main() {
    if (vAlong > reveal) discard;
    if (gap > 0.0 && mod(vAlong - offset, dash + gap) > dash) discard;
    gl_FragColor = vec4(color, opacity);
    #include <colorspace_fragment>
  }
`;

interface Ribbon {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  length: number;
}

/** A flat ribbon along a polyline of world (x, z) points, mitred at the
 *  corners, carrying each vertex's distance along the line. */
function ribbon(points: [number, number][], y: number, colour: number, opacity: number, dashed: boolean): Ribbon {
  const positions: number[] = [];
  const along: number[] = [];
  const index: number[] = [];
  let length = 0;
  const dir = (a: [number, number], b: [number, number]) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d] as const;
  };
  points.forEach((p, i) => {
    if (i > 0) length += Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]);
    const before = dir(points[Math.max(0, i - 1)], points[Math.max(1, i)]);
    const after = dir(points[Math.min(points.length - 2, i)], points[Math.min(points.length - 1, i + 1)]);
    // Normals in the floor plane, averaged at a corner and stretched so the
    // ribbon keeps its width through the turn.
    const nb = [-before[1], before[0]];
    const na = [-after[1], after[0]];
    let nx = nb[0] + na[0];
    let nz = nb[1] + na[1];
    const n = Math.hypot(nx, nz) || 1;
    nx /= n;
    nz /= n;
    const stretch = 1 / Math.max(0.35, nx * nb[0] + nz * nb[1]);
    const half = (WIDTH / 2) * stretch;
    positions.push(p[0] + nx * half, y, p[1] + nz * half, p[0] - nx * half, y, p[1] - nz * half);
    along.push(length, length);
    if (i > 0) {
      const k = i * 2;
      index.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("along", new THREE.Float32BufferAttribute(along, 1));
  geometry.setIndex(index);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      color: { value: new THREE.Color(colour) },
      opacity: { value: opacity },
      reveal: { value: length },
      offset: { value: 0 },
      dash: { value: DASH },
      gap: { value: dashed ? GAP : 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  return { mesh, length };
}

function disc(at: [number, number], y: number, inner: number, outer: number, colour: number, opacity: number): THREE.Mesh {
  const geometry = inner > 0 ? new THREE.RingGeometry(inner, outer, 40) : new THREE.CircleGeometry(outer, 40);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.position.set(at[0], y + 0.01, at[1]);
  mesh.renderOrder = 3;
  return mesh;
}

function tag(text: string, at: [number, number], y: number, modifier = ""): CSS2DObject {
  const el = document.createElement("div");
  el.className = `floor3d-route-label${modifier ? ` floor3d-route-label--${modifier}` : ""}`;
  el.textContent = text;
  const object = new CSS2DObject(el);
  object.position.set(at[0], y, at[1]);
  return object;
}

function directions(slot: HTMLElement, room: FloorRoom | null): void {
  slot.replaceChildren();
  if (!room) {
    slot.hidden = true;
    return;
  }
  const title = document.createElement("span");
  title.className = "floor3d-route__title";
  title.textContent = `Getting to ${room.code}`;
  slot.append(title);
  for (const arrival of ARRIVALS) {
    const walk = routeTo(room.code, arrival.id);
    if (!walk) continue;
    const line = document.createElement("span");
    line.className = "floor3d-route__way";
    const from = document.createElement("strong");
    from.textContent = `${arrival.from}:`;
    line.append(from, ` ${describeWalk(walk, room.code)}`);
    slot.append(line);
  }
  slot.hidden = false;
}

function mount(floor: Floor): void {
  const slot = document.querySelector<HTMLElement>(".floor3d-route");
  const y = floor.floorY + LIFT;
  const world = ([x, py]: Point): [number, number] => floor.toWorld(x, py);

  let group: THREE.Group | null = null;
  let labels: CSS2DObject[] = [];
  let ribbons: Ribbon[] = [];
  let pulse: THREE.Mesh | null = null;
  let elapsed = 0;

  const clear = () => {
    // A CSS2DObject takes its element out of the page only when it is itself
    // removed, not when its parent is, so labels go one by one.
    for (const label of labels) label.removeFromParent();
    labels = [];
    group?.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    group?.removeFromParent();
    group = null;
    ribbons = [];
    pulse = null;
  };

  const draw = (room: FloorRoom | null) => {
    clear();
    if (slot) directions(slot, room);
    if (!room) return;
    const main = routeTo(room.code, "lifts");
    if (!main) return;
    group = new THREE.Group();
    group.name = "floor3d-route";

    const points = walkPoints(main).map(world);
    // A faint solid path underneath, so the way reads even between dashes.
    const under = ribbon(points, y, INK, 0.16, false);
    const dashes = ribbon(points, y, INK, 0.9, true);
    // The last stretch runs along the far side of the rooms from most
    // views, so a faint copy of the dashes shows through walls and shelves.
    const ghost = ribbon(points, y, INK, 0.28, true);
    ghost.mesh.material.depthTest = false;
    ghost.mesh.renderOrder = 4;
    group.add(under.mesh, dashes.mesh, ghost.mesh);
    ribbons.push(under, dashes, ghost);

    // The stairs join the lifts' route partway: draw only the stretch that
    // isn't already on it (on this plan, none), then mark where they join.
    const stairs = routeTo(room.code, "stairs");
    if (stairs) {
      const joins = stairs.findIndex((id) => main.includes(id));
      const own = stairs.slice(0, joins + 1);
      if (own.length > 1) {
        const extra = ribbon(walkPoints(own).map(world), y, MUTED, 0.7, true);
        group.add(extra.mesh);
        ribbons.push(extra);
      }
      const at = world(WAYPOINTS[stairs[0]].at);
      group.add(disc(at, y, 0.35, 0.6, INK, 0.9));
      // Set a little south-west of the marker, clear of 3.07's own label.
      labels.push(tag("Stairs", [at[0] - 2.5, at[1] - 1], y + 0.4));
    }

    const start = points[0];
    group.add(disc(start, y, 0, 0.7, INK, 0.95));
    labels.push(tag("Lifts", start, y + 1.1));

    const door = points[points.length - 1];
    const doorRing = disc(door, y, 0.55, 0.8, INK, 0.9);
    const doorGhost = disc(door, y, 0.55, 0.8, INK, 0.3);
    (doorGhost.material as THREE.Material).depthTest = false;
    doorGhost.renderOrder = 4;
    pulse = disc(door, y, 0.8, 1.0, MUTED, 0.5);
    group.add(doorRing, doorGhost, pulse);

    for (const label of labels) group.add(label);
    floor.scene.add(group);

    elapsed = 0;
    if (!floor.reducedMotion.matches) for (const r of ribbons) r.mesh.material.uniforms.reveal.value = 0;
  };

  floor.onFrame((seconds) => {
    if (!group) return;
    if (floor.reducedMotion.matches) {
      // Just show it: whole, still.
      for (const r of ribbons) {
        r.mesh.material.uniforms.reveal.value = r.length;
        r.mesh.material.uniforms.offset.value = 0;
      }
      if (pulse) pulse.scale.setScalar(1);
      return;
    }
    elapsed += seconds;
    for (const r of ribbons) {
      const u = r.mesh.material.uniforms;
      // Draws itself in over about a second, easing out, then flows.
      const duration = Math.min(1.6, Math.max(0.6, r.length / 30));
      const t = Math.min(1, elapsed / duration);
      u.reveal.value = r.length * (1 - (1 - t) ** 3);
      u.offset.value = (u.offset.value + seconds * FLOW) % (DASH + GAP);
    }
    if (pulse) pulse.scale.setScalar(1 + 0.25 * (0.5 + 0.5 * Math.sin(elapsed * 2.5)));
  });

  floor.onSelect(draw);
}

floorReady.then(mount);
