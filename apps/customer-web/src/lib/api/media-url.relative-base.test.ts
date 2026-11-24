import { describe, it, expect, vi } from 'vitest';

/**
 * PRODUCT IMAGES UNDER A SAME-ORIGIN API BASE.
 *
 * pif-media-url.test.ts covers the two kinds of image reference with the
 * ABSOLUTE base the test environment supplies (http://localhost:3000).
 * Staging now runs on a SAME-ORIGIN base — VITE_API_BASE_URL=/api, with
 * the dev server forwarding to the API — and the composition rule is the
 * part that changes shape: an uploaded picture has to come out as
 * `/api/pif/media/...` so it travels through the proxy, while a static
 * catalogue asset must still be left completely alone, because this app
 * serves it and prefixing it would ask the API for a file it does not
 * have. That was a real defect once (see pif-media-url.test.ts); this
 * file is here so the move to a relative base cannot bring it back.
 *
 * `env` is mocked rather than driven through vitest.config.ts so that
 * both bases are exercised in the same test run.
 */
vi.mock('../../env', () => ({ env: { VITE_API_BASE_URL: '/api' } }));

const { mediaUrl } = await import('./media-url');

describe('mediaUrl with a same-origin API base', () => {
  it('routes an UPLOADED PIF picture through the proxy prefix', () => {
    expect(mediaUrl('/pif/media/pif/products/abc.png')).toBe(
      '/api/pif/media/pif/products/abc.png'
    );
  });

  it('routes an UPLOADED RIK provision picture through the proxy prefix', () => {
    expect(mediaUrl('/rik/media/rik/provisions/abc.png')).toBe(
      '/api/rik/media/rik/provisions/abc.png'
    );
  });

  it('leaves a STATIC catalogue asset alone — this app serves it, not the API', () => {
    expect(mediaUrl('/catalogue/pif/category/dals-pulses-beans.png')).toBe(
      '/catalogue/pif/category/dals-pulses-beans.png'
    );
    expect(mediaUrl('/catalogue/rik/category/milk.png')).toBe('/catalogue/rik/category/milk.png');
  });

  it('leaves an already-absolute URL alone', () => {
    expect(mediaUrl('https://cdn.example/x.png')).toBe('https://cdn.example/x.png');
  });

  it('leaves a reference with no leading slash alone rather than gluing it on', () => {
    // An administrator can type free text into the image-reference box.
    // `rik/catalogue/ghee.jpg` must not become `/apirik/catalogue/ghee.jpg`.
    expect(mediaUrl('rik/catalogue/ghee.jpg')).toBe('rik/catalogue/ghee.jpg');
  });

  it('passes null through', () => {
    expect(mediaUrl(null)).toBeNull();
  });
});
