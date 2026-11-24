import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acknowledgeOrder,
  alertSoundUrl,
  fetchOrders,
  type PifOrderSummary,
} from '../api/pif-admin-api';

/**
 * THE PIF INCOMING-ORDER ALERT, and nothing else.
 *
 * PIF ONLY. This hook is mounted by AdminLayout only while the reader is on a
 * /pif route. It polls one PIF endpoint, it knows no RIK route, table or
 * permission, and it cannot fire for a RIK order because a RIK order never
 * appears in the PIF order queue.
 *
 * ONE TIMER, FIFTEEN SECONDS, doing both jobs. The poll interval and the
 * buzzer repeat are the same 15 seconds on purpose: a second timer would be
 * a second thing to drift, and a buzzer that sounds between polls is
 * announcing nothing new. Each tick re-reads the queue, then sounds if
 * anything is still pending.
 *
 * NO DUPLICATE REQUESTS. `inFlight` holds the tick off while a request is
 * still running, so a slow network produces a longer gap, never a pile-up.
 * The interval is created once and torn down on unmount.
 *
 * WHAT "PENDING" MEANS: status PLACED and not acknowledged. Both come from
 * the server on every tick, so the truth is the server's, not a copy this
 * browser keeps. That is what makes refresh (the list is re-read), page
 * navigation (same), reconnection (the next tick) and a second staff member
 * acknowledging from another browser (the flag flips for everyone) all work
 * without any further machinery.
 *
 * THE SOUND IS THE CLIENT'S, NOT THE DEVELOPER'S. It is an MP3 held on the
 * server and configured through PIF Notification Settings, fetched from one
 * fixed URL. Replacing it needs no code change and no deployment: whoever
 * holds `pif.product.manage` uploads a new file and every PIF screen picks it
 * up. See the caching note on `element()` for exactly when.
 */

/** Poll AND buzzer repeat. One number, deliberately. */
export const ALERT_INTERVAL_MS = 15_000;

export type AudioState =
  /** Never asked: the reader has not pressed Enable sound. */
  | 'idle'
  /** Enabled and proven: the configured MP3 played through a user gesture. */
  | 'ready'
  /** The browser refused, or the audio would not load. Visual alerts continue. */
  | 'blocked';

export interface PifOrderAlertsApi {
  pending: PifOrderSummary[];
  /** The last poll failed — show a connection warning, keep the alerts. */
  offline: boolean;
  audio: AudioState;
  /** Ids currently being acknowledged, so the button can disable itself. */
  acknowledging: ReadonlySet<string>;
  enableSound: () => Promise<void>;
  testSound: () => Promise<void>;
  acknowledge: (orderId: string) => Promise<void>;
}

/**
 * How long to wait before assuming a play finished, when the element never
 * says so. Comfortably longer than a notification sound and shorter than the
 * 15-second repeat, so a lost `ended` event costs at most one skipped buzz
 * rather than silencing the desk for good.
 */
const PLAYBACK_FALLBACK_MS = 8_000;

