// web/assets.js — Sightline asset library FACADE (WORLD CONTRACT v2, SPEC.md). Shared by browser + Node.
//
//   import { loadAssets, createAssets } from './assets.js';
//   const assets = await loadAssets(THREE);            // preloads web/assets/*.js modules (missing ones are skipped)
//   const world  = createWorld(THREE, assets);
//
// Exposes EXACTLY the SPEC v2 API (vehicle, parkedVehicle, pedestrian, road, median, intersection, crosswalk, curb,
// sidewalk, signal, sign, pole, streetlight, shelter, building, tree, environment, skidMark, impactMarker, groundPlane).
// Each call delegates to the asset modules under web/assets/ when they provide that factory; if a module is missing,
// throws or returns nothing, the facade builds a simple procedural stand-in, and if THAT throws, a labeled box of the
// same dims. Every result: THREE.Object3D, name = id, userData.assetType, userData.dims {length,width,height},
// origin = ground-level center of footprint, rotation.y = 0 faces -Z (north), meshes cast/receive shadows.
// Node (headless): no textures / DOM; geometry only (opts.headless defaults to true when there is no document).

export const VEHICLE_DIMS = {
  sedan: [4.9, 1.9, 1.45], suv: [4.8, 1.95, 1.75], pickup: [5.9, 2.0, 1.9], van: [5.3, 2.0, 2.0],
  box_truck: [7.5, 2.5, 3.4], bus: [12.2, 2.55, 3.2], truck_tractor: [6.5, 2.5, 3.6], semitrailer: [16.2, 2.6, 4.1],
  motorcycle: [2.2, 0.8, 1.2], bicycle: [1.8, 0.6, 1.1],
};
export const VEHICLE_TYPES = Object.keys(VEHICLE_DIMS);
export const ASSET_METHODS = ['vehicle', 'parkedVehicle', 'pedestrian', 'road', 'median', 'intersection', 'crosswalk', 'curb',
  'sidewalk', 'signal', 'sign', 'pole', 'streetlight', 'shelter', 'building', 'tree', 'environment', 'skidMark', 'impactMarker', 'groundPlane'];
export const SIGN_KINDS = ['stop', 'yield', 'speed_limit', 'street_name', 'generic'];
export const BUILDING_KINDS = ['store', 'house', 'generic'];
export const GROUND_KINDS = ['grass', 'asphalt', 'dirt'];
export const MARKINGS = ['center_dashed', 'center_double', 'none'];

const MODULE_NAMES = ['vehicles', 'vehicles_heavy', 'vehicles_small', 'vehicle_parts', 'scene', 'textures', 'furniture', 'environment'];

/** Import every web/assets/<name>.js that exists. Returns { name: module }. Never throws. */
export async function loadAssetModules(names = MODULE_NAMES) {
  const out = {};
  const isNode = typeof window === 'undefined';
  await Promise.all(names.map(async (n) => {
    const url = new URL(`./assets/${n}.js`, import.meta.url);
    try {
      if (isNode) { const fs = await import('node:fs'); if (!fs.existsSync(url)) return; }
      out[n] = await import(url.href);
    } catch (e) { out[`_error_${n}`] = String(e && e.message || e); }
  }));
  return out;
}

/** Async convenience: preload modules, then build the facade. */
export async function loadAssets(THREE, opts = {}) {
  return createAssets(THREE, { ...opts, modules: opts.modules || await loadAssetModules() });
}

