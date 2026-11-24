"""
Split a supplied Grocers category sheet into individual category images.

    crop-grocers-category.py <category-slug> <source-dir> <output-dir>

ONE SCRIPT FOR THE REMAINING CATEGORIES. The first two categories each got
their own file, which was fine for two and would be silly for nineteen:
only three things actually differ per sheet — how many panels sit in each
row, which slug each panel belongs to, and the main category's own slug.
Those live in CATEGORIES below; everything else is shared.

The two earlier scripts are deliberately NOT retired into this one. Their
output is already installed and reviewed, and this file's padding and bar
detection differ enough that re-running them would produce different bytes
for assets that are signed off. They stay as the record of how those files
were made.

EVERY BOUNDARY COMES FROM THE PIXELS. Nothing is positioned by eye and no
dimension is hard-coded: rows and columns are measured as runs of
non-background, and the green label bar is found by its own hue. Rows may
hold different numbers of panels and panels may be different widths.

Nothing is redrawn, recoloured or regenerated. The originals are archived
unchanged under docs/assets/grocers-source/.
"""
import os
import re
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

EDGE = 800
WEBP_QUALITY = 88

# Per sheet: the panels in reading order paired with the APPROVED subcategory
# slug, and how many panels sit in each row. A slug of None means the sheet
# shows something the approved catalogue has no subcategory for — such a
# panel is cropped and kept but wired to nothing, because the catalogue is
# never reshaped to match a picture.
CATEGORIES = {
    "oil-and-ghee": {
        "titled": True,
        "border": True,
        "title": "Oil & Ghee",
        "rows": [4, 3],
        "tiles": [
            ("Sunflower Oil", "sunflower-oil"),
            ("Groundnut Oil", "groundnut-oil"),
            ("Rice Bran Oil", "rice-bran-oil"),
            ("Palm Oil", "palm-oil"),
            ("Coconut Oil", "coconut-oil"),
            ("Sesame Oil", "sesame-oil"),
            ("Ghee", "ghee"),
        ],
    },
    "salt-sugar-and-spices": {
        "titled": True,
        "border": True,
        "title": "Salt, Sugar & Spices",
        "rows": [5, 5],
        "tiles": [
            ("Salt", "salt"),
            ("Sugar", "sugar"),
            ("Jaggery", "jaggery"),
            ("Chilli Powder", "chilli-powder"),
            ("Turmeric", "turmeric"),
            ("Coriander Powder", "coriander-powder"),
            ("Pepper", "pepper"),
            ("Whole Spices", "whole-spices"),
            ("Garam Masala", "garam-masala"),
            ("Curry Masala", "curry-masala"),
        ],
    },
    "dairy-and-eggs": {
        "titled": True,
        "border": True,
        "title": "Dairy & Eggs",
        "rows": [3, 3, 3],
        "tiles": [
            ("Milk", "milk"),
            ("Curd", "curd"),
            ("Buttermilk", "buttermilk"),
            ("Paneer", "paneer"),
            ("Butter", "butter"),
            ("Cheese", "cheese"),
            ("Cream", "cream"),
            ("Lassi", "lassi"),
            ("Eggs", "eggs"),
        ],
    },
    # AN IRREGULAR SHEET, and the first one to be short a panel.
    #
    # Its rows hold three, two and one panel, of differing widths, sitting in
    # differing places — the Bakery Snacks panel is centred with white either
    # side. None of that needs special handling: columns are measured as runs
    # of non-background WITHIN each row, so position and width come from the
    # pixels. Only the per-row COUNT is declared.
    #
    # CAKES IS AN APPROVED SUBCATEGORY WITH NO PANEL on this sheet. It is
    # deliberately absent from this list rather than filled from a neighbour:
    # a Cakes shelf showing cookies would be a quiet lie, and the screens
    # already fall back to the category's own icon when no picture exists.
    "bakery": {
        "titled": True,
        "border": True,
        "title": "Bakery",
        "keep_full_width": ("cookies", "bakery-snacks"),
        "rows": [3, 2, 1],
        "tiles": [
            ("Bread", "bread"),
            ("Buns", "buns"),
            ("Pav", "pav"),
            ("Rusk", "rusk"),
            ("Cookies", "cookies"),
            ("Bakery Snacks", "bakery-snacks"),
        ],
    },
    # SHEET B, which matches the approved catalogue exactly: six panels for
    # six shelves, same names, same order. An earlier sheet carried nine
    # panels including four with no approved shelf; it was replaced rather
    # than reconciled, so no panel here is unmapped and no judgement call is
    # needed about what "Potato Chips" means.
    "biscuits-and-snacks": {
        "rows": [3, 3],
        # The locked tile style: product scene above, dark-green title
        # banner with bold white lettering across the bottom.
        "titled": True,
        "title": "Biscuits & Snacks",
        # Sheet B replaced the original nine-panel sheet; both are archived.
        "subs": "SRC-biscuits-and-snacks-sheet-b.png",
        "tiles": [
            ("Biscuits", "biscuits"),
            ("Chips", "chips"),
            ("Namkeen", "namkeen"),
            ("Mixtures", "mixtures"),
            ("Popcorn", "popcorn"),
            ("Fryums", "fryums"),
        ],
    },
    # Three panels then two. The second row's pair is centred with white
    # either side, which needs no special handling: columns are measured as
    # runs of non-background within each row.
    #
    # NOTE ON "Wafers": this is Chocolates & Confectionery's own shelf, not
    # Bakery's. The slug `wafers` belongs to this main alone across all
    # nineteen, so the bare-slug image map cannot confuse the two.
    "chocolates-and-confectionery": {
        "rows": [3, 2],
        "titled": True,
        "title": "Chocolates & Confectionery",
        "tiles": [
            ("Chocolates", "chocolates"),
            ("Candies", "candies"),
            ("Toffees", "toffees"),
            ("Wafers", "wafers"),
            ("Chewing Gum", "chewing-gum"),
        ],
    },
    # Two rows of three. The pair to watch is Instant Coffee and Tea
    # Premixes: adjacent panels, both jars-and-a-cup, easy to transpose by
    # miscounting a row. The tile order below is reading order and the
    # contact sheet is checked against it by eye before anything is mapped.
    "tea-and-coffee": {
        "rows": [3, 3],
        "titled": True,
        "title": "Tea & Coffee",
        "tiles": [
            ("Tea", "tea"),
            ("Green Tea", "green-tea"),
            ("Coffee", "coffee"),
            ("Instant Coffee", "instant-coffee"),
            ("Tea Premixes", "tea-premixes"),
            ("Health Drinks", "health-drinks"),
        ],
    },
    # Two rows of three. FOUR LOOK-ALIKE SHELVES here, not two: Soft Drinks
    # and Soda are both clear-and-cola bottles with ice; Juices and Fruit
    # Drinks are both orange cartons and filled glasses. Reading order is
    # declared below and checked against the contact sheet by eye, because
    # no automated check can tell a juice carton from a fruit-drink carton.
    "beverages": {
        "rows": [3, 3],
        "titled": True,
        "title": "Beverages",
        # Full-bleed sheet: no surround, only hairline white gutters.
        "bleed": True,
        "tiles": [
            ("Soft Drinks", "soft-drinks"),
            ("Juices", "juices"),
            ("Energy Drinks", "energy-drinks"),
            ("Fruit Drinks", "fruit-drinks"),
            ("Packaged Water", "packaged-water"),
            ("Soda", "soda"),
        ],
    },
    # Four panels then three, and the two rows have DIFFERENT panel widths —
    # about 381px across the top, about 528px across the bottom. Nothing
    # here assumes a uniform grid: columns are measured inside each row
    # band, so the widths fall out of the gutters rather than being divided.
    #
    # THREE LOOK-ALIKE SHELVES: Ready-to-Eat, Ready-to-Cook and Instant
    # Mixes are all pouches behind bowls of prepared food. Checked by eye on
    # the contact sheet, and a test asserts the three resolve to different
    # files.
    "instant-and-packaged-foods": {
        "rows": [4, 3],
        "bleed": True,
        "titled": True,
        "title": "Instant & Packaged Foods",
        "tiles": [
            ("Noodles", "noodles"),
            ("Pasta", "pasta"),
            ("Vermicelli", "vermicelli"),
            ("Ready-to-Eat", "ready-to-eat"),
            ("Ready-to-Cook", "ready-to-cook"),
            ("Soup", "soup"),
            ("Instant Mixes", "instant-mixes"),
        ],
    },
    # Breakfast & Cereals: the same full-bleed 4-over-3 shape, and again the
    # two bands are measured independently — the top row's panels run about
    # 384 px and the bottom row's about 512 px, so one uniform grid would
    # slice every bottom panel across its neighbour.
    #
    # FOUR CEREAL-BOX SHELVES: Oats, Corn Flakes, Muesli and Cereals are all
    # boxes behind a bowl. Checked by eye on the contact sheet at full size,
    # and a test asserts all seven resolve to different files.
    "breakfast-and-cereals": {
        "rows": [4, 3],
        "bleed": True,
        "titled": True,
        "title": "Breakfast & Cereals",
        "tiles": [
            ("Oats", "oats"),
            ("Corn Flakes", "corn-flakes"),
            ("Muesli", "muesli"),
            ("Cereals", "cereals"),
            ("Poha", "poha"),
            ("Dalia", "dalia"),
            ("Breakfast Mixes", "breakfast-mixes"),
        ],
    },
    # Sauces, Pickles & Spreads: full-bleed again, four over four. Measured,
    # not assumed: this sheet's two bands happen to share their column
    # gutters (~385 / 768 / 1152), unlike the last two sheets, so the eight
    # panels do come out near-equal — but the measurement is what decides it.
    #
    # FOUR POURED-CONDIMENT SHELVES: Ketchup, Sauces, Mayonnaise and Chutney
    # are all bottles behind small bowls of sauce. Read off the contact sheet
    # by eye, and a test asserts all eight resolve to different files.
    "sauces-pickles-and-spreads": {
        "rows": [4, 4],
        "bleed": True,
        "titled": True,
        "title": "Sauces, Pickles & Spreads",
        "tiles": [
            ("Pickles", "pickles"),
            ("Ketchup", "ketchup"),
            ("Sauces", "sauces"),
            ("Mayonnaise", "mayonnaise"),
            ("Jam", "jam"),
            ("Honey", "honey"),
            ("Peanut Butter", "peanut-butter"),
            ("Chutney", "chutney"),
        ],
    },
    # Frozen & Ice Cream: full-bleed, TWO over THREE — the most lopsided
    # sheet so far. Measured: the single top gutter sits at 767-774, so the
    # two top panels run about 770px; the bottom gutters at 508-515 and
    # 1024-1032 give three panels of about 511px. A uniform grid would cut
    # every panel on this sheet across its neighbour.
    #
    # TWO FROZEN-PACKET SHELVES: Frozen Vegetables and Frozen Snacks are
    # both printed pouches standing behind bowls. Read off the contact
    # sheet by eye, and a test asserts all five resolve to different files.
    "frozen-and-ice-cream": {
        "rows": [2, 3],
        "bleed": True,
        "titled": True,
        "title": "Frozen & Ice Cream",
        "tiles": [
            ("Ice Cream", "ice-cream"),
            ("Kulfi", "kulfi"),
            ("Frozen Vegetables", "frozen-vegetables"),
            ("Frozen Snacks", "frozen-snacks"),
            ("Frozen Paratha", "frozen-paratha"),
        ],
    },
    # Home Cleaning: full-bleed, four over three. Row gutter 506-512; top
    # band gutters at 381/768/1154 give four panels of about 381px, bottom
    # band gutters at 513/1022 give three of about 511px — measured per
    # band, not divided.
    #
    # THE TOP PANELS HERE ARE TALL, not wide: 0.88:1 against a photo region
    # of 1.21:1, so the cover-crop keeps 73% of their HEIGHT. Checked panel
    # against tile by eye before accepting it: what the crop removes is
    # foreground props and background (folded towels, a bowl of powder, the
    # washing machine, the toilet brush), not any of the branded packs,
    # every one of which survives and ends up larger. That is the opposite
    # of the Frozen sheet, where the equivalent loss deleted whole products
    # and the WIDE_PANEL branch was added instead.
    "home-cleaning": {
        "rows": [4, 3],
        "bleed": True,
        "titled": True,
        "title": "Home Cleaning",
        "tiles": [
            ("Detergent", "detergent"),
            ("Dishwash", "dishwash"),
            ("Floor Cleaner", "floor-cleaner"),
            ("Toilet Cleaner", "toilet-cleaner"),
            ("Glass Cleaner", "glass-cleaner"),
            ("Fabric Care", "fabric-care"),
            ("Garbage Bags", "garbage-bags"),
        ],
    },
    # Personal Care: full-bleed, three over three over three. It LOOKS like
    # a regular 3x3, and the columns are (gutters at ~511 and ~1026), but
    # the ROWS are not: the gutters at 332-339 and 654-660 give bands of
    # 332px, 315px and 364px. Splitting the sheet into nine equal squares
    # would slide every row off its panel. Measured per band, as always.
    "personal-care": {
        "rows": [3, 3, 3],
        "bleed": True,
        "titled": True,
        "title": "Personal Care",
        "tiles": [
            ("Bath Soap", "bath-soap"),
            ("Shampoo", "shampoo"),
            ("Hair Oil", "hair-oil"),
            ("Toothpaste", "toothpaste"),
            ("Toothbrush", "toothbrush"),
            ("Face Wash", "face-wash"),
            ("Creams", "creams"),
            ("Deodorants", "deodorants"),
            ("Shaving", "shaving"),
        ],
    },
    # Baby Care: full-bleed, three over two. Row gutter 504-509; top band
    # gutters at 511/1026 give three panels of about 511px, bottom band a
    # single gutter at 768 giving two of about 768px. The bands differ, so
    # they are measured separately.
    #
    # ONLY FIVE PANELS FOR SIX APPROVED SHELVES. The approved tree carries
    # Diapers first, and the supplied sheet has no Diapers panel, so that
    # shelf deliberately stays on its icon and is named in the test file's
    # AWAITING_ARTWORK list. The MAIN artwork does show diaper packs, but a
    # fragment cut out of the main image is not a shelf photograph and the
    # catalogue is never reshaped to match whatever artwork arrives.
    "baby-care": {
        "rows": [3, 2],
        "bleed": True,
        "titled": True,
        "title": "Baby Care",
        "tiles": [
            ("Baby Food", "baby-food"),
            ("Baby Soap", "baby-soap"),
            ("Baby Shampoo", "baby-shampoo"),
            ("Baby Lotion", "baby-lotion"),
            ("Baby Wipes", "baby-wipes"),
        ],
    },
    # Pooja & Household Essentials: full-bleed, four over four. Row gutter
    # 508-515; both bands share column gutters at 384/768/1151, so the
    # eight panels do come out near-equal at about 384px — measured, not
    # assumed.
    #
    # THE MAIN TILE IS NOT BUILT FROM THIS CONFIG. The supplied square main
    # artwork contains a brass deity statue, which the brief for this
    # category explicitly rules out, so it was archived but not installed
    # and the main keeps its icon until a replacement is supplied. Run this
    # with a source directory holding only the subs sheet, so the cropper
    # takes its "no main sheet supplied" path rather than writing one.
    #
    # EIGHT UNRELATED SHELVES, two traps: Agarbatti vs Camphor (both are
    # red-and-gold pooja packaging over brass) and Tissue vs Aluminium Foil
    # (both are flat printed cartons). Read off the contact sheet by eye.
    "pooja-and-household-essentials": {
        "rows": [4, 4],
        "bleed": True,
        "titled": True,
        "title": "Pooja & Household Essentials",
        "tiles": [
            ("Agarbatti", "agarbatti"),
            ("Camphor", "camphor"),
            ("Pooja Oil", "pooja-oil"),
            ("Wicks", "wicks"),
            ("Match Boxes", "match-boxes"),
            ("Batteries", "batteries"),
            ("Tissue", "tissue"),
            ("Aluminium Foil", "aluminium-foil"),
        ],
    },
    # Pet Care: full-bleed, two over two — the last Grocers category. It
    # looks like a plain quartered square and is not: the row gutter sits
    # at 492-501, so the bands are 492px and 523px tall, while both share
    # one column gutter at 768. Measured per band like every other sheet.
    #
    # The panels come out around 1.5:1 to 1.9:1 after the caption bar is
    # stripped, so the wider ones take the WIDE_PANEL path rather than
    # losing the product at each end.
    "pet-care": {
        "rows": [2, 2],
        "bleed": True,
        "titled": True,
        "title": "Pet Care",
        "tiles": [
            ("Dog Food", "dog-food"),
            ("Cat Food", "cat-food"),
            ("Pet Treats", "pet-treats"),
            ("Pet Accessories", "pet-accessories"),
        ],
    },
    # Rice, Atta & Flour — folded in from scripts/crop-grocers-rice-atta-flour.py.
    # THE SHEET IS IRREGULAR: five panels on its first row, six on its second,
    # plus a full-width title band of its own at the top. The shared cells()
    # measures columns WITHIN each band and drops any band shorter than 12% of
    # the sheet, which is what discards that title band — verified against this
    # sheet before the entry was added (11 panels measured, 11 expected).
    #
    # TWO PANELS HAVE NO APPROVED SHELF: Broken Rice and Poha / Flattened Rice.
    # They keep slug None, so they are written as unmapped-*.webp and wired to
    # nothing. The catalogue is NOT extended to match the picture.
    #
    # "main" override: this archive predates the slug (SRC-rice-atta-flour-*).
    "rice-atta-and-flour": {
        "rows": [5, 6],
        "titled": True,
        "border": True,
        "title": "Rice, Atta & Flour",
        "subs": "SRC-rice-atta-flour-subs.png",
        "main": "SRC-rice-atta-flour-main.png",
        "tiles": [
            # The banner text is the APPROVED CATALOGUE NAME, not the label
            # printed on the source sheet. The sheet says "Raw Rice",
            # "Wheat Flour (Atta)", "Besan (Gram Flour)", "Rava (Suji)" and
            # "Sona Masoori Rice"; the catalogue says Rice, Atta, Besan,
            # Rava/Sooji and Sona Masoori. The catalogue wins — a shelf's
            # tile must read the same as the shelf.
            ("Basmati Rice", "basmati-rice"),
            ("Sona Masoori", "sona-masoori"),
            ("Rice", "rice"),
            ("Brown Rice", "brown-rice"),
            ("Broken Rice", None),
            ("Poha / Flattened Rice", None),
            ("Atta", "atta"),
            ("Maida", "maida"),
            ("Besan", "besan"),
            ("Rava/Sooji", "rava-sooji"),
            ("Multigrain Flour", "multigrain-flour"),
        ],
    },
    # Dal & Pulses — folded in from scripts/crop-grocers-dal-and-pulses.py.
    # Three bands of three. Every panel runs 1.81:1 to 2.06:1, so all nine
    # take the WIDE_PANEL route; the trim costs 4.5-11% per side, which on
    # this sheet is backdrop either side of a single pack and bowl.
    "dal-and-pulses": {
        "rows": [3, 3, 3],
        "titled": True,
        "border": True,
        "title": "Dal & Pulses",
        "tiles": [
            ("Toor Dal", "toor-dal"),
            ("Moong Dal", "moong-dal"),
            ("Masoor Dal", "masoor-dal"),
            ("Urad Dal", "urad-dal"),
            ("Chana Dal", "chana-dal"),
            ("Rajma", "rajma"),
            ("Kabuli Chana", "kabuli-chana"),
            ("Green Gram", "green-gram"),
            ("Black Gram", "black-gram"),
        ],
    },
}


