# VEH-HEAVY status

Files (mine): web/assets/vehicles_heavy.js, web/heavy_preview.html, status/veh_heavy.md

## API (unchanged + additions)
- `createHeavyVehicle(THREE, 'truck_tractor'|'semitrailer'|'box_truck'|'bus', {id, color, variant, contactShadow})`
  variants: semitrailer `box`|`flatbed`, bus `transit`|`school`. Origin ground centre, faces -Z, catalog dims exact
  (Box3.setFromObject still returns the catalog envelope; the shadow/halo quads are shader-expanded and invisible to Box3/raycasts).
- Articulation (documented in the file header): `coupleTrailer(tractor, trailer, a)` exact pose; `followTrailer(tractor, trailer)`
  per-frame kinematic follow (discrete tractrix, forward + reverse); `articulationOf(tractor, trailer)`;
  `tractor.userData.hitch(trailer,a)` / `.follow(trailer)`. a = h_tractor - h_trailer, a > 0 = tractor turned left.
  fifthWheel z = +1.95, kingpin z = -7.19, kingpinToAxles = 13.37 m (steady-state on a 15 m circle verified against
  r_axle = sqrt(r_pivot^2 - L^2)).
- `userData.setLights(on, {beams, glow})`: head/tail + amber/red marker lamps (emissive) + additive glare halos
  (`userData.halos`, glow default true); `setBrake(on)`.
- `userData.contactShadow`: baked soft AO footprint + tyre contact blobs (DataTexture, no DOM), y = 0.006.

## This round
- Materials: chrome / polished aluminium / trailer skin / FRP are MeshPhysicalMaterial (env-map driven, clearcoat on
  aluminium); paint = shared clearcoat paint from vehicle_parts.js.
- Trailer rear: barn doors with 2 lock rods each, cam keepers top+bottom, 3 rod guides, folded handles + retainers,
  4 hinges, gasket seams, door ribs, plate bracket; DOT-C2 tape (sides, rear sill, ICC bar, upper L marks); mudflaps.
- FMVSS-108 side markers: amber front + intermediate, red rear on trailer, tractor, box truck, both buses; box truck cab
  clearance + rear ID lamps.
- Bus: lower skirt no longer passes through the wheels; dark wheel-well liners in every cut arch (bus, school bus, box truck).
- Preview: `?view=reardoor`, `?view=marker`, fixed `closebus`; `&night=1` shows lamps + halos.
