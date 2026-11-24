import { describe, it, expect } from 'vitest';
import { mediaUrl } from './pif-api';

/**
 * WHICH ORIGIN SERVES A PICTURE.
 *
 * This file exists because of a defect that every layer below it reported as
 * healthy. Migration 0054 attached the PIF category pictures, the database
 * held the right paths, `GET /pif/categories` returned them, the files were on
 * disk and served 200 — and every category card on the running demo still
 * showed its placeholder.
 *
 * The cause was here: `mediaUrl` prefixed EVERY relative path with the API's
 * base URL, so the browser asked the API for `/catalogue/pif/category/...`,
 * which the API has no route for. The file is a static asset of the customer
 * app itself.
 *
 * Found by opening the running app and reading the `src` attributes. Keeping
 * it found is what these tests are for.
 */
describe('mediaUrl — the two kinds of image reference', () => {
  it('leaves a STATIC catalogue asset alone: this app serves it, not the API', () => {
    // The defect, in one assertion. A host here means a 404.
    expect(mediaUrl('/catalogue/pif/category/dals-pulses-beans.png')).toBe(
      '/catalogue/pif/category/dals-pulses-beans.png'
    );
    expect(mediaUrl('/catalogue/rik/category/milk.png')).toBe('/catalogue/rik/category/milk.png');
  });

  it('sends an UPLOADED image to the API, which is the only thing that can serve it', () => {
    const url = mediaUrl('/pif/media/pif/products/abc.png');
    expect(url).toMatch(/^https?:\/\/.+\/pif\/media\/pif\/products\/abc\.png$/);
  });

  it('sends an UPLOADED RIK PROVISION picture to the API the same way', () => {
    // RIK uploads arrive as /rik/media/..., served by RikMediaController.
    // Before provision uploads existed, every RIK reference was a static
    // asset, so this branch had nothing to exercise it.
    const url = mediaUrl('/rik/media/rik/provisions/abc.png');
    expect(url).toMatch(/^https?:\/\/.+\/rik\/media\/rik\/provisions\/abc\.png$/);
  });

  it('still leaves the 180 committed RIK provision pictures alone', () => {
    // The preservation guarantee, as an assertion: attaching uploads to RIK
    // must not change where a single existing picture is fetched from.
    expect(mediaUrl('/catalogue/rik/fresh/42_tomato-red.png')).toBe('/catalogue/rik/fresh/42_tomato-red.png');
    expect(mediaUrl('/catalogue/rik/fresh-staples/milk__td-milkmaid.png')).toBe(
      '/catalogue/rik/fresh-staples/milk__td-milkmaid.png'
    );
  });

  it('passes an absolute URL through untouched', () => {
    expect(mediaUrl('https://cdn.example.test/x.png')).toBe('https://cdn.example.test/x.png');
  });

  it('leaves a reference with no leading slash alone rather than mangling it', () => {
    // The admin portal's image-reference box takes free text, so this shape
    // reaches the browser. Prefixing it produced
    // "http://localhost:3000rik/catalogue/ghee.jpg" — no separator, no
    // picture. Only the API's own two media routes go to the API.
    expect(mediaUrl('rik/catalogue/ghee.jpg')).toBe('rik/catalogue/ghee.jpg');
  });

  it('answers null for no picture, so the card shows its placeholder', () => {
    // Never an empty string: an <img src=""> re-requests the page itself.
    expect(mediaUrl(null)).toBeNull();
  });
});
