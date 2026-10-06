"use client";

import { useState } from "react";
import { ArrowRight, Check, ChevronRight, ExternalLink, GitBranch, LoaderCircle, SearchCheck, TrendingUp } from "lucide-react";
import type { AuditRecord, StoredChain } from "@/lib/causal-chain";
import {
  conditionalProbability,
  conditionalReturn,
  defaultSelection,
  formatProbability,
  formatReturn,
  scenarioProbability,
  selectOutcome,
} from "@/lib/distribution";

const RETURN_NODE = "return";

type AuditProps = {
  /** Audits a link: a transition index, or transitions.length for the last link to returns. */
  onAudit: (link: number) => void;
  auditingLink: number | null;
  auditError: { link: number; message: string } | null;
  /** True while any request that would replace the chain is running. */
  busy: boolean;
};

export function ChainView({ chain, instrument, horizon, audit }: { chain: StoredChain; instrument: string; horizon: string; audit: AuditProps }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  // Selection is tied to the chain it was made on, so a new or refined chain starts from its default path.
  const [selection, setSelection] = useState<{ chain: StoredChain; ids: string[] } | null>(null);
  const ids = selection?.chain === chain ? selection.ids : defaultSelection(chain);
  const isDefault = ids.every((id, index) => id === defaultSelection(chain)[index]);

  const lastIndex = chain.events.length - 1;
  const lastEvent = chain.events[lastIndex];
  const lastOutcome = lastEvent.outcomes.find((outcome) => outcome.id === ids[lastIndex]);
  const selectedReturn = lastOutcome ? conditionalReturn(chain.returnModel, lastOutcome.id) : undefined;

  function choose(eventIndex: number, outcomeId: string) {
    setSelection({ chain, ids: selectOutcome(chain, ids, eventIndex, outcomeId) });
  }

  function linkControls(link: number, key: string, label: string, record: AuditRecord | undefined) {
    const running = audit.auditingLink === link;
    return (
      <>
        <div className="link-controls">
          <button className="relation-toggle" onClick={() => setExpanded(expanded === key ? null : key)}>
            <span><GitBranch size={13} /> {label}{record && <span className={`audit-badge ${record.adjusted ? "audit-badge-adjusted" : ""}`}>{record.adjusted ? "Audited · adjusted" : "Audited · no change"}</span>}</span>
            <ChevronRight size={14} className={expanded === key ? "chevron-open" : ""} />
          </button>
          <button
            className="audit-button"
            onClick={() => { setExpanded(key); audit.onAudit(link); }}
            disabled={audit.busy}
            title="Research this connection in more depth, with sources, and adjust it if the evidence calls for it"
          >
            {running ? <><LoaderCircle className="spin" size={12} /> Auditing…</> : <><SearchCheck size={12} /> {record ? "Audit again" : "Audit this connection"}</>}
          </button>
        </div>
        {audit.auditError?.link === link && <p className="error-message" role="alert">{audit.auditError.message}</p>}
      </>
    );
  }

  return (
    <>
      <div className="selection-bar">
        <span>Click an outcome to condition on it. Later events switch to their most likely continuation.</span>
        {!isDefault && <button className="selection-reset" onClick={() => setSelection(null)}>Reset to most likely path</button>}
      </div>
      <div className="chain-flow">
        {chain.events.map((eventItem, index) => {
          const transition = index > 0 ? chain.transitions[index - 1] : undefined;
          const sourceEvent = index > 0 ? chain.events[index - 1] : undefined;
          const sourceColumn = sourceEvent ? sourceEvent.outcomes.findIndex((outcome) => outcome.id === ids[index - 1]) : -1;
          const selectable = index > 0;
          return (
            <div className="chain-step-wrap" key={eventItem.id}>
              <article className={`chain-node ${index === 0 ? "node-origin" : ""}`}>
                <div className="node-top">
                  <span className="node-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="node-type">{index === 0 ? "HYPOTHESIS" : "INTERMEDIATE EVENT"}</span>
                  <span className="node-check"><Check size={12} /></span>
                </div>
                <h3>{eventItem.title}</h3>
                <div className="outcome-list">
                    {eventItem.outcomes.map((outcome) => {
                      const isSelected = ids[index] === outcome.id;
                      const probability = index > 0 ? conditionalProbability(chain, ids, index, outcome.id) : undefined;
                      const content = (
                        <>
                          <span className="outcome-bullet" />
                          <div className="outcome-text"><strong>{outcome.label}</strong><span>{outcome.description}</span></div>
                          {probability !== undefined && <span className={`probability ${probability > 0.75 ? "probability-high" : ""}`}>{Math.round(probability * 100)}%</span>}
                        </>
                      );
                      return selectable ? (
                        <button key={outcome.id} className={`outcome-row outcome-button ${isSelected ? "outcome-selected" : ""}`} onClick={() => choose(index, outcome.id)} aria-pressed={isSelected}>{content}</button>
                      ) : (
                        <div key={outcome.id} className={`outcome-row ${isSelected ? "outcome-selected" : ""}`}>{content}</div>
                      );
                    })}
                </div>
                {transition && sourceEvent && (
                  <>
                    {linkControls(index - 1, eventItem.id, "Why this connection?", transition.audit)}
                    {expanded === eventItem.id && (
                      <div className="relation-detail">
                        {transition.description}
                        <div className="matrix-wrap">
                          <table className="matrix-table">
                            <caption>Transition probabilities · rows: {eventItem.title} · columns: {sourceEvent.title}</caption>
                            <thead>
                              <tr><th scope="col">Next outcome ↓ / Current outcome →</th>{sourceEvent.outcomes.map((outcome, column) => <th scope="col" key={outcome.id} className={column === sourceColumn ? "matrix-selected" : ""}>{outcome.label}</th>)}</tr>
                            </thead>
                            <tbody>
                              {eventItem.outcomes.map((outcome, row) => (
                                <tr key={outcome.id}>
                                  <th scope="row">{outcome.label}</th>
                                  {sourceEvent.outcomes.map((source, column) => (
                                    <td key={source.id} className={column === sourceColumn ? "matrix-selected" : ""}>
                                      {Math.round((transition.matrix[row]?.[column] ?? 0) * 100)}%
                                      <PreviousValue current={transition.matrix[row]?.[column]} previous={transition.audit?.previousMatrix?.[row]?.[column]} format={(value) => `${Math.round(value * 100)}%`} />
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {transition.audit && <AuditPanel record={transition.audit} />}
                      </div>
                    )}
                  </>
                )}
              </article>
              <ChainLink />
            </div>
          );
        })}
        <article className="chain-node node-final">
          <div className="node-top">
            <span className="node-index">{String(chain.events.length + 1).padStart(2, "0")}</span>
            <span className="node-type">EXPECTED RETURN</span>
            <span className="node-check"><TrendingUp size={12} /></span>
          </div>
          <h3>{instrument} over {horizon}</h3>
          <div className="final-summary">
            <div className="final-stat">
              <span className="final-label">EXPECTED RETURN</span>
              <strong className="final-value">{selectedReturn ? formatReturn(selectedReturn.expectedReturnPct) : "—"}</strong>
              <span className="final-caption">Given “{lastOutcome?.label}”{lastIndex > 0 && <> in {lastEvent.title}</>}.</span>
            </div>
            <div className="final-stat">
              <span className="final-label">SCENARIO PROBABILITY</span>
              <strong className="final-value final-probability">{formatProbability(scenarioProbability(chain, ids))}</strong>
              <span className="final-caption">Chance of this whole path: the product of the conditional probabilities along it.</span>
            </div>
          </div>
          {selectedReturn && <p className="return-explanation">{selectedReturn.explanation}</p>}
          {linkControls(chain.transitions.length, RETURN_NODE, lastEvent.outcomes.length > 1 ? "Expected return for each outcome" : "Why this return?", chain.returnModel.audit)}
          {expanded === RETURN_NODE && (
                <div className="relation-detail">
                  <div className="matrix-wrap">
                    <table className="matrix-table">
                      <caption>Expected return over {horizon}, conditional on {lastEvent.title}</caption>
                      <thead><tr><th scope="col">Outcome</th><th scope="col">Expected return</th><th scope="col">Why</th></tr></thead>
                      <tbody>
                        {lastEvent.outcomes.map((outcome) => {
                          const entry = conditionalReturn(chain.returnModel, outcome.id);
                          const entryIndex = entry ? chain.returnModel.conditionalReturns.indexOf(entry) : -1;
                          const selected = outcome.id === lastOutcome?.id ? "matrix-selected" : "";
                          return (
                            <tr key={outcome.id}>
                              <th scope="row" className={selected}>{outcome.label}</th>
                              <td className={selected}>
                                {entry ? formatReturn(entry.expectedReturnPct) : "—"}
                                <PreviousValue current={entry?.expectedReturnPct} previous={chain.returnModel.audit?.previousReturnsPct?.[entryIndex]} format={(value) => formatReturn(value)} />
                              </td>
                              <td className={`return-why ${selected}`}>{entry?.explanation}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {chain.returnModel.audit && <AuditPanel record={chain.returnModel.audit} />}
                </div>
              )}
        </article>
      </div>
    </>
  );
}

function ChainLink() {
  return <div className="chain-link"><span className="link-line" /><span className="link-arrow"><ArrowRight size={14} /></span><span className="link-line" /></div>;
}

/** Shows a value's pre-audit figure when the audit changed how it displays. */
function PreviousValue({ current, previous, format }: { current: number | undefined; previous: number | undefined; format: (value: number) => string }) {
  if (current === undefined || previous === undefined || format(current) === format(previous)) return null;
  return <span className="previous-value">was {format(previous)}</span>;
}

function AuditPanel({ record }: { record: AuditRecord }) {
  return (
    <div className="audit-panel">
      <span className="audit-heading"><SearchCheck size={12} /> AUDIT</span>
      <p className="audit-summary">{record.changeSummary}</p>
      {record.assessment.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph.trim()}</p>)}
      {record.sources.length > 0 ? (
        <ol className="audit-sources">
          {record.sources.map((source) => (
            <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url} <ExternalLink size={10} /></a></li>
          ))}
        </ol>
      ) : (
        <p className="audit-no-sources">No sources could be verified for this audit, so treat it as the model’s own reasoning.</p>
      )}
    </div>
  );
}