// ---------- delegation ----------
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pascal = (s) => s.split('_').map(cap).join('');
const THREEISH = /^(THREE|three|T|_THREE|THREE_|t3)$/;
function firstParam(fn) {
  const s = Function.prototype.toString.call(fn);
  const m = s.match(/^(?:async\s+)?(?:function\s*[\w$]*\s*)?\(\s*([\w$]+)/) || s.match(/^(?:async\s+)?([\w$]+)\s*=>/);
  return m ? m[1] : '';
}
const ALIASES = {
  vehicle: (type) => ['vehicle', 'createVehicle', 'makeVehicle', 'buildVehicle', `create${pascal(type || '')}`, `make${pascal(type || '')}`],
  parkedVehicle: () => ['parkedVehicle', 'createParkedVehicle'],
  pedestrian: () => ['pedestrian', 'createPedestrian', 'makePedestrian', 'person', 'createPerson'],
  groundPlane: () => ['groundPlane', 'createGroundPlane', 'ground', 'createGround', 'terrain', 'createTerrain'],
  environment: () => ['environment', 'createEnvironment', 'makeEnvironment'],
};
const namesFor = (method, arg0) => (ALIASES[method] ? ALIASES[method](arg0) : [method, `create${cap(method)}`, `make${cap(method)}`, `build${cap(method)}`]);

// ---------- facade ----------
export function createAssets(THREE, opts = {}) {
  const modules = opts.modules || {};
  const headless = opts.headless ?? (typeof document === 'undefined');
  const stats = {};
  const bump = (m, k) => { (stats[m] ||= { delegated: 0, fallback: 0, box: 0, errors: [] })[k]++; };
  const note = (m, e) => { const s = (stats[m] ||= { delegated: 0, fallback: 0, box: 0, errors: [] }); if (s.errors.length < 5) s.errors.push(String(e && e.message || e)); };

  const modOrder = Object.keys(modules).filter((k) => !k.startsWith('_') && modules[k]);
  function candidates(method, arg0) {
    const names = namesFor(method, arg0);
    const fns = [];
    for (const mn of modOrder) {
      const mod = modules[mn];
      for (const n of names) if (typeof mod[n] === 'function' && !fns.includes(mod[n])) fns.push(mod[n]);
    }
    return fns;
  }
  function invoke(fn, args) {
    return THREEISH.test(firstParam(fn)) ? fn(THREE, ...args) : fn(...args);
  }

  // ----- materials / helpers for procedural stand-ins -----
  const matCache = new Map();
  const mat = (color, extra = {}) => {
    const key = color + JSON.stringify(extra);
    if (!matCache.has(key) || extra.emissive !== undefined) {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...extra });
      if (extra.emissive !== undefined) return m;      // per-instance (lights toggle emissive)
      matCache.set(key, m);
    }
    return matCache.get(key);
  };
  const boxMesh = (w, h, d, color, x = 0, y = 0, z = 0, name) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'object' ? color : mat(color));
    m.position.set(x, y, z); if (name) m.name = name; return m;
  };
  const flat = (w, d, color, y = 0.01, x = 0, z = 0, name) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), typeof color === 'object' ? color : mat(color, { roughness: 0.95 }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); if (name) m.name = name; return m;
  };
  const cyl = (rt, rb, h, color, x = 0, y = 0, z = 0, seg = 12) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof color === 'object' ? color : mat(color));
    m.position.set(x, y, z); return m;
  };
  const colorOf = (c, dflt) => (c === undefined || c === null ? dflt : (typeof c === 'string' && !c.startsWith('#') && !/^0x/i.test(c) ? (NAMED[c.toLowerCase()] ?? dflt) : c));
  const NAMED = { white: 0xf2f2f2, black: 0x1a1a1a, silver: 0xb8bcc0, gray: 0x7a7d80, grey: 0x7a7d80, red: 0xa81c1c, blue: 0x1f3f8a, darkblue: 0x1d2c44,
    green: 0x2d6a3a, yellow: 0xe8c21a, orange: 0xd9741c, brown: 0x6b4a2e, beige: 0xcbb994, gold: 0xb89a4a, maroon: 0x5e1a1f, navy: 0x1b2747, tan: 0xc2a77a };

  function labeledBox(id, assetType, dims, color = 0x999999) {
    const g = new THREE.Group();
    g.add(boxMesh(dims.width, dims.height, dims.length, color, 0, dims.height / 2, 0));
    g.userData.fallback = 'box';
    return g;
  }

  function finalize(obj, id, assetType, dims, extra = {}) {
    obj.name = id || obj.name || assetType;
    obj.userData = obj.userData || {};
    obj.userData.assetType = assetType;
    if (!obj.userData.dims) obj.userData.dims = dims;
    Object.assign(obj.userData, extra);
    obj.traverse?.((o) => { if (o.isMesh) { o.castShadow = o.castShadow || !o.userData?.noShadow; o.receiveShadow = true; } });
    return obj;
  }

  /** run(method, assetType, dims, delegateArgs, builtin) → Object3D with fallbacks. */
  function run(method, assetType, dims, args, builtin, id, extra) {
    let obj = null;
    for (const fn of candidates(method, method === 'vehicle' ? assetType : undefined)) {
      try {
        const r = invoke(fn, args);
        if (r && (r.isObject3D || method === 'environment')) { obj = r; bump(method, 'delegated'); break; }
      } catch (e) { note(method, e); }
    }
    if (!obj) {
      try { obj = builtin(); if (obj) bump(method, 'fallback'); } catch (e) { note(method, e); }
    }
    if (!obj) { obj = labeledBox(id, assetType, dims); bump(method, 'box'); }
    const out = method === 'environment' ? obj : finalize(obj, id, assetType, dims, extra);
    opts.onCall?.(method, args, out);
    return out;
  }
  const D = (length, width, height) => ({ length, width, height });

  // ----- vehicles -----
  function builtinVehicle(type, { color, lightsOn = false } = {}) {
    const [L, W, H] = VEHICLE_DIMS[type] || VEHICLE_DIMS.sedan;
    const g = new THREE.Group();
    const body = mat(colorOf(color, 0x8a8f96), { metalness: 0.4, roughness: 0.45 });
    const glass = mat(0x1b232c, { metalness: 0.2, roughness: 0.1 });
    const tire = mat(0x151515, { roughness: 0.95 });
    const two = type === 'motorcycle' || type === 'bicycle';
    const rw = two ? (type === 'bicycle' ? 0.34 : 0.32) : Math.min(0.55, Math.max(0.33, H * 0.2));
    if (two) {
      g.add(boxMesh(W * 0.35, H * 0.35, L * 0.6, body, 0, rw + H * 0.2, 0));
      for (const z of [-L / 2 + rw, L / 2 - rw]) { const w = cyl(rw, rw, 0.1, tire, 0, rw, z, 16); w.rotation.z = Math.PI / 2; g.add(w); }
      g.add(boxMesh(0.4, 0.6, 0.3, mat(0x333333), 0, H - 0.3, 0.1));
    } else if (type === 'semitrailer') {
      const bed = 1.2;
      g.add(boxMesh(W, H - bed, L, body, 0, bed + (H - bed) / 2, 0));
      for (const z of [L / 2 - 2.2, L / 2 - 1.0]) for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) { const w = cyl(0.5, 0.5, 0.5, tire, x, 0.5, z, 16); w.rotation.z = Math.PI / 2; g.add(w); }
      for (const x of [-0.9, 0.9]) g.add(boxMesh(0.15, bed, 0.15, mat(0x555555), x, bed / 2, -L / 2 + 4));
    } else if (type === 'truck_tractor') {
      const hoodL = 1.9, cabL = 2.6, frame = 1.0;
      g.add(boxMesh(W * 0.92, 1.6, hoodL, body, 0, frame + 0.8 - 0.3, -L / 2 + hoodL / 2));                  // hood
      g.add(boxMesh(W, H - frame, cabL, body, 0, frame + (H - frame) / 2, -L / 2 + hoodL + cabL / 2));          // cab + sleeper
      g.add(boxMesh(W * 0.9, 0.5, 0.05, glass, 0, H - 1.0, -L / 2 + hoodL - 0.03));                            // windshield
      g.add(boxMesh(W * 0.8, 0.4, L - hoodL - cabL, mat(0x333333), 0, frame, L / 2 - (L - hoodL - cabL) / 2));  // chassis / fifth wheel
      for (const z of [-L / 2 + 1.1, L / 2 - 1.6, L / 2 - 0.5]) for (const x of [-W / 2 + 0.25, W / 2 - 0.25]) { const w = cyl(0.52, 0.52, 0.4, tire, x, 0.52, z, 16); w.rotation.z = Math.PI / 2; g.add(w); }
    } else {
      const tall = ['box_truck', 'bus', 'van'].includes(type);
      const clear = 0.18 + (tall ? 0.15 : 0);
      const beltH = tall ? H - clear : (type === 'pickup' ? 1.0 : H * 0.42);
      g.add(boxMesh(W, beltH, L, body, 0, clear + beltH / 2, 0));
      if (!tall) {
        const cabL = type === 'pickup' ? 2.2 : L * 0.5, cabZ = type === 'pickup' ? -L * 0.12 : L * 0.04;
        g.add(boxMesh(W * 0.9, H - clear - beltH, cabL, glass, 0, clear + beltH + (H - clear - beltH) / 2, cabZ, 'cabin'));
      } else {
        g.add(boxMesh(W * 1.002, 0.7, type === 'bus' ? L * 0.9 : 1.2, glass, 0, H - 0.9, type === 'bus' ? 0 : -L / 2 + 0.6, 'cabin'));
      }
      const zs = type === 'bus' ? [-L / 2 + 2.6, L / 2 - 3.0] : type === 'box_truck' ? [-L / 2 + 1.3, L / 2 - 1.4] : [-L / 2 + L * 0.18, L / 2 - L * 0.18];
      for (const z of zs) for (const x of [-W / 2 + 0.15, W / 2 - 0.15]) { const w = cyl(rw, rw, 0.25, tire, x, rw, z, 16); w.rotation.z = Math.PI / 2; g.add(w); }
    }
    // lights (front = -Z)
    const lampY = two ? H * 0.7 : Math.min(H * 0.45, 1.1), hw = two ? 0 : W / 2 - 0.25;
    const lamps = {};
    for (const [n, x, z, c] of [['headlight_L', -hw, -L / 2 - 0.01, 0xfff6dd], ['headlight_R', hw, -L / 2 - 0.01, 0xfff6dd], ['taillight_L', -hw, L / 2 + 0.01, 0xaa1111], ['taillight_R', hw, L / 2 + 0.01, 0xaa1111]]) {
      if (two && n.endsWith('_R')) continue;
      const m = boxMesh(two ? 0.15 : 0.3, 0.12, 0.04, mat(c, { emissive: 0x000000, emissiveIntensity: 1 }), x, lampY, z, n);
      m.userData.noShadow = true; lamps[n] = m; g.add(m);
    }
    const setLights = (on) => {
      for (const [n, m] of Object.entries(lamps)) m.material.emissive.setHex(on ? (n.startsWith('head') ? 0xfff2cc : 0xff1a1a) : 0x000000);
      g.userData.lightsOn = !!on;
    };
    setLights(lightsOn);
    g.userData.setLights = setLights;
    g.userData.driverEye = two ? [0, H + 0.35, 0.2] : type === 'truck_tractor' ? [-0.55, 2.6, -L / 2 + 2.3] : type === 'bus' ? [-0.7, 2.3, -L / 2 + 1.0] : [-0.37, Math.min(H - 0.25, 1.2 + (H - 1.45) * 0.9), -L * 0.04];
    if (type === 'semitrailer') { g.userData.kingpinOffset = -(L / 2 - 0.9); delete g.userData.driverEye; }
    return g;
  }

  const api = {
    catalog: { VEHICLE_DIMS, VEHICLE_TYPES, ASSET_METHODS, SIGN_KINDS, BUILDING_KINDS, GROUND_KINDS, MARKINGS },
    stats: () => JSON.parse(JSON.stringify(stats)),
    modules: modOrder,
    headless,

    vehicle(type, o = {}) {
      const t = VEHICLE_DIMS[type] ? type : 'sedan';
      if (t !== type) note('vehicle', `unknown vehicle type "${type}" (using sedan)`);
      const [L, W, H] = VEHICLE_DIMS[t];
      const args = [t, { ...o, headless }];
      const obj = run('vehicle', t, D(L, W, H), args, () => builtinVehicle(t, o), o.id, { vehicleType: t });
      if (typeof obj.userData.setLights !== 'function') obj.userData.setLights = () => {};
      if (t === 'semitrailer' && obj.userData.kingpinOffset === undefined) obj.userData.kingpinOffset = -(L / 2 - 0.9);
      if (o.lightsOn !== undefined) try { obj.userData.setLights(!!o.lightsOn); } catch {}
      return obj;
    },
    parkedVehicle(type, o = {}) {
      const v = api.vehicle(type, { ...o, lightsOn: false });
      v.userData.parked = true;
      try { v.userData.setLights(false); } catch {}
      return v;
    },
    pedestrian(o = {}) {
      const h = o.height || 1.7;
      return run('pedestrian', 'pedestrian', D(0.3, 0.5, h), [{ ...o, height: h, headless }], () => {
        const g = new THREE.Group(); const c = mat(colorOf(o.color, 0x3a4a6a));
        g.add(boxMesh(0.32, h * 0.45, 0.2, mat(0x2b2b33), 0, h * 0.225, 0));       // legs
        g.add(boxMesh(0.42, h * 0.33, 0.24, c, 0, h * 0.45 + h * 0.165, 0));       // torso
        const head = new THREE.Mesh(new THREE.SphereGeometry(h * 0.065, 12, 10), mat(0xc9a27e)); head.position.y = h - h * 0.07; g.add(head);
        return g;
      }, o.id, { eyeHeight: h * 0.93 });
    },
    road(o = {}) {
      const lanes = o.lanes ?? 2, lw = o.laneWidth ?? 3.6, len = o.length ?? 100, sh = o.shoulder ?? 0, mk = o.markings ?? 'center_dashed', edge = o.edgeLines ?? true;
      const W = lanes * lw + 2 * sh;
      return run('road', 'road', D(len, W, 0.02), [{ ...o, lanes, laneWidth: lw, length: len, shoulder: sh, markings: mk, edgeLines: edge, headless }], () => {
        const g = new THREE.Group();
        g.add(flat(W, len, mat(0x3a3a3c, { roughness: 0.95 }), 0.01));
        const white = mat(0xf0f0f0, { roughness: 0.6 }), yellow = mat(0xf2c200, { roughness: 0.6 });
        const x0 = -lanes * lw / 2;
        if (edge) for (const x of [x0 + 0.1, -x0 - 0.1]) g.add(flat(0.15, len, white, 0.02, x));
        for (let i = 1; i < lanes; i++) {
          const x = x0 + i * lw, center = i === lanes / 2;
          if (center && mk === 'center_double') { g.add(flat(0.12, len, yellow, 0.021, x - 0.12)); g.add(flat(0.12, len, yellow, 0.021, x + 0.12)); }
          else if (mk !== 'none') for (let z = -len / 2; z < len / 2 - 3; z += 12) g.add(flat(0.12, 3, center && mk === 'center_dashed' && lanes === 2 ? yellow : white, 0.021, x, z + 1.5));
        }
        return g;
      }, o.id, { lanes, laneWidth: lw, shoulder: sh });
    },
    median(o = {}) {
      const w = o.width ?? 4, len = o.length ?? 100;
      return run('median', 'median', D(len, w, 0.15), [{ ...o, width: w, length: len, headless }], () => {
        const g = new THREE.Group(); g.add(flat(w, len, mat(0x5d7a3a, { roughness: 1 }), 0.012)); return g;
      }, o.id);
    },
    intersection(o = {}) {
      const s = o.size ?? 15;
      return run('intersection', 'intersection', D(s, s, 0.02), [{ ...o, size: s, headless }], () => {
        const g = new THREE.Group(); g.add(flat(s, s, mat(0x3a3a3c, { roughness: 0.95 }), 0.013)); return g;
      }, o.id);
    },
    crosswalk(o = {}) {
      const w = o.width ?? 3, len = o.length ?? 10;
      return run('crosswalk', 'crosswalk', D(len, w, 0.02), [{ ...o, width: w, length: len, headless }], () => {
        const g = new THREE.Group(); const white = mat(0xf0f0f0, { roughness: 0.6 });
        for (let z = -len / 2 + 0.3; z < len / 2; z += 1.2) g.add(flat(w, 0.6, white, 0.022, 0, z + 0.3));
        return g;
      }, o.id);
    },
    curb(o = {}) {
      const len = o.length ?? 20;
      return run('curb', 'curb', D(len, 0.15, 0.15), [{ ...o, length: len, headless }], () => {
        const g = new THREE.Group(); g.add(boxMesh(0.15, 0.15, len, 0xb5b2aa, 0, 0.075, 0)); return g;
      }, o.id);
    },
    sidewalk(o = {}) {
      const w = o.width ?? 2, len = o.length ?? 20;
      return run('sidewalk', 'sidewalk', D(len, w, 0.15), [{ ...o, width: w, length: len, headless }], () => {
        const g = new THREE.Group(); g.add(boxMesh(w, 0.15, len, 0xbdb9b0, 0, 0.075, 0)); return g;
      }, o.id);
    },
    signal(o = {}) {
      const heads = o.heads ?? 1, ph = o.poleHeight ?? 5.5, arm = o.armLength ?? 0;
      const obj = run('signal', 'signal', D(0.4, Math.max(0.4, arm), ph + 0.5), [{ ...o, heads, poleHeight: ph, armLength: arm, headless }], () => {
        const g = new THREE.Group(); const metal = mat(0x4a4d50, { metalness: 0.6, roughness: 0.4 });
        g.add(cyl(0.1, 0.12, ph, metal, 0, ph / 2, 0));
        if (arm > 0) g.add(boxMesh(arm, 0.12, 0.12, metal, -arm / 2, ph - 0.2, 0));
        const lamps = { red: [], yellow: [], green: [] };
        for (let i = 0; i < heads; i++) {
          const hx = arm > 0 ? -arm + 0.4 + i * Math.max(0.8, (arm - 0.6) / Math.max(1, heads)) : 0;
          const hy = arm > 0 ? ph - 0.7 : ph - 0.6;
          g.add(boxMesh(0.36, 1.05, 0.3, mat(0x1d1f20), hx, hy, 0));
          [['red', 0.33], ['yellow', 0], ['green', -0.33]].forEach(([c, dy]) => {
            const lamp = cyl(0.12, 0.12, 0.05, mat({ red: 0x551111, yellow: 0x554411, green: 0x115522 }[c], { emissive: 0x000000, emissiveIntensity: 1.5 }), hx, hy + dy, -0.17, 14);
            lamp.rotation.x = Math.PI / 2; lamp.name = `lamp_${c}_${i}`; lamp.userData.noShadow = true; lamps[c].push(lamp); g.add(lamp);
          });
        }
        g.userData.setState = (s) => {
          for (const [c, list] of Object.entries(lamps)) for (const l of list) l.material.emissive.setHex(c === s ? { red: 0xff2a1a, yellow: 0xffb000, green: 0x22ff66 }[c] : 0x000000);
          g.userData.state = s;
        };
        g.userData.setState('off');
        return g;
      }, o.id);
      if (typeof obj.userData.setState !== 'function') obj.userData.setState = (s) => { obj.userData.state = s; };
      return obj;
    },
    sign(o = {}) {
      const kind = SIGN_KINDS.includes(o.kind) ? o.kind : 'generic';
      return run('sign', 'sign', D(0.1, 0.8, 2.6), [{ ...o, kind, headless }], () => {
        const g = new THREE.Group();
        g.add(cyl(0.04, 0.04, 2.2, mat(0x8a8d90, { metalness: 0.6 }), 0, 1.1, 0, 8));
        const face = { stop: 0xc41e1e, yield: 0xf2f2f2, speed_limit: 0xf2f2f2, street_name: 0x1d6b3a, generic: 0xe8c21a }[kind];
        g.add(boxMesh(kind === 'street_name' ? 1.2 : 0.75, kind === 'street_name' ? 0.25 : 0.75, 0.03, face, 0, 2.2 + 0.3, -0.03));
        return g;
      }, o.id, { kind, text: o.text });
    },
    pole(o = {}) {
      const h = o.height ?? 10;
      return run('pole', 'pole', D(0.35, 0.35, h), [{ ...o, height: h, headless }], () => {
        const g = new THREE.Group(); g.add(cyl(0.14, 0.18, h, mat(0x6b4f33, { roughness: 0.95 }), 0, h / 2, 0, 10)); return g;
      }, o.id);
    },
    streetlight(o = {}) {
      const h = o.height ?? 9;
      return run('streetlight', 'streetlight', D(0.4, 2.5, h), [{ ...o, height: h, on: !!o.on, headless }], () => {
        const g = new THREE.Group(); const metal = mat(0x6d7073, { metalness: 0.6, roughness: 0.4 });
        g.add(cyl(0.08, 0.12, h, metal, 0, h / 2, 0, 10));
        g.add(boxMesh(0.1, 0.1, 2.2, metal, 0, h - 0.1, -1.1));
        const lamp = boxMesh(0.35, 0.12, 0.6, mat(0xfff1c8, { emissive: o.on ? 0xffe7a8 : 0x000000, emissiveIntensity: 1.2 }), 0, h - 0.22, -2.1, 'lamp');
        lamp.userData.noShadow = true; g.add(lamp);
        return g;
      }, o.id, { on: !!o.on });
    },
    shelter(o = {}) {
      const open = o.open ?? true;
      return run('shelter', 'shelter', D(1.5, 3.5, 2.5), [{ ...o, open, headless }], () => {
        const g = new THREE.Group(); const metal = mat(0x4f5a66, { metalness: 0.5, roughness: 0.5 });
        g.add(boxMesh(3.5, 0.1, 1.5, metal, 0, 2.45, 0));
        for (const [x, z] of [[-1.7, -0.7], [1.7, -0.7], [-1.7, 0.7], [1.7, 0.7]]) g.add(boxMesh(0.08, 2.4, 0.08, metal, x, 1.2, z));
        if (!open) { g.add(boxMesh(3.4, 2.0, 0.04, mat(0x8fa7b5, { transparent: true, opacity: 0.35 }), 0, 1.2, 0.72)); }
        g.add(boxMesh(2.6, 0.08, 0.45, mat(0x7a5a3a), 0, 0.45, 0.45));
        return g;
      }, o.id, { open });
    },
    building(o = {}) {
      const w = o.w ?? 12, d = o.d ?? 10, h = o.h ?? 4, kind = BUILDING_KINDS.includes(o.kind) ? o.kind : 'generic';
      return run('building', 'building', D(d, w, h), [{ ...o, w, d, h, kind, headless }], () => {
        const g = new THREE.Group();
        g.add(boxMesh(w, h, d, { store: 0xb3a58c, house: 0xd8cfc0, generic: 0xa8a8a2 }[kind], 0, h / 2, 0));
        g.add(boxMesh(w + 0.3, 0.3, d + 0.3, 0x6f6658, 0, h + 0.15, 0));
        if (kind === 'store') g.add(boxMesh(w * 0.7, h * 0.45, 0.05, mat(0x22323f, { metalness: 0.3, roughness: 0.1 }), 0, h * 0.35, -d / 2 - 0.03));
        return g;
      }, o.id, { kind });
    },
    tree(o = {}) {
      const h = o.height ?? 8;
      return run('tree', 'tree', D(h * 0.5, h * 0.5, h), [{ ...o, height: h, headless }], () => {
        const g = new THREE.Group();
        g.add(cyl(h * 0.03, h * 0.04, h * 0.45, mat(0x5a4330), 0, h * 0.225, 0, 8));
        const c = new THREE.Mesh(new THREE.SphereGeometry(h * 0.27, 12, 10), mat(0x3d6b35, { roughness: 1 })); c.position.y = h * 0.68; g.add(c);
        return g;
      }, o.id);
    },
    skidMark(o = {}) {
      const pts = (o.points || []).filter((p) => Array.isArray(p) && p.length >= 2);
      const w = o.width ?? 0.25;
      let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      return run('skidMark', 'skidMark', D(len, w, 0.01), [{ ...o, points: pts, width: w, headless }], () => {
        const g = new THREE.Group(); const m = mat(0x141414, { roughness: 1, transparent: true, opacity: 0.85 });
        for (let i = 1; i < pts.length; i++) {
          const [x0, z0] = pts[i - 1], [x1, z1] = pts[i]; const l = Math.hypot(x1 - x0, z1 - z0); if (l < 1e-6) continue;
          const s = flat(w, l, m, 0.025, (x0 + x1) / 2, (z0 + z1) / 2); s.rotation.z = Math.atan2(x1 - x0, z1 - z0); s.userData.noShadow = true; g.add(s);
        }
        return g;
      }, o.id, { length: len, points: pts });
    },
    impactMarker(o = {}) {
      const p = o.position || [0, 0];
      const obj = run('impactMarker', 'impactMarker', D(1.4, 1.4, 0.03), [{ ...o, position: p, headless }], () => {
        const g = new THREE.Group(); const c = cyl(0.7, 0.7, 0.02, mat(0xff00aa, { emissive: 0x330022 }), 0, 0.04, 0, 24); c.userData.noShadow = true; g.add(c); return g;
      }, o.id);
      if (obj.position.x === 0 && obj.position.z === 0) obj.position.set(p[0], 0, p[1]);
      return obj;
    },
    groundPlane(o = {}) {
      const s = o.size ?? 1000, kind = GROUND_KINDS.includes(o.kind) ? o.kind : 'grass';
      return run('groundPlane', 'groundPlane', D(s, s, 0), [{ ...o, size: s, kind, headless }], () => {
        const g = new THREE.Group(); g.add(flat(s, s, mat({ grass: 0x6f7f4f, asphalt: 0x3d3d3f, dirt: 0x8a7556 }[kind], { roughness: 1 }), 0)); return g;
      }, o.id || 'ground', { kind });
    },
    environment(o = {}) {
      const env = run('environment', 'environment', D(0, 0, 0), [{ ...o, Sky: o.Sky || opts.Sky, headless }], () => builtinEnvironment(o), o.id || 'environment');
      return wrapEnvironment(env, o);
    },
  };

  // ----- environment -----
  function sunFromOpts(o) {
    if (Number.isFinite(o.sunAzimuthDeg) && Number.isFinite(o.sunElevationDeg)) return { az: o.sunAzimuthDeg, el: o.sunElevationDeg };
    if (o.date && Number.isFinite(o.lat) && Number.isFinite(o.lon)) {
      try {
        const em = modules.environment;
        let r;
        if (em && typeof em.solarPosition === 'function' && typeof em.resolveDate === 'function') r = em.solarPosition(em.resolveDate(o.date, o.timeOfDay, o.utcOffset, o.lon).date, o.lat, o.lon);
        else r = solarPosition({ date: String(o.date).slice(0, 10), time: o.timeOfDay, lat: o.lat, lon: o.lon, utcOffset: o.utcOffset });
        if (Number.isFinite(r.azimuthDeg) && Number.isFinite(r.elevationDeg)) return { az: r.azimuthDeg, el: r.elevationDeg };
      } catch {}
    }
    const hm = String(o.timeOfDay || '12:00').split(':').map(Number);
    const h = (hm[0] || 12) + (hm[1] || 0) / 60;
    const el = Math.max(-10, 60 * Math.sin(Math.PI * (h - 6) / 13));
    return { az: 90 + (h - 6) * (180 / 13), el };   // rough: east at 06:00 → south at noon → west at 19:00
  }
  function builtinEnvironment(o) {
    const lighting = o.lighting || 'day', weather = o.weather || 'clear';
    const { az, el } = sunFromOpts(o);
    const g = new THREE.Group();
    const night = lighting === 'night' || el < -4, low = el < 12;
    const over = weather === 'overcast' || weather === 'rain';
    const hemi = new THREE.HemisphereLight(night ? 0x1a2440 : low ? 0xffd2a8 : 0xdfe9ff, night ? 0x05060a : 0x5a5a40, night ? 0.15 : over ? 0.9 : 0.75);
    hemi.name = 'env_hemi';
    const sun = new THREE.DirectionalLight(night ? 0x6678a8 : low ? 0xffb070 : 0xfff2dc, night ? 0.1 : over ? 0.6 : 1.8);
    sun.name = 'env_sun';
    const azr = az * Math.PI / 180, elr = Math.max(2, el) * Math.PI / 180, R = 200;
    sun.position.set(R * Math.cos(elr) * Math.sin(azr), R * Math.sin(elr), -R * Math.cos(elr) * Math.cos(azr)); // az from north, clockwise (east = +X)
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 600 });
    g.add(hemi, sun, sun.target);
    const skyColor = night ? 0x02040a : over ? 0xa9b2bb : low ? 0xe8b48a : 0x9ec9ec;
    g.userData.sky = { color: skyColor, fogColor: skyColor, fogNear: night ? 35 : over ? 120 : 250, fogFar: night ? 220 : over ? 600 : 1200, sunAzimuthDeg: az, sunElevationDeg: el, lighting, weather };
    return g;
  }
  function wrapEnvironment(env, o) {
    let g = env;
    if (env && !env.isObject3D && env.group?.isObject3D) {            // environment.js: { group, sun, hemisphere, sky, fog, update, info }
      g = env.group;
      g.userData.envApi = env;                                         // viewer: scene.fog = envApi.fog; envApi.update(camera)
      g.userData.sky = { ...(env.info || {}), fog: env.fog || null, background: env.background || null, skyMesh: env.sky || null };
      g.lights = [env.sun, env.hemisphere].filter(Boolean);
    } else if (!env || !env.isObject3D) {
      g = new THREE.Group();
      for (const l of env?.lights || []) if (l?.isObject3D) g.add(l);
      g.userData.sky = env?.sky || {};
    }
    g.name = o.id || g.name || 'environment';
    g.userData.assetType = 'environment';
    g.userData.isEnvironment = true;
    g.userData.timeOfDay = o.timeOfDay; g.userData.lighting = o.lighting; g.userData.weather = o.weather;
    g.lights = g.lights || g.children.filter((c) => c.isLight);
    g.sky = g.sky || g.userData.sky || {};
    return g;
  }

  return api;
}

/** Low-precision solar position (NOAA). date 'YYYY-MM-DD', time 'HH:MM' local, utcOffset hours (e.g. -4 for EDT). Azimuth from north, clockwise. */
export function solarPosition({ date, time = '12:00', lat, lon, utcOffset }) {
  const [Y, M, Dd] = String(date).split('-').map(Number);
  const [hh, mm] = String(time).split(':').map(Number);
  const off = Number.isFinite(utcOffset) ? utcOffset : Math.round(lon / 15);
  const ms = Date.UTC(Y, M - 1, Dd, hh - off, mm || 0);
  const d = ms / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * Math.PI / 180;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * Math.PI / 180;
  const e = (23.439 - 0.00000036 * d) * Math.PI / 180;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const lst = (gmst * 15 + lon) * Math.PI / 180;
  const ha = lst - ra, la = lat * Math.PI / 180;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { azimuthDeg: ((az * 180 / Math.PI) + 360) % 360, elevationDeg: el * 180 / Math.PI };
}

export default createAssets;
