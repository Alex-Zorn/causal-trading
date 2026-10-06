"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  GitBranch,
  LoaderCircle,
  MessageSquareText,
  RotateCcw,
  Share2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Waves,
} from "lucide-react";
import { ChainView } from "@/components/chain-view";
import { TerminalDistributionView } from "@/components/terminal-distribution";
import type { CausalChain, StoredChain } from "@/lib/causal-chain";
import {
  decodeScenario,
  encodeScenario,
  loadSavedScenarios,
  storeSavedScenarios,
  type SavedScenario,
  type Scenario,
} from "@/lib/scenario";

const quickScenarios = [
  { event: "The Strait of Hormuz is reopened to commercial shipping", instrument: "Brent crude oil futures", icon: "◌" },
  { event: "A major central bank unexpectedly cuts interest rates", instrument: "Gold futures", icon: "◈" },
  { event: "A new tariff is imposed on semiconductor imports", instrument: "NASDAQ 100 futures", icon: "⌁" },
];
const instruments = ["Brent crude oil futures", "Gold futures", "S&P 500 futures", "EUR/USD", "10-year US Treasuries", "Bitcoin"];
const horizons = ["1 week", "1 month", "3 months", "6 months"];

type Suggestion = { instrument: string; rationale: string };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data as T;
}

function errorText(caught: unknown) {
  return caught instanceof Error ? caught.message : "Something went wrong. Please try again.";
}

