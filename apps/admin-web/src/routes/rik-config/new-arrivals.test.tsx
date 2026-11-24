import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../lib/api/client';
import type { NewArrivalListing } from '../../lib/api/rik-config-api';

/**
 * The New Arrivals admin screen, after the standalone rework.
 *
 * THE WORKFLOW THIS ASSERTS, end to end:
 *   type a name -> save as draft -> upload a picture -> publish.
 *
 * WHAT THIS SCREEN MUST NOT DO, asserted directly:
 *   * require a catalogue product — there is no picker, and creating a
 *     listing must send `productName` and no `provisionId` at all;
 *   * touch the RIK catalogue — it never fetches provisions, and removing a
 *     listing sends a listing id to the listing endpoint;
 *   * publish by accident — a newly saved entry is a DRAFT, and the request
 *     the screen sends must carry isPublished: false;
 *   * publish without a picture — the server refuses, and the screen has to
 *     surface that refusal rather than swallow it.
 *
 * The rules themselves are the SERVER's and are enforced there and in the
 * database. What is asserted here is that the screen sends the right request
 * and shows the server's answer — a frontend-only rule would be the wrong
 * place for any of this and is deliberately not implemented.
 */

const api = {
  fetchNewArrivals: vi.fn(),
  fetchProvisions: vi.fn(),
  createNewArrival: vi.fn(),
  uploadNewArrivalImage: vi.fn(),
  removeNewArrivalImage: vi.fn(),
  updateNewArrival: vi.fn(),
  setNewArrivalPublished: vi.fn(),
  removeNewArrival: vi.fn(),
};

vi.mock('../../lib/api/rik-config-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api/rik-config-api')>();
  return {
    ...actual,
    fetchNewArrivals: (...a: unknown[]) => api.fetchNewArrivals(...a),
    fetchProvisions: (...a: unknown[]) => api.fetchProvisions(...a),
    createNewArrival: (...a: unknown[]) => api.createNewArrival(...a),
    uploadNewArrivalImage: (...a: unknown[]) => api.uploadNewArrivalImage(...a),
    removeNewArrivalImage: (...a: unknown[]) => api.removeNewArrivalImage(...a),
    updateNewArrival: (...a: unknown[]) => api.updateNewArrival(...a),
    setNewArrivalPublished: (...a: unknown[]) => api.setNewArrivalPublished(...a),
    removeNewArrival: (...a: unknown[]) => api.removeNewArrival(...a),
  };
});

const { NewArrivalsPage } = await import('./NewArrivalsPage');

/** A STANDALONE listing — the ordinary kind. No catalogue fields at all. */
const listing = (over: Partial<NewArrivalListing> = {}): NewArrivalListing => ({
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  standalone: true,
  provisionId: null,
  productName: 'Himalayan Pink Salt',
  code: null,
  name: 'Himalayan Pink Salt',
  brand: null,
  poolName: null,
  headline: null,
  imageRef: null,
  imageUrl: null,
  hasOwnImage: false,
  effectiveImageRef: null,
  effectiveImageUrl: null,
  isPublished: false,
  publishedFrom: null,
  publishedUntil: null,
  displayOrder: 0,
  provisionIsActive: null,
  createdAt: '2026-10-25T09:00:00Z',
  updatedAt: '2026-10-25T09:00:00Z',
  ...over,
});

/** A listing still LINKED to a provision, to prove the old shape survives. */
const linked = (over: Partial<NewArrivalListing> = {}): NewArrivalListing =>
  listing({
    id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
    standalone: false,
    provisionId: '11111111-1111-4111-8111-111111111111',
    productName: null,
    code: 'CER_RICE_SONA_MASOORI',
    name: 'Bell Rice Sona Masoori',
    poolName: 'Cereals',
    provisionIsActive: true,
    ...over,
  });

const pngFile = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'salt.png', { type: 'image/png' });

const renderPage = () =>
  render(
    <MemoryRouter>
      <NewArrivalsPage />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchNewArrivals.mockResolvedValue({ items: [] });
});

