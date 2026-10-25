// Sightline TREES: north-central-Florida pine flatwood vegetation — slash/longleaf pine, live/laurel oak, saw palmetto,
// wax-myrtle/gallberry shrub — as alpha-tested leaf/needle CARD crowns over tapered bark trunks, instanced for forests.
// Pure ES module: THREE is passed in (same rule as landscape.js / environment.js); browser + Node safe (no DOM ->
// plain-colour materials with identical geometry, so ray-cast checks see the same trunks and crowns).
// World frame (SPEC WORLD CONTRACT v2): metres, Y up, ground y=0, +X east, -Z north.
//
//   import * as TR from './assets/trees.js';
//   const t = TR.tree(THREE, { kind: 'pine'|'oak'|'live_oak'|'laurel_oak'|'palmetto'|'shrub', height: 19, seed: 7, id });
//   const f = TR.forestBand(THREE, {
//     polyline: [[x,z],...],  side: 'left'|'right',  depth: 70,       // forest EDGE line + which side the forest lies on
//     // or polygon: [[x,z],...]                                       // closed area; every boundary edge is a forest edge
//     density: 2.2,                     // canopy trees per 100 m^2 (2.2 = 220 stems/ha, flatwoods)
//     mix: { pine: 0.75, oak: 0.25, palmetto: 5, shrub: 1.2 },  // canopy fractions | understory clumps per 100 m^2 at edge
//     seed: 1, terrainHeight: (x,z) => y, exclude: (x,z) => bool, lodDistance: 150, floor: true });
//   scene.add(f);  // LOD switches itself on render (f.userData.update(camera) to force); f.userData.count = instances
//
// Rendering: one InstancedMesh per species x variant x {trunk, leaves, side impostor, top impostor} (≈64 draws per band,
// shared geometry + materials across bands). Within lodDistance (dithered ±10 %) full card trees; beyond it a
// camera-facing billboard rasterised from the same tree (or a flat crown card when seen from > 45° above, e.g. the
// overhead view). Understory beyond 350 m is dropped. Impostors never ray-cast; near meshes keep exact geometry.

const IS_BROWSER = typeof document !== 'undefined' && typeof document.createElement === 'function';
const CACHE = new Map();
const memo = (k, make) => { if (!CACHE.has(k)) CACHE.set(k, make()); return CACHE.get(k); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashStr(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const gauss = R => (R() + R() + R() - 1.5) / 1.5;   // ~[-1,1], peaked

export const NOMINAL = { pine: 20, oak: 11, laurel_oak: 15, palmetto: 1.3, shrub: 2.8 };
export const TREE_KINDS = ['pine', 'oak', 'live_oak', 'laurel_oak', 'palmetto', 'shrub'];
const VARIANTS = 4;

// ================================================================ textures (canvas -> DataTexture with coverage mips)
// Canvas pixels are un-premultiplied, rows flipped so v=0 is the canvas bottom, transparent texels get the mean leaf
// colour (no dark alpha fringes), and every mip level rescales alpha so the alpha-tested coverage matches level 0 —
// sparse needle cards keep their density at 60 m instead of dissolving.
function canvas(W, H) { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }
function coverageMips(data, W, H, alpha) {
  const levels = [{ data, width: W, height: H }];
  const cov = (d, k) => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] * k >= 127.5) n++; return n / (d.length / 4); };
  const c0 = alpha ? cov(data, 1) : 0;
  let w = W, h = H, src = data;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), dst = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0, r0 = 0, g0 = 0, b0 = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(h - 1, y * 2 + dy), i = (sy * w + sx) * 4, A = src[i + 3];
        r += src[i] * A; g += src[i + 1] * A; b += src[i + 2] * A; a += A; r0 += src[i]; g0 += src[i + 1]; b0 += src[i + 2];
      }
      const o = (y * nw + x) * 4;
      if (a > 0) { dst[o] = r / a; dst[o + 1] = g / a; dst[o + 2] = b / a; } else { dst[o] = r0 / 4; dst[o + 1] = g0 / 4; dst[o + 2] = b0 / 4; }
      dst[o + 3] = a / 4;
    }
    if (alpha && c0 > 0) {
      let lo = 0.5, hi = 6;
      for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2; if (cov(dst, m) < c0) lo = m; else hi = m; }
      const k = (lo + hi) / 2; for (let i = 3; i < dst.length; i += 4) dst[i] = Math.min(255, dst[i] * k);
    }
    levels.push({ data: dst, width: nw, height: nh });
    src = dst; w = nw; h = nh;
  }
  return levels;
}
function canvasToTexture(THREE, cv, { alpha = true, repeat = false, aniso = 4 } = {}) {
  const W = cv.width, H = cv.height, img = cv.getContext('2d').getImageData(0, 0, W, H).data;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) data.set(img.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  if (alpha) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    if (n) { r /= n; g /= n; b /= n; }
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] < 8) { data[i] = r; data[i + 1] = g; data[i + 2] = b; }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.mipmaps = coverageMips(data, W, H, alpha);
  t.generateMipmaps = false; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.flipY = false;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}
