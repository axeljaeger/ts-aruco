// Generates site/public/models/airplane.glb, a small low-poly propeller plane.
//
// The model is built here from boxes and a lathed fuselage so the demo site ships no third-party
// art. It follows the glTF conventions: metres, +Y up, nose towards +Z. Its total length is about
// 1.5 units. The propeller is a separate node named "propeller" so the demos can spin it.
//
// Usage: node scripts/make-airplane.mjs [output.glb]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const out = process.argv[2] ?? "site/public/models/airplane.glb";

const MATERIALS = {
  body: { color: [0.96, 0.76, 0.22], metallic: 0.1, roughness: 0.55 },
  wing: { color: [0.82, 0.13, 0.1], metallic: 0.1, roughness: 0.5 },
  glass: { color: [0.35, 0.65, 0.95], metallic: 0.3, roughness: 0.15 },
  dark: { color: [0.12, 0.12, 0.14], metallic: 0.4, roughness: 0.6 },
  white: { color: [0.95, 0.95, 0.93], metallic: 0.05, roughness: 0.6 },
};

/** Flat shaded triangle soup per material. */
class MeshBuilder {
  constructor() {
    this.parts = new Map();
  }

  part(material) {
    if (!this.parts.has(material)) {
      this.parts.set(material, { positions: [], normals: [] });
    }
    return this.parts.get(material);
  }

  tri(material, a, b, c) {
    const u = sub(b, a);
    const v = sub(c, a);
    const n = normalize(cross(u, v));
    const p = this.part(material);
    p.positions.push(...a, ...b, ...c);
    p.normals.push(...n, ...n, ...n);
  }

  quad(material, a, b, c, d) {
    this.tri(material, a, b, c);
    this.tri(material, a, c, d);
  }

  /** A box given by its centre and half sizes, then transformed by `xf` (a point -> point fn). */
  box(material, [cx, cy, cz], [hx, hy, hz], xf = (p) => p) {
    const v = (sx, sy, sz) => xf([cx + sx * hx, cy + sy * hy, cz + sz * hz]);
    const p = [
      v(-1, -1, -1),
      v(1, -1, -1),
      v(1, 1, -1),
      v(-1, 1, -1),
      v(-1, -1, 1),
      v(1, -1, 1),
      v(1, 1, 1),
      v(-1, 1, 1),
    ];
    this.quad(material, p[0], p[3], p[2], p[1]); // -z
    this.quad(material, p[4], p[5], p[6], p[7]); // +z
    this.quad(material, p[0], p[1], p[5], p[4]); // -y
    this.quad(material, p[3], p[7], p[6], p[2]); // +y
    this.quad(material, p[0], p[4], p[7], p[3]); // -x
    this.quad(material, p[1], p[2], p[6], p[5]); // +x
  }

  /**
   * Surface of revolution around the z axis. `profile` is a list of [z, radius, material] rings
   * from back to front; a ring with radius 0 closes the surface. `squash` scales y.
   */
  lathe(profile, segments, { squash = 1, offset = [0, 0, 0] } = {}) {
    const ring = (z, r) =>
      Array.from({ length: segments }, (_, i) => {
        const a = (i / segments) * Math.PI * 2;
        return [offset[0] + Math.cos(a) * r, offset[1] + Math.sin(a) * r * squash, offset[2] + z];
      });

    for (let k = 0; k + 1 < profile.length; ++k) {
      const [z0, r0] = profile[k];
      const [z1, r1, material] = profile[k + 1];
      const a = ring(z0, r0);
      const b = ring(z1, r1);
      for (let i = 0; i < segments; ++i) {
        const j = (i + 1) % segments;
        if (r0 === 0) {
          this.tri(material, a[i], b[j], b[i]);
        } else if (r1 === 0) {
          this.tri(material, a[i], a[j], b[i]);
        } else {
          this.quad(material, a[i], a[j], b[j], b[i]);
        }
      }
    }
  }
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Rotation around z by `deg`, used for wing dihedral. */
function rollZ(deg, pivot = [0, 0, 0]) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return ([x, y, z]) => {
    const dx = x - pivot[0];
    const dy = y - pivot[1];
    return [pivot[0] + dx * c - dy * s, pivot[1] + dx * s + dy * c, z];
  };
}

// --- Body ---------------------------------------------------------------------------------------

const body = new MeshBuilder();

body.lathe(
  [
    [-0.78, 0],
    [-0.76, 0.035, "body"],
    [-0.45, 0.085, "body"],
    [-0.1, 0.14, "body"],
    [0.25, 0.155, "body"],
    [0.42, 0.15, "wing"],
    [0.52, 0.13, "wing"],
    [0.56, 0.1, "dark"],
    [0.56, 0, "dark"],
  ],
  12,
  { squash: 1.1 },
);

// Spinner.
body.lathe(
  [
    [0.55, 0],
    [0.55, 0.065, "white"],
    [0.6, 0.06, "white"],
    [0.68, 0, "white"],
  ],
  10,
);

