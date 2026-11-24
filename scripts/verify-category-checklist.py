"""
Compare the IMPLEMENTED category tree against the ORIGINALLY APPROVED list.

The approved list below is transcribed from the master brief (Grocers
Part 6.3; Fresh Mart Part 8). The implemented tree is read from the file the
application actually navigates. Nothing is normalised beyond whitespace, so
a renamed, merged, reordered or missing category shows up as a mismatch
rather than being quietly accepted.
"""
import re
import sys

TREE = "apps/customer-web/src/lib/businesses/category-tree.ts"

APPROVED_GROCERS = [
    ("Rice, Atta & Flour", ["Rice", "Basmati Rice", "Sona Masoori", "Brown Rice", "Atta", "Maida", "Besan", "Rava/Sooji", "Multigrain Flour"]),
    ("Dal & Pulses", ["Toor Dal", "Moong Dal", "Masoor Dal", "Urad Dal", "Chana Dal", "Rajma", "Kabuli Chana", "Green Gram", "Black Gram"]),
    ("Oil & Ghee", ["Sunflower Oil", "Groundnut Oil", "Rice Bran Oil", "Palm Oil", "Coconut Oil", "Sesame Oil", "Ghee"]),
    ("Salt, Sugar & Spices", ["Salt", "Sugar", "Jaggery", "Chilli Powder", "Turmeric", "Coriander Powder", "Pepper", "Whole Spices", "Garam Masala", "Curry Masala"]),
    ("Dairy & Eggs", ["Milk", "Curd", "Buttermilk", "Paneer", "Butter", "Cheese", "Cream", "Lassi", "Eggs"]),
    ("Bakery", ["Bread", "Buns", "Cakes", "Rusk", "Cookies", "Pav", "Bakery Snacks"]),
    ("Biscuits & Snacks", ["Biscuits", "Chips", "Namkeen", "Mixtures", "Popcorn", "Fryums"]),
    ("Chocolates & Confectionery", ["Chocolates", "Candies", "Toffees", "Wafers", "Chewing Gum"]),
    ("Tea & Coffee", ["Tea", "Green Tea", "Coffee", "Instant Coffee", "Tea Premixes", "Health Drinks"]),
    ("Beverages", ["Soft Drinks", "Juices", "Energy Drinks", "Fruit Drinks", "Packaged Water", "Soda"]),
    ("Instant & Packaged Foods", ["Noodles", "Pasta", "Vermicelli", "Ready-to-Eat", "Ready-to-Cook", "Soup", "Instant Mixes"]),
    ("Breakfast & Cereals", ["Oats", "Corn Flakes", "Muesli", "Cereals", "Poha", "Dalia", "Breakfast Mixes"]),
    ("Sauces, Pickles & Spreads", ["Pickles", "Ketchup", "Sauces", "Mayonnaise", "Jam", "Honey", "Peanut Butter", "Chutney"]),
    ("Frozen & Ice Cream", ["Ice Cream", "Kulfi", "Frozen Vegetables", "Frozen Snacks", "Frozen Paratha"]),
    ("Home Cleaning", ["Detergent", "Dishwash", "Floor Cleaner", "Toilet Cleaner", "Glass Cleaner", "Fabric Care", "Garbage Bags"]),
    ("Personal Care", ["Bath Soap", "Shampoo", "Hair Oil", "Toothpaste", "Toothbrush", "Face Wash", "Creams", "Deodorants", "Shaving"]),
    ("Baby Care", ["Diapers", "Baby Food", "Baby Soap", "Baby Shampoo", "Baby Lotion", "Baby Wipes"]),
    ("Pooja & Household Essentials", ["Agarbatti", "Camphor", "Pooja Oil", "Wicks", "Match Boxes", "Batteries", "Tissue", "Aluminium Foil"]),
    ("Pet Care", ["Dog Food", "Cat Food", "Pet Treats", "Pet Accessories"]),
]

APPROVED_FRESH_MART = [
    ("Vegetables", ["Fresh Vegetables", "Leafy Vegetables", "Roots & Tubers", "Onions & Potatoes", "Herbs & Coriander", "Cut Vegetables"]),
    ("Fruits", ["Exotic Fruits", "Seasonal Fruits"]),
]

# Names the brief explicitly forbids substituting in.
FORBIDDEN = ["Health & Wellness", "Stationery", "Other Essentials"]