export function usePifOrderAlerts(): PifOrderAlertsApi {
  const [pending, setPending] = useState<PifOrderSummary[]>([]);
  const [offline, setOffline] = useState(false);
  const [audio, setAudio] = useState<AudioState>('idle');
  const [acknowledging, setAcknowledging] = useState<ReadonlySet<string>>(new Set());

  const elementRef = useRef<HTMLAudioElement | null>(null);
  /** True while a sound is sounding, so two alerts can never overlap. */
  const playingRef = useRef(false);
  const fallbackRef = useRef<number | null>(null);
  const inFlight = useRef(false);
  const pendingRef = useRef<PifOrderSummary[]>([]);
  pendingRef.current = pending;
  const audioRef = useRef<AudioState>(audio);
  audioRef.current = audio;

  const settle = useCallback((): void => {
    playingRef.current = false;
    if (fallbackRef.current !== null) {
      window.clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
    }
  }, []);

  /**
   * The one audio element, built on first use.
   *
   * WHEN A NEW SOUND IS PICKED UP. The URL is fixed and its content changes
   * under it, so the response carries a strong ETag with `no-cache`: the
   * browser keeps the bytes but always asks whether they are still current.
   * This element loads the audio once, when it is created — so a screen that
   * was already open when the client replaced the sound keeps playing the old
   * one until the page is reloaded or Enable sound is pressed again. That is a
   * deliberate trade for not re-requesting audio every fifteen seconds, and
   * the settings screen itself always previews the real current file.
   */
  const element = useCallback((): HTMLAudioElement => {
    if (elementRef.current === null) {
      const el = new Audio(alertSoundUrl());
      el.preload = 'auto';
      el.addEventListener('ended', settle);
      el.addEventListener('pause', settle);
      el.addEventListener('error', settle);
      elementRef.current = el;
    }
    return elementRef.current;
  }, [settle]);

  /**
   * Play once. Returns false when the browser refused or the file would not
   * load, which is the caller's cue to report sound as blocked rather than let
   * the desk believe it will be told.
   *
   * NO OVERLAPPING PLAYBACK: if the previous sound is still going, this tick
   * is skipped. The visual alert is unaffected and the next tick will sound.
   */
  const playOnce = useCallback(async (): Promise<boolean> => {
    if (playingRef.current) return true;
    const el = element();
    playingRef.current = true;
    try {
      el.currentTime = 0;
    } catch {
      /* Not seekable yet; play from wherever it is. */
    }
    try {
      await el.play();
      const length =
        Number.isFinite(el.duration) && el.duration > 0
          ? el.duration * 1000 + 500
          : PLAYBACK_FALLBACK_MS;
      fallbackRef.current = window.setTimeout(settle, Math.min(length, PLAYBACK_FALLBACK_MS));
      return true;
    } catch {
      settle();
      return false;
    }
  }, [element, settle]);

  /**
   * Read the queue. The server decides what is pending; this only records it.
   *
   * Returns the fresh list, so the caller acts on THIS tick's answer rather
   * than on the previous render's copy, and null when nothing was learned —
   * either a request was already running, or the request failed.
   */
  const poll = useCallback(async (): Promise<PifOrderSummary[] | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    try {
      const page = await fetchOrders({ status: 'PLACED', pageSize: 50 });
      const next = page.items.filter((o) => !o.acknowledged);
      setPending(next);
      setOffline(false);
      return next;
    } catch {
      /*
       * FAIL VISIBLY, NEVER SILENTLY, AND NEVER DESTRUCTIVELY. A failed poll
       * means we do not know, so the pending list is left exactly as it was:
       * nothing is marked acknowledged because the network dropped, and no
       * alert is discarded. The next successful tick replaces the list
       * wholesale, which is also how orders that arrived during the outage
       * are recovered.
       */
      setOffline(true);
      return null;
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => {
      void (async () => {
        const fresh = await poll();
        /*
         * THIS tick's answer when we have one; the last known list when we do
         * not. The fallback is what keeps "repeat until acknowledged" true
         * through a network outage — those orders are still on screen and
         * still waiting, so the desk should still be told.
         */
        const list = fresh ?? pendingRef.current;
        if (list.length > 0 && audioRef.current === 'ready') {
          const played = await playOnce();
          if (!played) setAudio('blocked');
        }
      })();
    }, ALERT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [poll, playOnce]);

  /** Release the element when the panel goes away, so nothing keeps sounding. */
  useEffect(
    () => () => {
      if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current);
      const el = elementRef.current;
      if (el !== null) {
        el.pause();
        el.removeEventListener('ended', settle);
        el.removeEventListener('pause', settle);
        el.removeEventListener('error', settle);
        el.src = '';
        elementRef.current = null;
      }
    },
    [settle]
  );

  /**
   * Browsers only let audio start from a real gesture, so this must be called
   * from a click handler. It plays the configured sound immediately: if that
   * does not play, the state goes to 'blocked' and the UI says so. We never
   * report sound as enabled on the strength of having asked.
   */
  const enableSound = useCallback(async (): Promise<void> => {
    settle();
    setAudio((await playOnce()) ? 'ready' : 'blocked');
  }, [playOnce, settle]);

  const testSound = useCallback(async (): Promise<void> => {
    settle();
    setAudio((await playOnce()) ? 'ready' : 'blocked');
  }, [playOnce, settle]);

  /**
   * Mark one alert seen. Independent per order: acknowledging 101 leaves 102
   * pending and the buzzer sounding, which is the whole point.
   *
   * The optimistic removal is safe because it is only a display choice — the
   * next poll re-reads the server and would put the order back if the write
   * had not landed.
   */
  const acknowledge = useCallback(
    async (orderId: string): Promise<void> => {
      setAcknowledging((s) => new Set(s).add(orderId));
      try {
        await acknowledgeOrder(orderId);
        setPending((list) => list.filter((o) => o.id !== orderId));
      } catch {
        // Leave it pending and let the next poll settle it; a refusal here is
        // usually a missing permission, which the panel already explains.
        setOffline(true);
      } finally {
        setAcknowledging((s) => {
          const next = new Set(s);
          next.delete(orderId);
          return next;
        });
      }
    },
    []
  );

  return { pending, offline, audio, acknowledging, enableSound, testSound, acknowledge };
}
