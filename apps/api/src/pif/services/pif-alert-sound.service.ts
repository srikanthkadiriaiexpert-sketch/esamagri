import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '@esamagri/config';
import { MediaError } from './pif-media.service';

/**
 * THE PIF ORDER-ALERT SOUND — client-managed, stored on the server, shared by
 * every PIF staff member.
 *
 * WHY THIS IS A SEPARATE STORE AND NOT AN EXTENSION OF MediaStorage.
 * shared/services/media-storage.service.ts is an IMAGE store: its key pattern
 * hard-codes `png|jpg|webp` and its `sniff()` admits only image magic bytes.
 * RIK's provision pictures use that same class. Teaching it about audio would
 * mean editing shared code that RIK depends on, which this change is not
 * permitted to do — so the mechanism is reimplemented here, PIF-only, audio-
 * only, following the image store's rules line for line:
 *
 *   the directory      comes from server configuration (PIF_MEDIA_ROOT),
 *                      never from the request
 *   the file name      is generated here (uuid + '.mp3')
 *   the format         comes from the FILE'S OWN MAGIC BYTES, never from the
 *                      upload's name or its declared content type
 *   the size limit     comes from server configuration (PIF_MEDIA_MAX_BYTES)
 *   the key            is re-validated and re-resolved before it ever becomes
 *                      a filesystem path
 *
 * So an upload cannot choose where it lands, cannot traverse out of the media
 * root with `../`, cannot smuggle an `.html`, `.svg` or `.exe` past the check
 * by renaming it to `.mp3`, and cannot be a script pretending to be audio.
 *
 * WHERE THE CONFIGURATION LIVES, and why there is no database table. The
 * active sound is recorded in ONE small JSON file, `active.json`, inside this
 * store's own directory. That choice was made deliberately:
 *
 *   * it is SERVER-SIDE, so every authorized PIF staff member on every
 *     computer hears the same sound, and the setting survives a refresh, a
 *     logout and a different browser — the requirement localStorage cannot
 *     meet;
 *   * it needs NO MIGRATION. `shared.settings` exists, but migration 0029
 *     ruled in writing that it is the SUPER_ADMIN settings surface gated by
 *     `shared.settings.write`, and that module configuration does not belong
 *     there. A new `pif.*` table would have been the alternative, and that is
 *     a schema change this work was not authorized to make;
 *   * it sits beside the audio it describes, under the same server-configured
 *     root, so there is exactly one thing to back up and one thing to move.
 *
 * The trade-off, stated plainly: there is no per-change history — `active.json`
 * records only who made the CURRENT change and when, not the ones before it —
 * and a future multi-server deployment would need shared storage for this
 * directory. That is the same constraint PIF product images already carry, so
 * it adds no new one.
 *
 * `active.json` is NOT reachable through any key: it fails the key pattern, so
 * it can never be streamed by the public route nor deleted by `remove`.
 *
 * NO SOUND IS EVER MISSING. When `active.json` is absent, unreadable,
 * malformed, or points at a file that is no longer on disk, this store falls
 * back to the committed default without complaint. "Restore the original
 * sound" is therefore just the removal of `active.json`.
 */

/** The one scope this store owns, a literal — never caller-supplied. */
const SCOPE = 'alert-sound';
const PREFIX = 'pif';
const KEY_PATTERN = /^pif\/alert-sound\/[0-9a-f-]{36}\.mp3$/;
const CONFIG_BASENAME = 'active.json';
const CONTENT_TYPE = 'audio/mpeg';

/**
 * The supplied bell, committed to the repository and shipped with the API.
 *
 * FOUND RELATIVE TO THIS FILE FIRST, and only then relative to the working
 * directory. `__dirname` is `…/apps/api/src/pif/services` under ts-node and
 * `…/apps/api/dist/pif/services` after a build, and three levels up from
 * either one is `apps/api` — so one path works in development and in
 * production without depending on where the process was started from. The
 * cwd-relative candidate is kept as a fallback for an unusual layout, so a
 * misplaced asset degrades to "no sound" rather than to a crash.
 */
export const DEFAULT_SOUND_CANDIDATES = [
  resolve(__dirname, '../../../assets/pif-order-alert-default.mp3'),
  resolve(process.cwd(), 'assets/pif-order-alert-default.mp3'),
];
const DEFAULT_FILENAME = 'pif-order-alert-default.mp3';

export interface ActiveAlertSound {
  /** The stored key, or null when the committed default is in force. */
  key: string | null;
  /** For display only. Never used to build a path. */
  filename: string;
  bytes: number;
  sha256: string;
  /** ISO timestamp of the last change, or null while the default is in force. */
  updatedAt: string | null;
  /** The staff user id that made the change, or null for the default. */
  updatedBy: string | null;
  isDefault: boolean;
}