def read_tree(const_name):
    src = open(TREE, encoding="utf-8").read()
    start = src.index(f"export const {const_name}")
    end = src.find("export const ", start + 10)
    block = src[start : end if end != -1 else len(src)]
    unq = lambda q: q[1:-1]
    mains = [
        (m.start(), unq(m.group(1)), unq(m.group(2)))
        for m in re.finditer(
            r"^  \{\n\s*slug: ('[a-z0-9-]+'),\n\s*name: (\"[^\"]+\"|'[^']+'),", block, re.M
        )
    ]
    subs = [
        (m.start(), unq(m.group(1)), unq(m.group(2)))
        for m in re.finditer(
            r"^\s+\{ slug: ('[a-z0-9-]+'), name: (\"[^\"]+\"|'[^']+'), icon:", block, re.M
        )
    ]
    out = [(name, slug, []) for _, slug, name in mains]
    bounds = [pos for pos, _, _ in mains] + [len(block)]
    for pos, slug, sub in subs:
        for i in range(len(mains)):
            if bounds[i] < pos < bounds[i + 1]:
                out[i][2].append((sub, slug))
                break
    return out


def compare(label, approved, implemented):
    print(f"\n{'=' * 72}\n{label}\n{'=' * 72}")
    problems = []

    if len(approved) != len(implemented):
        problems.append(f"main count: approved {len(approved)}, implemented {len(implemented)}")

    n_sub = 0
    for i, (a_main, a_subs) in enumerate(approved, start=1):
        if i - 1 >= len(implemented):
            problems.append(f"{i}. MISSING main '{a_main}'")
            continue
        i_main, i_slug, i_subs = implemented[i - 1]
        mark = "OK " if i_main == a_main else "!! "
        if i_main != a_main:
            problems.append(f"{i}. main: approved '{a_main}', implemented '{i_main}'")
        print(f"\n{mark}{i:2}. {i_main}    [{i_slug}]")

        if len(a_subs) != len(i_subs):
            problems.append(f"{i}. '{a_main}' sub count: approved {len(a_subs)}, implemented {len(i_subs)}")
        for j, a_sub in enumerate(a_subs, start=1):
            n_sub += 1
            if j - 1 >= len(i_subs):
                problems.append(f"{i}.{j} MISSING sub '{a_sub}' under '{a_main}'")
                print(f"      !! {i}.{j:<2} MISSING: {a_sub}")
                continue
            i_sub, s_slug = i_subs[j - 1]
            ok = i_sub == a_sub
            if not ok:
                problems.append(f"{i}.{j} sub: approved '{a_sub}', implemented '{i_sub}'")
            print(f"      {'   ' if ok else '!! '}{i}.{j:<2} {i_sub:<22} [{s_slug}]")

    impl_sub_total = sum(len(s) for _, _, s in implemented)
    print(f"\n   mains: {len(implemented)} (approved {len(approved)})")
    print(f"   subcategories: {impl_sub_total} (approved {n_sub})")
    return problems


def main():
    g_impl = read_tree("GROCERS_CATEGORIES")
    f_impl = read_tree("FRESH_MART_CATEGORIES")

    problems = []
    problems += compare("GROCERS — 19 main categories", APPROVED_GROCERS, g_impl)
    problems += compare("FRESH MART — 2 main categories", APPROVED_FRESH_MART, f_impl)

    # Explicit checks the brief calls out by name.
    print(f"\n{'=' * 72}\nTARGETED CHECKS\n{'=' * 72}")
    names = [n for n, _, _ in g_impl]
    tea = "Tea & Coffee" in names
    bev = "Beverages" in names
    print(f"   'Tea & Coffee' is its own main category: {tea}")
    print(f"   'Beverages' is a separate main category: {bev}")
    print(f"   they are different entries: {tea and bev and names.index('Tea & Coffee') != names.index('Beverages')}")
    for bad in FORBIDDEN:
        present = bad in names
        print(f"   forbidden substitute '{bad}' absent: {not present}")
        if present:
            problems.append(f"forbidden category present: {bad}")
    combined = [n for n in names if "Tea" in n and "Beverage" in n]
    print(f"   no combined Tea/Beverages category: {not combined}")

    print(f"\n{'=' * 72}")
    if problems:
        print(f"MISMATCHES: {len(problems)}")
        for p in problems:
            print("  -", p)
        sys.exit(1)
    print("RESULT: the implemented tree matches the approved list exactly.")
    print("        19 mains / 135 subcategories, 2 mains / 8 subcategories.")


if __name__ == "__main__":
    main()
