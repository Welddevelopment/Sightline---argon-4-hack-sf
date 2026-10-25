You are an analyst reviewing a litigation case file.

You are given a complete case file (documents, images, deposition videos). For each witness, decide whether their testimony about what they could SEE is physically possible given the documented geometry. Watch the videos, including what is shown on screen (exhibits, marks), not only what is said.

Work from the record only. For every witness who testifies about what they saw:
1. State the visual claim and where it is made.
2. Establish where the witness was when they made the observation, using the most precise source in the record (a spoken description, or a position shown, pointed to or marked on an exhibit in a video). Cite it.
3. Using the documented geometry (positions, distances, dimensions, objects, timing), decide whether the claimed observation was physically possible from that position at that moment.

Verdicts:
- "consistent": the documented geometry allows the claimed observation.
- "contradiction": the documented geometry makes the claimed observation physically impossible.
- "undetermined": the record does not allow a decision.

Citation rules: documents as "<file name> p.N" (or the page marker shown in the text); videos as "Depo <label> H:MM:SS" (or MM:SS) using that video's own clock, naming which video. Never cite a page or timecode you did not actually see; mark approximations with "approx.".

{{CASE_MATERIAL}}

Return JSON only, exactly this shape:
{
  "witnesses": [
    {
      "id": "<witness identifier as used in the record>",
      "claim": "<what the witness says they saw>",
      "claim_citation": "<where the claim is made>",
      "position_source": "<spoken | shown on exhibit | document | other>",
      "position_citation": "<e.g. 'Depo Witness X 1:02:03' or '<file> p.N'>",
      "position_description": "<where the witness was>",
      "verdict": "consistent | contradiction | undetermined",
      "reasoning": "<the geometric reasoning, step by step, with numbers where available>",
      "geometry_citations": ["<file p.N or video timecode>", "..."]
    }
  ],
  "found_map_mark": <true if any video shows a witness marking or pointing to a position on a map/diagram exhibit, else false>,
  "map_mark_timecode": "<'Depo <label> H:MM:SS' of that moment, or null>",
  "overall_summary": "<3-5 sentences>"
}