def slugify(label):
    """The tree's own slug rule: lowercase, & becomes "and", the rest hyphens."""
    out = re.sub(r"[^a-z0-9]+", "-", label.lower().replace("&", " and "))
    return out.strip("-")


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


def strip_label(arr, box, search_from=0.55, anchor=0.60, edge=0.25, reaches=0.65):
    """
    Remove the green label bar, and everything below it, from a panel.

    BAR-GREEN IS A NARROW COLOUR, not "greenish". The bar is a dark saturated
    green; leaves, palm fronds and green packaging are brighter or more
    olive. Bounding the green channel separates them cleanly.

    ANCHOR, THEN WALK UP. Two failures shaped this:

      1. Taking the top of the last unbroken run left five of ten Dal crops
         still wearing part of their label: the bar's own white lettering
         ("Black Gram" in 48pt) breaks the run into pieces and the last piece
         starts well below the bar's real top.

      2. Taking the topmost row over a single threshold cut Groundnut Oil and
         Palm Oil in half: leaves and palm fronds at mid-panel score 0.34
         against the bar's 0.42-0.99, which is too close to separate with one
         number.

    So the bar is first ANCHORED on a row that is unambiguously bar
    (`anchor`), and the cut then walks UP from there while rows stay plausibly
    bar (`edge`). Foliage far above the bar is never contiguous with it — the
    rows between score zero — so it cannot pull the cut up.

    Returns the box unchanged when no bar is found, which is the honest
    outcome for a panel that has none.
    """
    x0, y0, x1, y1 = box
    cell = arr[y0:y1, x0:x1]
    h = cell.shape[0]

    r, g, b = cell[:, :, 0], cell[:, :, 1], cell[:, :, 2]
    bar = ((g > r + 25) & (g > b + 25) & (g > 50) & (g < 170)).mean(axis=1)

    strong = [y for y in range(int(h * search_from), h) if bar[y] > anchor]
    # The bar must sit LOW in the panel, but it need not touch the foot.
    # Requiring it to reach the last 8% was a second safety net on top of
    # `anchor`, and it rejected three Instant & Packaged Foods panels whose
    # caption pill floats above a margin of counter: their bar ends at 86%
    # of panel height, not 98%. `anchor` alone already separates a bar
    # (0.6-0.99 across the width) from green objects in a photograph
    # (0.37 at worst, measured across these sheets), so the net can be
    # looser without letting foliage through.
    if not strong or max(strong) < h * reaches:
        return box

    cut = min(strong)
    while cut > 0 and bar[cut - 1] > edge:
        cut -= 1
    return (x0, y0, x1, y0 + cut)


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