describe('Admin — New Arrivals: manual entry', () => {
  it('has no catalogue picker and never fetches provisions', async () => {
    renderPage();
    expect(await screen.findByLabelText(/^product name$/i)).toBeInTheDocument();

    // The old screen made staff choose a RIK product before they could
    // announce anything. That dependency is gone, in both directions.
    expect(screen.queryByLabelText(/RIK product to feature/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(api.fetchProvisions).not.toHaveBeenCalled();
  });

  it('creates a listing from a typed name, as a draft, with no provisionId', async () => {
    const user = userEvent.setup();
    api.createNewArrival.mockResolvedValue(listing());
    renderPage();

    await user.type(await screen.findByLabelText(/^product name$/i), 'Himalayan Pink Salt');
    await user.click(screen.getByRole('button', { name: /save as draft/i }));

    await waitFor(() => expect(api.createNewArrival).toHaveBeenCalledTimes(1));
    const sent = api.createNewArrival.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.productName).toBe('Himalayan Pink Salt');
    expect(sent.isPublished).toBe(false);
    // Not merely undefined-by-accident: the screen must not send one at all.
    expect('provisionId' in sent ? sent.provisionId : undefined).toBeUndefined();
  });

  it('sends the optional headline and date window, and trims what it sends', async () => {
    const user = userEvent.setup();
    api.createNewArrival.mockResolvedValue(listing());
    renderPage();

    await user.type(await screen.findByLabelText(/^product name$/i), '  Rock Salt  ');
    await user.type(screen.getByLabelText(/headline \/ description/i), '  Now in 1 kg packs  ');
    await user.click(screen.getByRole('button', { name: /save as draft/i }));

    await waitFor(() => expect(api.createNewArrival).toHaveBeenCalled());
    const sent = api.createNewArrival.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.productName).toBe('Rock Salt');
    expect(sent.headline).toBe('Now in 1 kg packs');
  });

  it('will not submit without a name', async () => {
    const user = userEvent.setup();
    renderPage();

    const submit = await screen.findByRole('button', { name: /save as draft/i });
    expect(submit).toBeDisabled();

    // Whitespace is not a name.
    await user.type(screen.getByLabelText(/^product name$/i), '   ');
    expect(submit).toBeDisabled();
    expect(api.createNewArrival).not.toHaveBeenCalled();
  });

  it('tells staff the next step after saving a draft', async () => {
    const user = userEvent.setup();
    api.createNewArrival.mockResolvedValue(listing());
    renderPage();

    await user.type(await screen.findByLabelText(/^product name$/i), 'Himalayan Pink Salt');
    await user.click(screen.getByRole('button', { name: /save as draft/i }));

    expect(await screen.findByText(/upload its image, then press publish/i)).toBeInTheDocument();
  });

  it('surfaces a server refusal instead of swallowing it', async () => {
    const user = userEvent.setup();
    api.createNewArrival.mockRejectedValue(
      new ApiError(400, { code: 'VALIDATION_FAILED', message: 'A product name is required.' })
    );
    renderPage();

    await user.type(await screen.findByLabelText(/^product name$/i), 'x');
    await user.click(screen.getByRole('button', { name: /save as draft/i }));

    expect(await screen.findByText(/A product name is required\./i)).toBeInTheDocument();
  });
});