/** What `active.json` holds. Anything else in that file is treated as absent. */
interface StoredConfig {
  key: string;
  filename: string;
  bytes: number;
  sha256: string;
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * Is this actually an MP3? Decided by the file's first bytes and nothing else.
 *
 * Two shapes are accepted, which between them cover every MP3 a desktop or
 * phone produces:
 *
 *   'ID3'   an ID3v2 tag, which is how virtually every tagged MP3 begins —
 *           the supplied bell is one of these (ID3v2.3);
 *   0xFFEx  a bare MPEG audio frame header, for an untagged file.
 *
 * For the bare-frame case the version and layer bits are checked too: the
 * reserved version is rejected, and the layer must be LAYER III. That is what
 * "MP3" means — a Layer I or Layer II stream is a different format that
 * happens to share the container, and refusing it keeps the promise that what
 * is served as `audio/mpeg` really is an MP3.
 *
 * WAV, OGG, FLAC, AAC/M4A, PNG, JPEG, PDF, HTML, a shell script and a Windows
 * executable all fail both tests, which is the point.
 */
export function sniffMp3(buffer: Buffer): boolean {
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') {
    return true;
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0) {
    const version = (buffer[1]! >> 3) & 0x03;
    const layer = (buffer[1]! >> 1) & 0x03;
    // version 0b01 is reserved; layer 0b01 is Layer III.
    return version !== 0x01 && layer === 0x01;
  }
  return false;
}

/**
 * The uploaded file's own name, reduced to something safe to show.
 *
 * This value is DISPLAY ONLY — it is recorded so the client can see which
 * file is active, and it never contributes to a path. It is sanitised anyway,
 * because it is rendered in a browser and stored in a JSON file: directory
 * separators, NUL, control characters and leading dots are removed, the
 * length is capped, and an empty result falls back to a fixed label. A name
 * that survives this is still never resolved against the filesystem.
 */
export function displayFilename(original: string | undefined): string {
  const base = (original ?? '').replace(/^.*[\\/]/, '');
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned === '' ? 'uploaded-sound.mp3' : cleaned;
}

@Injectable()
export class PifAlertSoundService {
  private readonly root: string;
  private readonly maxBytes: number;
  /** The default's size and hash, read once and remembered. */
  private defaultStats: { bytes: number; sha256: string } | null = null;

  constructor(config: ConfigService<ApiEnv, true>) {
    const configured = config.get('PIF_MEDIA_ROOT', { infer: true });
    this.root = isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
    this.maxBytes = config.get('PIF_MEDIA_MAX_BYTES', { infer: true });
  }

  get limitBytes(): number {
    return this.maxBytes;
  }

  /** Exposed for the same reason MediaStorage exposes it: tests must look where the service looks. */
  get rootPath(): string {
    return this.root;
  }

  /**
   * What is active right now. Never throws for a missing or broken
   * configuration — that is the default's cue, not an error.
   */
  async active(): Promise<ActiveAlertSound> {
    const stored = await this.readConfig();
    if (stored === null) return this.defaultSound();
    return {
      key: stored.key,
      filename: stored.filename,
      bytes: stored.bytes,
      sha256: stored.sha256,
      updatedAt: stored.updatedAt,
      updatedBy: stored.updatedBy,
      isDefault: false,
    };
  }

  /**
   * Replace the active sound.
   *
   * Written to a temporary name and renamed, so a staff browser fetching the
   * sound can never receive a half-written file. The configuration is updated
   * only after the audio is safely in place, and the file it replaced is
   * removed only after that — in that order, so no step can leave the store
   * pointing at something that is not there.
   */
  async replace(
    buffer: Buffer,
    originalName: string | undefined,
    staffId: string | null
  ): Promise<ActiveAlertSound> {
    if (buffer.length === 0) {
      throw new MediaError('EMPTY', 'That file is empty.');
    }
    if (buffer.length > this.maxBytes) {
      throw new MediaError(
        'TOO_LARGE',
        `That sound is ${(buffer.length / 1_000_000).toFixed(1)} MB. The limit is ${(this.maxBytes / 1_000_000).toFixed(1)} MB.`
      );
    }
    if (!sniffMp3(buffer)) {
      throw new MediaError(
        'UNSUPPORTED_TYPE',
        'Only MP3 audio can be uploaded. (The file is checked by its contents, not its name, so renaming another kind of file to .mp3 will not work.)'
      );
    }

    const previous = await this.readConfig();
    const key = `${PREFIX}/${SCOPE}/${randomUUID()}.mp3`;
    const target = this.pathFor(key);
    await mkdir(join(this.root, PREFIX, SCOPE), { recursive: true });
    const temporary = `${target}.${process.pid}.part`;
    await writeFile(temporary, buffer, { mode: 0o640 });
    await rename(temporary, target);

    const next: StoredConfig = {
      key,
      filename: displayFilename(originalName),
      bytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      updatedAt: new Date().toISOString(),
      updatedBy: staffId,
    };
    await this.writeConfig(next);
    if (previous !== null) await this.removeStored(previous.key);

    return { ...next, isDefault: false };
  }

