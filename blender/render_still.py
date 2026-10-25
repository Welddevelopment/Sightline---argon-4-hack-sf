"""Sightline hero still: render a GLB exported by render/export_gltf.mjs with Cycles (headless `bpy` module).

Blender only RENDERS the world Argon wrote: geometry and positions come from the GLB unchanged. This script only
swaps materials (paint, glass, rubber, asphalt, grass ...), adds a physical sky + sun lamp along the world's sun
direction, a far ground plane beyond the modeled area (below y=0, hidden by the world's own ground), and renders.

usage:
  nice -n 10 python3 blender/render_still.py --glb blender/out/world_v2_t9.9.glb --camera wit_B \
      --out blender/out/world_v2_t9.9_wit_B.png [--samples 48] [--res 1280x720] [--threads 2] [--blend]
Camera ids come from the sidecar <glb>.json (wit_*, oblique, overhead). Run ONE Blender process at a time.
"""
import argparse
import json
import math
import os
import sys
import time

import bpy
from mathutils import Vector

ap = argparse.ArgumentParser()
ap.add_argument('--glb', required=True)
ap.add_argument('--camera', default='oblique')
ap.add_argument('--out', required=True)
ap.add_argument('--samples', type=int, default=48)
ap.add_argument('--res', default='1280x720')
ap.add_argument('--threads', type=int, default=2)
ap.add_argument('--exposure', type=float, default=0.0)
ap.add_argument('--blend', action='store_true', help='also save the .blend next to the PNG')
a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

T0 = time.time()
side_path = os.path.splitext(a.glb)[0] + '.json'
side = json.load(open(side_path)) if os.path.exists(side_path) else {}

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.glb))


def three_to_blender(v):  # three.js (x, y-up, z-south) -> Blender (x, y-north, z-up)
    return Vector((v[0], -v[2], v[1]))