const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
function speckle(g, W, H, n, amp, R) {
  for (let i = 0; i < n; i++) { const v = R() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},${R() * amp})`; g.fillRect(R() * W, R() * H, 1 + R() * 2, 1 + R() * 2); }
}

// pine: a branch-end pad of 6-9 needle brushes (slash pine: 2-3 needles/fascicle, 15-25 cm, tufted at twig tips)
function drawPine(g, W, H, R) {
  const twigs = [];
  const base = [W * 0.5, H * 0.96];
  const nT = 7 + Math.floor(R() * 3);
  for (let i = 0; i < nT; i++) {
    const a = -Math.PI / 2 + (i / (nT - 1) - 0.5) * 2.2 + gauss(R) * 0.2, L = H * (0.22 + R() * 0.2);
    const mid = [base[0] + Math.cos(a) * L * 0.5 + gauss(R) * 12, base[1] - H * 0.18 + Math.sin(a) * L * 0.5];
    const tip = [mid[0] + Math.cos(a) * L * 0.6, mid[1] + Math.sin(a) * L * 0.6 - H * 0.05];
    twigs.push({ mid, tip, a });
  }
  g.lineCap = 'round';
  for (const t of twigs) { g.strokeStyle = rgb(70, 52, 38, 1); g.lineWidth = 4; g.beginPath(); g.moveTo(...base); g.quadraticCurveTo(...t.mid, ...t.tip); g.stroke(); }
  const brush = (cx, cy, a0, n, L0, layer) => {
    for (let i = 0; i < n; i++) {
      const a = a0 + gauss(R) * 1.25, L = L0 * (0.55 + R() * 0.55), bend = gauss(R) * 0.35;
      const v = layer ? 0.85 + R() * 0.55 : 0.45 + R() * 0.35;          // lit outer needles over darker inner ones
      const yel = R() < 0.07 ? 1 : 0;                                    // a few yellow-brown (senescent) needles
      g.strokeStyle = yel ? rgb(150 * v, 120 * v, 60 * v) : rgb(76 * v, 98 * v, 44 * v);
      g.lineWidth = 1.6 + R() * 1.4;
      const ex = cx + Math.cos(a) * L, ey = cy + Math.sin(a) * L;
      g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(cx + Math.cos(a + bend) * L * 0.55, cy + Math.sin(a + bend) * L * 0.55, ex, ey); g.stroke();
    }
  };
  for (const layer of [0, 1]) for (const t of twigs) {
    const L0 = W * (0.11 + R() * 0.05);
    brush(t.tip[0], t.tip[1], t.a - 0.15, layer ? 45 : 60, L0, layer);
    brush(t.mid[0], t.mid[1], t.a - 0.4, layer ? 18 : 26, L0 * 0.8, layer);
  }
}
// live oak / laurel oak: a clump of small elliptic leaves with twigs, denser and darker in the middle, lacy rim
function drawLeafClump(g, W, H, R, pal) {
  const blobs = []; const nb = 6 + Math.floor(R() * 3);
  for (let i = 0; i < nb; i++) { const a = R() * TAU, d = R() * W * 0.2; blobs.push([W / 2 + Math.cos(a) * d, H * 0.52 + Math.sin(a) * d * 0.85, W * (0.13 + R() * 0.1)]); }
  const inside = (x, y) => { let m = 0; for (const [bx, by, br] of blobs) { const d = Math.hypot(x - bx, y - by) / br; m = Math.max(m, 1 - d); } return m; };
  g.lineCap = 'round';
  for (let i = 0; i < 14; i++) { const [bx, by] = blobs[i % nb]; g.strokeStyle = rgb(62, 50, 40); g.lineWidth = 2 + R() * 2; g.beginPath(); g.moveTo(W / 2 + gauss(R) * 20, H * 0.98); g.quadraticCurveTo(W / 2 + gauss(R) * 60, H * 0.7, bx + gauss(R) * 30, by + gauss(R) * 30); g.stroke(); }
  for (let pass = 0; pass < 2; pass++) {
    const N = pass ? 1100 : 900;
    for (let i = 0; i < N; i++) {
      const x = R() * W, y = R() * H, m = inside(x, y);
      if (m <= 0 || R() > (pass ? Math.min(1, m * 3.2) : Math.min(1, m * 2.2))) continue;
      const top = 1 - y / H, v = pass ? (0.75 + top * 0.35 + R() * 0.35) : (0.45 + R() * 0.25);
      const c = R() < pal.oddP ? pal.odd : pal.leaf;
      g.fillStyle = rgb(c[0] * v, c[1] * v, c[2] * v);
      g.save(); g.translate(x, y); g.rotate(R() * TAU);
      const L = pal.len * (0.7 + R() * 0.6);
      g.beginPath(); g.ellipse(0, 0, L, L * pal.wid, 0, 0, TAU); g.fill(); g.restore();
    }
  }
}
// saw palmetto: a nearly circular fan of ~26 stiff leaflets with split tips; petiole enters at the bottom centre
function drawPalmetto(g, W, H, R) {
  const bx = W / 2, by = H * 0.97;
  const n = 24 + Math.floor(R() * 6);
  const glauc = R() < 0.35;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), a = -Math.PI / 2 + (t - 0.5) * Math.PI * 1.15 + gauss(R) * 0.03;
    const L = H * (0.62 + R() * 0.2) * (1 - 0.25 * Math.abs(t - 0.5) * 2), w = 7 + R() * 4;
    const droop = (t - 0.5) * 0.35;
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const s = k / 10, aa = a + droop * s * s, r = 18 + s * L;
      const ww = w * (s < 0.15 ? s / 0.15 : 1 - Math.pow((s - 0.15) / 0.85, 1.6) * 0.8);
      const x = bx + Math.cos(aa) * r, y = by + Math.sin(aa) * r, nx = -Math.sin(aa), ny = Math.cos(aa);
      pts.push([x + nx * ww, y + ny * ww, x - nx * ww, y - ny * ww]);
    }
    const v = 0.75 + R() * 0.4, dead = R() < 0.06;
    const c = dead ? [150, 120, 70] : glauc ? [112, 132, 96] : [104, 124, 58];
    g.fillStyle = rgb(c[0] * v, c[1] * v, c[2] * v);
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]);
    const tp = pts[10]; g.lineTo((tp[0] + tp[2]) / 2 + Math.cos(a) * 6, (tp[1] + tp[3]) / 2 + Math.sin(a) * 6);   // split tip
    for (let k = 10; k >= 0; k--) g.lineTo(pts[k][2], pts[k][3]);
    g.closePath(); g.fill();
    g.strokeStyle = rgb(c[0] * v * 1.25, c[1] * v * 1.2, c[2] * v * 1.1, 0.8); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(bx, by); g.lineTo((tp[0] + tp[2]) / 2, (tp[1] + tp[3]) / 2); g.stroke();
    if (R() < 0.3) { g.fillStyle = rgb(140, 110, 70); g.beginPath(); g.arc((tp[0] + tp[2]) / 2, (tp[1] + tp[3]) / 2, 4, 0, TAU); g.fill(); }
  }
  g.fillStyle = rgb(90, 84, 52); g.beginPath(); g.arc(bx, by - 8, 14, 0, TAU); g.fill();
}
function drawMoss(g, W, H, R) {
  for (let i = 0; i < 60; i++) {
    let x = W * (0.1 + R() * 0.8); const L = H * (0.35 + R() * 0.62), v = 140 + R() * 50;
    g.strokeStyle = `rgba(${v * 0.93},${v * 0.97},${v * 0.86},${0.6 + R() * 0.4})`; g.lineWidth = 1.2 + R() * 2.2;
    g.beginPath(); g.moveTo(x, 0); for (let y = 0; y < L; y += 7) { x += gauss(R) * 4; g.lineTo(x, y); } g.stroke();
  }
}
function drawBark(g, W, H, R, kind) {
  if (kind === 'pine') {
    g.fillStyle = rgb(48, 38, 33); g.fillRect(0, 0, W, H);            // fissures
    let y = 0;
    while (y < H) {
      const rh = 16 + R() * 26; let x = R() * 20;
      while (x < W + 40) {
        const pw = 22 + R() * 38, tone = R();
        const c = tone < 0.55 ? [122, 96, 80] : tone < 0.85 ? [104, 92, 84] : [140, 106, 84];
        const v = 0.8 + R() * 0.35;
        for (const ox of [0, -W]) {
          g.fillStyle = rgb(c[0] * v, c[1] * v, c[2] * v);
          g.beginPath();
          g.moveTo(x + ox + 2 + R() * 3, y + 2 + R() * 3); g.lineTo(x + ox + pw - 2 - R() * 4, y + 1 + R() * 4);
          g.lineTo(x + ox + pw - 1 - R() * 4, y + rh - 2 - R() * 4); g.lineTo(x + ox + 1 + R() * 4, y + rh - 1 - R() * 3); g.closePath(); g.fill();
          g.fillStyle = 'rgba(255,240,225,0.10)'; g.fillRect(x + ox + 4, y + 3, pw - 9, 3);          // flaky lit plate rims
          g.fillStyle = 'rgba(20,12,8,0.18)'; g.fillRect(x + ox + 3, y + rh - 6, pw - 7, 3);
        }
        x += pw + 2 + R() * 3;
      }
      y += rh + 1 + R() * 3;
    }
  } else {
    g.fillStyle = rgb(78, 73, 64); g.fillRect(0, 0, W, H);
    for (let i = 0; i < 160; i++) {
      const x = R() * W, w = 2 + R() * 6, v = R() < 0.5 ? 'rgba(30,26,22,0.55)' : 'rgba(150,145,130,0.25)';
      g.strokeStyle = v; g.lineWidth = w; g.beginPath(); let xx = x; g.moveTo(xx, 0); for (let y = 0; y <= H; y += 16) { xx += gauss(R) * 3; g.lineTo(xx, y); } g.stroke();
    }
    for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(25,22,18,0.5)'; g.fillRect(R() * W, R() * H, 6 + R() * 14, 2); }
  }
  speckle(g, W, H, 3000, 0.12, R);
}
function drawLitter(g, W, H, R) {
  g.fillStyle = rgb(92, 74, 52); g.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '40,32,22' : '120,100,70'},${0.15 + R() * 0.2})`; g.beginPath(); g.arc(R() * W, R() * H, 10 + R() * 40, 0, TAU); g.fill(); }
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = R() * W, y = R() * H, a = R() * TAU, L = 6 + R() * 16, v = 0.6 + R() * 0.7;
    g.strokeStyle = rgb(150 * v, 108 * v, 66 * v, 0.9); g.lineWidth = 0.8 + R();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  for (let i = 0; i < 140; i++) { const v = 0.6 + R() * 0.5; g.fillStyle = rgb(70 * v, 88 * v, 44 * v, 0.8); g.beginPath(); g.ellipse(R() * W, R() * H, 3 + R() * 4, 1.5 + R() * 2, R() * 3, 0, TAU); g.fill(); }
}

