// Feature flags (PATHWISE 2.0), read once from GET /api/config at boot.
// The server enforces every flag on its own routes — this context only
// decides what the UI renders, so a stale or failed fetch can never
// re-enable a frozen feature (defaults below match the server defaults).
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";

export interface Features {
  leafMatch: boolean;
  guestMode: boolean;
  /** Phase 16: creator studio stays invisible until the server says so. */
  userVideoPosting: boolean;
}

const DEFAULT_FEATURES: Features = {
  leafMatch: false,
  // Off until /api/config answers, so the button never shows against a
  // server that would refuse it.
  guestMode: false,
  userVideoPosting: false,
};

interface FeaturesState extends Features {
  /** False until /api/config has answered (or failed and fallen back). */
  loaded: boolean;
}

const FeaturesContext = createContext<FeaturesState>({
  ...DEFAULT_FEATURES,
  loaded: false,
});

export function FeaturesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FeaturesState>({
    ...DEFAULT_FEATURES,
    loaded: false,
  });

  useEffect(() => {
    let active = true;
    api
      .get<{ features: Partial<Features> }>("/api/config")
      .then((res) => {
        if (!active) return;
        setState({ ...DEFAULT_FEATURES, ...res.features, loaded: true });
      })
      .catch(() => {
        // Unreachable config is not fatal — fall back to the safe defaults.
        if (active) setState({ ...DEFAULT_FEATURES, loaded: true });
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <FeaturesContext.Provider value={state}>
      {children}
    </FeaturesContext.Provider>
  );
}

export function useFeatures(): FeaturesState {
  return useContext(FeaturesContext);
}
