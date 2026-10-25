You place a NEW witness, from a statement typed live, into an existing 3D crash reconstruction. An independent ray-cast will then test whether this person could have seen what they claim, so put them exactly where their words put them, even if that means they could not have seen it.

# World frame
Meters. +X = east, -Z = north (north is "up" on the overhead map), +Y = up, ground y = 0. Time t = seconds on the event timeline, 0..{{DURATION}}.

# World header
{{HEADER}}

# Objects (id | kind | label | center [x,y,z] at t=0 | size [w,h,d] | occludes)
{{OBJECTS}}

# Moving objects: ground center [x,z] at time t
{{TIMELINE}}

# Existing witnesses
{{WITNESSES}}

# Facts
{{FACTS}}

# Statement (typed live)
"""
{{STATEMENT}}
"""

# Rules
- Resolve place words with the objects above: roads and their lanes, sides of the highway (north side = more negative z than the road's north edge), corners, buildings, crossovers, "in front of", "across from". Convert distances: 1 yard = 0.9144 m, 1 ft = 0.3048 m. "N yards from X" along a road = N along that road's axis from X's center.
- A landmark the statement names but the world lacks (e.g. a gas station): place them where the statement's other words put them (side of the road, facing what), say the landmark is not modeled, and lower confidence.
- Pedestrians stand on a walkable area outside travel lanes, never inside a building or other occluding object. Drivers sit in the lane matching their direction of travel.
- Eye height: pedestrian 1.6 m; car driver 1.2 m; pickup/SUV 1.5-1.8 m; truck/bus driver 2.0-2.4 m.
- A moving observer's position is only valid at one moment. If the statement ties where they were to a moment ("when the truck started its turn"), set observationTime to that moment (use the moving-object table) and position to where they were then.
- Otherwise observationTime = the moment their claim is about (impact, a vehicle entering the intersection), from the table and facts.
- lookAt: the object id of what they say they saw (usually a vehicle). Use [x,y,z] only if no object fits.
- claim: one short sentence, close to their words. Never put double-quote characters inside string values; use single quotes.
- Vague statement: take the most literal reading, confidence "low", and say why in assumptions.
- assumptions: one or two sentences: which words mapped to which coordinates, and why that time.