const LEAF_PAL = {
  oak: { leaf: [56, 74, 38], odd: [86, 92, 48], oddP: 0.12, len: 10, wid: 0.5 },
  shrub: { leaf: [82, 98, 50], odd: [104, 106, 58], oddP: 0.15, len: 8, wid: 0.38 },
};
const FALLBACK = { pine: 0x4c5f2e, oak: 0x3d5229, shrub: 0x54632f, palmetto: 0x66773a, moss: 0x8f9682, barkpine: 0x6b5446, barkoak: 0x4e4941, litter: 0x5c4a34 };
function cardCanvas(kind) {
  return memo('cv:' + kind, () => {
    const big = kind !== 'moss';
    const cv = canvas(big ? 512 : 128, big ? 512 : 256), g = cv.getContext('2d'), R = rng(hashStr(kind));
    g.clearRect(0, 0, cv.width, cv.height);
    if (kind === 'pine') drawPine(g, cv.width, cv.height, R);
    else if (kind === 'oak' || kind === 'shrub') drawLeafClump(g, cv.width, cv.height, R, LEAF_PAL[kind]);
    else if (kind === 'palmetto') drawPalmetto(g, cv.width, cv.height, R);
    else drawMoss(g, cv.width, cv.height, R);
    return cv;
  });
}
function barkCanvas(kind) { return memo('cvb:' + kind, () => { const cv = canvas(256, 512); drawBark(cv.getContext('2d'), 256, 512, rng(hashStr('bark' + kind)), kind); return cv; }); }

// foliage material: alpha-tested DoubleSide cards whose (crown-volume) normals are NOT flipped on back faces, so a
// crown shades as one lit volume; vertex colour = baked crown AO, instance colour = per-tree tint.
function foliageMat(THREE, kind) {
  return memo('mat:leaf:' + kind, () => {
    const map = IS_BROWSER ? canvasToTexture(THREE, cardCanvas(kind), { alpha: true }) : null;
    const m = new THREE.MeshStandardMaterial({
      map, color: map ? 0xffffff : FALLBACK[kind], alphaTest: map ? 0.5 : 0, side: THREE.DoubleSide,
      roughness: 0.9, metalness: 0, vertexColors: true, envMapIntensity: 0.6,
    });
    m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;')); };
    m.customProgramCacheKey = () => 'trees-foliage-noflip';
    m.name = 'trees_foliage_' + kind;
    return m;
  });
}
function barkMat(THREE, kind) {
  return memo('mat:bark:' + kind, () => {
    const map = IS_BROWSER ? canvasToTexture(THREE, barkCanvas(kind), { alpha: false, repeat: true }) : null;
    const m = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : FALLBACK['bark' + kind], roughness: 0.96, metalness: 0, vertexColors: true, envMapIntensity: 0.5 });
    m.name = 'trees_bark_' + kind; return m;
  });
}
function litterMat(THREE) {
  return memo('mat:litter', () => {
    let map = null;
    if (IS_BROWSER) { const cv = canvas(512, 512); drawLitter(cv.getContext('2d'), 512, 512, rng(5)); map = canvasToTexture(THREE, cv, { alpha: false, repeat: true }); }
    const m = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : FALLBACK.litter, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.name = 'trees_litter'; return m;
  });
}