export default function Home() {
  const [event, setEvent] = useState("");
  const [instrument, setInstrument] = useState("");
  const [horizon, setHorizon] = useState("1 month");
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [interpretedFrom, setInterpretedFrom] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState("");

  const [saved, setSaved] = useState<SavedScenario[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [shareCode, setShareCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [importCode, setImportCode] = useState("");
  const [importError, setImportError] = useState("");

  const [feedback, setFeedback] = useState("");
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [history, setHistory] = useState<StoredChain[]>([]);
  const [auditingLink, setAuditingLink] = useState<number | null>(null);
  const [auditError, setAuditError] = useState<{ link: number; message: string } | null>(null);

  useEffect(() => {
    // localStorage is only available after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(loadSavedScenarios());
  }, []);

  function showScenario(next: Scenario, options: { savedId?: string | null; interpretedFrom?: string | null } = {}) {
    setScenario(next);
    setEvent(next.event);
    setInstrument(next.instrument);
    setHorizon(next.horizon);
    setSavedId(options.savedId ?? null);
    setInterpretedFrom(options.interpretedFrom ?? null);
    setShareCode("");
    setFeedback("");
    setRefineError("");
    setChangeSummary("");
    setHistory([]);
    setAuditError(null);
    setError("");
  }

  async function analyze() {
    const submittedEvent = event.trim();
    const submittedInstrument = instrument.trim();
    if (submittedEvent.length < 8) {
      setError("Add a little more detail to your event to get started.");
      return;
    }
    if (!submittedInstrument) {
      setError("Enter a financial instrument, or ask for suggestions.");
      return;
    }
    setLoading(true);
    setError("");
    setScenario(null);
    try {
      const data = await postJson<{ instrument: string; chain: CausalChain }>("/api/causal-chain", { event: submittedEvent, instrument: submittedInstrument, horizon });
      const interpreted = data.instrument.toLowerCase() !== submittedInstrument.toLowerCase() ? submittedInstrument : null;
      showScenario({ event: submittedEvent, instrument: data.instrument, horizon, chain: data.chain }, { interpretedFrom: interpreted });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }

  async function suggestInstruments() {
    if (event.trim().length < 8) {
      setSuggestError("Describe the event first, then ask for suggestions.");
      return;
    }
    setSuggesting(true);
    setSuggestError("");
    setSuggestions([]);
    try {
      const data = await postJson<{ suggestions: Suggestion[] }>("/api/suggest-instruments", { event: event.trim(), horizon });
      setSuggestions(data.suggestions);
    } catch (caught) {
      setSuggestError(errorText(caught));
    } finally {
      setSuggesting(false);
    }
  }

  async function refine() {
    if (!scenario || feedback.trim().length < 3) return;
    setRefining(true);
    setRefineError("");
    try {
      const data = await postJson<{ chain: CausalChain; changeSummary: string }>("/api/refine", { ...scenario, feedback: feedback.trim() });
      setHistory((previous) => [...previous, scenario.chain]);
      setScenario({ ...scenario, chain: data.chain });
      setChangeSummary(data.changeSummary);
      setFeedback("");
      setSavedId(null);
      setShareCode("");
    } catch (caught) {
      setRefineError(errorText(caught));
    } finally {
      setRefining(false);
    }
  }

  async function auditLink(link: number) {
    if (!scenario) return;
    setAuditingLink(link);
    setAuditError(null);
    try {
      const data = await postJson<{ chain: StoredChain }>("/api/audit", { ...scenario, link });
      setHistory((previous) => [...previous, scenario.chain]);
      setScenario({ ...scenario, chain: data.chain });
      setChangeSummary("");
      setSavedId(null);
      setShareCode("");
    } catch (caught) {
      setAuditError({ link, message: errorText(caught) });
    } finally {
      setAuditingLink(null);
    }
  }

  function undoRefinement() {
    if (!scenario || history.length === 0) return;
    setScenario({ ...scenario, chain: history[history.length - 1] });
    setHistory(history.slice(0, -1));
    setChangeSummary("");
    setSavedId(null);
    setShareCode("");
  }

  function updateSaved(next: SavedScenario[]) {
    setSaved(next);
    if (!storeSavedScenarios(next)) setImportError("Couldn’t save to this browser’s storage.");
  }

  function saveCurrent() {
    if (!scenario) return;
    const entry: SavedScenario = { id: crypto.randomUUID(), savedAt: Date.now(), scenario };
    updateSaved([entry, ...saved]);
    setSavedId(entry.id);
  }

  function deleteSaved(id: string) {
    updateSaved(saved.filter((entry) => entry.id !== id));
    if (savedId === id) setSavedId(null);
  }

  async function share() {
    if (!scenario) return;
    const code = await encodeScenario(scenario);
    setShareCode(code);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  async function loadFromCode() {
    setImportError("");
    const decoded = await decodeScenario(importCode);
    if (!decoded) {
      setImportError("That doesn’t look like a valid scenario code.");
      return;
    }
    showScenario(decoded);
    setImportCode("");
    document.getElementById("analyzer")?.scrollIntoView({ behavior: "smooth" });
  }

  const result = scenario?.chain ?? null;
  const isQualifying = Boolean(result && result.highLikelihoodPath.length === result.events.length && result.highLikelihoodPath.slice(1).every((step) => step.probability > 0.75));
  const busy = loading || refining || auditingLink !== null;
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Causal Markets home">
          <span className="brand-mark"><Waves size={19} strokeWidth={2.3} /></span>
          <span className="brand-name">causal<span>markets</span></span>
        </a>
        <div className="topbar-right"><span className="live-dot" />Scenario research <span className="nav-divider" /><button className="help-button" aria-label="Help"><CircleHelp size={18} /></button></div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> MACRO INTELLIGENCE, MADE EXPLORABLE</div>
          <h1>See what moves<br />the <span>market.</span></h1>
          <p className="hero-description">Trace the ripple effects of global events.<br className="desktop-break" /> One cause at a time.</p>
        </div>
        <div className="hero-note"><div className="note-icon"><GitBranch size={17} /></div><div><span className="note-title">A clearer chain of thought</span><span className="note-description">From world events to market outcomes,<br />with every link in between.</span></div></div>
        <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-orbit orbit-three" /><div className="hero-star">✳</div>
      </section>

      <section className="workspace" id="analyzer">
        <div className="workspace-grid">
        <aside className="sidebar" aria-label="Saved scenarios">
          <div className="sidebar-card">
            <div className="sidebar-heading"><span className="section-kicker"><Bookmark size={12} /> SAVED SCENARIOS</span><span className="sidebar-count">{saved.length}</span></div>
            {saved.length === 0 ? <p className="sidebar-empty">Save a scenario map and it will appear here. Saved scenarios stay in this browser.</p> : <ul className="saved-list">{saved.map((entry) => <li key={entry.id} className={entry.id === savedId ? "saved-active" : ""}><button className="saved-load" onClick={() => showScenario(entry.scenario, { savedId: entry.id })} disabled={busy}><strong>{entry.scenario.event}</strong><span>{entry.scenario.instrument} · {entry.scenario.horizon}</span><small>{new Date(entry.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></button><button className="saved-delete" onClick={() => deleteSaved(entry.id)} aria-label={`Delete saved scenario: ${entry.scenario.event}`}><Trash2 size={12} /></button></li>)}</ul>}
          </div>
          <div className="sidebar-card">
            <div className="sidebar-heading"><span className="section-kicker"><Upload size={12} /> LOAD A SCENARIO CODE</span></div>
            <textarea className="code-input" rows={3} value={importCode} onChange={(e) => { setImportCode(e.target.value); setImportError(""); }} placeholder="Paste a code starting with cm1." aria-label="Scenario code" />
            <button className="sidebar-button" onClick={() => void loadFromCode()} disabled={!importCode.trim() || busy}>Load scenario</button>
            {importError && <p className="error-message" role="alert">{importError}</p>}
          </div>
        </aside>
        <div className="workspace-main">
        <div className="section-heading"><div><div className="section-kicker"><span className="kicker-dot" /> SCENARIO ANALYZER</div><h2>Start with a what if.</h2><p>Choose an event and an asset. We’ll map the possible connections.</p></div><div className="step-pill"><span>01</span><span className="pill-line" /><span>02</span><span className="pill-line" /><span>03</span></div></div>

        <div className="analysis-card">
          <div className="analysis-topline"><div className="analysis-label"><span className="sparkle-box"><Sparkles size={15} /></span> BUILD YOUR SCENARIO</div><span className="input-hint"><span className="green-dot" /> Takes about a minute</span></div>
          <label className="field-label" htmlFor="event-input">GLOBAL EVENT <span className="label-optional">BE SPECIFIC</span></label>
          <div className="event-input-wrap"><span className="input-prefix"><GitBranch size={18} /></span><textarea id="event-input" rows={2} maxLength={500} value={event} onChange={(e) => setEvent(e.target.value)} placeholder="e.g. The Strait of Hormuz is reopened to commercial shipping" /><span className="char-count">{event.length}/500</span></div>
          <div className="quick-row"><span className="quick-label">TRY A SCENARIO</span>{quickScenarios.map((scenario) => <button className="scenario-chip" key={scenario.event} onClick={() => { setEvent(scenario.event); setInstrument(scenario.instrument); }}>{scenario.icon} {scenario.event.length > 42 ? `${scenario.event.slice(0, 39)}…` : scenario.event}</button>)}</div>
          <div className="form-divider" />
          <label className="field-label" htmlFor="instrument-input">FINANCIAL INSTRUMENT <span className="label-optional">ANY TRADABLE ASSET</span></label>
          <div className="select-wrap instrument-wrap"><BarChart3 size={16} /><input id="instrument-input" maxLength={120} value={instrument} onChange={(e) => setInstrument(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void analyze(); }} placeholder="e.g. Brent crude oil futures, USD/JPY, NVDA" /></div>
          <div className="quick-row"><span className="quick-label">COMMON</span>{instruments.map((item) => <button className="scenario-chip" key={item} onClick={() => setInstrument(item)}>{item}</button>)}<button className="suggest-button" onClick={() => void suggestInstruments()} disabled={suggesting}>{suggesting ? <><LoaderCircle className="spin" size={12} /> Thinking…</> : <><Sparkles size={12} /> Suggest for this event</>}</button></div>
          {suggestError && <p className="error-message" role="alert">{suggestError}</p>}
          {suggestions.length > 0 && <div className="suggestions"><div className="suggestion-grid">{suggestions.map((item) => <button key={item.instrument} className={`suggestion-card ${instrument === item.instrument ? "suggestion-selected" : ""}`} onClick={() => setInstrument(item.instrument)}><strong>{item.instrument}</strong><span>{item.rationale}</span></button>)}</div><p className="suggestion-note"><CircleHelp size={12} /> Quick suggestions where a link looks plausible. The full analysis may still find no high-likelihood path.</p></div>}
          <div className="form-divider" />
          <div className="form-bottom"><div className="select-group horizon-group"><label className="field-label" htmlFor="horizon-select">TIME HORIZON</label><div className="select-wrap"><Clock3 size={16} /><select id="horizon-select" value={horizon} onChange={(e) => setHorizon(e.target.value)}>{horizons.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={15} className="select-chevron" /></div></div><button className="analyze-button" onClick={() => void analyze()} disabled={busy}>{loading ? <><LoaderCircle className="spin" size={16} /> Mapping outcomes…</> : <>Map the impact <ArrowRight size={16} /></>}</button></div>
          {error && <p className="error-message" role="alert">{error}</p>}
        </div>

        {loading && <div className="loading-panel"><div className="loading-orb"><GitBranch size={23} /></div><div><strong>Following the chain…</strong><span>Checking the instrument, then weighing the possible connections and their likelihoods.</span></div><div className="loading-bars"><i /><i /><i /></div></div>}

        {scenario && result && <section className="results-section" aria-live="polite"><div className="result-heading"><div><div className="section-kicker"><span className="kicker-dot" /> YOUR SCENARIO MAP</div><h2>Potential paths to impact.</h2></div><div className="result-actions"><button className="reset-button" onClick={saveCurrent} disabled={savedId !== null}>{savedId ? <><BookmarkCheck size={14} /> Saved</> : <><Bookmark size={14} /> Save</>}</button><button className="reset-button" onClick={() => void share()}>{copied ? <><Check size={14} /> Copied</> : <><Share2 size={14} /> Share code</>}</button><button className="reset-button" onClick={() => { setScenario(null); setError(""); }}><RotateCcw size={14} /> New scenario</button></div></div>
          <div className="scenario-summary"><span><strong>Event</strong>{scenario.event}</span><span><strong>Instrument</strong>{scenario.instrument}{interpretedFrom && <em> (interpreted from “{interpretedFrom}”)</em>}</span><span><strong>Horizon</strong>{scenario.horizon}</span></div>
          {shareCode && <div className="share-panel"><div className="share-top"><span>Anyone with this code can load the scenario in their sidebar.</span><button className="share-copy" onClick={() => void share()}><Copy size={12} /> {copied ? "Copied" : "Copy"}</button></div><textarea className="code-input" readOnly rows={3} value={shareCode} onFocus={(e) => e.target.select()} aria-label="Share code" /></div>}
          <div className={`path-status ${isQualifying ? "status-good" : "status-caution"}`}><span className="status-icon">{isQualifying ? <Check size={15} /> : <CircleHelp size={15} />}</span><div><strong>{isQualifying ? "A high-likelihood path was identified" : "No qualifying high-likelihood path identified"}</strong><span>{result.conclusion}</span></div></div>
          <ChainView chain={result} instrument={scenario.instrument} horizon={scenario.horizon} audit={{ onAudit: (link) => void auditLink(link), auditingLink, auditError, busy }} />
          <TerminalDistributionView chain={result} horizon={scenario.horizon} />
          <div className="refine-card">
            <label className="field-label" htmlFor="refine-input"><MessageSquareText size={12} /> REFINE THIS CHAIN</label>
            <div className="event-input-wrap"><textarea id="refine-input" rows={2} maxLength={1000} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="e.g. The oil step seems too confident. I'd put it at 60%, not 70%." disabled={refining} /></div>
            <div className="refine-actions">{history.length > 0 && <button className="reset-button" onClick={undoRefinement} disabled={refining}><Undo2 size={13} /> Undo last change</button>}<button className="analyze-button" onClick={() => void refine()} disabled={refining || feedback.trim().length < 3}>{refining ? <><LoaderCircle className="spin" size={14} /> Revising…</> : <>Apply feedback <ArrowRight size={14} /></>}</button></div>
            {changeSummary && <p className="change-summary"><Check size={12} /> {changeSummary}</p>}
            {refineError && <p className="error-message" role="alert">{refineError}</p>}
          </div>
          <div className="result-footer"><span><ShieldCheck size={15} /> Scenario analysis, not investment advice</span><span>Probabilities are conditional estimates · {scenario.horizon} horizon</span></div>
        </section>}
        </div>
        </div>
      </section>

      <footer className="footer" id="about"><a className="brand footer-brand" href="#top"><span className="brand-mark"><Waves size={16} /></span><span className="brand-name">causal<span>markets</span></span></a><span className="footer-center">A lens on what could be. Not a prediction of what will be.</span><span className="footer-right">© 2026 Causal Markets <span className="footer-separator">·</span> For research purposes only</span></footer>
      <div className="toast-space" aria-hidden="true" />
    </main>
  );
}
