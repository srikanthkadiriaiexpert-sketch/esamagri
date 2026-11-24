/**
 * Generates the Grocers and Fresh Mart category definition files.
 *
 * Written as a generator rather than typed by hand because the tree is 154
 * rows: a generator makes the slug rule provably uniform and lets every
 * lucide icon name be validated against the installed package BEFORE the
 * file is written, so a misspelt icon can never reach the build.
 */
const fs = require('node:fs');
const path = require('node:path');
/**
 * Validate against `icons` — the name → component RECORD — and not against
 * the package's top-level exports. They are not the same set: lucide keeps
 * deprecated aliases as top-level exports that the record has dropped
 * (`IceCream` is one; the live name is `IceCreamBowl`). CategorySidebar
 * renders from the record, so the record is the only honest source of truth
 * here. Validating against exports passed a name that renders as a blank.
 */
const { icons: lucide } = require('lucide-react');

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[/,]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// [main, icon, [[sub, icon], ...]]
const GROCERS = [
  ['Rice, Atta & Flour', 'Wheat', [
    ['Rice', 'Wheat'], ['Basmati Rice', 'Soup'], ['Sona Masoori', 'Container'],
    ['Brown Rice', 'Shrub'], ['Atta', 'Croissant'], ['Maida', 'Cake'],
    ['Besan', 'Bean'], ['Rava/Sooji', 'Amphora'], ['Multigrain Flour', 'Sprout'],
  ]],
  ['Dal & Pulses', 'Bean', [
    ['Toor Dal', 'Bean'], ['Moong Dal', 'Sprout'], ['Masoor Dal', 'Nut'],
    ['Urad Dal', 'Container'], ['Chana Dal', 'Amphora'], ['Rajma', 'Hop'],
    ['Kabuli Chana', 'Nut'], ['Green Gram', 'Leaf'], ['Black Gram', 'Shrub'],
  ]],
  ['Oil & Ghee', 'Droplet', [
    ['Sunflower Oil', 'Sun'], ['Groundnut Oil', 'Nut'], ['Rice Bran Oil', 'Wheat'],
    ['Palm Oil', 'TreePine'], ['Coconut Oil', 'Droplet'], ['Sesame Oil', 'Sparkle'],
    ['Ghee', 'Amphora'],
  ]],
  ['Salt, Sugar & Spices', 'Flame', [
    ['Salt', 'Waves'], ['Sugar', 'Candy'], ['Jaggery', 'Hop'],
    ['Chilli Powder', 'Flame'], ['Turmeric', 'Sun'], ['Coriander Powder', 'Leaf'],
    ['Pepper', 'Grid3x3'], ['Whole Spices', 'Star'], ['Garam Masala', 'Sparkles'],
    ['Curry Masala', 'Soup'],
  ]],
  ['Dairy & Eggs', 'Milk', [
    ['Milk', 'Milk'], ['Curd', 'Container'], ['Buttermilk', 'GlassWater'],
    ['Paneer', 'Box'], ['Butter', 'Amphora'], ['Cheese', 'Layers'],
    ['Cream', 'Dessert'], ['Lassi', 'CupSoda'], ['Eggs', 'Egg'],
  ]],
  ['Bakery', 'Croissant', [
    ['Bread', 'Sandwich'], ['Buns', 'Croissant'], ['Cakes', 'CakeSlice'],
    ['Rusk', 'Cookie'], ['Cookies', 'Cookie'], ['Pav', 'Donut'],
    ['Bakery Snacks', 'Cake'],
  ]],
  ['Biscuits & Snacks', 'Cookie', [
    ['Biscuits', 'Cookie'], ['Chips', 'Package'], ['Namkeen', 'Popcorn'],
    ['Mixtures', 'Boxes'], ['Popcorn', 'Popcorn'], ['Fryums', 'Sparkle'],
  ]],
  ['Chocolates & Confectionery', 'Candy', [
    ['Chocolates', 'Candy'], ['Candies', 'Sparkles'], ['Toffees', 'Donut'],
    ['Wafers', 'Layers'], ['Chewing Gum', 'Smile'],
  ]],
  ['Tea & Coffee', 'Coffee', [
    ['Tea', 'Leaf'], ['Green Tea', 'Sprout'], ['Coffee', 'Coffee'],
    ['Instant Coffee', 'Container'], ['Tea Premixes', 'Package'], ['Health Drinks', 'Zap'],
  ]],
  ['Beverages', 'CupSoda', [
    ['Soft Drinks', 'CupSoda'], ['Juices', 'Citrus'], ['Energy Drinks', 'Zap'],
    ['Fruit Drinks', 'Grape'], ['Packaged Water', 'Droplet'], ['Soda', 'GlassWater'],
  ]],
  ['Instant & Packaged Foods', 'Soup', [
    ['Noodles', 'Soup'], ['Pasta', 'Utensils'], ['Vermicelli', 'Waves'],
    ['Ready-to-Eat', 'Package'], ['Ready-to-Cook', 'Flame'], ['Soup', 'Soup'],
    ['Instant Mixes', 'Boxes'],
  ]],
  ['Breakfast & Cereals', 'Sun', [
    ['Oats', 'Wheat'], ['Corn Flakes', 'Sun'], ['Muesli', 'Nut'],
    ['Cereals', 'Container'], ['Poha', 'Layers'], ['Dalia', 'Sprout'],
    ['Breakfast Mixes', 'Boxes'],
  ]],
  ['Sauces, Pickles & Spreads', 'Amphora', [
    ['Pickles', 'Amphora'], ['Ketchup', 'Container'], ['Sauces', 'Droplet'],
    ['Mayonnaise', 'Box'], ['Jam', 'Cherry'], ['Honey', 'Hop'],
    ['Peanut Butter', 'Nut'], ['Chutney', 'Leaf'],
  ]],
  ['Frozen & Ice Cream', 'Snowflake', [
    ['Ice Cream', 'IceCreamBowl'], ['Kulfi', 'IceCreamCone'], ['Frozen Vegetables', 'Snowflake'],
    ['Frozen Snacks', 'Refrigerator'], ['Frozen Paratha', 'Layers'],
  ]],
  ['Home Cleaning', 'SprayCan', [
    ['Detergent', 'WashingMachine'], ['Dishwash', 'Droplet'], ['Floor Cleaner', 'SprayCan'],
    ['Toilet Cleaner', 'Waves'], ['Glass Cleaner', 'Sparkles'], ['Fabric Care', 'Shirt'],
    ['Garbage Bags', 'Trash2'],
  ]],
  ['Personal Care', 'Bath', [
    ['Bath Soap', 'Bath'], ['Shampoo', 'Droplet'], ['Hair Oil', 'Amphora'],
    ['Toothpaste', 'Smile'], ['Toothbrush', 'Brush'], ['Face Wash', 'Sparkles'],
    ['Creams', 'Container'], ['Deodorants', 'Wind'], ['Shaving', 'Scissors'],
  ]],
  ['Baby Care', 'Baby', [
    ['Diapers', 'Baby'], ['Baby Food', 'Milk'], ['Baby Soap', 'Bath'],
    ['Baby Shampoo', 'Droplet'], ['Baby Lotion', 'Container'], ['Baby Wipes', 'Layers'],
  ]],
  ['Pooja & Household Essentials', 'Flame', [
    ['Agarbatti', 'Wind'], ['Camphor', 'Flame'], ['Pooja Oil', 'Droplet'],
    ['Wicks', 'Sparkle'], ['Match Boxes', 'Box'], ['Batteries', 'Battery'],
    ['Tissue', 'Layers'], ['Aluminium Foil', 'Scroll'],
  ]],
  ['Pet Care', 'PawPrint', [
    ['Dog Food', 'Dog'], ['Cat Food', 'Cat'], ['Pet Treats', 'Bone'],
    ['Pet Accessories', 'PawPrint'],
  ]],
];