// ================================================================ geometry builder
class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.idx = []; this.quads = []; }
  v(p, n, u, w, ao) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(u, w); this.c.push(ao, ao, ao); return this.p.length / 3 - 1; }
  // card: centre c, half-extent vectors ax (u) / ay (v), shading normal n, ao; uv rect [u0,v0,u1,v1]
  card(c, ax, ay, n, ao, uvr = [0, 0, 1, 1]) {
    const P = (i, j) => [c[0] + ax[0] * i + ay[0] * j, c[1] + ax[1] * i + ay[1] * j, c[2] + ax[2] * i + ay[2] * j];
    const a = this.v(P(-1, -1), n, uvr[0], uvr[1], ao), b = this.v(P(1, -1), n, uvr[2], uvr[1], ao);
    const d = this.v(P(1, 1), n, uvr[2], uvr[3], ao), e = this.v(P(-1, 1), n, uvr[0], uvr[3], ao);
    this.idx.push(a, b, d, a, d, e); this.quads.push([a, b, d, e]);
  }
  quad4(P4, UV4, n, ao) {     // explicit corners (counter-clockwise)
    const id = P4.map((p, i) => this.v(p, n, UV4[i][0], UV4[i][1], ao));
    this.idx.push(id[0], id[1], id[2], id[0], id[2], id[3]); this.quads.push(id);
  }
  // tapered tube along pts with radii; parallel-transport frames; u around, v = length / vScale
  tube(pts, radii, radial, vScale, ao = 1, aoTop = ao) {
    const n = pts.length; if (n < 2) return;
    const T = [], N = [], B = [];
    for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; T.push(norm(sub(b, a))); }
    let nn = Math.abs(T[0][1]) < 0.9 ? norm(cross(T[0], [0, 1, 0])) : norm(cross(T[0], [1, 0, 0]));
    for (let i = 0; i < n; i++) { if (i) { const b = cross(T[i], nn); nn = norm(cross(b, T[i])); } N.push(nn); B.push(cross(T[i], nn)); }
    let len = 0; const base = this.p.length / 3;
    for (let i = 0; i < n; i++) {
      if (i) len += dist(pts[i], pts[i - 1]);
      const ao_i = lerp(ao, aoTop, i / (n - 1));
      for (let j = 0; j <= radial; j++) {
        const a = j / radial * TAU, cs = Math.cos(a), sn = Math.sin(a);
        const d = [N[i][0] * cs + B[i][0] * sn, N[i][1] * cs + B[i][1] * sn, N[i][2] * cs + B[i][2] * sn];
        this.v([pts[i][0] + d[0] * radii[i], pts[i][1] + d[1] * radii[i], pts[i][2] + d[2] * radii[i]], d, j / radial, len / vScale, ao_i);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
      const a = base + i * (radial + 1) + j, b = a + radial + 1;
      this.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  geometry(THREE) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.idx); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dist = (a, b) => len3(sub(a, b));
const dirAE = (az, el) => [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
function randUnit(R) { const u = R() * 2 - 1, a = R() * TAU, s = Math.sqrt(1 - u * u); return [s * Math.cos(a), u, s * Math.sin(a)]; }
// card basis from a facing normal fn and an in-plane "up" hint
function basis(fn, upHint, hw, hh) {
  let ax = cross(upHint, fn); if (len3(ax) < 1e-3) ax = cross([1, 0, 0], fn);
  ax = norm(ax); const ay = norm(cross(fn, ax));
  return [mul(ax, hw), mul(ay, hh)];
}
function pathPts(start, dir0, L, steps, R, { droop = 0, wander = 0.15, lift = 0 } = {}) {
  const pts = [start]; let d = norm(dir0), p = start;
  for (let i = 0; i < steps; i++) {
    d = norm(add(add(d, mul(randUnit(R), wander)), [0, lift - droop, 0]));
    p = add(p, mul(d, L / steps)); pts.push(p);
  }
  return pts;
}

// ---------------------------------------------------------------- species templates (nominal size, local frame)
function pineTemplate(R) {
  const H = NOMINAL.pine * (0.92 + R() * 0.16), wood = new Buf(), leaf = new Buf();
  const r0 = 0.17 + R() * 0.05, sweep = [gauss(R) * 0.35, gauss(R) * 0.35];
  const tk = [], tr = [];
  const NT = 12;
  const axis = y => { const t = y / H; return [sweep[0] * Math.sin(t * 2.4) + 0.06 * Math.sin(t * 17 + r0 * 40), y, sweep[1] * Math.sin(t * 2.1) + 0.06 * Math.cos(t * 13)]; };
  for (let i = 0; i <= NT; i++) {
    const t = i / NT, y = H * 0.985 * (t < 0.08 ? t * 0.5 / 0.08 * 0.08 * 2 : t);
    tk.push(axis(Math.min(y, H * 0.985)));
    tr.push(r0 * (1 - 0.82 * Math.pow(t, 1.15)) * (1 + 0.35 * Math.exp(-y / 0.45)));
  }
  wood.tube(tk, tr, 9, 2.4, 0.95, 0.75);
  const cb = H * (0.6 + R() * 0.1), top = H * 0.985, crownR = H * (0.16 + R() * 0.05);
  // dead branch stubs on the bare bole (self-pruned limbs)
  const nS = 3 + Math.floor(R() * 5);
  for (let i = 0; i < nS; i++) {
    const y = H * 0.3 + R() * (cb - H * 0.3), a = axis(y), az = R() * TAU, L = 0.25 + R() * 0.9;
    wood.tube([a, add(a, mul(dirAE(az, -0.15 + R() * 0.4), L))], [0.035, 0.012], 4, 1.5, 0.8);
  }
  const pad = (c, size, outward, ao) => {
    const nc = 4 + Math.floor(R() * 3);
    for (let k = 0; k < nc; k++) {
      const off = [gauss(R) * size * 0.45, gauss(R) * size * 0.18, gauss(R) * size * 0.45];
      const cc = add(c, off);
      const horiz = k < 2;
      const fn = horiz ? norm(add([0, 1, 0], mul(randUnit(R), 0.45))) : norm([Math.cos(R() * TAU), (R() - 0.3) * 0.7, Math.sin(R() * TAU)]);
      const s = size * (0.75 + R() * 0.45) * 0.5;
      const up = horiz ? norm([outward[0], 0.15, outward[2]]) : norm(add([0, 1, 0], mul(outward, 0.6)));
      const [ax, ay] = basis(fn, up, s, s);
      const n = norm(add(mul(outward, 0.75), [0, 0.6, 0]));
      leaf.card(cc, ax, ay, add(mul(n, 0.85), mul(randUnit(R), 0.15)), clamp(ao + gauss(R) * 0.07, 0.3, 1));
    }
  };
  const nL = 10 + Math.floor(R() * 6);
  for (let i = 0; i < nL; i++) {
    const u = Math.pow(R(), 0.8), y = cb + (top - cb - 0.6) * u, a = axis(y);
    const az = i * 2.39996 + gauss(R) * 0.5;
    const L = crownR * (1.15 - 0.75 * u) * (0.6 + R() * 0.6) + 0.4;
    const el = u < 0.3 ? -0.05 + R() * 0.3 : 0.15 + R() * 0.55;
    const pts = pathPts(a, dirAE(az, el), L, 3, R, { lift: 0.18 + 0.1 * u, wander: 0.18 });
    const rb = 0.03 + 0.05 * L / (crownR + 0.4);
    wood.tube(pts, pts.map((_, k) => rb * (1 - k / pts.length * 0.75)), 5, 1.5, 0.75, 0.6);
    const outward = norm([pts[3][0] - a[0], 0, pts[3][2] - a[2]]);
    const pd = pts.length - 1, sz = 1.2 + L * 0.35;
    const aoBase = 0.62 + 0.3 * u;
    pad(add(pts[pd], [0, 0.25, 0]), sz, outward, aoBase + 0.12);
    if (L > 1.4) pad(add(pts[2], [0, 0.2, 0]), sz * 0.85, outward, aoBase);
    if (L > 2.4 && R() < 0.7) { const q = add(pts[1], mul([outward[2], 0, -outward[0]], (R() - 0.5) * 1.4)); pad(add(q, [0, 0.3, 0]), sz * 0.8, outward, aoBase - 0.08); }
  }
  // leader
  const at = axis(top);
  for (let k = 0; k < 4; k++) {
    const fn = norm([Math.cos(k * 1.7), 0.2, Math.sin(k * 1.7)]), s = 0.65 + R() * 0.25;
    const [ax, ay] = basis(fn, [0, 1, 0], s, s * 1.1);
    leaf.card(add(at, [gauss(R) * 0.3, -0.15 + R() * 0.3, gauss(R) * 0.3]), ax, ay, norm([fn[0] * 0.5, 0.85, fn[2] * 0.5]), 0.95);
  }
  return { wood, leaf, barkKind: 'pine', leafKind: 'pine' };
}

function oakTemplate(R, upright, moss) {
  const H = (upright ? NOMINAL.laurel_oak : NOMINAL.oak) * (0.9 + R() * 0.2), wood = new Buf(), leaf = new Buf(), hang = new Buf();
  const th = H * (upright ? 0.3 : 0.2) * (0.85 + R() * 0.3), r0 = H * (upright ? 0.024 : 0.034) * (0.9 + R() * 0.2);
  const lean = [gauss(R) * 0.4, 0, gauss(R) * 0.4];
  const trunk = [[0, 0, 0], [lean[0] * 0.3, th * 0.5, lean[2] * 0.3], [lean[0], th, lean[2]]];
  wood.tube(trunk, [r0 * 1.45, r0 * 1.05, r0 * 0.95], 10, 2.4, 0.85, 0.7);
  const tips = [];      // {p, r}: clump centres attached to wood
  const nL = upright ? 3 + Math.floor(R() * 2) : 4 + Math.floor(R() * 3);
  const spread = upright ? 0.4 : 0.5;
  for (let i = 0; i < nL; i++) {
    const az = i / nL * TAU + gauss(R) * 0.5, el = upright ? 0.85 + R() * 0.45 : 0.3 + R() * 0.45;
    const L = H * spread * (0.75 + R() * 0.4);
    const st = add(trunk[2], [0, -R() * th * 0.25, 0]);
    const pts = pathPts(st, dirAE(az, el), L, 4, R, { droop: upright ? 0 : 0.12, lift: upright ? 0.05 : 0, wander: 0.2 });
    const rr = r0 * 0.62;
    wood.tube(pts, pts.map((_, k) => rr * Math.pow(0.7, k)), 7, 2.0, 0.65, 0.5);
    tips.push({ p: pts[4], r: H * 0.15 }); tips.push({ p: add(pts[3], [0, H * 0.06, 0]), r: H * 0.14 });
    for (let k = 1; k <= 3; k++) {
      const ns = k === 3 ? 1 : 1 + (R() < 0.5 ? 1 : 0);
      for (let s = 0; s < ns; s++) {
        const d0 = norm(add(sub(pts[k + 1] || pts[k], pts[k - 1]), [gauss(R) * 1.3, 0.6 + R() * 0.7, gauss(R) * 1.3]));
        const sl = L * (0.3 + R() * 0.22), sp = pathPts(pts[k], d0, sl, 2, R, { wander: 0.25 });
        wood.tube(sp, [rr * Math.pow(0.7, k) * 0.6, rr * Math.pow(0.7, k) * 0.4, rr * 0.12], 4, 1.5, 0.55, 0.5);
        tips.push({ p: sp[2], r: H * (0.11 + R() * 0.05) });
        if (moss && k >= 1) for (let m = 0; m < 2; m++) {
          const mp = add(lerp3(pts[k], sp[1], R()), [0, -0.05, 0]), ml = 0.7 + R() * 1.4, ry = R() * TAU;
          for (const o of [0, Math.PI / 2]) { const ax = [Math.cos(ry + o) * 0.25, 0, Math.sin(ry + o) * 0.25]; hang.card(add(mp, [0, -ml / 2, 0]), ax, [0, ml / 2, 0], [0, 0.4, 0.9], 0.85); }
        }
      }
    }
  }
  if (upright) { const ld = pathPts(trunk[2], [0, 1, 0], H * 0.45, 3, R, { wander: 0.12 }); wood.tube(ld, [r0 * 0.6, r0 * 0.4, r0 * 0.25, r0 * 0.1], 6, 2, 0.6); tips.push({ p: ld[3], r: H * 0.14 }); tips.push({ p: ld[2], r: H * 0.13 }); }
  // crown envelope (for volume normals + AO)
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const t of tips) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], t.p[a] - t.r); hi[a] = Math.max(hi[a], t.p[a] + t.r); }
  const cc = mul(add(lo, hi), 0.5), rad = mul(sub(hi, lo), 0.5);
  for (const t of tips) {
    const nc = 15 + Math.floor(R() * 6);
    for (let k = 0; k < nc; k++) {
      const u = randUnit(R), rr = t.r * (0.35 + 0.65 * Math.cbrt(R()));
      const p = add(t.p, [u[0] * rr, u[1] * rr * 0.75, u[2] * rr]);
      const q = [(p[0] - cc[0]) / rad[0], (p[1] - cc[1]) / rad[1], (p[2] - cc[2]) / rad[2]], dq = len3(q);
      const vn = norm(add(mul(norm(q), 0.8), [0, 0.45, 0]));
      const ao = clamp(0.28 + 0.72 * smooth(0.25, 1.05, dq) * (0.72 + 0.28 * clamp(q[1] * 0.5 + 0.5, 0, 1)) + gauss(R) * 0.06, 0.18, 1);
      const fn = norm(add(randUnit(R), mul(vn, 0.6))), s = H * (0.065 + R() * 0.04);
      const [ax, ay] = basis(fn, [0, 1, 0], s, s);
      leaf.card(p, ax, ay, vn, ao);
    }
  }
  return { wood, leaf, hang: moss ? hang : null, barkKind: 'oak', leafKind: 'oak' };
}
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

