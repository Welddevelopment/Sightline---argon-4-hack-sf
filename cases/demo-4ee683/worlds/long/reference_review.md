Here is a detailed breakdown of the forensic visual standards in your reference videos, followed by a direct, prioritized critique of your current Three.js implementation and actionable steps to bridge the gap.

---

### 1. Visual Standard Analysis of Reference Videos

#### **Video 1: Traditional Forensic Studio (ESI) — Night-Time Semi Collision**
This video represents the classic, admissibility-focused forensic standard (likely 3ds Max/V-Ray or similar). It prioritizes geometric clarity, lighting accuracy (especially for night visibility claims), and zero visual distraction.

*   **Vehicle Model Fidelity:**
    *   **Poly Detail:** Medium-high CAD/turbosquid-level meshes. The Volvo semi (`00:25–00:33`) has distinct grille slats, hood mirrors, windshield wipers, cab steps, fuel tanks, and 5th-wheel assembly. The trailer (`01:36`) has rear barn doors, vertical locking bars, mudflaps, and DOT reflective conspicuity tape (red/white alternating strips along the bottom rail and rear bumper). The Honda Civic (`01:27`) has recognizable trim, side mirrors, license plate recess, and distinct taillight housings.
    *   **Materials & Glass:** Clean, slightly glossy automotive paint (non-PBR legacy shaders, low environment reflection so it doesn't distract). Glass (`00:26`) is dark-tinted and mostly opaque to hide the lack of a detailed driver model, with a subtle specular highlight.
    *   **Wheels:** 3D rims with distinct lug nuts and recessed hubcaps (`00:26`), dark matte rubber tires.
    *   **Lights:** Crucial for the night sequence (`01:09–01:19`). Emissive point/spot lights with star/glare post-processing filters on traffic signals, streetlamps, and taillights. The trailer has amber/red side marker lights (`01:18`).
*   **Road & Scene:**
    *   **Ground/Markings:** Flat, matte grey asphalt with crisp, high-contrast vector-like painted lane markings, directional arrows, and crosswalks (`00:07–00:24`). Raised concrete medians with yellow painted noses and metal W-beam guardrails/impact attenuators (`00:25`).
    *   **Buildings & Props:** Low-poly commercial buildings mapped with real-world photographic facade textures ("Joyce Leslie", "KFC", "Kohl's" at `00:10`, `01:10`, `01:35`). Signal mast arms (`00:25`, `01:45`) are fully modeled with yellow signal heads, backplates, and street name signs ("Tices Ln").
*   **Lighting:**
    *   **Daylight (`00:07–01:02`, `01:27–02:12`):** Diffuse, overcast/ambient lighting. Soft contact shadows directly underneath vehicles (`00:27`), no harsh directional sun shadows that could confuse lane positions.
    *   **Night (`01:09–01:19`):** Pitch-black sky and unlit ground. The *only* illumination comes from streetlamp pools, commercial signage (KFC sign glowing at `01:10`), traffic signals, and the sedan's volumetric headlight cones casting light onto the asphalt (`01:14`).
*   **Camera Work:**
    *   **Satellite Match (`00:00–00:07`):** Starts with a real Google Earth aerial photo, zooms in, and cross-dissolves (`00:05–00:07`) into a perfectly registered 3D orthographic/high-angle perspective view.
    *   **360° Scene Orbit (`00:08–00:26`):** Smooth, constant-speed orbit around the intersection, then pushes in to frame the semi at the stop bar.
    *   **Top-Down Tracking (`00:35–01:02`):** High-altitude bird's-eye view showing the entire approach of both vehicles simultaneously.
    *   **Driver/Chase Cam (`01:09–01:19`, `01:27–01:37`):** Locked behind the sedan, following it into the underride impact, freezing right at contact (`01:19`, `01:37`).
    *   **Witness View (`01:45–02:12`):** Stationary eye-level camera from a corner island, panning smoothly to track the collision through to post-impact rest.
*   **Overlays & Timing:**
    *   Full-screen black title cards (`01:04` "Night Time View", `01:21` "Rear View", `01:40` "Witness View") with simple white sans-serif text. Subtle watermark in bottom-right (`ESI`).
    *   Pacing is deliberate: 3-second static holds before and after motion; real-time playback during the crash sequence.
*   **Why a Jury Trusts It:** The `00:05` aerial photo dissolve proves the road geometry isn't made up. The photographic store facades ground it in a real place. The side-by-side comparison of Night vs. Day rear views (`01:09` vs `01:27`) directly answers the legal question of conspicuity without looking "gamey."

---

#### **Video 2: Modern Real-Time Standard (Ziva / Unreal Engine)**
This video represents the modern, data-driven litigation standard. It uses physically-based rendering (PBR) and real-time game engine tech, paired with analytical HUD overlays.

*   **Vehicle Model Fidelity:**
    *   **Poly Detail:** High-poly, modern asset-store quality. The box truck (`00:29–00:33`) has a detailed Isuzu-style cab, mirrors,amber turn signals, corrugated roll-up rear door, chassis frame rails, and leaf springs. The vehicles have realistic proportions and panel gaps.
    *   **Materials & Glass:** Full PBR materials. Clear coat car paint with realistic Fresnel reflections of the sky and surroundings (`00:30`). Physically accurate transparent windshield glass with interior dashboard, steering wheel, A-pillars, side mirrors (with working reflection at `00:24`), and rearview mirror (`00:24–00:29`).
*   **Road & Scene:**
    *   **Asphalt & Markings:** High-resolution PBR asphalt with subtle aggregate normal mapping, dark oil/tire wear strips in the wheel paths (`00:18–00:22`), concrete curbs, and ligeramente worn crosswalk/stop bar paint.
    *   **Environment:** 3D procedural trees with alpha-card foliage that casts complex leaf shadows (`00:20`, `00:30`). Detailed traffic signal poles, pedestrian crossing lights, and utility poles.
*   **Lighting:**
    *   **Daylight:** Physically based sky/atmosphere with a bright directional sun casting crisp, dark, angled shadows (`00:18–00:33`) and ambient occlusion (AO) grounding every tire and building corner.
*   **Camera Work:**
    *   **Plan-View Diagram Match (`00:00–00:02`):** Split-screen comparing the 2D black-and-white police report diagram directly to the top-down 3D render.
    *   **Top-Down Sightline View (`00:18–00:23`):** Locked orthographic/telephoto overhead camera.
    *   **First-Person Driver's Seat (`00:24–00:29`):** Positioned inside the cab at exact driver eye-point, looking past the steering wheel and A-pillar.
    *   **Witness Corner (`00:30–00:33`):** Eye-height static camera on the sidewalk.
    *   **Split-Screen Counterfactual (`00:38–00:45`):** Synchronized side-by-side comparison ("52 mph EDR Download" vs. "38 mph Their Driver").
*   **Overlays & Callouts (Crucial Differentiator):**
    *   **Dynamic Sightline Ray (`00:18–00:23`, `00:38–00:45`):** A 3D line drawn between Unit 1's driver eye and Unit 2. It colors **red** when occluded by the box truck and snaps to **green** the exact millisecond Line-of-Sight (LOS) clears (`00:20`, `1.07s` before impact).
    *   **Telemetry HUD (Top-Left):** Clean dark semi-transparent boxes with monospace/sans-serif typography showing live countdown (`IMPACT IN 4.07 s`), live speed (`UNIT 2 52 mph`), and state triggers (`UNIT 2 NOW VISIBLE` at `00:27`; `NO CONTACT: UNIT 2 STOPS 24.5 FT SHORT` at `00:45`).
    *   **Lower-Third Narrative Cards:** (`00:24` "FROM THE DRIVER'S SEAT / Could they have seen it? / Visible 1.2s before impact. A normal reaction takes 1.5s.")
*   **Why a Jury Trusts It:** It links every frame to hard evidence (Police Diagram at `00:01`, EDR data at `00:38`). The red/green sightline ray turns a subjective argument ("I couldn't see him") into an objective geometric proof.

---

### 2. Ranked Gap List: Your Three.js Renders vs. The Standard

To be blunt: **Image 1** (truck lineup) and **Image 3** (rural road) look like promising technical prototypes, **Image 2** (sedan) looks like a melted clay toy, and **Image 4** (demo world) looks like a 1995 flight simulator debug view. Putting Image 2 or Image 4 in front of a jury will hurt credibility because opposing counsel will argue the simulation is crude and cartoon-like.

Here are your biggest visual gaps, ranked by impact on credibility, with exact Three.js fixes:

#### **Gap #1: The Demo World Environment & Lighting (Image 4)**
*   **The Problem:** Unlit/flat-shaded brown boxes for buildings, neon green/brown flat planes for grass, zero ambient occlusion, pitch-black unlit shadow sides (`Witness B eye 06:45` and `12:00`), and blocky untextured intersections.
*   **The Three.js Fix:**
    1.  **Kill flat Lambert/Basic materials:** Use `THREE.MeshStandardMaterial` across the entire scene.
    2.  **Add an Environment Map (IBL):** A scene without `scene.environment` has pitch-black shadows on metallic/glossy surfaces and dead ambient light. Use `THREE.PMREMGenerator` with a neutral daylight HDRI (or `RoomEnvironment` / procedural sky texture) and set `scene.environment = envMap` with `envMapIntensity = 0.5–0.8`.
    3.  **Fix Shadow Darkness:** Combine your `DirectionalLight` (sun) with a `THREE.HemisphereLight(0xddeeff, 0x333322, 0.6)` so shadowed building faces aren't pure black voids.
    4.  **Post-Processing Ambient Occlusion:** Add `N8AOPass` (from `n8ao`, very fast in Three.js) or `SAOPass`/`SSAOPass`. Contact shadows where wheels meet asphalt and buildings meet ground instantly remove the "floating object" look.

#### **Gap #2: Procedural Passenger Vehicle Geometry (Image 2 - Sedan)**
*   **The Problem:** Extruded/lathed procedural geometry works for boxy trailers (Image 1), but it **fails completely** for modern curved passenger cars. The sedan in Image 2 has pinched, blobby hood creases, weird pill-shaped headlights, floating lollipop side mirrors, and flat gray plastic shading. It looks uncanny.
*   **The Three.js Fix:**
    1.  **Stop procedurally generating passenger car bodies:** Buy or download 5–8 clean, mid-poly (15k–30k triangles) `.glb` vehicle archetypes (sedan, compact SUV, full-size pickup, minivan, crossover, coupe). Scale their bounding boxes `(L × W × H)` and wheelbases dynamically in code to match catalog specs if needed, or scale the mesh nodes (`chassis`, `wheel_FL`, etc.).
    2.  **Use `THREE.MeshPhysicalMaterial` for Car Paint:**
        ```js
        const carPaint = new THREE.MeshPhysicalMaterial({
          color: 0xc0c4c8,
          metalness: 0.4,
          roughness: 0.25,
          clearcoat: 1.0,
          clearcoatRoughness: 0.05
        });
        ```
    3.  **Glass Material:** Use `MeshPhysicalMaterial` with `transmission: 0.7, opacity: 1, transparent: true, roughness: 0.05, ior: 1.5, color: 0x111820` and put a simple dark low-poly interior tub (seats + steering wheel + A-pillars) inside so you can do driver-seat views like Video 2 (`00:24`).

#### **Gap #3: Intersection & Road Surface Markings (Image 4 vs. Video 1 & 2)**
*   **The Problem:** While Image 3 has a decent rural road texture, the intersection in Image 4 is just dark gray overlapping rectangles with basic dashed lines. There are no stop bars, crosswalks, turn arrows, curb radii, or traffic signal mast arms.
*   **The Three.js Fix:**
    1.  **Procedural Canvas/SVG Road Decals:** Generate high-res (2048×2048 or 4096×4096) `HTMLCanvasElement` textures for intersection markings (stop bars, continental crosswalks, double-yellow centerlines, turn arrows) and apply them via `THREE.CanvasTexture` with `anisotropy = renderer.capabilities.getMaxAnisotropy()`.
    2.  **Add Wear/Detail Map:** Overlay a tileable asphalt normal map + roughness map so the sun catches the road surface grain (like Image 3, brought into the intersection).
    3.  **3D Street Furniture Library:** Build or import modular `.glb` assets for standard MUTCD traffic signal mast arms, street signs, concrete curbs, and guardrails (like Video 1 `00:25` and Video 2 `00:22`).

#### **Gap #4: Missing Forensic HUD, Sightlines, and Telemetry Overlays**
*   **The Problem:** Your debug labels in Image 1 (`semitrailer · box van 16.2 x 2.6 x 4.1`) and Image 4 (`Witness B eye 12:00 EDT`) look like developer diagnostics, not courtroom demonstratives.
*   **The Three.js Fix:**
    1.  **Line-of-Sight (LOS) Raycaster:** Implement a live `THREE.Raycaster` from Driver 1's eye position to Driver 2's vehicle centroid/front corner. Render it in 3D using `Line2` (`three/examples/jsm/lines/Line2.js`) for thick, anti-aliased lines (3–4px wide) that turn `#ff3b30` (red) when blocked by an occluder mesh and `#30d158` (green) when clear (Video 2 `00:20`).
    2.  **Courtroom HUD Layer:** Build a clean HTML/CSS overlay pinned to the top-left (like Video 2) showing `TIME TO IMPACT: -X.XX s`, vehicle speeds, and visibility state triggers. Use `tabular-nums` (`font-variant-numeric: tabular-nums`) so numbers don't jitter during countdowns.

#### **Gap #5: Vegetation & Buildings (Image 3 & Image 4)**
*   **The Problem:** The trees in Image 3 are low-poly green icospheres/blobs on brown cylinders ("broccoli trees"). The buildings in Image 4 are untextured brown monopoly houses.
*   **The Three.js Fix:**
    1.  **Trees:** Replace geometric sphere trees with 2–3 variations of alpha-clipped leaf-card tree meshes (`alphaTest: 0.5`, `castShadow: true`) instantiated via `THREE.InstancedMesh`.
    2.  **Buildings & Ground Context:** Fetch satellite imagery (Mapbox / Google Tiles / USGS orthoimagery) and drape it onto the ground plane around the procedurally generated road (like Video 1 `00:36`). For buildings, use simple clean architectural massing (white/grey stucco or brick textures with subtle window grid normal/roughness maps, like Video 2 `00:18`).

---

### 3. What You Have That Is Already At or Near the Standard

You actually have several strong foundational pieces that you should **keep and build upon**:

1.  **The Semi-Tractor & Trailer Lineup (Image 1):**
    *   **Why it works:** This is by far your strongest asset. The dimensional accuracy, corrugated vertical trailer ribs, DOT red/white conspicuity tape along the lower rail, dual tandem axles with detailed rims/hubs, landing gear, and red tractor cab with chrome exhaust stacks/fuel tanks are **very close to Video 1's standard** (`00:26`).
    *   **Minor tweak to finish it:** Add a subtle environment map reflection to the red cab paint and chrome stacks, and add a soft shadow plane (`ShadowMaterial` or AO) on the ground grid beneath the tires.
2.  **The Rural Road Surface & Shoulder Transition (Image 3):**
    *   **Why it works:** The asphalt aggregate texture, longitudinal tar/crack streaks, tire wear paths, crisp white fog line, yellow centerline, and soft gravel-to-grass shoulder blend look convincing at eye level. If you pair that exact road shader with better trees and vehicles, it will hold up well.
3.  **The Ephemeris / Sky & Sun Angle System (Image 4, bottom row):**
    *   **Why it works:** Having accurate solar azimuth/elevation (`sun az 70.2 el 0.1`, `113000 lx`) with a physically based atmospheric sky gradient (`Preetham` or `Hosek-Wilkie` sky shader) is a massive forensic selling point for sun-glare and twilight visibility cases. The sky dome itself in the bottom row of Image 4 looks good—you just need the world geometry beneath it to match that quality via PBR materials and IBL.
4.  **Dimensional Bounding Envelopes (Image 1, blue `sedan envelope` box):**
    *   **Why it works:** Showing a wireframe/translucent dimensional envelope under the trailer in an underride analysis (like Video 1) is great for engineering clarity—just use it *alongside* a high-quality vehicle mesh (or faded over it), rather than using the melted clay sedan from Image 2.