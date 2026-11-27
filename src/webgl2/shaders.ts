/** GLSL ES 3.00 sources for the WebGL2 preprocessing passes. */

export const VERTEX_SHADER = `#version 300 es
void main() {
  // Fullscreen triangle without vertex buffers.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * RGBA -> grey, integer version of js-aruco's (r*0.299 + g*0.587 + b*0.114 + 0.5) | 0.
 * Differs from the double precision original by -1 for about 0.02% of all colours, where the
 * exact result is an integer and the original rounds down.
 */
export const GREY_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform sampler2D uSource;
uniform bool uFlipY;
uniform int uHeight;
out uint outGrey;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (uFlipY) p.y = uHeight - 1 - p.y;
  uvec3 c = uvec3(round(texelFetch(uSource, p, 0).rgb * 255.0));
  outGrey = (299u * c.r + 587u * c.g + 114u * c.b + 500u) / 1000u;
}
`;

/**
 * Horizontal pass of js-aruco's stackBoxBlur: a box filter of width 2k+1 with clamp-to-edge,
 * scaled with the same integer multiply and shift.
 */
export const BLUR_H_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uGrey;
uniform int uKernel;
uniform uint uMult;
uniform uint uShift;
out uint outBlur;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int last = textureSize(uGrey, 0).x - 1;
  uint sum = 0u;
  for (int i = -uKernel; i <= uKernel; ++i) {
    sum += texelFetch(uGrey, ivec2(clamp(p.x + i, 0, last), p.y), 0).r;
  }
  outBlur = (sum * uMult) >> uShift;
}
`;

/**
 * Vertical blur pass plus adaptive threshold. Each fragment handles 4 horizontally adjacent
 * pixels and writes them packed into RGBA8 targets, so readPixels yields plain 8 bit rows.
 */
export const THRESHOLD_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uGrey;
uniform usampler2D uBlurH;
uniform int uKernel;
uniform uint uMult;
uniform uint uShift;
uniform int uThreshold;
layout(location = 0) out vec4 outGrey;
layout(location = 1) out vec4 outThreshold;

void pixel(int x, int y, ivec2 size, out float grey, out float mask) {
  if (x >= size.x) {
    grey = 0.0;
    mask = 0.0;
    return;
  }
  uint sum = 0u;
  for (int i = -uKernel; i <= uKernel; ++i) {
    sum += texelFetch(uBlurH, ivec2(x, clamp(y + i, 0, size.y - 1)), 0).r;
  }
  int blur = int((sum * uMult) >> uShift);
  int g = int(texelFetch(uGrey, ivec2(x, y), 0).r);
  grey = float(g) / 255.0;
  mask = g - blur <= -uThreshold ? 1.0 : 0.0;
}

void main() {
  ivec2 size = textureSize(uGrey, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  int x = p.x * 4;
  vec4 g;
  vec4 m;
  pixel(x, p.y, size, g.r, m.r);
  pixel(x + 1, p.y, size, g.g, m.g);
  pixel(x + 2, p.y, size, g.b, m.b);
  pixel(x + 3, p.y, size, g.a, m.a);
  outGrey = g;
  outThreshold = m;
}
`;
