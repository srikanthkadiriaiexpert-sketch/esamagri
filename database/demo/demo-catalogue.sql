-- ---------------------------------------------------------------------------
-- demo-catalogue.sql — a small, plausible PIF catalogue for demonstrations.
--
-- WHAT THIS IS FOR. The client's real SKU spreadsheet arrives later; until it
-- does, a demonstration needs something on the shelves. These are ordinary
-- grocery items at ordinary prices, chosen to exercise the parts of the shop
-- that matter: two category levels, GST at three rates, a discounted line, an
-- item with an order limit, a multi-pack variant family, and one product that
-- is deliberately out for the day so "Available = No" can be seen working.
--
-- WHAT IT IS NOT. It is not the yard's catalogue, it is not priced from any
-- real price list, and nothing here should survive the client's first import.
-- Every row is created by the application's own rules when the real
-- spreadsheet is imported, which is the point of the import feature.
--
-- NO PHOTOGRAPHS. `image_ref` is left null throughout: the shop shows its
-- placeholder, and the client uploads their own pictures on each product's
-- screen. Shipping stock photography of groceries we do not own would be
-- someone else's copyright sitting in a government deployment.
--
-- NO STOCK, anywhere. `available` is a flag an administrator sets; there is
-- no counted quantity in PIF and this file introduces none.
--
-- Run as the database owner, against a database that already has every
-- migration applied. Safe to re-run: every insert is keyed on its SKU or
-- name and does nothing the second time.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------- tax rates
INSERT INTO pif.tax_rates (name, rate_pct, active)
SELECT v.name, v.rate_pct, true
  FROM (VALUES ('GST 5%', 5.00), ('GST 12%', 12.00), ('GST 18%', 18.00)) AS v(name, rate_pct)
 WHERE NOT EXISTS (SELECT 1 FROM pif.tax_rates t WHERE t.name = v.name);

-- -------------------------------------------------------------- categories
INSERT INTO pif.categories (name, parent_id, description, sort_order, active)
SELECT v.name, NULL, v.description, v.sort_order, true
  FROM (VALUES
    ('Staples',          'Rice, atta, sugar and salt',        10),
    ('Pulses',           'Dals and whole pulses',             20),
    ('Oils & Ghee',      'Cooking oils and ghee',             30),
    ('Dairy',            'Milk, curd, paneer and butter',     40),
    ('Snacks & Biscuits','Packaged snacks',                   50),
    ('Beverages',        'Tea, coffee and soft drinks',       60),
    ('Household',        'Cleaning and everyday supplies',    70)
  ) AS v(name, description, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM pif.categories c WHERE lower(c.name) = lower(v.name) AND c.parent_id IS NULL
 );

INSERT INTO pif.categories (name, parent_id, description, sort_order, active)
SELECT v.name, p.id, v.description, v.sort_order, true
  FROM (VALUES
    ('Staples', 'Rice',            'Sona masoori, basmati and boiled rice', 10),
    ('Staples', 'Atta & Flours',   'Wheat atta, maida and besan',           20),
    ('Staples', 'Sugar & Salt',    'Sugar, jaggery and iodised salt',       30),
    ('Pulses',  'Dals',            'Toor, moong, masoor and chana dal',     10),
    ('Dairy',   'Milk & Curd',     'Toned milk, curd and buttermilk',       10)
  ) AS v(parent, name, description, sort_order)
  JOIN pif.categories p ON lower(p.name) = lower(v.parent) AND p.parent_id IS NULL
 WHERE NOT EXISTS (
   SELECT 1 FROM pif.categories c
    WHERE lower(c.name) = lower(v.name) AND c.parent_id = p.id
 );

