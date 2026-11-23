import { useEffect, useMemo, useState } from "react";
import { Dex } from "@pkmn/dex";
import { TeamValidator } from "@pkmn/sim";

declare const __BUILD_NUMBER__: string;
type BattleType = "PvP" | "PvE";
type BattleMode = "Auto" | "Manual";
type Page = "Overview" | "Team Builder" | "Simulator" | "Matchup Analysis";
const generations = Array.from({ length: 9 }, (_, i) => i + 1);
const tiers = ["Anything Goes", "Ubers", "OU", "UU", "RU", "NU", "PU", "ZU", "Little Cup", "VGC", "Custom"];
const pveFacilities: Record<number, string> = { 3: "Battle Tower", 4: "Battle Tower", 5: "Battle Subway", 6: "Battle Maison", 7: "Battle Tree", 8: "Battle Tower", 9: "Academy Ace Tournament" };
type Settings = { generation: number; battleType: BattleType; tier: string; mode: BattleMode };
const defaults: Settings = { generation: 9, battleType: "PvP", tier: "OU", mode: "Auto" };
function normalizeSettings(s: Settings): Settings { return s.battleType === "PvE" && s.generation < 3 ? { ...s, generation: 3 } : s; }
function readSettings(): Settings { try { const saved = localStorage.getItem("battle-lab-settings"); return saved ? normalizeSettings({ ...defaults, ...JSON.parse(saved) }) : defaults; } catch { return defaults; } }

type PokemonBuild = {
  id: string; name: string; label: string; nickname: string; level: number; gender: string; ability: string; nature: string; item: string;
  moves: string[]; evs: Record<string, number>; ivs: Record<string, number>;
};
type TeamSlot = { id: string; builds: PokemonBuild[]; activeBuildId: string };
type Team = { id: string; name: string; slots: TeamSlot[]; updatedAt: string };
const statNames = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
const natures = ["Hardy","Lonely","Brave","Adamant","Naughty","Bold","Docile","Relaxed","Impish","Lax","Timid","Hasty","Serious","Jolly","Naive","Modest","Mild","Quiet","Bashful","Rash","Calm","Gentle","Sassy","Careful","Quirky"];
const uid = () => crypto.randomUUID();
const statLabels: Record<string, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
function newBuild(name = ""): PokemonBuild {
  return { id: uid(), name, label: "", nickname: "", level: 100, gender: "", ability: "", nature: "Hardy", item: "", moves: ["","","",""], evs: { HP:0, Atk:0, Def:0, SpA:0, SpD:0, Spe:0 }, ivs: { HP:31, Atk:31, Def:31, SpA:31, SpD:31, Spe:31 } };
}
function readTeams(): Team[] { try { return JSON.parse(localStorage.getItem("battle-lab-teams") || "[]"); } catch { return []; } }
function activeBuild(slot: TeamSlot) { return slot.builds.find(b => b.id === slot.activeBuildId) || slot.builds[0]; }