const FRESH_MART = [
  ['Vegetables', 'Carrot', [
    ['Fresh Vegetables', 'Carrot'], ['Leafy Vegetables', 'Salad'], ['Roots & Tubers', 'Sprout'],
    ['Onions & Potatoes', 'Vegan'], ['Herbs & Coriander', 'Leaf'], ['Cut Vegetables', 'Scissors'],
  ]],
  ['Fruits', 'Apple', [
    ['Exotic Fruits', 'Grape'], ['Seasonal Fruits', 'Apple'],
  ]],
];

// ---- validate every icon name against the installed package ----------
const bad = [];
const seenSlugs = new Map();
for (const [tree, label] of [[GROCERS, 'grocers'], [FRESH_MART, 'fresh-mart']]) {
  for (const [main, mainIcon, subs] of tree) {
    if (!lucide[mainIcon]) bad.push(`${label}: ${main} -> ${mainIcon}`);
    const ms = slug(main);
    if (seenSlugs.has(`${label}/${ms}`)) bad.push(`duplicate main slug ${ms}`);
    seenSlugs.set(`${label}/${ms}`, true);
    for (const [sub, icon] of subs) {
      if (!lucide[icon]) bad.push(`${label}: ${main}/${sub} -> ${icon}`);
      const ss = `${label}/${ms}/${slug(sub)}`;
      if (seenSlugs.has(ss)) bad.push(`duplicate sub slug ${ss}`);
      seenSlugs.set(ss, true);
    }
  }
}
if (bad.length) {
  console.error('INVALID:\n' + bad.join('\n'));
  process.exit(1);
}

