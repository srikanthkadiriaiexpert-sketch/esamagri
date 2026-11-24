import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '@esamagri/config';
import { MediaError } from './pif-media.service';
import {
  DEFAULT_SOUND_CANDIDATES,
  PifAlertSoundService,
  displayFilename,
  sniffMp3,
} from './pif-alert-sound.service';

/**
 * THE CLIENT-MANAGED ORDER-ALERT SOUND — the rules, with no database and no
 * HTTP.
 *
 * WHY THIS SUITE NEEDS NEITHER. The sound is held on the filesystem and
 * configured by one JSON file beside it; no table is involved, so none of this
 * boots AppModule and none of it needs `esamagri_test`. That is deliberate:
 * these tests RUN, on this machine, with `npx jest src/pif/services`, rather
 * than joining the twenty suites that cannot connect.
 *
 * WHAT IS ASSERTED, and it is the security of the thing:
 *
 *   * only real MP3 audio is accepted, decided by the file's own first bytes —
 *     a PNG, a WAV, an HTML page or a script renamed to .mp3 is refused;
 *   * the configured size limit is enforced, and an empty file is refused;
 *   * the uploader cannot choose the filename or the directory, and the
 *     generated key cannot leave the media root;
 *   * replacing the sound deletes the file it replaced, so uploads do not
 *     accumulate;
 *   * restoring the default removes the configuration and the uploaded file;
 *   * a MISSING, MALFORMED or TAMPERED configuration falls back to the
 *     supplied default rather than failing — the desk hearing the original
 *     bell beats the desk hearing nothing.
 *
 * Authorization is NOT asserted here, because it is not this class's job: the
 * permission is declared on the controller route (`pif.product.manage`) and
 * enforced by AuthorizationGuard against the live grant. The admin-portal
 * suite covers what staff with and without it are offered.
 */

/** A minimal ConfigService: the two values this service reads, and nothing else. */
function serviceFor(root: string, maxBytes = 2_000_000): PifAlertSoundService {
  const config = {
    get: (key: string) => (key === 'PIF_MEDIA_ROOT' ? root : maxBytes),
  } as unknown as ConfigService<ApiEnv, true>;
  return new PifAlertSoundService(config);
}

/** An ID3-tagged MP3, which is how the supplied bell and most MP3s begin. */
const ID3_MP3 = Buffer.concat([
  Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  Buffer.alloc(256, 0x55),
]);
/** An untagged MP3: a bare MPEG-1 Layer III frame header. */
const BARE_MP3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(256, 0x55)]);

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0x11),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x11)]);
const WAV = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4, 0x20),
  Buffer.from('WAVEfmt '),
  Buffer.alloc(32, 0x00),
]);
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');
const WINDOWS_EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0x00)]);
/** MPEG Layer II — a real MPEG stream, but not an MP3. */
const LAYER_II = Buffer.concat([Buffer.from([0xff, 0xfd, 0x90, 0x00]), Buffer.alloc(64, 0x55)]);
/** The reserved MPEG version, which no real file uses. */
const RESERVED_VERSION = Buffer.concat([
  Buffer.from([0xff, 0xeb, 0x90, 0x00]),
  Buffer.alloc(64, 0x55),
]);

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pif-alert-sound-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const configPath = (): string => join(root, 'pif', 'alert-sound', 'active.json');

// ===================================================================
describe('what counts as an MP3', () => {
  it('accepts an ID3-tagged file, which is what the supplied bell is', () => {
    expect(sniffMp3(ID3_MP3)).toBe(true);
  });

  it('accepts an untagged MPEG-1 Layer III frame', () => {
    expect(sniffMp3(BARE_MP3)).toBe(true);
  });

  it.each([
    ['a PNG', PNG],
    ['a JPEG', JPEG],
    ['a WAV', WAV],
    ['an HTML page with a script in it', HTML],
    ['a Windows executable', WINDOWS_EXE],
    ['MPEG Layer II, which is not MP3', LAYER_II],
    ['the reserved MPEG version', RESERVED_VERSION],
    ['an empty file', Buffer.alloc(0)],
    ['two bytes of nothing', Buffer.from([0x00, 0x00])],
  ])('refuses %s', (_label, buffer) => {
    expect(sniffMp3(buffer)).toBe(false);
  });

  it('is decided by the contents, so renaming does not help', async () => {
    const service = serviceFor(root);
    // The name says .mp3 and the browser would declare audio/mpeg; the bytes
    // say PNG, and the bytes are what is checked.
    await expect(service.replace(PNG, 'totally-a-sound.mp3', null)).rejects.toMatchObject({
      code: 'UNSUPPORTED_TYPE',
    });
  });
});

