# R1 public run records

These are historical experiment results, including failures. Source URLs, timestamps, result status, model usage, Trace IDs and provenance hashes are retained.

For Portfolio 1.0 publication, third-party webpage bodies in `excerpt` / `raw_content` were replaced with an explicit omission marker. `excerptSha256` and `excerptCharacters` (or the corresponding `raw_content` fields) describe the original text. These summaries are **not raw replay inputs** and their retained evidence hashes must not be recomputed from the omission marker. Original captures are retained locally outside Git for the owner; use source links and authorized LangSmith access for review.

This does not change historical experiment outcomes or turn pending human quality reviews into passes. Earlier Git revisions are preserved rather than rewritten; the publication cleanup applies to the current tree.
