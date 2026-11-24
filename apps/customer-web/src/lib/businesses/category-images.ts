/**
 * Category photographs, per business.
 *
 * TWO MAPS, ONE LOOKUP. The lookup returns null for anything it does not
 * know, and the rail, the grid and the hero all fall back to the category's
 * lucide icon when it does. So a category with no artwork yet is a normal
 * state, not a gap: Grocers has two of its nineteen mains illustrated and
 * seventeen still iconned, and both look deliberate.
 *
 * The keys are the category slugs from `category-tree.ts` — the same slugs
 * the URLs use — so a picture cannot drift onto the wrong shelf. Tests
 * assert that every entry names a real category of that business, and that
 * neither business ever serves the other's files.
 *
 * PROVENANCE. Every file here was cropped from a sheet the client supplied,
 * by a script that measures the panel boundaries from the pixels and strips
 * the caption bar — `crop-fresh-mart-images.py`,
 * `crop-grocers-rice-atta-flour.py`, `crop-grocers-dal-and-pulses.py`. The
 * originals are archived unchanged under `docs/assets/fresh-mart-source/`
 * and `docs/assets/grocers-source/`. Nothing here was redrawn, recoloured
 * or regenerated.
 *
 * WHAT THESE PICTURES ARE NOT. The Grocers sheets are illustrative generated
 * artwork, not verified manufacturer photography, and the brand names,
 * package designs and on-pack claims visible in them are not catalogue data.
 * They are navigation imagery: a category picture says what the shelf is
 * FOR. It is not a claim that anything on it is in stock, nor that any named
 * brand is carried — every shelf states its own stock separately, and a
 * product card must use an approved catalogue asset instead.
 */

export interface CategoryImage {
  readonly src: string;
  readonly alt: string;
}

const BASE = '/brands/fresh-mart/categories';

/** Keyed by category slug. Main categories and subcategories together. */
const FRESH_MART_IMAGES: Readonly<Record<string, CategoryImage>> = {
  // main categories
  vegetables: { src: `${BASE}/vegetables.webp`, alt: 'An assortment of fresh vegetables' },
  fruits: { src: `${BASE}/fruits.webp`, alt: 'An assortment of fresh fruits' },

  // Vegetables subcategories
  'fresh-vegetables': {
    src: `${BASE}/fresh-vegetables.webp`,
    alt: 'Fresh vegetables including tomatoes, carrots, okra and peppers',
  },
  'leafy-vegetables': {
    src: `${BASE}/leafy-vegetables.webp`,
    alt: 'Bunches of leafy greens and herbs',
  },
  'roots-and-tubers': {
    src: `${BASE}/roots-and-tubers.webp`,
    alt: 'Potatoes, carrots, sweet potatoes, yam and ginger',
  },
  'onions-and-potatoes': {
    src: `${BASE}/onions-and-potatoes.webp`,
    alt: 'Red and white onions with potatoes',
  },
  'herbs-and-coriander': {
    src: `${BASE}/herbs-and-coriander.webp`,
    alt: 'Coriander, mint, dill, curry leaves and spring onion',
  },
  'cut-vegetables': {
    src: `${BASE}/cut-vegetables.webp`,
    alt: 'Prepared cut vegetables in bowls and a tray',
  },

  // Fruits subcategories
  'exotic-fruits': {
    src: `${BASE}/exotic-fruits.webp`,
    alt: 'Dragon fruit, pineapple, avocado, mango, passion fruit, kiwi and berries',
  },
  'seasonal-fruits': {
    src: `${BASE}/seasonal-fruits.webp`,
    alt: 'Watermelon, muskmelon, bananas, grapes, oranges, apples, guava and pomegranate',
  },
};

/**
 * The picture for a category, or null when none is supplied.
 *
 * `businessSlug` is required so a Grocers category can never pick up a Fresh
 * Mart photograph by sharing a slug — "vegetables" is a plausible collision.
 */
const GROCERS_BASE = '/brands/grocers/categories';

/**
 * Grocers photographs, supplied one main category at a time.
 *
 * ONLY "Rice, Atta & Flour" HAS ARTWORK SO FAR. Every other Grocers
 * category still renders its lucide icon, exactly as before, because the
 * lookup returns null for anything absent. The remaining 18 mains and their
 * subcategories are a separate, approved-one-at-a-time job.
 *
 * Keys are the approved category slugs. The pictures came from two client
 * collages split by `scripts/crop-grocers-rice-atta-flour.py`; the
 * originals are archived unchanged under `docs/assets/grocers-source/`.
 */