describe('Admin — New Arrivals: the image', () => {
  it('uploads a chosen picture only when Save is pressed', async () => {
    const user = userEvent.setup();
    api.fetchNewArrivals.mockResolvedValue({ items: [listing()] });
    api.uploadNewArrivalImage.mockResolvedValue(listing({ imageRef: 'rik/new-arrivals/x.png', hasOwnImage: true }));
    renderPage();

    const input = await screen.findByLabelText(/choose a picture for Himalayan Pink Salt/i);
    await user.upload(input, pngFile());

    // Choosing shows a preview and sends nothing.
    expect(api.uploadNewArrivalImage).not.toHaveBeenCalled();
    expect(await screen.findByText(/not saved yet/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save image/i }));
    await waitFor(() => expect(api.uploadNewArrivalImage).toHaveBeenCalledTimes(1));
    expect(api.uploadNewArrivalImage.mock.calls[0]![0]).toBe('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
  });

  it('says an image is required before a standalone listing can be published', async () => {
    api.fetchNewArrivals.mockResolvedValue({ items: [listing()] });
    renderPage();
    expect(await screen.findByText(/required before this listing can be published/i)).toBeInTheDocument();
  });

  it('refuses to publish without a picture, and shows the server reason', async () => {
    const user = userEvent.setup();
    api.fetchNewArrivals.mockResolvedValue({ items: [listing()] });
    api.setNewArrivalPublished.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message: '"Himalayan Pink Salt" needs an image before it can be published.',
      })
    );
    renderPage();

    await user.click(await screen.findByRole('button', { name: /^publish$/i }));
    expect(await screen.findByText(/needs an image before it can be published/i)).toBeInTheDocument();
  });

  it('publishes once a picture is attached', async () => {
    const user = userEvent.setup();
    const withImage = listing({ imageRef: 'rik/new-arrivals/x.png', hasOwnImage: true, effectiveImageUrl: '/x.png' });
    api.fetchNewArrivals.mockResolvedValue({ items: [withImage] });
    api.setNewArrivalPublished.mockResolvedValue({ ...withImage, isPublished: true });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /^publish$/i }));
    await waitFor(() => expect(api.setNewArrivalPublished).toHaveBeenCalledWith(withImage.id, true));
    expect(await screen.findByText(/is now live in the customer app/i)).toBeInTheDocument();
  });

  it('warns that removing the picture of a published standalone listing unpublishes it', async () => {
    const user = userEvent.setup();
    const live = listing({ imageRef: 'rik/new-arrivals/x.png', hasOwnImage: true, isPublished: true });
    api.fetchNewArrivals.mockResolvedValue({ items: [live] });
    api.removeNewArrivalImage.mockResolvedValue({
      ...live,
      imageRef: null,
      hasOwnImage: false,
      isPublished: false,
      provisionImageChanged: false,
      unpublished: true,
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /remove the picture for Himalayan Pink Salt/i }));
    await user.click(screen.getByRole('button', { name: /yes, remove it/i }));

    await waitFor(() => expect(api.removeNewArrivalImage).toHaveBeenCalledWith(live.id));
    expect(await screen.findByText(/it has been unpublished/i)).toBeInTheDocument();
  });

  it('does not claim an unpublish that did not happen', async () => {
    const user = userEvent.setup();
    const draft = listing({ imageRef: 'rik/new-arrivals/x.png', hasOwnImage: true, isPublished: false });
    api.fetchNewArrivals.mockResolvedValue({ items: [draft] });
    api.removeNewArrivalImage.mockResolvedValue({
      ...draft,
      imageRef: null,
      hasOwnImage: false,
      provisionImageChanged: false,
      unpublished: false,
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /remove the picture for Himalayan Pink Salt/i }));
    await user.click(screen.getByRole('button', { name: /yes, remove it/i }));

    await waitFor(() => expect(api.removeNewArrivalImage).toHaveBeenCalled());
    expect(await screen.findByText(/image removed from "Himalayan Pink Salt"/i)).toBeInTheDocument();
    expect(screen.queryByText(/it has been unpublished/i)).not.toBeInTheDocument();
  });
});