const render = (tree, constName, businessSlug) => {
  const mains = tree
    .map(([main, icon, subs]) => {
      const subLines = subs
        .map(([s, i]) => `      { slug: '${slug(s)}', name: ${JSON.stringify(s)}, icon: '${i}' },`)
        .join('\n');
      return `  {
    slug: '${slug(main)}',
    name: ${JSON.stringify(main)},
    icon: '${icon}',
    subcategories: [
${subLines}
    ],
  },`;
    })
    .join('\n');
  return `export const ${constName}: readonly MainCategory[] = [\n${mains}\n];\n`;
};

const header = `/**
 * GENERATED by scripts/gen-categories.cjs — do not edit by hand.
 *
 * The approved category trees, held in the FRONTEND rather than the database.
 *
 * Why not a database table yet: the business-identity column on pif.products
 * and pif.categories has not been designed, reviewed or migrated. Until it
 * is, putting 154 category rows into pif.categories would be a schema change
 * without an approved migration, and pif.categories enforces a two-level
 * limit by trigger that a business level would break. Holding the tree here
 * keeps navigation deterministic and reversible, changes nothing in any
 * database, and leaves the migration free to adopt these exact slugs later.
 *
 * \`slug\` is the stable navigation key. It is derived once, here, by one rule
 * (lowercase; & becomes "and"; punctuation becomes a hyphen), so a URL cannot
 * drift from a display name that someone later edits.
 */

export interface SubCategory {
  /** Stable URL key. Never derived at render time. */
  readonly slug: string;
  readonly name: string;
  /** A lucide-react export name, validated at generation time. */
  readonly icon: string;
}

export interface MainCategory {
  readonly slug: string;
  readonly name: string;
  readonly icon: string;
  readonly subcategories: readonly SubCategory[];
}
`;

const out = path.join(__dirname, '..', 'apps', 'customer-web', 'src', 'lib', 'businesses');
fs.mkdirSync(out, { recursive: true });

fs.writeFileSync(
  path.join(out, 'category-tree.ts'),
  header +
    '\n' +
    render(GROCERS, 'GROCERS_CATEGORIES', 'grocers') +
    '\n' +
    render(FRESH_MART, 'FRESH_MART_CATEGORIES', 'fresh-mart') +
    `
/** Every subcategory of a tree, flattened — used by lookups and tests. */
export function allSubcategories(tree: readonly MainCategory[]): readonly SubCategory[] {
  return tree.flatMap((m) => m.subcategories);
}

/** Find a main category by its slug, or null. */
export function findMain(
  tree: readonly MainCategory[],
  mainSlug: string | undefined
): MainCategory | null {
  if (mainSlug === undefined) return null;
  return tree.find((m) => m.slug === mainSlug) ?? null;
}
`
);

/**
 * Emit an explicit icon map of ONLY the icons the trees use.
 *
 * Why not lucide's own `icons` record: importing it references all 1,636
 * glyphs, so nothing can be tree-shaken and the customer bundle grew from
 * 400 kB to 898 kB — a 124% increase on an app opened over a facility
 * network on phones. Naming the 66 icons actually used lets the bundler drop
 * the rest. Generated rather than hand-kept so the map can never drift from
 * the trees it serves.
 */
const usedIcons = [
  ...new Set(
    [...GROCERS, ...FRESH_MART].flatMap(([, icon, subs]) => [icon, ...subs.map(([, i]) => i)])
  ),
].sort();

fs.writeFileSync(
  path.join(out, 'category-icons.ts'),
  `/**
 * GENERATED by scripts/gen-categories.cjs — do not edit by hand.
 *
 * Only the icons the category trees actually use, imported by name so the
 * bundler can drop the rest of lucide. See the generator for why this file
 * exists instead of lucide's own \`icons\` record.
 */
import type { ComponentType, SVGProps } from 'react';
import {
${usedIcons.map((n) => `  ${n},`).join('\n')}
} from 'lucide-react';

export type CategoryGlyph = ComponentType<SVGProps<SVGSVGElement>>;

export const CATEGORY_ICONS: Readonly<Record<string, CategoryGlyph>> = {
${usedIcons.map((n) => `  ${n},`).join('\n')}
};
`
);

const counts = (t) => ({ mains: t.length, subs: t.reduce((n, [, , s]) => n + s.length, 0) });
console.log('unique icons', usedIcons.length);
console.log('grocers   ', JSON.stringify(counts(GROCERS)));
console.log('fresh mart', JSON.stringify(counts(FRESH_MART)));
console.log('written   ', path.join(out, 'category-tree.ts'));
