'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { PauseIcon, PlayIcon } from '../../../components/icons';
import { VoiceAvatar } from '../../../components/voice-avatar';
import {
  AGENT_TONE_OPTIONS,
  DEFAULT_AGENT_TONE,
  type AgentToneOption,
} from '../../../lib/agents/tones';
import { CustomSelect } from './custom-select';
import {
  ensureVoicePreviewCached,
  getCachedVoicePreviewUrl,
  hasCachedVoicePreview,
  prefetchVoicePreviews,
} from '../../../lib/voices/voice-preview-cache';

type CartesiaVoiceGender = 'masculine' | 'feminine' | 'gender_neutral';

type CartesiaVoice = {
  gender: CartesiaVoiceGender | null;
  id: string;
  language: string | null;
  name: string;
  previewUrl: string | null;
  tagline: string | null;
};

type VoicesApiResponse = { voices: CartesiaVoice[] } | { error: string };

type VoiceSelection = {
  tones: AgentToneOption[];
  voiceId: string;
  voiceName: string | null;
};

type VoiceConfigDrawerProps = {
  disabled: boolean;
  initialTones: AgentToneOption[];
  initialVoiceId: string;
  initialVoiceName: string | null;
  onApply: (_next: VoiceSelection) => void;
  onClose: () => void;
};

function genderLabel(gender: CartesiaVoiceGender | null): string {
  switch (gender) {
    case 'masculine':
      return 'Male';
    case 'feminine':
      return 'Female';
    case 'gender_neutral':
      return 'Neutral';
    default:
      return 'Unspecified';
  }
}

async function fetchVoiceCatalog(): Promise<CartesiaVoice[]> {
  // No cache: 'no-store' here on purpose -- this lets the browser honor the
  // route's Cache-Control (5 min), so reopening the drawer shortly after
  // doesn't redo the full auth + DB round trip every time.
  const response = await fetch('/api/voices');
  const payload = (await response.json().catch(() => null)) as VoicesApiResponse | null;

  if (!response.ok || !payload || 'error' in payload) {
    throw new Error(
      payload && 'error' in payload
        ? payload.error
        : 'Unable to load the voice catalog right now.',
    );
  }

  return payload.voices;
}

