Visual references
=================

`node scripts/test_visual.cjs` checks desktop (1280×900) and mobile (390×844)
whole pages, focus view, item drawer, subscription fields off/on, promotions,
project settings, release form and conflicts. The date, locale, timezone,
viewport, motion and font are fixed. Native scrollbar/control rendering differs
between operating systems, so `reference/darwin` and `reference/linux` keep
independently reviewed baselines with the same strict comparison threshold. Toasts and the build hash are excluded.

Install Playwright and Chromium as in CI, and Python Pillow for comparisons.
`UPDATE_VISUAL=1 node scripts/test_visual.cjs` replaces the references. Review
all changed PNGs before committing. CI publishes actual/diff images on failure;
it never updates references automatically. `RELEASE_QA_DIR` changes the output
folder, and `VISUAL_PYTHON` selects the Python executable.

`font.woff2` is a subset of Noto Sans SC, licensed under the adjacent OFL.txt.
Source: https://github.com/google/fonts/tree/main/ofl/notosanssc
The font is used only by screenshot tests and is not shipped with the app.
It was subset with fontTools from the characters in board/pages sources and
this test fixture, retaining the variable weight axis. Refresh the subset
when a fixture introduces characters that are not covered.

Current workflow update: the new priority overview, save-all actions and command
labels have reviewed macOS references. Linux references still describe the prior
layout and must be regenerated and reviewed on Linux before the visual CI check
can pass. Do not copy macOS PNGs over the Linux references: native controls and
whole-page heights differ. Functional DOM, workflow and layout tests cover the
new behavior independently.