-- ---------------------------------------------------------------- products
INSERT INTO pif.products (
  sku, name, brand, description, category_id, unit, pack_size, pack_unit,
  selling_price, purchase_price, tax_rate_id, discount_pct,
  min_order_qty, max_order_qty, qty_step, active, available,
  variant_group, variant_label
)
SELECT v.sku, v.name, v.brand, v.description, c.id, v.unit, v.pack_size, v.pack_unit,
       v.selling_price, v.purchase_price, t.id, v.discount_pct,
       v.min_qty, v.max_qty, v.qty_step, true, v.available,
       v.variant_group, v.variant_label
  FROM (VALUES
    -- sku,          name,                      brand,         description, category,        unit, pack, packunit, price, cost,  gst,  disc, min, max,  step, available, family,      label
    ('DEMO-RICE-1',  'Sona Masoori Rice 5 kg',  'Yard Fresh',  'Everyday table rice, 5 kg pack',        'Rice',            'kg',   5.000, 'kg', 365.00, 330.00, 'GST 5%',  NULL, 1.000, 4.000,  1.000, true,  'demo-rice',  '5 kg'),
    ('DEMO-RICE-2',  'Sona Masoori Rice 10 kg', 'Yard Fresh',  'Everyday table rice, 10 kg pack',       'Rice',            'kg',  10.000, 'kg', 715.00, 650.00, 'GST 5%',  NULL, 1.000, 2.000,  1.000, true,  'demo-rice',  '10 kg'),
    ('DEMO-RICE-3',  'Basmati Rice 1 kg',       'Yard Fresh',  'Long grain basmati',                    'Rice',            'kg',   1.000, 'kg', 148.00, 132.00, 'GST 5%',  NULL, 1.000, NULL,   1.000, true,  NULL,         NULL),
    ('DEMO-ATTA-1',  'Whole Wheat Atta 5 kg',   'Yard Fresh',  'Chakki-fresh atta',                     'Atta & Flours',   'kg',   5.000, 'kg', 245.00, 222.00, 'GST 5%',  NULL, 1.000, NULL,   1.000, true,  NULL,         NULL),
    ('DEMO-SUGAR-1', 'Sugar 1 kg',              NULL,          'Refined sugar',                         'Sugar & Salt',    'kg',   1.000, 'kg',  46.00,  42.00, 'GST 5%',  NULL, 1.000, 10.000, 1.000, true,  NULL,         NULL),
    ('DEMO-SALT-1',  'Iodised Salt 1 kg',       'Tata',        'Free-flowing iodised salt',             'Sugar & Salt',    'kg',   1.000, 'kg',  28.00,  25.00, 'GST 5%',  NULL, 1.000, NULL,   1.000, true,  NULL,         NULL),
    ('DEMO-DAL-1',   'Toor Dal 1 kg',           'Yard Fresh',  'Unpolished toor dal',                   'Dals',            'kg',   1.000, 'kg', 142.50, 128.00, 'GST 5%',  NULL, 1.000, 5.000,  1.000, true,  NULL,         NULL),
    ('DEMO-DAL-2',   'Moong Dal 1 kg',          'Yard Fresh',  'Split moong dal',                       'Dals',            'kg',   1.000, 'kg', 138.00, 124.00, 'GST 5%',  NULL, 1.000, 5.000,  1.000, true,  NULL,         NULL),
    ('DEMO-DAL-3',   'Chana Dal 1 kg',          NULL,          'Split bengal gram',                     'Dals',            'kg',   1.000, 'kg',  96.00,  86.00, 'GST 5%',  NULL, 1.000, 5.000,  1.000, true,  NULL,         NULL),
    ('DEMO-OIL-1',   'Sunflower Oil 1 L',       'Yard Fresh',  'Refined sunflower oil pouch',           'Oils & Ghee',     'l',    1.000, 'l',  142.00, 128.00, 'GST 5%', 10.00, 1.000, 6.000,  1.000, true,  'demo-oil',   '1 litre'),
    ('DEMO-OIL-2',   'Sunflower Oil 5 L',       'Yard Fresh',  'Refined sunflower oil can',             'Oils & Ghee',     'l',    5.000, 'l',  690.00, 630.00, 'GST 5%', 10.00, 1.000, 2.000,  1.000, true,  'demo-oil',   '5 litre'),
    ('DEMO-GHEE-1',  'Cow Ghee 500 ml',         'Amul',        'Pure cow ghee',                         'Oils & Ghee',     'ml',  500.000,'ml', 325.00, 298.00, 'GST 12%', NULL, 1.000, 3.000,  1.000, true,  NULL,         NULL),
    ('DEMO-MILK-1',  'Toned Milk 500 ml',       'Amul',        'Pasteurised toned milk',                'Milk & Curd',     'ml',  500.000,'ml',  27.00,  25.00, 'GST 5%',  NULL, 1.000, 12.000, 1.000, true,  NULL,         NULL),
    ('DEMO-CURD-1',  'Curd 400 g',              'Amul',        'Set curd cup',                          'Milk & Curd',     'g',   400.000,'g',   35.00,  32.00, 'GST 5%',  NULL, 1.000, 6.000,  1.000, false, NULL,         NULL),
    ('DEMO-PANEER-1','Paneer 200 g',            'Amul',        'Fresh paneer block',                    'Dairy',           'g',   200.000,'g',   95.00,  88.00, 'GST 5%',  NULL, 1.000, 4.000,  1.000, true,  NULL,         NULL),
    ('DEMO-BISC-1',  'Marie Biscuits 250 g',    'Britannia',   'Tea-time biscuits',                     'Snacks & Biscuits','g',  250.000,'g',   40.00,  36.00, 'GST 18%', NULL, 1.000, NULL,   1.000, true,  NULL,         NULL),
    ('DEMO-NAMK-1',  'Mixture Namkeen 200 g',   'Haldiram',    'South Indian mixture',                  'Snacks & Biscuits','g',  200.000,'g',   55.00,  49.00, 'GST 12%', NULL, 1.000, NULL,   1.000, true,  NULL,         NULL),
    ('DEMO-TEA-1',   'Tea Leaves 250 g',        'Tata',        'Strong CTC tea',                        'Beverages',       'g',   250.000,'g',  145.00, 132.00, 'GST 5%',  NULL, 1.000, NULL,   1.000, true,  NULL,         NULL),
    ('DEMO-COFF-1',  'Filter Coffee 200 g',     'Bru',         'Coffee-chicory blend',                  'Beverages',       'g',   200.000,'g',  175.00, 160.00, 'GST 18%', NULL, 1.000, NULL,   1.000, true,  NULL,         NULL),
    ('DEMO-SOAP-1',  'Bathing Soap 100 g',      'Lifebuoy',    'Per cake',                              'Household',       'piece', 1.000,NULL,   38.00,  34.00, 'GST 18%', NULL, 1.000, 12.000, 1.000, true,  NULL,         NULL),
    ('DEMO-DET-1',   'Detergent Powder 1 kg',   'Surf',        'Machine wash powder',                   'Household',       'kg',   1.000, 'kg', 165.00, 150.00, 'GST 18%', NULL, 1.000, 4.000,  1.000, true,  NULL,         NULL)
  ) AS v(sku, name, brand, description, category, unit, pack_size, pack_unit,
         selling_price, purchase_price, gst, discount_pct,
         min_qty, max_qty, qty_step, available, variant_group, variant_label)
  JOIN pif.categories c ON lower(c.name) = lower(v.category)
  LEFT JOIN pif.tax_rates t ON t.name = v.gst
 WHERE NOT EXISTS (SELECT 1 FROM pif.products p WHERE p.sku = v.sku);

