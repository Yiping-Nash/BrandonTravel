# README presentation assets

These are deterministic layouts of existing, real application screenshots. No UI text, state, data or controls have been generated or repainted. Frames, spacing and the Board / Day / Research labels are presentation elements outside the captured UI.

- `workspace-hero.png`: the complete `../portfolio/hero.png`, scaled and framed.
- `product-overview.png`: crops from `../portfolio/board.png`, `day.png` and `research.png`, arranged in three labelled columns.
- `board-detail.png`: crop of the original Board workspace, with a frame.
- `research-detail.png`: crop showing the original unknown-information notice, candidate, evidence and confirmation controls, with a frame.

Original full screenshots remain linked in both READMEs. The overview is for identifying the three modules; open the linked originals to read detailed UI text. Existing source/provider attribution and evidence limitations still apply.

To reproduce from the repository root after installing web dependencies:

```powershell
node docs/screenshots/readme/compose.mjs
```

The script uses the existing Playwright / Chrome dependency and HTML/CSS composition. Crop rectangles are recorded in its source. Temporary HTML is written under ignored `data/readme-visual/`; only the presentation PNGs and this source are published. Existing screenshots and GIFs are unchanged.
