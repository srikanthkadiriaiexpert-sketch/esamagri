import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * Uploaded images on disk — the mechanism, with no module knowledge.
 *
 * WHY THIS EXISTS SEPARATELY. The storage rules below were written for PIF
 * product photographs (PHASE F) and are the ones RIK provision pictures
 * need too, byte for byte. RikModule may not import PifModule — see the
 * module boundary comment in app.module.ts — and PifModule does not export
 * PifMediaService anyway, so the mechanism is lifted here, parameterised by
 * root/prefix/scope, and each module keeps its own thin @Injectable over it.
 * PifMediaService's behaviour is unchanged by that move: same keys, same
 * pattern, same messages, same files on disk.
 *
 * WHAT AN UPLOADER IS ALLOWED TO DECIDE: the bytes. That is all.
 *
 *   the directory      comes from server configuration (PIF_MEDIA_ROOT /
 *                      RIK_MEDIA_ROOT), never from the request
 *   the file name      is generated here (uuid + sniffed extension)
 *   the extension      comes from the FILE'S OWN MAGIC BYTES, never from
 *                      the upload's name or its declared content type
 *   the size limit     comes from server configuration
 *
 * So an upload cannot choose where it lands, cannot traverse out of the
 * media root with `../`, cannot smuggle a `.svg`, `.html` or `.php` past the
 * check by renaming it, and cannot be an executable pretending to be a
 * picture: a file whose first bytes are not PNG, JPEG or WebP is refused.
 *
 * WHAT IS STORED IN THE DATABASE is the key alone (`rik/provisions/<uuid>.png`),
 * never a filesystem path. Reading goes back through this class, which
 * resolves the key under the media root and refuses anything that escapes
 * it — so even a key that was somehow tampered with cannot read /etc.
 */

export type MediaErrorCode = 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'NOT_FOUND' | 'BAD_KEY';

export class MediaError extends Error {
  constructor(
    readonly code: MediaErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'MediaError';
  }
}

export interface StoredImage {
  /** What goes in `image_ref`: a key, relative to the media root. */
  key: string;
  bytes: number;
  contentType: string;
  sha256: string;
}

type ImageKind = { ext: 'png' | 'jpg' | 'webp'; contentType: string };

/** The three formats an uploaded photo may be in, identified by their bytes. */
export function sniff(buffer: Buffer): ImageKind | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

/**
 * A stored key becomes the URL its own module's media route serves; anything
 * else — most importantly the `/catalogue/...` paths that 180 RIK provisions
 * and every PIF category picture already carry — is passed through
 * completely untouched. That passthrough is the reason attaching uploads to
 * RIK does not disturb a single existing picture.
 */
export function mediaRefToUrl(ref: string | null, prefix: string): string | null {
  if (ref === null) return null;
  return ref.startsWith(`${prefix}/`) ? `/${prefix}/media/${ref}` : ref;
}

export interface MediaStorageOptions {
  /** PIF_MEDIA_ROOT / RIK_MEDIA_ROOT, absolute or relative to process.cwd(). */
  readonly root: string;
  /** The first path segment of every key this store owns: 'pif' or 'rik'. */
  readonly prefix: string;
  /** The only second segments allowed. A literal list, never caller-supplied. */
  readonly scopes: readonly string[];
  readonly maxBytes: number;
}

export class MediaStorage {
  private readonly root: string;
  private readonly prefix: string;
  private readonly scopes: readonly string[];
  private readonly maxBytes: number;
  private readonly keyPattern: RegExp;

  constructor(options: MediaStorageOptions) {
    this.root = isAbsolute(options.root) ? options.root : resolve(process.cwd(), options.root);
    this.prefix = options.prefix;
    this.scopes = options.scopes;
    this.maxBytes = options.maxBytes;
    // Built from the literal prefix and the literal scope list, so the shape
    // a key must have is still fixed at construction and not influenced by
    // anything a request carries.
    this.keyPattern = new RegExp(`^${options.prefix}/(${options.scopes.join('|')})/[0-9a-f-]{36}\\.(png|jpg|webp)$`);
  }

  get limitBytes(): number {
    return this.maxBytes;
  }

  /**
   * The absolute directory this store writes to, after resolving a relative
   * setting against process.cwd().
   *
   * Exposed because it is the one piece of this store's configuration an
   * operator needs to see — the cwd-relative default means starting the API
   * from a different directory silently uses a different directory — and
   * because a test that counts files on disk must look where the service
   * actually looks rather than where it assumes.
   */
  get rootPath(): string {
    return this.root;
  }

  /**
   * Store an uploaded image and return its key.
   *
   * Written to a temporary name first and then renamed, so a reader can
   * never see a half-written file at a key the database already points at.
   */
  async store(scope: string, buffer: Buffer): Promise<StoredImage> {
    if (!this.scopes.includes(scope)) {
      throw new MediaError('BAD_KEY', 'That is not a valid image key.');
    }
    if (buffer.length === 0) {
      throw new MediaError('EMPTY', 'That file is empty.');
    }
    if (buffer.length > this.maxBytes) {
      throw new MediaError(
        'TOO_LARGE',
        `That image is ${(buffer.length / 1_000_000).toFixed(1)} MB. The limit is ${(this.maxBytes / 1_000_000).toFixed(1)} MB.`
      );
    }
    const kind = sniff(buffer);
    if (kind === null) {
      throw new MediaError(
        'UNSUPPORTED_TYPE',
        'Only PNG, JPEG and WebP images can be uploaded. (The file is checked by its contents, not its name.)'
      );
    }

    const key = `${this.prefix}/${scope}/${randomUUID()}.${kind.ext}`;
    const target = this.pathFor(key);
    await mkdir(join(this.root, this.prefix, scope), { recursive: true });
    const temporary = `${target}.${process.pid}.part`;
    await writeFile(temporary, buffer, { mode: 0o640 });
    await rename(temporary, target);

    return {
      key,
      bytes: buffer.length,
      contentType: kind.contentType,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  /** Read an image back for serving. */
  async read(key: string): Promise<{ buffer: Buffer; contentType: string }> {
    const path = this.pathFor(key);
    const kind = key.endsWith('.png')
      ? 'image/png'
      : key.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
    try {
      const buffer = await readFile(path);
      return { buffer, contentType: kind };
    } catch {
      throw new MediaError('NOT_FOUND', 'That image is not stored.');
    }
  }

  /**
   * Remove a stored image. A missing file is not an error: the point is that
   * the key no longer resolves, and a database row that no longer references
   * it is the authoritative part.
   *
   * A key this store does not own is a deliberate no-op, which is what makes
   * it safe to hand this method an existing `/catalogue/...` reference: a
   * committed asset must never be deleted because a row stopped pointing at
   * it.
   */
  async remove(key: string | null): Promise<void> {
    if (key === null || !this.keyPattern.test(key)) return;
    try {
      await unlink(this.pathFor(key));
    } catch {
      /* already gone */
    }
  }

  /** True when this key is one of ours — an uploaded file, not a committed asset. */
  owns(key: string | null): boolean {
    return key !== null && this.keyPattern.test(key);
  }

  /**
   * Key → absolute path, with the key's shape enforced and the result
   * re-checked to be inside the media root. Two independent guards, because
   * this is the one place a string from the database becomes a filesystem
   * path.
   */
  private pathFor(key: string): string {
    if (!this.keyPattern.test(key)) {
      throw new MediaError('BAD_KEY', 'That is not a valid image key.');
    }
    const path = resolve(this.root, key);
    if (path !== join(this.root, key)) {
      throw new MediaError('BAD_KEY', 'That is not a valid image key.');
    }
    return path;
  }
}
