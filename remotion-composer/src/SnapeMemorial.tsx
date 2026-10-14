import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * ALWAYS — A Memorial for Severus Snape
 *
 * Hand-authored (atelier) composition. Six held photographic frames, a fixed
 * 2.39:1 letterbox inside 1920x1080, and motion carried entirely by camera
 * behaviour (slow push, slow pull-back, one rack focus) plus atmosphere
 * (guttering flame, raking light, drifting grain, a light bloom that
 * assembles). The frame is deliberately unstable for the first 37 seconds and
 * then goes completely still at the reveal — that stillness is the payoff.
 *
 * Two rules govern every value below:
 *   1. There is exactly ONE genuinely bright object in the film: the doe at
 *      0:39. It appears once and is never repeated or echoed.
 *   2. The frame must never do anything the camera would not do in a vigil.
 */

const HEIGHT = 1080;
const ACTIVE_H = 802; // 1920 / 2.39 = 803.3 -> 802 keeps it even
const BAR = (HEIGHT - ACTIVE_H) / 2; // 139px per bar

type Scene = {
  id: string;
  src: string;
  /** Sequence window in seconds — overlaps the neighbour by the dissolve length. */
  seqStart: number;
  seqEnd: number;
  fadeIn: number;
  fadeOut: number;
  scaleFrom: number;
  scaleTo: number;
  brightnessFrom: number;
  brightnessTo: number;
  contrast: number;
  saturate: number;
  /** sc3 alone: focus plane drifts across the shot rather than the frame moving. */
  rackFocus?: boolean;
  /** sc1 alone: the flame is the only source, so the whole image breathes with it. */
  candleFlicker?: boolean;
  /** sc5 alone: the light assembles out of nothing over the first seconds. */
  lightAssemble?: boolean;
  /** sc2 alone: a raking light sweeps slowly across carved stone. */
  rakeLight?: boolean;
  /** sc6 alone: a thread of smoke is the last thing that moves. */
  smoke?: boolean;
};

/** Pre-rendered blur plates, keyed by the frame they derive from. */
const plateFor = (src: string, kind: "bloom" | "soft") =>
  `${kind}/${src.split("/").pop()}`;

const SCENES: Scene[] = [
  {
    id: "sc1",
    src: "images/frames/01-the-isolation.png",
    seqStart: 0,
    seqEnd: 16.4,
    fadeIn: 0.9,
    fadeOut: 1.4,
    scaleFrom: 1.0,
    scaleTo: 1.022,
    brightnessFrom: 0.82,
    brightnessTo: 1.0,
    contrast: 1.1,
    saturate: 0.62,
    candleFlicker: true,
  },
  {
    id: "sc2",
    src: "images/frames/02-the-names.png",
    seqStart: 13.8,
    seqEnd: 25.4,
    fadeIn: 1.4,
    fadeOut: 1.4,
    scaleFrom: 1.01,
    scaleTo: 1.0,
    brightnessFrom: 1.0,
    brightnessTo: 0.96,
    contrast: 1.24,
    saturate: 0.5,
    rakeLight: true,
  },
  {
    id: "sc3",
    src: "images/frames/03-the-glass-house.png",
    seqStart: 24.0,
    seqEnd: 34.5,
    // hard cut OUT at 34.5 — the film's only hard cut, into the black
    fadeIn: 1.4,
    fadeOut: 0,
    scaleFrom: 1.0,
    scaleTo: 1.012,
    brightnessFrom: 0.98,
    brightnessTo: 0.9,
    contrast: 1.14,
    saturate: 0.6,
    rackFocus: true,
  },
  {
    id: "sc4",
    src: "images/frames/04-the-candle.png",
    seqStart: 34.5,
    seqEnd: 39.0,
    // exposure lifts the flame out of pure black; nothing else in frame moves
    fadeIn: 2.6,
    fadeOut: 1.4,
    scaleFrom: 1.0,
    scaleTo: 1.0,
    brightnessFrom: 0.34,
    brightnessTo: 1.02,
    contrast: 1.2,
    saturate: 0.75,
    candleFlicker: true,
  },
  {
    id: "sc5",
    src: "images/frames/05-the-doe.png",
    seqStart: 37.6,
    seqEnd: 49.4,
    fadeIn: 1.4,
    fadeOut: 1.4,
    // LOCKED OFF. Zero camera movement — the instability resolves here.
    scaleFrom: 1.0,
    scaleTo: 1.0,
    brightnessFrom: 0.72,
    brightnessTo: 1.0,
    contrast: 1.1,
    saturate: 0.68,
    lightAssemble: true,
  },
  {
    id: "sc6",
    src: "images/frames/06-the-candle-out.png",
    seqStart: 48.0,
    seqEnd: 60.0,
    fadeIn: 1.4,
    fadeOut: 0,
    // the opening push, inverted: the film withdraws
    scaleFrom: 1.016,
    scaleTo: 1.0,
    brightnessFrom: 0.9,
    brightnessTo: 0.72,
    contrast: 1.18,
    saturate: 0.5,
    smoke: true,
  },
];

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Deterministic, cheap pseudo-noise so flicker is frame-stable across renders. */
const wobble = (frame: number, speed: number, seed: number) => {
  const a = Math.sin(frame * speed + seed);
  const b = Math.sin(frame * speed * 2.37 + seed * 1.7);
  const c = Math.sin(frame * speed * 0.53 + seed * 3.1);
  return (a * 0.5 + b * 0.3 + c * 0.2 + 1) / 2; // 0..1
};