// ===================================================================
describe('the filename kept for display', () => {
  it('keeps a reasonable name as it is', () => {
    expect(displayFilename('door-bell.mp3')).toBe('door-bell.mp3');
  });

  it('strips any directory the browser included, on either platform', () => {
    expect(displayFilename('C:\\Users\\clerk\\Desktop\\bell.mp3')).toBe('bell.mp3');
    expect(displayFilename('/home/clerk/sounds/bell.mp3')).toBe('bell.mp3');
  });

  it('removes traversal, control characters and the characters a path uses', () => {
    expect(displayFilename('../../etc/passwd')).toBe('passwd');
    expect(displayFilename('bell\u0000\u001b<script>.mp3')).toBe('bellscript.mp3');
  });

  it('never returns nothing', () => {
    expect(displayFilename(undefined)).toBe('uploaded-sound.mp3');
    expect(displayFilename('...')).toBe('uploaded-sound.mp3');
  });

  it('caps the length, so a vast name cannot be stored or rendered', () => {
    expect(displayFilename(`${'a'.repeat(500)}.mp3`).length).toBeLessThanOrEqual(120);
  });
});

// ===================================================================
describe('the supplied default', () => {
  it('is installed with the API, so there is always a sound to play', async () => {
    // Looked for exactly where the service looks, so this test fails if the
    // asset is missing from a build rather than only at runtime.
    let bytes: Buffer | null = null;
    for (const candidate of DEFAULT_SOUND_CANDIDATES) {
      try {
        bytes = await readFile(candidate);
        break;
      } catch {
        /* try the next candidate */
      }
    }
    expect(bytes).not.toBeNull();
    expect(bytes!.length).toBeGreaterThan(1_000);
    expect(sniffMp3(bytes!)).toBe(true);
  });

  it('is what is active before anybody uploads anything', async () => {
    const active = await serviceFor(root).active();
    expect(active.isDefault).toBe(true);
    expect(active.key).toBeNull();
    expect(active.updatedAt).toBeNull();
    expect(active.bytes).toBeGreaterThan(1_000);
  });

  it('is what gets served before anybody uploads anything', async () => {
    const { buffer, contentType } = await serviceFor(root).readActive();
    expect(contentType).toBe('audio/mpeg');
    expect(sniffMp3(buffer)).toBe(true);
  });
});

// ===================================================================
describe('replacing the sound', () => {
  it('stores the upload and reports it as active', async () => {
    const service = serviceFor(root);
    const active = await service.replace(ID3_MP3, 'service-bell.mp3', 'staff-1');

    expect(active.isDefault).toBe(false);
    expect(active.filename).toBe('service-bell.mp3');
    expect(active.bytes).toBe(ID3_MP3.length);
    expect(active.sha256).toBe(createHash('sha256').update(ID3_MP3).digest('hex'));
    expect(active.updatedBy).toBe('staff-1');

    // And it survives being read back by a brand-new instance, which is the
    // whole point: the setting lives on the server, not in a browser.
    const reread = await serviceFor(root).active();
    expect(reread).toMatchObject({ isDefault: false, filename: 'service-bell.mp3' });
  });

  it('serves the uploaded bytes, not the default', async () => {
    const service = serviceFor(root);
    await service.replace(BARE_MP3, 'buzzer.mp3', null);
    const { buffer, sha256 } = await service.readActive();
    expect(buffer.equals(BARE_MP3)).toBe(true);
    expect(sha256).toBe(createHash('sha256').update(BARE_MP3).digest('hex'));
  });

  it('chooses the filename itself — the uploader cannot', async () => {
    const service = serviceFor(root);
    await service.replace(ID3_MP3, '../../../evil.mp3', null);
    const stored = JSON.parse(await readFile(configPath(), 'utf8')) as { key: string };
    expect(stored.key).toMatch(/^pif\/alert-sound\/[0-9a-f-]{36}\.mp3$/);
    // The display name is sanitised and is NOT what the file is called on disk.
    await expect(readFile(join(root, 'pif', 'alert-sound', stored.key.split('/')[2]!))).resolves
      .toBeDefined();
  });

  it('refuses an empty file', async () => {
    await expect(serviceFor(root).replace(Buffer.alloc(0), 'x.mp3', null)).rejects.toMatchObject({
      code: 'EMPTY',
    });
  });

  it('refuses a file over the configured limit, and says the real limit', async () => {
    const service = serviceFor(root, 1_000);
    const big = Buffer.concat([ID3_MP3, Buffer.alloc(2_000, 0x55)]);
    await expect(service.replace(big, 'big.mp3', null)).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });
    await expect(service.replace(big, 'big.mp3', null)).rejects.toThrow(/limit is 0\.0 MB/);
  });

  it('leaves the previous sound in force when the new one is refused', async () => {
    const service = serviceFor(root);
    await service.replace(ID3_MP3, 'first.mp3', null);
    await expect(service.replace(PNG, 'second.mp3', null)).rejects.toBeInstanceOf(MediaError);
    expect(await service.active()).toMatchObject({ filename: 'first.mp3', isDefault: false });
  });

  it('deletes the file it replaced, so uploads do not pile up', async () => {
    const service = serviceFor(root);
    await service.replace(ID3_MP3, 'first.mp3', null);
    const first = (JSON.parse(await readFile(configPath(), 'utf8')) as { key: string }).key;

    await service.replace(BARE_MP3, 'second.mp3', null);
    const second = (JSON.parse(await readFile(configPath(), 'utf8')) as { key: string }).key;

    expect(second).not.toBe(first);
    await expect(readFile(join(root, first))).rejects.toThrow();
    await expect(readFile(join(root, second))).resolves.toBeDefined();
  });

  it('leaves no temporary part-file behind', async () => {
    const service = serviceFor(root);
    await service.replace(ID3_MP3, 'bell.mp3', null);
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(join(root, 'pif', 'alert-sound'));
    expect(entries.filter((e) => e.endsWith('.part'))).toEqual([]);
  });
});