export default function App() {
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [activePage, setActivePage] = useState<Page>("Overview");
  const [teams, setTeams] = useState<Team[]>(readTeams);
  const [activeTeamId, setActiveTeamId] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [speciesDropdownOpen, setSpeciesDropdownOpen] = useState(false);
  useEffect(() => { localStorage.setItem("battle-lab-settings", JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem("battle-lab-teams", JSON.stringify(teams)); }, [teams]);
  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(s => normalizeSettings({ ...s, [key]: value }));
  const activeTeam = teams.find(t => t.id === activeTeamId) || teams[0];
  const selectedSlot = activeTeam?.slots.find(s => s.id === selectedSlotId) || activeTeam?.slots[0];
  const selectedBuild = selectedSlot ? activeBuild(selectedSlot) : undefined;
  const generationDex = useMemo(() => Dex.forGen(settings.generation), [settings.generation]);
  const speciesOptions = useMemo(() => generationDex.species.all().filter(p => p.exists && !p.isNonstandard).sort((a,b) => a.name.localeCompare(b.name)), [generationDex]);
  const moveOptions = useMemo(() => generationDex.moves.all().filter(m => m.exists && !m.isNonstandard).sort((a,b) => a.name.localeCompare(b.name)), [generationDex]);
  const abilityOptions = useMemo(() => generationDex.abilities.all().filter(a => a.exists && !a.isNonstandard).sort((a,b) => a.name.localeCompare(b.name)), [generationDex]);
  const itemOptions = useMemo(() => generationDex.items.all().filter(i => i.exists && !i.isNonstandard).sort((a,b) => a.name.localeCompare(b.name)), [generationDex]);
  const selectedSpecies = selectedBuild ? speciesOptions.find(p => p.name.toLowerCase() === selectedBuild.name.trim().toLowerCase()) : undefined;
  const filteredSpeciesOptions = useMemo(() => { const query = selectedBuild?.name.trim().toLowerCase() || ""; return (query ? speciesOptions.filter(p => p.name.toLowerCase().includes(query)) : speciesOptions).slice(0, 80); }, [speciesOptions, selectedBuild?.name]);
  const legality = useMemo(() => {
    if (!activeTeam) return { status: "No team", messages: [] as string[] };
    const sets = activeTeam.slots.map(slot => activeBuild(slot)).filter(build => build.name.trim()).map(build => ({
      name: build.nickname || build.name,
      species: build.name,
      level: build.level,
      ability: build.ability,
      item: build.item,
      nature: build.nature,
      gender: build.gender || undefined,
      moves: build.moves.filter(Boolean),
      evs: { hp: build.evs.HP, atk: build.evs.Atk, def: build.evs.Def, spa: build.evs.SpA, spd: build.evs.SpD, spe: build.evs.Spe },
      ivs: { hp: build.ivs.HP, atk: build.ivs.Atk, def: build.ivs.Def, spa: build.ivs.SpA, spd: build.ivs.SpD, spe: build.ivs.Spe },
    }));
    if (!sets.length) return { status: "Incomplete", messages: ["Add at least one Pokémon to check the team."] };
    const tierIds: Record<string, string> = { "Anything Goes": "ag", "Ubers": "ubers", "OU": "ou", "UU": "uu", "RU": "ru", "NU": "nu", "PU": "pu", "ZU": "zu", "Little Cup": "lc" };
    const format = settings.battleType === "PvE" ? `gen${settings.generation}customgame` : settings.tier === "Custom" ? `gen${settings.generation}customgame` : settings.tier === "VGC" ? "" : `gen${settings.generation}${tierIds[settings.tier] || ""}`;
    if (!format) return { status: "Unsupported format", messages: ["VGC format rules are not configured yet."] };
    try {
      const problems = TeamValidator.get(format).validateTeam(sets as any) || [];
      return problems.length ? { status: "Illegal", messages: problems } : { status: "Legal", messages: ["No legality problems found for this format."] };
    } catch {
      return { status: "Unavailable", messages: [`The ${format} validator format is not included in the current ruleset data.`] };
    }
  }, [activeTeam, settings.generation, settings.battleType, settings.tier]);
  const speciesAbilities = selectedSpecies ? Object.values(selectedSpecies.abilities).filter(Boolean) : [];
  const patchTeam = (teamId: string, updater: (team: Team) => Team) => setTeams(all => all.map(t => t.id === teamId ? { ...updater(t), updatedAt: new Date().toISOString() } : t));
  const createTeam = () => {
    const team: Team = { id: uid(), name: "New Team", slots: [], updatedAt: new Date().toISOString() };
    setTeams(all => [...all, team]); setActiveTeamId(team.id); setSelectedSlotId("");
  };
  const addPokemon = () => {
    if (!activeTeam || activeTeam.slots.length >= 6) return;
    const build = newBuild();
    const slot: TeamSlot = { id: uid(), builds: [build], activeBuildId: build.id };
    patchTeam(activeTeam.id, t => ({ ...t, slots: [...t.slots, slot] }));
    setSelectedSlotId(slot.id);
  };
  const patchBuild = (patch: Partial<PokemonBuild>) => {
    if (!activeTeam || !selectedSlot || !selectedBuild) return;
    patchTeam(activeTeam.id, t => ({ ...t, slots: t.slots.map(s => s.id !== selectedSlot.id ? s : { ...s, builds: s.builds.map(b => b.id === selectedBuild.id ? { ...b, ...patch } : b) }) }));
  };
  const createBuildVariant = () => {
    if (!activeTeam || !selectedSlot || !selectedBuild) return;
    const variant = { ...selectedBuild, id: uid(), name: selectedBuild.name, label: selectedBuild.label ? selectedBuild.label + " copy" : "Variant " + (selectedSlot.builds.length + 1), moves: [...selectedBuild.moves], evs: { ...selectedBuild.evs }, ivs: { ...selectedBuild.ivs } };
    patchTeam(activeTeam.id, t => ({ ...t, slots: t.slots.map(s => s.id === selectedSlot.id ? { ...s, builds: [...s.builds, variant], activeBuildId: variant.id } : s) }));
  };
  const deleteSelectedBuild = () => {
    if (!activeTeam || !selectedSlot || !selectedBuild || selectedSlot.builds.length < 2) return;
    patchTeam(activeTeam.id, t => ({ ...t, slots: t.slots.map(s => {
      if (s.id !== selectedSlot.id) return s;
      const builds = s.builds.filter(b => b.id !== selectedBuild.id);
      return { ...s, builds, activeBuildId: builds[0].id };
    }) }));
  };
  const removeSlot = (slotId: string) => {
    if (!activeTeam) return;
    patchTeam(activeTeam.id, t => ({ ...t, slots: t.slots.filter(s => s.id !== slotId) }));
    if (selectedSlotId === slotId) setSelectedSlotId("");
  };
  const renameTeam = (name: string) => { if (activeTeam) patchTeam(activeTeam.id, t => ({ ...t, name })); };
  const deleteTeam = () => {
    if (!activeTeam || !window.confirm("Delete this team and all its builds?")) return;
    const remaining = teams.filter(t => t.id !== activeTeam.id);
    setTeams(remaining); setActiveTeamId(remaining[0]?.id || ""); setSelectedSlotId("");
  };
  const exportTeam = () => {
    if (!activeTeam) return;
    const blob = new Blob([JSON.stringify(activeTeam, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = activeTeam.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".json"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">P</div><div><strong>Pokémon Battle Lab</strong><span>TEAM TESTING SUITE</span></div></div>
        <nav aria-label="Main navigation">
          {(["Overview", "Team Builder", "Simulator", "Matchup Analysis"] as Page[]).map(page => <button className={activePage === page ? "nav-item active" : "nav-item"} key={page} onClick={() => setActivePage(page)}><span className="nav-dot" />{page}</button>)}
        </nav>
        <div className="sidebar-note"><span className="status-dot" /><span>Local workspace</span></div>
      </aside>
      <section className="main-content">
        <header className="topbar"><div><div className="eyebrow">POKÉMON TEAM TESTING</div><h1>{activePage}</h1></div><div className="topbar-tag">BUILD <span>{__BUILD_NUMBER__}</span></div></header>
        {activePage === "Overview" && <>
          <section className="intro"><div><div className="eyebrow">SIMULATION SETUP</div><h2>Configure your ruleset.</h2><p>Choose a generation and battle environment. Your settings are saved on this device.</p></div><div className="intro-symbol" aria-hidden="true">◈</div></section>
          <section className="panel setup-panel">
            <div className="panel-heading"><div><span className="eyebrow">01 / CONFIGURATION</span><h3>Battle environment</h3></div><span className="saved-indicator"><span className="status-dot" /> Settings saved locally</span></div>
            <div className="field-grid">
              <label className="field"><span>Generation</span><select value={settings.generation} onChange={e => updateSetting("generation", Number(e.target.value))}>{generations.map(g => <option value={g} key={g} disabled={settings.battleType === "PvE" && g < 3}>Generation {g}</option>)}</select></label>
              <fieldset className="field battle-type-field"><legend>Battle type</legend><div className="segmented">{(["PvP","PvE"] as BattleType[]).map(type => <button type="button" key={type} className={settings.battleType === type ? "selected" : ""} aria-pressed={settings.battleType === type} onClick={() => updateSetting("battleType", type)}>{type}</button>)}</div></fieldset>
              {settings.battleType === "PvP" ? <label className="field conditional-field"><span>PvP tier</span><select value={settings.tier} onChange={e => updateSetting("tier", e.target.value)}>{tiers.map(t => <option key={t}>{t}</option>)}</select></label> : <div className="field conditional-field"><span>PvE facility</span><div className="derived-value">{pveFacilities[settings.generation] || "No facility configured"}</div></div>}
            </div>
            <div className="config-summary"><span className="summary-label">ACTIVE RULESET</span><strong>Gen {settings.generation} · {settings.battleType === "PvP" ? settings.tier : pveFacilities[settings.generation]}</strong><span className="summary-copy">The selected ruleset will govern legality checks and battle mechanics once the engine is connected.</span></div>
          </section>
          <section className="lower-grid">
            <section className="panel mode-panel"><div className="panel-heading"><div><span className="eyebrow">02 / CONTROL</span><h3>Battle control</h3></div></div><p className="panel-description">Choose how decisions are made during a simulation.</p><div className="mode-options">{(["Auto","Manual"] as BattleMode[]).map(mode => <button type="button" className={settings.mode === mode ? "mode-option chosen" : "mode-option"} key={mode} onClick={() => updateSetting("mode", mode)}><span className="mode-icon">{mode === "Auto" ? "↻" : "⌁"}</span><span><strong>{mode}</strong><small>{mode === "Auto" ? "AI controls decisions" : "You control decisions"}</small></span><span className="radio-mark">{settings.mode === mode ? "●" : "○"}</span></button>)}</div><p className="hint">Auto / Manual switching will be available during live battles without resetting battle state.</p></section>
            <section className="panel roadmap-panel"><div className="panel-heading"><div><span className="eyebrow">03 / WORKSPACE</span><h3>Build status</h3></div><span className="build-version">0.2.0</span></div><div className="roadmap-list"><div className="roadmap-row done"><span>✓</span><div><strong>Responsive app foundation</strong><small>Desktop and mobile layout</small></div><em>Ready</em></div><div className="roadmap-row done"><span>✓</span><div><strong>Ruleset configuration</strong><small>Generation, PvP tier and automatic PvE facility</small></div><em>Ready</em></div><div className="roadmap-row done"><span>✓</span><div><strong>Local team builder</strong><small>Six slots, set variants and browser storage</small></div><em>Ready</em></div><div className="roadmap-row"><span>3</span><div><strong>Legality analysis</strong><small>Generation-aware Showdown validation</small></div><em>Planned</em></div><div className="roadmap-row"><span>4</span><div><strong>Battle simulation</strong><small>Auto, Manual and matchup testing</small></div><em>Planned</em></div></div></section>
          </section>
        </>}
        {activePage === "Team Builder" && <>
          <section className="intro"><div><div className="eyebrow">LOCAL TEAM WORKSPACE</div><h2>Build and tune your teams.</h2><p>Teams and Pokémon sets save automatically in this browser. Each team supports six slots and multiple builds per Pokémon.</p></div></section>
          <div className="team-builder-layout">
            <section className="panel team-list-panel">
              <div className="panel-heading"><div><span className="eyebrow">YOUR TEAMS</span><h3>Team library</h3></div><button className="primary-button" onClick={createTeam}>+ New team</button></div>
              {teams.length === 0 ? <div className="empty-state"><strong>No teams yet</strong><p>Create a team to start adding Pokémon.</p></div> : <div className="team-list">{teams.map(team => <button key={team.id} className={activeTeam?.id === team.id ? "team-list-item current" : "team-list-item"} onClick={() => { setActiveTeamId(team.id); setSelectedSlotId(team.slots[0]?.id || ""); }}><span><strong>{team.name || "Untitled team"}</strong><small>{team.slots.length}/6 Pokémon</small></span><span className="team-arrow">›</span></button>)}</div>}
            </section>
            <section className="panel team-editor-panel">
              {!activeTeam ? <div className="empty-state"><strong>Select or create a team</strong><p>Your team editor will appear here.</p></div> : <>
                <div className="panel-heading team-title-row"><div><span className="eyebrow">TEAM EDITOR · {activeTeam.slots.length}/6 SLOTS</span><input className="team-name-input" aria-label="Team name" value={activeTeam.name} onChange={e => renameTeam(e.target.value)} /></div><div className="team-actions"><button className="secondary-button" onClick={exportTeam}>Export JSON</button><button className="danger-button" onClick={deleteTeam}>Delete</button></div></div>
                <div className="team-slots">{Array.from({length:6}, (_,i) => activeTeam.slots[i]).map((slot, index) => slot ? <div key={slot.id} className={selectedSlot?.id === slot.id ? "team-slot active-slot" : "team-slot"}><button className="slot-select" onClick={() => setSelectedSlotId(slot.id)}><span className="slot-number">{index+1}</span><span className="slot-name">{activeBuild(slot)?.name || "Empty Pokémon"}</span><small>{slot.builds.length} build{slot.builds.length === 1 ? "" : "s"}</small></button><button className="slot-remove" aria-label="Remove Pokémon slot" onClick={() => removeSlot(slot.id)}>×</button></div> : <div className="team-slot vacant" key={"empty-"+index}><span className="slot-number">{index+1}</span><span>Empty slot</span></div>)}</div>
                {activeTeam.slots.length < 6 && <button className="add-pokemon-button" onClick={addPokemon}>+ Add Pokémon</button>}
                {selectedSlot && selectedBuild ? <div className="pokemon-editor">
                  <div className="editor-heading"><div><span className="eyebrow">POKÉMON SET</span><h3>{selectedBuild.name || "New Pokémon"}</h3></div><div className="team-actions"><select aria-label="Active build" value={selectedBuild.id} onChange={e => patchTeam(activeTeam.id, t => ({...t, slots:t.slots.map(s => s.id === selectedSlot.id ? {...s, activeBuildId:e.target.value} : s)}))}>{selectedSlot.builds.map((b,i) => <option value={b.id} key={b.id}>{b.label || "Build "+(i+1)}</option>)}</select><button className="secondary-button" onClick={createBuildVariant}>+ Variant</button><button className="danger-button" disabled={selectedSlot.builds.length < 2} onClick={deleteSelectedBuild}>Delete build</button></div></div>
                  <div className={`legality-note legality-${legality.status.toLowerCase().replace(/[^a-z]+/g,"-")}`}><span className="status-dot status-muted" /> Team legality: <strong>{legality.status}</strong><span>{legality.messages.join(" · ")}</span></div>
                  {selectedSpecies ? <div className="species-summary">
                    <div className="species-summary-top"><strong>{selectedSpecies.name}</strong><span>National Dex #{selectedSpecies.num}</span><span className="type-tags">{selectedSpecies.types.map(type => <em key={type} className={"type-tag type-"+type.toLowerCase()}>{type}</em>)}</span></div>
                    <div className="base-stat-row">{Object.entries(selectedSpecies.baseStats).map(([stat,value]) => <div key={stat}><small>{statLabels[stat] || stat}</small><strong>{value}</strong></div>)}<div className="bst-total"><small>BST</small><strong>{Object.values(selectedSpecies.baseStats).reduce((sum,value) => sum + value, 0)}</strong></div></div>
                    <div className="species-abilities"><small>Species abilities</small>{speciesAbilities.map(ability => <span key={ability}>{ability}</span>)}</div>
                  </div> : selectedBuild.name.trim() ? <div className="species-summary species-unmatched">No exact species match in Generation {settings.generation}. You can keep custom text for experimental sets.</div> : null}
                  <datalist id="pokemon-move-options">{moveOptions.map(m => <option value={m.name} key={m.name} />)}</datalist>
                  <datalist id="pokemon-ability-options">{(speciesAbilities.length ? speciesAbilities : abilityOptions.map(x => x.name)).map(name => <option value={name} key={name} />)}</datalist>
                  <datalist id="pokemon-item-options">{itemOptions.map(i => <option value={i.name} key={i.name} />)}</datalist>
                  <div className="pokemon-fields">
                    <div className="field species-picker-field"><label htmlFor="pokemon-species-search">Pokémon species</label><div className="species-picker-control"><input id="pokemon-species-search" role="combobox" aria-autocomplete="list" aria-expanded={speciesDropdownOpen} aria-controls="pokemon-species-list" autoComplete="off" value={selectedBuild.name} placeholder="Type to search Pokémon..." onFocus={() => setSpeciesDropdownOpen(true)} onChange={e => { const name = e.target.value; const match = speciesOptions.find(p => p.name.toLowerCase() === name.trim().toLowerCase()); patchBuild({name, gender: match?.gender === "N" || match?.gender === "M" || match?.gender === "F" ? match.gender : ""}); setSpeciesDropdownOpen(true); }} onKeyDown={e => { if (e.key === "Escape") setSpeciesDropdownOpen(false); if (e.key === "ArrowDown" && filteredSpeciesOptions.length) { e.preventDefault(); document.querySelector<HTMLButtonElement>("#pokemon-species-list button")?.focus(); } }} /><button type="button" className="species-dropdown-toggle" aria-label="Show Pokémon species" onClick={() => setSpeciesDropdownOpen(open => !open)}>▾</button></div>{speciesDropdownOpen && <div className="species-dropdown" id="pokemon-species-list" role="listbox">{filteredSpeciesOptions.length ? filteredSpeciesOptions.map(p => <button type="button" role="option" aria-selected={selectedBuild.name === p.name} key={p.name} onMouseDown={e => e.preventDefault()} onClick={() => { patchBuild({name:p.name, gender: p.gender === "N" || p.gender === "M" || p.gender === "F" ? p.gender : ""}); setSpeciesDropdownOpen(false); }}>{p.name}<small>{p.types.join(" / ")}</small></button>) : <div className="species-no-results">No matching Pokémon</div>}</div>}</div>
                    <label className="field"><span>Nickname</span><input value={selectedBuild.nickname} placeholder="Optional" onChange={e => patchBuild({nickname:e.target.value})} /></label>
                    <label className="field"><span>Level</span><input type="number" min="1" max="100" value={selectedBuild.level} onChange={e => patchBuild({level:Math.max(1,Math.min(100,Number(e.target.value)||1))})} /></label>
                    <label className="field"><span>Gender</span><select value={selectedSpecies?.gender === "N" ? "N" : selectedSpecies?.gender === "M" || selectedSpecies?.gender === "F" ? selectedSpecies.gender : selectedBuild.gender} disabled={selectedSpecies?.gender === "N" || selectedSpecies?.gender === "M" || selectedSpecies?.gender === "F"} onChange={e => patchBuild({gender:e.target.value})}><option value="">Auto / unspecified</option><option value="M">Male</option><option value="F">Female</option><option value="N">Genderless</option></select></label>
                    <label className="field"><span>Ability</span><input list="pokemon-ability-options" autoComplete="off" value={selectedBuild.ability} placeholder="Search abilities..." onChange={e => patchBuild({ability:e.target.value})} /></label>
                    <label className="field"><span>Nature</span><select value={selectedBuild.nature} onChange={e => patchBuild({nature:e.target.value})}>{natures.map(n => <option key={n}>{n}</option>)}</select></label>
                    <label className="field"><span>Held item</span><input list="pokemon-item-options" autoComplete="off" value={selectedBuild.item} placeholder="Search items..." onChange={e => patchBuild({item:e.target.value})} /></label>
                  </div>
                  <div className="editor-section"><div className="editor-section-title">Moves <small>{moveOptions.length} moves in Gen {settings.generation} data</small></div><div className="move-grid">{selectedBuild.moves.map((move,i) => <label className="field" key={i}><span>Move {i+1}</span><input list="pokemon-move-options" autoComplete="off" value={move} placeholder="Search moves..." onChange={e => patchBuild({moves:selectedBuild.moves.map((m,j) => j===i ? e.target.value : m)})} /></label>)}</div></div>
                  <div className="editor-section"><div className="editor-section-title">Effort values (EVs) <small>510 total maximum</small></div><div className="stat-grid">{statNames.map(stat => <label className="field" key={stat}><span>{stat}</span><input type="number" min="0" max="252" value={selectedBuild.evs[stat]} onChange={e => patchBuild({evs:{...selectedBuild.evs,[stat]:Math.max(0,Math.min(252,Number(e.target.value)||0))}})} /></label>)}</div><p className="stat-total">Total EVs: {Object.values(selectedBuild.evs).reduce((a,b)=>a+b,0)} / 510</p></div>
                  <div className="editor-section"><div className="editor-section-title">Individual values (IVs)</div><div className="stat-grid">{statNames.map(stat => <label className="field" key={stat}><span>{stat}</span><input type="number" min="0" max="31" value={selectedBuild.ivs[stat]} onChange={e => patchBuild({ivs:{...selectedBuild.ivs,[stat]:Math.max(0,Math.min(31,Number(e.target.value)||0))}})} /></label>)}</div></div>
                  <label className="field build-label-field"><span>Build label</span><input value={selectedBuild.label} placeholder="e.g. Choice Scarf, Defensive, Setup" onChange={e => patchBuild({label:e.target.value})} /></label>
                </div> : activeTeam.slots.length > 0 ? <div className="empty-state"><strong>Select a Pokémon slot</strong><p>Choose a filled slot above to edit its set.</p></div> : <div className="empty-state"><strong>Your team is empty</strong><p>Add a Pokémon to begin building your team.</p></div>}
              </>}
            </section>
          </div>
          <p className="hint team-storage-hint">Local-first storage: your teams remain on this device. Account sync and Google login will be connected separately.</p>
        </>}
        {activePage === "Simulator" && <section className="intro"><div><div className="eyebrow">BATTLE ENGINE</div><h2>Simulation is not connected yet.</h2><p>The team builder can prepare and store teams. Battle execution will follow once the rules engine is integrated.</p></div></section>}
        {activePage === "Matchup Analysis" && <section className="intro"><div><div className="eyebrow">ANALYSIS WORKSPACE</div><h2>Matchup analysis is not connected yet.</h2><p>Saved teams will become available here for matchup matrices and repeated simulations.</p></div></section>}
        <footer>Pokémon Battle Lab <span>·</span> An independent team analysis tool</footer>
      </section>
    </main>
  );
}
