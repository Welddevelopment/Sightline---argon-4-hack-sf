// Sightline studio world (Contract v1, self-contained procedural ES module):
// Car into turning tractor-semitrailer at an uncontrolled median crossover, US-27A near Williston, Florida (May 7, 2016)
// Physical facts from NTSB Highway Accident Report NTSB/HAR-17/02 (accident ID HWY16FH018).
// Witnesses A, B and C are FICTIONAL. No real names or brand names are used.
// Frame: meters, +Y up, ground y = 0 at initial point of impact (POI), +X = east, -Z = north, +Z = south.
// Vehicle local convention: origin at ground-level footprint center, local -Z = vehicle front, compass heading h -> rotation.y = -h * PI / 180.

export default function createWorld(THREE) {
  const D2R = Math.PI / 180;
  const PI = Math.PI;
  const TAU = Math.PI * 2;

  const root = new THREE.Group();
  root.name = 'world_root';
  const objects = {};

  // =========================================================================
  // 1. DETERMINISTIC PRNG & PROCEDURAL NOISE UTILITIES
  // =========================================================================
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function valueNoise2D(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  function fbm2D(x, y, octaves = 4) {
    let v = 0;
    let amp = 0.5;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
      v += amp * valueNoise2D(x * freq, y * freq);
      freq *= 2.03;
      amp *= 0.5;
    }
    return v;
  }

  // =========================================================================
  // 2. CANVAS TEXTURE GENERATOR HELPERS (Node-safe fallback)
  // =========================================================================
  const mkCanvas = (w, h) =>
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : typeof document !== 'undefined'
      ? Object.assign(document.createElement('canvas'), { width: w, height: h })
      : null;

  const texCache = {};

  function makeCanvasTexture(key, w, h, drawFn, repeatX = 1, repeatY = 1) {
    if (texCache[key]) return texCache[key];
    const c = mkCanvas(w, h);
    if (!c) return null;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    drawFn(ctx, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.needsUpdate = true;
    texCache[key] = tex;
    return tex;
  }

  function getAsphaltTexture(repeatX = 60, repeatY = 2) {
    return makeCanvasTexture(
      `asphalt_${repeatX}_${repeatY}`,
      512,
      512,
      (ctx, w, h) => {
        const rng = mulberry32(101);
        ctx.fillStyle = '#383a3d';
        ctx.fillRect(0, 0, w, h);

        // Aggregate grain
        for (let i = 0; i < 18000; i++) {
          const x = Math.floor(rng() * w);
          const y = Math.floor(rng() * h);
          const v = 42 + Math.floor((rng() - 0.5) * 32);
          ctx.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
          ctx.fillRect(x, y, 2, 2);
        }

        // Longitudinal wheel-path darkening (two lanes across width)
        const wheelTracks = [0.16, 0.34, 0.66, 0.84];
        for (const wt of wheelTracks) {
          const grad = ctx.createLinearGradient(0, (wt - 0.08) * h, 0, (wt + 0.08) * h);
          grad.addColorStop(0, 'rgba(18,19,21,0)');
          grad.addColorStop(0.5, 'rgba(18,19,21,0.34)');
          grad.addColorStop(1, 'rgba(18,19,21,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, (wt - 0.08) * h, w, 0.16 * h);
        }

        // Subtle tar snakes / sealed cracks
        ctx.strokeStyle = 'rgba(22, 23, 25, 0.45)';
        ctx.lineWidth = 1.5;
        for (let c = 0; c < 7; c++) {
          ctx.beginPath();
          let cy = rng() * h;
          ctx.moveTo(0, cy);
          for (let x = 0; x <= w; x += 16) {
            cy += (rng() - 0.5) * 6;
            ctx.lineTo(x, cy);
          }
          ctx.stroke();
        }
      },
      repeatX,
      repeatY
    );
  }

  function getGrassTexture(repeatX = 40, repeatY = 40) {
    return makeCanvasTexture(
      `grass_${repeatX}_${repeatY}`,
      512,
      512,
      (ctx, w, h) => {
        const rng = mulberry32(202);
        ctx.fillStyle = '#697b4c';
        ctx.fillRect(0, 0, w, h);

        // Sandy soil & Bahia patches
        for (let i = 0; i < 450; i++) {
          const x = rng() * w;
          const y = rng() * h;
          const r = 8 + rng() * 36;
          const isSand = rng() < 0.28;
          const g = ctx.createRadialGradient(x, y, 1, x, y, r);
          if (isSand) {
            g.addColorStop(0, 'rgba(154, 142, 106, 0.35)');
            g.addColorStop(1, 'rgba(154, 142, 106, 0)');
          } else {
            const dark = rng() < 0.5;
            g.addColorStop(0, dark ? 'rgba(78, 98, 52, 0.35)' : 'rgba(122, 142, 82, 0.32)');
            g.addColorStop(1, 'rgba(95, 115, 65, 0)');
          }
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.fill();
        }

        // Fine grass blade stipple
        for (let i = 0; i < 14000; i++) {
          const x = rng() * w;
          const y = rng() * h;
          const dr = Math.floor((rng() - 0.5) * 24);
          ctx.fillStyle = `rgb(${102 + dr}, ${122 + dr}, ${72 + dr})`;
          ctx.fillRect(x, y, 1.5, 3);
        }
      },
      repeatX,
      repeatY
    );
  }

  function getLimerockGravelTexture(repeatX = 8, repeatY = 4) {
    return makeCanvasTexture(
      `limerock_${repeatX}_${repeatY}`,
      256,
      256,
      (ctx, w, h) => {
        const rng = mulberry32(303);
        ctx.fillStyle = '#b8b2a4';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 9000; i++) {
          const x = rng() * w;
          const y = rng() * h;
          const v = 155 + Math.floor((rng() - 0.5) * 55);
          ctx.fillStyle = `rgb(${v + 6},${v + 2},${v - 8})`;
          const s = rng() < 0.15 ? 3 : 1.5;
          ctx.fillRect(x, y, s, s);
        }
      },
      repeatX,
      repeatY
    );
  }

  function getReeferSideTexture() {
    return makeCanvasTexture(
      'reefer_side_ribbed',
      1024,
      256,
      (ctx, w, h) => {
        ctx.fillStyle = '#f3f3ef';
        ctx.fillRect(0, 0, w, h);

        // Vertical ribs every 8 px
        for (let x = 0; x < w; x += 8) {
          ctx.fillStyle = 'rgba(210, 212, 208, 0.75)';
          ctx.fillRect(x, 0, 2, h);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.fillRect(x + 2, 0, 2, h);
        }

        // Horizontal panel seams & rivet lines
        for (const sy of [14, h - 18]) {
          ctx.fillStyle = '#dcdcd6';
          ctx.fillRect(0, sy, w, 4);
        }

        // Subtle weathering at bottom rail
        const grad = ctx.createLinearGradient(0, h * 0.75, 0, h);
        grad.addColorStop(0, 'rgba(120, 118, 112, 0)');
        grad.addColorStop(1, 'rgba(120, 118, 112, 0.22)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, h * 0.75, w, h * 0.25);
      },
      1,
      1
    );
  }

  function getStopSignTexture() {
    return makeCanvasTexture(
      'sign_stop_r1_1',
      256,
      256,
      (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        const cx = w / 2;
        const cy = h / 2;
        const r = w * 0.48;

        const poly = (rad, color) => {
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = (i * PI) / 4 + PI / 8;
            const px = cx + Math.cos(a) * rad;
            const py = cy + Math.sin(a) * rad;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
        };

        poly(r, '#ffffff');
        poly(r * 0.92, '#c41e28');

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 74px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('STOP', cx, cy + 4);
      },
      1,
      1
    );
  }

  function getSpeedLimitSignTexture(speed = '65') {
    return makeCanvasTexture(
      `sign_speed_${speed}`,
      256,
      340,
      (ctx, w, h) => {
        ctx.fillStyle = '#f4f4f4';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = '#181818';
        ctx.lineWidth = 10;
        ctx.strokeRect(10, 10, w - 20, h - 20);

        ctx.fillStyle = '#141414';
        ctx.textAlign = 'center';
        ctx.font = 'bold 42px sans-serif';
        ctx.fillText('SPEED', w / 2, 72);
        ctx.fillText('LIMIT', w / 2, 124);

        ctx.font = 'bold 142px sans-serif';
        ctx.fillText(speed, w / 2, 268);
      },
      1,
      1
    );
  }

  function getStoreSignTexture() {
    return makeCanvasTexture(
      'store_sign_board',
      512,
      128,
      (ctx, w, h) => {
        ctx.fillStyle = '#2f452c';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#e0c68c';
        ctx.lineWidth = 6;
        ctx.strokeRect(6, 6, w - 12, h - 12);

        ctx.fillStyle = '#f7f2e4';
        ctx.textAlign = 'center';
        ctx.font = 'bold 44px serif';
        ctx.fillText('FARM FEED & GROCERY', w / 2, 58);
        ctx.fillStyle = '#e0c68c';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText('ICE • BAIT • HARDWARE • COLD DRINKS', w / 2, 98);
      },
      1,
      1
    );
  }

  function getStuccoWallTexture(repeatX = 4, repeatY = 2) {
    return makeCanvasTexture(
      `stucco_${repeatX}_${repeatY}`,
      256,
      256,
      (ctx, w, h) => {
        const rng = mulberry32(404);
        ctx.fillStyle = '#b99874';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 6500; i++) {
          const x = rng() * w;
          const y = rng() * h;
          const d = Math.floor((rng() - 0.5) * 22);
          ctx.fillStyle = `rgb(${185 + d},${152 + d},${116 + d})`;
          ctx.fillRect(x, y, 2, 2);
        }
      },
      repeatX,
      repeatY
    );
  }

  function getLeafClusterTexture() {
    return makeCanvasTexture(
      'leaf_cluster_alpha',
      128,
      128,
      (ctx, w, h) => {
        const rng = mulberry32(505);
        ctx.clearRect(0, 0, w, h);
        const cx = w / 2;
        const cy = h / 2;
        for (let i = 0; i < 65; i++) {
          const a = rng() * TAU;
          const rad = Math.pow(rng(), 0.65) * 48;
          const lx = cx + Math.cos(a) * rad;
          const ly = cy + Math.sin(a) * rad;
          const rx = 7 + rng() * 9;
          const ry = 4 + rng() * 6;
          const rot = rng() * PI;
          const g = 72 + Math.floor(rng() * 44);
          const r = 44 + Math.floor(rng() * 28);
          const b = 28 + Math.floor(rng() * 20);
          ctx.save();
          ctx.translate(lx, ly);
          ctx.rotate(rot);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.beginPath();
          ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
      },
      1,
      1
    );
  }

  // =========================================================================
  // 3. SHARED MATERIALS & GEOMETRY CACHES
  // =========================================================================
  const matCache = {};
  function getMat(key, factory) {
    if (!matCache[key]) matCache[key] = factory();
    return matCache[key];
  }

  const MAT = {
    asphaltMain: () =>
      getMat('asphaltMain', () => {
        const map = getAsphaltTexture(65, 2);
        return new THREE.MeshStandardMaterial({
          color: map ? 0xffffff : 0x3a3c3f,
          map: map || null,
          roughness: 0.82,
          metalness: 0.0,
        });
      }),
    asphaltTurn: () =>
      getMat('asphaltTurn', () => {
        const map = getAsphaltTexture(18, 1);
        return new THREE.MeshStandardMaterial({
          color: map ? 0xf6f6f6 : 0x3d3f42,
          map: map || null,
          roughness: 0.84,
          metalness: 0.0,
        });
      }),
    asphaltShoulder: () =>
      getMat('asphaltShoulder', () => {
        const map = getAsphaltTexture(65, 0.5);
        return new THREE.MeshStandardMaterial({
          color: map ? 0xdedede : 0x434548,
          map: map || null,
          roughness: 0.87,
          metalness: 0.0,
        });
      }),
    asphaltSideRoad: () =>
      getMat('asphaltSideRoad', () => {
        const map = getAsphaltTexture(16, 1.5);
        return new THREE.MeshStandardMaterial({
          color: map ? 0xebebeb : 0x45474a,
          map: map || null,
          roughness: 0.86,
          metalness: 0.0,
        });
      }),
    grassGround: () =>
      getMat('grassGround', () => {
        const map = getGrassTexture(48, 48);
        return new THREE.MeshStandardMaterial({
          color: map ? 0xffffff : 0x6b7c4e,
          map: map || null,
          roughness: 0.92,
          metalness: 0.0,
        });
      }),
    grassMedian: () =>
      getMat('grassMedian', () => {
        const map = getGrassTexture(28, 3);
        return new THREE.MeshStandardMaterial({
          color: map ? 0xf7faef : 0x748854,
          map: map || null,
          roughness: 0.91,
          metalness: 0.0,
        });
      }),
    limerock: () =>
      getMat('limerock', () => {
        const map = getLimerockGravelTexture(6, 3);
        return new THREE.MeshStandardMaterial({
          color: map ? 0xffffff : 0xb8b3a8,
          map: map || null,
          roughness: 0.9,
          metalness: 0.0,
        });
      }),
    paintWhite: () =>
      getMat(
        'paintWhite',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xf0f0f0,
            roughness: 0.52,
            metalness: 0.02,
          })
      ),
    paintYellow: () =>
      getMat(
        'paintYellow',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xeab81c,
            roughness: 0.52,
            metalness: 0.02,
          })
      ),
    paintRedDot: () =>
      getMat(
        'paintRedDot',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xc41e3a,
            roughness: 0.35,
            metalness: 0.15,
          })
      ),
    paintWhiteDot: () =>
      getMat(
        'paintWhiteDot',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xf5f5f5,
            roughness: 0.35,
            metalness: 0.15,
          })
      ),
    chrome: () =>
      getMat(
        'chrome',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xd8dcdf,
            roughness: 0.16,
            metalness: 0.9,
          })
      ),
    alloyRim: () =>
      getMat(
        'alloyRim',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xc4c8cc,
            roughness: 0.25,
            metalness: 0.82,
          })
      ),
    steelGalv: () =>
      getMat(
        'steelGalv',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x8c9094,
            roughness: 0.48,
            metalness: 0.75,
          })
      ),
    darkSteel: () =>
      getMat(
        'darkSteel',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x2c2f33,
            roughness: 0.58,
            metalness: 0.65,
          })
      ),
    chassisBlack: () =>
      getMat(
        'chassisBlack',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x1a1c1e,
            roughness: 0.72,
            metalness: 0.35,
          })
      ),
    tireRubber: () =>
      getMat(
        'tireRubber',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x1c1d1f,
            roughness: 0.86,
            metalness: 0.04,
          })
      ),
    brakeDisc: () =>
      getMat(
        'brakeDisc',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x7e8286,
            roughness: 0.42,
            metalness: 0.78,
          })
      ),
    carGlass: () =>
      getMat('carGlass', () => {
        const Cls = THREE.MeshPhysicalMaterial || THREE.MeshStandardMaterial;
        return new Cls({
          color: 0x152028,
          roughness: 0.08,
          metalness: 0.1,
          transparent: true,
          opacity: 0.72,
        });
      }),
    interiorDark: () =>
      getMat(
        'interiorDark',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x1e2024,
            roughness: 0.82,
            metalness: 0.05,
          })
      ),
    headlampOff: () =>
      getMat(
        'headlampOff',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xd8e0e8,
            roughness: 0.15,
            metalness: 0.5,
          })
      ),
    taillampOff: () =>
      getMat(
        'taillampOff',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x7a1218,
            roughness: 0.22,
            metalness: 0.25,
          })
      ),
    amberMarker: () =>
      getMat(
        'amberMarker',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xe68a00,
            emissive: 0x442200,
            emissiveIntensity: 0.35,
            roughness: 0.3,
            metalness: 0.1,
          })
      ),
    redMarker: () =>
      getMat(
        'redMarker',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xc81818,
            emissive: 0x380505,
            emissiveIntensity: 0.3,
            roughness: 0.3,
            metalness: 0.1,
          })
      ),
    woodPole: () =>
      getMat(
        'woodPole',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x4a3b2c,
            roughness: 0.86,
            metalness: 0.0,
          })
      ),
    woodFence: () =>
      getMat(
        'woodFence',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x5a4632,
            roughness: 0.88,
            metalness: 0.0,
          })
      ),
    concrete: () =>
      getMat(
        'concrete',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x9c9a94,
            roughness: 0.85,
            metalness: 0.0,
          })
      ),
    furrowDirt: () =>
      getMat(
        'furrowDirt',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x3b3228,
            roughness: 0.92,
            metalness: 0.0,
          })
      ),
    forensicRed: () =>
      getMat(
        'forensicRed',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xd92b2b,
            roughness: 0.45,
            metalness: 0.05,
          })
      ),
  };

  function makeCarPaintMaterial(hexColor, metalness = 0.58, roughness = 0.24) {
    return getMat(`carpaint_${hexColor}_${metalness}_${roughness}`, () => {
      if (THREE.MeshPhysicalMaterial) {
        return new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(hexColor),
          metalness,
          roughness,
          clearcoat: 1.0,
          clearcoatRoughness: 0.06,
        });
      }
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(hexColor),
        metalness,
        roughness,
      });
    });
  }

  const geoCache = {};
  function getBoxGeo(w, h, d) {
    const k = `b_${w.toFixed(4)}_${h.toFixed(4)}_${d.toFixed(4)}`;
    if (!geoCache[k]) geoCache[k] = new THREE.BoxGeometry(w, h, d);
    return geoCache[k];
  }

  function getCylGeo(rt, rb, h, seg = 16) {
    const k = `c_${rt.toFixed(4)}_${rb.toFixed(4)}_${h.toFixed(4)}_${seg}`;
    if (!geoCache[k]) geoCache[k] = new THREE.CylinderGeometry(rt, rb, h, seg);
    return geoCache[k];
  }

  function enableShadows(obj, cast = true, receive = true) {
    obj.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = cast;
        c.receiveShadow = receive;
      }
    });
    return obj;
  }

  // Register an object in `world.objects` and attach to `root`
  function registerObject(
    id,
    node,
    kind,
    label,
    citation,
    occludes,
    x = 0,
    y = 0,
    z = 0,
    headingDeg = 0,
    extra = {}
  ) {
    node.name = id;
    node.position.set(x, y, z);
    node.rotation.set(0, -headingDeg * D2R, 0);
    root.add(node);
    objects[id] = {
      node,
      kind,
      label,
      citation,
      occludes: Boolean(occludes),
      ...extra,
    };
    return objects[id];
  }

  // =========================================================================
  // 4. LIGHTING, SKY DOME & ATMOSPHERE (`world_env`)
  // =========================================================================
  function buildEnvironment() {
    const envGroup = new THREE.Group();
    envGroup.name = 'world_env';

    // Ephemeris for 2016-05-07 16:36:12.7 EDT (UTC-4) at Williston FL (29.4106 N, -82.5393 W)
    // Sun Azimuth = 265.0 deg (just south of due west), Elevation = 45.1 deg
    const az = 265.0 * D2R;
    const el = 45.1 * D2R;
    const sunDir = new THREE.Vector3(
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      -Math.cos(az) * Math.cos(el)
    ).normalize();

    const sunDist = 260;
    const sunLight = new THREE.DirectionalLight(0xfff7e8, 2.6);
    sunLight.name = 'sun_light';
    sunLight.position.copy(sunDir).multiplyScalar(sunDist);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 4096;
    sunLight.shadow.mapSize.height = 4096;
    sunLight.shadow.camera.near = 20;
    sunLight.shadow.camera.far = 560;
    sunLight.shadow.camera.left = -140;
    sunLight.shadow.camera.right = 140;
    sunLight.shadow.camera.top = 110;
    sunLight.shadow.camera.bottom = -110;
    sunLight.shadow.bias = -0.00025;
    envGroup.add(sunLight);
    envGroup.add(sunLight.target);

    // Secondary fill light from opposite sky hemisphere so shadowed sides have realistic daylight bounce
    const skyFill = new THREE.DirectionalLight(0x9ec2eb, 0.55);
    skyFill.name = 'sky_fill_light';
    skyFill.position.set(120, 140, -90);
    envGroup.add(skyFill);

    const hemiLight = new THREE.HemisphereLight(0x9bc4f2, 0x6f7a54, 0.65);
    hemiLight.name = 'hemi_light';
    hemiLight.position.set(0, 120, 0);
    envGroup.add(hemiLight);

    // Inverted vertex-colored atmospheric sky dome (radius 1800 m)
    const skyGeo = new THREE.SphereGeometry(1800, 48, 28);
    const posAttr = skyGeo.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    const zenithCol = new THREE.Color(0x2d66a8);
    const midSkyCol = new THREE.Color(0x639cd6);
    const horizonCol = new THREE.Color(0xc8ddf0);
    const sunGlowCol = new THREE.Color(0xfff2d2);
    const groundHemCol = new THREE.Color(0x6f7c58);
    const tmpV = new THREE.Vector3();
    const tmpC = new THREE.Color();

    for (let i = 0; i < posAttr.count; i++) {
      tmpV.fromBufferAttribute(posAttr, i).normalize();
      const y = tmpV.y;
      if (y < 0) {
        tmpC.copy(horizonCol).lerp(groundHemCol, Math.min(1, -y * 4));
      } else {
        const t = Math.pow(y, 0.52);
        if (t < 0.45) {
          tmpC.copy(horizonCol).lerp(midSkyCol, t / 0.45);
        } else {
          tmpC.copy(midSkyCol).lerp(zenithCol, (t - 0.45) / 0.55);
        }
        const cosSun = Math.max(0, tmpV.dot(sunDir));
        const glow = Math.pow(cosSun, 8) * 0.45 + Math.pow(cosSun, 64) * 0.55;
        tmpC.lerp(sunGlowCol, Math.min(1, glow));
      }
      colors[i * 3] = tmpC.r;
      colors[i * 3 + 1] = tmpC.g;
      colors[i * 3 + 2] = tmpC.b;
    }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const skyMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    skyDome.name = 'sky_dome';
    envGroup.add(skyDome);

    // Visible solar disc in the west sky
    const sunDiscGeo = new THREE.CircleGeometry(36, 32);
    const sunDiscMat = new THREE.MeshBasicMaterial({
      color: 0xfffbe6,
      side: THREE.DoubleSide,
      fog: false,
      depthWrite: false,
    });
    const sunDisc = new THREE.Mesh(sunDiscGeo, sunDiscMat);
    sunDisc.name = 'sun_disc';
    sunDisc.position.copy(sunDir).multiplyScalar(1720);
    sunDisc.lookAt(0, 0, 0);
    envGroup.add(sunDisc);

    root.add(envGroup);
    root.userData.env = {
      fog: { color: 0xc8ddf0, near: 260, far: 1650 },
      background: 0x8db8e5,
      exposure: 1.0,
      selfLit: true,
    };
  }

  // =========================================================================
  // 5. DETAILED PROCEDURAL VEHICLE BUILDERS
  // =========================================================================

  // Shared detailed wheel builder (Passenger 5-spoke alloy or Commercial steel duals)
  function buildPassengerWheel(radius = 0.34, width = 0.225, namePrefix = 'wheel') {
    const wg = new THREE.Group();
    wg.name = namePrefix;

    // Tire tread + shoulder cylinder (axis along X)
    const tireGeo = getCylGeo(radius, radius, width, 28);
    const tireMesh = new THREE.Mesh(tireGeo, MAT.tireRubber());
    tireMesh.rotation.z = PI / 2;
    tireMesh.castShadow = true;
    tireMesh.receiveShadow = true;
    wg.add(tireMesh);

    // Sidewall torus rings
    const rimRadius = radius * 0.64;
    const rimBarrelGeo = getCylGeo(rimRadius, rimRadius, width * 0.94, 24);
    const rimBarrel = new THREE.Mesh(rimBarrelGeo, MAT.alloyRim());
    rimBarrel.rotation.z = PI / 2;
    wg.add(rimBarrel);

    // Brake disc & caliper inside wheel
    const discGeo = getCylGeo(rimRadius * 0.78, rimRadius * 0.78, 0.025, 20);
    const disc = new THREE.Mesh(discGeo, MAT.brakeDisc());
    disc.rotation.z = PI / 2;
    wg.add(disc);

    const caliperGeo = getBoxGeo(0.055, 0.11, 0.085);
    const caliper = new THREE.Mesh(caliperGeo, MAT.darkSteel());
    caliper.position.set(0, rimRadius * 0.45, -rimRadius * 0.35);
    wg.add(caliper);

    // 5-spoke alloy face + 5 lug nuts on both outboard faces so left/right placement is symmetric
    for (const side of [-1, 1]) {
      const xFace = side * (width * 0.44);
      const hubGeo = getCylGeo(0.055, 0.055, 0.03, 12);
      const hub = new THREE.Mesh(hubGeo, MAT.alloyRim());
      hub.rotation.z = PI / 2;
      hub.position.x = xFace;
      wg.add(hub);

      for (let s = 0; s < 5; s++) {
        const ang = (s * TAU) / 5;
        const spokeLen = rimRadius * 0.85;
        const spokeGeo = getBoxGeo(0.022, spokeLen, 0.036);
        const spoke = new THREE.Mesh(spokeGeo, MAT.alloyRim());
        spoke.position.set(
          xFace,
          Math.cos(ang) * (spokeLen * 0.52),
          Math.sin(ang) * (spokeLen * 0.52)
        );
        spoke.rotation.x = -ang;
        wg.add(spoke);

        const lugGeo = getCylGeo(0.01, 0.01, 0.018, 8);
        const lug = new THREE.Mesh(lugGeo, MAT.chrome());
        lug.rotation.z = PI / 2;
        lug.position.set(
          xFace + side * 0.01,
          Math.cos(ang + 0.31) * 0.036,
          Math.sin(ang + 0.31) * 0.036
        );
        wg.add(lug);
      }
    }

    return wg;
  }

  function buildCommercialWheelAssembly(
    radius = 0.52,
    width = 0.29,
    isDual = false,
    namePrefix = 'truck_wheel'
  ) {
    const g = new THREE.Group();
    g.name = namePrefix;
    const offsets = isDual ? [-width * 0.56, width * 0.56] : [0];

    for (let idx = 0; idx < offsets.length; idx++) {
      const ox = offsets[idx];
      const tire = new THREE.Mesh(getCylGeo(radius, radius, width, 28), MAT.tireRubber());
      tire.rotation.z = PI / 2;
      tire.position.x = ox;
      tire.castShadow = true;
      tire.receiveShadow = true;
      g.add(tire);

      const rimR = radius * 0.56;
      const rim = new THREE.Mesh(getCylGeo(rimR, rimR, width * 0.96, 24), MAT.alloyRim());
      rim.rotation.z = PI / 2;
      rim.position.x = ox;
      g.add(rim);
    }

    // Heavy axle hub cap & 10-lug circle
    for (const side of [-1, 1]) {
      const outerX = side * (isDual ? width * 1.05 : width * 0.48);
      const hub = new THREE.Mesh(getCylGeo(0.11, 0.13, 0.08, 16), MAT.darkSteel());
      hub.rotation.z = PI / 2;
      hub.position.x = outerX;
      g.add(hub);

      for (let i = 0; i < 10; i++) {
        const a = (i * TAU) / 10;
        const lug = new THREE.Mesh(getCylGeo(0.012, 0.012, 0.025, 6), MAT.chrome());
        lug.rotation.z = PI / 2;
        lug.position.set(outerX + side * 0.02, Math.cos(a) * 0.17, Math.sin(a) * 0.17);
        g.add(lug);
      }
    }

    return g;
  }

  // -------------------------------------------------------------------------
  // A1. VEHICLE A: 2015 Four-Door Full-Size Passenger Sedan (4.97 x 1.96 x 1.445 m)
  // Local convention: origin at ground center, -Z = front, +Z = rear
  // -------------------------------------------------------------------------
  function buildSedanVehicle(id, hexColor = '#1d2c44') {
    const group = new THREE.Group();
    group.name = id;

    const L = 4.97;
    const W = 1.96;
    const H = 1.445;
    const paintMat = makeCarPaintMaterial(hexColor, 0.6, 0.23);

    // 1. Sculpted lower body side profile extruded across width with bevels
    // Profile in (forward = -z, up = y) mapped to 2D shape (x2d = z, y2d = y)
    const bodyWidth = 1.78;
    const bodyShape = new THREE.Shape();
    bodyShape.moveTo(-2.44, 0.22); // Front splitter bottom
    bodyShape.lineTo(-2.47, 0.46); // Front bumper nose
    bodyShape.lineTo(-2.38, 0.68); // Upper grille edge
    bodyShape.lineTo(-1.75, 0.83); // Mid hood
    bodyShape.lineTo(-0.98, 0.914); // Trailing edge of hood (3 ft = 0.914 m per F14)
    bodyShape.lineTo(1.58, 0.95); // Beltline along doors
    bodyShape.lineTo(2.38, 0.93); // Rear decklid top
    bodyShape.lineTo(2.47, 0.66); // Rear bumper upper
    bodyShape.lineTo(2.42, 0.25); // Rear valance bottom
    bodyShape.lineTo(1.88, 0.21); // Behind rear wheel
    bodyShape.lineTo(1.05, 0.21); // Rear of rocker panel
    bodyShape.lineTo(-1.12, 0.19); // Front of rocker panel
    bodyShape.lineTo(-1.92, 0.21); // Behind front bumper
    bodyShape.closePath();

    const lowerBodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
      depth: bodyWidth,
      bevelEnabled: true,
      bevelSegments: 4,
      steps: 1,
      bevelSize: 0.065,
      bevelThickness: 0.075,
    });
    // ExtrudeGeometry extrudes along +Z, with shape in X-Y. Rotate Y by -PI/2 so shape X becomes +Z!
    // Wait: if we rotate Y by -PI/2: local X' = -Z_extrude, local Z' = X_shape.
    lowerBodyGeo.translate(0, 0, -bodyWidth / 2);
    lowerBodyGeo.rotateY(-PI / 2);
    const lowerBody = new THREE.Mesh(lowerBodyGeo, paintMat);
    lowerBody.name = `${id}_lower_body`;
    lowerBody.castShadow = true;
    lowerBody.receiveShadow = true;
    group.add(lowerBody);

    // 2. Sculpted Greenhouse / Cabin Roof Structure (tapered width 1.50 m, top at 1.445 m)
    const cabinWidth = 1.46;
    const cabinShape = new THREE.Shape();
    cabinShape.moveTo(-1.02, 0.90); // Base of windshield / cowl
    cabinShape.lineTo(-0.34, 1.39); // Top of A-pillar / front roof header
    cabinShape.quadraticCurveTo(0.28, 1.435, 0.85, 1.38); // Domed roof arch
    cabinShape.lineTo(1.74, 0.94); // C-pillar / rear backlight base
    cabinShape.lineTo(-1.02, 0.90);
    cabinShape.closePath();

    const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, {
      depth: cabinWidth,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.035,
      bevelThickness: 0.04,
    });
    cabinGeo.translate(0, 0, -cabinWidth / 2);
    cabinGeo.rotateY(-PI / 2);
    const cabinRoof = new THREE.Mesh(cabinGeo, paintMat);
    cabinRoof.name = `${id}_cabin_frame`;
    cabinRoof.castShadow = true;
    cabinRoof.receiveShadow = true;
    group.add(cabinRoof);

    // 3. Tinted Glass Windows (Windshield, Rear Backlight, Left/Right Side Daylight Openings)
    const wsGeo = getBoxGeo(1.42, 0.025, 0.84);
    const windshield = new THREE.Mesh(wsGeo, MAT.carGlass());
    windshield.name = `${id}_windshield`;
    windshield.position.set(0, 1.155, -0.69);
    windshield.rotation.x = 0.62;
    group.add(windshield);

    const rwGeo = getBoxGeo(1.38, 0.025, 0.88);
    const rearWindow = new THREE.Mesh(rwGeo, MAT.carGlass());
    rearWindow.name = `${id}_rear_window`;
    rearWindow.position.set(0, 1.16, 1.31);
    rearWindow.rotation.x = -0.52;
    group.add(rearWindow);

    // Side window glass panels & B-pillar blackouts
    const sideGlassShape = new THREE.Shape();
    sideGlassShape.moveTo(-0.88, 0.93);
    sideGlassShape.lineTo(-0.31, 1.34);
    sideGlassShape.lineTo(0.82, 1.33);
    sideGlassShape.lineTo(1.56, 0.96);
    sideGlassShape.closePath();
    const sideGlassGeo = new THREE.ShapeGeometry(sideGlassShape);

    for (const side of [-1, 1]) {
      const sg = new THREE.Mesh(sideGlassGeo, MAT.carGlass());
      sg.position.set(side * (cabinWidth * 0.5 + 0.041), 0, 0);
      sg.rotation.y = side > 0 ? PI / 2 : -PI / 2;
      group.add(sg);

      // B-pillar gloss black trim
      const bPillar = new THREE.Mesh(getBoxGeo(0.02, 0.41, 0.11), MAT.chassisBlack());
      bPillar.position.set(side * (cabinWidth * 0.5 + 0.036), 1.14, 0.22);
      bPillar.rotation.z = side * -0.12;
      group.add(bPillar);
    }

    // 4. Interior Tub: Dashboard, Steering Wheel, 4 Seats & Headrests (headrests at 1.29 m per F14)
    const dash = new THREE.Mesh(getBoxGeo(1.42, 0.32, 0.48), MAT.interiorDark());
    dash.position.set(0, 0.82, -0.76);
    group.add(dash);

    const steeringWheel = new THREE.Mesh(getCylGeo(0.18, 0.18, 0.035, 16), MAT.interiorDark());
    steeringWheel.position.set(-0.38, 0.92, -0.48);
    steeringWheel.rotation.x = 1.15;
    group.add(steeringWheel);

    for (const sx of [-0.38, 0.38]) {
      for (const sz of [-0.08, 0.78]) {
        const seatBack = new THREE.Mesh(getBoxGeo(0.46, 0.58, 0.12), MAT.interiorDark());
        seatBack.position.set(sx, 0.82, sz);
        seatBack.rotation.x = -0.15;
        group.add(seatBack);

        // Headrest top at y = 1.29 m (exceeds trailer bottom edge 1.20 m by 3.5 in per F14)
        const headrest = new THREE.Mesh(getBoxGeo(0.24, 0.18, 0.10), MAT.interiorDark());
        headrest.position.set(sx, 1.20, sz + 0.04);
        group.add(headrest);
      }
    }

    // 5. Flared Wheel Arches / Fenders, Rocker Skirts, Door Handles, Side Mirrors, Panel Lines
    const axleZ = [-1.505, 1.455]; // Wheelbase 2.96 m, front overhang 0.98 m
    for (const side of [-1, 1]) {
      const sTag = side < 0 ? 'L' : 'R';

      // Flared fender arches
      for (const wz of axleZ) {
        const flare = new THREE.Mesh(getCylGeo(0.41, 0.41, 0.16, 20), paintMat);
        flare.rotation.z = PI / 2;
        flare.position.set(side * 0.89, 0.36, wz);
        group.add(flare);

        // Dark wheelwell liner inside fender
        const well = new THREE.Mesh(getCylGeo(0.385, 0.385, 0.28, 20), MAT.chassisBlack());
        well.rotation.z = PI / 2;
        well.position.set(side * 0.82, 0.35, wz);
        group.add(well);
      }

      // Sculpted aerodynamic side mirrors
      const mirrorArm = new THREE.Mesh(getBoxGeo(0.11, 0.04, 0.06), MAT.chassisBlack());
      mirrorArm.position.set(side * 0.84, 0.93, -0.68);
      group.add(mirrorArm);

      const mirrorCap = new THREE.Mesh(getBoxGeo(0.16, 0.10, 0.12), paintMat);
      mirrorCap.position.set(side * 0.92, 0.95, -0.66);
      group.add(mirrorCap);

      // Door handles (front and rear doors)
      for (const hz of [-0.05, 0.82]) {
        const handle = new THREE.Mesh(getBoxGeo(0.035, 0.032, 0.16), MAT.chrome());
        handle.position.set(side * 0.955, 0.87, hz);
        group.add(handle);
      }

      // Lower chrome rocker trim & door seam lines
      const rockerTrim = new THREE.Mesh(getBoxGeo(0.02, 0.028, 2.05), MAT.chrome());
      rockerTrim.position.set(side * 0.95, 0.26, -0.02);
      group.add(rockerTrim);

      const doorSeam = new THREE.Mesh(getBoxGeo(0.015, 0.56, 0.012), MAT.chassisBlack());
      doorSeam.position.set(side * 0.952, 0.58, 0.22);
      group.add(doorSeam);

      // Four detailed wheels
      const wFront = buildPassengerWheel(0.34, 0.225, `wheel_F${sTag}`);
      wFront.position.set(side * 0.84, 0.34, axleZ[0]);
      group.add(wFront);

      const wRear = buildPassengerWheel(0.34, 0.225, `wheel_R${sTag}`);
      wRear.position.set(side * 0.84, 0.34, axleZ[1]);
      group.add(wRear);
    }

    // 6. Front Fascia: Grille, Lower Air Dam, LED Headlamps (OFF per F4), Wipers
    const grille = new THREE.Mesh(getBoxGeo(0.92, 0.20, 0.05), MAT.chassisBlack());
    grille.position.set(0, 0.55, -2.46);
    group.add(grille);

    const grilleChrome = new THREE.Mesh(getBoxGeo(0.96, 0.025, 0.06), MAT.chrome());
    grilleChrome.position.set(0, 0.65, -2.46);
    group.add(grilleChrome);

    const lowerAirDam = new THREE.Mesh(getBoxGeo(1.48, 0.11, 0.05), MAT.chassisBlack());
    lowerAirDam.position.set(0, 0.29, -2.45);
    group.add(lowerAirDam);

    for (const [side, name] of [
      [-1, 'headlight_L'],
      [1, 'headlight_R'],
    ]) {
      const hl = new THREE.Mesh(getBoxGeo(0.34, 0.11, 0.14), MAT.headlampOff());
      hl.name = name;
      hl.position.set(side * 0.68, 0.63, -2.38);
      hl.rotation.y = side * 0.22;
      group.add(hl);
    }

    // Windshield wipers
    for (const wx of [-0.28, 0.22]) {
      const wiper = new THREE.Mesh(getBoxGeo(0.52, 0.018, 0.022), MAT.chassisBlack());
      wiper.position.set(wx, 0.925, -0.98);
      wiper.rotation.y = 0.08;
      group.add(wiper);
    }

    // 7. Rear Fascia: Taillights, License Plate Recess, Dual Exhaust Tips
    for (const [side, name] of [
      [-1, 'taillight_L'],
      [1, 'taillight_R'],
    ]) {
      const tl = new THREE.Mesh(getBoxGeo(0.38, 0.13, 0.10), MAT.taillampOff());
      tl.name = name;
      tl.position.set(side * 0.66, 0.78, 2.44);
      group.add(tl);

      const exhaust = new THREE.Mesh(getCylGeo(0.038, 0.038, 0.14, 12), MAT.chrome());
      exhaust.rotation.x = PI / 2;
      exhaust.position.set(side * 0.58, 0.24, 2.45);
      group.add(exhaust);
    }

    const plateRear = new THREE.Mesh(getBoxGeo(0.31, 0.15, 0.02), MAT.paintWhite());
    plateRear.position.set(0, 0.62, 2.47);
    group.add(plateRear);

    group.userData.dims = { length: L, width: W, height: H };
    group.userData.driverEye = [-0.38, 1.18, -0.12];
    return group;
  }

  // -------------------------------------------------------------------------
  // A2. VEHICLE T TRACTOR: 2014 3-Axle Conventional Truck-Tractor (6.6 x 2.44 x 4.0 m)
  // Local convention: origin at ground center, -Z = front, +Z = rear
  // -------------------------------------------------------------------------
  function buildTruckTractor() {
    const group = new THREE.Group();
    group.name = 'veh_T_tractor';

    const L = 6.6;
    const W = 2.44;
    const H = 4.0;
    const cabPaint = makeCarPaintMaterial('#e6e8ea', 0.42, 0.28);

    // 1. Heavy Twin C-Channel Frame Rails & Crossmembers
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(getBoxGeo(0.11, 0.28, 6.35), MAT.chassisBlack());
      rail.position.set(side * 0.44, 0.78, 0.05);
      rail.castShadow = true;
      rail.receiveShadow = true;
      group.add(rail);
    }

    // Under-chassis engine/transmission block (ensures solid lower occlusion)
    const engineBlock = new THREE.Mesh(getBoxGeo(1.05, 0.72, 2.4), MAT.chassisBlack());
    engineBlock.position.set(0, 0.78, -1.65);
    engineBlock.castShadow = true;
    group.add(engineBlock);

    // 2. Sloped Aerodynamic Conventional Hood & Front Fenders
    const hoodShape = new THREE.Shape();
    hoodShape.moveTo(-3.18, 0.68);
    hoodShape.lineTo(-3.20, 1.48);
    hoodShape.lineTo(-1.42, 1.72);
    hoodShape.lineTo(-1.42, 0.68);
    hoodShape.closePath();

    const hoodGeo = new THREE.ExtrudeGeometry(hoodShape, {
      depth: 1.56,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.06,
      bevelThickness: 0.06,
    });
    hoodGeo.translate(0, 0, -1.56 / 2);
    hoodGeo.rotateY(-PI / 2);
    const hoodMesh = new THREE.Mesh(hoodGeo, cabPaint);
    hoodMesh.castShadow = true;
    hoodMesh.receiveShadow = true;
    group.add(hoodMesh);

    // Front flared wheel fenders
    for (const side of [-1, 1]) {
      const fender = new THREE.Mesh(getBoxGeo(0.42, 0.56, 1.48), cabPaint);
      fender.position.set(side * 0.99, 0.96, -2.32);
      fender.castShadow = true;
      group.add(fender);
    }

    // 3. Chrome Grille, Vertical Slats & Heavy Chrome Bumper
    const grilleShell = new THREE.Mesh(getBoxGeo(1.24, 0.78, 0.08), MAT.chrome());
    grilleShell.position.set(0, 1.15, -3.22);
    group.add(grilleShell);

    const grilleInsert = new THREE.Mesh(getBoxGeo(1.10, 0.66, 0.09), MAT.chassisBlack());
    grilleInsert.position.set(0, 1.15, -3.225);
    group.add(grilleInsert);

    for (let gx = -0.45; gx <= 0.45; gx += 0.15) {
      const slat = new THREE.Mesh(getBoxGeo(0.025, 0.64, 0.10), MAT.chrome());
      slat.position.set(gx, 1.15, -3.23);
      group.add(slat);
    }

    const frontBumper = new THREE.Mesh(getBoxGeo(2.38, 0.36, 0.22), MAT.chrome());
    frontBumper.position.set(0, 0.52, -3.19);
    frontBumper.castShadow = true;
    group.add(frontBumper);

    for (const [side, name] of [
      [-1, 'headlight_L'],
      [1, 'headlight_R'],
    ]) {
      const hl = new THREE.Mesh(getBoxGeo(0.32, 0.16, 0.12), MAT.headlampOff());
      hl.name = name;
      hl.position.set(side * 0.94, 0.95, -3.05);
      group.add(hl);
    }

    // 4. Day Cab + Roof Aerodynamic Fairing (reaching 3.95 m height)
    const cabBox = new THREE.Mesh(getBoxGeo(2.26, 1.72, 1.68), cabPaint);
    cabBox.position.set(0, 1.84, -0.58);
    cabBox.castShadow = true;
    cabBox.receiveShadow = true;
    group.add(cabBox);

    // Roof aero fairing / wind deflector matching 4.0 m height
    const fairingShape = new THREE.Shape();
    fairingShape.moveTo(-1.32, 2.68);
    fairingShape.quadraticCurveTo(-0.62, 3.65, 0.22, 3.96);
    fairingShape.lineTo(0.26, 2.68);
    fairingShape.closePath();

    const fairingGeo = new THREE.ExtrudeGeometry(fairingShape, {
      depth: 2.18,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.03,
      bevelThickness: 0.03,
    });
    fairingGeo.translate(0, 0, -2.18 / 2);
    fairingGeo.rotateY(-PI / 2);
    const roofFairing = new THREE.Mesh(fairingGeo, cabPaint);
    roofFairing.castShadow = true;
    group.add(roofFairing);

    // Cab Windshield, Side Windows, Sun Visor, 5 Amber Roof Marker Lights
    const cabWindshield = new THREE.Mesh(getBoxGeo(1.98, 0.64, 0.04), MAT.carGlass());
    cabWindshield.position.set(0, 2.16, -1.42);
    cabWindshield.rotation.x = -0.18;
    group.add(cabWindshield);

    const sunVisor = new THREE.Mesh(getBoxGeo(2.12, 0.12, 0.22), MAT.chrome());
    sunVisor.position.set(0, 2.54, -1.46);
    group.add(sunVisor);

    for (let mx = -0.6; mx <= 0.6; mx += 0.3) {
      const mLight = new THREE.Mesh(getBoxGeo(0.07, 0.045, 0.06), MAT.amberMarker());
      mLight.position.set(mx, 2.72, -1.32);
      group.add(mLight);
    }

    // 5. Chrome Exhaust Stacks, Polished Aluminum Fuel Tanks, Cab Steps, West-Coast Mirrors
    for (const side of [-1, 1]) {
      // Side cab window
      const sideWin = new THREE.Mesh(getBoxGeo(0.04, 0.56, 0.88), MAT.carGlass());
      sideWin.position.set(side * 1.12, 2.12, -0.68);
      group.add(sideWin);

      // West-Coast mirror bracket & housing
      const mBracket = new THREE.Mesh(getBoxGeo(0.24, 0.03, 0.03), MAT.chrome());
      mBracket.position.set(side * 1.22, 2.26, -1.12);
      group.add(mBracket);

      const mHousing = new THREE.Mesh(getBoxGeo(0.06, 0.44, 0.18), MAT.chrome());
      mHousing.position.set(side * 1.32, 2.08, -1.12);
      group.add(mHousing);

      // Polished cylindrical fuel tank (1.55 m long)
      const tank = new THREE.Mesh(getCylGeo(0.33, 0.33, 1.55, 20), MAT.chrome());
      tank.rotation.x = PI / 2;
      tank.position.set(side * 0.88, 0.72, -0.55);
      tank.castShadow = true;
      group.add(tank);

      // Dual cab steps
      for (const sy of [0.46, 0.74]) {
        const step = new THREE.Mesh(getBoxGeo(0.18, 0.035, 0.92), MAT.steelGalv());
        step.position.set(side * 1.12, sy, -0.78);
        group.add(step);
      }

      // Vertical chrome exhaust stack behind cab
      const stack = new THREE.Mesh(getCylGeo(0.075, 0.075, 2.85, 16), MAT.chrome());
      stack.position.set(side * 1.06, 2.38, 0.36);
      stack.castShadow = true;
      group.add(stack);

      // Rear mudflaps behind tandem drives
      const flap = new THREE.Mesh(getBoxGeo(0.62, 0.68, 0.025), MAT.tireRubber());
      flap.position.set(side * 0.88, 0.48, 3.24);
      group.add(flap);
    }

    // 6. Fifth-Wheel Coupling Plate & Catwalk
    const catwalk = new THREE.Mesh(getBoxGeo(0.95, 0.04, 1.15), MAT.steelGalv());
    catwalk.position.set(0, 0.94, 0.92);
    group.add(catwalk);

    const fifthWheel = new THREE.Mesh(getCylGeo(0.46, 0.48, 0.12, 20), MAT.darkSteel());
    fifthWheel.position.set(0, 1.16, 2.22);
    group.add(fifthWheel);

    // 7. Three Axles: Steer Axle (z = -2.35 m) + Tandem Drive Axles (z = +1.85 m, +3.05 m)
    const steerZ = -2.35;
    const driveZ = [1.75, 2.95];
    for (const side of [-1, 1]) {
      const sTag = side < 0 ? 'L' : 'R';
      const sw = buildCommercialWheelAssembly(0.52, 0.29, false, `steer_${sTag}`);
      sw.position.set(side * 1.02, 0.52, steerZ);
      group.add(sw);

      for (let d = 0; d < driveZ.length; d++) {
        const dw = buildCommercialWheelAssembly(0.52, 0.29, true, `drive_${d + 1}_${sTag}`);
        dw.position.set(side * 0.88, 0.52, driveZ[d]);
        group.add(dw);
      }
    }

    group.userData.dims = { length: L, width: W, height: H };
    group.userData.driverEye = [-0.52, 2.38, -0.68];
    return group;
  }

  // -------------------------------------------------------------------------
  // A3. VEHICLE T SEMITRAILER: 2003 53-ft Refrigerated Van Semitrailer (16.15 x 2.59 x 4.11 m)
  // Local convention: origin at footprint center, -Z = front nose, +Z = rear doors
  // CRITICAL SIGHTLINE REQUIREMENT: continuous solid geometry along entire length
  // between 0.45 m and 4.11 m above ground so rays from Witness B to Vehicle A are blocked.
  // -------------------------------------------------------------------------
  function buildSemitrailer() {
    const group = new THREE.Group();
    group.name = 'veh_T_trailer';

    const L = 16.15;
    const W = 2.59;
    const H = 4.11;
    const bottomY = 1.20;
    const boxH = H - bottomY; // 2.91 m

    const reeferMap = getReeferSideTexture();
    const boxMat = getMat('reefer_box_mat', () => {
      return new THREE.MeshStandardMaterial({
        color: reeferMap ? 0xffffff : 0xf2f2ee,
        map: reeferMap || null,
        roughness: 0.42,
        metalness: 0.18,
      });
    });

    // 1. Main Refrigerated Van Box (y = 1.20 m to 4.11 m, full 16.15 m length x 2.59 m width)
    const vanBox = new THREE.Mesh(getBoxGeo(W, boxH, L), boxMat);
    vanBox.name = 'trailer_van_box';
    vanBox.position.set(0, bottomY + boxH / 2, 0);
    vanBox.castShadow = true;
    vanBox.receiveShadow = true;
    group.add(vanBox);

    // Top and bottom extruded aluminum corner rails
    for (const side of [-1, 1]) {
      for (const ry of [bottomY + 0.06, H - 0.05]) {
        const rail = new THREE.Mesh(getBoxGeo(0.03, 0.12, L + 0.01), MAT.steelGalv());
        rail.position.set(side * (W / 2 + 0.005), ry, 0);
        group.add(rail);
      }
    }

    // 2. Continuous Full-Length Aerodynamic Side Skirts & Under-Floor Subframe (y = 0.42 m to 1.25 m)
    // Guarantees zero see-through gap under the trailer side from any angle
    const skirtH = 0.84; // spans y = 0.42 m to 1.26 m
    const skirtY = 0.42 + skirtH / 2;
    for (const side of [-1, 1]) {
      const skirt = new THREE.Mesh(getBoxGeo(0.06, skirtH, L - 0.5), boxMat);
      skirt.name = `trailer_aero_skirt_${side < 0 ? 'L' : 'R'}`;
      skirt.position.set(side * (W * 0.48), skirtY, 0.1);
      skirt.castShadow = true;
      skirt.receiveShadow = true;
      group.add(skirt);
    }

    // Central structural I-beam & underbody enclosure (y = 0.44 m to 1.22 m)
    const underbodyCore = new THREE.Mesh(
      getBoxGeo(W * 0.92, 0.78, L - 0.6),
      MAT.darkSteel()
    );
    underbodyCore.name = 'trailer_underbody_subframe';
    underbodyCore.position.set(0, 0.83, 0.1);
    underbodyCore.castShadow = true;
    underbodyCore.receiveShadow = true;
    group.add(underbodyCore);

    // 3. Front Nose-Mounted Refrigeration Unit (Thermo-style reefer housing)
    const reeferHousing = new THREE.Mesh(getBoxGeo(1.78, 1.92, 0.52), boxMat);
    reeferHousing.name = 'trailer_reefer_unit';
    reeferHousing.position.set(0, 2.72, -L / 2 - 0.24);
    reeferHousing.castShadow = true;
    group.add(reeferHousing);

    const reeferGrille = new THREE.Mesh(getBoxGeo(1.48, 0.85, 0.55), MAT.chassisBlack());
    reeferGrille.position.set(0, 3.05, -L / 2 - 0.24);
    group.add(reeferGrille);

    // Kingpin plate & pin at z = -L/2 + 0.91 m
    const kingpin = new THREE.Mesh(getCylGeo(0.055, 0.055, 0.18, 12), MAT.darkSteel());
    kingpin.position.set(0, 1.12, -L / 2 + 0.91);
    group.add(kingpin);

    // 4. Heavy-Duty Landing Gear (at z = -L/2 + 3.4 m)
    const lgZ = -L / 2 + 3.4;
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(getBoxGeo(0.14, 0.88, 0.14), MAT.darkSteel());
      leg.position.set(side * 0.98, 0.78, lgZ);
      group.add(leg);

      const shoe = new THREE.Mesh(getBoxGeo(0.28, 0.05, 0.32), MAT.darkSteel());
      shoe.position.set(side * 0.98, 0.36, lgZ);
      group.add(shoe);
    }
    const lgBrace = new THREE.Mesh(getBoxGeo(1.96, 0.08, 0.08), MAT.darkSteel());
    lgBrace.position.set(0, 0.75, lgZ);
    group.add(lgBrace);

    // 5. FMVSS 108 Retroreflective Conspicuity Tape (Alternating Red/White 50 mm strips along lower rail)
    const numStrips = 36;
    const stripLen = (L - 0.6) / numStrips;
    for (let i = 0; i < numStrips; i++) {
      const sz = -L / 2 + 0.3 + (i + 0.5) * stripLen;
      const mat = i % 2 === 0 ? MAT.paintRedDot() : MAT.paintWhiteDot();
      for (const side of [-1, 1]) {
        const tape = new THREE.Mesh(getBoxGeo(0.015, 0.06, stripLen * 0.94), mat);
        tape.position.set(side * (W / 2 + 0.014), bottomY + 0.08, sz);
        group.add(tape);
      }
    }

    // Side Amber Marker Lamps (front, mid-length where V1 hood scraped per police report p.1, and rear)
    for (const side of [-1, 1]) {
      for (const mz of [-L / 2 + 0.45, 0.08, L / 2 - 0.45]) {
        const mat = mz > L / 2 - 1 ? MAT.redMarker() : MAT.amberMarker();
        const lamp = new THREE.Mesh(getBoxGeo(0.03, 0.05, 0.11), mat);
        lamp.position.set(side * (W / 2 + 0.018), bottomY + 0.03, mz);
        group.add(lamp);
      }
    }

    // 6. Rear Barn Doors, Vertical Locking Bars, Hinges & Rear Underride Impact Guard (ICC Bar)
    const rearZ = L / 2 + 0.015;
    const doorSeam = new THREE.Mesh(getBoxGeo(0.03, boxH - 0.1, 0.02), MAT.chassisBlack());
    doorSeam.position.set(0, bottomY + boxH / 2, rearZ);
    group.add(doorSeam);

    for (const lx of [-0.82, -0.28, 0.28, 0.82]) {
      const lockRod = new THREE.Mesh(getCylGeo(0.018, 0.018, boxH - 0.16, 10), MAT.steelGalv());
      lockRod.position.set(lx, bottomY + boxH / 2, rearZ + 0.02);
      group.add(lockRod);
    }

    // Rear lower DOT conspicuity bar & ICC underride guard
    for (let i = 0; i < 8; i++) {
      const rx = -W / 2 + 0.18 + i * 0.31;
      const mat = i % 2 === 0 ? MAT.paintRedDot() : MAT.paintWhiteDot();
      const rTape = new THREE.Mesh(getBoxGeo(0.29, 0.06, 0.02), mat);
      rTape.position.set(rx, bottomY + 0.08, rearZ + 0.01);
      group.add(rTape);
    }

    const iccBar = new THREE.Mesh(getBoxGeo(W * 0.92, 0.12, 0.10), MAT.steelGalv());
    iccBar.position.set(0, 0.54, L / 2 - 0.08);
    group.add(iccBar);

    for (const side of [-1, 1]) {
      const iccPost = new THREE.Mesh(getBoxGeo(0.10, 0.68, 0.10), MAT.steelGalv());
      iccPost.position.set(side * 0.86, 0.88, L / 2 - 0.08);
      group.add(iccPost);
    }

    // 7. Rear Tandem Axles (at 12.50 m and 13.72 m behind front nose -> z = +4.425 m and +5.645 m)
    const tandemZ = [-L / 2 + 12.5, -L / 2 + 13.72];
    for (const side of [-1, 1]) {
      const sTag = side < 0 ? 'L' : 'R';
      for (let a = 0; a < tandemZ.length; a++) {
        const tw = buildCommercialWheelAssembly(0.52, 0.29, true, `trailer_axle_${a + 1}_${sTag}`);
        tw.position.set(side * 0.96, 0.52, tandemZ[a]);
        group.add(tw);
      }

      const flap = new THREE.Mesh(getBoxGeo(0.64, 0.72, 0.025), MAT.tireRubber());
      flap.position.set(side * 0.96, 0.48, tandemZ[1] + 0.68);
      group.add(flap);
    }

    group.userData.dims = { length: L, width: W, height: H };
    return group;
  }

  // -------------------------------------------------------------------------
  // A4. WITNESS C PICKUP TRUCK: Full-Size Pickup (5.8 x 2.02 x 1.92 m)
  // -------------------------------------------------------------------------
  function buildPickupVehicle(id, hexColor = '#586068') {
    const group = new THREE.Group();
    group.name = id;

    const L = 5.8;
    const W = 2.02;
    const H = 1.92;
    const paintMat = makeCarPaintMaterial(hexColor, 0.5, 0.32);

    // Lower body + bed
    const lowerHull = new THREE.Mesh(getBoxGeo(1.96, 0.78, L - 0.16), paintMat);
    lowerHull.position.set(0, 0.78, 0);
    lowerHull.castShadow = true;
    lowerHull.receiveShadow = true;
    group.add(lowerHull);

    // Crew cab greenhouse
    const cab = new THREE.Mesh(getBoxGeo(1.82, 0.72, 2.15), paintMat);
    cab.position.set(0, 1.52, -0.35);
    cab.castShadow = true;
    group.add(cab);

    const ws = new THREE.Mesh(getBoxGeo(1.68, 0.56, 0.03), MAT.carGlass());
    ws.position.set(0, 1.52, -1.44);
    ws.rotation.x = 0.45;
    group.add(ws);

    const bedInterior = new THREE.Mesh(getBoxGeo(1.68, 0.42, 1.95), MAT.chassisBlack());
    bedInterior.position.set(0, 1.02, 1.75);
    group.add(bedInterior);

    const bumperF = new THREE.Mesh(getBoxGeo(2.02, 0.28, 0.18), MAT.chrome());
    bumperF.position.set(0, 0.48, -L / 2 + 0.06);
    group.add(bumperF);

    const bumperR = new THREE.Mesh(getBoxGeo(2.02, 0.26, 0.18), MAT.chrome());
    bumperR.position.set(0, 0.52, L / 2 - 0.06);
    group.add(bumperR);

    for (const side of [-1, 1]) {
      const sTag = side < 0 ? 'L' : 'R';
      for (const [idx, wz] of [
        [1, -1.92],
        [2, 1.76],
      ]) {
        const w = buildPassengerWheel(0.41, 0.265, `${id}_wheel_${idx}_${sTag}`);
        w.position.set(side * 0.90, 0.41, wz);
        group.add(w);
      }
    }

    group.userData.dims = { length: L, width: W, height: H };
    return group;
  }

  // =========================================================================
  // 6. ROADWAY, CROSSOVER, SHOULDERS & MUTCD MARKINGS BUILDERS
  // =========================================================================
  function buildSlabMesh(w, h, d, mat, yOffset = 0) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(getBoxGeo(w, h, d), mat);
    m.position.y = h / 2 + yOffset;
    m.receiveShadow = true;
    g.add(m);
    return g;
  }

  function buildDividedHighwayCorridor(id, length = 780, width = 7.32) {
    const group = new THREE.Group();
    group.name = id;

    // Local frame with heading 90 deg: local +X = +Z_world (south), local -Z = +X_world (east)
    // Crowned asphalt surface (two 3.66 m lanes)
    const roadMesh = new THREE.Mesh(getBoxGeo(width, 0.02, length), MAT.asphaltMain());
    roadMesh.position.y = 0.01;
    roadMesh.receiveShadow = true;
    group.add(roadMesh);

    return group;
  }

  function buildBrokenLaneLine(id, xStart, xEnd, zConst) {
    const group = new THREE.Group();
    group.name = id;

    // MUTCD Section 3A.06: 3.05 m (10 ft) white stripe, 9.14 m (30 ft) gap, 0.15 m (6 in) wide
    const cycle = 12.19;
    const stripeLen = 3.05;
    const count = Math.floor((xEnd - xStart) / cycle);

    const stripeGeo = getBoxGeo(stripeLen, 0.004, 0.15);
    const inst = new THREE.InstancedMesh(stripeGeo, MAT.paintWhite(), count);
    inst.name = `${id}_stripes`;
    inst.receiveShadow = true;

    // Also place raised retroreflective pavement markers (RPMs) in the gaps every 24.38 m (80 ft)
    const rpmCount = Math.floor(count / 2);
    const rpmGeo = getBoxGeo(0.11, 0.018, 0.11);
    const rpmInst = new THREE.InstancedMesh(rpmGeo, MAT.paintWhiteDot(), rpmCount);
    rpmInst.name = `${id}_rpms`;

    const dummy = new THREE.Object3D();
    const centerX = (xStart + xEnd) / 2;

    let rIdx = 0;
    for (let i = 0; i < count; i++) {
      const wx = xStart + i * cycle + stripeLen / 2;
      // Group is placed at [centerX, 0.025, zConst] with heading 90 deg -> local -Z = +X_world
      const localZ = -(wx - centerX);
      dummy.position.set(0, 0, localZ);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);

      if (i % 2 === 0 && rIdx < rpmCount) {
        dummy.position.set(0, 0.008, localZ - 6.1);
        dummy.updateMatrix();
        rpmInst.setMatrixAt(rIdx++, dummy.matrix);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    rpmInst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    group.add(rpmInst);
    return group;
  }

  function buildSolidEdgeLine(id, length, width = 0.15, isYellow = false) {
    const group = new THREE.Group();
    group.name = id;
    const mat = isYellow ? MAT.paintYellow() : MAT.paintWhite();
    const mesh = new THREE.Mesh(getBoxGeo(width, 0.004, length), mat);
    mesh.receiveShadow = true;
    group.add(mesh);
    return group;
  }

  function buildTurnLaneArrows() {
    const group = new THREE.Group();
    group.name = 'mark_wb_turn_arrows';
    // Placed at [40, 0.025, -27.43], heading 270 deg (local -Z = -X_world / west)
    // Arrow stations at x = 25, 65, 115 m
    const stations = [25, 65, 115];

    const arrowShape = new THREE.Shape();
    // Standard MUTCD left-turn arrow (pointing west = -Z, then curving south = -X in heading 270 local frame)
    arrowShape.moveTo(0.15, 1.1);
    arrowShape.lineTo(0.15, -0.2);
    arrowShape.quadraticCurveTo(0.15, -0.65, -0.35, -0.65);
    arrowShape.lineTo(-0.35, -0.95);
    arrowShape.lineTo(-0.95, -0.45);
    arrowShape.lineTo(-0.35, 0.05);
    arrowShape.lineTo(-0.35, -0.25);
    arrowShape.quadraticCurveTo(-0.18, -0.25, -0.18, 0.0);
    arrowShape.lineTo(-0.18, 1.1);
    arrowShape.closePath();

    const arrowGeo = new THREE.ShapeGeometry(arrowShape);
    arrowGeo.rotateX(-PI / 2);

    for (const sx of stations) {
      const m = new THREE.Mesh(arrowGeo, MAT.paintWhite());
      // Since group is at x = 40 with heading 270 (rotation.y = -270 deg = +90 deg),
      // local -Z points along -X_world, so world dx = sx - 40 maps to local +Z = sx - 40!
      m.position.set(0, 0.003, sx - 40);
      m.receiveShadow = true;
      group.add(m);
    }

    return group;
  }

  // =========================================================================
  // 7. BUILDINGS, SHELTER, SIGNS, POLES, FENCES & VEGETATION BUILDERS
  // =========================================================================

  // Retail store on SE corner (18 m E-W width x 12 m N-S depth x 4.5 m height)
  function buildRetailStore() {
    const group = new THREE.Group();
    group.name = 'bld_store';

    const W = 18; // X span (9 to 27 m when placed at x = 18)
    const D = 12; // Z span (13 to 25 m when placed at z = 19)
    const H = 4.5;

    const stuccoMap = getStuccoWallTexture(6, 2);
    const wallMat = new THREE.MeshStandardMaterial({
      color: stuccoMap ? 0xffffff : 0xb89772,
      map: stuccoMap || null,
      roughness: 0.78,
      metalness: 0.05,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x5c4028,
      roughness: 0.65,
      metalness: 0.1,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x7a7d80,
      roughness: 0.55,
      metalness: 0.6,
    });

    // Concrete foundation slab
    const foundation = new THREE.Mesh(getBoxGeo(W + 0.6, 0.18, D + 0.6), MAT.concrete());
    foundation.position.set(0, 0.09, 0);
    foundation.receiveShadow = true;
    group.add(foundation);

    // Main CMU / stucco building mass
    const mainWall = new THREE.Mesh(getBoxGeo(W, H - 0.35, D), wallMat);
    mainWall.name = 'bld_store_walls';
    mainWall.position.set(0, (H - 0.35) / 2 + 0.15, 0);
    mainWall.castShadow = true;
    mainWall.receiveShadow = true;
    group.add(mainWall);

    // Parapet & low-slope commercial metal roof
    const parapet = new THREE.Mesh(getBoxGeo(W + 0.25, 0.38, D + 0.25), trimMat);
    parapet.position.set(0, H - 0.16, 0);
    parapet.castShadow = true;
    group.add(parapet);

    const roofDeck = new THREE.Mesh(getBoxGeo(W - 0.2, 0.12, D - 0.2), roofMat);
    roofDeck.position.set(0, H - 0.06, 0);
    group.add(roofDeck);

    // Front canopy overhang facing north (-Z toward US-27A)
    const awning = new THREE.Mesh(getBoxGeo(W * 0.86, 0.18, 1.65), trimMat);
    awning.position.set(0, 3.05, -D / 2 - 0.75);
    awning.castShadow = true;
    group.add(awning);

    // Storefront glass entrance doors & display windows on north face (-Z) and west face (-X)
    const doorFrame = new THREE.Mesh(getBoxGeo(2.1, 2.35, 0.12), MAT.steelGalv());
    doorFrame.position.set(-1.5, 1.32, -D / 2 - 0.02);
    group.add(doorFrame);

    const doorGlass = new THREE.Mesh(getBoxGeo(1.88, 2.18, 0.15), MAT.carGlass());
    doorGlass.position.set(-1.5, 1.32, -D / 2 - 0.02);
    group.add(doorGlass);

    for (const wx of [-5.4, 2.4, 5.8]) {
      const winFrame = new THREE.Mesh(getBoxGeo(2.4, 1.45, 0.10), MAT.steelGalv());
      winFrame.position.set(wx, 1.68, -D / 2 - 0.02);
      group.add(winFrame);

      const winGlass = new THREE.Mesh(getBoxGeo(2.22, 1.28, 0.13), MAT.carGlass());
      winGlass.position.set(wx, 1.68, -D / 2 - 0.02);
      group.add(winGlass);
    }

    // West side window facing NE 140th Ct
    const westWin = new THREE.Mesh(getBoxGeo(0.12, 1.45, 2.8), MAT.carGlass());
    westWin.position.set(-W / 2 - 0.02, 1.68, -1.8);
    group.add(westWin);

    // Fictionalized store sign board on north facade
    const signTex = getStoreSignTexture();
    const signMat = new THREE.MeshStandardMaterial({
      color: signTex ? 0xffffff : 0x2f452c,
      map: signTex || null,
      roughness: 0.45,
      metalness: 0.1,
    });
    const signBoard = new THREE.Mesh(getBoxGeo(7.6, 1.05, 0.14), signMat);
    signBoard.position.set(0, 3.75, -D / 2 - 0.08);
    group.add(signBoard);

    // Ice chest &concrete wheel stops in front of store
    const iceChest = new THREE.Mesh(getBoxGeo(1.65, 1.25, 0.85), MAT.paintWhite());
    iceChest.position.set(4.2, 0.78, -D / 2 - 0.45);
    iceChest.castShadow = true;
    group.add(iceChest);

    for (const sx of [-5.5, -2.5, 2.5, 5.5]) {
      const wheelStop = new THREE.Mesh(getBoxGeo(1.8, 0.14, 0.22), MAT.concrete());
      wheelStop.position.set(sx, 0.07, -D / 2 - 2.2);
      group.add(wheelStop);
    }

    return group;
  }

  // Open-sided covered bench shelter in front of store (3.0 x 1.8 x 2.4 m, occludes: false)
  // Four thin 0.10 m posts, roof bottom clearance 2.15 m so a 1.60 m eye line is completely open
  function buildOpenShelter() {
    const group = new THREE.Group();
    group.name = 'occ_shelter';

    // Heading 90 deg: local Z = 3.0 m (east-west), local X = 1.8 m (north-south)
    const L = 3.0;
    const W = 1.8;

    const pad = new THREE.Mesh(getBoxGeo(W + 0.3, 0.08, L + 0.3), MAT.concrete());
    pad.position.y = 0.04;
    pad.receiveShadow = true;
    group.add(pad);

    // Four 0.09 m square steel posts
    for (const px of [-W / 2 + 0.12, W / 2 - 0.12]) {
      for (const pz of [-L / 2 + 0.12, L / 2 - 0.12]) {
        const post = new THREE.Mesh(getBoxGeo(0.09, 2.2, 0.09), MAT.darkSteel());
        post.position.set(px, 1.14, pz);
        post.castShadow = true;
        group.add(post);
      }
    }

    // Corrugated metal gable roof (bottom eave at y = 2.18 m, ridge at y = 2.42 m)
    const roofBase = new THREE.Mesh(getBoxGeo(W + 0.25, 0.08, L + 0.25), MAT.steelGalv());
    roofBase.position.set(0, 2.22, 0);
    roofBase.castShadow = true;
    group.add(roofBase);

    const roofRidge = new THREE.Mesh(getBoxGeo(W * 0.55, 0.14, L + 0.22), MAT.steelGalv());
    roofRidge.position.set(0, 2.33, 0);
    group.add(roofRidge);

    // Wooden slat bench inside shelter (seat at y = 0.46 m, backrest at y = 0.78 m)
    const benchMat = MAT.woodFence();
    const benchSeat = new THREE.Mesh(getBoxGeo(0.48, 0.05, 2.1), benchMat);
    benchSeat.position.set(0.22, 0.46, 0);
    benchSeat.castShadow = true;
    group.add(benchSeat);

    const benchBack = new THREE.Mesh(getBoxGeo(0.05, 0.34, 2.1), benchMat);
    benchBack.position.set(0.44, 0.68, 0);
    group.add(benchBack);

    for (const bz of [-0.85, 0, 0.85]) {
      const leg = new THREE.Mesh(getBoxGeo(0.44, 0.42, 0.06), MAT.darkSteel());
      leg.position.set(0.22, 0.25, bz);
      group.add(leg);
    }

    return group;
  }

  // MUTCD R1-1 STOP Sign on northbound NE 140th Court
  function buildStopSign() {
    const group = new THREE.Group();
    group.name = 'sign_stop_ne140';

    const post = new THREE.Mesh(getBoxGeo(0.06, 2.85, 0.06), MAT.steelGalv());
    post.position.y = 1.425;
    post.castShadow = true;
    group.add(post);

    // Octagonal sign face (0.76 m = 30 in), bottom at 2.13 m (7 ft), center at 2.51 m
    const tex = getStopSignTexture();
    const faceMat = new THREE.MeshStandardMaterial({
      color: tex ? 0xffffff : 0xc41e3a,
      map: tex || null,
      roughness: 0.35,
      metalness: 0.18,
      transparent: Boolean(tex),
      alphaTest: tex ? 0.4 : 0,
    });

    const plate = new THREE.Mesh(getCylGeo(0.38, 0.38, 0.012, 8), faceMat);
    plate.rotation.x = PI / 2;
    plate.rotation.z = PI / 8;
    plate.position.set(0, 2.51, -0.04);
    plate.castShadow = true;
    group.add(plate);

    return group;
  }

  // MUTCD R2-1 Speed Limit 65 Sign on eastbound US-27A
  function buildSpeedLimitSign() {
    const group = new THREE.Group();
    group.name = 'sign_speed_eb';

    const post = new THREE.Mesh(getBoxGeo(0.07, 3.05, 0.07), MAT.steelGalv());
    post.position.y = 1.525;
    post.castShadow = true;
    group.add(post);

    const tex = getSpeedLimitSignTexture('65');
    const signMat = new THREE.MeshStandardMaterial({
      color: tex ? 0xffffff : 0xf5f5f5,
      map: tex || null,
      roughness: 0.35,
      metalness: 0.18,
    });

    const panel = new THREE.Mesh(getBoxGeo(0.91, 1.22, 0.016), signMat);
    panel.position.set(0, 2.74, -0.045);
    panel.castShadow = true;
    group.add(panel);

    return group;
  }

  // Single Wooden Utility Pole with Crossarm & Insulators (`occ_pole`)
  function buildUtilityPole(id, height = 10) {
    const group = new THREE.Group();
    group.name = id;

    const pole = new THREE.Mesh(getCylGeo(0.13, 0.175, height, 14), MAT.woodPole());
    pole.position.y = height / 2;
    pole.castShadow = true;
    pole.receiveShadow = true;
    group.add(pole);

    const crossarm = new THREE.Mesh(getBoxGeo(0.12, 0.14, 2.2), MAT.woodPole());
    crossarm.position.set(0, height - 0.8, 0);
    crossarm.castShadow = true;
    group.add(crossarm);

    for (const iz of [-0.95, -0.35, 0.35, 0.95]) {
      const insulator = new THREE.Mesh(getCylGeo(0.04, 0.05, 0.14, 8), MAT.steelGalv());
      insulator.position.set(0, height - 0.66, iz);
      group.add(insulator);
    }

    return group;
  }

  // Series of wooden utility poles + catenary overhead wires along south right-of-way
  function buildUtilityPoleLine() {
    const group = new THREE.Group();
    group.name = 'utility_poles_south_line';
    // Placed at [164.3, 0, 18.5], heading 90 deg -> local -Z = +X_world
    const centerX = 164.3;
    const poleStations = [-135.7, -60.7, 14.3, 89.3, 164.3, 239.3, 314.3];

    for (let i = 0; i < poleStations.length; i++) {
      const px = poleStations[i];
      const localZ = -(px - centerX);

      // Avoid double-drawing the pole shaft right on top of `occ_pole` at 239.3, or draw a matching pole
      if (Math.abs(px - 239.3) > 0.5) {
        const p = buildUtilityPole(`south_line_pole_${i}`, 10);
        p.position.set(0, 0, localZ);
        p.rotation.y = PI / 2;
        group.add(p);
      }

      // Catenary sagging wires between consecutive poles
      if (i < poleStations.length - 1) {
        const nextZ = -(poleStations[i + 1] - centerX);
        for (const wx of [-0.85, 0.0, 0.85]) {
          const pts = [];
          const steps = 10;
          for (let s = 0; s <= steps; s++) {
            const u = s / steps;
            const zPos = localZ + (nextZ - localZ) * u;
            const sag = Math.sin(u * PI) * 1.15;
            pts.push(new THREE.Vector3(wx, 9.34 - sag, zPos));
          }
          const curve = new THREE.CatmullRomCurve3(pts);
          const wireGeo = new THREE.TubeGeometry(curve, 12, 0.014, 6, false);
          const wireMesh = new THREE.Mesh(wireGeo, MAT.steelGalv());
          group.add(wireMesh);
        }
      }
    }

    return group;
  }

  // Wire pasture fence with instanced wooden posts and 4 galvanized wire strands
  function buildWireFence(id, length = 140, height = 1.2) {
    const group = new THREE.Group();
    group.name = id;

    const spacing = 3.66;
    const numPosts = Math.max(2, Math.floor(length / spacing) + 1);
    const postGeo = getCylGeo(0.06, 0.065, height, 8);
    const postInst = new THREE.InstancedMesh(postGeo, MAT.woodFence(), numPosts);
    postInst.castShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < numPosts; i++) {
      const z = -length / 2 + (i / (numPosts - 1)) * length;
      dummy.position.set(0, height / 2, z);
      dummy.updateMatrix();
      postInst.setMatrixAt(i, dummy.matrix);
    }
    postInst.instanceMatrix.needsUpdate = true;
    group.add(postInst);

    // 4 horizontal wire strands
    for (const wy of [0.28, 0.56, 0.84, 1.12]) {
      const wire = new THREE.Mesh(getBoxGeo(0.012, 0.012, length), MAT.steelGalv());
      wire.position.set(0, wy, 0);
      group.add(wire);
    }

    return group;
  }

  // Precast concrete drainage culvert & swale (`drainage_culvert_se`)
  function buildDrainageCulvert() {
    const group = new THREE.Group();
    group.name = 'drainage_culvert_se';

    // Pipe along local Z (length 8 m, heading 90 deg -> runs east-west along roadside ditch)
    const pipe = new THREE.Mesh(getCylGeo(0.32, 0.32, 8.0, 18), MAT.concrete());
    pipe.rotation.x = PI / 2;
    pipe.position.y = 0.32;
    pipe.receiveShadow = true;
    group.add(pipe);

    // Mitered concrete end headwalls
    for (const ez of [-4.0, 4.0]) {
      const headwall = new THREE.Mesh(getBoxGeo(1.8, 0.65, 0.35), MAT.concrete());
      headwall.position.set(0, 0.325, ez);
      headwall.receiveShadow = true;
      group.add(headwall);
    }

    return group;
  }

  // Rural single-family ranch residences on south side of US-27A (`residential_houses_south`)
  function buildResidentialHouses() {
    const group = new THREE.Group();
    group.name = 'residential_houses_south';

    const sidingMat = new THREE.MeshStandardMaterial({
      color: 0xd8d2c5,
      roughness: 0.8,
      metalness: 0.02,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x4a4845,
      roughness: 0.85,
      metalness: 0.05,
    });

    // Main residence at [275, 0, 38] (local 0, 0, 0) + neighbouring house at x = 215 (local x = -60)
    for (const hx of [0, -62]) {
      const hGroup = new THREE.Group();
      hGroup.position.set(hx, 0, 0);

      const walls = new THREE.Mesh(getBoxGeo(20, 3.1, 14), sidingMat);
      walls.position.y = 1.55;
      walls.castShadow = true;
      walls.receiveShadow = true;
      hGroup.add(walls);

      // Pitched gable roof
      const roofShape = new THREE.Shape();
      roofShape.moveTo(-7.6, 3.05);
      roofShape.lineTo(0, 4.35);
      roofShape.lineTo(7.6, 3.05);
      roofShape.closePath();

      const roofGeo = new THREE.ExtrudeGeometry(roofShape, {
        depth: 20.8,
        bevelEnabled: false,
      });
      roofGeo.translate(0, 0, -10.4);
      roofGeo.rotateY(PI / 2);
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.castShadow = true;
      hGroup.add(roof);

      // Front door & windows facing north (-Z)
      const door = new THREE.Mesh(getBoxGeo(1.1, 2.1, 0.08), MAT.woodFence());
      door.position.set(0, 1.1, -7.02);
      hGroup.add(door);

      for (const wx of [-6.5, -3.2, 3.2, 6.5]) {
        const win = new THREE.Mesh(getBoxGeo(1.6, 1.2, 0.08), MAT.carGlass());
        win.position.set(wx, 1.65, -7.02);
        hGroup.add(win);
      }

      group.add(hGroup);
    }

    return group;
  }

  // Vertical Crest Terrain Proxy (`occ_crest`) at x = -377 m, z = -15 m, 60 x 80 x 7.4 m
  // Styled as a natural graded highway embankment & grass rise so it looks realistic AND blocks sightlines identically
  function buildCrestTerrainOccluder() {
    const group = new THREE.Group();
    group.name = 'occ_crest';

    // Core solid occluder mass (width 60 m along X, depth 80 m along Z, height 7.4 m)
    const mainMass = new THREE.Mesh(getBoxGeo(60, 7.4, 80), MAT.grassGround());
    mainMass.name = 'occ_crest_mass';
    mainMass.position.set(0, 3.7, 0);
    mainMass.castShadow = true;
    mainMass.receiveShadow = true;
    group.add(mainMass);

    // Asphalt roadway strips draped over the crest top for EB (z = -1.83 -> local +13.17) and WB (z = -32.92 -> local -17.92)
    const ebCap = new THREE.Mesh(getBoxGeo(60.1, 0.08, 10.4), MAT.asphaltMain());
    ebCap.position.set(0, 7.42, 13.17);
    group.add(ebCap);

    const wbCap = new THREE.Mesh(getBoxGeo(60.1, 0.08, 10.4), MAT.asphaltMain());
    wbCap.position.set(0, 7.42, -17.92);
    group.add(wbCap);

    return group;
  }

  // Distant Florida pine & live oak treeline (`veg_distant_treeline`) using InstancedMesh leaf cards & trunks
  function buildDistantTreeline() {
    const group = new THREE.Group();
    group.name = 'veg_distant_treeline';
    // Placed at [-50, 0, -65], heading 90 deg -> local -Z = +X_world (east), local +X = +Z_world (south)
    const rng = mulberry32(909);

    const treeCount = 150;
    const trunkGeo = getCylGeo(0.18, 0.32, 6.5, 8);
    const trunkInst = new THREE.InstancedMesh(trunkGeo, MAT.woodPole(), treeCount);
    trunkInst.castShadow = true;

    const leafTex = getLeafClusterTexture();
    const foliageMat = new THREE.MeshStandardMaterial({
      color: leafTex ? 0xffffff : 0x3b5323,
      map: leafTex || null,
      roughness: 0.88,
      metalness: 0.0,
      transparent: Boolean(leafTex),
      alphaTest: leafTex ? 0.35 : 0,
      side: THREE.DoubleSide,
    });

    // Crossed alpha-card canopy clusters + volumetric crown core
    const crownGeo = new THREE.DodecahedronGeometry(3.6, 1);
    const crownInst = new THREE.InstancedMesh(crownGeo, foliageMat, treeCount * 2);
    crownInst.castShadow = true;
    crownInst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let cIdx = 0;

    for (let i = 0; i < treeCount; i++) {
      // 110 trees along the north background (local X ~ 0, Z in [-380, 380])
      // 40 trees far south behind the houses (local X ~ +125 -> world z = +60 m)
      const isSouth = i >= 110;
      const localZ = (rng() - 0.5) * 760;
      const localX = isSouth ? 122 + (rng() - 0.5) * 14 : (rng() - 0.5) * 14;
      const scale = 0.75 + rng() * 0.65;

      dummy.position.set(localX, 3.25 * scale, localZ);
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.set(0, rng() * TAU, 0);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);

      for (let k = 0; k < 2; k++) {
        dummy.position.set(
          localX + (rng() - 0.5) * 1.4,
          (6.8 + k * 2.1) * scale,
          localZ + (rng() - 0.5) * 1.4
        );
        dummy.scale.set(scale * (1.1 - k * 0.2), scale * (0.85 + k * 0.15), scale * (1.1 - k * 0.2));
        dummy.rotation.set(rng() * 0.4, rng() * TAU, rng() * 0.4);
        dummy.updateMatrix();
        crownInst.setMatrixAt(cIdx++, dummy.matrix);
      }
    }

    trunkInst.instanceMatrix.needsUpdate = true;
    crownInst.instanceMatrix.needsUpdate = true;
    group.add(trunkInst);
    group.add(crownInst);
    return group;
  }

  // Forensic reference markers (`mark_impact`, `mark_rest_A`) and post-impact path (`mark_path_A`)
  function buildForensicMarker(id) {
    const group = new THREE.Group();
    group.name = id;

    const ring = new THREE.Mesh(getCylGeo(0.5, 0.5, 0.012, 24), MAT.forensicRed());
    ring.position.y = 0.006;
    group.add(ring);

    const inner = new THREE.Mesh(getCylGeo(0.18, 0.18, 0.016, 16), MAT.paintWhite());
    inner.position.y = 0.008;
    group.add(inner);

    const pin = new THREE.Mesh(getCylGeo(0.02, 0.02, 0.45, 8), MAT.forensicRed());
    pin.position.y = 0.225;
    group.add(pin);

    return group;
  }

  function buildPostImpactPath(id, points, width = 0.3) {
    const group = new THREE.Group();
    group.name = id;

    // Build two parallel tire furrow ribbons along the post-impact trajectory
    for (const trackOffset of [-0.78, 0.78]) {
      const positions = [];
      const indices = [];

      for (let i = 0; i < points.length; i++) {
        const [x, z] = points[i];
        const prev = points[Math.max(0, i - 1)];
        const next = points[Math.min(points.length - 1, i + 1)];
        let dx = next[0] - prev[0];
        let dz = next[1] - prev[1];
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;

        // Right-hand normal in XZ plane: (-dz, dx)
        const nx = -dz;
        const nz = dx;

        const cx = x + nx * trackOffset;
        const cz = z + nz * trackOffset;
        const hw = width * 0.5;

        positions.push(cx - nx * hw, 0.022, cz - nz * hw);
        positions.push(cx + nx * hw, 0.022, cz + nz * hw);

        if (i < points.length - 1) {
          const base = i * 2;
          indices.push(base, base + 1, base + 2);
          indices.push(base + 1, base + 3, base + 2);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, MAT.furrowDirt());
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    return group;
  }

  // =========================================================================
  // 8. ASSEMBLE ALL 42 SCENE SPEC ELEMENTS + V2 COMPATIBILITY OBJECTS
  // =========================================================================
  buildEnvironment();

  // --- Ground Plane ---
  registerObject(
    'ground_base',
    buildSlabMesh(820, 0.01, 820, MAT.grassGround(), -0.01),
    'road',
    'Surrounding rural grass and sandy soil ground plane',
    'world_v2.js lines 15-16; evidence/map.png',
    false,
    -50,
    0,
    0,
    0
  );

  // --- US-27A Eastbound & Westbound Main Lanes ---
  registerObject(
    'road_eb',
    buildDividedHighwayCorridor('road_eb', 780, 7.32),
    'road',
    'US-27A eastbound (2 x 3.66 m lanes, 65 mph limit)',
    'NTSB/HAR-17/02 p.22-23; facts.txt F6, F9',
    false,
    -50,
    0,
    -1.83,
    90
  );

  registerObject(
    'road_wb',
    buildDividedHighwayCorridor('road_wb', 780, 7.32),
    'road',
    'US-27A westbound (2 x 3.66 m lanes)',
    'NTSB/HAR-17/02 p.22; facts.txt F6, F9',
    false,
    -50,
    0,
    -32.92,
    90
  );

  // --- Paved Shoulders ---
  registerObject(
    'shoulder_eb_south',
    buildSlabMesh(1.52, 0.018, 780, MAT.asphaltShoulder(), 0),
    'road',
    'US-27A Eastbound outside (right/south) paved shoulder (5 ft / 1.52 m wide)',
    'facts.txt F6; police_report.txt p.3',
    false,
    -50,
    0,
    2.59,
    90
  );

  registerObject(
    'shoulder_eb_north',
    buildSlabMesh(0.61, 0.018, 780, MAT.asphaltShoulder(), 0),
    'road',
    'US-27A Eastbound inside (left/north) paved shoulder (2 ft / 0.61 m wide)',
    'facts.txt F6; police_report.txt p.3',
    false,
    -50,
    0,
    -5.795,
    90
  );

  registerObject(
    'shoulder_wb_north',
    buildSlabMesh(1.52, 0.018, 780, MAT.asphaltShoulder(), 0),
    'road',
    'US-27A Westbound outside (right/north) paved shoulder (5 ft / 1.52 m wide)',
    'facts.txt F6; police_report.txt p.3',
    false,
    -50,
    0,
    -37.34,
    90
  );

  registerObject(
    'shoulder_wb_south',
    buildSlabMesh(0.61, 0.018, 420.2, MAT.asphaltShoulder(), 0),
    'road',
    'US-27A Westbound inside (left/south) paved shoulder (2 ft / 0.61 m wide, west of crossover)',
    'facts.txt F6; police_report.txt p.3',
    false,
    -229.9,
    0,
    -28.955,
    90
  );

  // --- Auxiliary & Left-Turn Lanes ---
  registerObject(
    'road_wb_turn',
    buildSlabMesh(3.66, 0.02, 187.4, MAT.asphaltTurn(), 0),
    'road',
    'Westbound left-turn lane (167.6 m)',
    'NTSB/HAR-17/02 p.22; facts.txt F8; world_v2.js line 21',
    false,
    73.9,
    0,
    -27.43,
    90
  );

  registerObject(
    'road_eb_turn',
    buildSlabMesh(3.66, 0.019, 167.6, MAT.asphaltTurn(), 0),
    'road',
    'US-27A Eastbound Auxiliary Turn Lanes (550 ft / 167.6 m)',
    'facts.txt F8',
    false,
    -103.6,
    0,
    3.66,
    90
  );

  // --- Grassy Medians & Uncontrolled Median Crossover ---
  registerObject(
    'road_median_w',
    buildSlabMesh(18.28, 0.04, 420.2, MAT.grassMedian(), 0),
    'road',
    'Grass median (18.29 m) west of the crossover',
    'NTSB/HAR-17/02 p.22; facts.txt F7, F8; world_v2.js line 22',
    false,
    -229.9,
    0,
    -15.24,
    90
  );

  registerObject(
    'road_median_e',
    buildSlabMesh(18.28, 0.04, 320.2, MAT.grassMedian(), 0),
    'road',
    'Grass median (18.29 m) east of the crossover',
    'NTSB/HAR-17/02 p.22; facts.txt F7, F8; world_v2.js line 23',
    false,
    179.9,
    0,
    -15.24,
    90
  );

  registerObject(
    'road_crossover',
    buildSlabMesh(39.6, 0.021, 23.77, MAT.asphaltTurn(), 0),
    'road',
    'Uncontrolled paved median crossover at NE 140th Court (130 ft / 39.6 m long)',
    'NTSB/HAR-17/02 p.22; facts.txt F8; world_v2.js line 24',
    false,
    0,
    0,
    -15.24,
    0
  );

  // Preserve v2 tile IDs (`road_crossover_w`, `road_crossover_e`) as well
  for (const [cid, cx] of [
    ['road_crossover_w', -9.9],
    ['road_crossover_e', 9.9],
  ]) {
    registerObject(
      cid,
      buildSlabMesh(19.8, 0.022, 19.8, MAT.asphaltTurn(), 0),
      'road',
      'Uncontrolled 39.6 m median crossover (paved)',
      'NTSB/HAR-17/02 p.22',
      false,
      cx,
      0,
      -15.24,
      0
    );
  }

  // --- Side Road: NE 140th Court ---
  registerObject(
    'road_ne140',
    buildSlabMesh(6.1, 0.02, 146.6, MAT.asphaltSideRoad(), 0),
    'road',
    'NE 140th Court (runs south; 109 deg skew simplified)',
    'inferred: NTSB/HAR-17/02 p.1, p.22; width assumed',
    false,
    0,
    0,
    76.7,
    0
  );

  // --- MUTCD Pavement Markings ---
  registerObject(
    'mark_eb_lane_line',
    buildBrokenLaneLine('mark_eb_lane_line', -440, 340, -1.83),
    'mark',
    'US-27A Eastbound broken white lane line separating EB inside and outside lanes',
    'evidence/map.png; world_v2.js line 19; standard: MUTCD 2009 Section 3A.06 & 3B.04',
    false,
    -50,
    0.025,
    -1.83,
    90
  );

  registerObject(
    'mark_wb_lane_line',
    buildBrokenLaneLine('mark_wb_lane_line', -440, 340, -32.92),
    'mark',
    'US-27A Westbound broken white lane line separating WB inside and outside lanes',
    'evidence/map.png; world_v2.js line 20; standard: MUTCD 2009 Section 3A.06 & 3B.04',
    false,
    -50,
    0.025,
    -32.92,
    90
  );

  registerObject(
    'mark_eb_right_edge_w',
    buildSolidEdgeLine('mark_eb_right_edge_w', 437, 0.15, false),
    'mark',
    'US-27A Eastbound solid white right edge line (west of NE 140th Ct)',
    'evidence/map.png; world_v2.js line 19; standard: MUTCD 2009 Section 3B.06',
    false,
    -221.5,
    0.025,
    1.83,
    90
  );

  registerObject(
    'mark_eb_right_edge_e',
    buildSolidEdgeLine('mark_eb_right_edge_e', 337, 0.15, false),
    'mark',
    'US-27A Eastbound solid white right edge line (east of NE 140th Ct)',
    'evidence/map.png; world_v2.js line 19; standard: MUTCD 2009 Section 3B.06',
    false,
    171.5,
    0.025,
    1.83,
    90
  );

  registerObject(
    'mark_eb_left_edge_w',
    buildSolidEdgeLine('mark_eb_left_edge_w', 420.2, 0.15, true),
    'mark',
    'US-27A Eastbound solid yellow median-side left edge line (west of crossover)',
    'evidence/map.png; standard: MUTCD 2009 Section 3B.06',
    false,
    -229.9,
    0.025,
    -5.49,
    90
  );

  registerObject(
    'mark_eb_left_edge_e',
    buildSolidEdgeLine('mark_eb_left_edge_e', 320.2, 0.15, true),
    'mark',
    'US-27A Eastbound solid yellow median-side left edge line (east of crossover)',
    'evidence/map.png; standard: MUTCD 2009 Section 3B.06',
    false,
    179.9,
    0.025,
    -5.49,
    90
  );

  registerObject(
    'mark_wb_right_edge',
    buildSolidEdgeLine('mark_wb_right_edge', 780, 0.15, false),
    'mark',
    'US-27A Westbound solid white right (north) edge line',
    'evidence/map.png; world_v2.js line 20; standard: MUTCD 2009 Section 3B.06',
    false,
    -50,
    0.025,
    -36.58,
    90
  );

  registerObject(
    'mark_wb_turn_channel_line',
    buildSolidEdgeLine('mark_wb_turn_channel_line', 187.4, 0.15, false),
    'mark',
    'US-27A Westbound solid white lane line separating WB inside lane from WB left-turn lane',
    'evidence/map.png; world_v2.js line 21; standard: MUTCD 2009 Section 3B.04',
    false,
    73.9,
    0.025,
    -29.26,
    90
  );

  registerObject(
    'mark_wb_left_edge_e',
    buildSolidEdgeLine('mark_wb_left_edge_e', 320.2, 0.15, true),
    'mark',
    'US-27A Westbound solid yellow median-side edge line along WB left-turn lane (east of crossover)',
    'evidence/map.png; standard: MUTCD 2009 Section 3B.06',
    false,
    179.9,
    0.025,
    -25.6,
    90
  );

  registerObject(
    'mark_wb_left_edge_w',
    buildSolidEdgeLine('mark_wb_left_edge_w', 420.2, 0.15, true),
    'mark',
    'US-27A Westbound solid yellow median-side edge line (west of crossover)',
    'evidence/map.png; standard: MUTCD 2009 Section 3B.06',
    false,
    -229.9,
    0.025,
    -25.6,
    90
  );

  registerObject(
    'mark_wb_turn_arrows',
    buildTurnLaneArrows(),
    'mark',
    'Westbound left-turn lane pavement arrows (3 left-turn arrows spaced along the 167.6 m turn lane)',
    'standard: MUTCD 2009 Section 3B.20; inferred placement',
    false,
    40,
    0.025,
    -27.43,
    270
  );

  registerObject(
    'mark_ne140_stop_line',
    buildSolidEdgeLine('mark_ne140_stop_line', 3.05, 0.4, false),
    'mark',
    'Stop line on northbound NE 140th Court approach to US-27A',
    'police_report.txt p.1 (stop sign on NE 140th Ct approach); standard: MUTCD 2009 Section 3B.16',
    false,
    1.52,
    0.025,
    5.5,
    90
  );

  // --- Traffic Control Signs ---
  registerObject(
    'sign_stop_ne140',
    buildStopSign(),
    'signal',
    'STOP sign on northbound NE 140th Court approach to US-27A',
    'police_report.txt p.1 (Traffic control: stop sign on the NE 140th Ct approach only); standard: MUTCD 2009 R1-1',
    false,
    4.2,
    0,
    6,
    180
  );

  registerObject(
    'sign_speed_eb',
    buildSpeedLimitSign(),
    'signal',
    'SPEED LIMIT 65 sign on US-27A Eastbound roadside',
    'facts.txt F13; police_report.txt p.1 (Posted speed: 65 mph, US-27A); standard: MUTCD 2009 R2-1',
    false,
    -180,
    0,
    5.2,
    270
  );

  // --- Static Occluders, Buildings, Fences, Culvert, Poles & Vegetation ---
  registerObject(
    'occ_crest',
    buildCrestTerrainOccluder(),
    'occluder',
    'Vertical crest of US-27A, 345 m west (terrain proxy: hill mass beyond the crest)',
    'inferred: NTSB/HAR-17/02 p.22 (crest 1,132 ft W, 2.15% descent), p.29 (only sight restriction); approximated as a solid block',
    true,
    -377,
    0,
    -15,
    0
  );

  registerObject(
    'bld_store',
    buildRetailStore(),
    'building',
    'Retail business on the SE corner (fictionalized footprint)',
    "inferred: NTSB/HAR-17/02 p.1 ('retail business on the intersection corner'); corner, footprint and height assumed",
    true,
    18,
    0,
    19,
    0
  );

  registerObject(
    'occ_shelter',
    buildOpenShelter(),
    'occluder',
    'Open-sided covered bench shelter in front of the store (fictional, does not block)',
    'Fictional scene dressing referenced in Witness B deposition (~27:04). Roof only on 0.1 m posts, so it does not block a 1.6 m eye line.',
    false,
    8,
    0,
    7.9,
    90
  );

  registerObject(
    'store_parking_apron',
    buildSlabMesh(9, 0.012, 24, MAT.limerock(), 0),
    'road',
    'Gravel/paved parking and pull-off area in front of retail store connecting to US-27A and NE 140th Ct',
    'inferred: deposition.txt 77-83, 95; evidence/map.png; typical rural store frontage',
    false,
    16,
    0.005,
    9,
    90
  );

  registerObject(
    'drainage_culvert_se',
    buildDrainageCulvert(),
    'road',
    'Roadside drainage ditch and concrete pipe culvert under driveway/side-road east of intersection',
    'facts.txt F24; police_report.txt p.2 (crossed a drainage culvert); inferred placement along Vehicle A post-impact trajectory',
    false,
    85,
    -0.4,
    9.5,
    90
  );

  registerObject(
    'fence_wire_south_1',
    buildWireFence('fence_wire_south_1', 140, 1.2),
    'occluder',
    'Rural wire pasture/property fence #1 on south side of US-27A (struck by Vehicle A post-impact)',
    'facts.txt F24; police_report.txt p.2; deposition.txt 206 (went through two wire fences); inferred placement',
    false,
    155,
    0,
    14.5,
    90
  );

  registerObject(
    'fence_wire_south_2',
    buildWireFence('fence_wire_south_2', 18, 1.2),
    'occluder',
    'Cross-property wire fence #2 near residential yard on south side of US-27A (struck by Vehicle A post-impact)',
    'facts.txt F24; police_report.txt p.2 (went through two wire fences); inferred placement',
    false,
    225,
    0,
    22,
    0
  );

  registerObject(
    'occ_pole',
    buildUtilityPole('occ_pole', 10),
    'occluder',
    'Utility pole broken by Vehicle A (position derived)',
    'inferred: NTSB/HAR-17/02 p.1; derived: NTSB gives no pole location; placed on the post-impact path',
    true,
    239.3,
    0,
    18.5,
    0
  );

  registerObject(
    'utility_poles_south_line',
    buildUtilityPoleLine(),
    'occluder',
    'Series of wooden utility poles along south right-of-way of US-27A (spaced ~75 m apart)',
    'inferred: facts.txt F24 (struck utility pole); typical rural utility line spacing aligned with occ_pole at z = 18.5 m',
    false,
    164.3,
    0,
    18.5,
    90
  );

  registerObject(
    'residential_driveway_east',
    buildSlabMesh(4, 0.015, 22, MAT.limerock(), 0),
    'road',
    'Residential driveway near Vehicle A final rest',
    'police_report.txt p.2 (in the front yard of a residence near a driveway); inferred placement near mark_rest_A',
    false,
    280,
    0.005,
    14,
    0
  );

  registerObject(
    'residential_houses_south',
    buildResidentialHouses(),
    'building',
    'Rural single-family residences set back on south side of US-27A east of the store',
    'facts.txt F25; police_report.txt p.2, p.3; deposition.txt 207, 210; inferred footprint set far back from highway',
    false,
    275,
    0,
    38,
    0
  );

  registerObject(
    'veg_distant_treeline',
    buildDistantTreeline(),
    'occluder',
    'Distant rural Florida pine and live oak treeline well outside the highway clear zone',
    'facts.txt F27 (No vegetation or other obstructions were reported on the approach); inferred distant background treeline',
    false,
    -50,
    0,
    -65,
    90
  );

  // --- Forensic Marks ---
  registerObject(
    'mark_impact',
    buildForensicMarker('mark_impact'),
    'mark',
    'Initial point of impact (EB outside lane at NE 140th Ct)',
    'NTSB/HAR-17/02 p.1, p.5',
    false,
    0,
    0,
    0,
    0
  );

  registerObject(
    'mark_rest_A',
    buildForensicMarker('mark_rest_A'),
    'mark',
    'Final rest of Vehicle A (~910 ft past impact)',
    'inferred: NTSB/HAR-17/02 p.1; position approximate',
    false,
    276.6,
    0,
    23.9,
    0
  );

  // =========================================================================
  // 9. TIMELINE & KINEMATICS (IDENTICAL TO V2)
  // =========================================================================
  const KA = [
    [0, -347.52, 0, 90],
    [0.25, -339.25, 0, 90],
    [0.5, -330.98, 0, 90],
    [0.75, -322.71, 0, 90],
    [1, -314.44, 0, 90],
    [1.25, -306.17, 0, 90],
    [1.5, -297.9, 0, 90],
    [1.75, -289.63, 0, 90],
    [2, -281.36, 0, 90],
    [2.25, -273.09, 0, 90],
    [2.5, -264.82, 0, 90],
    [2.75, -256.55, 0, 90],
    [3, -248.28, 0, 90],
    [3.25, -240.01, 0, 90],
    [3.5, -231.74, 0, 90],
    [3.75, -223.47, 0, 90],
    [4, -215.2, 0, 90],
    [4.25, -206.93, 0, 90],
    [4.5, -198.66, 0, 90],
    [4.75, -190.38, 0, 90],
    [5, -182.11, 0, 90],
    [5.25, -173.84, 0, 90],
    [5.5, -165.57, 0, 90],
    [5.75, -157.3, 0, 90],
    [6, -149.03, 0, 90],
    [6.25, -140.76, 0, 90],
    [6.5, -132.49, 0, 90],
    [6.75, -124.22, 0, 90],
    [7, -115.95, 0, 90],
    [7.25, -107.68, 0, 90],
    [7.5, -99.41, 0, 90],
    [7.75, -91.14, 0, 90],
    [8, -82.87, 0, 90],
    [8.25, -74.6, 0, 90],
    [8.5, -66.33, 0, 90],
    [8.75, -58.06, 0, 90],
    [9, -49.79, 0, 90],
    [9.25, -41.52, 0, 90],
    [9.5, -33.25, 0, 90],
    [9.75, -24.98, 0, 90],
    [10, -16.71, 0, 90],
    [10.25, -8.44, 0, 90],
    [10.5, -0.17, -0.01, 90.2],
    [10.75, 8.03, 0.47, 91],
    [11, 16.15, 1.08, 91.7],
    [11.25, 24.21, 1.68, 92.5],
    [11.5, 32.21, 2.28, 93.2],
    [11.75, 40.13, 2.87, 94],
    [12, 47.99, 3.46, 94.5],
    [12.25, 55.78, 4.08, 94.5],
    [12.5, 63.51, 4.68, 94.5],
    [12.75, 71.17, 5.29, 94.5],
    [13, 78.76, 5.88, 94.5],
    [13.25, 86.28, 6.48, 94.5],
    [13.5, 93.74, 7.06, 94.5],
    [13.75, 101.13, 7.64, 94.5],
    [14, 108.45, 8.22, 94.5],
    [14.25, 115.7, 8.79, 94.5],
    [14.5, 122.89, 9.36, 94.5],
    [14.75, 130.02, 9.92, 94.5],
    [15, 137.07, 10.47, 94.5],
    [15.25, 144.06, 11.02, 94.5],
    [15.5, 150.98, 11.57, 94.5],
    [15.75, 157.84, 12.11, 94.5],
    [16, 164.62, 12.64, 94.5],
    [16.25, 171.34, 13.17, 94.5],
    [16.5, 178, 13.69, 94.5],
    [16.75, 184.59, 14.21, 94.5],
    [17, 191.11, 14.73, 94.5],
    [17.25, 197.56, 15.23, 94.5],
    [17.5, 203.94, 15.74, 94.5],
    [17.75, 210.26, 16.23, 94.5],
    [18, 216.52, 16.73, 94.5],
    [18.25, 222.7, 17.21, 94.5],
    [18.5, 228.82, 17.69, 94.5],
    [18.75, 234.87, 18.17, 94.5],
    [19, 240.75, 18.86, 89.3],
    [19.25, 246.21, 19.61, 81.7],
    [19.5, 251.22, 20.32, 74.1],
    [19.75, 255.8, 20.99, 66.5],
    [20, 259.93, 21.59, 58.9],
    [20.25, 263.62, 22.14, 51.3],
    [20.5, 266.85, 22.62, 43.7],
    [20.75, 269.64, 23.03, 36.1],
    [21, 271.97, 23.37, 28.5],
    [21.25, 273.84, 23.63, 20.9],
    [21.5, 275.24, 23.81, 13.3],
    [21.75, 276.17, 23.91, 5.7],
    [22, 276.56, 23.94, 0],
    [22.25, 276.56, 23.94, 0],
  ];

  const pathPts = KA.filter((k) => k[0] > 10.43).map((k) => [k[1], k[2]]);
  const pathMark = buildPostImpactPath('mark_path_A', pathPts, 0.3);
  root.add(pathMark);
  objects.mark_path_A = {
    node: pathMark,
    kind: 'mark',
    label: 'Post-impact path of Vehicle A (no pre-impact tire marks)',
    citation: 'NTSB/HAR-17/02 p.1, p.5',
    occludes: false,
  };

  // --- Vehicles ---
  const A = registerObject(
    'veh_A',
    buildSedanVehicle('veh_A', '#1d2c44'),
    'vehicle',
    'Passenger sedan (Vehicle A), eastbound',
    'inferred: NTSB/HAR-17/02 p.1 (910 ft post-impact), p.2 & p.15 (74 mph, no braking, headlights off), p.5 (no pre-impact marks); dims: typical full-size sedan, assumed',
    true
  ).node;

  const TT = registerObject(
    'veh_T_tractor',
    buildTruckTractor(),
    'vehicle',
    'Truck-tractor (Vehicle T)',
    'NTSB/HAR-17/02 p.1 (left turn from WB turn lane onto NE 140th Ct; stopped south of retail business), p.1-2 (witness could not tell if stopped or moving very slowly)',
    true
  ).node;

  const TR = registerObject(
    'veh_T_trailer',
    buildSemitrailer(),
    'vehicle',
    'Refrigerated van semitrailer (Vehicle T)',
    'NTSB/HAR-17/02 p.6 (71 ft 7 in overall; impact 45 ft 5 in behind tractor front)',
    true
  ).node;

  // Fictional observer vehicles (placed behind Witness A and Witness C eyes so they do not self-occlude witness sightlines)
  registerObject(
    'veh_wit_A',
    buildSedanVehicle('veh_wit_A', '#7a8288'),
    'vehicle',
    "Fictional Witness A's westbound passenger vehicle",
    'facts.txt F30; witness_A.txt; world_v2.js lines 72-84',
    false,
    361.5,
    0,
    -34.75,
    270
  );

  registerObject(
    'veh_wit_C',
    buildPickupVehicle('veh_wit_C', '#586068'),
    'vehicle',
    "Fictional Witness C's stopped pickup truck",
    'witness_C.txt; world_v2.js lines 99-111',
    false,
    -22.5,
    0,
    -40.5,
    270
  );

  const KT = [
    [0, 14.79, -27.42, -90.1],
    [0.25, 14.03, -27.4, -90.6],
    [0.5, 13.26, -27.34, -91.5],
    [0.75, 12.47, -27.26, -92.9],
    [1, 11.67, -27.15, -94.8],
    [1.25, 10.86, -27.01, -97.3],
    [1.5, 10.04, -26.84, -100.3],
    [1.75, 9.22, -26.64, -104],
    [2, 8.39, -26.4, -108.2],
    [2.25, 7.57, -26.1, -112.5],
    [2.5, 6.76, -25.72, -117],
    [2.75, 5.97, -25.28, -121.5],
    [3, 5.19, -24.76, -126.1],
    [3.25, 4.45, -24.17, -130.8],
    [3.5, 3.75, -23.51, -135.6],
    [3.75, 3.09, -22.78, -140.5],
    [4, 2.49, -21.98, -145.4],
    [4.25, 1.95, -21.12, -150.5],
    [4.5, 1.48, -20.19, -155.6],
    [4.75, 1.09, -19.21, -160.9],
    [5, 0.78, -18.18, -166.2],
    [5.25, 0.52, -17.11, -170.8],
    [5.5, 0.31, -16, -174.5],
    [5.75, 0.15, -14.85, -177.3],
    [6, 0.05, -13.67, -179.1],
    [6.25, 0, -12.46, -180],
    [6.5, 0, -11.23, 180],
    [6.75, 0, -9.98, 180],
    [7, 0, -8.72, 180],
    [7.25, 0, -7.43, 180],
    [7.5, 0, -6.13, 180],
    [7.75, 0, -4.81, 180],
    [8, 0, -3.47, 180],
    [8.25, 0, -2.11, 180],
    [8.5, 0, -0.73, 180],
    [8.75, 0, 0.67, 180],
    [9, 0, 2.08, 180],
    [9.25, 0, 3.52, 180],
    [9.5, 0, 4.97, 180],
    [9.75, 0, 6.44, 180],
    [10, 0, 7.93, 180],
    [10.25, 0, 9.44, 180],
    [10.5, 0, 10.97, 180],
    [10.75, 0, 12.47, 180],
    [11, 0, 13.94, 180],
    [11.25, 0, 15.38, 180],
    [11.5, 0, 16.78, 180],
    [11.75, 0, 18.15, 180],
    [12, 0, 19.48, 180],
    [12.25, 0, 20.78, 180],
    [12.5, 0, 22.05, 180],
    [12.75, 0, 23.28, 180],
    [13, 0, 24.48, 180],
    [13.25, 0, 25.64, 180],
    [13.5, 0, 26.76, 180],
    [13.75, 0, 27.86, 180],
    [14, 0, 28.92, 180],
    [14.25, 0, 29.94, 180],
    [14.5, 0, 30.93, 180],
    [14.75, 0, 31.89, 180],
    [15, 0, 32.81, 180],
    [15.25, 0, 33.69, 180],
    [15.5, 0, 34.55, 180],
    [15.75, 0, 35.36, 180],
    [16, 0, 36.15, 180],
    [16.25, 0, 36.9, 180],
    [16.5, 0, 37.61, 180],
    [16.75, 0, 38.29, 180],
    [17, 0, 38.94, 180],
    [17.25, 0, 39.55, 180],
    [17.5, 0, 40.13, 180],
    [17.75, 0, 40.67, 180],
    [18, 0, 41.18, 180],
    [18.25, 0, 41.65, 180],
    [18.5, 0, 42.09, 180],
    [18.75, 0, 42.5, 180],
    [19, 0, 42.87, 180],
    [19.25, 0, 43.2, 180],
    [19.5, 0, 43.51, 180],
    [19.75, 0, 43.78, 180],
    [20, 0, 44.01, 180],
    [20.25, 0, 44.21, 180],
    [20.5, 0, 44.37, 180],
    [20.75, 0, 44.5, 180],
    [21, 0, 44.6, 180],
    [21.25, 0, 44.66, 180],
    [21.5, 0, 44.69, 180],
    [21.75, 0, 44.69, 180],
    [22, 0, 44.69, 180],
    [22.25, 0, 44.69, 180],
  ];

  const KR = [
    [0, 25.23, -27.43, -90],
    [0.25, 24.47, -27.43, -90],
    [0.5, 23.7, -27.43, -90],
    [0.75, 22.9, -27.43, -90],
    [1, 22.08, -27.43, -90],
    [1.25, 21.25, -27.43, -90],
    [1.5, 20.4, -27.43, -90],
    [1.75, 19.52, -27.42, -90],
    [2, 18.63, -27.39, -90.3],
    [2.25, 17.73, -27.32, -90.8],
    [2.5, 16.82, -27.21, -91.6],
    [2.75, 15.89, -27.06, -92.6],
    [3, 14.96, -26.88, -94],
    [3.25, 14.03, -26.65, -95.6],
    [3.5, 13.11, -26.39, -97.5],
    [3.75, 12.19, -26.08, -99.8],
    [4, 11.28, -25.74, -102.5],
    [4.25, 10.38, -25.35, -105.6],
    [4.5, 9.51, -24.93, -109],
    [4.75, 8.66, -24.47, -112.9],
    [5, 7.85, -23.98, -117.2],
    [5.25, 7.06, -23.45, -122],
    [5.5, 6.32, -22.9, -127.3],
    [5.75, 5.62, -22.31, -132.9],
    [6, 4.97, -21.64, -138.5],
    [6.25, 4.37, -20.9, -144.3],
    [6.5, 3.79, -20.09, -149.7],
    [6.75, 3.22, -19.21, -154.8],
    [7, 2.68, -18.26, -159.5],
    [7.25, 2.16, -17.23, -163.8],
    [7.5, 1.69, -16.13, -167.5],
    [7.75, 1.25, -14.97, -170.9],
    [8, 0.87, -13.75, -173.7],
    [8.25, 0.55, -12.47, -176],
    [8.5, 0.3, -11.14, -177.9],
    [8.75, 0.12, -9.77, -179.1],
    [9, 0.02, -8.36, -179.8],
    [9.25, 0, -6.93, 180],
    [9.5, 0, -5.48, 180],
    [9.75, 0, -4, 180],
    [10, 0, -2.51, 180],
    [10.25, 0, -1, 180],
    [10.5, 0, 0.52, 180],
    [10.75, 0, 2.03, 180],
    [11, 0, 3.5, 180],
    [11.25, 0, 4.94, 180],
    [11.5, 0, 6.34, 180],
    [11.75, 0, 7.71, 180],
    [12, 0, 9.04, 180],
    [12.25, 0, 10.34, 180],
    [12.5, 0, 11.6, 180],
    [12.75, 0, 12.83, 180],
    [13, 0, 14.03, 180],
    [13.25, 0, 15.19, 180],
    [13.5, 0, 16.32, 180],
    [13.75, 0, 17.41, 180],
    [14, 0, 18.47, 180],
    [14.25, 0, 19.49, 180],
    [14.5, 0, 20.48, 180],
    [14.75, 0, 21.44, 180],
    [15, 0, 22.36, 180],
    [15.25, 0, 23.25, 180],
    [15.5, 0, 24.1, 180],
    [15.75, 0, 24.92, 180],
    [16, 0, 25.7, 180],
    [16.25, 0, 26.45, 180],
    [16.5, 0, 27.17, 180],
    [16.75, 0, 27.85, 180],
    [17, 0, 28.49, 180],
    [17.25, 0, 29.1, 180],
    [17.5, 0, 29.68, 180],
    [17.75, 0, 30.22, 180],
    [18, 0, 30.73, 180],
    [18.25, 0, 31.21, 180],
    [18.5, 0, 31.65, 180],
    [18.75, 0, 32.05, 180],
    [19, 0, 32.42, 180],
    [19.25, 0, 32.76, 180],
    [19.5, 0, 33.06, 180],
    [19.75, 0, 33.33, 180],
    [20, 0, 33.56, 180],
    [20.25, 0, 33.76, 180],
    [20.5, 0, 33.93, 180],
    [20.75, 0, 34.06, 180],
    [21, 0, 34.15, 180],
    [21.25, 0, 34.22, 180],
    [21.5, 0, 34.24, 180],
    [21.75, 0, 34.24, 180],
    [22, 0, 34.24, 180],
    [22.25, 0, 34.24, 180],
  ];

  function sample(K, t) {
    if (t <= K[0][0]) return K[0];
    const last = K[K.length - 1];
    if (t >= last[0]) return last;
    let i = 0;
    while (K[i + 1][0] < t) i++;
    const a = K[i];
    const b = K[i + 1];
    const u = (t - a[0]) / (b[0] - a[0]);
    let dh = b[3] - a[3];
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    return [t, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + dh * u];
  }

  function place(node, K, t) {
    const s = sample(K, t);
    node.position.set(s[1], 0, s[2]);
    node.rotation.set(0, -s[3] * D2R, 0);
  }

  const T_IMPACT = 10.43;
  const duration = 22.4;

  function setTime(t) {
    t = Math.min(Math.max(t, 0), duration);
    place(A, KA, t);
    place(TT, KT, t);
    place(TR, KR, t);
    root.updateMatrixWorld(true);
  }

  // =========================================================================
  // 10. WITNESSES, FACTS & WORLD RETURN (IDENTICAL TO V2)
  // =========================================================================
  const witnesses = [
    {
      id: 'wit_A',
      name: 'Witness A (fictional)',
      position: [357.2, 0, -34.75],
      eyeHeight: 1.5,
      lookAt: 'veh_A',
      observationTime: 2,
      claim:
        'Saw the car come over the hill and approach before the truck began its turn; once the truck pulled across, the trailer blocked my view of the car.',
      citation:
        'Witness A statement (fictional), modeled on NTSB/HAR-17/02 p.1-2, p.29-30 witness account',
    },
    {
      id: 'wit_B',
      name: 'Witness B (fictional)',
      position: [7.5, 0, 6.5],
      eyeHeight: 1.6,
      lookAt: 'veh_A',
      observationTime: 9.9,
      claim:
        'I had a clear view of the car the whole way in. I watched it right up until the moment it hit. Nothing was in the way.',
      citation:
        "Deposition of Witness B (fictional), claim at 27:46 (repeated shortly after); position marked on Exhibit 4 at 27:04 while saying only 'I was over by the corner, near the shelter'",
    },
    {
      id: 'wit_C',
      name: 'Witness C (fictional)',
      position: [-18, 0, -40.5],
      eyeHeight: 1.6,
      lookAt: 'veh_T_tractor',
      observationTime: 5,
      claim:
        'The truck was barely creeping when it started across; I never heard brakes before the bang.',
      citation:
        'Witness C statement (fictional); consistent with NTSB/HAR-17/02 p.1-2 and p.5',
    },
  ];

  const facts = [
    {
      id: 'f_impact_t',
      text: 'Impact at t=10.43 s on the event clock (car crests the hill at t=0)',
      value: 10.43,
      unit: 's',
      citation: 'inferred: NTSB/HAR-17/02 p.22, p.29 (derived from 74 mph over 345 m)',
      kind: 'time',
    },
    {
      id: 'f_speed',
      text: 'Car speed just before impact 74 mph (cruise set 4:34:21)',
      value: 74,
      unit: 'mph',
      citation: 'NTSB/HAR-17/02 p.2, p.15',
      kind: 'speed',
    },
    {
      id: 'f_limit',
      text: 'Posted limit 65 mph',
      value: 65,
      unit: 'mph',
      citation: 'NTSB/HAR-17/02 p.23',
      kind: 'speed',
    },
    {
      id: 'f_crest',
      text: 'Vertical crest 1,132 ft (345 m) west of intersection',
      value: 345,
      unit: 'm',
      citation: 'NTSB/HAR-17/02 p.22',
      kind: 'distance',
    },
    {
      id: 'f_sight',
      text: 'Up to 10.4 s mutual sight time at 74 mph',
      value: 10.4,
      unit: 's',
      citation: 'NTSB/HAR-17/02 p.29',
      kind: 'time',
    },
    {
      id: 'f_nomarks',
      text: 'No pre-collision tire marks from either vehicle; no braking',
      value: 0,
      unit: 'm',
      citation: 'NTSB/HAR-17/02 p.5, p.15',
      kind: 'skid',
    },
    {
      id: 'f_post',
      text: 'Car traveled ~910 ft after striking the trailer',
      value: 277.4,
      unit: 'm',
      citation: 'NTSB/HAR-17/02 p.1',
      kind: 'distance',
    },
    {
      id: 'f_imp_off',
      text: 'Impact centered 45 ft 5 in behind tractor front',
      value: 13.84,
      unit: 'm',
      citation: 'NTSB/HAR-17/02 p.6 fn.6',
      kind: 'position',
    },
    {
      id: 'f_time',
      text: 'Impact at 4:36:12.7 p.m. EDT, daylight, clear, dry',
      value: 16.6,
      unit: 'h',
      citation: 'NTSB/HAR-17/02 p.1, p.5, p.15',
      kind: 'time',
    },
  ];

  const skids = [];

  const world = {
    meta: {
      caseId: 'HWY16FH018',
      title:
        'Car into turning tractor-semitrailer at an uncontrolled median crossover, US-27A near Williston, Florida (2016)',
      timeOfDay: '16:36',
      lighting: 'day',
      source: 'NTSB/HAR-17/02 (HWY16FH018) physical facts + fictional witnesses',
      impactT: T_IMPACT,
      date: '2016-05-07',
      utcOffset: '-04:00',
      lat: 29.4106,
      lon: -82.5393,
      sun: { azimuthDeg: 265.0, elevationDeg: 45.1 },
    },
    root,
    duration,
    setTime,
    objects,
    witnesses,
    facts,
    skids,
  };

  setTime(0);
  return world;
}
