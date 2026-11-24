"""
Split the Rice, Atta & Flour collages into individual category images.

THE GRID IS NOT UNIFORM. The subcategory sheet has five tiles on its first
row and six on its second, so columns are measured WITHIN each row rather
than once for the whole sheet. Every boundary comes from the pixels.

Each tile is a product photograph above a green label bar. The bar is found
by its own colour — sampled from the tile's own last row — and cut away,
along with the white gap above it.

Nothing is redrawn, recoloured or regenerated. The two originals are
archived unchanged.
"""
import os
import sys
import numpy as np
from PIL import Image

SRC = "/tmp/claude-0/gr-src"
EDGE = 800
WEBP_QUALITY = 88

# Tiles in reading order, as the sheet labels them, paired with the APPROVED
# subcategory slug they belong to. `None` means the sheet shows something the
# approved catalogue has no subcategory for — cropped and kept, but not wired
# to any shelf, because the catalogue is not changed to match a picture.
TILES = [
    # row 1
    ("Basmati Rice", "basmati-rice"),
    ("Sona Masoori Rice", "sona-masoori"),
    ("Raw Rice", "rice"),
    ("Brown Rice", "brown-rice"),
    ("Broken Rice", None),
    # row 2
    ("Poha / Flattened Rice", None),
    ("Wheat Flour (Atta)", "atta"),
    ("Maida", "maida"),
    ("Besan (Gram Flour)", "besan"),
    ("Rava (Suji)", "rava-sooji"),
    ("Multigrain Flour", "multigrain-flour"),
]
ROW_COUNTS = [5, 6]


def ink(arr, bg, threshold=24):
    return (np.abs(arr - bg).sum(axis=2) > threshold).astype(np.uint8)


def runs(mask, min_len):
    out, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    if start is not None and len(mask) - start >= min_len:
        out.append((start, len(mask)))
    return out


def strip_label(arr, box):
    """
    Remove the green label bar, and everything below it, from a tile.

    FIRST ATTEMPT, AND WHY IT FAILED HERE. Sampling the tile's last rows for
    the bar colour worked on the Fresh Mart sheets, whose cells ended inside
    the caption. This sheet leaves WHITE MARGIN BELOW each green bar, so the
    sample returned white and only the margin was trimmed — every crop kept
    its label. Caught on the contact sheet, not by the script.

    WHAT WORKS HERE. The bar is strongly green and the photograph above it is
    not, so the bar is found by hue: rows where green clearly dominates red
    and blue across most of the width. The crop ends above the topmost such
    row, and trim() then removes the white gap.
    """
    x0, y0, x1, y1 = box
    cell = arr[y0:y1, x0:x1]
    h = cell.shape[0]

    r, g, b = cell[:, :, 0], cell[:, :, 1], cell[:, :, 2]
    greenish = ((g > r + 28) & (g > b + 28)).mean(axis=1)

    # Only look below the midpoint: a green vegetable high in the frame is
    # not a label bar.
    candidates = [y for y in range(h // 2, h) if greenish[y] > 0.5]
    if not candidates:
        return box
    return (x0, y0, x1, y0 + min(candidates))


def trim(arr, box, pad_ratio=0.012):
    x0, y0, x1, y1 = box
    cell = arr[y0:y1, x0:x1]
    bg = cell[1, 1]
    m = ink(cell, bg, threshold=30)
    ys, xs = np.where(m)
    if len(xs) == 0:
        return box
    pad = int(min(x1 - x0, y1 - y0) * pad_ratio)
    return (
        max(x0, x0 + xs.min() - pad),
        max(y0, y0 + ys.min() - pad),
        min(x1, x0 + xs.max() + 1 + pad),
        min(y1, y0 + ys.max() + 1 + pad),
    )


def square(im):
    """Pad to a square with the image's own corner colour. Never stretches."""
    w, h = im.size
    edge = max(w, h)
    canvas = Image.new("RGB", (edge, edge), im.getpixel((1, 1)))
    canvas.paste(im, ((edge - w) // 2, (edge - h) // 2))
    return canvas.resize((EDGE, EDGE), Image.LANCZOS)


def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, "WEBP", quality=WEBP_QUALITY, method=6)
    return os.path.getsize(path)


def cells(path, row_counts):
    """Row bands first, then columns measured inside each row."""
    arr = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    h, w, _ = arr.shape
    bg = arr[2, 2]
    m = ink(arr, bg)
    rows = runs(m.sum(axis=1) / w > 0.02, h // (len(row_counts) * 5))
    # The sheet's own title banner is a full-width band with no tiles; drop
    # any band far too short to be a row of tiles.
    rows = [r for r in rows if (r[1] - r[0]) > h * 0.18]
    if len(rows) != len(row_counts):
        raise SystemExit(f"{path}: expected {len(row_counts)} tile rows, measured {len(rows)}")

    out = []
    for (r0, r1), n in zip(rows, row_counts):
        band = m[r0:r1]
        cols = runs(band.sum(axis=0) / (r1 - r0) > 0.04, w // (n * 6))
        if len(cols) != n:
            raise SystemExit(f"{path}: row {r0}-{r1} expected {n} tiles, measured {len(cols)}")
        out.extend((c0, r0, c1, r1) for (c0, c1) in cols)
    return arr, out


def main(out_dir):
    full_src = os.path.join(SRC, "SRC-rice-atta-flour-main.png")
    subs_src = os.path.join(SRC, "SRC-rice-atta-flour-subs.png")

    # ---- main category: one photograph with a green title banner ----
    arr = np.asarray(Image.open(full_src).convert("RGB")).astype(np.int16)
    box = strip_label(arr, (0, 0, arr.shape[1], arr.shape[0]))
    box = trim(arr, box)
    size = save(square(Image.open(full_src).convert("RGB").crop(box)),
                os.path.join(out_dir, "rice-atta-and-flour.webp"))
    print(f"MAIN  rice-atta-and-flour.webp  box={box}  {size // 1024} KB")

    # ---- the eleven subcategory tiles ----
    arr, boxes = cells(subs_src, ROW_COUNTS)
    if len(boxes) != len(TILES):
        raise SystemExit(f"measured {len(boxes)} tiles, expected {len(TILES)}")
    full = Image.open(subs_src).convert("RGB")

    print()
    for (label, slug), box in zip(TILES, boxes):
        box = trim(arr, strip_label(arr, box))
        im = square(full.crop(box))
        name = slug if slug is not None else "unmapped-" + label.lower().replace(" / ", "-").replace(" ", "-").replace("(", "").replace(")", "")
        size = save(im, os.path.join(out_dir, f"{name}.webp"))
        mark = "->" if slug is not None else "  (no approved subcategory)"
        print(f"{label:24} {mark} {name + '.webp':32} box={box}  {size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1])
