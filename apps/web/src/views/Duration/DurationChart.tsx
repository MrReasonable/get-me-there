import type { Iata } from '@gmt/core';
import { useId } from 'react';
import {
  Bar,
  BarChart,
  type BarShapeProps,
  CartesianGrid,
  Legend,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatAxisPounds, formatDayShort } from '../../format.js';
import { figureMarks } from '../../lib/marks.js';
import { seriesColour } from '../../lib/palette.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { barValue, type DurationData, type DurationRow, gapLabel, rowAt } from './data.js';

const D = COPY.durationView;

/**
 * One bar through Bar's `shape` prop (Recharts 3 deprecates Cell). A calendar bar is paler with a 2 px dashed outline
 * (the dash is its only non-colour cue, so it is not left at 1 px; review ui M8); a stale bar is faded with a heavy
 * black outline. `data-stale` is what the tests read.
 */
function BarRect(props: BarShapeProps & { stale: boolean; calendar: boolean; colour: string }) {
  const { stale, calendar, colour } = props;
  return (
    <Rectangle
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      fill={colour}
      fillOpacity={stale ? 0.3 : calendar ? 0.6 : 1}
      stroke={stale ? '#000000' : colour}
      strokeWidth={stale || calendar ? 2 : 1}
      {...(calendar ? { strokeDasharray: '4 2' } : {})}
      data-stale={stale ? 'true' : 'false'}
    />
  );
}

/**
 * Custom tooltip: the nights, then each series' minimum through PriceCell compact (plan decision 52: every fare in the
 * DOM, tooltips included, with "≈", stale, vendor age, destination, note and "cheapest of the rows read"), its n and
 * departure date, or its gap kind (spec §11 View C: n in the tooltip).
 */
export function DurationTooltip(props: {
  active?: boolean | undefined;
  label?: unknown;
  data: DurationData;
  notes: Partial<Record<Iata, string>>;
}) {
  const row = rowAt(props.data.rows, props.label);
  if (props.active !== true || row === undefined) return null;
  return (
    <div data-testid="duration-tooltip" className="rounded border bg-white p-2 text-xs shadow">
      <p className="font-medium">{D.nightsLabel(row.nights)}</p>
      <ul className="flex flex-col gap-1">
        {props.data.series.map((s) => {
          const c = row.cells[s.key];
          const p = c?.price ?? null;
          return (
            <li key={s.key}>
              <span>{p === null ? D.seriesLine(s.shortName, gapLabel(c, s.kind)) : s.shortName}</span>
              {p !== null && c !== undefined ? (
                <>
                  <PriceBoundary>
                    <PriceCell
                      compact
                      {...figureMarks(p)}
                      pricePence={p.pricePence}
                      provenance={p.provenance}
                      calendar={s.kind === 'calendar'}
                      stale={p.stale}
                      truncated={p.truncated}
                      destination={p.cell.destination}
                      destinationNote={props.notes[p.cell.destination] ?? null}
                    />
                  </PriceBoundary>
                  <span className="block">{D.tooltipDetail(c.n, formatDayShort(p.cell.departureDate))}</span>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Bars per nights with axis titles (nights, price in GBP), one series per basis and provider (spec §11 View C). A
 * missing value is a gap, never a zero bar; a nights value no series searched is starred on the axis; calendar series
 * are paler and dashed and a stale minimum is drawn faded with a heavy outline, so no meaning rests on colour alone.
 */
export function DurationChart(props: {
  data: DurationData;
  tableId: string;
  notes: Partial<Record<Iata, string>>;
}) {
  const { data, tableId, notes } = props;
  const captionId = useId();
  return (
    <figure aria-labelledby={captionId} aria-describedby={tableId} className="flex flex-col gap-1">
      <figcaption id={captionId} className="font-medium">
        {D.chartTitle}
      </figcaption>
      <p className="text-xs">{D.chartNote}</p>
      {/* why: ui-r1-010 — on a phone the bars keep a readable width and the chart scrolls sideways */}
      <section aria-label={D.chartScroll} className="overflow-x-auto">
        <div className="h-80 min-w-[36rem]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.rows} margin={{ top: 8, right: 16, bottom: 28, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="nights"
                tickFormatter={(v: number) =>
                  rowAt(data.rows, v)?.anySearched === false ? D.tickNotSearched(v) : String(v)
                }
                label={{ value: D.xAxis, position: 'insideBottom', offset: -16 }}
              />
              <YAxis
                tickFormatter={(v: number) => formatAxisPounds(v)}
                label={{ value: D.yAxis, angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                content={(p) => (
                  <DurationTooltip active={p.active} label={p.label} data={data} notes={notes} />
                )}
              />
              <Legend verticalAlign="top" />
              {data.series.map((s, i) => (
                <Bar
                  key={s.key}
                  name={s.name}
                  dataKey={(r: DurationRow) => barValue(r, s.key)}
                  fill={seriesColour(i)}
                  shape={(p: BarShapeProps) => (
                    <BarRect
                      {...p}
                      stale={data.rows[p.index]?.cells[s.key]?.price?.stale === true}
                      calendar={s.kind === 'calendar'}
                      colour={seriesColour(i)}
                    />
                  )}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </figure>
  );
}

/**
 * The same numbers as a table (the chart's text alternative): every price through PriceCell with its destination and
 * the operator's note (spec §11), n, the departure date of the minimum, each gap by kind; the nights value links to
 * Results filtered to that stay length (plan decision 38).
 */
export function DurationTable(props: {
  data: DurationData;
  id: string;
  notes: Partial<Record<Iata, string>>;
}) {
  const { data, id, notes } = props;
  return (
    <section aria-label={D.tableScroll} className="overflow-x-auto">
      <table id={id} className="mt-2 w-full text-xs">
        <caption className="text-left font-medium">{D.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-white">
              {D.xAxis}
            </th>
            {data.series.map((s) => (
              <th key={s.key} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => {
            const patch = { view: 'results', 'f.nights': `${r.nights}-${r.nights}` };
            return (
              <tr key={r.nights}>
                <th scope="row" className="sticky left-0 bg-white">
                  <a href={hrefWith(patch)} onClick={navigateTo(patch)} className="underline">
                    {D.nightsLink(r.nights)}
                  </a>
                </th>
                {data.series.map((s) => {
                  const c = r.cells[s.key];
                  if (c === undefined || c.price === null) return <td key={s.key}>{gapLabel(c, s.kind)}</td>;
                  const p = c.price;
                  return (
                    <td key={s.key}>
                      <PriceBoundary>
                        <PriceCell
                          {...figureMarks(p)}
                          pricePence={p.pricePence}
                          provenance={p.provenance}
                          calendar={s.kind === 'calendar'}
                          stale={p.stale}
                          truncated={p.truncated}
                          destination={p.cell.destination}
                          destinationNote={notes[p.cell.destination] ?? null}
                        />
                      </PriceBoundary>
                      <span className="block">{D.cellDetail(c.n, formatDayShort(p.cell.departureDate))}</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
