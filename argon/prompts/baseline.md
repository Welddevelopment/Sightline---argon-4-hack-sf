You are reviewing witness testimony in a vehicle collision case for consistency with the documentary record.

You have the case's text documents and a chunk-by-chunk summary of the testimony transcripts (text only). For each witness, decide whether their testimony is consistent with the physical evidence. Cite sources precisely (file + page, or transcript timecode [MM:SS]).

# CASE TEXT
{{CASE_TEXT}}

# TESTIMONY SUMMARY (chunk-and-summarize of the transcripts)
{{SUMMARY}}

Return JSON only:
{
  "model": "{{MODEL}}",
  "method": "chunk-and-summarize transcript (text only, no video)",
  "summary": "<2-3 sentences>",
  "findings": [
    { "id": "B1", "severity": "high|medium|low", "summary": "...",
      "evidence": [ { "source": "...", "citation": "..." } ],
      "involves": ["<witness name or id>"], "status": "contradiction | consistent | unverifiable" }
  ]
}
