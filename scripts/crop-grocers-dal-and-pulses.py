"""
Split the Dal & Pulses artwork into individual category images.

TWO SHEETS, one rule. The main-category sheet is a single photograph with a
green title banner across the bottom; the subcategory sheet is a uniform 3x3
of panels, each a photograph above its own green label bar.

EVERY BOUNDARY COMES FROM THE PIXELS. Nothing is positioned by eye and no
dimension is hard-coded: rows and columns are measured as runs of non-
background, and the green bar is found by its own hue.

WHY THE BAR DETECTOR IS FUSSIER HERE than on the Rice sheet. These panels
are full of green — mung beans, bay leaves, Tata Sampann and 24 Mantra
packaging — so "a row with some green in it" would cut into the photograph.
The bar is instead required to be green across most of the row's width, to
sit in the bottom portion of the panel, and to run contiguously to within a
few rows of the panel's foot, which is what a label bar does and a bowl of
green gram does not.

Nothing is redrawn, recoloured or regenerated. Both originals are archived
unchanged.
"""
import os
import sys
import numpy as np
from PIL import Image

SRC = "/tmp/claude-0/dal-src"
EDGE = 800
WEBP_QUALITY = 88

# Reading order on the sheet, paired with the APPROVED subcategory slug.
# The sheet's nine labels match the approved nine exactly, in order, so no
# tile is unmapped and the catalogue needs no change.
TILES = [
    ("Toor Dal", "toor-dal"),
    ("Moong Dal", "moong-dal"),
    ("Masoor Dal", "masoor-dal"),
    ("Urad Dal", "urad-dal"),
    ("Chana Dal", "chana-dal"),
    ("Rajma", "rajma"),
    ("Kabuli Chana", "kabuli-chana"),
    ("Green Gram", "green-gram"),
    ("Black Gram", "black-gram"),
]
ROW_COUNTS = [3, 3, 3]


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


def strip_label(arr, box, search_from=0.55, cover=0.35, foot_slack=0.08):
    """
    Remove the green label bar, and everything below it, from a panel.

    `search_from`  only rows below this fraction of the panel are considered;
                   a green pack high in the frame is not a label.
    `cover`        the fraction of the row that must be BAR-GREEN.
    `foot_slack`   the deepest bar row must reach within this fraction of the
                   panel's foot, so a green object mid-panel is not mistaken
                   for a label.

    BAR-GREEN IS A NARROW COLOUR, not "greenish". The bar is a dark saturated
    green; mung beans, bay leaves and Tata Sampann packaging are brighter or
    more olive. Bounding the green channel separates them cleanly: measured
    across these nine panels, bar rows score 0.6-0.98 and photograph rows
    score under 0.15, so the threshold sits in a wide empty gap rather than
    on a judgement call.

    THE CUT IS THE TOPMOST BAR ROW, not the top of the last unbroken run. The
    bar's own white lettering breaks the run into pieces — "Black Gram" in
    48pt splits it into three — and taking the last piece left five of ten
    crops still wearing part of their label. That failure was visible on the
    contact sheet and invisible to the script, which is why the contact sheet
    is inspected by eye before anything is wired up.

    Returns the box unchanged when no bar is found, which is the honest
    outcome for a panel that has none.
    """
    x0, y0, x1, y1 = box
    cell = arr[y0:y1, x0:x1]
    h = cell.shape[0]

    r, g, b = cell[:, :, 0], cell[:, :, 1], cell[:, :, 2]
    bar = ((g > r + 25) & (g > b + 25) & (g > 50) & (g < 170)).mean(axis=1)

    hits = [y for y in range(int(h * search_from), h) if bar[y] > cover]
    if not hits or max(hits) < h - int(h * foot_slack):
        return box
    return (x0, y0, x1, y0 + min(hits))


def trim(arr, box, pad_ratio=0.012):
    """Shrink to the panel's own content, dropping the white surround."""
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
    """
    Pad to a square. NEVER stretches and never crops the photograph.

    THE PAD COLOUR IS THE PHOTOGRAPH'S OWN BACKDROP, taken as the median of
    its top rows — which on every one of these panels is blurred kitchen
    background above the pack. Padding with the corner pixel was tried first
    and the corner is the white card border, so each 2:1 panel became a thin
    strip between two white bands; in a 56px tile that left the product about
    28px tall and unreadable. Sampling the backdrop instead makes the tile
    read as one continuous scene. A median, not a mean, so a stray leaf or
    highlight in those rows cannot tint the whole pad.
    """
    w, h = im.size
    edge = max(w, h)
    top = np.asarray(im)[: max(1, h // 16)].reshape(-1, 3)
    pad = tuple(int(v) for v in np.median(top, axis=0))
    canvas = Image.new("RGB", (edge, edge), pad)
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
    rows = [r for r in rows if (r[1] - r[0]) > h * 0.12]
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
    main_src = os.path.join(SRC, "SRC-dal-and-pulses-main.png")
    subs_src = os.path.join(SRC, "SRC-dal-and-pulses-subs.png")

    # ---- main category: one photograph with a green title banner ----
    arr = np.asarray(Image.open(main_src).convert("RGB")).astype(np.int16)
    whole = (0, 0, arr.shape[1], arr.shape[0])
    box = trim(arr, strip_label(arr, whole))
    size = save(square(Image.open(main_src).convert("RGB").crop(box)),
                os.path.join(out_dir, "dal-and-pulses.webp"))
    print(f"MAIN  dal-and-pulses.webp  box={box}  {size // 1024} KB")

    # ---- the nine subcategory panels ----
    arr, boxes = cells(subs_src, ROW_COUNTS)
    if len(boxes) != len(TILES):
        raise SystemExit(f"measured {len(boxes)} panels, expected {len(TILES)}")
    full = Image.open(subs_src).convert("RGB")

    print()
    for (label, slug), box in zip(TILES, boxes):
        cropped = trim(arr, strip_label(arr, box))
        size = save(square(full.crop(cropped)), os.path.join(out_dir, f"{slug}.webp"))
        kept = (cropped[3] - cropped[1]) / (box[3] - box[1])
        print(f"{label:14} -> {slug + '.webp':20} box={cropped}  kept {kept:.0%} of panel height  {size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1])
