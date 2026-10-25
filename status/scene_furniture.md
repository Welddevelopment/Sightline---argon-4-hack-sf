# SCENE FURNITURE status (web/assets/furniture.js, web/furniture_preview.html)

All procedural (Kenney CC0 kits evaluated and rejected as cartoon; see status/scene_roads.md).
- tree({kind:'oak'|'pine'|'palm'|'shrub', height, moss}): branching instanced wood + alpha-clipped leaf-card clusters
  (textures.foliageMaterial, alphaTest 0.5, castShadow, 3 cluster variants per species, outward cluster normals) +
  a small opaque core per clump. Sphere "broccoli" foliage removed. Spanish moss cards on oaks. Palm fronds unchanged
  (not used at the demo site).
- signal(): galvanised mast arm (diagonal tie on long arms), modeled 3-section heads with tunnel visors, louvred
  black backplates with yellow retroreflective border, green street-name blade on the arm; post-top and span-wire variants.
- sign(kind): MUTCD stop/yield/speed limit/warning (intersection, side road, signal/stop ahead, curves)/route shield/
  street-name blades on perforated square posts with breakaway stub.
- pole(): wooden utility pole, crossarm + braces + porcelain insulators, neutral rack, comm cable, ground wire, tag,
  optional transformer; `span`/`wireTo` draws sagging conductors to the next pole.
- building(style): commercial (stucco or brick, storefront glazing, awning, parapet coping, rooftop HVAC),
  house, gas_station (canopy, columns, islands, dispensers, bollards, lit soffit, kiosk), barn. Facades now derive a
  roughness map (glossy glazing, matte wall) + bump map (recessed glass, proud trim) from the painted facade.
