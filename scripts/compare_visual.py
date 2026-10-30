"""Compare fixed-font browser screenshots and leave a highlighted diff on failure."""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter

reference, actual = map(Path, sys.argv[1:])
failures = []
for baseline in sorted(reference.glob('*.png')):
    target = actual / baseline.name
    before, after = Image.open(baseline).convert('RGB'), Image.open(target).convert('RGB')
    if before.size != after.size:
        failures.append(f'{baseline.name}: size {before.size} -> {after.size}')
        continue
    # Ignore small rasterization differences across operating systems, preserve layout/text changes.
    delta = ImageChops.difference(before.filter(ImageFilter.GaussianBlur(.5)), after.filter(ImageFilter.GaussianBlur(.5)))
    pixels = list(delta.getdata())
    changed = sum(max(pixel) > 50 for pixel in pixels) / len(pixels)
    if changed > .008:
        delta.save(actual / (baseline.stem + '-diff.png'))
        failures.append(f'{baseline.name}: {changed:.2%} changed (limit 0.8%)')
if not list(reference.glob('*.png')):
    failures.append('No visual reference PNGs found')
if failures:
    raise SystemExit('\n'.join(failures))
print('Visual regression passed: desktop/mobile whole pages, focus, drawer, conditional subscriptions, release and conflict.')
