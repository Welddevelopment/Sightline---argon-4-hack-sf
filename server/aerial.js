// Sightline AERIAL slice: georeferenced aerial photo of the real crash site, in the case's world frame.
// Mounted from server/server.js via mountAerial(app, ctx). Also a CLI:
//   node server/aerial.js plan  <caseId> [--lat --lon --width 800 --height 400 --res 0.3]  -> writes bounds.json + prints download URLs
//   node server/aerial.js fetch <caseId> [--source usgs_export|naip_export|usgs_tiles] [--zoom 19] [same geo flags]
//   node server/aerial.js probe                                                           -> HTTP status of every source host
//
// Layout (first match wins):
//   cases/<id>/exhibits/aerial/aerial.jpg + bounds.json   (written by `plan`/`fetch`, or by hand)
//   cases/<id>/exhibits/aerial.jpg + aerial.json          (user-supplied; aerial.json = bounds JSON, same schema)
//   cases/<id>/exhibits/aerial.jpg + aerial.jgw [+ aerial.json {"crs": "EPSG:3857"|"EPSG:4326"|"EPSG:26917"|"EPSG:32617"...}]
//
// World frame (case.json coordinate_frame_note): meters, Y up, +X = east, -Z = north, origin = initial point of impact.
// boundsMeters are local east/north offsets from `origin` (x = east, z = -north) of the image's edges, BEFORE calibration.
// calibration {rotationDeg, offsetX, offsetZ}: world = rotY(rotationDeg) * local + offset (THREE rotation.y sense, CCW seen
// from above). Use it when the world idealizes the road as due east-west: rotationDeg = (real compass bearing of the
// eastbound road) - 90.
// Only public-domain sources are wired (USGS The National Map, USDA NAIP). Esri/Google/Bing imagery is NOT permitted
// (licence forbids caching / offline use without an agreement), so it is deliberately absent.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------- sources (public domain only)
export const SOURCES = {
  usgs_export: {
    label: 'USGS The National Map - USGSImageryOnly (MapServer export)',
    host: 'basemap.nationalmap.gov',
    attribution: 'USGS The National Map',
    license: 'Public domain (U.S. Government work). Credit requested: "USGS The National Map".',
    terms: 'https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map',
    // bbox in EPSG:3857 meters; image pixels are linear in Web Mercator
    url: (b, w, h) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export?bbox=${b.join(',')}&bboxSR=3857&imageSR=3857&size=${w},${h}&format=jpg&transparent=false&f=image`,
  },
  naip_export: {
    label: 'USDA NAIP via USGS The National Map (ImageServer exportImage)',
    host: 'imagery.nationalmap.gov',
    attribution: 'USGS The National Map', credit: 'USGS The National Map: USGSNAIPImagery (USDA Farm Service Agency NAIP)',
    license: 'Public domain (USDA FSA NAIP / USGS).',
    terms: 'https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map',
    url: (b, w, h) => `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox=${b.join(',')}&bboxSR=3857&imageSR=3857&size=${w},${h}&format=jpgpng&interpolation=RSP_BilinearInterpolation&f=image`,
  },
  usgs_tiles: {
    label: 'USGS The National Map - USGSImageryOnly (XYZ tile cache)',
    host: 'basemap.nationalmap.gov',
    attribution: 'USGS The National Map',
    license: 'Public domain (U.S. Government work). Credit requested: "USGS The National Map".',
    terms: 'https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map',
    template: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
  },
};
// Every host a full fetch may touch (for an egress allow-list).
export const ALLOWLIST_HOSTS = ['basemap.nationalmap.gov', 'imagery.nationalmap.gov'];
export const OPTIONAL_HOSTS = ['gis.apfo.usda.gov', 'naip-analytic.s3.amazonaws.com', 'planetarycomputer.microsoft.com'];

// Demo default: US-27A at NE 140th Court, Williston FL (approximate; refine with calibration.offsetX/Z after viewing).
export const SITE_DEFAULTS = {
  // measured on NAIP (EB outside-lane centre at the NE 140th Ct centreline); the brief's approx. site point was 29.4106, -82.5393
  demo: { lat: 29.4105889, lon: -82.5397747, note: 'US-27A at NE 140th Court, Williston FL: initial point of impact, measured on NAIP imagery' },
};

// ---------------------------------------------------------------- geodesy
const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F);
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
/** Local tangent-plane metres per degree at latitude (WGS84). */
export function metersPerDegree(lat) {
  const s = Math.sin(lat * D2R), w = 1 - E2 * s * s;
  const M = A * (1 - E2) / Math.pow(w, 1.5), N = A / Math.sqrt(w);
  return { north: M * D2R, east: N * Math.cos(lat * D2R) * D2R };
}
/** lat/lon -> world-frame local metres {x: east, z: -north} relative to origin. Accurate to <5 cm over 1 km. */
export function latLonToLocal(lat, lon, origin) {
  const m = metersPerDegree(origin.lat);
  return { x: (lon - origin.lon) * m.east, z: -(lat - origin.lat) * m.north };
}
export function localToLatLon(x, z, origin) {
  const m = metersPerDegree(origin.lat);
  return { lat: origin.lat - z / m.north, lon: origin.lon + x / m.east };
}
// Web Mercator (EPSG:3857)
export const merc = {
  fromLatLon: (lat, lon) => [A * lon * D2R, A * Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2))],
  toLatLon: (x, y) => ({ lon: x / A * R2D, lat: (2 * Math.atan(Math.exp(y / A)) - Math.PI / 2) * R2D }),
};
// UTM inverse (northern hemisphere zones for EPSG:269xx / 326xx), Snyder / USGS PP 1395.
export function utmToLatLon(E, Nn, zone) {
  const k0 = 0.9996, ep2 = E2 / (1 - E2), x = E - 500000, y = Nn;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * D2R;
  const M = y / k0, mu = M / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
  const N1 = A / Math.sqrt(1 - E2 * s * s), T1 = t * t, C1 = ep2 * c * c, R1 = A * (1 - E2) / Math.pow(1 - E2 * s * s, 1.5);
  const D = x / (N1 * k0);
  const lat = p1 - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return { lat: lat * R2D, lon: lon * R2D };
}
function crsToLatLon(crs, X, Y) {
  const c = String(crs || 'EPSG:3857').toUpperCase();
  if (c === 'EPSG:3857' || c === 'EPSG:900913') return merc.toLatLon(X, Y);
  if (c === 'EPSG:4326' || c === 'CRS:84') return { lat: Y, lon: X };
  const m = c.match(/^EPSG:(269|326)(\d\d)$/);
  if (m) return utmToLatLon(X, Y, Number(m[2]));
  throw new Error(`unsupported crs ${crs} (use EPSG:3857, EPSG:4326, EPSG:269zz or EPSG:326zz)`);
}

// Tile maths (XYZ / Google scheme, 256 px)
const worldPx = (z, ts = 256) => ts * 2 ** z;
const lonToPx = (lon, z, ts) => (lon + 180) / 360 * worldPx(z, ts);
const latToPx = (lat, z, ts) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2)) / Math.PI) / 2 * worldPx(z, ts);
const pxToLon = (px, z, ts) => px / worldPx(z, ts) * 360 - 180;
const pxToLat = (py, z, ts) => Math.atan(Math.sinh(Math.PI * (1 - 2 * py / worldPx(z, ts)))) * R2D;

// ---------------------------------------------------------------- planning
/**
 * Plan an aerial frame: a Web-Mercator bbox of widthM x heightM ground metres centred on (lat, lon) [+ centerOffset in local m],
 * returning the export URLs and the bounds.json describing the image those URLs return.
 */
export function planAerial({ origin, widthM = 800, heightM = 400, resM = 0.3, center = [0, 0], source = 'usgs_export', maxPx = 4000 }) {
  const c = localToLatLon(center[0], center[1], origin);
  const k = 1 / Math.cos(c.lat * D2R);                      // mercator metres per ground metre
  const [cx, cy] = merc.fromLatLon(c.lat, c.lon);
  let w = Math.round(widthM / resM), h = Math.round(heightM / resM);
  const s = Math.min(1, maxPx / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
  const bbox = [cx - widthM * k / 2, cy - heightM * k / 2, cx + widthM * k / 2, cy + heightM * k / 2].map((v) => +v.toFixed(3));
  const sw = merc.toLatLon(bbox[0], bbox[1]), ne = merc.toLatLon(bbox[2], bbox[3]);
  const boundsLatLon = { north: ne.lat, south: sw.lat, west: sw.lon, east: ne.lon };
  const src = SOURCES[source] || SOURCES.usgs_export;
  return {
    bounds: makeBounds({ origin, boundsLatLon, widthPx: w, heightPx: h, source: { id: source in SOURCES ? source : 'usgs_export', label: src.label, bbox3857: bbox, requestUrl: src.url ? src.url(bbox, w, h) : null }, attribution: src.attribution, license: src.license, terms: src.terms }),
    urls: Object.fromEntries(Object.entries(SOURCES).filter(([, v]) => v.url).map(([id, v]) => [id, v.url(bbox, w, h)])),
    bbox3857: bbox, widthPx: w, heightPx: h,
  };
}

function makeBounds({ origin, boundsLatLon: b, widthPx, heightPx, source, attribution, license, terms, calibration }) {
  const nw = latLonToLocal(b.north, b.west, origin), se = latLonToLocal(b.south, b.east, origin);
  const boundsMeters = { minX: +nw.x.toFixed(3), maxX: +se.x.toFixed(3), minZ: +nw.z.toFixed(3), maxZ: +se.z.toFixed(3) };
  return {
    version: 1,
    image: 'aerial.jpg',
    widthPx, heightPx,
    frame: 'world metres, Y up, +X = east, -Z = north (image top = north), origin = world origin (initial point of impact)',
    origin: { lat: origin.lat, lon: origin.lon, note: origin.note || '' },
    boundsMeters,
    metersPerPixel: widthPx ? +((boundsMeters.maxX - boundsMeters.minX) / widthPx).toFixed(4) : null,
    boundsLatLon: b,
    calibration: calibration || { rotationDeg: 0, offsetX: 0, offsetZ: 0, note: 'world = rotY(rotationDeg) * local + offset. 0/0/0 = north is -Z exactly. Set rotationDeg = (real eastbound road bearing) - 90 if the world idealizes the road as due east-west.' },
    attribution,
    license, terms,
    source,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- resolve what a case has
const readJson = (f, fb = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const validId = (id) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id || ''));

export function caseOrigin(ROOT, caseId) {
  const c = readJson(path.join(ROOT, 'cases', caseId, 'case.json'), {}) || {};
  const g = c.geo || c.site || {};
  const o = g.origin || g;
  if (Number.isFinite(o.lat) && Number.isFinite(o.lon)) return { lat: o.lat, lon: o.lon, note: o.note || 'case.json geo.origin' };
  const legacy = caseId === 'demo' ? readJson(path.join(ROOT, 'case', 'case.json'), {}) : {};
  const lg = legacy?.geo?.origin;
  if (lg && Number.isFinite(lg.lat)) return { lat: lg.lat, lon: lg.lon, note: 'case/case.json geo.origin' };
  return SITE_DEFAULTS[caseId] ? { ...SITE_DEFAULTS[caseId] } : null;
}

function parseWorldFile(file) {
  const v = fs.readFileSync(file, 'utf8').trim().split(/\s+/).map(Number);
  if (v.length < 6 || v.some((n) => !Number.isFinite(n))) throw new Error(`bad world file ${path.basename(file)}`);
  const [Aa, D, B, E, C, Ff] = v; return { A: Aa, D, B, E, C, F: Ff };
}
function imageSize(file) {
  // JPEG / PNG header parse (no deps)
  const b = fs.readFileSync(file);
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

/** Find a case's aerial; returns {available, dir, imagePath, bounds, ...} (bounds normalised to the schema above). */
export function resolveAerial(ROOT, caseId) {
  const base = path.join(ROOT, 'cases', caseId, 'exhibits');
  const origin = caseOrigin(ROOT, caseId);
  const out = { caseId, available: false, origin };
  // 1) exhibits/aerial/{aerial.jpg,bounds.json}
  const d1 = path.join(base, 'aerial');
  const b1 = readJson(path.join(d1, 'bounds.json'));
  if (b1) {
    const img = path.join(d1, b1.image || 'aerial.jpg');
    out.bounds = b1; out.dir = d1; out.relDir = 'exhibits/aerial';
    if (fs.existsSync(img)) { out.available = true; out.imagePath = img; out.imageRel = `exhibits/aerial/${b1.image || 'aerial.jpg'}`; return out; }
    out.reason = `bounds.json present but ${path.relative(ROOT, img)} is missing (download it from bounds.source.requestUrl)`;
  }
  // 2) exhibits/aerial.{jpg,png} + aerial.json and/or aerial.jgw/.pgw/.wld
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const img = path.join(base, `aerial.${ext}`);
    if (!fs.existsSync(img)) continue;
    const meta = readJson(path.join(base, 'aerial.json'), {}) || {};
    const wf = ['jgw', 'pgw', 'wld', 'jpgw'].map((e) => path.join(base, `aerial.${e}`)).find((f) => fs.existsSync(f));
    const size = imageSize(img) || { w: meta.widthPx, h: meta.heightPx };
    const o = meta.origin && Number.isFinite(meta.origin.lat) ? meta.origin : origin;
    try {
      if (meta.boundsMeters) {
        out.bounds = { ...meta, image: `aerial.${ext}`, widthPx: size.w, heightPx: size.h };
      } else if (meta.boundsLatLon || wf) {
        if (!o) throw new Error('no origin: add {"origin":{"lat":..,"lon":..}} to aerial.json or geo.origin to case.json');
        let bl = meta.boundsLatLon, gridRot = 0;
        if (!bl) {
          const g = parseWorldFile(wf);
          const corner = (px, py) => crsToLatLon(meta.crs, g.A * px + g.B * py + g.C - (g.A + g.B) / 2, g.D * px + g.E * py + g.F - (g.D + g.E) / 2);
          const ul = corner(0, 0), ur = corner(size.w, 0), lr = corner(size.w, size.h), ll = corner(0, size.h);
          bl = { north: (ul.lat + ur.lat) / 2, south: (ll.lat + lr.lat) / 2, west: (ul.lon + ll.lon) / 2, east: (ur.lon + lr.lon) / 2 };
          // grid convergence / rotated world files: angle of the image's top edge vs local east
          const a = latLonToLocal(ul.lat, ul.lon, o), b = latLonToLocal(ur.lat, ur.lon, o);
          gridRot = Math.atan2(-(b.z - a.z), b.x - a.x) * R2D;
        }
        const cal = { rotationDeg: 0, offsetX: 0, offsetZ: 0, ...(meta.calibration || {}) };
        cal.rotationDeg = +(cal.rotationDeg + gridRot).toFixed(4);
        out.bounds = { ...makeBounds({ origin: o, boundsLatLon: bl, widthPx: size.w, heightPx: size.h, source: meta.source || { id: 'user', worldFile: wf ? path.basename(wf) : null, crs: meta.crs || null }, attribution: meta.attribution || 'user-supplied aerial (state the source on the exhibit)', license: meta.license || null, terms: meta.terms || null, calibration: cal }), image: `aerial.${ext}` };
      } else {
        out.reason = `aerial.${ext} found but no aerial.json (boundsMeters or boundsLatLon) or world file (aerial.jgw)`;
        continue;
      }
      out.available = true; out.dir = base; out.relDir = 'exhibits'; out.imagePath = img; out.imageRel = `exhibits/aerial.${ext}`;
      return out;
    } catch (e) { out.reason = e.message; }
  }
  if (!out.reason) out.reason = 'no aerial for this case';
  return out;
}

function publicMeta(r) {
  const res = { caseId: r.caseId, available: r.available, origin: r.origin || null };
  if (r.bounds) Object.assign(res, {
    url: r.available ? `/cases/${r.caseId}/${r.imageRel}` : null,
    boundsMeters: r.bounds.boundsMeters, boundsLatLon: r.bounds.boundsLatLon || null,
    calibration: r.bounds.calibration || { rotationDeg: 0, offsetX: 0, offsetZ: 0 },
    widthPx: r.bounds.widthPx, heightPx: r.bounds.heightPx, metersPerPixel: r.bounds.metersPerPixel ?? null,
    attribution: r.bounds.attribution || null, license: r.bounds.license || null, source: r.bounds.source || null,
  });
  if (!r.available) Object.assign(res, {
    reason: r.reason,
    allowlistHosts: ALLOWLIST_HOSTS,
    howTo: 'Either allow-list the hosts and POST /api/cases/:id/aerial/fetch (or `node server/aerial.js fetch <id>`), or save the image at bounds.source.requestUrl as exhibits/aerial/aerial.jpg, or drop exhibits/aerial.jpg + aerial.json/aerial.jgw. See status/aerial.md.',
  });
  return res;
}

// ---------------------------------------------------------------- fetching (curl honours the egress proxy + CA bundle)
const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 64 << 20, timeout: opts.timeout || 120000, ...opts }, (err, stdout, stderr) => {
    if (err) { err.stderr = String(stderr || ''); err.stdout = String(stdout || ''); reject(err); } else resolve({ stdout: String(stdout), stderr: String(stderr) });
  });
});
async function curlTo(url, file, timeoutS = 40) {
  const { stdout } = await run('curl', ['-sS', '-L', '-m', String(timeoutS), '-o', file, '-w', '%{http_code} %{http_connect} %{content_type}', url], { timeout: (timeoutS + 5) * 1000 }).catch((e) => ({ stdout: e.stdout || '000 000 ' + (e.stderr || '').trim() }));
  const [code, connect, ...ct] = stdout.trim().split(' ');
  return { code: Number(code) || 0, connect: Number(connect) || 0, contentType: ct.join(' ') };
}

/** HTTP status of each source host (CONNECT code from the proxy + final HTTP code). */
export async function probeSources() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aerial-probe-'));
  const targets = [
    ['usgs_tiles', 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/19/217296/141937'],
    ['usgs_export', 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer?f=json'],
    ['naip_export', 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer?f=json'],
    ['usda_apfo_naip', 'https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer?f=json'],
    ['naip_s3', 'https://naip-analytic.s3.amazonaws.com/'],
    ['planetary_computer_naip', 'https://planetarycomputer.microsoft.com/api/stac/v1/collections/naip'],
  ];
  const out = [];
  for (const [id, url] of targets) out.push({ id, host: new URL(url).host, url, ...(await curlTo(url, path.join(tmp, id), 15)) });
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

function isImage(file) {
  try { const b = fs.readFileSync(file); return b.length > 200 && ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50)); } catch { return false; }
}

/** Fetch + (for tiles) stitch the aerial for a case. Writes cases/<id>/exhibits/aerial/{aerial.jpg,bounds.json}. */
export async function fetchAerial({ ROOT = DEFAULT_ROOT, caseId, origin, widthM = 800, heightM = 400, resM = 0.3, zoom = 19, source = 'auto', center = [0, 0], tileTemplate = null, log = () => {} }) {
  origin = origin || caseOrigin(ROOT, caseId);
  if (!origin) throw new Error(`no origin for case ${caseId}: add geo.origin {lat, lon} to cases/${caseId}/case.json`);
  const outDir = path.join(ROOT, 'cases', caseId, 'exhibits', 'aerial');
  fs.mkdirSync(outDir, { recursive: true });
  const order = source === 'auto' ? ['naip_export', 'usgs_export', 'usgs_tiles'] : [source];   // NAIP export is the sharpest here; the USGS tile cache stops at z16 at this site
  const errors = [];
  for (const sid of order) {
    try {
      const bounds = sid === 'usgs_tiles' || tileTemplate
        ? await fetchTiles({ origin, widthM, heightM, zoom, center, outFile: path.join(outDir, 'aerial.jpg'), template: tileTemplate || SOURCES.usgs_tiles.template, log })
        : await fetchExport({ sid, origin, widthM, heightM, resM, center, outFile: path.join(outDir, 'aerial.jpg'), log });
      const prev = readJson(path.join(outDir, 'bounds.json'));
      if (prev?.calibration) bounds.calibration = prev.calibration;       // keep a hand-tuned calibration across re-fetches
      fs.writeFileSync(path.join(outDir, 'bounds.json'), JSON.stringify(bounds, null, 2));
      return bounds;
    } catch (e) { errors.push(`${sid}: ${e.message}`); log(`[aerial] ${sid} failed: ${e.message}`); }
  }
  const err = new Error(`all aerial sources failed: ${errors.join(' | ')}`);
  err.allowlistHosts = ALLOWLIST_HOSTS;
  throw err;
}

async function fetchExport({ sid, origin, widthM, heightM, resM, center, outFile, log }) {
  const plan = planAerial({ origin, widthM, heightM, resM, center, source: sid });
  const url = plan.urls[sid];
  const tmp = outFile + '.part';
  log(`[aerial] ${sid}: ${plan.widthPx}x${plan.heightPx} px <- ${new URL(url).host}`);
  const r = await curlTo(url, tmp, 120);
  if (r.code !== 200 || !isImage(tmp)) { fs.rmSync(tmp, { force: true }); throw new Error(`HTTP ${r.code} (proxy CONNECT ${r.connect}) ${r.contentType}`); }
  await run('convert', [tmp, '-strip', '-quality', '88', outFile]);   // normalise (jpgpng may come back as PNG)
  fs.rmSync(tmp, { force: true });
  return plan.bounds;
}

async function fetchTiles({ origin, widthM, heightM, zoom, center, outFile, template, log, ts = 256, concurrency = 8 }) {
  const c = localToLatLon(center[0], center[1], origin);
  const k = 1 / Math.cos(c.lat * D2R);
  const mpp = 2 * Math.PI * A / worldPx(zoom, ts);            // mercator metres per pixel
  const cpx = lonToPx(c.lon, zoom, ts), cpy = latToPx(c.lat, zoom, ts);
  const W = Math.round(widthM * k / mpp), H = Math.round(heightM * k / mpp);
  const px0 = Math.round(cpx - W / 2), py0 = Math.round(cpy - H / 2);
  const tx0 = Math.floor(px0 / ts), ty0 = Math.floor(py0 / ts), tx1 = Math.floor((px0 + W - 1) / ts), ty1 = Math.floor((py0 + H - 1) / ts);
  const nTiles = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
  if (nTiles > 900) throw new Error(`${nTiles} tiles at z${zoom} is too many; lower --zoom`);
  log(`[aerial] tiles z${zoom}: ${tx1 - tx0 + 1}x${ty1 - ty0 + 1} = ${nTiles} -> ${W}x${H} px`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aerial-tiles-'));
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push({ tx, ty, file: path.join(tmp, `${ty}_${tx}`) });
  let missing = 0, firstErr = null, i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < jobs.length) {
      const j = jobs[i++];
      const url = template.replace('{z}', zoom).replace('{x}', j.tx).replace('{y}', j.ty);
      const r = await curlTo(url, j.file, 30);
      j.ok = (r.code === 200 || (url.startsWith('file:') && r.code === 0)) && isImage(j.file);
      if (!j.ok) { missing++; firstErr ||= `HTTP ${r.code} (proxy CONNECT ${r.connect}) for ${url}`; }
    }
  }));
  if (missing === jobs.length) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error(firstErr); }
  const args = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    args.push('(');
    for (let tx = tx0; tx <= tx1; tx++) {
      const j = jobs.find((q) => q.tx === tx && q.ty === ty);
      if (j.ok) args.push(j.file, '-resize', `${ts}x${ts}!`); else args.push('-size', `${ts}x${ts}`, 'xc:#6b6b6b');
    }
    args.push('+append', ')');
  }
  args.push('-append', '-crop', `${W}x${H}+${px0 - tx0 * ts}+${py0 - ty0 * ts}`, '+repage', '-strip', '-quality', '88', outFile);
  await run('convert', args, { timeout: 300000 });
  fs.rmSync(tmp, { recursive: true, force: true });
  const boundsLatLon = { north: pxToLat(py0, zoom, ts), south: pxToLat(py0 + H, zoom, ts), west: pxToLon(px0, zoom, ts), east: pxToLon(px0 + W, zoom, ts) };
  const s = SOURCES.usgs_tiles;
  return makeBounds({ origin, boundsLatLon, widthPx: W, heightPx: H, attribution: s.attribution, license: s.license, terms: s.terms,
    source: { id: 'usgs_tiles', label: s.label, template, zoom, tiles: nTiles, missingTiles: missing, pixelOrigin: [px0, py0] } });
}

// ---------------------------------------------------------------- HTTP API
/**
 * GET  /api/cases/:id/aerial         -> {available, url, boundsMeters, calibration, origin, attribution, ...} | {available:false, reason, allowlistHosts}
 * GET  /api/aerial/probe             -> reachability of every source host
 * POST /api/cases/:id/aerial/plan    {lat?, lon?, widthM?, heightM?, resM?} -> writes bounds.json, returns download URLs
 * POST /api/cases/:id/aerial/fetch   {lat?, lon?, widthM?, heightM?, resM?, zoom?, source?} -> fetches + writes image/bounds
 * PATCH /api/cases/:id/aerial/calibration {rotationDeg?, offsetX?, offsetZ?} -> persists the alignment tweak
 * The image itself is served by the existing /cases static mount.
 */
export function mountAerial(app, ctx = {}) {
  const ROOT = ctx.ROOT || DEFAULT_ROOT;
  const errMsg = ctx.errMsg || ((e) => e?.message || String(e));
  const geoArgs = (b, id) => {
    const o = Number.isFinite(+b.lat) && Number.isFinite(+b.lon) && b.lat !== undefined ? { lat: +b.lat, lon: +b.lon, note: 'request body' } : caseOrigin(ROOT, id);
    return { origin: o, widthM: +b.widthM || 800, heightM: +b.heightM || 400, resM: +b.resM || 0.3, zoom: +b.zoom || 19, center: Array.isArray(b.center) ? b.center.map(Number) : [0, 0], source: b.source || 'auto' };
  };
  const guard = (req, res) => { if (!validId(req.params.id)) { res.status(400).json({ error: 'bad case id' }); return false; } return true; };

  app.get('/api/cases/:id/aerial', (req, res) => {
    if (!guard(req, res)) return;
    try { res.json(publicMeta(resolveAerial(ROOT, req.params.id))); } catch (e) { res.status(500).json({ error: errMsg(e) }); }
  });
  app.get('/api/aerial/probe', async (req, res) => {
    try { res.json({ sources: await probeSources(), allowlistHosts: ALLOWLIST_HOSTS }); } catch (e) { res.status(500).json({ error: errMsg(e) }); }
  });
  app.post('/api/cases/:id/aerial/plan', (req, res) => {
    if (!guard(req, res)) return;
    try {
      const g = geoArgs(req.body || {}, req.params.id);
      if (!g.origin) return res.status(400).json({ error: 'no origin; pass lat/lon or set case.json geo.origin' });
      const plan = planAerial({ ...g, source: g.source === 'auto' ? 'usgs_export' : g.source });
      const dir = path.join(ROOT, 'cases', req.params.id, 'exhibits', 'aerial');
      fs.mkdirSync(dir, { recursive: true });
      const prev = readJson(path.join(dir, 'bounds.json'));
      if (prev?.calibration) plan.bounds.calibration = prev.calibration;
      fs.writeFileSync(path.join(dir, 'bounds.json'), JSON.stringify(plan.bounds, null, 2));
      res.json({ ok: true, saveImageAs: `cases/${req.params.id}/exhibits/aerial/aerial.jpg`, urls: plan.urls, bounds: plan.bounds });
    } catch (e) { res.status(500).json({ error: errMsg(e) }); }
  });
  app.post('/api/cases/:id/aerial/fetch', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const bounds = await fetchAerial({ ROOT, caseId: req.params.id, ...geoArgs(req.body || {}, req.params.id), log: (m) => console.log(m) });
      res.json({ ok: true, ...publicMeta(resolveAerial(ROOT, req.params.id)), bounds });
    } catch (e) { res.status(502).json({ error: errMsg(e), allowlistHosts: e.allowlistHosts || ALLOWLIST_HOSTS }); }
  });
  app.patch('/api/cases/:id/aerial/calibration', (req, res) => {   // body parsed by server.js express.json()
    if (!guard(req, res)) return;
    try {
      const r = resolveAerial(ROOT, req.params.id);
      if (!r.bounds || !r.dir) return res.status(404).json({ error: r.reason || 'no aerial' });
      const file = r.relDir === 'exhibits/aerial' ? path.join(r.dir, 'bounds.json') : path.join(r.dir, 'aerial.json');
      const cur = readJson(file, {}) || {};
      const b = req.body || {};
      const cal = { rotationDeg: 0, offsetX: 0, offsetZ: 0, ...(cur.calibration || {}) };
      for (const k of ['rotationDeg', 'offsetX', 'offsetZ']) if (Number.isFinite(+b[k]) && b[k] !== null && b[k] !== '') cal[k] = +b[k];
      cur.calibration = cal;
      fs.writeFileSync(file, JSON.stringify(cur, null, 2));
      res.json({ ok: true, calibration: cal });
    } catch (e) { res.status(500).json({ error: errMsg(e) }); }
  });
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [cmd, caseId = 'demo', ...rest] = process.argv.slice(2);
  const a = {}; for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) a[rest[i].slice(2)] = rest[++i];
  const origin = a.lat && a.lon ? { lat: +a.lat, lon: +a.lon, note: 'CLI' } : caseOrigin(DEFAULT_ROOT, caseId);
  const geo = { origin, widthM: +a.width || 800, heightM: +a.height || 400, resM: +a.res || 0.3, zoom: +a.zoom || 19, center: [+a.cx || 0, +a.cz || 0] };
  if (cmd === 'probe') {
    for (const s of await probeSources()) console.log(`${String(s.code).padStart(3, '0')} (CONNECT ${s.connect || '-'}) ${s.id.padEnd(24)} ${s.url}`);
  } else if (cmd === 'plan') {
    const plan = planAerial({ ...geo, source: a.source || 'usgs_export' });
    const dir = path.join(DEFAULT_ROOT, 'cases', caseId, 'exhibits', 'aerial');
    fs.mkdirSync(dir, { recursive: true });
    const prev = readJson(path.join(dir, 'bounds.json'));
    if (prev?.calibration) plan.bounds.calibration = prev.calibration;
    fs.writeFileSync(path.join(dir, 'bounds.json'), JSON.stringify(plan.bounds, null, 2));
    console.log(`wrote ${path.relative(DEFAULT_ROOT, dir)}/bounds.json  (${plan.widthPx}x${plan.heightPx} px, ${JSON.stringify(plan.bounds.boundsMeters)})`);
    console.log(`save one of these as ${path.relative(DEFAULT_ROOT, dir)}/aerial.jpg:`);
    for (const [id, u] of Object.entries(plan.urls)) console.log(`  ${id}: ${u}`);
  } else if (cmd === 'fetch') {
    const b = await fetchAerial({ ROOT: DEFAULT_ROOT, caseId, ...geo, source: a.source || 'auto', tileTemplate: a.template || null, log: console.log });
    console.log(`ok: ${b.widthPx}x${b.heightPx} px, ${JSON.stringify(b.boundsMeters)}, ${b.attribution}`);
  } else {
    console.log('usage: node server/aerial.js probe | plan <caseId> | fetch <caseId> [--lat --lon --width --height --res --zoom --source --template]');
    process.exit(cmd ? 1 : 0);
  }
}
