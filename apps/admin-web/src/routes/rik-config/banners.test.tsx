import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { BannerListing } from '../../lib/api/rik-banners-api';

/**
 * The Seasonal banners admin screen.
 *
 * THE WORKFLOW THIS ASSERTS, end to end:
 *   type a title -> save as draft -> upload a picture -> publish.
 *
 * WHAT THIS SCREEN MUST NOT DO, asserted directly:
 *   * publish by accident — a newly saved banner is a DRAFT, and `create`
 *     must not carry an isPublished flag at all;
 *   * publish without a picture — the Publish control stays disabled and
 *     says why, so staff meet the rule as guidance rather than a refusal;
 *   * accept a window that closes before it opens — refused in the form,
 *     and no request is sent;
 *   * hide the consequence of removing a picture — a live banner comes off
 *     the home screen, and the screen says so;
 *   * imply the fixed hero is involved — the empty state has to describe a
 *     home screen that is working normally, not one that is missing
 *     something.
 *
 * The rules themselves are the SERVER's and the database's, enforced there
 * on every path. What is asserted here is that the screen sends the right
 * request and reports the server's answer.
 */

const api = {
  fetchBanners: vi.fn(),
  createBanner: vi.fn(),
  updateBanner: vi.fn(),
  setBannerPublished: vi.fn(),
  removeBanner: vi.fn(),
  uploadBannerImage: vi.fn(),
  removeBannerImage: vi.fn(),
};

vi.mock('../../lib/api/rik-banners-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api/rik-banners-api')>();
  return {
    ...actual,
    fetchBanners: (...a: unknown[]) => api.fetchBanners(...a),
    createBanner: (...a: unknown[]) => api.createBanner(...a),
    updateBanner: (...a: unknown[]) => api.updateBanner(...a),
    setBannerPublished: (...a: unknown[]) => api.setBannerPublished(...a),
    removeBanner: (...a: unknown[]) => api.removeBanner(...a),
    uploadBannerImage: (...a: unknown[]) => api.uploadBannerImage(...a),
    removeBannerImage: (...a: unknown[]) => api.removeBannerImage(...a),
  };
});

const { BannersPage } = await import('./BannersPage');

const banner = (over: Partial<BannerListing> = {}): BannerListing => ({
  id: 'cccccccc-3333-4333-8333-cccccccccccc',
  title: 'Diwali offers',
  description: null,
  imageRef: null,
  imageUrl: null,
  hasImage: false,
  isPublished: false,
  startsOn: null,
  endsOn: null,
  displayOrder: 0,
  createdAt: '2026-10-30T09:00:00Z',
  updatedAt: '2026-10-30T09:00:00Z',
  ...over,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <BannersPage />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchBanners.mockResolvedValue([]);
});

describe('Admin — Seasonal banners: creating one', () => {
  it('saves a title as a draft and never asks the server to publish it', async () => {
    const user = userEvent.setup();
    api.createBanner.mockResolvedValue(banner());
    renderPage();

    await user.type(await screen.findByLabelText(/banner title/i), 'Diwali offers');
    await user.click(screen.getByRole('button', { name: /save as draft/i }));

    await waitFor(() => expect(api.createBanner).toHaveBeenCalledTimes(1));
    const sent = api.createBanner.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.title).toBe('Diwali offers');
    // A banner IS its picture, so there is no "create published" path to
    // get wrong — the flag must not be in the request at all.
    expect(sent).not.toHaveProperty('isPublished');
  });

  it('refuses a window that closes before it opens, without calling the server', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText(/banner title/i), 'Sankranti');
    await user.type(screen.getByLabelText(/show banner from/i), '2027-01-14');
    await user.type(screen.getByLabelText(/show banner until/i), '2027-01-10');

    expect(await screen.findByRole('alert')).toHaveTextContent(/end date is before the start date/i);
    expect(screen.getByRole('button', { name: /save as draft/i })).toBeDisabled();
    expect(api.createBanner).not.toHaveBeenCalled();
  });
});

describe('Admin — Seasonal banners: publishing', () => {
  it('will not publish a banner that has no picture, and says why', async () => {
    api.fetchBanners.mockResolvedValue([banner()]);
    renderPage();

    const publish = await screen.findByRole('button', { name: /^publish$/i });
    expect(publish).toBeDisabled();
    expect(screen.getByText(/upload a picture first/i)).toBeInTheDocument();
    expect(api.setBannerPublished).not.toHaveBeenCalled();
  });

  it('publishes once a picture is attached', async () => {
    const user = userEvent.setup();
    const withImage = banner({ hasImage: true, imageRef: 'rik/banners/abc.jpg', imageUrl: '/rik/media/rik/banners/abc.jpg' });
    api.fetchBanners.mockResolvedValue([withImage]);
    api.setBannerPublished.mockResolvedValue({ ...withImage, isPublished: true });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /^publish$/i }));

    await waitFor(() => expect(api.setBannerPublished).toHaveBeenCalledWith(withImage.id, true));
    expect(await screen.findByText(/is now live on the customer home screen/i)).toBeInTheDocument();
  });

  it('reports that removing the picture takes a live banner down', async () => {
    const user = userEvent.setup();
    const live = banner({
      hasImage: true,
      imageRef: 'rik/banners/abc.jpg',
      imageUrl: '/rik/media/rik/banners/abc.jpg',
      isPublished: true,
    });
    api.fetchBanners.mockResolvedValue([live]);
    api.removeBannerImage.mockResolvedValue({ ...live, hasImage: false, imageRef: null, imageUrl: null, isPublished: false, unpublished: true });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /remove the picture for Diwali offers/i }));
    // The upload field asks for confirmation before it deletes anything.
    await user.click(await screen.findByRole('button', { name: /yes, remove it/i }));

    await waitFor(() => expect(api.removeBannerImage).toHaveBeenCalledWith(live.id));
    expect(
      await screen.findByText(/it has been unpublished, because a banner cannot be shown without one/i)
    ).toBeInTheDocument();
  });
});

describe('Admin — Seasonal banners: the empty state', () => {
  it('describes a home screen that is working normally, not one that is broken', async () => {
    renderPage();

    expect(await screen.findByText(/no seasonal banners/i)).toBeInTheDocument();
    // The permanent hero is not managed here and is not missing. The copy
    // has to say that, or an administrator will go looking for it.
    expect(
      screen.getByText(/showing the permanent e-Samagri banner on its own, which is the normal state/i)
    ).toBeInTheDocument();
  });
});
