import { useId } from 'react';
import {
  CartesianGrid,
  type DotItemDotProps,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import {
  formatAxisPounds,
  formatDayShort,
  formatInstantDateLondon,
  formatInstantLondon,
  formatIsoDate,
} from '../../format.js';
import { SERIES_COLOURS, seriesColour } from '../../lib/palette.js';
import { dateOfMs } from '../../lib/time.js';
import {
  coloursRepeat,
  type PlotLine,
  type PlotPoint,
  type RouteLine,
  type RoutePlotPoint,
} from './lines.js';

const H = COPY.historyView;
/** Line style backs up colour (no colour-only meaning): calendar dashed, unconfirmed offers dotted, offers solid. */
const DASH: Readonly<Record<PlotLine['kind'], string | null>> = {
  offer: null,
  calendar: '6 3',
  'offer-unconfirmed': '2 3',
};

const fetchValue = (p: PlotPoint) => p.pricePence;

/** True for a plotted fetch point whose price is stale (decision 54's flag from the api). */
function isStalePoint(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null && 'stale' in payload && payload.stale === true;
}

/**
 * A fetch-time dot: filled for a fresh price, hollow (white fill, coloured ring) for a stale one, so staleness shows
 * in the chart as well as the table (review ui M9; no meaning by colour alone). `data-stale` is what the tests read.
 */
function fetchDot(colour: string) {
  return function FetchDot(props: DotItemDotProps) {
    // why: a gap point has no price, so no fetch happened there; without cy a circle would sit at the plot's top edge
    // and read as a fresh fetch at the axis maximum.
    if (typeof props.cx !== 'number' || typeof props.cy !== 'number' || !Number.isFinite(props.cy))
      return null;
    const stale = isStalePoint(props.payload);
    return (
      <circle
        key={`${props.index}`}
        cx={props.cx}
        cy={props.cy}
        r={4}
        data-stale={stale}
        fill={stale ? '#ffffff' : colour}
        stroke={colour}
        strokeWidth={2}
      />
    );
  };
}
const routeValue = (p: RoutePlotPoint) => p.pricePence;

/**
 * Fetch-time history (spec §11 History): one line per provider and kind on a time axis in Europe/London. A line joins
 * only consecutive runs of the definition (plan decision 52); the caption says no price was fetched between two
 * points. No tooltip: with one data array per line on a time axis a shared tooltip cannot pair points reliably, and
 * the tables below are the record of every point with its provenance (PriceCell, decision 52). The price axis prints
 * pounds without "£", so the figure holds no fare outside PriceCell.
 */
export function HistoryChart({ lines, tablesId }: { lines: readonly PlotLine[]; tablesId: string }) {
  const captionId = useId();
  return (
    <figure aria-labelledby={captionId} aria-describedby={tablesId} className="flex flex-col gap-1">
      <figcaption id={captionId} className="font-medium">
        {H.fetchChartTitle}
      </figcaption>
      <p className="text-xs">{H.connectorNote}</p>
      {coloursRepeat(lines) ? (
        <p className="text-xs">{H.coloursRepeat(lines.length, SERIES_COLOURS.length)}</p>
      ) : null}
      <section aria-label={H.chartScroll(H.fetchChartTitle)} className="overflow-x-auto">
        <div className="h-80 min-w-[36rem]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart margin={{ top: 8, right: 16, bottom: 28, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                allowDuplicatedCategory={false}
                tickFormatter={(v: number) => formatInstantDateLondon(v)}
                label={{ value: H.xAxisFetched, position: 'insideBottom', offset: -16 }}
              />
              <YAxis
                tickFormatter={(v: number) => formatAxisPounds(v)}
                label={{ value: H.yAxis, angle: -90, position: 'insideLeft' }}
              />
              <Legend verticalAlign="top" />
              {lines.map((l) => {
                const dash = DASH[l.kind];
                return (
                  <Line
                    key={l.key}
                    data={l.points}
                    dataKey={fetchValue}
                    name={l.name}
                    type="linear"
                    connectNulls={false}
                    stroke={seriesColour(l.colour)}
                    {...(dash === null ? {} : { strokeDasharray: dash })}
                    dot={fetchDot(seriesColour(l.colour))}
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </figure>
  );
}

/**
 * The indicative route-level series in its own chart, price by travel date (plan decision 38): a different quantity
 * from the fetch-time lines, so never on their axis. Each series is named by its provider and cabin (decision 52).
 * Every point gets a dot, so a travel date between two missing dates still shows (review ui-r2-008).
 */
export function RouteChart({ lines, tablesId }: { lines: readonly RouteLine[]; tablesId: string }) {
  const captionId = useId();
  return (
    <figure aria-labelledby={captionId} aria-describedby={tablesId} className="flex flex-col gap-1">
      <figcaption id={captionId} className="font-medium">
        {H.routeChartTitle}
      </figcaption>
      <p className="text-xs">{H.routeChartNote}</p>
      <section aria-label={H.chartScroll(H.routeChartTitle)} className="overflow-x-auto">
        <div className="h-64 min-w-[36rem]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart margin={{ top: 8, right: 16, bottom: 28, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                allowDuplicatedCategory={false}
                tickFormatter={(v: number) => formatIsoDate(dateOfMs(v))}
                label={{ value: H.xAxisTravelDate, position: 'insideBottom', offset: -16 }}
              />
              <YAxis
                tickFormatter={(v: number) => formatAxisPounds(v)}
                label={{ value: H.yAxis, angle: -90, position: 'insideLeft' }}
              />
              <Legend verticalAlign="top" />
              {lines.map((l) => (
                <Line
                  key={l.key}
                  data={l.points}
                  dataKey={routeValue}
                  name={l.name}
                  type="linear"
                  connectNulls={false}
                  stroke={seriesColour(l.colour)}
                  strokeDasharray="1 2"
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </figure>
  );
}

type Priced = Extract<PlotPoint, { kind: 'price' }>;

/**
 * Every point of one fetch-time line, newest first, each price through PriceCell with its stale label, "cheapest of
 * the rows read" and its destination (spec §11); calendar points name their cheapest searched cell and flag a change of
 * cell; unconfirmed offers say the final step did not confirm the price.
 */
export function HistoryTable(props: {
  line: PlotLine;
  destination: string | undefined;
  notes: Partial<Record<string, string>>;
}) {
  const { line, destination, notes } = props;
  const points = line.points.filter((p): p is Priced => p.kind === 'price').reverse();
  return (
    <section aria-label={H.tableScroll(line.name)} className="max-h-64 overflow-auto">
      <table className="w-full text-xs">
        <caption className="text-left font-medium">{H.tableCaption(line.name)}</caption>
        <thead>
          <tr>
            <th scope="col">{H.whenColumn}</th>
            <th scope="col">{H.priceColumn}</th>
            <th scope="col">{H.detailColumn}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => {
            const dest = p.cell?.destination ?? destination;
            return (
              <tr key={p.t}>
                <td>{formatInstantLondon(p.t)}</td>
                <td>
                  <PriceBoundary>
                    <PriceCell
                      pricePence={p.pricePence}
                      provenance={p.provenance}
                      calendar={line.kind === 'calendar'}
                      stale={p.stale}
                      truncated={p.truncated}
                      unconfirmed={!p.priceConfirmed}
                      destination={dest}
                      destinationNote={dest === undefined ? null : (notes[dest] ?? null)}
                    />
                  </PriceBoundary>
                </td>
                <td>
                  {p.cell !== null ? (
                    <span className="block">
                      {H.cheapestCell(
                        p.cell.origin,
                        p.cell.destination,
                        formatDayShort(p.cell.departureDate),
                        formatDayShort(p.cell.returnDate),
                      )}
                    </span>
                  ) : null}
                  {p.cellChanged ? <span className="block font-medium">{H.cellChanged}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
