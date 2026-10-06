"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";
import type { StoredChain } from "@/lib/causal-chain";
import { formatProbability, formatReturn, niceStep, terminalDistribution } from "@/lib/distribution";

const HEIGHT = 230;
const MARGIN = { top: 26, right: 16, bottom: 34, left: 16 };
const SAMPLES = 240;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function TerminalDistributionView({ chain, horizon }: { chain: StoredChain; horizon: string }) {
  const distribution = useMemo(() => terminalDistribution(chain, horizon), [chain, horizon]);
  const [chartRef, width] = useWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);

  const { pdf, cdf, mean, sd, components, noiseSd } = distribution;
  const lastEvent = chain.events[chain.events.length - 1];
  const xMin = Math.min(mean - 3.5 * sd, ...components.map((c) => c.mean - 3 * noiseSd));
  const xMax = Math.max(mean + 3.5 * sd, ...components.map((c) => c.mean + 3 * noiseSd));
  const points = Array.from({ length: SAMPLES + 1 }, (_, index) => {
    const x = xMin + ((xMax - xMin) * index) / SAMPLES;
    return { x, y: pdf(x) };
  });
  const yMax = Math.max(...points.map((point) => point.y)) * 1.08;
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 50);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const sx = (x: number) => MARGIN.left + ((x - xMin) / (xMax - xMin)) * plotWidth;
  const sy = (y: number) => MARGIN.top + plotHeight - (y / yMax) * plotHeight;
  const baseline = sy(0);

  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${sx(point.x).toFixed(1)},${sy(point.y).toFixed(1)}`).join(" ");
  const area = `${line} L${sx(xMax).toFixed(1)},${baseline} L${sx(xMin).toFixed(1)},${baseline} Z`;

  const tickStep = niceStep((xMax - xMin) / Math.max(Math.floor(plotWidth / 70), 3));
  const ticks: number[] = [];
  for (let tick = Math.ceil(xMin / tickStep) * tickStep; tick <= xMax; tick += tickStep) ticks.push(Number(tick.toFixed(6)));
  const digits = tickStep < 1 ? 1 : 0;

  const hover = hoverX === null ? null : { x: hoverX, y: pdf(hoverX), below: cdf(hoverX) };
  const tooltipLeft = hover ? Math.min(Math.max(sx(hover.x) + 10, 0), width - 150) : 0;
  const maxBin = Math.max(...distribution.bins.map((bin) => bin.probability), 1e-9);
  const showMean = Math.abs(sx(mean) - sx(0)) > 2;

  function onPointerMove(event: React.PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    setHoverX(xMin + fraction * (xMax - xMin));
  }

  return (
    <section className="distribution-card" aria-labelledby="distribution-title">
      <div className="distribution-heading">
        <div>
          <span className="section-kicker"><BarChart3 size={12} /> TERMINAL DISTRIBUTION</span>
          <h3 id="distribution-title">Return over {horizon}, across all paths</h3>
        </div>
      </div>

      <div className="distribution-stats">
        <span><small>EXPECTED RETURN</small><strong>{formatReturn(mean)}</strong></span>
        <span><small>STD. DEVIATION</small><strong>{sd.toFixed(1)}%</strong></span>
        <span><small>CHANCE OF A GAIN</small><strong>{formatProbability(distribution.probabilityOfGain)}</strong></span>
        <span><small>5TH–95TH PERCENTILE</small><strong>{formatReturn(distribution.percentiles.p5)} to {formatReturn(distribution.percentiles.p95)}</strong></span>
      </div>

      <div className="distribution-chart" ref={chartRef}>
        <svg width={width} height={HEIGHT} role="img" aria-label={`Probability density of the return over ${horizon}. Mean ${formatReturn(mean)}, standard deviation ${sd.toFixed(1)}%.`}>
          {[0.25, 0.5, 0.75].map((fraction) => <line key={fraction} className="chart-grid" x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={MARGIN.top + plotHeight * (1 - fraction)} y2={MARGIN.top + plotHeight * (1 - fraction)} />)}
          <path d={area} className="chart-area" />
          <path d={line} className="chart-line" />
          <line className="chart-axis" x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={baseline} y2={baseline} />
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart-axis" x1={sx(tick)} x2={sx(tick)} y1={baseline} y2={baseline + 4} />
              <text className="chart-tick" x={sx(tick)} y={baseline + 16} textAnchor="middle">{formatReturn(tick, digits)}</text>
            </g>
          ))}
          {xMin < 0 && xMax > 0 && <line className="chart-zero" x1={sx(0)} x2={sx(0)} y1={MARGIN.top - 6} y2={baseline} />}
          {showMean && <>
            <line className="chart-mean" x1={sx(mean)} x2={sx(mean)} y1={MARGIN.top - 6} y2={baseline} />
            <text className="chart-mean-label" x={sx(mean)} y={MARGIN.top - 11} textAnchor={sx(mean) > width - 80 ? "end" : sx(mean) < 80 ? "start" : "middle"}>Mean {formatReturn(mean)}</text>
          </>}
          {components.map((component) => component.weight > 0.001 && (
            <circle key={component.outcomeId} className="chart-component" cx={sx(component.mean)} cy={baseline} r={4}><title>{`${component.label}: ${formatProbability(component.weight)} chance, centered at ${formatReturn(component.mean)}`}</title></circle>
          ))}
          {hover && <>
            <line className="chart-crosshair" x1={sx(hover.x)} x2={sx(hover.x)} y1={MARGIN.top} y2={baseline} />
            <circle className="chart-hover-dot" cx={sx(hover.x)} cy={sy(hover.y)} r={4.5} />
          </>}
          <rect x={MARGIN.left} y={0} width={plotWidth} height={baseline} fill="transparent" onPointerMove={onPointerMove} onPointerLeave={() => setHoverX(null)} />
        </svg>
        {hover && (
          <div className="chart-tooltip" style={{ left: tooltipLeft, top: 8 }}>
            <strong>{formatReturn(hover.x)} return</strong>
            <span>{formatProbability(hover.below)} chance of ending lower</span>
            <span>{formatProbability(1 - hover.below)} chance of ending higher</span>
          </div>
        )}
      </div>
      <p className="distribution-note">
        Dots on the axis mark the expected return given each outcome of “{lastEvent.title}”. Each outcome is weighted by its probability across all paths (the transition matrices multiplied together), with background noise from an annualized volatility of {distribution.annualizedVolatilityPct}%, which is {noiseSd.toFixed(1)}% over {horizon} (σ√T). {chain.returnModel.volatilityNote}
      </p>

      <div className="distribution-tables">
        <table className="matrix-table distribution-table">
          <caption>Probability by return range</caption>
          <thead><tr><th scope="col">Return range</th><th scope="col">Probability</th><th scope="col">Cumulative</th></tr></thead>
          <tbody>
            {distribution.bins.map((bin) => {
              const label = bin.from === null ? `Below ${formatReturn(bin.to!, digits)}` : bin.to === null ? `Above ${formatReturn(bin.from, digits)}` : `${formatReturn(bin.from, digits)} to ${formatReturn(bin.to, digits)}`;
              return (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td><span className="bin-cell"><span className="bin-bar" style={{ width: (48 * bin.probability) / maxBin }} />{formatProbability(bin.probability)}</span></td>
                  <td>{formatProbability(bin.cumulative)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <table className="matrix-table distribution-table">
          <caption>{lastEvent.title}: outcomes across all paths</caption>
          <thead><tr><th scope="col">Outcome</th><th scope="col">Probability</th><th scope="col">Expected return</th></tr></thead>
          <tbody>
            {components.map((component) => (
              <tr key={component.outcomeId}><th scope="row">{component.label}</th><td>{formatProbability(component.weight)}</td><td>{formatReturn(component.mean)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