function palmettoTemplate(R) {
  const H = NOMINAL.palmetto * (0.85 + R() * 0.3), wood = new Buf(), leaf = new Buf();
  const crowns = 1 + Math.floor(R() * 3);
  for (let c = 0; c < crowns; c++) {
    const cx = gauss(R) * 0.45, cz = gauss(R) * 0.45, nF = 6 + Math.floor(R() * 6);
    for (let i = 0; i < nF; i++) {
      const az = R() * TAU, el = 0.55 + R() * 0.75, pl = H * (0.25 + R() * 0.45);
      const b0 = [cx, 0.05, cz], b1 = add(b0, mul(dirAE(az, el), pl));
      wood.tube([b0, b1], [0.018, 0.012], 3, 1, 0.7);
      // fan: normal tilted outward-up, folded in two halves
      const tilt = 0.25 + R() * 0.9, fo = [Math.cos(az), 0, Math.sin(az)];
      const fn = norm([fo[0] * Math.sin(tilt), Math.cos(tilt) * 0.9 + 0.1, fo[2] * Math.sin(tilt)]);
      const up = norm(add(mul(fo, Math.cos(tilt)), [0, Math.sin(tilt) + 0.2, 0]));
      const s = H * (0.42 + R() * 0.2);
      const [ax, ay] = basis(fn, up, s * 0.5, s);
      const ayn = norm(ay), side = norm(ax), fold = 0.32;
      const wL = add(mul(side, -s * 0.5 * Math.cos(fold)), mul(fn, s * 0.5 * Math.sin(fold)));
      const wR = add(mul(side, s * 0.5 * Math.cos(fold)), mul(fn, s * 0.5 * Math.sin(fold)));
      const tip = add(b1, mul(ayn, s));
      const n = norm(add(fn, [0, 0.8, 0])), ao = clamp(0.62 + b1[1] / H * 0.35 + gauss(R) * 0.06, 0.4, 1);
      leaf.quad4([b1, add(b1, wR), add(tip, wR), tip], [[0.5, 0], [1, 0], [1, 1], [0.5, 1]], n, ao);
      leaf.quad4([add(b1, wL), b1, tip, add(tip, wL)], [[0, 0], [0.5, 0], [0.5, 1], [0, 1]], n, ao);
    }
  }
  return { wood, leaf, barkKind: 'oak', leafKind: 'palmetto' };
}

function shrubTemplate(R) {
  const H = NOMINAL.shrub * (0.85 + R() * 0.3), wood = new Buf(), leaf = new Buf();
  const n = 4 + Math.floor(R() * 4), clumps = [];
  for (let i = 0; i < n; i++) {
    const az = R() * TAU, d = R() * H * 0.35, y = H * (0.45 + R() * 0.35);
    const p = [Math.cos(az) * d, y, Math.sin(az) * d];
    wood.tube([[p[0] * 0.2, 0, p[2] * 0.2], lerp3([p[0] * 0.2, 0, p[2] * 0.2], p, 0.6), p], [0.04, 0.025, 0.012], 4, 1, 0.5);
    clumps.push({ p, r: H * (0.28 + R() * 0.12) });
  }
  const cc = [0, H * 0.55, 0], rad = [H * 0.6, H * 0.5, H * 0.6];
  for (const c of clumps) for (let k = 0; k < 12; k++) {
    const u = randUnit(R), rr = c.r * (0.3 + 0.7 * Math.cbrt(R()));
    const p = add(c.p, [u[0] * rr, u[1] * rr * 0.8, u[2] * rr]); p[1] = Math.max(p[1], 0.25);
    const q = [(p[0] - cc[0]) / rad[0], (p[1] - cc[1]) / rad[1], (p[2] - cc[2]) / rad[2]];
    const vn = norm(add(mul(norm(q), 0.8), [0, 0.5, 0]));
    const ao = clamp(0.35 + 0.65 * smooth(0.2, 1.0, len3(q)) + gauss(R) * 0.06, 0.25, 1);
    const fn = norm(add(randUnit(R), mul(vn, 0.5))), s = H * (0.17 + R() * 0.08);
    const [ax, ay] = basis(fn, [0, 1, 0], s, s);
    leaf.card(p, ax, ay, vn, ao);
  }
  return { wood, leaf, barkKind: 'oak', leafKind: 'shrub' };
}

const canonKind = k => (k === 'live_oak' ? 'oak' : k === 'laurel' ? 'laurel_oak' : TREE_KINDS.includes(k) ? k : 'oak');
// Template = { woodGeo, leafGeo, mossGeo, woodMat, leafMat, height, radius, impostor:{side, top} (lazy) }
function template(THREE, kind, variant, { moss = false } = {}) {
  kind = canonKind(kind);
  return memo(`tpl:${kind}:${variant}:${moss ? 1 : 0}`, () => {
    const R = rng(hashStr(kind) ^ Math.imul(variant + 1, 0x9E3779B1));
    const t = kind === 'pine' ? pineTemplate(R) : kind === 'palmetto' ? palmettoTemplate(R) : kind === 'shrub' ? shrubTemplate(R) : oakTemplate(R, kind === 'laurel_oak', moss);
    const woodGeo = t.wood.geometry(THREE), leafGeo = t.leaf.geometry(THREE), mossGeo = t.hang ? t.hang.geometry(THREE) : null;
    const bb = new THREE.Box3().union(woodGeo.boundingBox).union(leafGeo.boundingBox);
    const out = { kind, variant, src: t, woodGeo, leafGeo, mossGeo, woodMat: barkMat(THREE, t.barkKind), leafMat: foliageMat(THREE, t.leafKind),
      mossMat: mossGeo ? foliageMat(THREE, 'moss') : null, height: bb.max.y, box: bb, _imp: null };
    return out;
  });
}

