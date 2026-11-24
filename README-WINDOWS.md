# e-Samagri — multi-business PIF: Windows transfer

**Categories 1-6 artwork consistency correction**

Unzip **at** `C:\esamagri\esamagri-app`. Paths inside are relative to the
project root.

## Before you unzip

1. Take a backup. A copy of the folder, and a `pg_dump` of the database.
2. Check `MANIFEST.md` against what you have. It marks every file "new" or
   "modified", and it ends with the two files you must DELETE by hand after
   unzipping — they are replaced, and leaving them can fail the build.

## After unzipping

```
cd C:\esamagri\esamagri-app
npm install
npm run build -w @esamagri/customer-web
npm run demo
```

`npm install` is required: `package.json` and `package-lock.json` changed
(one package added, `lucide-react`). The build is required because files
under `public/` do not trigger the demo runner's rebuild check.

## What to check in the browser

1. `/pif` lists six businesses in order: Grocers, Fresh Mart, Fit Food Bay,
   Kelvin Scale Creamery, Visakha Dairy, Laddu Gopal — each with its logo.
2. Grocers and Fresh Mart now share one screen: the business's own logo in
   the header with "Payment Issue Facility" under it, NOFRA/Visakhapatnam,
   the cart, the search field, the category drawer behind the menu control,
   a breadcrumb and a five-item bottom bar.
3. Grocers shows 19 categories; opening one shows its subcategories as a
   grid, and selecting one changes the URL. Rice, Atta & Flour,
   Dal & Pulses and Oil & Ghee carry photographs; the other sixteen show
   their icons.
4. "Currently stocked" on the Grocers home still opens the real shelves, and
   the cart, checkout and orders still work.
5. Kelvin Scale, Visakha Dairy and Laddu Gopal each show their own menu, and
   tapping one opens the full-size original.
6. Fit Food Bay's button opens their ordering site in a new tab.
7. RIK is unchanged: Know Your Ration opens, it still carries the shared
   four-item bottom bar, and the Milk screen still asks for a number of
   coupons.

If the pictures do not appear, the service worker is serving the old bundle —
hard refresh with Ctrl+F5.

## What this package does NOT do

- **No database migration.** None is written, none is included, none has
  been executed. The business identity column is designed only — see
  `docs/reports/migration-0055-design-2026-10-17.md`, which needs your
  approval first.
- **No catalogue data.** The 19 Grocers categories and both Fresh Mart
  categories have no products behind them, because none has been supplied.
  Their shelves say so plainly. Fill in
  `docs/templates/esamagri-catalogue-import-template.xlsx` to change that.
- **No RIK change of any kind.** `apps/api/src`, `database/`,
  `apps/admin-web/src` and `apps/customer-web/src/routes/rik` were compared
  by checksum against the known-good copy and are identical.
- **No security or permission change.** The concerns found are written up in
  `docs/reports/deployment-readiness-2026-10-17.md` for you to act on.

## To undo

Restore the folder backup. Nothing in this package touches the database, so
no database rollback is needed.
