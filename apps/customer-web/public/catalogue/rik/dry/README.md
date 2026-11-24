# RIK dry catalogue thumbnails

103 product thumbnails covering 103 of the 106 dry-catalogue provisions, in one
folder per catalogue category (STEP 12C-2).

They are referenced from the database, not from code: each row in
`rik.provisions` carries the path to its own picture in `image_ref`, and the
customer screen renders whatever that column says. Nothing derives a filename
from a provision name, so renaming a provision cannot silently break its
picture.

## Where they came from

The client supplied no product photographs, so these were extracted from four
generated category reference sheets — the only visual source. Every file is
pixel data lifted from one of those sheets by connected-component isolation,
resized and centred on a white canvas. Nothing was generated, redrawn,
enhanced, recoloured or replaced, and none came from the internet.

All 103 were QC verified in STEP 12C-1 before integration: correct
product-to-code mapping, no captions, no borders, no neighbouring product,
nothing cut off, no duplicates, every category checked by eye on labelled
contact sheets. They are used byte-for-byte as verified and must not be
cropped, renamed or re-exported in place.

## The text inside these images is not authoritative

These are generated references, and the packaging in them prints brands and
pack sizes that the approved catalogue does not record — the oil bottles carry
a brand the catalogue leaves blank, several packs carry figures the catalogue
does not hold. **None of it was used.** The catalogue is the source of truth for
every name, brand and pack size; these files are pictures and nothing more.

## The four oil pack-size variants

`oil/` holds six files rather than four. The source sheet shows one sunflower
bottle and one mustard bottle, while the catalogue carries each in two pack
sizes, so each of those two visuals exists twice — once labelled **500 ml** and
once **1 Litre** — giving all four oil SKUs a picture of their own. Each variant
is the same verified bottle, unaltered, placed slightly smaller on the canvas
with the pack size set in the clear space beneath it; the artwork itself is
never drawn over.

**Read the label on those four as a picture, not as data.** The catalogue
records these packs as `pack_size` 500 and 1000 with the entitlement unit `g`,
and `pack_unit` is NULL. The difference between "500 ml" on the image and 500 g
in the row is a known, documented and deliberately unresolved catalogue-data
question — see the STEP 12C-2 report. No database value was changed to match the
image, and none should be without a business decision.

## Three provisions deliberately have no picture

`OIL_HYDROGENATED`, `TEA_LOOSE` and `COFFEE_LOOSE` are not depicted on any
supplied sheet. Their `image_ref` is NULL and the customer screen shows its
neutral placeholder for them. Nothing was substituted, and nothing should be:
lending one of these another product's photograph would misrepresent what an
officer is choosing.

## Format

800 × 800, RGB PNG, pure white background, product centred, aspect ratio
preserved. The same convention as the fresh set.

## Resolution, and caching

Each source sheet is 1536 × 1024 for a whole category at once, so a product is
only a couple of hundred pixels in the original and is enlarged to fill the
canvas. These will look soft beside a thumbnail photographed at full size. No
sharpening was applied, because that would alter the products' appearance.
Replacing them with higher-resolution originals later is a drop-in change —
same filenames, same paths, no database or code change.

These files are **not** in the service worker's precache, which stays the app
shell only; they are served as ordinary static assets and are not available
offline. See the fresh folder's README for the same note.