// ---------------------------------------------------------------- impostors (rasterised from the template geometry)
function shadeCanvases(src, levels = 8) {
  return Array.from({ length: levels }, (_, L) => {
    const b = 0.22 + 0.78 * L / (levels - 1), c = canvas(src.width, src.height), g = c.getContext('2d');
    g.drawImage(src, 0, 0); g.globalCompositeOperation = 'multiply'; g.fillStyle = rgb(255 * b, 255 * b, 255 * b); g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(src, 0, 0); return c;
  });
}
function avgColor(cv) {
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  return n ? [r / n, g / n, b / n] : [90, 80, 70];
}
// draw one textured quad (verts with uv) via an affine map texture->screen, clipped to the quad
function drawQuad(g, img, scr, uvs) {
  const TW = img.width, TH = img.height;
  const t = uvs.map(([u, v]) => [u * TW, (1 - v) * TH]);
  const [x0, y0] = t[0], [x1, y1] = t[1], [x2, y2] = t[2];
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(det) < 1e-6) return;
  const [X0, Y0] = scr[0], [X1, Y1] = scr[1], [X2, Y2] = scr[2];
  const a = ((X1 - X0) * (y2 - y0) - (X2 - X0) * (y1 - y0)) / det, c = ((X2 - X0) * (x1 - x0) - (X1 - X0) * (x2 - x0)) / det;
  const b = ((Y1 - Y0) * (y2 - y0) - (Y2 - Y0) * (y1 - y0)) / det, d = ((Y2 - Y0) * (x1 - x0) - (Y1 - Y0) * (x2 - x0)) / det;
  const area = Math.abs((scr[1][0] - scr[0][0]) * (scr[2][1] - scr[0][1]) - (scr[2][0] - scr[0][0]) * (scr[1][1] - scr[0][1]));
  if (area < 0.05) return;
  g.save(); g.beginPath(); g.moveTo(scr[0][0], scr[0][1]); for (let i = 1; i < scr.length; i++) g.lineTo(scr[i][0], scr[i][1]); g.closePath(); g.clip();
  g.setTransform(a, b, c, d, X0 - a * x0 - c * y0, Y0 - b * x0 - d * y0);
  g.drawImage(img, 0, 0); g.restore();
}
function rasterImpostor(tpl, view) {
  const { src } = tpl, leafCv = cardCanvas(src.leafKind), shades = memo('shades:' + src.leafKind, () => shadeCanvases(leafCv));
  const bark = memo('barkavg:' + src.barkKind, () => avgColor(barkCanvas(src.barkKind)));
  const bb = tpl.box, side = view === 'side';
  const minU = bb.min.x, maxU = bb.max.x, minV = side ? bb.min.y : bb.min.z, maxV = side ? bb.max.y : bb.max.z;
  const wU = maxU - minU, wV = maxV - minV;
  const Hpx = side ? 512 : 256;
  const Wpx = Math.min(1024, Math.max(64, 2 ** Math.round(Math.log2(Hpx * wU / wV))));
  const cv = canvas(Wpx, Hpx), g = cv.getContext('2d');
  const proj = p => side ? [(p[0] - minU) / wU * Wpx, (maxV - p[1]) / wV * Hpx] : [(p[0] - minU) / wU * Wpx, (p[2] - minV) / wV * Hpx];
  const depth = p => side ? p[2] : p[1];        // painter: draw far first (side view looks from +Z; top view from +Y)
  const prims = [];
  const W = src.wood, P = i => [W.p[i * 3], W.p[i * 3 + 1], W.p[i * 3 + 2]];
  for (let i = 0; i < W.idx.length; i += 3) {
    const a = P(W.idx[i]), b = P(W.idx[i + 1]), c = P(W.idx[i + 2]);
    const nz = side ? (W.n[W.idx[i] * 3 + 2]) : W.n[W.idx[i] * 3 + 1];
    prims.push({ z: (depth(a) + depth(b) + depth(c)) / 3, wood: true, pts: [a, b, c], sh: (0.55 + 0.45 * Math.max(0, nz)) * W.c[W.idx[i] * 3] });
  }
  const Lf = src.leaf, Q = i => [Lf.p[i * 3], Lf.p[i * 3 + 1], Lf.p[i * 3 + 2]];
  for (const q of Lf.quads) { const pts = q.map(Q); prims.push({ z: pts.reduce((s, p) => s + depth(p), 0) / 4, pts, uvs: q.map(i => [Lf.uv[i * 2], Lf.uv[i * 2 + 1]]), sh: Lf.c[q[0] * 3] }); }
  prims.sort((a, b) => a.z - b.z);
  for (const pr of prims) {
    const scr = pr.pts.map(proj);
    if (pr.wood) {
      const s = pr.sh; g.fillStyle = rgb(bark[0] * s, bark[1] * s, bark[2] * s);
      g.beginPath(); g.moveTo(...scr[0]); g.lineTo(...scr[1]); g.lineTo(...scr[2]); g.closePath(); g.fill();
      g.strokeStyle = g.fillStyle; g.lineWidth = 0.6; g.stroke();
    } else drawQuad(g, shades[clamp(Math.round((pr.sh - 0.22) / 0.78 * 7), 0, 7)], scr, pr.uvs);
  }
  return { cv, minU, maxU, minV, maxV };
}
function impostorParts(THREE, tpl) {
  if (tpl._imp) return tpl._imp;
  const mk = (view) => {
    let geo, map = null;
    const bb = tpl.box;
    if (IS_BROWSER) {
      const r = rasterImpostor(tpl, view);
      map = canvasToTexture(THREE, r.cv, { alpha: true, aniso: 2 });
    }
    if (view === 'side') {
      geo = new THREE.PlaneGeometry(bb.max.x - bb.min.x, bb.max.y - bb.min.y);
      geo.translate((bb.max.x + bb.min.x) / 2, (bb.max.y + bb.min.y) / 2, 0);
      const n = geo.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 0.55, 0.835);
    } else {
      geo = new THREE.PlaneGeometry(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
      geo.rotateX(-Math.PI / 2);
      geo.translate((bb.max.x + bb.min.x) / 2, bb.min.y + (bb.max.y - bb.min.y) * (tpl.kind === 'pine' ? 0.88 : 0.75), (bb.max.z + bb.min.z) / 2);
    }
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : FALLBACK[tpl.src.leafKind], alphaTest: map ? 0.5 : 0, side: THREE.DoubleSide, roughness: 0.92, metalness: 0, envMapIntensity: 0.6 });
    mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;')); };
    mat.customProgramCacheKey = () => 'trees-foliage-noflip';
    mat.name = `trees_impostor_${tpl.kind}${tpl.variant}_${view}`;
    return { geo, mat };
  };
  tpl._imp = { side: mk('side'), top: mk('top') };
  return tpl._imp;
}

// ================================================================ single tree
/** tree(THREE, {kind='oak', height, seed=0, id, moss}) -> THREE.Group (assetType 'tree', userData.dims, kind).
 *  kinds: pine (slash/longleaf), oak|live_oak (spreading), laurel_oak (upright), palmetto (saw palmetto clump), shrub. */