  /**
   * Go back to the supplied default. The configuration file is removed, which
   * is the whole of it, and the uploaded audio it pointed at is deleted after.
   */
  async restoreDefault(): Promise<ActiveAlertSound> {
    const previous = await this.readConfig();
    await this.removeConfig();
    if (previous !== null) await this.removeStored(previous.key);
    return this.defaultSound();
  }

  /**
   * The bytes to serve, with the hash the response's ETag is built from.
   *
   * A configuration that points at a file which is no longer readable falls
   * back to the default rather than failing: the desk hearing the original
   * bell is far better than the desk hearing nothing.
   */
  async readActive(): Promise<{ buffer: Buffer; contentType: string; sha256: string }> {
    const stored = await this.readConfig();
    if (stored !== null) {
      try {
        const buffer = await readFile(this.pathFor(stored.key));
        return { buffer, contentType: CONTENT_TYPE, sha256: stored.sha256 };
      } catch {
        /* fall through to the default */
      }
    }
    const buffer = await this.readDefaultFile();
    return {
      buffer,
      contentType: CONTENT_TYPE,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  // ------------------------------------------------------------------ private

  private async defaultSound(): Promise<ActiveAlertSound> {
    if (this.defaultStats === null) {
      const buffer = await this.readDefaultFile();
      this.defaultStats = {
        bytes: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      };
    }
    return {
      key: null,
      filename: DEFAULT_FILENAME,
      bytes: this.defaultStats.bytes,
      sha256: this.defaultStats.sha256,
      updatedAt: null,
      updatedBy: null,
      isDefault: true,
    };
  }

  private async readDefaultFile(): Promise<Buffer> {
    for (const candidate of DEFAULT_SOUND_CANDIDATES) {
      try {
        return await readFile(candidate);
      } catch {
        /* try the next candidate */
      }
    }
    throw new MediaError(
      'NOT_FOUND',
      'The default order-alert sound is not installed on the server. Alerts will still appear on screen.'
    );
  }

  /** null for every reason a configuration might not be usable. */
  private async readConfig(): Promise<StoredConfig | null> {
    let raw: string;
    try {
      raw = await readFile(this.configPath(), 'utf8');
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const c = parsed as Record<string, unknown>;
    // The key is re-validated here, not trusted: this file is the one place a
    // string from outside the request cycle becomes a path.
    if (typeof c.key !== 'string' || !KEY_PATTERN.test(c.key)) return null;
    if (typeof c.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(c.sha256)) return null;
    if (typeof c.bytes !== 'number' || !Number.isFinite(c.bytes) || c.bytes <= 0) return null;
    return {
      key: c.key,
      filename: typeof c.filename === 'string' && c.filename !== '' ? c.filename : 'uploaded-sound.mp3',
      bytes: c.bytes,
      sha256: c.sha256,
      updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : new Date(0).toISOString(),
      updatedBy: typeof c.updatedBy === 'string' ? c.updatedBy : null,
    };
  }

  private async writeConfig(config: StoredConfig): Promise<void> {
    const path = this.configPath();
    await mkdir(join(this.root, PREFIX, SCOPE), { recursive: true });
    const temporary = `${path}.${process.pid}.part`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o640 });
    await rename(temporary, path);
  }

  private async removeConfig(): Promise<void> {
    try {
      await unlink(this.configPath());
    } catch {
      /* already gone */
    }
  }

  /** A key this store does not own is a deliberate no-op. */
  private async removeStored(key: string): Promise<void> {
    if (!KEY_PATTERN.test(key)) return;
    try {
      await unlink(this.pathFor(key));
    } catch {
      /* already gone */
    }
  }

  /**
   * The configuration file's path, built only from this store's own literals.
   * No request value reaches it, and it cannot match KEY_PATTERN, so it is
   * not serveable or deletable as a key.
   */
  private configPath(): string {
    return join(this.root, PREFIX, SCOPE, CONFIG_BASENAME);
  }

  /**
   * Key → absolute path, with the key's shape enforced and the result
   * re-checked to be inside the media root. Two independent guards, matching
   * the image store, because this is where a stored string becomes a path.
   */
  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) {
      throw new MediaError('BAD_KEY', 'That is not a valid sound key.');
    }
    const path = resolve(this.root, key);
    if (path !== join(this.root, key)) {
      throw new MediaError('BAD_KEY', 'That is not a valid sound key.');
    }
    return path;
  }
}