// Canopy.
body.lathe(
  [
    [-0.12, 0],
    [-0.1, 0.06, "glass"],
    [0.02, 0.09, "glass"],
    [0.14, 0.075, "glass"],
    [0.2, 0, "glass"],
  ],
  10,
  { squash: 0.9, offset: [0, 0.12, 0] },
);

// Main wings with a little dihedral, plus white tips.
for (const side of [-1, 1]) {
  const roll = rollZ(side * 5, [0, -0.06, 0]);
  body.box("wing", [side * 0.42, -0.06, 0.1], [0.34, 0.022, 0.17], roll);
  body.box("white", [side * 0.8, -0.06, 0.1], [0.04, 0.024, 0.165], roll);
}

// Tailplane and fin.
body.box("wing", [0, 0.0, -0.66], [0.3, 0.015, 0.09]);
body.box("wing", [0, 0.14, -0.67], [0.015, 0.14, 0.09], ([x, y, z]) => [
  x,
  y,
  z - (y - 0.0) * 0.35,
]);

// Landing gear: struts and wheels.
for (const side of [-1, 1]) {
  body.box(
    "dark",
    [side * 0.17, -0.2, 0.22],
    [0.015, 0.09, 0.015],
    rollZ(side * -12, [side * 0.17, -0.11, 0]),
  );
  body.box("dark", [side * 0.2, -0.3, 0.22], [0.025, 0.05, 0.05]);
}

// --- Propeller (separate node, spins around its local z) -----------------------------------------

const prop = new MeshBuilder();
prop.box("dark", [0, 0.17, 0], [0.025, 0.17, 0.008], rollZ(0));
prop.box("dark", [0, -0.17, 0], [0.025, 0.17, 0.008], rollZ(0));

// --- glTF writer ---------------------------------------------------------------------------------

const materialNames = Object.keys(MATERIALS);
const gltf = {
  asset: { version: "2.0", generator: "ts-aruco make-airplane.mjs" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { name: "airplane", mesh: 0, children: [1] },
    { name: "propeller", mesh: 1, translation: [0, 0, 0.62] },
  ],
  meshes: [],
  materials: materialNames.map((name) => {
    const m = MATERIALS[name];
    return {
      name,
      pbrMetallicRoughness: {
        baseColorFactor: [...m.color, 1],
        metallicFactor: m.metallic,
        roughnessFactor: m.roughness,
      },
    };
  }),
  accessors: [],
  bufferViews: [],
  buffers: [],
};

const chunks = [];
let byteLength = 0;

function addAccessor(data, withBounds) {
  const bytes = Buffer.from(new Float32Array(data).buffer);
  gltf.bufferViews.push({
    buffer: 0,
    byteOffset: byteLength,
    byteLength: bytes.length,
    target: 34962,
  });
  chunks.push(bytes);
  byteLength += bytes.length;

  const accessor = {
    bufferView: gltf.bufferViews.length - 1,
    componentType: 5126,
    count: data.length / 3,
    type: "VEC3",
  };
  if (withBounds) {
    const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (let i = 0; i < data.length; i += 3) {
      for (let k = 0; k < 3; ++k) {
        min[k] = Math.min(min[k], data[i + k]);
        max[k] = Math.max(max[k], data[i + k]);
      }
    }
    accessor.min = min;
    accessor.max = max;
  }
  gltf.accessors.push(accessor);
  return gltf.accessors.length - 1;
}

function addMesh(name, builder) {
  const primitives = [];
  for (const [material, part] of builder.parts) {
    primitives.push({
      attributes: {
        POSITION: addAccessor(part.positions, true),
        NORMAL: addAccessor(part.normals, false),
      },
      material: materialNames.indexOf(material),
    });
  }
  gltf.meshes.push({ name, primitives });
}

addMesh("airplane", body);
addMesh("propeller", prop);

const bin = Buffer.concat(chunks);
gltf.buffers.push({ byteLength: bin.length });

const pad = (buf, fill) => {
  const rest = (4 - (buf.length % 4)) % 4;
  return rest ? Buffer.concat([buf, Buffer.alloc(rest, fill)]) : buf;
};

const json = pad(Buffer.from(JSON.stringify(gltf)), 0x20);
const binChunk = pad(bin, 0);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + binChunk.length, 8);

const chunkHeader = (len, type) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(len, 0);
  b.writeUInt32LE(type, 4);
  return b;
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  Buffer.concat([
    header,
    chunkHeader(json.length, 0x4e4f534a),
    json,
    chunkHeader(binChunk.length, 0x004e4942),
    binChunk,
  ]),
);

const triangles = [...body.parts.values(), ...prop.parts.values()].reduce(
  (n, p) => n + p.positions.length / 9,
  0,
);
console.log(`wrote ${out}: ${triangles} triangles`);