export function tree(THREE, opts = {}) {
  const raw = opts.kind || 'oak', kind = canonKind(raw);
  const seed = (opts.seed ?? 0) ^ (opts.id ? hashStr(opts.id) : 0);
  const R = rng(seed + 977);
  const moss = !!(opts.moss || opts.spanishMoss) && (kind === 'oak' || kind === 'laurel_oak');
  const tpl = template(THREE, kind, (seed >>> 0) % 16, { moss });
  const H = opts.height ?? NOMINAL[kind] * (0.9 + R() * 0.2);
  const s = H / tpl.height;
  const root = new THREE.Group(), inner = new THREE.Group();
  inner.scale.setScalar(s); inner.rotation.y = R() * TAU; inner.name = (opts.id || 'tree') + '_inner';
  if (kind === 'pine') { inner.rotation.x = gauss(R) * 0.035; inner.rotation.z = gauss(R) * 0.035; }
  const mk = (geo, mat, name) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = true; m.receiveShadow = true; inner.add(m); return m; };
  mk(tpl.woodGeo, tpl.woodMat, 'wood');
  const lv = mk(tpl.leafGeo, tpl.leafMat, 'leaves'); lv.userData.porous = true;
  if (tpl.mossGeo) mk(tpl.mossGeo, tpl.mossMat, 'moss').userData.porous = true;
  root.add(inner);
  const bb = tpl.box;
  root.name = opts.id || `tree_${kind}`;
  root.userData.assetType = 'tree';
  root.userData.kind = raw === 'live_oak' ? 'oak' : kind;
  const ext = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * s;
  root.userData.dims = { length: +ext.toFixed(2), width: +ext.toFixed(2), height: +H.toFixed(2) };
  root.userData.source = 'trees.js';
  return root;
}

