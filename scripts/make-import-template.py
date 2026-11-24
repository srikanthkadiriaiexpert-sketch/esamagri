"""
Builds the catalogue import template for Grocers and Fresh Mart.

The column headers are NOT invented: they are the aliases the existing
importer already accepts (apps/api/src/pif/services/pif-import-sheet.ts),
so a completed sheet uploads through the admin panel's own flow with no
code change. One sheet per business, a reference sheet listing every valid
category and subcategory, and a notes sheet recording what is still blocked.
"""
import os
import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TREE = os.path.join(ROOT, "apps", "customer-web", "src", "lib", "businesses", "category-tree.ts")

HEAD_FILL = PatternFill("solid", fgColor="087A35")
HEAD_FONT = Font(name="Arial", bold=True, color="FFFFFF", size=10)
REQ_FILL = PatternFill("solid", fgColor="FFF8DC")   # cells that must be filled
BODY = Font(name="Arial", size=10)
NOTE = Font(name="Arial", size=10, italic=True, color="5A6660")
TITLE = Font(name="Arial", bold=True, size=13)
THIN = Side(style="thin", color="DCDBD3")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# (header the importer accepts, width, required?, note)
COLUMNS = [
    ("SKU",            14, True,  "Your own code. Must be unique across the whole catalogue."),
    ("Name",           34, True,  "Exactly as it should read to a customer."),
    ("Brand",          16, False, "MANUFACTURER only - Amul, Tata, Yard Fresh. Never the business name."),
    ("Category",       26, True,  "Must match the Categories sheet exactly."),
    ("Subcategory",    24, True,  "Must match the Categories sheet exactly."),
    ("Unit",           10, True,  "kg, g, litre, ml, piece, packet."),
    ("PackSize",       10, False, "The number only. 1 kg -> 1, 500 ml -> 500."),
    ("PackUnit",       10, False, "kg, g, litre, ml, piece, packet."),
    ("SellingPrice",   13, True,  "Rupees, inclusive of nothing - GST is the next column."),
    ("PurchasePrice",  14, False, "Cost price. Leave blank if not tracked."),
    ("GST",            8,  True,  "Percent as a number: 0, 5, 12, 18."),
    ("Discount",       10, False, "Percent as a number. Blank means none."),
    ("Stock",          10, True,  "Quantity on hand today."),
    ("MinOrderQty",    12, False, "Smallest a customer may order. Blank means 1."),
    ("MaxOrderQty",    12, False, "Order limit per customer. Blank means no limit."),
    ("QtyStep",        10, False, "Increment. Blank means 1."),
    ("Barcode",        16, False, "EAN or UPC, if you have one."),
    ("VariantGroup",   16, False, "Ties pack sizes of one product together, e.g. sunflower-oil."),
    ("VariantLabel",   14, False, "What this pack is called within the group, e.g. 1 L."),
    ("ImageFile",      26, False, "File name only. Send the photographs alongside this sheet."),
    ("Available",      11, False, "YES or NO. Blank means YES."),
    ("Active",         10, False, "YES or NO. Blank means YES."),
]

EXAMPLES = {
    "grocers": [
        "GRO-TOOR-1KG", "Toor Dal 1 kg", "Yard Fresh", "Dal & Pulses", "Toor Dal",
        "kg", 1, "kg", 142.50, 118.00, 5, None, 40, None, None, None, None,
        None, None, "toor-dal-1kg.jpg", "YES", "YES",
    ],
    "fresh-mart": [
        "FM-TOM-1KG", "Tomato 1 kg", None, "Vegetables", "Fresh Vegetables",
        "kg", 1, "kg", 38.00, 26.00, 0, None, 25, None, None, None, None,
        None, None, "tomato.jpg", "YES", "YES",
    ],
}


def read_tree(const_name):
    """
    Pull (main, [subs]) out of the generated TypeScript tree.

    The generator writes a main category across several lines and each
    subcategory on one line, so the two are matched separately and stitched
    together by position. Parsed rather than retyped, so this template can
    never disagree with what the application navigates.
    """
    import re
    src = open(TREE, encoding="utf-8").read()
    start = src.index(f"export const {const_name}")
    end = src.find("export const ", start + 10)
    block = src[start : end if end != -1 else len(src)]

    name_of = lambda q: q[1:-1]
    mains = [
        (m.start(), name_of(m.group(1)))
        for m in re.finditer(r"^  \{\n\s*slug: '[a-z0-9-]+',\n\s*name: (\"[^\"]+\"|'[^']+'),", block, re.M)
    ]
    subs = [
        (m.start(), name_of(m.group(1)))
        for m in re.finditer(r"^\s+\{ slug: '[a-z0-9-]+', name: (\"[^\"]+\"|'[^']+'), icon:", block, re.M)
    ]

    out = [(name, []) for _, name in mains]
    bounds = [pos for pos, _ in mains] + [len(block)]
    for pos, sub in subs:
        for i in range(len(mains)):
            if bounds[i] < pos < bounds[i + 1]:
                out[i][1].append(sub)
                break
    return out


