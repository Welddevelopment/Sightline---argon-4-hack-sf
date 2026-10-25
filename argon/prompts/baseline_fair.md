You are analyzing the evidence in a litigation case. You know nothing about this case except the evidence attached to this message.

# TASK
For each witness, determine where they were and whether their claimed observations are physically possible given the evidence; cite timestamps and pages.

Citation format: video moments as "Depo MM:SS" for a deposition (if the case has several videos: "Depo <label> MM:SS"), otherwise "<video file> MM:SS"; documents as "<file> p.N" (p.1 if the document has no page markers); images by file name.

# CASE
caseId: {{CASE_ID}}
Evidence inventory: {{INVENTORY}}

# TEXT EVIDENCE
{{CASE_TEXT}}

Study the text above and every video and image attached to this message, then output ONE JSON object, no prose:
{
  "summary": "<3-5 sentences: your overall conclusions>",
  "witnesses": [
    {
      "name": "<as named in the evidence>",
      "position": "<where they were, as precisely as the evidence allows>",
      "positionCitations": ["<citation>", "..."],
      "claims": [
        {
          "claim": "<what they claim to have observed, verbatim where possible>",
          "citation": "<citation>",
          "physicallyPossible": "yes|no|uncertain",
          "reasoning": "<why, referring to the evidence>",
          "citations": ["<citation>", "..."]
        }
      ]
    }
  ]
}