export function VoiceConfigDrawer({
  disabled,
  initialTones,
  initialVoiceId,
  initialVoiceName,
  onApply,
  onClose,
}: VoiceConfigDrawerProps) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [mounted, setMounted] = useState(false);

  const [voices, setVoices] = useState<CartesiaVoice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [genderFilter, setGenderFilter] = useState('all');

  const [pendingVoiceId, setPendingVoiceId] = useState(initialVoiceId);
  const [pendingVoiceName, setPendingVoiceName] = useState(initialVoiceName);
  const [pendingTones, setPendingTones] = useState<AgentToneOption[]>(initialTones);

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playErrorVoiceId, setPlayErrorVoiceId] = useState<string | null>(null);
  const [readyPreviewIds, setReadyPreviewIds] = useState<Record<string, true>>({});

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchVoiceCatalog()
      .then((data) => {
        if (cancelled) return;
        setVoices(data);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error ? error.message : 'Unable to load the voice catalog right now.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!voices || !pendingVoiceId) {
      return;
    }

    setPendingVoiceName((current) => {
      if (current) {
        return current;
      }

      return voices.find((voice) => voice.id === pendingVoiceId)?.name ?? null;
    });
  }, [voices, pendingVoiceId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        drawerRef.current &&
        !drawerRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [onClose]);

  const genderOptions = useMemo(() => {
    const present = Array.from(
      new Set((voices ?? []).map((voice) => voice.gender).filter(Boolean)),
    ) as CartesiaVoiceGender[];
    return [
      { label: 'All genders', value: 'all' },
      ...present.map((gender) => ({ label: genderLabel(gender), value: gender })),
    ];
  }, [voices]);

  const filteredVoices = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (voices ?? []).filter((voice) => {
      if (genderFilter !== 'all' && voice.gender !== genderFilter) return false;
      if (
        query &&
        !voice.name.toLowerCase().includes(query) &&
        !voice.id.toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });
  }, [voices, search, genderFilter]);

  useEffect(() => {
    if (filteredVoices.length === 0) {
      return;
    }

    let cancelled = false;

    void prefetchVoicePreviews(filteredVoices, {
      limit: 24,
      prioritizeIds: pendingVoiceId ? [pendingVoiceId] : [],
    }).then(() => {
      if (cancelled) {
        return;
      }

      setReadyPreviewIds((current) => {
        const next = { ...current };
        let changed = false;
        for (const voice of filteredVoices.slice(0, 24)) {
          if (hasCachedVoicePreview(voice.id) && !next[voice.id]) {
            next[voice.id] = true;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [filteredVoices, pendingVoiceId]);

  function markPreviewReady(voiceId: string) {
    setReadyPreviewIds((current) =>
      current[voiceId] ? current : { ...current, [voiceId]: true },
    );
  }

  function handleSelectVoice(voice: CartesiaVoice) {
    setPendingVoiceId(voice.id);
    setPendingVoiceName(voice.name);
    void ensureVoicePreviewCached(voice.id, voice.previewUrl).then((url) => {
      if (url) {
        markPreviewReady(voice.id);
      }
    });
  }

  function handleClearVoice() {
    setPendingVoiceId('');
    setPendingVoiceName(null);
  }

  async function handleTogglePlay(voice: CartesiaVoice, event: React.MouseEvent) {
    event.stopPropagation();
    if (!voice.previewUrl) return;

    audioRef.current?.pause();
    setPlayErrorVoiceId(null);

    if (playingId === voice.id) {
      setPlayingId(null);
      return;
    }

    setPlayingId(voice.id);

    const handleFailure = () => {
      setPlayingId((current) => (current === voice.id ? null : current));
      setPlayErrorVoiceId(voice.id);
      setTimeout(() => {
        setPlayErrorVoiceId((current) => (current === voice.id ? null : current));
      }, 3000);
    };

    try {
      let objectUrl = getCachedVoicePreviewUrl(voice.id);
      if (!objectUrl) {
        objectUrl = await ensureVoicePreviewCached(voice.id, voice.previewUrl);
      }

      if (!objectUrl) {
        handleFailure();
        return;
      }

      markPreviewReady(voice.id);
      const audio = new Audio(objectUrl);
      audioRef.current = audio;

      audio.addEventListener('ended', () => {
        setPlayingId((current) => (current === voice.id ? null : current));
      });
      audio.addEventListener('error', handleFailure);
      await audio.play();
    } catch {
      handleFailure();
    }
  }

  function handleWarmPreview(voice: CartesiaVoice) {
    if (!voice.previewUrl || readyPreviewIds[voice.id]) {
      return;
    }

    void ensureVoicePreviewCached(voice.id, voice.previewUrl).then((url) => {
      if (url) {
        markPreviewReady(voice.id);
      }
    });
  }

  function toggleTone(tone: AgentToneOption) {
    setPendingTones((prev) =>
      prev.includes(tone) ? prev.filter((item) => item !== tone) : [...prev, tone],
    );
  }

  function handleCancel(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  function handleUseSelection(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onApply({
      tones: pendingTones,
      voiceId: pendingVoiceId,
      voiceName: pendingVoiceName,
    });
  }

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div className="conversation-drawer-overlay" onClick={onClose}>
      <div className="conversation-drawer-backdrop" />
      <aside
        aria-modal="true"
        className="conversation-drawer voice-config-drawer"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        ref={drawerRef}
        role="dialog"
      >
        <div className="conversation-drawer-header">
          <div>
            <span className="eyebrow">Voice Settings</span>
            <h2 className="conversation-drawer-title">Configure voice</h2>
          </div>
          <button
            aria-label="Close"
            className="conversation-drawer-close"
            onClick={handleCancel}
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="conversation-drawer-body voice-config-drawer-body">
          <section className="voice-config-section">
            <h3 className="voice-config-section-title">Tone</h3>
            <p className="hint-text" style={{ margin: '0 0 12px' }}>
              {pendingTones.length > 0
                ? 'Pick one or more delivery tones for how this agent should sound.'
                : `No tone selected — ${DEFAULT_AGENT_TONE} will be used by default.`}
            </p>
            <div className="tone-pills-grid" role="group" aria-label="Tone">
              {AGENT_TONE_OPTIONS.map((tone) => {
                const isSelected = pendingTones.includes(tone);
                return (
                  <button
                    aria-pressed={isSelected}
                    className={`tone-pill-btn${isSelected ? ' is-selected' : ''}`}
                    disabled={disabled}
                    key={tone}
                    onClick={() => toggleTone(tone)}
                    type="button"
                  >
                    {tone}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="voice-config-section voice-config-section-voices">
            <div className="voice-config-section-heading">
              <div>
                <h3 className="voice-config-section-title">Voice</h3>
                <p className="hint-text" style={{ margin: 0 }}>
                  {pendingVoiceId
                    ? `Selected: ${pendingVoiceName ?? pendingVoiceId}`
                    : 'No voice selected — the default system voice will be used.'}
                </p>
              </div>
              {pendingVoiceId ? (
                <button
                  className="voice-config-clear"
                  disabled={disabled}
                  onClick={handleClearVoice}
                  type="button"
                >
                  Use default voice
                </button>
              ) : null}
            </div>

            <div className="voice-config-filters">
              <CustomSelect
                name="voiceGenderFilter"
                onChange={setGenderFilter}
                options={genderOptions}
                value={genderFilter}
              />
              <input
                aria-label="Search voices"
                className="voice-config-search"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search voices…"
                type="text"
                value={search}
              />
            </div>

            {loadError ? (
              <div className="notice notice-danger">{loadError}</div>
            ) : loading ? (
              <div className="voice-card-grid">
                {Array.from({ length: 6 }, (_, index) => (
                  <div className="voice-card voice-card-skeleton" key={index} />
                ))}
              </div>
            ) : filteredVoices.length === 0 ? (
              <div className="empty-state">
                <p className="muted-copy">No voices match your filters.</p>
              </div>
            ) : (
              <div className="voice-card-grid">
                {filteredVoices.map((voice) => {
                  const isSelected = pendingVoiceId === voice.id;
                  const isPlaying = playingId === voice.id;
                  const hasPreview = Boolean(voice.previewUrl);
                  const failedToPlay = playErrorVoiceId === voice.id;

                  return (
                    <div
                      className={`voice-card${isSelected ? ' is-selected' : ''}${
                        readyPreviewIds[voice.id] ? ' is-preview-ready' : ''
                      }`}
                      key={voice.id}
                      onClick={() => !disabled && handleSelectVoice(voice)}
                      onKeyDown={(event) => {
                        if (disabled) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleSelectVoice(voice);
                        }
                      }}
                      onMouseEnter={() => handleWarmPreview(voice)}
                      onFocus={() => handleWarmPreview(voice)}
                      role="button"
                      tabIndex={0}
                    >
                      <VoiceAvatar gender={voice.gender} name={voice.name} seed={voice.id} />
                      <div className="voice-card-body">
                        <p className="voice-card-name">{voice.name}</p>
                        <div className="voice-card-meta">
                          <span className="voice-card-gender">
                            {genderLabel(voice.gender)}
                          </span>
                          {voice.tagline ? (
                            <span className="voice-card-tagline">{voice.tagline}</span>
                          ) : null}
                        </div>
                        {failedToPlay ? (
                          <p className="voice-card-error">Preview unavailable</p>
                        ) : null}
                      </div>
                      {isSelected ? <span className="voice-card-selected-dot" /> : null}
                      <button
                        aria-label={
                          !hasPreview
                            ? `No preview available for ${voice.name}`
                            : isPlaying
                              ? `Stop sample of ${voice.name}`
                              : `Play sample of ${voice.name}`
                        }
                        className="voice-card-play"
                        disabled={!hasPreview}
                        onClick={(event) => handleTogglePlay(voice, event)}
                        title={!hasPreview ? 'No preview available' : undefined}
                        type="button"
                      >
                        {isPlaying ? <PauseIcon /> : <PlayIcon />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="conversation-drawer-footer">
          <button className="button-secondary" onClick={handleCancel} type="button">
            Cancel
          </button>
          <button
            className="button"
            disabled={disabled}
            onClick={handleUseSelection}
            type="button"
          >
            Use this configuration
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