// ================================================================ forest band
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function closestOnPolyline(x, z, pl, closed) {
  let best = Infinity, bs = 0, acc = 0;
  const n = closed ? pl.length : pl.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, az] = pl[i], [bx, bz] = pl[(i + 1) % pl.length], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, L = Math.sqrt(L2);
    const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bs = acc + t * L; }
    acc += L;
  }
  return { d: best, s: bs };
}
function offsetPolyline(pl, dist, sideSign) {
  return pl.map((p, i) => {
    const a = pl[Math.max(0, i - 1)], b = pl[Math.min(pl.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    return [p[0] + dz / L * dist * sideSign, p[1] - dx / L * dist * sideSign];   // left normal of (dx,dz) is (dz,-dx)
  });
}
const edgeNoise = (s, ph) => 3.2 + 2.6 * Math.sin(s / 31 + ph) + 1.6 * Math.sin(s / 9.7 + ph * 2.3) + 0.9 * Math.sin(s / 4.1 + ph * 5.1);

/** forestBand(THREE, opts) -> THREE.Group (assetType 'forest'). See the header for opts. userData: {count, counts,
 *  update(camera), area, lodDistance}. Instances are placed once (deterministic from seed); LOD re-partitions when the
 *  rendering camera moves > 4 m. */
export function forestBand(THREE, opts = {}) {
  const seed = opts.seed ?? 1, R = rng(hashStr('band') ^ seed);
  const depth = opts.depth ?? 70, density = opts.density ?? 2.2, lod = opts.lodDistance ?? 150, uCull = opts.understoryCull ?? 350;
  const th = opts.terrainHeight || (() => 0), exclude = opts.exclude || null, hScale = opts.heightScale ?? 1;
  const mixIn = opts.mix || {};
  const pine = mixIn.pine ?? 0.75, oak = mixIn.oak ?? 0.25, laurel = mixIn.laurel_oak ?? 0, sumC = pine + oak + laurel || 1;
  const palD = mixIn.palmetto ?? 5, shrubD = mixIn.shrub ?? 1.2, interior = opts.interiorUnderstory ?? 0.4;
  let poly, front, closed;
  if (opts.polygon && opts.polygon.length >= 3) { poly = opts.polygon.map(p => [+p[0], +p[1]]); front = poly; closed = true; }
  else if (opts.polyline && opts.polyline.length >= 2 && opts.centered) {   // belt centred on the line, both sides are edges
    const pl = opts.polyline.map(p => [+p[0], +p[1]]);
    poly = [...offsetPolyline(pl, depth / 2, 1), ...offsetPolyline(pl, depth / 2, -1).reverse()]; front = poly; closed = true;
  } else if (opts.polyline && opts.polyline.length >= 2) {
    front = opts.polyline.map(p => [+p[0], +p[1]]); closed = false;
    const sg = opts.side === 'right' ? -1 : 1;
    poly = [...front, ...offsetPolyline(front, depth, sg).reverse()];
  } else throw new Error('forestBand: polyline (>=2 pts) or polygon (>=3 pts) required');
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const ph = R() * 100;
  // candidate sampler: jittered grid at the layer's peak density; returns [{x,z,d}] with d = depth behind the ragged edge
  const sample = (peak, accept, edgeSpill = 0) => {
    const cell = Math.sqrt(100 / peak), out = [];
    for (let gx = x0 - edgeSpill; gx < x1 + edgeSpill; gx += cell) for (let gz = z0 - edgeSpill; gz < z1 + edgeSpill; gz += cell) {
      const x = gx + R() * cell, z = gz + R() * cell;
      const c = closestOnPolyline(x, z, front, closed);
      const inside = pointInPoly(x, z, poly);
      if (!inside && (c.d > edgeSpill || !edgeSpill)) continue;
      if (!closed && !inside) { const c2 = closestOnPolyline(x, z, poly, true); if (c2.d > edgeSpill) continue; }
      const d = (inside ? c.d : -c.d) - edgeNoise(c.s, ph);
      if (d < -edgeSpill) continue;
      if (exclude && exclude(x, z)) continue;
      if (R() < accept(d)) out.push({ x, z, d });
    }
    return out;
  };
  const items = [];   // {kind, v, x, y, z, s, sxz, yaw, lx, lz, col:[r,g,b], under}
  const tint = (k) => {
    if (k === 'pine') { const y = R(); return [0.86 + y * 0.22 + gauss(R) * 0.05, 0.9 + gauss(R) * 0.07, 0.8 + gauss(R) * 0.08]; }
    if (k === 'palmetto') { const v = 0.85 + R() * 0.3; return [v * (0.95 + R() * 0.12), v, v * (0.85 + R() * 0.3)]; }
    const v = 0.8 + R() * 0.28; return [v * (0.92 + R() * 0.12), v, v * (0.88 + R() * 0.15)];
  };
  // canopy
  for (const c of sample(density * 1.25, d => (d < 0 ? 0 : d < 6 ? 0.95 : 0.8))) {
    const edge = Math.exp(-Math.max(0, c.d) / 12);
    const pO = (oak * (1 + 0.8 * edge)) / sumC, pL = laurel / sumC, pP = pine / sumC * (1 - 0.15 * edge);
    const r = R() * (pO + pL + pP);
    let kind = r < pP ? 'pine' : r < pP + pO ? 'oak' : 'laurel_oak';
    let h;
    if (kind === 'pine') h = c.d < 10 && R() < 0.22 ? 6 + R() * 7 : clamp(19 + gauss(R) * 4.5, 13, 26);
    else if (kind === 'oak') h = clamp(10 + gauss(R) * 3.5, 6, 15);
    else h = clamp(15 + gauss(R) * 3, 10, 20);
    items.push({ kind, h: h * hScale, ...c, under: false });
  }
  // understory: saw palmetto everywhere (denser at the edge, spills 2 m onto the grass), wax myrtle at the edge
  for (const c of sample(palD, d => (interior + (1 - interior) * Math.exp(-Math.max(0, d) / 9)) * (d < -1.5 ? 0.3 : 1), 2.5))
    items.push({ kind: 'palmetto', h: clamp(1.25 + gauss(R) * 0.45, 0.6, 2.0), ...c, under: true });
  for (const c of sample(Math.max(0.05, shrubD), d => (d < 0 ? 0.25 : 0.1 + 0.9 * Math.exp(-d / 7)), 1))
    items.push({ kind: 'shrub', h: c.d < 8 ? 2 + R() * 2.8 : 1.1 + R() * 1.0, ...c, under: true });
  const maxN = opts.maxInstances ?? 15000;
  if (items.length > maxN) { console.warn(`forestBand: ${items.length} instances > maxInstances ${maxN}; thinning`); while (items.length > maxN) items.splice(Math.floor(R() * items.length), 1); }

  // group by kind x variant
  const groups = new Map();
  for (const it of items) {
    it.v = Math.floor(R() * VARIANTS);
    const tpl = template(THREE, it.kind, it.v);
    it.s = it.h / tpl.height; it.sxz = 0.85 + R() * 0.3; it.yaw = R() * TAU;
    it.lx = it.kind === 'pine' ? gauss(R) * 0.04 : gauss(R) * 0.015; it.lz = it.kind === 'pine' ? gauss(R) * 0.04 : gauss(R) * 0.015;
    it.y = th(it.x, it.z) - 0.05;
    it.col = tint(it.kind); it.bark = 0.85 + R() * 0.25; it.dither = 0.9 + R() * 0.2;
    const key = it.kind + ':' + it.v;
    if (!groups.has(key)) groups.set(key, { tpl, list: [] });
    groups.get(key).list.push(it);
  }
  const root = new THREE.Group(); root.name = opts.id || 'forest_band';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0);
  const G = [];
  const noRay = () => {};
  for (const [key, { tpl, list }] of groups) {
    const n = list.length;
    for (const it of list) {
      e.set(it.lx, it.yaw, it.lz, 'YXZ'); q.setFromEuler(e); pos.set(it.x, it.y, it.z); scl.set(it.s * it.sxz, it.s, it.s * it.sxz);
      it.m = new THREE.Matrix4().compose(pos, q, scl).toArray();
    }
    const mkIM = (geo, mat, name, cap, shadow) => {
      const im = new THREE.InstancedMesh(geo, mat, cap);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      im.name = name; im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = false; im.count = 0;
      root.add(im); return im;
    };
    const imp = impostorParts(THREE, tpl);
    const g = {
      key, tpl, list, under: list[0].under,
      wood: mkIM(tpl.woodGeo, tpl.woodMat, `${key}_trunks`, n, true),
      leaf: mkIM(tpl.leafGeo, tpl.leafMat, `${key}_leaves`, n, true),
      side: mkIM(imp.side.geo, imp.side.mat, `${key}_impostor`, n, false),
      top: mkIM(imp.top.geo, imp.top.mat, `${key}_crowncard`, n, false),
    };
    g.leaf.userData.porous = true; g.side.raycast = noRay; g.top.raycast = noRay; g.side.userData.noShadow = g.top.userData.noShadow = true;
    G.push(g);
  }
  const lodSq = lod * lod, uCullSq = uCull * uCull;
  const inv = new THREE.Matrix4(), camL = new THREE.Vector3(), last = new THREE.Vector3(1e9, 1e9, 1e9);
  // write partitions; cam = null -> everything full detail (Node / ray-cast state)
  function partition(cam) {
    for (const g of G) {
      const W = g.wood.instanceMatrix.array, L = g.leaf.instanceMatrix.array, S = g.side.instanceMatrix.array, T = g.top.instanceMatrix.array;
      const WC = g.wood.instanceColor.array, LC = g.leaf.instanceColor.array, SC = g.side.instanceColor.array, TC = g.top.instanceColor.array;
      let nn = 0, ns = 0, nt = 0;
      for (const it of g.list) {
        let near = true, topv = false;
        if (cam) {
          const dx = cam.x - it.x, dz = cam.z - it.z, dy = cam.y - (it.y + it.h * 0.7), h2 = dx * dx + dz * dz, d2 = h2 + dy * dy;
          const lim = (g.under ? lodSq * 0.36 : lodSq) * it.dither * it.dither;
          if (g.under && d2 > uCullSq * it.dither) continue;
          if (d2 > lim) {
            near = false; topv = dy > 0 && dy * dy > h2;     // > 45 deg above the crown -> flat crown card
            if (!topv) {
              q.setFromAxisAngle(UPV, Math.atan2(dx, dz)); pos.set(it.x, it.y, it.z); scl.set(it.s * it.sxz, it.s, it.s);
              m4.compose(pos, q, scl); m4.toArray(S, ns * 16);
              SC[ns * 3] = it.col[0]; SC[ns * 3 + 1] = it.col[1]; SC[ns * 3 + 2] = it.col[2]; ns++;
              continue;
            }
            for (let k = 0; k < 16; k++) T[nt * 16 + k] = it.m[k];
            TC[nt * 3] = it.col[0]; TC[nt * 3 + 1] = it.col[1]; TC[nt * 3 + 2] = it.col[2]; nt++;
            continue;
          }
        }
        for (let k = 0; k < 16; k++) { W[nn * 16 + k] = it.m[k]; L[nn * 16 + k] = it.m[k]; }
        WC[nn * 3] = WC[nn * 3 + 1] = WC[nn * 3 + 2] = it.bark;
        LC[nn * 3] = it.col[0]; LC[nn * 3 + 1] = it.col[1]; LC[nn * 3 + 2] = it.col[2]; nn++;
      }
      g.wood.count = g.leaf.count = nn; g.side.count = ns; g.top.count = nt;
      for (const im of [g.wood, g.leaf, g.side, g.top]) { im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
      if (nn) { g.wood.computeBoundingSphere(); g.leaf.computeBoundingSphere(); } else { g.wood.boundingSphere = g.leaf.boundingSphere = new THREE.Sphere(new THREE.Vector3(), -1); }
    }
  }
  function update(camera, force = false) {
    if (!camera) return;
    camera.updateMatrixWorld?.();
    camL.setFromMatrixPosition(camera.matrixWorld);
    root.updateMatrixWorld(); inv.copy(root.matrixWorld).invert(); camL.applyMatrix4(inv);
    if (!force && camL.distanceToSquared(last) < 16) return false;
    last.copy(camL); partition(camL); return true;
  }
  partition(null);
  // LOD driver: an invisible always-rendered triangle whose onBeforeRender re-partitions for the camera being drawn
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const driver = new THREE.Mesh(dg, memo('mat:driver', () => new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })));
  driver.name = 'forest_lod_driver'; driver.frustumCulled = false; driver.renderOrder = -1e6; driver.raycast = noRay;
  driver.userData.noShadow = true; driver.onBeforeRender = (r, s, cam) => { if (cam && cam.isPerspectiveCamera) update(cam); };
  root.add(driver);
  if (opts.floor) {
    // pine-straw / leaf-litter floor on a 4 m grid inside the band (edge hidden under the palmetto fringe)
    const pts = [], uv = [], idx = [], cell = 4, cols = Math.ceil((x1 - x0) / cell) + 1, rows = Math.ceil((z1 - z0) / cell) + 1;
    const vid = new Int32Array(cols * rows).fill(-1);
    const keep = (x, z) => { if (!pointInPoly(x, z, poly)) return false; const c = closestOnPolyline(x, z, front, closed); return c.d - edgeNoise(c.s, ph) > -1.5; };
    const V = (i, j) => { const k = j * cols + i; if (vid[k] < 0) { const x = x0 + i * cell, z = z0 + j * cell; vid[k] = pts.length / 3; pts.push(x, th(x, z) + 0.03, z); uv.push(x / 6, z / 6); } return vid[k]; };
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const cx = x0 + (i + 0.5) * cell, cz = z0 + (j + 0.5) * cell; if (!keep(cx, cz)) continue;
      const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1); idx.push(a, d, c, a, c, b);
    }
    if (idx.length) {
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      fg.setIndex(idx); fg.computeVertexNormals();
      const fm = new THREE.Mesh(fg, litterMat(THREE)); fm.name = 'forest_floor'; fm.receiveShadow = true; fm.raycast = noRay; root.add(fm);
    }
  }
  const counts = {}; for (const it of items) counts[it.kind] = (counts[it.kind] || 0) + 1;
  root.userData = { assetType: 'forest', scenery: true, source: 'trees.js', count: items.length, counts, lodDistance: lod, update: (cam) => update(cam, true),
    dims: { length: +(x1 - x0).toFixed(1), width: +(z1 - z0).toFixed(1), height: 26 } };
  return root;
}
