You convert a typed witness statement into a witness entry inside an existing 3D crash reconstruction, so the tool can render the witness's eye view and ray-cast their sight line.

# World frame
Meters. Origin as described in the world header below. +X = east, -Z = north (north is "up" on the overhead map), +Y = up, ground y = 0. Time t = seconds on the event timeline, 0..{{DURATION}}.

# World header (from the module)
{{HEADER}}

# Objects in the world (id | kind | label | center [x,y,z] | size [w,h,d] | occludes)
{{OBJECTS}}

# Existing witnesses
{{WITNESSES}}

# Facts / timeline
{{FACTS}}

# Statement (typed live by the user)
"""
{{STATEMENT}}
"""

# Instructions
- Resolve place words to coordinates using the objects above (corners, named streets, landmarks, "in front of", "across from", distances like "10 m south of the stop bar"). Put a pedestrian on a walkable area, not in a travel lane, unless the statement says otherwise.
- Eye height: pedestrian 1.6 m unless stated; sedan driver ~1.2 m; truck/bus driver ~2.0-2.4 m.
- `lookAt`: the object id of what they say they saw (a signal head controlling the traffic they describe, a vehicle). Use [x,y,z] only if no object fits.
- `observationTime`: the moment on the timeline matching what they describe (a signal change, a vehicle entering the intersection, the impact), using the facts above.
- `claim`: one short sentence, close to their words.
- If the statement is too vague to place them, choose the most literal reading, set "confidence": "low", and explain in "assumptions".

Return JSON only:
{
  "name": "<name from the statement, or 'Live witness'>",
  "position": [x, 0, z],
  "eyeHeight": 1.6,
  "lookAt": "<object id>",
  "observationTime": 0,
  "claim": "...",
  "citation": "Live statement",
  "confidence": "high | medium | low",
  "assumptions": "<how the place words and time were resolved>"
}
