"""
Derive one category tile from an already-composed square source image.

    derive-grocers-tile.py <source.png> <out.webp>

WHY THIS IS NOT crop-grocers-category.py. That script exists to pull panels
out of a collage: it finds row and column boundaries, strips a caption bar,
and squares up a rectangular panel. None of that applies when the artwork
arrives as a single square image with its title banner already in place.
Running the cropper over it would hunt for a caption bar to remove — and
remove the banner that is meant to stay.

So this does the one thing that is actually needed: check the source really
is square, downscale to the catalogue's 800x800, and write WebP at the same
quality as every other tile. Nothing is cropped, padded, recoloured or
stretched; the output is the source at a smaller size.
"""
import os
import sys
from PIL import Image

EDGE = 800
WEBP_QUALITY = 88


def main(src_path, out_path):
    if not os.path.exists(src_path):
        raise SystemExit(f"source image missing, nothing was written: {src_path}")

    im = Image.open(src_path).convert("RGB")
    if im.width != im.height:
        # Squaring a rectangle is a design decision, not a resize. If a
        # source ever arrives non-square, it needs the cropper and a
        # deliberate choice about what to do with the leftover space.
        raise SystemExit(
            f"source is {im.width}x{im.height}, not square — "
            "use crop-grocers-category.py and decide how to square it"
        )

    out = im.resize((EDGE, EDGE), Image.LANCZOS)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    out.save(out_path, "WEBP", quality=WEBP_QUALITY, method=6)
    print(f"{os.path.basename(out_path)}  {im.width}x{im.height} -> {EDGE}x{EDGE}  "
          f"{os.path.getsize(out_path) // 1024} KB")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: derive-grocers-tile.py <source.png> <out.webp>")
    main(sys.argv[1], sys.argv[2])
