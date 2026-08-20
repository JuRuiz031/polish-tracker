import { useMemo, useState } from 'react';
import {
  bestRated,
  countByBrand,
  countByColor,
  countByFinish,
  foldToTop,
  highlights,
  mostWorn,
  wearsByMonth,
  type Tally,
} from '../../domain/stats';
import { useStore } from '../../app/storeContext';
import { Chip, EmptyState, Swatch } from '../../ui/primitives';
import { BarList, Donut, MonthColumns } from '../../ui/charts';
import { assignHues } from '../../ui/chartPalette';
import { describeDays } from '../../ui/format';

/**
 * Stats — the optional, enjoyable screen.
 *
 * Nothing here is required to use the app, so it is allowed to be fun. What it is not
 * allowed to be is wrong: every number comes from domain/stats.ts, which is tested, so
 * a figure here and the same figure on the Log cannot disagree.
 *
 * Archived polishes are included on purpose. She owned them and wore them, and a
 * history that quietly deletes the bottles she finished is not her history.
 */

type Breakdown = 'color' | 'brand' | 'finish';

const BREAKDOWNS: { value: Breakdown; label: string }[] = [
  { value: 'color', label: 'Color' },
  { value: 'brand', label: 'Brand' },
  { value: 'finish', label: 'Finish' },
];

export function StatsScreen() {
  const { polishes, wears } = useStore();
  const [breakdown, setBreakdown] = useState<Breakdown>('color');

  const facts = useMemo(() => highlights(polishes, wears), [polishes, wears]);
  const months = useMemo(() => wearsByMonth(wears, 12), [wears]);
  const topWorn = useMemo(() => mostWorn(polishes, 6), [polishes]);
  const topRated = useMemo(() => bestRated(polishes, 5), [polishes]);

  const byColor = useMemo(() => countByColor(polishes), [polishes]);
  const byBrand = useMemo(() => countByBrand(polishes), [polishes]);
  const byFinish = useMemo(() => countByFinish(polishes), [polishes]);

  const current: Tally[] =
    breakdown === 'color' ? byColor : breakdown === 'brand' ? byBrand : byFinish;

  // Six is the readable ceiling for a donut; beyond it the slices stop being
  // comparable and the tail is folded into one honest "Other".
  const donutEntries = useMemo(() => foldToTop(current, 6), [current]);
  const total = current.reduce((sum, entry) => sum + entry.count, 0);

  /**
   * One hue map, shared by the donut and the expanded bar list.
   *
   * It is built from the top eight of the FULL ranking rather than from the donut's six,
   * for two reasons. The donut is capped at six segments for readability, but the bar
   * list has room to colour more — and eight is the palette's hard ceiling, past which
   * a hue would have to be reused and two brands would look like one. Building one map
   * for both is what stops them disagreeing: derived separately, the two lists differ in
   * length, so the same label could hash into a different free slot in each.
   */
  const hues = useMemo(
    () => assignHues(current.slice(0, 8).map((entry) => entry.label)),
    [current],
  );

  if (polishes.length === 0) {
    return (
      <div className="screen">
        <header className="screen__head">
          <h1 className="screen__title">Stats</h1>
        </header>
        <EmptyState title="Nothing to count yet">
          <p>Add a few polishes and log some manicures — the charts fill themselves in.</p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="screen__title">Stats</h1>
        <p className="screen__sub">A look at what you own and what you actually wear.</p>
      </header>

      {/* Headline numbers. Tiles rather than one-bar charts — the number IS the chart. */}
      <section className="factgrid" aria-label="Highlights">
        <Fact
          value={facts.favouriteBrand?.label ?? '—'}
          label="Most-owned brand"
          detail={facts.favouriteBrand ? `${facts.favouriteBrand.count} bottles` : undefined}
        />
        <Fact
          value={`${facts.neverWornPercent}%`}
          label="Never worn"
          detail={`${facts.neverWornCount} still waiting`}
        />
        <Fact
          value={facts.averageGapDays === null ? '—' : `${facts.averageGapDays}d`}
          label="Between manicures"
          detail="on average"
        />
        <Fact
          value={String(facts.longestStreakMonths)}
          label="Longest streak"
          detail={facts.longestStreakMonths === 1 ? 'month' : 'months in a row'}
        />
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="section-title">What the collection is made of</h2>
          <div className="chip-row" role="group" aria-label="Break down by">
            {BREAKDOWNS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                active={breakdown === option.value}
                onClick={() => setBreakdown(option.value)}
              />
            ))}
          </div>
        </div>

        <Donut
          entries={donutEntries}
          total={total}
          totalLabel="polishes"
          useOwnColors={breakdown === 'color'}
          hues={hues}
        />

        {/* The full ranking, unfolded — the donut shows the shape, this shows every row. */}
        {current.length > 6 && (
          <details className="panel__more">
            <summary>See all {current.length}</summary>
            <BarList
              entries={current}
              useOwnColors={breakdown === 'color'}
              colorful={breakdown !== 'color'}
              hues={hues}
            />
          </details>
        )}
      </section>

      <section className="panel">
        <h2 className="section-title">Manicures over the last year</h2>
        <p className="section-note">
          Empty months are left empty — a gap is worth seeing, not smoothing over.
        </p>
        <MonthColumns months={months} />
      </section>

      {topWorn.length > 0 && (
        <section className="panel">
          <h2 className="section-title">Most worn</h2>
          <BarList
            entries={topWorn.map((polish) => ({
              label: `${polish.brand} ${polish.name}`,
              count: polish.stats.times_worn,
            }))}
            unit="×"
          />
        </section>
      )}

      {topRated.length > 0 && (
        <section className="panel">
          <h2 className="section-title">Best rated</h2>
          <p className="section-note">
            Polishes worn at least twice, so one lucky manicure cannot top the list.
          </p>
          <ul className="rank">
            {topRated.map((polish) => (
              <li key={polish.id} className="rank__row">
                <Swatch hex={polish.swatch_hex} size="sm" />
                <span className="rank__name">
                  {polish.brand} {polish.name}
                </span>
                <span className="rank__value">{polish.stats.avg_rating}★</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {facts.mostWornPolish && (
        <section className="panel panel--quiet">
          <h2 className="section-title">Your most-reached-for bottle</h2>
          <div className="hero-polish">
            <Swatch hex={facts.mostWornPolish.swatch_hex} size="lg" />
            <div>
              <p className="hero-polish__brand">{facts.mostWornPolish.brand}</p>
              <p className="hero-polish__name">{facts.mostWornPolish.name}</p>
              <p className="hero-polish__meta">
                Worn {facts.mostWornPolish.stats.times_worn} times · last{' '}
                {describeDays(facts.mostWornPolish.stats.days_since)}
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Fact({
  value,
  label,
  detail,
}: {
  value: string;
  label: string;
  detail?: string;
}) {
  return (
    <div className="fact">
      <span className="fact__value">{value}</span>
      <span className="fact__label">{label}</span>
      {detail && <span className="fact__detail">{detail}</span>}
    </div>
  );
}
