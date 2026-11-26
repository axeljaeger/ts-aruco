/**
 * WGSL compute shaders for the WebGPU preprocessing passes.
 *
 * Images are stored in storage buffers with 4 pixels packed into each u32 (little endian, the
 * leftmost pixel in the lowest byte) and rows padded to `pw = ceil(width / 4)` words. With a
 * width divisible by 4 the bytes are exactly a row-major 8 bit image.
 */

const PARAMS = /* wgsl */ `
struct Params {
  width: u32,
  height: u32,
  pw: u32,
  kernel: u32,
  mult: u32,
  shift: u32,
  threshold: i32,
  flipY: u32,
}
@group(0) @binding(0) var<uniform> P: Params;
`;

export const WORKGROUP_SIZE = 8;

/** Greyscale pass. `external` selects `texture_external` (video) or `texture_2d<f32>`. */
export function greyShader(external: boolean): string {
  const textureType = external ? "texture_external" : "texture_2d<f32>";
  const load = external ? "textureLoad(src, vec2u(x, y))" : "textureLoad(src, vec2u(x, y), 0)";
  return `${PARAMS}
@group(0) @binding(1) var src: ${textureType};
@group(0) @binding(2) var<storage, read_write> grey: array<u32>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.pw || id.y >= P.height) { return; }
  let y = select(id.y, P.height - 1u - id.y, P.flipY == 1u);
  var packed = 0u;
  for (var i = 0u; i < 4u; i++) {
    let x = id.x * 4u + i;
    if (x < P.width) {
      let c = vec3u(round(${load}.rgb * 255.0));
      let g = (299u * c.r + 587u * c.g + 114u * c.b + 500u) / 1000u;
      packed |= g << (8u * i);
    }
  }
  grey[id.y * P.pw + id.x] = packed;
}
`;
}

/** Horizontal box blur, same integer arithmetic as js-aruco's stackBoxBlur. */
export const BLUR_H_SHADER = /* wgsl */ `${PARAMS}
@group(0) @binding(1) var<storage, read> grey: array<u32>;
@group(0) @binding(2) var<storage, read_write> blur: array<u32>;

fn greyAt(x: i32, y: u32) -> u32 {
  let cx = u32(clamp(x, 0, i32(P.width) - 1));
  return (grey[y * P.pw + cx / 4u] >> (8u * (cx % 4u))) & 255u;
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.pw || id.y >= P.height) { return; }
  let k = i32(P.kernel);
  var packed = 0u;
  for (var i = 0u; i < 4u; i++) {
    let x = id.x * 4u + i;
    if (x < P.width) {
      var sum = 0u;
      for (var j = -k; j <= k; j++) {
        sum += greyAt(i32(x) + j, id.y);
      }
      packed |= ((sum * P.mult) >> P.shift) << (8u * i);
    }
  }
  blur[id.y * P.pw + id.x] = packed;
}
`;

/** Vertical box blur plus adaptive threshold: 255 where grey - blur <= -threshold. */
export const THRESHOLD_SHADER = /* wgsl */ `${PARAMS}
@group(0) @binding(1) var<storage, read> grey: array<u32>;
@group(0) @binding(2) var<storage, read> blur: array<u32>;
@group(0) @binding(3) var<storage, read_write> mask: array<u32>;

fn blurAt(x: u32, y: i32) -> u32 {
  let cy = u32(clamp(y, 0, i32(P.height) - 1));
  return (blur[cy * P.pw + x / 4u] >> (8u * (x % 4u))) & 255u;
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.pw || id.y >= P.height) { return; }
  let k = i32(P.kernel);
  let greyWord = grey[id.y * P.pw + id.x];
  var packed = 0u;
  for (var i = 0u; i < 4u; i++) {
    let x = id.x * 4u + i;
    if (x < P.width) {
      var sum = 0u;
      for (var j = -k; j <= k; j++) {
        sum += blurAt(x, i32(id.y) + j);
      }
      let b = i32((sum * P.mult) >> P.shift);
      let g = i32((greyWord >> (8u * i)) & 255u);
      if (g - b <= -P.threshold) {
        packed |= 255u << (8u * i);
      }
    }
  }
  mask[id.y * P.pw + id.x] = packed;
}
`;