def sheet_for(wb, business, title, tree):
    ws = wb.create_sheet(title)
    ws["A1"] = f"{title} - product catalogue"
    ws["A1"].font = TITLE
    ws["A2"] = (
        "Fill one row per product. Yellow headers are required. "
        "Row 4 is an EXAMPLE - delete it before uploading. "
        "Category and Subcategory must match the Categories sheet exactly."
    )
    ws["A2"].font = NOTE
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(COLUMNS))
    ws["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[2].height = 30

    for i, (header, width, required, note) in enumerate(COLUMNS, start=1):
        c = ws.cell(row=3, column=i, value=header)
        c.font = HEAD_FONT
        c.fill = HEAD_FILL if required else PatternFill("solid", fgColor="5A6660")
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX
        c.comment = None
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.row_dimensions[3].height = 28

    for i, value in enumerate(EXAMPLES[business], start=1):
        c = ws.cell(row=4, column=i, value=value)
        c.font = Font(name="Arial", size=10, italic=True, color="94A3B8")
        c.border = BOX

    # Blank rows ready to type into, with the required ones tinted.
    for r in range(5, 205):
        for i, (_, _, required, _) in enumerate(COLUMNS, start=1):
            c = ws.cell(row=r, column=i)
            c.font = BODY
            c.border = BOX
            if required:
                c.fill = REQ_FILL

    yes_no = DataValidation(type="list", formula1='"YES,NO"', allow_blank=True)
    ws.add_data_validation(yes_no)
    for col in ("U", "V"):
        yes_no.add(f"{col}5:{col}204")

    ws.freeze_panes = "A4"
    return ws


def categories_sheet(wb, grocers, fresh):
    ws = wb.create_sheet("Categories")
    ws["A1"] = "Valid categories - copy these values exactly"
    ws["A1"].font = TITLE
    ws["A2"] = (
        "These are the approved category names. A row whose Category or Subcategory "
        "does not appear here will be rejected by the importer."
    )
    ws["A2"].font = NOTE

    for i, h in enumerate(["Business", "Category", "Subcategory"], start=1):
        c = ws.cell(row=3, column=i, value=h)
        c.font = HEAD_FONT
        c.fill = HEAD_FILL
        c.border = BOX
    for w, col in zip((16, 30, 28), "ABC"):
        ws.column_dimensions[col].width = w

    r = 4
    for business, tree in (("Grocers", grocers), ("Fresh Mart", fresh)):
        for main, subs in tree:
            for sub in subs:
                for i, v in enumerate((business, main, sub), start=1):
                    c = ws.cell(row=r, column=i, value=v)
                    c.font = BODY
                    c.border = BOX
                r += 1
    ws.freeze_panes = "A4"
    return ws, r - 4


def notes_sheet(wb, counts):
    ws = wb.create_sheet("Read me first", 0)
    ws.column_dimensions["A"].width = 110
    lines = [
        ("e-Samagri catalogue import template", TITLE),
        ("", BODY),
        ("WHAT THIS IS", Font(name="Arial", bold=True, size=11)),
        ("One sheet per shopping business. The column headers are the ones the existing "
         "import service already accepts, so a completed sheet uploads through the admin "
         "panel with no code change.", BODY),
        ("", BODY),
        ("HOW TO FILL IT IN", Font(name="Arial", bold=True, size=11)),
        ("1. Work on the Grocers sheet and the Fresh Mart sheet separately.", BODY),
        ("2. Delete the grey example row (row 4) before you upload.", BODY),
        ("3. Yellow columns are required. Leave anything you do not know BLANK - "
         "never guess a price or a stock figure.", BODY),
        ("4. Category and Subcategory must match the Categories sheet exactly.", BODY),
        ("5. Brand means the MANUFACTURER (Amul, Tata, Yard Fresh). It is not the "
         "business name. Grocers and Fresh Mart are never brand values.", BODY),
        ("6. Send product photographs as separate image files, named exactly as the "
         "ImageFile column says.", BODY),
        ("", BODY),
        ("WHAT IS STILL BLOCKED", Font(name="Arial", bold=True, size=11)),
        ("The importer cannot yet tell a Grocers row from a Fresh Mart row: the database "
         "has no business column. Until migration 0055 is approved and applied, both "
         "sheets import into one shared catalogue.", BODY),
        ("Approve the migration design first, then upload. The sheets can be filled in "
         "now - nothing about them changes.", BODY),
        ("", BODY),
        (f"Categories available: {counts} subcategory rows on the Categories sheet.", NOTE),
        ("Prepared 17 October 2026. No product, price or stock figure in this file is "
         "real except the example rows, which are marked and must be deleted.", NOTE),
    ]
    for i, (text, font) in enumerate(lines, start=1):
        c = ws.cell(row=i, column=1, value=text)
        c.font = font
        c.alignment = Alignment(wrap_text=True, vertical="top")
    return ws


def main(out_path):
    grocers = read_tree("GROCERS_CATEGORIES")
    fresh = read_tree("FRESH_MART_CATEGORIES")
    assert len(grocers) == 19, f"expected 19 Grocers mains, read {len(grocers)}"
    assert sum(len(s) for _, s in grocers) == 135, "expected 135 Grocers subcategories"
    assert len(fresh) == 2 and sum(len(s) for _, s in fresh) == 8, "Fresh Mart tree wrong"

    wb = Workbook()
    wb.remove(wb.active)
    sheet_for(wb, "grocers", "Grocers", grocers)
    sheet_for(wb, "fresh-mart", "Fresh Mart", fresh)
    _, count = categories_sheet(wb, grocers, fresh)
    notes_sheet(wb, count)
    wb.save(out_path)
    print(f"wrote {out_path}")
    print(f"grocers mains={len(grocers)} subs={sum(len(s) for _, s in grocers)}")
    print(f"freshmart mains={len(fresh)} subs={sum(len(s) for _, s in fresh)}")
    print(f"categories rows={count}")


if __name__ == "__main__":
    main(sys.argv[1])