def square(im, fill="flat"):
    """
    Make a square. NEVER stretches and never crops the photograph.

    TWO WAYS TO FILL THE LEFTOVER SPACE, and the difference matters:

      'flat'  — a solid band in the photograph's own backdrop colour, taken
                as the median of its top rows. Fine when the panel is close
                to square, which is all it was first used for.

      'blur'  — the photograph itself, scaled to cover the square and blurred,
                with the sharp photograph composited over it. Use this when
                the panel is markedly wider than it is tall.

    WHY 'blur' EXISTS. A 2:1 panel padded flat is a strip of food between two
    large flat bands, and at thumbnail size the bands are most of what you
    see. That was the defect in the first Biscuits & Snacks crops. Cropping
    to a square instead would have cut two of the three packs off the sides,
    so the fill had to get better rather than the crop getting tighter. The
    blurred layer is the panel's own pixels, so the tile reads as one
    photograph rather than a photograph in a box.
    """
    w, h = im.size
    edge = max(w, h)

    if fill == "blur":
        scale = edge / min(w, h)
        back = im.resize((max(edge, int(w * scale)), max(edge, int(h * scale))), Image.LANCZOS)
        left = (back.width - edge) // 2
        top_ = (back.height - edge) // 2
        canvas = back.crop((left, top_, left + edge, top_ + edge))
        canvas = canvas.filter(ImageFilter.GaussianBlur(radius=max(8, edge // 28)))
        # Knock the backdrop back a little so the sharp photograph leads.
        canvas = ImageEnhance.Brightness(canvas).enhance(0.88)
    else:
        top = np.asarray(im)[: max(1, h // 16)].reshape(-1, 3)
        canvas = Image.new("RGB", (edge, edge), tuple(int(v) for v in np.median(top, axis=0)))

    canvas.paste(im, ((edge - w) // 2, (edge - h) // 2))
    return canvas.resize((EDGE, EDGE), Image.LANCZOS)


# Above this panel aspect ratio, cover-cropping to a square would clip the
# products at the far left and right rather than a few percent of margin, so
# titled_square() fits the full width and backs it with the blurred
# photograph instead. Sheets so far run 1.20:1 to 1.26:1, except the
# Frozen & Ice Cream top row at 1.87:1.
WIDE_PANEL = 1.45
# A wide panel is first trimmed to at most this ratio — the extreme edges of
# such a panel are backdrop, and trimming them keeps the products larger and
# the backdrop strip smaller than fitting the raw panel would.
WIDE_TARGET = 1.65
BANNER_GREEN = (1, 82, 45)  # sampled from the supplied sheets' own caption pills
# Mean of the yellow stroke measured on the four approved supplied-square
# tiles, and its measured width. Used only where a config asks for it.
BANNER_BORDER = (243, 217, 29)
BANNER_STROKE = 4
BANNER_FONT = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"


def titled_square(im, title, band=0.175, border=False, trim_wide=True):
    """
    An 800x800 tile: the product photograph above, a dark-green title banner
    with bold white lettering across the bottom.

    WHY THE BANNER IS REDRAWN rather than kept from the sheet. The sheet's
    own caption pill sits at whatever size the sheet chose, is cut by the
    panel boundary, and carries the sheet's wording rather than the approved
    label. Stripping it and drawing a fresh one makes every tile in the
    catalogue identical in band height, colour, weight and alignment, and
    makes the text the APPROVED name.

    WHY THERE IS NO PADDING COLOUR. The photograph is cover-cropped into the
    region above the band, so it fills the full width edge to edge. Nothing
    is stretched, and there is no flat area left to fill — the band is not
    padding, it is the design.

    WHAT THE COVER-CROP COSTS, measured rather than assumed. Most sheets
    give panels of about 1.20:1 to 1.26:1 against a region of about 1.21:1,
    so the crop costs under 2% of width. That is NOT universal: the
    Frozen & Ice Cream sheet's two top panels are 1.87:1, where the same
    cover-crop keeps only ~65% of the width and clips whatever sits at the
    far left and right of the panel. Before adding a sheet whose panels are
    much wider than ~1.3:1, measure the loss and decide deliberately
    whether to accept the clipping or to compose those panels differently.
    """
    edge = EDGE
    band_h = int(edge * band)
    photo_h = edge - band_h

    canvas = Image.new("RGB", (edge, edge), BANNER_GREEN)
    if im.width / im.height > WIDE_PANEL:
        # A panel this wide cannot be cover-cropped without throwing away
        # the products at its far left and right — on the Frozen sheet that
        # removed a whole tub from each end. So the photograph is fitted to
        # the FULL WIDTH instead, nothing clipped, and the space left above
        # and below it is filled with the same photograph blown up and
        # blurred: an image-derived backdrop, never a flat colour band.
        # Trim the extreme left and right first, down to WIDE_TARGET. On the
        # Frozen sheet that is pure backdrop — the outermost tub and kulfi
        # pack stay whole and get bigger — and it shrinks the backdrop strip
        # from 116px to 87px. Compared by eye at three ratios before
        # settling on this one.
        #
        # trim_wide=False switches that off for a panel where the trim would
        # cut into the products rather than the margin. Bakery's Cookies
        # (2.40:1) and Bakery Snacks (3.02:1) are the cases: at WIDE_TARGET
        # they lost 15.6% and 22.8% of width per side, which cut "Good Day",
        # "Sunfeast Marie Light", "Baked Khari" and "Cream Roll" into
        # fragments. Compared side by side before choosing.
        if trim_wide and im.width / im.height > WIDE_TARGET:
            keep = int(im.height * WIDE_TARGET)
            off = (im.width - keep) // 2
            im = im.crop((off, 0, off + keep, im.height))

        fit_h = round(im.height * edge / im.width)
        back_scale = max(edge / im.width, photo_h / im.height)
        back = im.resize(
            (round(im.width * back_scale), round(im.height * back_scale)), Image.LANCZOS
        )
        back = back.crop(
            (
                (back.width - edge) // 2,
                (back.height - photo_h) // 2,
                (back.width - edge) // 2 + edge,
                (back.height - photo_h) // 2 + photo_h,
            )
        ).filter(ImageFilter.GaussianBlur(radius=max(10, edge // 24)))
        back = ImageEnhance.Brightness(back).enhance(0.82)
        canvas.paste(back, (0, 0))
        canvas.paste(im.resize((edge, fit_h), Image.LANCZOS), (0, (photo_h - fit_h) // 2))
    else:
        scale = max(edge / im.width, photo_h / im.height)
        shot = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        left = (shot.width - edge) // 2
        top = (shot.height - photo_h) // 2
        canvas.paste(shot.crop((left, top, left + edge, top + photo_h)), (0, 0))

    draw = ImageDraw.Draw(canvas)
    draw.rectangle([0, photo_h, edge, edge], fill=BANNER_GREEN)

    # Largest size that fits the band with room to breathe, down to a floor
    # that keeps the label readable at thumbnail size.
    max_w, max_h = int(edge * 0.88), int(band_h * 0.62)
    size = int(band_h * 0.62)
    while size > 28:
        font = ImageFont.truetype(BANNER_FONT, size)
        box = draw.textbbox((0, 0), title, font=font)
        if box[2] - box[0] <= max_w and box[3] - box[1] <= max_h:
            break
        size -= 2
    font = ImageFont.truetype(BANNER_FONT, size)
    box = draw.textbbox((0, 0), title, font=font)
    draw.text(
        ((edge - (box[2] - box[0])) // 2 - box[0], photo_h + (band_h - (box[3] - box[1])) // 2 - box[1]),
        title,
        font=font,
        fill=(255, 255, 255),
    )
    if border:
        # The yellow outline, measured off the approved supplied-square
        # artwork rather than invented: the pills on diapers, pet-care,
        # pooja and cakes carry a 4px stroke at rgb(241,214,33) /
        # (247,213,27) / (248,217,12) / (237,224,42). BANNER_BORDER is
        # their mean. The band here is full width, so the outline is the
        # band's own rectangle: a rule along its top edge, continuing down
        # the sides and along the bottom at the tile boundary.
        #
        # DEFAULTS TO OFF on purpose. Categories 7-19 were approved without
        # it, so leaving it off by default keeps every one of those tiles
        # byte-reproducible from this script.
        draw.rectangle(
            [0, photo_h, edge - 1, edge - 1], outline=BANNER_BORDER, width=BANNER_STROKE
        )
    return canvas


def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, "WEBP", quality=WEBP_QUALITY, method=6)
    return os.path.getsize(path)


def segments(end, gutters):
    """The spans BETWEEN gutters, over 0..end. Edge gutters are absorbed."""
    out, cursor = [], 0
    for g0, g1 in gutters:
        if g0 - cursor > 8:
            out.append((cursor, g0))
        cursor = g1
    if end - cursor > 8:
        out.append((cursor, end))
    return out


def cells_bleed(path, row_counts, white_level=232, cover=0.70, min_gutter=3):
    """
    Panel boundaries for a FULL-BLEED sheet, found from its white gutters.

    WHY A SECOND MODE. `cells` below finds panels as runs of non-background,
    which works when the sheet has a plain surround — a white card with
    panels floating on it. The Beverages sheet has no surround: the artwork
    runs to all four edges and the only thing separating panels is a hairline
    of white. Measured against the corner pixel, every row of that sheet is
    "ink", so `cells` saw one row where there are two.

    Here the gutters are the signal: rows and columns that are almost
    entirely white. The panels are what lies between them. Columns are found
    within each row band, so rows may still hold different numbers of panels.
    """
    arr = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    h, w, _ = arr.shape
    white = (arr > white_level).all(axis=2)

    rows = segments(h, runs(white.mean(axis=1) > cover, min_gutter))
    if len(rows) != len(row_counts):
        raise SystemExit(f"{path}: expected {len(row_counts)} panel rows, measured {len(rows)}")

    out = []
    for (r0, r1), n in zip(rows, row_counts):
        band = white[r0:r1]
        cols = segments(w, runs(band.mean(axis=0) > cover, min_gutter))
        if len(cols) != n:
            raise SystemExit(f"{path}: row {r0}-{r1} expected {n} panels, measured {len(cols)}")
        out.extend((c0, r0, c1, r1) for (c0, c1) in cols)
    return arr, out


def cells(path, row_counts):
    """Row bands first, then columns measured inside each row."""
    arr = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    h, w, _ = arr.shape
    bg = arr[2, 2]
    m = ink(arr, bg)
    rows = runs(m.sum(axis=1) / w > 0.02, h // (len(row_counts) * 5))
    rows = [r for r in rows if (r[1] - r[0]) > h * 0.12]
    if len(rows) != len(row_counts):
        raise SystemExit(f"{path}: expected {len(row_counts)} panel rows, measured {len(rows)}")

    out = []
    for (r0, r1), n in zip(rows, row_counts):
        band = m[r0:r1]
        cols = runs(band.sum(axis=0) / (r1 - r0) > 0.04, w // (n * 6))
        if len(cols) != n:
            raise SystemExit(f"{path}: row {r0}-{r1} expected {n} panels, measured {len(cols)}")
        out.extend((c0, r0, c1, r1) for (c0, c1) in cols)
    return arr, out


def main(slug, src_dir, out_dir):
    spec = CATEGORIES.get(slug)
    if spec is None:
        raise SystemExit(f"no sheet configuration for '{slug}' — add one to CATEGORIES")

    subs_src = spec.get("subs") or f"SRC-{slug}-subs.png"
    subs_src = os.path.join(src_dir, subs_src)
    if not os.path.exists(subs_src):
        raise SystemExit(f"source image missing, nothing was written: {subs_src}")

    # A re-crop supplies only a subcategory sheet: the approved main-category
    # banner stays exactly as it is rather than being regenerated.
    #
    # "main" mirrors the existing "subs" override, for the one archive whose
    # filename predates the slug: Rice is filed as SRC-rice-atta-flour-main
    # .png, not SRC-rice-atta-and-flour-main.png. Every other category omits
    # the key and keeps the derived name.
    main_src = os.path.join(src_dir, spec.get("main") or f"SRC-{slug}-main.png")
    if not os.path.exists(main_src):
        print(f"no main-category sheet supplied — leaving {slug}.webp untouched\n")
        main_src = None

    fill = spec.get("fill", "flat")
    titled = spec.get("titled", False)
    border = spec.get("border", False)
    # Panels whose products the WIDE_TARGET pre-trim would cut into rather
    # than merely de-margin. Named per slug, decided by eye, never guessed.
    keep_full = set(spec.get("keep_full_width", ()))

    # ---- main category: one photograph with a green title banner ----
    if main_src is None:
        print(f"MAIN  {slug}.webp left as it is — no main sheet supplied")
    else:
        arr = np.asarray(Image.open(main_src).convert("RGB")).astype(np.int16)
        box = trim(arr, strip_label(arr, (0, 0, arr.shape[1], arr.shape[0])))
        shot = Image.open(main_src).convert("RGB").crop(box)
        made = (
            titled_square(shot, spec["title"], border=border)
            if titled
            else square(shot, fill)
        )
        size = save(made, os.path.join(out_dir, f"{slug}.webp"))
        print(f"MAIN  {slug}.webp  box={box}  {size // 1024} KB")

    # ---- the subcategory panels ----
    finder = cells_bleed if spec.get("bleed") else cells
    arr, boxes = finder(subs_src, spec["rows"])
    tiles = spec["tiles"]
    if len(boxes) != len(tiles):
        raise SystemExit(f"measured {len(boxes)} panels, expected {len(tiles)}")
    full = Image.open(subs_src).convert("RGB")

    print()
    for (label, sub), box in zip(tiles, boxes):
        cropped = trim(arr, strip_label(arr, box))
        # An unmapped panel is named from its caption, by the SAME rule the
        # tree's slugs use (lowercase; & becomes "and"; anything else that is
        # not a letter, digit or hyphen becomes a hyphen). Taking the caption
        # literally once produced "unmapped-nuts-&-dry-snacks.webp", and an
        # ampersand in a path is a query string waiting to happen.
        name = sub if sub is not None else "unmapped-" + slugify(label)
        shot = full.crop(cropped)
        made = (
            titled_square(shot, label, border=border, trim_wide=(sub not in keep_full))
            if titled
            else square(shot, fill)
        )
        size = save(made, os.path.join(out_dir, f"{name}.webp"))
        kept = (cropped[3] - cropped[1]) / (box[3] - box[1])
        mark = "->" if sub is not None else "-> (no approved subcategory)"
        print(f"{label:16} {mark} {name + '.webp':22} box={cropped}  kept {kept:.0%}  {size // 1024} KB")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__.strip().splitlines()[2].strip())
    main(sys.argv[1], sys.argv[2], sys.argv[3])
