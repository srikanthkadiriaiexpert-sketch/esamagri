"""
Split the two supplied Fresh Mart collages into individual category images.

WHY THIS IS A SCRIPT. Ten images have to come out of four files with their
panels cut on the real boundaries, not an assumed even split, and every crop
has to be reproducible if a source is ever re-supplied. The boundaries are
measured from the pixels: a gutter is a run of columns that barely deviate
from the page colour, and a caption bar is a flat, pale band under the
photograph. Nothing is redrawn, recoloured or regenerated.

Sources (kept unchanged, archived under docs/assets/fresh-mart-source/):
  SRC-vegetables.png    1254x1254  -> vegetables
  SRC-fruits.png        1254x1254  -> fruits
  SRC-fruit-2panel.png  1774x887   -> exotic-fruits | seasonal-fruits
  SRC-veg-6panel.png    1536x1024  -> the six vegetable subcategories
"""
import os
import sys
import numpy as np
from PIL import Image

SRC = "/tmp/claude-0/fm-src"
EDGE = 800          # square output edge, in pixels
WEBP_QUALITY = 88


def ink_mask(arr, bg, threshold=24):
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


def grid(path, n_cols, n_rows):
    """Panel cell boxes, measured from the image."""
    arr = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    h, w, _ = arr.shape
    bg = arr[2, 2]
    ink = ink_mask(arr, bg)
    cols = runs(ink.sum(axis=0) / h > 0.02, w // (n_cols * 4))
    rows = runs(ink.sum(axis=1) / w > 0.02, h // (n_rows * 4))
    if len(cols) != n_cols or len(rows) != n_rows:
        raise SystemExit(
            f"{path}: expected {n_cols}x{n_rows} panels, measured {len(cols)}x{len(rows)}"
        )
    return arr, [[(c0, r0, c1, r1) for (c0, c1) in cols] for (r0, r1) in rows]


def strip_caption(arr, box):
    """
    Drop the caption bar from the bottom of a panel.

    FIRST ATTEMPT, AND WHY IT FAILED. Scanning up from the bottom while rows
    stayed "flat and pale" stopped on the first row of caption TEXT, because
    dark letters are neither flat nor pale — so every caption survived into
    the crop. Found by looking at the ten outputs, not by the script.

    WHAT WORKS. The caption bar has one tint behind its text. The panel's
    last row is certainly inside that bar, so its dominant colour IS the bar
    colour. Walking upward while that colour still dominates the row crosses
    the text lines (where it merely dominates slightly less) and stops where
    the photograph begins. The white gap above the bar is then removed by
    trim().
    """
    x0, y0, x1, y1 = box
    cell = arr[y0:y1, x0:x1]
    h = cell.shape[0]

    bar = np.median(cell[-3:].reshape(-1, 3), axis=0)
    near_bar = (np.abs(cell - bar).sum(axis=2) < 40).mean(axis=1)

    if near_bar[-1] < 0.5:
        return box  # no caption bar on this panel

    y = h - 1
    # Keep climbing while the bar colour still covers most of the row. Text
    # lines dip but stay well above a photograph, which is near zero.
    while y > h // 2 and near_bar[y] > 0.45:
        y -= 1
    return (x0, y0, x1, y0 + y + 1)


def trim(arr, box, pad_ratio=0.01):
    """Shrink a box to the drawn content, then add a small even margin."""
    x0, y0, x1, y1 = box
    cell = arr[y0:y1, x0:x1]
    bg = cell[1, 1]
    ink = ink_mask(cell, bg, threshold=30)
    ys, xs = np.where(ink)
    if len(xs) == 0:
        return box
    pad = int(min(x1 - x0, y1 - y0) * pad_ratio)
    nx0 = max(x0, x0 + xs.min() - pad)
    nx1 = min(x1, x0 + xs.max() + 1 + pad)
    ny0 = max(y0, y0 + ys.min() - pad)
    ny1 = min(y1, y0 + ys.max() + 1 + pad)
    return (nx0, ny0, nx1, ny1)


def square(im):
    """
    Centre-crop to a square WITHOUT stretching, padding with the image's own
    corner colour when the content is wider than it is tall — which it is for
    every panel here. Padding rather than cutting keeps the whole arrangement,
    which the brief requires ("retain the complete fruit arrangement").
    """
    w, h = im.size
    edge = max(w, h)
    bg = im.getpixel((1, 1))
    canvas = Image.new("RGB", (edge, edge), bg)
    canvas.paste(im, ((edge - w) // 2, (edge - h) // 2))
    return canvas.resize((EDGE, EDGE), Image.LANCZOS)


def save(im, out_dir, slug):
    os.makedirs(out_dir, exist_ok=True)
    webp = os.path.join(out_dir, f"{slug}.webp")
    im.save(webp, "WEBP", quality=WEBP_QUALITY, method=6)
    return webp, os.path.getsize(webp)


def whole_image(path, out_dir, slug):
    arr = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    box = trim(arr, (0, 0, arr.shape[1], arr.shape[0]))
    im = Image.open(path).convert("RGB").crop(box)
    return save(square(im), out_dir, slug), box


def panels(path, out_dir, n_cols, n_rows, names):
    arr, cells = grid(path, n_cols, n_rows)
    full = Image.open(path).convert("RGB")
    results = []
    i = 0
    for row in cells:
        for box in row:
            if i >= len(names):
                break
            box = strip_caption(arr, box)
            box = trim(arr, box)
            im = full.crop(box)
            results.append((names[i], save(square(im), out_dir, names[i]), box))
            i += 1
    return results


def main(out_dir):
    print(f"output: {out_dir}\n")

    for src, slug in (("SRC-vegetables.png", "vegetables"), ("SRC-fruits.png", "fruits")):
        (path, size), box = whole_image(os.path.join(SRC, src), out_dir, slug)
        print(f"{slug:20} <- {src:22} box={box}  {size // 1024} KB")

    print()
    for name, (path, size), box in panels(
        os.path.join(SRC, "SRC-fruit-2panel.png"), out_dir, 2, 1,
        ["exotic-fruits", "seasonal-fruits"],
    ):
        print(f"{name:20} <- SRC-fruit-2panel.png  box={box}  {size // 1024} KB")

    print()
    for name, (path, size), box in panels(
        os.path.join(SRC, "SRC-veg-6panel.png"), out_dir, 3, 2,
        ["fresh-vegetables", "leafy-vegetables", "roots-and-tubers",
         "onions-and-potatoes", "herbs-and-coriander", "cut-vegetables"],
    ):
        print(f"{name:20} <- SRC-veg-6panel.png   box={box}  {size // 1024} KB")

    files = sorted(f for f in os.listdir(out_dir) if f.endswith(".webp"))
    total = sum(os.path.getsize(os.path.join(out_dir, f)) for f in files)
    print(f"\n{len(files)} images, {total // 1024} KB total, all {EDGE}x{EDGE}")


if __name__ == "__main__":
    main(sys.argv[1])
