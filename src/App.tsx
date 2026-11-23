import { useEffect, useState } from "react";

declare const __BUILD_NUMBER__: string;

type BattleType = "PvP" | "PvE";
type BattleMode = "Auto" | "Manual";

const generations = Array.from({ length: 9 }, (_, index) => index + 1);
const tiers = [
  "Anything Goes", "Ubers", "OU", "UU", "RU", "NU", "PU", "ZU",
  "Little Cup", "VGC", "Custom"
];

// The PvE challenge is determined by generation; there is no facility selector.
const pveFacilities: Record<number, string> = {
  3: "Battle Tower",
  4: "Battle Tower",
  5: "Battle Subway",
  6: "Battle Maison",
  7: "Battle Tree",
  8: "Battle Tower",
  9: "Academy Ace Tournament"
};

type Settings = {
  generation: number;
  battleType: BattleType;
  tier: string;
  mode: BattleMode;
};

const defaults: Settings = {
  generation: 9,
  battleType: "PvP",
  tier: "OU",
  mode: "Auto"
};

function normalizeSettings(settings: Settings): Settings {
  if (settings.battleType === "PvE" && settings.generation < 3) {
    return { ...settings, generation: 3 };
  }
  return settings;
}

function readSettings(): Settings {
  try {
    const saved = localStorage.getItem("battle-lab-settings");
    return saved
      ? normalizeSettings({ ...defaults, ...JSON.parse(saved) })
      : defaults;
  } catch {
    return defaults;
  }
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [activePage, setActivePage] = useState("Overview");

  useEffect(() => {
    localStorage.setItem("battle-lab-settings", JSON.stringify(settings));
  }, [settings]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(current => normalizeSettings({ ...current, [key]: value }));
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div>
            <strong>Pokémon Battle Lab</strong>
            <span>TEAM TESTING SUITE</span>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {["Overview", "Team Builder", "Simulator", "Matchup Analysis"].map(page => (
            <button
              className={activePage === page ? "nav-item active" : "nav-item"}
              key={page}
              onClick={() => setActivePage(page)}
            >
              <span className="nav-dot" />
              {page}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" />
          <span>Local workspace</span>
        </div>
      </aside>

      <section className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">POKÉMON TEAM TESTING</div>
            <h1>{activePage}</h1>
          </div>
          <div className="topbar-tag">BUILD <span>{__BUILD_NUMBER__}</span></div>
        </header>

        <section className="intro">
          <div>
            <div className="eyebrow">SIMULATION SETUP</div>
            <h2>Configure your ruleset.</h2>
            <p>Choose a generation and battle environment. Your settings are saved on this device.</p>
          </div>
          <div className="intro-symbol" aria-hidden="true">◈</div>
        </section>

        <section className="panel setup-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">01 / CONFIGURATION</span>
              <h3>Battle environment</h3>
            </div>
            <span className="saved-indicator"><span className="status-dot" /> Settings saved locally</span>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>Generation</span>
              <select
                value={settings.generation}
                onChange={event => update("generation", Number(event.target.value))}
              >
                {generations.map(generation => (
                  <option
                    value={generation}
                    key={generation}
                    disabled={settings.battleType === "PvE" && generation < 3}
                  >
                    Generation {generation}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="field battle-type-field">
              <legend>Battle type</legend>
              <div className="segmented">
                {(["PvP", "PvE"] as BattleType[]).map(type => (
                  <button
                    type="button"
                    key={type}
                    className={settings.battleType === type ? "selected" : ""}
                    aria-pressed={settings.battleType === type}
                    onClick={() => update("battleType", type)}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </fieldset>

            {settings.battleType === "PvP" ? (
              <label className="field conditional-field">
                <span>PvP tier</span>
                <select value={settings.tier} onChange={event => update("tier", event.target.value)}>
                  {tiers.map(tier => <option key={tier}>{tier}</option>)}
                </select>
              </label>
            ) : (
              <div className="field conditional-field" aria-live="polite">
                <span>PvE facility</span>
                <div className="derived-value">{pveFacilities[settings.generation] ?? "No facility configured"}</div>
              </div>
            )}
          </div>

          <div className="config-summary">
            <span className="summary-label">ACTIVE RULESET</span>
            <strong>Gen {settings.generation} · {settings.battleType === "PvP" ? settings.tier : (pveFacilities[settings.generation] ?? "No facility configured")}</strong>
            <span className="summary-copy">The selected ruleset will govern legality checks and battle mechanics once the engine is connected.</span>
          </div>
        </section>

        <section className="lower-grid">
          <section className="panel mode-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">02 / CONTROL</span>
                <h3>Battle control</h3>
              </div>
            </div>
            <p className="panel-description">Choose how decisions are made during a simulation.</p>
            <div className="mode-options">
              {(["Auto", "Manual"] as BattleMode[]).map(mode => (
                <button
                  type="button"
                  className={settings.mode === mode ? "mode-option chosen" : "mode-option"}
                  key={mode}
                  onClick={() => update("mode", mode)}
                >
                  <span className="mode-icon">{mode === "Auto" ? "↻" : "⌁"}</span>
                  <span><strong>{mode}</strong><small>{mode === "Auto" ? "AI controls decisions" : "You control decisions"}</small></span>
                  <span className="radio-mark">{settings.mode === mode ? "●" : "○"}</span>
                </button>
              ))}
            </div>
            <p className="hint">Auto / Manual switching will be available during live battles without resetting battle state.</p>
          </section>

          <section className="panel roadmap-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">03 / WORKSPACE</span>
                <h3>Build status</h3>
              </div>
              <span className="build-version">0.1.0</span>
            </div>
            <div className="roadmap-list">
              <div className="roadmap-row done"><span>✓</span><div><strong>Responsive app foundation</strong><small>Desktop and mobile layout</small></div><em>Ready</em></div>
              <div className="roadmap-row done"><span>✓</span><div><strong>Ruleset configuration</strong><small>Generation, PvP tier and PvE facility</small></div><em>Ready</em></div>
              <div className="roadmap-row"><span>2</span><div><strong>Pokémon and team builder</strong><small>Sets, builds and saved teams</small></div><em>Next</em></div>
              <div className="roadmap-row"><span>3</span><div><strong>Legality analysis</strong><small>Showdown validation integration</small></div><em>Planned</em></div>
              <div className="roadmap-row"><span>4</span><div><strong>Battle simulation</strong><small>Auto, Manual and matchup testing</small></div><em>Planned</em></div>
            </div>
          </section>
        </section>

        <footer>Pokémon Battle Lab <span>·</span> An independent team analysis tool</footer>
      </section>
    </main>
  );
}