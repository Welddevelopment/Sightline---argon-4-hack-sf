You are a forensic scene modeler preparing a court-grade 3D reconstruction. From the case evidence below (documents, diagram exhibits, and the current world module that a previous pass generated), write a COMPLETE, CITED scene graph of the crash site that a 3D artist could build without guessing.

## Frame (from the world contract)
Meters. Y up, ground y = 0 at the reference point. +X = east, -Z = north (so +Z = south). Origin = the scene's reference point as defined in the evidence/current world (normally the point of impact). Headings are compass degrees (0 = north, 90 = east). Keep the frame and the existing positions of the current world unless the evidence says otherwise; if you move something, say why in its `note`.

## What to cover (everything visible from any camera within ~400 m)
- Roadway cross-section, from the outermost feature on one side to the other: every travel lane, turn lane, shoulder (paved/unpaved), median, curb/edge treatment, side roads, crossovers/intersections, driveways, with lateral offsets (z or x) of every edge and lane line.
- Longitudinal profile: grades, crests, sags (start/end station, % grade, crest location and height above the reference point). Give enough to build a terrain mesh.
- Pavement markings to the exact US MUTCD (2009 edition with revisions) unless evidence says otherwise: for each line give color, pattern (solid/broken/dotted, segment and gap length), width, MUTCD section, and placement. Include stop lines, turn arrows, lane-line extensions, edge lines, median-side edge lines. Include signs (MUTCD code e.g. R1-1, size, mounting height, offset, facing).
- Roadside: buildings (footprint, height, roof, facade/material, signage text if in evidence), canopies, shelters, benches, utility poles (spacing, height, crossarms, which one was struck), wires, fences (type, height, run), drainage (ditches, culverts), mailboxes, driveways, trees and vegetation (species type if known, height, spacing, density), parked items.
- Ground cover: grass, dirt, gravel zones with extents.
- Vehicles: each involved vehicle as a GENERIC model (no brand or model names): type, overall L×W×H, wheelbase, axle positions, ground clearance / underride height, color, materials, lights, markings (e.g. conspicuity tape per FMVSS 108 if a trailer), and its role.
- Witnesses: position [x, y, z] (ground), eye height, posture (standing/seated/in vehicle + vehicle type), facing, what they observed, and the evidence that places them there.
- Lighting: date, local time, sun azimuth/elevation (use the value provided if given), sky, shadows.

## Every element
{ "id": "snake_case_unique", "category": "lane|shoulder|median|crossover|side_road|marking|sign|terrain|building|canopy|structure|pole|wire|fence|drainage|vegetation|ground|driveway|furniture|mark|other",
  "label": "...", "position": [x, y, z] (center of footprint at ground), "headingDeg": 0, 
  "dimensions": { "length": m (along heading), "width": m, "height": m },
  "polyline": [[x, z], ...] (optional, for lines/fences/edges), 
  "material": "PBR description: base color hex, roughness, metalness, texture/wear notes",
  "mutcd": "section / sign code (markings and signs only)",
  "occludes": true|false (could block a line of sight at 1–2 m eye height),
  "citation": "<file> <page/line/timestamp>"  OR  "inferred: <basis>"  OR  "standard: <MUTCD/AASHTO/FMVSS section>; inferred placement",
  "confidence": 0..1, "note": "optional" }

Citation rules (strict): cite the evidence file name and the most precise locator (page, table row id, timestamp). If an element is NOT in the evidence, its citation MUST start with "inferred:" and say what it is inferred from (typical rural practice, aerial imagery not provided, etc.). Elements the scene needs for realism but that no evidence supports are allowed only if they cannot change any sight line (`occludes: false`) or you flag them in `risks`. Never present an inferred item as a finding.

Also return:
- `crossSection`: an ordered list of bands across the main road at the reference station: { "from": offset_m, "to": offset_m, "axis": "z"|"x", "band": "...", "surface": "...", "citation": "..." }
- `profile`: { "axis", "points": [{ "station": m, "elevation": m, "note", "citation" }] }
- `risks`: places where a wrong inferred element would change a visibility result
- `openQuestions`: what would need aerial imagery, a site visit, or a survey

Return ONLY JSON:
{ "frame": {...}, "sources": [{ "id", "file", "what" }], "lighting": {...}, "crossSection": [...], "profile": {...},
  "elements": [...], "vehicles": [...], "witnesses": [...], "risks": [...], "openQuestions": [...] }