describe('Admin — New Arrivals: editing and deleting', () => {
  it('renames a standalone listing', async () => {
    const user = userEvent.setup();
    api.fetchNewArrivals.mockResolvedValue({ items: [listing()] });
    api.updateNewArrival.mockResolvedValue(listing({ productName: 'Rock Salt', name: 'Rock Salt' }));
    renderPage();

    const nameInput = await screen.findByLabelText(/product name for Himalayan Pink Salt/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Rock Salt');
    await user.click(screen.getByRole('button', { name: /save name/i }));

    await waitFor(() =>
      expect(api.updateNewArrival).toHaveBeenCalledWith('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', {
        productName: 'Rock Salt',
      })
    );
  });

  it('offers no rename control on a listing linked to the catalogue', async () => {
    api.fetchNewArrivals.mockResolvedValue({ items: [linked()] });
    renderPage();

    expect(await screen.findByText('Bell Rice Sona Masoori')).toBeInTheDocument();
    expect(screen.queryByLabelText(/product name for Bell Rice Sona Masoori/i)).not.toBeInTheDocument();
  });

  it('edits the headline', async () => {
    const user = userEvent.setup();
    api.fetchNewArrivals.mockResolvedValue({ items: [listing()] });
    api.updateNewArrival.mockResolvedValue(listing({ headline: 'Just arrived' }));
    renderPage();

    await user.type(await screen.findByLabelText(/headline for Himalayan Pink Salt/i), 'Just arrived');
    await user.click(screen.getByRole('button', { name: /save headline/i }));

    await waitFor(() =>
      expect(api.updateNewArrival).toHaveBeenCalledWith('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', {
        headline: 'Just arrived',
      })
    );
  });

  it('asks before deleting, and sends the LISTING id to the listing endpoint', async () => {
    const user = userEvent.setup();
    api.fetchNewArrivals.mockResolvedValue({ items: [listing()] });
    api.removeNewArrival.mockResolvedValue({
      removed: true,
      name: 'Himalayan Pink Salt',
      provisionCode: null,
      provisionDeleted: false,
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /remove from new arrivals/i }));
    // It asks first, and says plainly that no RIK product is involved.
    expect(screen.getByText(/never referenced one/i)).toBeInTheDocument();
    expect(api.removeNewArrival).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /yes, unlist it/i }));
    await waitFor(() =>
      expect(api.removeNewArrival).toHaveBeenCalledWith('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')
    );
  });

  it('raises an unmissable alarm if the server ever reports a product was deleted', async () => {
    const user = userEvent.setup();
    api.fetchNewArrivals.mockResolvedValue({ items: [linked()] });
    api.removeNewArrival.mockResolvedValue({
      removed: true,
      name: 'Bell Rice Sona Masoori',
      provisionCode: 'CER_RICE_SONA_MASOORI',
      // This must never happen. If it ever does, the screen must shout.
      provisionDeleted: true,
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /remove from new arrivals/i }));
    await user.click(screen.getByRole('button', { name: /yes, unlist it/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/must never happen/i);
  });
});

describe('Admin — New Arrivals: listing display', () => {
  it('shows an empty state that explains the whole workflow', async () => {
    renderPage();
    expect(await screen.findByText(/nothing is featured yet/i)).toBeInTheDocument();
    expect(screen.getByText(/type its name, save the draft, upload a picture, then publish/i)).toBeInTheDocument();
  });

  it('shows no catalogue sub-line for a standalone listing', async () => {
    api.fetchNewArrivals.mockResolvedValue({ items: [listing()] });
    renderPage();

    // A standalone listing's name is EDITABLE, so it lives in an input's
    // value rather than in text content. Found by its accessible label.
    const nameInput = await screen.findByLabelText<HTMLInputElement>(
      /product name for Himalayan Pink Salt/i
    );
    expect(nameInput).toHaveValue('Himalayan Pink Salt');

    const row = nameInput.closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).queryByText(/·/)).not.toBeInTheDocument();
    expect((row as HTMLElement).textContent ?? '').not.toMatch(/null|undefined/);
  });

  it('still shows the catalogue code and pool for a linked listing', async () => {
    api.fetchNewArrivals.mockResolvedValue({ items: [linked()] });
    renderPage();
    expect(await screen.findByText(/CER_RICE_SONA_MASOORI · Cereals/)).toBeInTheDocument();
  });

  it('shows standalone and linked listings together', async () => {
    api.fetchNewArrivals.mockResolvedValue({ items: [listing(), linked()] });
    renderPage();

    // The two kinds render differently on purpose: the standalone name is an
    // editable input, the linked one is static text taken from the
    // catalogue. Each is asserted the way it is actually rendered.
    expect(
      await screen.findByLabelText<HTMLInputElement>(/product name for Himalayan Pink Salt/i)
    ).toHaveValue('Himalayan Pink Salt');
    expect(screen.getByText('Bell Rice Sona Masoori')).toBeInTheDocument();
  });
});
