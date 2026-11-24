# RIK fresh catalogue thumbnails

Seventy product thumbnails — 44 Fresh Vegetable varieties and 26 Fresh Fruit
varieties — used by the RIK customer catalogue (STEP 12B).

They are referenced from the database, not from code: each row in
`rik.provisions` carries the path to its own picture in `image_ref`, and the
customer screen renders whatever that column says. Nothing in the application
derives a filename from a provision name, so renaming a provision cannot
silently break its picture and adding a picture needs no code change.

## Where they came from

Every file was extracted from the single client-supplied Fresh Vegetables +
Fresh Fruits catalogue sheet, which is the only visual source. No image was
generated, redrawn, enhanced, sharpened, recoloured or replaced, and none came
from the internet. Each file is pixel data lifted from that sheet by
connected-component extraction, resized with a Lanczos filter and centred on a
white canvas — nothing else was done to the artwork.

All 70 were QC verified before they were brought into the repository: correct
product-to-filename mapping, no captions, no borders, no neighbouring product,
nothing cut off, no duplicates. They are used here byte-for-byte as verified
and must not be cropped, renamed, re-exported or "improved" in place. If a
picture needs to change, replace the file and say so here.

## Format

800 × 800, RGB PNG, pure white background, product centred at about 78% of the
canvas, aspect ratio preserved.

## A known limitation

The source sheet is 1536 × 1024 for all seventy products together, so each
product is only around 114 × 97 px in the original. Filling an 800 × 800 canvas
enlarges it roughly five times, and these will look soft beside a thumbnail
photographed at full size. That softness is in the source, not in the
extraction, and it was left alone deliberately: sharpening would have altered
the products' appearance.

Replacing these with higher-resolution originals is a drop-in change — same
filenames, same paths, no database or code change — because `image_ref` already
points at the path rather than at the pixels.

## Caching

These files are **not** in the service worker's precache, and that is the right
outcome: the precache is the app shell only (`vite.config.ts` precaches
JavaScript, CSS, HTML, the manifest icons and the logo — 9 entries, ~376 KiB).
Precaching 17 MB of catalogue pictures would make a first visit download the
whole catalogue before the app became usable, which is the wrong trade on the
connections this app is used over. Confirmed by inspecting the generated
`dist/sw.js` after a build: no catalogue path appears in it.

They are therefore served as ordinary static assets, on demand. They are not
available offline. If offline browsing of the catalogue is wanted later, the
answer is a workbox runtime-caching rule scoped to `/catalogue/`, which is a
deliberate decision to take on its own rather than a side effect of adding
files here.