# ---------------------------------------------------------------- materials
def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def lin(c):
    return tuple(((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c)


class NT:
    """Tiny node-tree builder."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.t = mat.node_tree
        self.t.nodes.clear()
        self.out = self.n('ShaderNodeOutputMaterial')
        self.bsdf = self.n('ShaderNodeBsdfPrincipled')
        self.link(self.bsdf.outputs[0], self.out.inputs['Surface'])
        geo = self.n('ShaderNodeNewGeometry')
        self.pos = geo.outputs['Position']  # world-space meters: texture scale is consistent across meshes

    def n(self, kind, **kw):
        node = self.t.nodes.new(kind)
        for k, v in kw.items():
            setattr(node, k, v)
        return node

    def link(self, a_, b_):
        self.t.links.new(a_, b_)

    def set(self, **kw):
        names = {'base': 'Base Color', 'rough': 'Roughness', 'metal': 'Metallic', 'coat': 'Coat Weight',
                 'coat_rough': 'Coat Roughness', 'spec': 'Specular IOR Level', 'ior': 'IOR'}
        for k, v in kw.items():
            inp = self.bsdf.inputs[names[k]]
            inp.default_value = (*v, 1.0) if isinstance(v, tuple) and len(v) == 3 else v

    def noise(self, scale, detail=4.0, rough=0.6, dim='3D'):
        nz = self.n('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = scale
        nz.inputs['Detail'].default_value = detail
        nz.inputs['Roughness'].default_value = rough
        self.link(self.pos, nz.inputs['Vector'])
        return nz.outputs['Fac']

    def ramp(self, fac, c0, c1, p0=0.3, p1=0.7):
        r = self.n('ShaderNodeValToRGB')
        r.color_ramp.elements[0].position, r.color_ramp.elements[0].color = p0, (*c0, 1)
        r.color_ramp.elements[1].position, r.color_ramp.elements[1].color = p1, (*c1, 1)
        self.link(fac, r.inputs['Fac'])
        return r.outputs['Color']

    def mix(self, fac, c0, c1):
        m = self.n('ShaderNodeMix', data_type='RGBA', blend_type='MIX')
        if isinstance(fac, float):
            m.inputs['Factor'].default_value = fac
        else:
            self.link(fac, m.inputs['Factor'])
        for i, c in ((6, c0), (7, c1)):
            if isinstance(c, tuple):
                m.inputs[i].default_value = (*c, 1)
            else:
                self.link(c, m.inputs[i])
        return m.outputs[2]

    def map_range(self, fac, lo, hi):
        m = self.n('ShaderNodeMapRange')
        m.inputs['To Min'].default_value, m.inputs['To Max'].default_value = lo, hi
        self.link(fac, m.inputs['Value'])
        return m.outputs['Result']

    def bump(self, height, strength=0.2, distance=0.02, normal=None):
        b = self.n('ShaderNodeBump')
        b.inputs['Strength'].default_value = strength
        b.inputs['Distance'].default_value = distance
        self.link(height, b.inputs['Height'])
        if normal is not None:
            self.link(normal, b.inputs['Normal'])
        self.link(b.outputs['Normal'], self.bsdf.inputs['Normal'])
        return b.outputs['Normal']

    def bevel(self, radius=0.04, coat=True):
        """Shading-only rounded edges (Cycles Bevel node): geometry is NOT modified."""
        bv = self.n('ShaderNodeBevel', samples=6)
        bv.inputs['Radius'].default_value = radius
        self.link(bv.outputs['Normal'], self.bsdf.inputs['Normal'])
        if coat:
            self.link(bv.outputs['Normal'], self.bsdf.inputs['Coat Normal'])
        return bv.outputs['Normal']


def scale(c, k):
    return tuple(min(1.0, x * k) for x in c)


def m_paint(nt, base, metallic=0.55, rough=0.32):
    nt.set(base=base, metal=metallic, rough=rough, coat=1.0, coat_rough=0.03)
    nt.bevel(0.05)


def m_white_body(nt, base, gloss=True):
    nt.set(base=base, metal=0.0, rough=0.28 if gloss else 0.45, coat=1.0 if gloss else 0.4, coat_rough=0.05)
    dirt = nt.ramp(nt.noise(2.5, 6, 0.65), (1, 1, 1), (0.82, 0.8, 0.76), 0.45, 0.8)
    mult = nt.n('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
    mult.inputs['Factor'].default_value = 1.0
    mult.inputs[6].default_value = (*base, 1)
    nt.link(dirt, mult.inputs[7])
    nt.link(mult.outputs[2], nt.bsdf.inputs['Base Color'])
    nt.bevel(0.06)


def m_glass_tinted(nt):
    # The world's greenhouse is a solid box: read as dark tinted glass (reflective, not transmissive).
    nt.set(base=(0.006, 0.008, 0.011), metal=0.0, rough=0.02, coat=1.0, coat_rough=0.0, spec=1.0, ior=1.52)
    nt.bevel(0.06)


def m_rubber(nt):
    nt.set(base=(0.018, 0.018, 0.019), metal=0.0, rough=0.78, spec=0.3)
    n = nt.bevel(0.08, coat=False)
    nt.bump(nt.noise(60, 2, 0.5), 0.15, 0.005, normal=n)


def m_dark_metal(nt, base):
    nt.set(base=base, metal=0.7, rough=0.5)
    nt.bevel(0.03, coat=False)


def m_asphalt(nt, base):
    big = nt.noise(0.15, 3, 0.5)            # patching / wear, several meters
    fine = nt.noise(80.0, 2, 0.7)           # aggregate, ~1 cm
    base = (max(base[0], 0.07) * 1.02, max(base[1], 0.07), max(base[2], 0.07) * 0.97)  # sun-bleached, warm-neutral grey
    c = nt.ramp(big, scale(base, 0.75), scale(base, 1.25), 0.35, 0.7)
    agg = nt.ramp(fine, (0, 0, 0), (1, 1, 1), 0.4, 0.75)
    m = nt.n('ShaderNodeMix', data_type='RGBA', blend_type='OVERLAY')
    m.inputs['Factor'].default_value = 0.35
    nt.link(c, m.inputs[6]); nt.link(agg, m.inputs[7])
    nt.link(m.outputs[2], nt.bsdf.inputs['Base Color'])
    nt.link(nt.map_range(big, 0.85, 0.97), nt.bsdf.inputs['Roughness'])
    nt.set(spec=0.3)
    nt.bump(fine, 0.35, 0.004)


def m_line_paint(nt, base):
    wear = nt.noise(6.0, 5, 0.7)
    nt.link(nt.ramp(wear, scale(base, 0.7), base, 0.3, 0.65), nt.bsdf.inputs['Base Color'])
    nt.set(rough=0.55, spec=0.5)
    nt.bump(nt.noise(90, 2, 0.6), 0.2, 0.003)


def m_grass(nt, base):
    patches = nt.noise(0.06, 3, 0.55)       # ~15 m mowing / moisture patches
    mid = nt.noise(1.2, 4, 0.65)
    fine = nt.noise(40.0, 3, 0.7)
    dry = (base[0] * 1.6 + 0.02, base[1] * 1.15 + 0.01, base[2] * 0.6)
    c1 = nt.ramp(patches, scale(base, 0.8), dry, 0.35, 0.75)
    c2 = nt.mix(nt.map_range(mid, -0.25, 0.45), c1, scale(base, 0.55))
    m = nt.n('ShaderNodeMix', data_type='RGBA', blend_type='OVERLAY')
    m.inputs['Factor'].default_value = 0.5
    nt.link(c2, m.inputs[6])
    nt.link(nt.ramp(fine, (0.25, 0.25, 0.25), (0.75, 0.75, 0.75), 0.3, 0.7), m.inputs[7])
    nt.link(m.outputs[2], nt.bsdf.inputs['Base Color'])
    nt.set(rough=0.92, spec=0.25)
    nt.bump(fine, 0.6, 0.02)


def m_stucco(nt, base):
    nt.link(nt.ramp(nt.noise(1.5, 6, 0.6), scale(base, 0.85), scale(base, 1.08)), nt.bsdf.inputs['Base Color'])
    nt.set(rough=0.88, spec=0.4)
    n = nt.bevel(0.03, coat=False)
    nt.bump(nt.noise(30, 4, 0.7), 0.15, 0.01, normal=n)


def m_wood(nt, base):
    nt.link(nt.ramp(nt.noise(8, 6, 0.7), scale(base, 0.7), scale(base, 1.1)), nt.bsdf.inputs['Base Color'])
    nt.set(rough=0.75)
    nt.bevel(0.02, coat=False)


def m_dirt(nt, base):
    nt.link(nt.ramp(nt.noise(12, 5, 0.7), scale(base, 0.6), scale(base, 1.1)), nt.bsdf.inputs['Base Color'])
    nt.set(rough=0.95)


def m_plain(nt, base, rough=0.6):
    nt.set(base=base, rough=rough)


def upgrade(mat):
    parts = mat.name.split('|')
    if len(parts) < 4:
        return 'skip'
    oid, mesh, kind, hx = parts[0], parts[1], parts[2], parts[3][:7]
    srgb = hex_rgb(hx)
    base = lin(srgb)
    green = srgb[1] > srgb[0] * 1.05 and srgb[1] > srgb[2] * 1.05
    nt = NT(mat)
    if green and kind in ('road', 'occluder', 'scene') or oid == 'ground':
        m_grass(nt, base); return 'grass'
    if kind == 'vehicle':
        if 'cabin' in mesh:
            m_glass_tinted(nt); return 'glass'
        if hx == '#111111':
            m_rubber(nt); return 'rubber'
        if max(srgb) < 0.4 and abs(srgb[0] - srgb[2]) < 0.02:
            m_dark_metal(nt, base); return 'dark_metal'
        if min(srgb) > 0.8:
            m_white_body(nt, base, gloss=(oid != 'veh_T_trailer')); return 'white_body'
        m_paint(nt, base); return 'car_paint'
    if kind == 'road':
        if hx in ('#f4f4f4', '#f2c200') or min(srgb) > 0.85:
            m_line_paint(nt, base); return 'line_paint'
        m_asphalt(nt, base); return 'asphalt'
    if kind == 'building':
        m_stucco(nt, base); return 'stucco'
    if oid == 'occ_pole' or hx == '#8b6b4a':
        m_wood(nt, base); return 'wood'
    if oid == 'occ_shelter':
        m_dark_metal(nt, base); return 'metal'
    if oid == 'mark_path_A':
        m_dirt(nt, base); return 'dirt'
    m_plain(nt, base); return 'plain'


SKY_PARAMS = {}


def add_haze(mat, dist_k=9000.0):
    """Aerial perspective: blend toward the sky colour seen along the (horizon-clamped) view ray, by view distance."""
    t = mat.node_tree
    out = next(n for n in t.nodes if n.type == 'OUTPUT_MATERIAL')
    if not out.inputs['Surface'].links:
        return
    src = out.inputs['Surface'].links[0].from_socket
    N = t.nodes.new
    cd = N('ShaderNodeCameraData')
    geo = N('ShaderNodeNewGeometry')
    neg = N('ShaderNodeVectorMath'); neg.operation = 'MULTIPLY'; neg.inputs[1].default_value = (-1, -1, 0)
    t.links.new(geo.outputs['Incoming'], neg.inputs[0])
    up = N('ShaderNodeVectorMath'); up.operation = 'ADD'; up.inputs[1].default_value = (0, 0, 0.04)
    t.links.new(neg.outputs[0], up.inputs[0])
    nrm = N('ShaderNodeVectorMath'); nrm.operation = 'NORMALIZE'
    t.links.new(up.outputs[0], nrm.inputs[0])
    sk = N('ShaderNodeTexSky')
    for k, v in SKY_PARAMS.items():
        setattr(sk, k, v)
    t.links.new(nrm.outputs[0], sk.inputs['Vector'])
    em = N('ShaderNodeEmission'); em.inputs['Strength'].default_value = SKY_STRENGTH
    t.links.new(sk.outputs['Color'], em.inputs['Color'])
    f = N('ShaderNodeMath'); f.operation = 'DIVIDE'; f.inputs[1].default_value = -dist_k
    t.links.new(cd.outputs['View Distance'], f.inputs[0])
    ex = N('ShaderNodeMath'); ex.operation = 'EXPONENT'; t.links.new(f.outputs[0], ex.inputs[0])
    one = N('ShaderNodeMath'); one.operation = 'SUBTRACT'; one.inputs[0].default_value = 1.0
    t.links.new(ex.outputs[0], one.inputs[1])
    mx = N('ShaderNodeMixShader')
    t.links.new(one.outputs[0], mx.inputs['Fac'])
    t.links.new(src, mx.inputs[1]); t.links.new(em.outputs[0], mx.inputs[2])
    t.links.new(mx.outputs[0], out.inputs['Surface'])


roles = {}
for mat in list(bpy.data.materials):
    r = upgrade(mat)
    roles[r] = roles.get(r, 0) + 1

# far ground beyond the modeled area (the world's own ground at y=0 covers it inside); avoids the sky's dark "ground" at the horizon
bpy.ops.mesh.primitive_plane_add(size=12000, location=(0, 0, -0.08))
far = bpy.context.active_object
far.name = 'sl_far_ground'
fm = bpy.data.materials.new('sl_far_ground')
m_grass(NT(fm), lin(hex_rgb('#6f7f4f')))
far.data.materials.append(fm)

# ---------------------------------------------------------------- sky + sun
sun_info = side.get('sun', {})
d = three_to_blender(sun_info.get('dirThree', [-0.6, 0.7, 0.3])).normalized()
elev = math.asin(max(-1, min(1, d.z)))
world = bpy.data.worlds.new('sl_sky')
scn.world = world
world.use_nodes = True
wn = world.node_tree.nodes
wn.clear()
sky = wn.new('ShaderNodeTexSky')
for st in ('MULTIPLE_SCATTERING', 'SINGLE_SCATTERING', 'NISHITA'):
    try:
        sky.sky_type = st
        break
    except TypeError:
        pass
sky.sun_disc = False                      # direct sun comes from the lamp below (lower noise at modest samples)
sky.sun_elevation = elev
# Blender sky convention: horizontal sun direction = (sin(rot), cos(rot)), i.e. measured from +Y (north) toward +X (east).
# Verified empirically (camera aimed along that direction sees the sun disc dead centre); keeps sky glow aligned with the lamp.
sky.sun_rotation = math.atan2(d.x, d.y)
for k, v in (('altitude', 30.0), ('air_density', 1.0), ('aerosol_density', 1.3), ('ozone_density', 1.0)):
    if hasattr(sky, k):
        setattr(sky, k, v)
bg = wn.new('ShaderNodeBackground')
SKY_STRENGTH = 0.3
bg.inputs['Strength'].default_value = SKY_STRENGTH
wout = wn.new('ShaderNodeOutputWorld')
world.node_tree.links.new(sky.outputs['Color'], bg.inputs['Color'])
world.node_tree.links.new(bg.outputs['Background'], wout.inputs['Surface'])

sun_data = bpy.data.lights.new('sl_sun', 'SUN')
sun_data.energy = 4.2
sun_data.angle = math.radians(0.53)
sun_data.color = (1.0, 0.96, 0.9)
sun = bpy.data.objects.new('sl_sun', sun_data)
scn.collection.objects.link(sun)
sun.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()   # lamp shines along its -Z, i.e. from d toward the scene

SKY_PARAMS.update({k: getattr(sky, k) for k in ('sky_type', 'sun_disc', 'sun_elevation', 'sun_rotation', 'altitude',
                   'air_density', 'aerosol_density', 'ozone_density') if hasattr(sky, k)})
for mat in bpy.data.materials:
    if mat.use_nodes:
        add_haze(mat)

# ---------------------------------------------------------------- camera
cam = bpy.data.objects.get('cam_' + a.camera) or bpy.data.objects.get(a.camera)
if not cam or cam.type != 'CAMERA':
    cams = [o.name for o in bpy.data.objects if o.type == 'CAMERA']
    sys.exit(f'camera {a.camera!r} not found; have {cams}')
cam.data.sensor_fit = 'VERTICAL'
cam.data.angle_y = math.radians(60)        # same as web/viewer.js PerspectiveCamera(60)
cam.data.clip_start, cam.data.clip_end = 0.05, 6000
scn.camera = cam

# ---------------------------------------------------------------- render settings
W, H = (int(x) for x in a.res.lower().split('x'))
r = scn.render
r.engine = 'CYCLES'
r.resolution_x, r.resolution_y, r.resolution_percentage = W, H, 100
r.threads_mode, r.threads = 'FIXED', a.threads
r.image_settings.file_format = 'PNG'
c = scn.cycles
c.device = 'CPU'
c.samples = a.samples
c.use_adaptive_sampling = True
c.adaptive_threshold = 0.02
c.use_denoising = True
try:
    c.denoiser = 'OPENIMAGEDENOISE'
    c.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
except Exception as e:  # pragma: no cover
    print('denoiser:', e)
c.max_bounces, c.diffuse_bounces, c.glossy_bounces, c.transmission_bounces = 6, 3, 3, 4
c.caustics_reflective = c.caustics_refractive = False
c.blur_glossy = 1.0
c.light_sampling_threshold = 0.01
vs = scn.view_settings
for vt in ('AgX', 'Filmic'):
    try:
        vs.view_transform = vt
        break
    except TypeError:
        pass
for lk in ('AgX - Medium High Contrast', 'AgX - Base Contrast', 'Medium High Contrast', 'None'):
    try:
        vs.look = lk
        break
    except TypeError:
        pass
vs.exposure = a.exposure

os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
r.filepath = os.path.abspath(a.out)
if a.blend:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(os.path.abspath(a.out))[0] + '.blend')
T1 = time.time()
bpy.ops.render.render(write_still=True)
T2 = time.time()
print(json.dumps({'out': a.out, 'camera': a.camera, 'res': [W, H], 'samples': a.samples, 'sky': sky.sky_type,
                  'view': vs.view_transform, 'look': vs.look, 'materials': roles,
                  'sun_elev_deg': round(math.degrees(elev), 1), 'setup_s': round(T1 - T0, 1), 'render_s': round(T2 - T1, 1)}))