// ===================================================================
describe('restoring the supplied sound', () => {
  it('returns to the default and removes the configuration', async () => {
    const service = serviceFor(root);
    await service.replace(ID3_MP3, 'bell.mp3', null);

    const restored = await service.restoreDefault();
    expect(restored.isDefault).toBe(true);
    expect(restored.key).toBeNull();
    await expect(readFile(configPath())).rejects.toThrow();
    expect(await service.active()).toMatchObject({ isDefault: true });
  });

  it('deletes the uploaded file as well as the configuration', async () => {
    const service = serviceFor(root);
    await service.replace(ID3_MP3, 'bell.mp3', null);
    const key = (JSON.parse(await readFile(configPath(), 'utf8')) as { key: string }).key;

    await service.restoreDefault();
    await expect(readFile(join(root, key))).rejects.toThrow();
  });

  it('is harmless when the default is already in force', async () => {
    const service = serviceFor(root);
    expect(await service.restoreDefault()).toMatchObject({ isDefault: true });
    expect(await service.restoreDefault()).toMatchObject({ isDefault: true });
  });
});

// ===================================================================
describe('a configuration that cannot be trusted', () => {
  const writeConfig = async (body: string): Promise<void> => {
    await mkdir(join(root, 'pif', 'alert-sound'), { recursive: true });
    await writeFile(configPath(), body);
  };

  it('falls back to the default when the file is not JSON', async () => {
    await writeConfig('this is not json');
    expect(await serviceFor(root).active()).toMatchObject({ isDefault: true });
  });

  it('falls back when the key is missing or the wrong shape', async () => {
    await writeConfig(JSON.stringify({ filename: 'x.mp3', bytes: 10 }));
    expect(await serviceFor(root).active()).toMatchObject({ isDefault: true });
  });

  it('refuses a key that tries to climb out of the media root', async () => {
    await writeConfig(
      JSON.stringify({
        key: 'pif/alert-sound/../../../../etc/passwd',
        filename: 'passwd',
        bytes: 10,
        sha256: 'a'.repeat(64),
        updatedAt: new Date().toISOString(),
        updatedBy: null,
      })
    );
    const service = serviceFor(root);
    expect(await service.active()).toMatchObject({ isDefault: true });
    // And serving falls back to the default rather than reading that path.
    expect(sniffMp3((await service.readActive()).buffer)).toBe(true);
  });

  it('refuses a key in another scope, so this store cannot serve product images', async () => {
    await writeConfig(
      JSON.stringify({
        key: 'pif/products/00000000-0000-0000-0000-000000000000.mp3',
        filename: 'photo',
        bytes: 10,
        sha256: 'b'.repeat(64),
        updatedAt: new Date().toISOString(),
        updatedBy: null,
      })
    );
    expect(await serviceFor(root).active()).toMatchObject({ isDefault: true });
  });

  it('serves the default when the configured file has gone missing', async () => {
    const service = serviceFor(root);
    await service.replace(ID3_MP3, 'bell.mp3', null);
    const key = (JSON.parse(await readFile(configPath(), 'utf8')) as { key: string }).key;
    await rm(join(root, key));

    // `active()` still reports what was configured — the configuration is
    // intact and the operator should see it — but serving does not fail.
    expect(await service.active()).toMatchObject({ filename: 'bell.mp3' });
    expect(sniffMp3((await service.readActive()).buffer)).toBe(true);
  });

  it('never exposes a filesystem path in what it reports', async () => {
    const service = serviceFor(root);
    const active = await service.replace(ID3_MP3, 'bell.mp3', null);
    expect(JSON.stringify(active)).not.toContain(root);
    expect(JSON.stringify(active)).not.toContain(tmpdir());
  });
});
