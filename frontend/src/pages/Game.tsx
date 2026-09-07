// Leaf Match (Step 11 item 2) — actually playable.
//
// Calm by design: no timer, no fail state, no score pressure. The reward is
// Garden XP for pairs found, so a slow careful game earns the same as a fast
// one. Pairs are shuffled client-side; the reward is validated server-side.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import {
  ArrowLeftIcon,
  LeafIcon,
  FlowerIcon,
  HelpCircleIcon,
  DropletIcon,
  GemIcon,
  SnowflakeIcon,
  SparklesIcon,
} from "../components/icons";
import { InlineError, InlineNotice } from "../components/states";

interface GardenResponse {
  companion: {
    name: string;
    growth: number;
    stage: number;
    stageName: string;
    nextStageAt: number | null;
    progress: number;
    equipped: string[];
  };
  wallet: { gardenXp: number; streakFreezes: number };
  pairsPerRound: number;
}

const PAIR_COUNT = 6;

const FACES = [
  <LeafIcon cls="icon" key="leaf" />,
  <FlowerIcon cls="icon" key="flower" />,
  <DropletIcon cls="icon" key="droplet" />,
  <GemIcon cls="icon" key="gem" />,
  <SnowflakeIcon cls="icon" key="snow" />,
  <SparklesIcon cls="icon" key="spark" />,
];

interface Tile {
  id: number;
  face: number;
  flipped: boolean;
  matched: boolean;
}

function shuffledDeck(): Tile[] {
  const faces = [...Array(PAIR_COUNT).keys()].flatMap((f) => [f, f]);
  // Fisher-Yates.
  for (let i = faces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [faces[i], faces[j]] = [faces[j], faces[i]];
  }
  return faces.map((face, id) => ({ id, face, flipped: false, matched: false }));
}

export default function Game() {
  const navigate = useNavigate();
  const { data, reload } = useApi<GardenResponse>("/api/garden");

  const [tiles, setTiles] = useState<Tile[]>(shuffledDeck);
  const [picked, setPicked] = useState<number[]>([]);
  const [locked, setLocked] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const matchedPairs = useMemo(
    () => tiles.filter((t) => t.matched).length / 2,
    [tiles]
  );
  const complete = matchedPairs === PAIR_COUNT;

  function flip(id: number) {
    if (locked || claimed) return;
    const tile = tiles.find((t) => t.id === id);
    if (!tile || tile.flipped || tile.matched) return;
    if (picked.length >= 2) return;

    setTiles((prev) => prev.map((t) => (t.id === id ? { ...t, flipped: true } : t)));
    setPicked((prev) => [...prev, id]);
  }

  // Resolve a pair after a beat, so the second tile is actually visible.
  useEffect(() => {
    if (picked.length !== 2) return;
    setLocked(true);

    const [a, b] = picked;
    const tileA = tiles.find((t) => t.id === a);
    const tileB = tiles.find((t) => t.id === b);
    const isMatch = tileA && tileB && tileA.face === tileB.face;

    const timer = window.setTimeout(() => {
      setTiles((prev) =>
        prev.map((t) => {
          if (t.id !== a && t.id !== b) return t;
          return isMatch
            ? { ...t, matched: true, flipped: true }
            : { ...t, flipped: false };
        })
      );
      setPicked([]);
      setLocked(false);
    }, isMatch ? 400 : 800);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  const claim = useCallback(
    async (pairsFound: number, completed: boolean) => {
      if (claimed) return;
      setClaimed(true);
      setError(null);
      try {
        const res = await api.post<{ gardenXpEarned: number; gardenXp: number }>(
          "/api/garden/minigame/finish",
          { pairsFound, completed }
        );
        setNotice(
          `+${res.gardenXpEarned} Garden XP — you now have ${res.gardenXp}.`
        );
        reload();
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "Couldn't save that round."
        );
        setClaimed(false);
      }
    },
    [claimed, reload]
  );

  // Auto-claim on a full clear — no "collect" step to forget.
  useEffect(() => {
    if (complete && !claimed) void claim(PAIR_COUNT, true);
  }, [complete, claimed, claim]);

  function playAgain() {
    setTiles(shuffledDeck());
    setPicked([]);
    setLocked(false);
    setClaimed(false);
    setNotice(null);
  }

  return (
    <AppShell>
      <button
        onClick={() => navigate("/profile")}
        className="back-link"
        style={{ background: "none", border: "none", cursor: "pointer", marginBottom: 14 }}
      >
        <ArrowLeftIcon cls="icon-sm" /> Back to profile
      </button>
      <h1 className="section-title">Leaf Match</h1>
      <p className="section-sub">
        A calm little break. Spend Garden XP on items for your companion.
      </p>

      <InlineError message={error} />
      <InlineNotice message={notice} />

      {/* The companion grows from studying, not from this — shown here so the
          distinction is visible rather than just stated. */}
      {data && (
        <div className="card" style={{ marginBottom: 18, display: "flex", alignItems: "center", gap: 14 }}>
          <div className="companion-body" style={{ width: 52, height: 52 }}>
            <SparklesIcon cls="icon" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>
              {data.companion.name} · {data.companion.stageName}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
              Grows from studying, not from playing
            </div>
          </div>
          <span className="xp-chip">
            <LeafIcon cls="icon-sm" /> {data.wallet.gardenXp} Garden XP
          </span>
        </div>
      )}

      <div className="game-hud">
        <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
          {matchedPairs} of {PAIR_COUNT} pairs found
        </span>
        <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>
          No rush, no timer
        </span>
      </div>

      <div className="game-scene">
        <div className="tile-grid" role="group" aria-label="Leaf Match board">
          {tiles.map((t) => {
            const face = t.flipped || t.matched;
            return (
              <button
                key={t.id}
                className={`tile ${t.matched ? "matched" : face ? "flipped" : ""}`}
                onClick={() => flip(t.id)}
                disabled={locked || t.matched || claimed}
                aria-label={
                  t.matched
                    ? "Matched pair"
                    : face
                      ? "Revealed tile"
                      : "Hidden tile — click to reveal"
                }
              >
                {face ? (
                  FACES[t.face]
                ) : (
                  <HelpCircleIcon cls="icon-sm" style={{ color: "var(--ink-faint)" }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {complete ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button className="btn btn-ghost" style={{ flex: 1, minWidth: 150 }} onClick={playAgain}>
            Play again
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1, minWidth: 150 }}
            onClick={() => navigate("/shop")}
          >
            Spend Garden XP
          </button>
        </div>
      ) : (
        <button
          className="btn btn-ghost btn-block"
          onClick={() => claim(matchedPairs, false)}
          disabled={matchedPairs === 0 || claimed}
        >
          {matchedPairs === 0
            ? "Find a pair to earn Garden XP"
            : `Finish early & collect (${matchedPairs} ${matchedPairs === 1 ? "pair" : "pairs"})`}
        </button>
      )}
    </AppShell>
  );
}