-- ------------------------------------------------------------ verification
DO $$
DECLARE
  categories integer;
  products integer;
  unavailable integer;
BEGIN
  SELECT count(*) INTO categories FROM pif.categories;
  SELECT count(*) INTO products FROM pif.products WHERE sku LIKE 'DEMO-%';
  SELECT count(*) INTO unavailable FROM pif.products WHERE sku LIKE 'DEMO-%' AND NOT available;

  IF products <> 21 THEN
    RAISE EXCEPTION 'demo-catalogue: expected 21 demo products, found %.', products;
  END IF;
  IF categories < 12 THEN
    RAISE EXCEPTION 'demo-catalogue: expected at least 12 categories, found %.', categories;
  END IF;
  -- One item deliberately off the shelf, so the demo can show availability.
  IF unavailable <> 1 THEN
    RAISE EXCEPTION 'demo-catalogue: expected exactly 1 unavailable demo product, found %.', unavailable;
  END IF;
  -- And no stock anywhere, which is the rule this module is built on.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'pif' AND table_name = 'products'
       AND column_name IN ('stock_qty', 'on_hand', 'quantity_available')
  ) THEN
    RAISE EXCEPTION 'demo-catalogue: a stock column exists on pif.products; it must not.';
  END IF;
END;
$$;