const GROCERS_IMAGES: Readonly<Record<string, CategoryImage>> = {
  'rice-atta-and-flour': {
    src: `${GROCERS_BASE}/rice-atta-and-flour/rice-atta-and-flour.webp`,
    alt: 'Packs of rice, atta and flour',
  },
  rice: {
    src: `${GROCERS_BASE}/rice-atta-and-flour/rice.webp`,
    alt: 'Packs of raw rice',
  },
  'basmati-rice': {
    src: `${GROCERS_BASE}/rice-atta-and-flour/basmati-rice.webp`,
    alt: 'Packs of basmati rice',
  },
  'sona-masoori': {
    src: `${GROCERS_BASE}/rice-atta-and-flour/sona-masoori.webp`,
    alt: 'Packs of Sona Masoori rice',
  },
  'brown-rice': {
    src: `${GROCERS_BASE}/rice-atta-and-flour/brown-rice.webp`,
    alt: 'Packs of brown rice',
  },
  atta: {
    src: `${GROCERS_BASE}/rice-atta-and-flour/atta.webp`,
    alt: 'Packs of whole wheat atta',
  },
  maida: {
    src: `${GROCERS_BASE}/rice-atta-and-flour/maida.webp`,
    alt: 'Packs of maida, refined wheat flour',
  },
  besan: {
    src: `${GROCERS_BASE}/rice-atta-and-flour/besan.webp`,
    alt: 'Packs of besan, gram flour',
  },
  'rava-sooji': {
    src: `${GROCERS_BASE}/rice-atta-and-flour/rava-sooji.webp`,
    alt: 'Packs of rava, also called sooji',
  },
  'multigrain-flour': {
    src: `${GROCERS_BASE}/rice-atta-and-flour/multigrain-flour.webp`,
    alt: 'Packs of multigrain atta',
  },

  // ------------------------------------------------------ Dal & Pulses ---
  // Cropped from the two supplied sheets by scripts/crop-grocers-dal-and-pulses.py.
  // The sheet's nine labels match the approved nine exactly, in order, so
  // every panel has a home and the catalogue needed no change.
  'dal-and-pulses': {
    src: `${GROCERS_BASE}/dal-and-pulses/dal-and-pulses.webp`,
    alt: 'Packs of dal and pulses with bowls of lentils and beans',
  },
  'toor-dal': {
    src: `${GROCERS_BASE}/dal-and-pulses/toor-dal.webp`,
    alt: 'A pack of toor dal beside a bowl of split pigeon peas',
  },
  'moong-dal': {
    src: `${GROCERS_BASE}/dal-and-pulses/moong-dal.webp`,
    alt: 'A pack of moong dal beside a bowl of split mung beans',
  },
  'masoor-dal': {
    src: `${GROCERS_BASE}/dal-and-pulses/masoor-dal.webp`,
    alt: 'A pack of masoor dal beside a bowl of red lentils',
  },
  'urad-dal': {
    src: `${GROCERS_BASE}/dal-and-pulses/urad-dal.webp`,
    alt: 'A pack of urad dal beside a bowl of black gram',
  },
  'chana-dal': {
    src: `${GROCERS_BASE}/dal-and-pulses/chana-dal.webp`,
    alt: 'A pack of chana dal beside a bowl of split chickpeas',
  },
  rajma: {
    src: `${GROCERS_BASE}/dal-and-pulses/rajma.webp`,
    alt: 'A pack of rajma beside a bowl of red kidney beans',
  },
  'kabuli-chana': {
    src: `${GROCERS_BASE}/dal-and-pulses/kabuli-chana.webp`,
    alt: 'A pack of kabuli chana beside a bowl of white chickpeas',
  },
  'green-gram': {
    src: `${GROCERS_BASE}/dal-and-pulses/green-gram.webp`,
    alt: 'A pack of whole green gram beside a bowl of mung beans',
  },
  'black-gram': {
    src: `${GROCERS_BASE}/dal-and-pulses/black-gram.webp`,
    alt: 'A pack of whole black gram beside a bowl of black urad',
  },

  // -------------------------------------------------------- Oil & Ghee ---
  // Cropped from the two supplied sheets by scripts/crop-grocers-category.py.
  // The sheet's seven labels match the approved seven exactly, in order.
  'oil-and-ghee': {
    src: `${GROCERS_BASE}/oil-and-ghee/oil-and-ghee.webp`,
    alt: 'Bottles of cooking oil and a jar of ghee with their raw ingredients',
  },
  'sunflower-oil': {
    src: `${GROCERS_BASE}/oil-and-ghee/sunflower-oil.webp`,
    alt: 'A bottle of sunflower oil beside sunflowers and sunflower seeds',
  },
  'groundnut-oil': {
    src: `${GROCERS_BASE}/oil-and-ghee/groundnut-oil.webp`,
    alt: 'A bottle of groundnut oil beside peanuts in their shells',
  },
  'rice-bran-oil': {
    src: `${GROCERS_BASE}/oil-and-ghee/rice-bran-oil.webp`,
    alt: 'A bottle of rice bran oil beside paddy stalks and grain',
  },
  'palm-oil': {
    src: `${GROCERS_BASE}/oil-and-ghee/palm-oil.webp`,
    alt: 'A bottle of palm oil beside palm fruit and fronds',
  },
  'coconut-oil': {
    src: `${GROCERS_BASE}/oil-and-ghee/coconut-oil.webp`,
    alt: 'A bottle of coconut oil beside whole and halved coconuts',
  },
  'sesame-oil': {
    src: `${GROCERS_BASE}/oil-and-ghee/sesame-oil.webp`,
    alt: 'A bottle of sesame oil beside a bowl of sesame seeds',
  },
  ghee: {
    src: `${GROCERS_BASE}/oil-and-ghee/ghee.webp`,
    alt: 'A jar of ghee beside a brass bowl of melted ghee',
  },

  // ----------------------------------------------- Salt, Sugar & Spices ---
  // Cropped from the two supplied sheets by scripts/crop-grocers-category.py.
  // The sheet's ten labels match the approved ten exactly, in order.
  'salt-sugar-and-spices': {
    src: `${GROCERS_BASE}/salt-sugar-and-spices/salt-sugar-and-spices.webp`,
    alt: 'Packs of salt, sugar and spices with bowls of ground masala',
  },
  salt: {
    src: `${GROCERS_BASE}/salt-sugar-and-spices/salt.webp`,
    alt: 'Packs of table and rock salt beside bowls of salt crystals',
  },
  sugar: {
    src: `${GROCERS_BASE}/salt-sugar-and-spices/sugar.webp`,
    alt: 'Packs of sugar beside sugarcane and a bowl of white sugar',
  },
  jaggery: {
    src: `${GROCERS_BASE}/salt-sugar-and-spices/jaggery.webp`,
    alt: 'Packs of jaggery powder beside blocks of jaggery',
  },
  'chilli-powder': {
    src: `${GROCERS_BASE}/salt-sugar-and-spices/chilli-powder.webp`,
    alt: 'Packs of chilli powder beside dried red chillies and a bowl of ground chilli',
  },
  turmeric: {
    src: `${GROCERS_BASE}/salt-sugar-and-spices/turmeric.webp`,
    alt: 'Packs of turmeric powder beside turmeric root and ground turmeric',
  },
  'coriander-powder': {
    src: `${GROCERS_BASE}/salt-sugar-and-spices/coriander-powder.webp`,
    alt: 'A pack of coriander powder beside coriander seeds and fresh leaves',
  },
  pepper: {
    src: `${GROCERS_BASE}/salt-sugar-and-spices/pepper.webp`,
    alt: 'Packs of black pepper beside a bowl of peppercorns',
  },
  'whole-spices': {
    src: `${GROCERS_BASE}/salt-sugar-and-spices/whole-spices.webp`,
    alt: 'Bowls of whole spices including cinnamon, star anise, cardamom and cloves',
  },
  'garam-masala': {
    src: `${GROCERS_BASE}/salt-sugar-and-spices/garam-masala.webp`,
    alt: 'Packs of garam masala beside a bowl of ground masala and whole spices',
  },
  'curry-masala': {
    src: `${GROCERS_BASE}/salt-sugar-and-spices/curry-masala.webp`,
    alt: 'Packs of curry masala beside a bowl of ground curry powder',
  },

  // ----------------------------------------------------- Dairy & Eggs ---
  // Cropped from the two supplied sheets by scripts/crop-grocers-category.py.
  // The sheet's nine labels match the approved nine exactly, in order.
  'dairy-and-eggs': {
    src: `${GROCERS_BASE}/dairy-and-eggs/dairy-and-eggs.webp`,
    alt: 'Packs of milk, curd, paneer, butter and cheese beside a tray of eggs',
  },
  milk: {
    src: `${GROCERS_BASE}/dairy-and-eggs/milk.webp`,
    alt: 'Packets of toned and cow milk beside glasses of milk',
  },
  curd: {
    src: `${GROCERS_BASE}/dairy-and-eggs/curd.webp`,
    alt: 'Tubs of curd beside a bowl of set curd',
  },
  buttermilk: {
    src: `${GROCERS_BASE}/dairy-and-eggs/buttermilk.webp`,
    alt: 'Packs of spiced buttermilk beside a glass of buttermilk',
  },
  paneer: {
    src: `${GROCERS_BASE}/dairy-and-eggs/paneer.webp`,
    alt: 'Packs of paneer beside a platter of paneer cubes',
  },
  butter: {
    src: `${GROCERS_BASE}/dairy-and-eggs/butter.webp`,
    alt: 'Cartons of butter beside a sliced block of butter',
  },
  cheese: {
    src: `${GROCERS_BASE}/dairy-and-eggs/cheese.webp`,
    alt: 'Packs of processed cheese and cheese slices beside grated cheese',
  },
  cream: {
    src: `${GROCERS_BASE}/dairy-and-eggs/cream.webp`,
    alt: 'Cartons of fresh cream beside a bowl of whipped cream',
  },
  lassi: {
    src: `${GROCERS_BASE}/dairy-and-eggs/lassi.webp`,
    alt: 'Cartons of sweet and mango lassi beside filled glasses',
  },
  eggs: {
    src: `${GROCERS_BASE}/dairy-and-eggs/eggs.webp`,
    alt: 'A tray of fresh eggs beside a cracked egg in a bowl',
  },

  // ---------------------------------------------------------- Bakery ---
  // Six panels cropped from the supplied sheets by
  // scripts/crop-grocers-category.py; Cakes arrived later as its own
  // already-square artwork and was derived by scripts/derive-grocers-tile.py.
  //
  // ALL SEVEN SHELVES NOW. The first Bakery sheet had no Cakes panel, so
  // `cakes` sat on its CakeSlice icon rather than borrowing the Cookies or
  // Bakery Snacks picture. Its own artwork closed that gap on 19 October.
  bakery: {
    src: `${GROCERS_BASE}/bakery/bakery.webp`,
    alt: 'Loaves of bread, pav and rusk with their packets on a counter',
  },
  bread: {
    src: `${GROCERS_BASE}/bakery/bread.webp`,
    alt: 'Packets of white, whole wheat and multigrain bread beside sliced loaves',
  },
  buns: {
    src: `${GROCERS_BASE}/bakery/buns.webp`,
    alt: 'Packets of burger and hot dog buns beside loose buns',
  },
  cakes: {
    src: `${GROCERS_BASE}/bakery/cakes.webp`,
    alt: 'Packets of fruit, chocolate and vanilla cake beside sliced loaf cake and muffins',
  },
  rusk: {
    src: `${GROCERS_BASE}/bakery/rusk.webp`,
    alt: 'Packets of milk rusk beside stacked rusk slices',
  },
  cookies: {
    src: `${GROCERS_BASE}/bakery/cookies.webp`,
    alt: 'Packets of butter, choco chip and marie biscuits beside loose cookies',
  },
  pav: {
    src: `${GROCERS_BASE}/bakery/pav.webp`,
    alt: 'Packets of pav beside a basket of soft pav buns',
  },
  'bakery-snacks': {
    src: `${GROCERS_BASE}/bakery/bakery-snacks.webp`,
    alt: 'Packets of khari, baked soya sticks and cream rolls beside the loose snacks',
  },

  // ------------------------------------------------ Biscuits & Snacks ---
  // Re-cropped 18 October from a replacement sheet, by
  // scripts/crop-grocers-category.py.
  //
  // ALL SIX APPROVED SHELVES, from a sheet that matches the catalogue
  // exactly: same six names, same order. It replaced an earlier nine-panel
  // sheet that carried four shelves this category does not have and no
  // panel for Mixtures. Both sheets are archived; only this one is used.
  //
  // The main-category banner is NOT from either sheet and was not touched
  // by the re-crop.
  'biscuits-and-snacks': {
    src: `${GROCERS_BASE}/biscuits-and-snacks/biscuits-and-snacks.webp`,
    alt: 'Packets of biscuits, chips and namkeen with bowls of snacks',
  },
  biscuits: {
    src: `${GROCERS_BASE}/biscuits-and-snacks/biscuits.webp`,
    alt: 'Packets of glucose, sandwich and marie biscuits beside loose biscuits',
  },
  chips: {
    src: `${GROCERS_BASE}/biscuits-and-snacks/chips.webp`,
    alt: 'Packets of salted and masala potato chips beside bowls of crisps',
  },
  namkeen: {
    src: `${GROCERS_BASE}/biscuits-and-snacks/namkeen.webp`,
    alt: 'Packets of bhujia and sev beside bowls of namkeen',
  },
  mixtures: {
    src: `${GROCERS_BASE}/biscuits-and-snacks/mixtures.webp`,
    alt: 'Packets of khatta meetha and mixture beside bowls of snack mixture',
  },
  popcorn: {
    src: `${GROCERS_BASE}/biscuits-and-snacks/popcorn.webp`,
    alt: 'Packets of butter, salted and caramel popcorn beside filled bowls',
  },
  fryums: {
    src: `${GROCERS_BASE}/biscuits-and-snacks/fryums.webp`,
    alt: 'Packets of plain, masala and coloured fryums beside bowls of them',
  },

  // ------------------------------------- Chocolates & Confectionery ---
  // Five panels cropped from the supplied collage by
  // scripts/crop-grocers-category.py; the main banner arrived already
  // square and complete and was derived by scripts/derive-grocers-tile.py
  // rather than re-cropped, so it keeps the artwork as supplied.
  //
  // `wafers` IS THIS CATEGORY'S SHELF, not Bakery's. The slug belongs to
  // this main alone across all nineteen — checked against the tree before
  // mapping, because this map is keyed by bare slug and Bakery sells
  // similar things under different names.
  'chocolates-and-confectionery': {
    src: `${GROCERS_BASE}/chocolates-and-confectionery/chocolates-and-confectionery.webp`,
    alt: 'Chocolate bars, boxed chocolates and assorted sweets on a counter',
  },
  chocolates: {
    src: `${GROCERS_BASE}/chocolates-and-confectionery/chocolates.webp`,
    alt: 'Chocolate bars and a box of filled chocolates beside broken chocolate pieces',
  },
  candies: {
    src: `${GROCERS_BASE}/chocolates-and-confectionery/candies.webp`,
    alt: 'Packets of mints and fruit candies beside a bowl of wrapped sweets',
  },
  toffees: {
    src: `${GROCERS_BASE}/chocolates-and-confectionery/toffees.webp`,
    alt: 'Packets of eclairs and caramel toffees beside a bowl of wrapped toffees',
  },
  wafers: {
    src: `${GROCERS_BASE}/chocolates-and-confectionery/wafers.webp`,
    alt: 'Packets of chocolate and cream wafers beside stacked wafer biscuits',
  },
  'chewing-gum': {
    src: `${GROCERS_BASE}/chocolates-and-confectionery/chewing-gum.webp`,
    alt: 'Packets of mint and fruit chewing gum beside loose gum pellets',
  },

  // ------------------------------------------------------ Tea & Coffee ---
  // Six panels cropped from the supplied collage by
  // scripts/crop-grocers-category.py; the main banner arrived already square
  // and complete and was derived by scripts/derive-grocers-tile.py so its
  // title is not cropped away.
  //
  // INSTANT COFFEE AND TEA PREMIXES ARE ADJACENT PANELS of similar shape —
  // jars or sachets behind a filled cup — and transposing them would be
  // invisible to any automated check. They were read off the contact sheet
  // by eye, and a test asserts the two resolve to different files.
  'tea-and-coffee': {
    src: `${GROCERS_BASE}/tea-and-coffee/tea-and-coffee.webp`,
    alt: 'Packets of tea and jars of coffee with filled cups, leaves and beans',
  },
  tea: {
    src: `${GROCERS_BASE}/tea-and-coffee/tea.webp`,
    alt: 'Packets of black tea beside a cup of chai and loose tea leaves',
  },
  'green-tea': {
    src: `${GROCERS_BASE}/tea-and-coffee/green-tea.webp`,
    alt: 'Cartons of green tea beside a glass cup of green tea and fresh leaves',
  },
  coffee: {
    src: `${GROCERS_BASE}/tea-and-coffee/coffee.webp`,
    alt: 'Jars of coffee beside a cup of black coffee and roasted beans',
  },
  'instant-coffee': {
    src: `${GROCERS_BASE}/tea-and-coffee/instant-coffee.webp`,
    alt: 'Jars of instant coffee granules beside a frothy cup and coffee beans',
  },
  'tea-premixes': {
    src: `${GROCERS_BASE}/tea-and-coffee/tea-premixes.webp`,
    alt: 'Sachets of tea premix beside cups of prepared masala chai and spices',
  },
  'health-drinks': {
    src: `${GROCERS_BASE}/tea-and-coffee/health-drinks.webp`,
    alt: 'Jars of malted health drinks beside a glass of mixed malt drink',
  },

  // -------------------------------------------------------- Beverages ---
  // Six panels cropped from the supplied collage by
  // scripts/crop-grocers-category.py; the main banner arrived already
  // square and complete and was derived by scripts/derive-grocers-tile.py.
  //
  // FOUR LOOK-ALIKE SHELVES here. Soft Drinks and Soda are both clear and
  // cola bottles over ice; Juices and Fruit Drinks are both orange cartons
  // and filled glasses. The panels were read off the contact sheet by eye
  // and a test asserts all four resolve to different files, because nothing
  // automatic can tell a juice carton from a fruit-drink carton.
  beverages: {
    src: `${GROCERS_BASE}/beverages/beverages.webp`,
    alt: 'Bottles, cans and cartons of cold drinks with filled glasses and ice',
  },
  'soft-drinks': {
    src: `${GROCERS_BASE}/beverages/soft-drinks.webp`,
    alt: 'Bottles of cola and lemon soft drinks beside a glass of cola over ice',
  },
  juices: {
    src: `${GROCERS_BASE}/beverages/juices.webp`,
    alt: 'Cartons of fruit juice beside glasses of orange, guava and apple juice',
  },
  'energy-drinks': {
    src: `${GROCERS_BASE}/beverages/energy-drinks.webp`,
    alt: 'Cans and bottles of energy drinks packed in crushed ice',
  },
  'fruit-drinks': {
    src: `${GROCERS_BASE}/beverages/fruit-drinks.webp`,
    alt: 'Bottles and cartons of mango and mixed fruit drinks beside whole fruit',
  },
  'packaged-water': {
    src: `${GROCERS_BASE}/beverages/packaged-water.webp`,
    alt: 'Sealed bottles of packaged drinking water beside ice and mint',
  },
  soda: {
    src: `${GROCERS_BASE}/beverages/soda.webp`,
    alt: 'Bottles of soda water and clear fizzy drinks beside filled glasses and lemon',
  },

  // ------------------------------------- Instant & Packaged Foods ---
  // Seven panels cropped from the supplied collage by
  // scripts/crop-grocers-category.py; the main banner arrived already
  // square and complete and was derived by scripts/derive-grocers-tile.py.
  //
  // THREE LOOK-ALIKE SHELVES: Ready-to-Eat, Ready-to-Cook and Instant
  // Mixes are all pouches standing behind bowls of prepared food. They
  // were read off the contact sheet by eye and a test asserts the three
  // resolve to different files.
  'instant-and-packaged-foods': {
    src: `${GROCERS_BASE}/instant-and-packaged-foods/instant-and-packaged-foods.webp`,
    alt: 'Packets of noodles, soup, oats and ready mixes with prepared bowls',
  },
  noodles: {
    src: `${GROCERS_BASE}/instant-and-packaged-foods/noodles.webp`,
    alt: 'Packets of instant noodles beside a pan of cooked masala noodles',
  },
  pasta: {
    src: `${GROCERS_BASE}/instant-and-packaged-foods/pasta.webp`,
    alt: 'Boxes of penne and fusilli with a jar of sauce and a plate of pasta',
  },
  vermicelli: {
    src: `${GROCERS_BASE}/instant-and-packaged-foods/vermicelli.webp`,
    alt: 'Packets of roasted vermicelli beside a bowl of cooked vermicelli',
  },
  'ready-to-eat': {
    src: `${GROCERS_BASE}/instant-and-packaged-foods/ready-to-eat.webp`,
    alt: 'Pouches of ready-to-eat curries beside served bowls of dal and paneer',
  },
  'ready-to-cook': {
    src: `${GROCERS_BASE}/instant-and-packaged-foods/ready-to-cook.webp`,
    alt: 'Packets of idli, dosa and upma mixes beside the prepared dishes',
  },
  soup: {
    src: `${GROCERS_BASE}/instant-and-packaged-foods/soup.webp`,
    alt: 'Sachets of instant soup beside bowls of tomato, sweetcorn and hot-and-sour soup',
  },
  'instant-mixes': {
    src: `${GROCERS_BASE}/instant-and-packaged-foods/instant-mixes.webp`,
    alt: 'Packets of instant dessert and breakfast mixes beside the made dishes',
  },

  // ----------------------------------------- Breakfast & Cereals ---
  // Seven panels cropped from the supplied collage by
  // scripts/crop-grocers-category.py; the main banner arrived already
  // square and complete and was derived by scripts/derive-grocers-tile.py.
  //
  // FOUR CEREAL-BOX SHELVES: Oats, Corn Flakes, Muesli and Cereals are
  // all boxes and pouches standing behind a bowl. They were read off the
  // contact sheet by eye and a test asserts all seven resolve to
  // different files. "Cereals" is the chocolate/malted shelf (Milo,
  // Chocos) — it is not a parent of the other three.
  'breakfast-and-cereals': {
    src: `${GROCERS_BASE}/breakfast-and-cereals/breakfast-and-cereals.webp`,
    alt: 'Cereal boxes, oats, poha and spreads behind bowls of flakes and porridge',
  },
  oats: {
    src: `${GROCERS_BASE}/breakfast-and-cereals/oats.webp`,
    alt: 'Packs of rolled and instant oats beside bowls of porridge with fruit',
  },
  'corn-flakes': {
    src: `${GROCERS_BASE}/breakfast-and-cereals/corn-flakes.webp`,
    alt: 'Boxes of corn flakes beside a bowl of flakes with milk and berries',
  },
  muesli: {
    src: `${GROCERS_BASE}/breakfast-and-cereals/muesli.webp`,
    alt: 'Packs of fruit and nut muesli beside a bowl of muesli with berries',
  },
  cereals: {
    src: `${GROCERS_BASE}/breakfast-and-cereals/cereals.webp`,
    alt: 'Packs of malted and chocolate breakfast cereal beside a bowl and a glass of milk',
  },
  poha: {
    src: `${GROCERS_BASE}/breakfast-and-cereals/poha.webp`,
    alt: 'Packs of flattened rice beside a plate of cooked poha with peanuts and lemon',
  },
  dalia: {
    src: `${GROCERS_BASE}/breakfast-and-cereals/dalia.webp`,
    alt: 'Packs of broken wheat dalia beside a bowl of cooked dalia with vegetables',
  },
  'breakfast-mixes': {
    src: `${GROCERS_BASE}/breakfast-and-cereals/breakfast-mixes.webp`,
    alt: 'Packets of rava idli, dosa and upma mixes beside the prepared dishes',
  },

  // ------------------------------------ Sauces, Pickles & Spreads ---
  // Eight panels cropped from the supplied collage by
  // scripts/crop-grocers-category.py; the main banner arrived already
  // square and complete and was derived by scripts/derive-grocers-tile.py.
  //
  // FOUR POURED-CONDIMENT SHELVES: Ketchup, Sauces, Mayonnaise and
  // Chutney are all bottles standing behind small bowls of sauce. They
  // were read off the contact sheet by eye and a test asserts all eight
  // resolve to different files.
  'sauces-pickles-and-spreads': {
    src: `${GROCERS_BASE}/sauces-pickles-and-spreads/sauces-pickles-and-spreads.webp`,
    alt: 'Sauce bottles and pickle jars above bowls of chutney, ketchup and spreads',
  },
  pickles: {
    src: `${GROCERS_BASE}/sauces-pickles-and-spreads/pickles.webp`,
    alt: 'Jars of mango, lemon and mixed pickle beside bowls of pickled vegetables',
  },
  ketchup: {
    src: `${GROCERS_BASE}/sauces-pickles-and-spreads/ketchup.webp`,
    alt: 'Bottles of tomato ketchup beside fresh tomatoes and a bowl of ketchup',
  },
  sauces: {
    src: `${GROCERS_BASE}/sauces-pickles-and-spreads/sauces.webp`,
    alt: 'Bottles of soya, chilli and Worcestershire sauce beside small dipping bowls',
  },
  mayonnaise: {
    src: `${GROCERS_BASE}/sauces-pickles-and-spreads/mayonnaise.webp`,
    alt: 'Jars of classic and veg mayonnaise beside a bowl of mayonnaise and a burger',
  },
  jam: {
    src: `${GROCERS_BASE}/sauces-pickles-and-spreads/jam.webp`,
    alt: 'Jars of mixed fruit and strawberry jam beside jam on toast and fresh berries',
  },
  honey: {
    src: `${GROCERS_BASE}/sauces-pickles-and-spreads/honey.webp`,
    alt: 'Bottles of honey beside a bowl with a dipper and a piece of honeycomb',
  },
  'peanut-butter': {
    src: `${GROCERS_BASE}/sauces-pickles-and-spreads/peanut-butter.webp`,
    alt: 'Jars of creamy peanut butter beside peanut butter on toast and loose peanuts',
  },
  chutney: {
    src: `${GROCERS_BASE}/sauces-pickles-and-spreads/chutney.webp`,
    alt: 'Jars of schezwan, coriander and mint chutney beside bowls of each',
  },

  // ------------------------------------------- Frozen & Ice Cream ---
  // Five panels cropped from the supplied collage by
  // scripts/crop-grocers-category.py; the main banner arrived already
  // square and complete and was derived by scripts/derive-grocers-tile.py.
  //
  // THE TWO TOP PANELS ARE 1.87:1. Cover-cropping them to a square threw
  // away a whole tub at each end, so the cropper fits those full width
  // over a blurred backdrop instead (see WIDE_PANEL there). Nothing on
  // any other category changed — every earlier tile re-generates
  // byte-identically.
  //
  // TWO FROZEN-PACKET SHELVES: Frozen Vegetables and Frozen Snacks are
  // both printed pouches behind bowls. Read off the contact sheet by eye
  // and a test asserts all five resolve to different files.
  'frozen-and-ice-cream': {
    src: `${GROCERS_BASE}/frozen-and-ice-cream/frozen-and-ice-cream.webp`,
    alt: 'Frozen snack and vegetable packs with ice cream tubs over a bed of ice',
  },
  'ice-cream': {
    src: `${GROCERS_BASE}/frozen-and-ice-cream/ice-cream.webp`,
    alt: 'Tubs of vanilla, chocolate and strawberry ice cream beside scoops and a choc bar',
  },
  kulfi: {
    src: `${GROCERS_BASE}/frozen-and-ice-cream/kulfi.webp`,
    alt: 'Packs of malai and kesar pista kulfi beside kulfi sticks and a matka',
  },
  'frozen-vegetables': {
    src: `${GROCERS_BASE}/frozen-and-ice-cream/frozen-vegetables.webp`,
    alt: 'Packs of frozen mixed vegetables, peas and sweet corn beside bowls of each',
  },
  'frozen-snacks': {
    src: `${GROCERS_BASE}/frozen-and-ice-cream/frozen-snacks.webp`,
    alt: 'Packs of frozen fries, nuggets and spring rolls beside the fried snacks',
  },
  'frozen-paratha': {
    src: `${GROCERS_BASE}/frozen-and-ice-cream/frozen-paratha.webp`,
    alt: 'Packs of plain, aloo and lachha paratha beside a stack of cooked parathas',
  },

  // ------------------------------------------------ Home Cleaning ---
  // Seven panels cropped from the supplied collage by
  // scripts/crop-grocers-category.py; the main banner arrived already
  // square and complete and was derived by scripts/derive-grocers-tile.py.
  //
  // FABRIC CARE carries a liquid-detergent bottle in the supplied panel,
  // standing with the fabric conditioners. The panel is used exactly as
  // supplied and mapped to Fabric Care, which is the shelf it is drawn
  // for. It was NOT moved to Detergent and no extra shelf was created:
  // artwork never reshapes the catalogue.
  //
  // FOUR SPRAY-AND-BOTTLE SHELVES: Floor Cleaner, Toilet Cleaner, Glass
  // Cleaner and Dishwash are all coloured bottles in a row. Read off the
  // contact sheet by eye and a test asserts all seven resolve to
  // different files.
  'home-cleaning': {
    src: `${GROCERS_BASE}/home-cleaning/home-cleaning.webp`,
    alt: 'Detergent packs, cleaning sprays, bottles, cloths and a mop on a counter',
  },
  detergent: {
    src: `${GROCERS_BASE}/home-cleaning/detergent.webp`,
    alt: 'Packs of washing powder and liquid detergent beside folded laundry',
  },
  dishwash: {
    src: `${GROCERS_BASE}/home-cleaning/dishwash.webp`,
    alt: 'Bottles of dishwashing liquid beside lemons, scrub pads and clean plates',
  },
  'floor-cleaner': {
    src: `${GROCERS_BASE}/home-cleaning/floor-cleaner.webp`,
    alt: 'Bottles of disinfectant floor cleaner beside a mop and bucket',
  },
  'toilet-cleaner': {
    src: `${GROCERS_BASE}/home-cleaning/toilet-cleaner.webp`,
    alt: 'Bottles of toilet cleaner and thick bleach beside a toilet brush',
  },
  'glass-cleaner': {
    src: `${GROCERS_BASE}/home-cleaning/glass-cleaner.webp`,
    alt: 'Trigger sprays of glass cleaner beside a microfibre cloth at a window',
  },
  'fabric-care': {
    src: `${GROCERS_BASE}/home-cleaning/fabric-care.webp`,
    alt: 'Bottles of fabric conditioner and gentle liquid wash beside folded towels',
  },
  'garbage-bags': {
    src: `${GROCERS_BASE}/home-cleaning/garbage-bags.webp`,
    alt: 'Packs of small, medium and heavy-duty garbage bags beside a lined bin',
  },

  // ------------------------------------------------ Personal Care ---
  // Nine panels cropped from the supplied collage by
  // scripts/crop-grocers-category.py; the main banner arrived already
  // square and complete and was derived by scripts/derive-grocers-tile.py.
  //
  // THE SHEET IS NOT A REGULAR 3x3. Its columns are even, but its rows
  // are 332px, 315px and 364px, so the panels were measured per band
  // rather than divided into nine equal squares.
  //
  // ALL NINE PANELS ARE 1.8:1 TO 2.0:1, the widest sheet so far, so every
  // tile here takes the cropper's WIDE_PANEL path: fitted to full width
  // over a blurred backdrop instead of cover-cropped, which on these
  // panels would have deleted the product at each end of every row.
  //
  // THREE BOTTLE-ROW SHELVES: Shampoo, Hair Oil and Deodorants are all a
  // row of tall coloured bottles. Read off the contact sheet by eye and a
  // test asserts all nine resolve to different files.
  'personal-care': {
    src: `${GROCERS_BASE}/personal-care/personal-care.webp`,
    alt: 'Body wash, shampoo, soap, toothpaste and grooming products on a counter',
  },
  'bath-soap': {
    src: `${GROCERS_BASE}/personal-care/bath-soap.webp`,
    alt: 'Cartons and bars of bathing soap beside flowers and folded towels',
  },
  shampoo: {
    src: `${GROCERS_BASE}/personal-care/shampoo.webp`,
    alt: 'Bottles of anti-dandruff and anti-hair-fall shampoo in a row',
  },
  'hair-oil': {
    src: `${GROCERS_BASE}/personal-care/hair-oil.webp`,
    alt: 'Bottles of coconut, amla and herbal hair oil beside amla and coconut',
  },
  toothpaste: {
    src: `${GROCERS_BASE}/personal-care/toothpaste.webp`,
    alt: 'Stacked cartons of toothpaste beside fresh mint leaves',
  },
  toothbrush: {
    src: `${GROCERS_BASE}/personal-care/toothbrush.webp`,
    alt: 'Blister packs of toothbrushes beside brushes standing in a glass',
  },
  'face-wash': {
    src: `${GROCERS_BASE}/personal-care/face-wash.webp`,
    alt: 'Tubes of neem, vitamin C and oil-control face wash in a row',
  },
  creams: {
    src: `${GROCERS_BASE}/personal-care/creams.webp`,
    alt: 'Jars and tubs of moisturising cream and petroleum jelly beside towels',
  },
  deodorants: {
    src: `${GROCERS_BASE}/personal-care/deodorants.webp`,
    alt: 'Deodorant body sprays and a roll-on standing in a row',
  },
  shaving: {
    src: `${GROCERS_BASE}/personal-care/shaving.webp`,
    alt: 'A razor, shaving foam and after-shave balm beside a shaving brush',
  },

  // ---------------------------------------------------- Baby Care ---
  // Five panels cropped from the supplied collage by
  // scripts/crop-grocers-category.py; the main banner arrived already
  // square and complete and was derived by scripts/derive-grocers-tile.py.
  //
  // DIAPERS arrived later, on its own square sheet with its banner already
  // in place, and was derived by scripts/derive-grocers-tile.py like every
  // other supplied square. It is NOT a fragment cut out of the Baby Care
  // main image — that shortcut was available throughout and deliberately
  // not taken while the shelf sat on its icon.
  //
  // BABY SHAMPOO AND BABY LOTION look almost identical — the same four
  // brands, same bottle shapes, read apart only by their labels. Checked
  // on the contact sheet at full size and a test asserts they are two
  // different files.
  'baby-care': {
    src: `${GROCERS_BASE}/baby-care/baby-care.webp`,
    alt: 'Diaper packs, baby wash, lotion, powder and feeding bottles with soft toys',
  },
  diapers: {
    src: `${GROCERS_BASE}/baby-care/diapers.webp`,
    alt: 'Packs of taped and pant-style diapers beside folded nappies and a soft toy',
  },
  'baby-food': {
    src: `${GROCERS_BASE}/baby-care/baby-food.webp`,
    alt: 'Tins of infant cereal and formula with fruit purée jars and a feeding bowl',
  },
  'baby-soap': {
    src: `${GROCERS_BASE}/baby-care/baby-soap.webp`,
    alt: 'Cartons and bars of gentle baby soap beside soft towels and a rubber duck',
  },
  'baby-shampoo': {
    src: `${GROCERS_BASE}/baby-care/baby-shampoo.webp`,
    alt: 'Bottles of tear-free baby shampoo and baby wash in a row',
  },
  'baby-lotion': {
    src: `${GROCERS_BASE}/baby-care/baby-lotion.webp`,
    alt: 'Bottles of moisturising baby lotion beside folded towels and a soft toy',
  },
  'baby-wipes': {
    src: `${GROCERS_BASE}/baby-care/baby-wipes.webp`,
    alt: 'Packs of gentle baby wipes stacked together',
  },

  // ------------------------- Pooja & Household Essentials ---
  // Eight panels cropped from the supplied collage by
  // scripts/crop-grocers-category.py.
  //
  // THE MAIN TILE ARRIVED SECOND. The first supplied square carried a
  // brass deity statue, which this category's brief ruled out, and
  // redesigning supplied artwork was ruled out too — so it was archived
  // unaltered as SRC-...-main-REJECTED-deity-statue.png and never
  // installed, and the main sat on its icon. The replacement below was
  // checked at full resolution for deity imagery and cleaning products
  // before being derived by scripts/derive-grocers-tile.py. Nothing was
  // ever cut out of the collage to stand in for it.
  //
  'pooja-and-household-essentials': {
    src: `${GROCERS_BASE}/pooja-and-household-essentials/pooja-and-household-essentials.webp`,
    alt: 'Agarbatti, lamp oil, camphor, wicks, matches, batteries, tissue and foil with brass lamps',
  },
  // TWO LOOK-ALIKE PAIRS: Agarbatti and Camphor are both red-and-gold
  // pooja packaging over brass; Tissue and Aluminium Foil are both flat
  // printed cartons. Read off the contact sheet by eye and a test asserts
  // all eight resolve to different files.
  agarbatti: {
    src: `${GROCERS_BASE}/pooja-and-household-essentials/agarbatti.webp`,
    alt: 'Packs of incense sticks beside a bundle of agarbatti in a brass stand',
  },
  camphor: {
    src: `${GROCERS_BASE}/pooja-and-household-essentials/camphor.webp`,
    alt: 'A jar and pack of camphor tablets beside a brass bowl of camphor',
  },
  'pooja-oil': {
    src: `${GROCERS_BASE}/pooja-and-household-essentials/pooja-oil.webp`,
    alt: 'Bottles of pooja lamp oil standing together',
  },
  wicks: {
    src: `${GROCERS_BASE}/pooja-and-household-essentials/wicks.webp`,
    alt: 'Packs of pure cotton wicks beside loose wick bundles in a brass bowl',
  },
  'match-boxes': {
    src: `${GROCERS_BASE}/pooja-and-household-essentials/match-boxes.webp`,
    alt: 'Boxes of safety matches, one open with matchsticks beside it',
  },
  batteries: {
    src: `${GROCERS_BASE}/pooja-and-household-essentials/batteries.webp`,
    alt: 'Blister packs of AA batteries beside loose cells',
  },
  tissue: {
    src: `${GROCERS_BASE}/pooja-and-household-essentials/tissue.webp`,
    alt: 'Boxes of facial tissues, one with a tissue drawn up through the top',
  },
  'aluminium-foil': {
    src: `${GROCERS_BASE}/pooja-and-household-essentials/aluminium-foil.webp`,
    alt: 'Cartons of kitchen aluminium foil beside an unrolled roll of foil',
  },

  // --------------------------------------------------- Pet Care ---
  // The last Grocers category. Four panels cropped from the supplied
  // collage by scripts/crop-grocers-category.py; the main banner arrived
  // already square and was derived by scripts/derive-grocers-tile.py.
  // Its banner was checked at full resolution for the paw prints the
  // brief ruled out — it reads "Pet Care" and nothing else.
  //
  // All four panels are about 1.85:1, so every tile here takes the
  // cropper's WIDE_PANEL path rather than losing the pack at each end.
  //
  // DOG FOOD vs PET TREATS both lead with a golden retriever behind
  // Pedigree packaging; CAT FOOD and PET TREATS both carry a tabby.
  // Read off the contact sheet by eye and a test asserts all four
  // resolve to different files.
  'pet-care': {
    src: `${GROCERS_BASE}/pet-care/pet-care.webp`,
    alt: 'Dog and cat food packs with bowls, toys, collars and grooming brushes',
  },
  'dog-food': {
    src: `${GROCERS_BASE}/pet-care/dog-food.webp`,
    alt: 'Packs and cans of adult and puppy dog food beside a filled feeding bowl',
  },
  'cat-food': {
    src: `${GROCERS_BASE}/pet-care/cat-food.webp`,
    alt: 'Packs and cans of adult and kitten cat food beside a filled feeding bowl',
  },
  'pet-treats': {
    src: `${GROCERS_BASE}/pet-care/pet-treats.webp`,
    alt: 'Packets of biscuits, chew sticks and treats beside loose biscuits',
  },
  'pet-accessories': {
    src: `${GROCERS_BASE}/pet-care/pet-accessories.webp`,
    alt: 'A carrier, bed, bowl, collars, leash, toys and grooming brushes',
  },
};

/**
 * The picture for a category, or null when none is supplied.
 *
 * `businessSlug` decides which map is consulted, so a Grocers category can
 * never pick up a Fresh Mart photograph by sharing a slug — "vegetables"
 * and "rice" are both plausible collisions.
 */
export function categoryImage(businessSlug: string, categorySlug: string): CategoryImage | null {
  if (businessSlug === 'fresh-mart') return FRESH_MART_IMAGES[categorySlug] ?? null;
  if (businessSlug === 'grocers') return GROCERS_IMAGES[categorySlug] ?? null;
  return null;
}

/** Exposed for the tests that check each map against the category tree. */
export const FRESH_MART_IMAGE_SLUGS = Object.keys(FRESH_MART_IMAGES);
export const GROCERS_IMAGE_SLUGS = Object.keys(GROCERS_IMAGES);