/**
 * Halation: light spilling out of the highlights. The blur is baked into a
 * pre-rendered 1/4-resolution plate (assets/bloom/), because a blur is
 * resolution-independent and paying for a 46px blur on every one of 1800
 * frames is pure waste. The plate is stretched back up, which is visually
 * identical to blurring the full-size frame and costs nothing.
 */
const Bloom: React.FC<{ plate: string; opacity: number }> = ({ plate, opacity }) => (
  <AbsoluteFill style={{ mixBlendMode: "screen", opacity }}>
    <Img
      src={staticFile(plate)}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: "scale(1.08)",
      }}
    />
  </AbsoluteFill>
);

const SceneLayer: React.FC<{ scene: Scene; index: number }> = ({ scene, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const durF = Math.round((scene.seqEnd - scene.seqStart) * fps);
  const inF = Math.round(scene.fadeIn * fps);
  const outF = Math.round(scene.fadeOut * fps);

  const fadeIn = inF > 0 ? interpolate(frame, [0, inF], [0, 1], clamp) : 1;
  const fadeOut = outF > 0 ? interpolate(frame, [durF - outF, durF], [1, 0], clamp) : 1;
  const opacity = Math.min(fadeIn, fadeOut);

  const p = durF > 1 ? frame / (durF - 1) : 0;
  const scale = interpolate(p, [0, 1], [scene.scaleFrom, scene.scaleTo]);

  let brightness = interpolate(p, [0, 1], [scene.brightnessFrom, scene.brightnessTo]);

  // --- sc1 / sc4: the flame is the only source, so the image gutturs with it
  if (scene.candleFlicker) {
    const w = wobble(frame, 0.19, index * 2.3);
    const w2 = wobble(frame, 0.041, index * 5.1);
    brightness *= 0.965 + 0.035 * w + 0.02 * w2;
  }

  // --- sc5: the light assembles out of nothing over the first ~2.6s
  let bloom = 0.16;
  let extraBlur = 0;
  if (scene.lightAssemble) {
    const a = interpolate(frame, [0, Math.round(2.6 * fps)], [0, 1], {
      ...clamp,
      easing: (t) => 1 - Math.pow(1 - t, 2.2),
    });
    // as the light gathers, the image sharpens and the bloom blooms
    brightness *= 0.55 + 0.45 * a;
    bloom = 0.1 + 0.36 * a;
    extraBlur = 0;
  }

  // --- sc2: a raking light drifts across the carved surface
  let rake: number | null = null;
  if (scene.rakeLight) {
    rake = interpolate(frame, [0, durF], [-38, 138], clamp);
  }

  return (
    <AbsoluteFill style={{ opacity, backgroundColor: "#020305" }}>
      <AbsoluteFill
        style={{
          transform: `scale(${scale})`,
          filter: `blur(${extraBlur}px)`,
        }}
      >
        <Img
          src={staticFile(scene.src)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: `contrast(${scene.contrast}) saturate(${scene.saturate}) brightness(${brightness})`,
          }}
        />
      </AbsoluteFill>

      {/* sc3 rack focus: an out-of-focus copy dissolves away as the glass sharpens */}
      {scene.rackFocus ? (
        <AbsoluteFill
          style={{
            opacity: interpolate(frame, [0, Math.round(5.5 * fps)], [0.92, 0], clamp),
            mixBlendMode: "normal",
          }}
        >
          <Img
            src={staticFile(plateFor(scene.src, "soft"))}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${scale * 1.02})`,
            }}
          />
        </AbsoluteFill>
      ) : null}

      {/* sc2 raking light — a soft moving gradient in overlay blend */}
      {rake !== null ? (
        <AbsoluteFill
          style={{
            mixBlendMode: "overlay",
            background: `linear-gradient(100deg, transparent ${rake - 26}%, rgba(226,236,244,0.30) ${rake}%, transparent ${rake + 26}%)`,
          }}
        />
      ) : null}

      <Bloom plate={plateFor(scene.src, "bloom")} opacity={bloom} />

      {/* the vignette is what keeps every frame's corners black */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 92% 78% at 50% 46%, transparent 34%, rgba(0,0,0,0.42) 74%, rgba(0,0,0,0.86) 100%)",
        }}
      />
      {scene.smoke ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse 34% 30% at ${50 + 2 * Math.sin(frame / 47)}% ${62 - (frame % 300) * 0.02}%, rgba(196,206,214,0.055) 0%, transparent 70%)`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  const tile = staticFile(`grain/grain-${frame % 8}.png`);
  return (
    <AbsoluteFill style={{ mixBlendMode: "overlay", opacity: 0.2, pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          backgroundImage: `url(${tile})`,
          backgroundRepeat: "repeat",
          backgroundPosition: `${(frame * 37) % 512}px ${(frame * 53) % 512}px`,
        }}
      />
    </AbsoluteFill>
  );
};

const TitleCard: React.FC<{
  text: string;
  subtext?: string;
  from: number;
  to: number;
  fade?: number;
  size?: number;
}> = ({ text, subtext, from, to, fade = 0.9, size = 40 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = Math.round(fade * fps);
  const start = Math.round(from * fps);
  const end = Math.round(to * fps);
  const a = interpolate(frame, [start, start + f, end - f, end], [0, 1, 1, 0], clamp);
  if (a <= 0) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: a }}>
      <div
        style={{
          fontFamily: '"Space Grotesk", Helvetica, Arial, sans-serif',
          fontWeight: 400,
          fontSize: size,
          letterSpacing: "0.42em",
          textTransform: "uppercase",
          color: "#E9E5DB",
          textAlign: "center",
          textShadow: "0 2px 26px rgba(0,0,0,0.92), 0 0 3px rgba(0,0,0,0.9)",
          paddingLeft: "0.42em",
          lineHeight: 1.5,
        }}
      >
        {text}
        {subtext ? (
          <div
            style={{
              fontSize: size * 0.55,
              letterSpacing: "0.34em",
              color: "#8A939B",
              marginTop: size * 0.75,
              paddingLeft: "0.34em",
            }}
          >
            {subtext}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export type SnapeMemorialProps = {
  titleFontSize?: number;
};

export const SnapeMemorial: React.FC<SnapeMemorialProps> = ({ titleFontSize = 40 }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();

  // opens from black, closes to black — the last second is empty
  const openFromBlack = interpolate(frame, [0, Math.round(0.9 * fps)], [1, 0], clamp);
  const closeToBlack = interpolate(
    frame,
    [durationInFrames - Math.round(1.0 * fps), durationInFrames - 1],
    [0, 1],
    clamp,
  );
  const globalBlack = Math.max(openFromBlack, closeToBlack);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* ---------------- picture, constrained to the 2.39:1 active area */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: BAR,
          width: 1920,
          height: ACTIVE_H,
          overflow: "hidden",
          backgroundColor: "#020305",
        }}
      >
        {SCENES.map((scene, i) => (
          <Sequence
            key={scene.id}
            from={Math.round(scene.seqStart * fps)}
            durationInFrames={Math.round((scene.seqEnd - scene.seqStart) * fps)}
            name={scene.id}
          >
            <SceneLayer scene={scene} index={i} />
          </Sequence>
        ))}

        <Grain />

        {/* ---------------- typography: three notices, no more */}
        <Sequence from={0} durationInFrames={Math.round(6 * fps)} name="t1">
          <TitleCard
            text="Severus Snape"
            subtext="1960 — 1998"
            from={0}
            to={5.0}
            size={titleFontSize}
          />
        </Sequence>
        <Sequence from={0} durationInFrames={durationInFrames} name="t2">
          <TitleCard
            text="He was not asked to be forgiven"
            from={48.0}
            to={52.0}
            size={titleFontSize * 0.9}
          />
        </Sequence>
        <Sequence from={0} durationInFrames={durationInFrames} name="t3">
          <TitleCard
            text="He was asked to be seen"
            subtext="for Alan Rickman"
            from={54.5}
            to={59.0}
            size={titleFontSize * 0.9}
          />
        </Sequence>
      </div>

      {/* ---------------- the letterbox, drawn on top so nothing leaks */}
      <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: BAR, backgroundColor: "#000" }} />
      <div style={{ position: "absolute", left: 0, bottom: 0, width: 1920, height: BAR, backgroundColor: "#000" }} />

      {/* ---------------- fade from black / to black */}
      {globalBlack > 0 ? (
        <AbsoluteFill style={{ backgroundColor: "#000", opacity: globalBlack }} />
      ) : null}

      {/*
        Audio: ONE pre-mixed stem, not a score + five separate voice clips.

        Balancing the five narration lines live in the composition left the
        voice only +0.4 to +5.8 dB above the bed, which is not enough for
        reliable intelligibility. The fix belongs in the mix, not in the
        composition: assets/mix_audio.py ducks the score by -8 dB under every
        spoken line (0.4s lead, 0.9s recovery) so the voice lands +8.5 to
        +19.1 dB above the bed while the film's 22 dB of dynamic range — and
        the near-silent 0:34.5 dropout — survive untouched. That script is the
        single source of truth for the film's sound.
      */}
      <Audio src={staticFile("audio/mix.wav")} />
    </AbsoluteFill>
  );
};
