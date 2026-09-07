// Sprout's Shop (Step 11 item 3) — real purchases against Garden XP, with
// premium-only cosmetics gated (Step 13 item 3).
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import {
  ArrowLeftIcon,
  SnowflakeIcon,
  GemIcon,
  FlowerIcon,
  LeafIcon,
  DropletIcon,
  SparklesIcon,
  LockIcon,
  CheckIcon,
} from "../components/icons";
import {
  ErrorState,
  InlineError,
  InlineNotice,
  SkeletonRows,
} from "../components/states";

interface ShopItem {
  key: string;
  name: string;
  description: string;
  kind: string;
  slot: string;
  price: number;
  icon: string;
  premiumOnly: boolean;
  owned: boolean;
  locked: boolean;
  affordable: boolean;
}

interface ShopResponse {
  gardenXp: number;
  isPremium: boolean;
  items: ShopItem[];
}

const ICONS: Record<string, ReactNode> = {
  snowflake: <SnowflakeIcon cls="icon" />,
  gem: <GemIcon cls="icon" />,
  flower: <FlowerIcon cls="icon" />,
  droplet: <DropletIcon cls="icon" />,
  sparkles: <SparklesIcon cls="icon" />,
};

const TONES: Record<string, { bg: string; fg: string }> = {
  utility: { bg: "var(--primary-light)", fg: "var(--primary-dark)" },
  companion: { bg: "var(--accent-light)", fg: "#A6431E" },
  habitat: { bg: "var(--warning-light)", fg: "#8A6412" },
};

export default function Shop() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi<ShopResponse>("/api/garden/shop");
  const [buying, setBuying] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function buy(item: ShopItem) {
    if (item.locked) {
      navigate("/upgrade");
      return;
    }
    setBuying(item.key);
    setActionError(null);
    setNotice(null);
    try {
      await api.post("/api/garden/shop/purchase", { itemKey: item.key });
      setNotice(`${item.name} is yours.`);
      reload();
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      if (apiErr?.status === 402 && (apiErr.data as { error?: string })?.error === "premium_required") {
        navigate("/upgrade");
        return;
      }
      setActionError(apiErr?.message ?? "Couldn't complete that purchase.");
    } finally {
      setBuying(null);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="skeleton" style={{ height: 24, width: 190, marginBottom: 20 }} />
        <SkeletonRows rows={4} height={78} />
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <ErrorState message={error ?? "Couldn't load the shop."} onRetry={reload} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <button
        onClick={() => navigate("/game")}
        className="back-link"
        style={{ background: "none", border: "none", cursor: "pointer", marginBottom: 14 }}
      >
        <ArrowLeftIcon cls="icon-sm" /> Back to garden
      </button>
      <div className="eyebrow">Sprout's shop</div>
      <h1 className="section-title">Spend your Garden XP</h1>

      <InlineError message={actionError} />
      <InlineNotice message={notice} />

      <div className="card" style={{ textAlign: "center", padding: "24px 20px", margin: "20px 0" }}>
        <span className="xp-chip" style={{ fontSize: 14, padding: "8px 16px" }}>
          <LeafIcon cls="icon-sm" /> {data.gardenXp} Garden XP
        </span>
        <p style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 10 }}>
          Earned in Leaf Match — studying grows your companion instead.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data.items.map((item) => {
          const tone = TONES[item.slot] ?? TONES.companion;
          const disabled =
            buying !== null || item.owned || (!item.affordable && !item.locked);

          return (
            <div key={item.key} className="quest-card">
              <div className="quest-icon" style={{ background: tone.bg, color: tone.fg }}>
                {ICONS[item.icon] ?? <GemIcon cls="icon" />}
              </div>
              <div className="quest-meta">
                <div className="quest-title">
                  {item.name}
                  {item.premiumOnly && (
                    <span className="pill pill-coral" style={{ marginLeft: 8, fontSize: 10.5 }}>
                      Pro
                    </span>
                  )}
                </div>
                <div className="quest-sub">{item.description}</div>
              </div>
              <button
                className={item.owned ? "btn btn-ghost" : "btn btn-primary"}
                style={{ fontSize: 12, padding: "8px 14px", boxShadow: item.owned ? undefined : "none" }}
                onClick={() => buy(item)}
                disabled={disabled}
              >
                {item.owned ? (
                  <>
                    <CheckIcon cls="icon-sm" /> Owned
                  </>
                ) : item.locked ? (
                  <>
                    <LockIcon cls="icon-sm" /> Pro
                  </>
                ) : buying === item.key ? (
                  "Buying…"
                ) : (
                  `${item.price} XP`
                )}
              </button>
            </div>
          );
        })}
      </div>

      <button
        className="btn btn-ghost btn-block"
        style={{ marginTop: 22 }}
        onClick={() => navigate("/profile")}
      >
        Done
      </button>
    </AppShell>
  );
}
