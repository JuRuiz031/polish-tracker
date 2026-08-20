import { useMemo, useState } from 'react';
import { today } from '../../domain/date';
import { FINISHES, LONG_REST_DAYS, REST_DAY_OPTIONS } from '../../domain/enums';
import {
  ANY,
  DEFAULT_FILTERS,
  diagnose,
  eligiblePolishes,
  pick,
  untouched,
  type FilterName,
  type PickerFilters,
} from '../../domain/picker';
import type { PolishWithStats } from '../../domain/types';
import { useStore } from '../../app/storeContext';
import { Badge, Button, Chip, EmptyState, SelectField, Swatch } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import { colorOptions } from '../../ui/colorOptions';
import { describeDays } from '../../ui/format';
import { brandNames } from '../../domain/filters';
import { Wheel } from './Wheel';

/**
 * "What should I wear tonight?"
 *
 * The whole screen is arranged around one action. Filters used to occupy the entire
 * first phone screen, pushing Spin and its result below the fold — so the app's central
 * gesture required scrolling to reach and scrolling again to see the answer. They now
 * collapse into a single chip that states what it is doing ("14 days · Cream"), and the
 * button plus the reveal own the fold.
 *
 * The pick is held in component state and changes only when she presses Spin. That is
 * the fix for the spreadsheet's volatile RANDOM, which re-rolled on every edit and lost
 * the result the moment she logged the manicure — see domain/picker.ts.
 */
export function TonightScreen() {
  const { polishes, addWear, showToast } = useStore();
  const [filters, setFilters] = useState<PickerFilters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [choice, setChoice] = useState<PolishWithStats | null>(null);
  const [spinning, setSpinning] = useState(false);
  /** Decided before the wheel starts; promoted to `choice` when the wheel stops. */
  const [pending, setPending] = useState<PolishWithStats | null>(null);

  const todayIso = today();

  const pool = useMemo(
    () => eligiblePolishes(polishes, filters, todayIso),
    [polishes, filters, todayIso],
  );

  const diagnosis = useMemo(
    () => diagnose(polishes, filters, todayIso),
    [polishes, filters, todayIso],
  );

  const restingLongest = useMemo(() => untouched(polishes, 5), [polishes]);
  const brands = useMemo(() => brandNames(polishes), [polishes]);

  /**
   * Changing a filter clears the pick. A result that no longer satisfies the visible
   * filters silently contradicts the controls describing it.
   */
  function update<K extends keyof PickerFilters>(key: K, value: PickerFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setChoice(null);
    setPending(null);
  }

  /**
   * The winner is chosen HERE, by the tested domain function, before anything moves.
   * The wheel is then told which slice to land on. Reading the result off wherever the
   * wheel happened to stop would put the app's central rule inside an animation and
   * quietly decouple it from the eligibility logic.
   */
  function spin() {
    const next = pick(pool);
    if (!next) return;

    setChoice(null);
    setPending(next);

    // Someone who has asked the OS for less motion gets the answer, not the theatre.
    if (prefersReducedMotion()) {
      setChoice(next);
      setPending(null);
      return;
    }
    setSpinning(true);
  }

  /** Called by the wheel when it comes to rest. */
  function settle() {
    setSpinning(false);
    setChoice(pending);
    setPending(null);
  }

  async function wearThis(polish: PolishWithStats) {
    await addWear({
      polish_id: polish.id,
      worn_on: todayIso,
      rating: null,
      days_lasted: null,
      notes: null,
    });
    showToast({ message: `Logged ${polish.brand} ${polish.name} for today.` });
    setChoice(null);
  }

  const filterSummary = describeFilters(filters);
  const filtersActive = filterSummary !== null;

  return (
    <div className="screen screen--tonight">
      <header className="screen__head">
        <h1 className="screen__title">Tonight</h1>
        <p className="screen__sub">
          {pool.length === 0
            ? 'Nothing is ready to wear right now.'
            : `${pool.length} ${pool.length === 1 ? 'polish is' : 'polishes are'} ready to wear.`}
        </p>
      </header>

      <div className="picker-chips">
        <Chip
          label={filtersActive ? filterSummary : 'Narrow it down'}
          active={filtersActive}
          onClick={() => setFiltersOpen(true)}
        />
        {filtersActive && (
          <Button variant="quiet" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Clear
          </Button>
        )}
      </div>

      <div className="stage">
        {/* aria-live so the result is announced, not silently swapped in. */}
        <div className="picker-result" aria-live="polite">
          {/*
            Stays mounted for as long as there is a pool, even while the reveal card is
            what's showing. Unmounting it between spins (as this used to do, hiding it
            whenever a result was on screen) meant every spin after the first built a
            brand-new <svg>, and a transform transition armed on an element in the same
            tick it is inserted does not reliably animate — the wheel would jump straight
            to its resting angle instead of visibly spinning. Hiding it with opacity
            instead keeps the same element (and its rotation state) alive across spins.
          */}
          {pool.length > 0 && (
            <div
              className={`wheel-stage${!spinning && choice ? ' wheel-stage--hidden' : ''}`}
              aria-hidden={!spinning && choice ? true : undefined}
            >
              <Wheel pool={pool} winner={pending} spinning={spinning} onRest={settle} />
              <p className="stage__prompt">
                {spinning ? 'Choosing…' : 'Give it a spin and let it decide.'}
              </p>
            </div>
          )}

          {!spinning && choice && (
            <article className="reveal" key={choice.id}>
              <Swatch hex={choice.swatch_hex} size="lg" />
              <p className="reveal__brand">{choice.brand}</p>
              <h2 className="reveal__name">{choice.name}</h2>
              <p className="reveal__meta">
                {choice.finish} · {choice.color}
              </p>
              <p className="reveal__stats">
                {choice.stats.times_worn === 0
                  ? 'Never worn — this would be its first outing.'
                  : `Worn ${choice.stats.times_worn} ${choice.stats.times_worn === 1 ? 'time' : 'times'}, last ${describeDays(choice.stats.days_since)}.`}
              </p>
              {choice.notes && <p className="reveal__notes">{choice.notes}</p>}
              <div className="reveal__actions">
                <Button variant="primary" onClick={() => wearThis(choice)}>
                  <Icon name="check" />
                  I'm wearing this
                </Button>
                <Button variant="quiet" onClick={spin}>
                  Something else
                </Button>
              </div>
            </article>
          )}

          {!spinning && pool.length === 0 && (
            <EmptyPool
              collectionEmpty={diagnosis.collectionEmpty}
              suggestions={diagnosis.suggestions}
              onRelax={(filter) => {
                if (filter === 'restDays') update('restDays', 0);
                if (filter === 'finish') update('finish', ANY);
                if (filter === 'color') update('color', ANY);
                if (filter === 'brandQuery') update('brandQuery', '');
              }}
            />
          )}
        </div>

        {pool.length > 0 && (
          <div className="picker-action">
            <button type="button" className="spin" onClick={spin} disabled={spinning}>
              <Icon name="dice" />
              <span>{choice ? 'Spin again' : 'Spin'}</span>
            </button>
          </div>
        )}
      </div>

      {restingLongest.length > 0 && (
        <section className="untouched">
          <h2 className="section-title">Resting the longest</h2>
          <p className="section-note">
            The bottles you reach for least. This is the list the picker exists to shrink.
          </p>
          <ul className="untouched__list">
            {restingLongest.map((polish) => (
              <li key={polish.id} className="untouched__row">
                <Swatch hex={polish.swatch_hex} size="sm" />
                <span className="untouched__text">
                  <span className="untouched__name">
                    {polish.brand} {polish.name}
                  </span>
                  <span className="untouched__meta">{polish.finish}</span>
                </span>
                {polish.stats.times_worn === 0 ? (
                  <Badge tone="never-worn">Never worn</Badge>
                ) : (
                  <Badge tone={isLongRest(polish.stats.days_since) ? 'resting' : 'neutral'}>
                    {describeDays(polish.stats.days_since)}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Sheet open={filtersOpen} title="Narrow it down" onClose={() => setFiltersOpen(false)}>
        <div className="form">
          <SelectField
            label="Rested at least"
            value={String(filters.restDays)}
            onChange={(value) => update('restDays', Number(value))}
            options={REST_DAY_OPTIONS.map((days) => ({
              value: String(days),
              label: days === 0 ? 'Any — no rest needed' : `${days} days`,
            }))}
            hint="Polishes you have never worn are always offered, whatever this says."
          />
          <SelectField
            label="Finish"
            value={filters.finish}
            onChange={(value) => update('finish', value as PickerFilters['finish'])}
            options={[{ value: ANY, label: 'Any finish' }, ...FINISHES]}
          />
          <SelectField
            label="Color"
            value={filters.color}
            onChange={(value) => update('color', value as PickerFilters['color'])}
            options={colorOptions('Any color')}
          />
          {/* A dropdown of the brands she owns, rather than a text box she has to spell
              correctly. brandQuery stays a plain string and matchesBrand() still does a
              substring compare, so domain/picker.ts is untouched by this. */}
          <SelectField
            label="Brand"
            value={filters.brandQuery === '' ? ANY : filters.brandQuery}
            onChange={(value) => update('brandQuery', value === ANY ? '' : value)}
            options={[{ value: ANY, label: 'Any brand' }, ...brands]}
          />
          <div className="form__actions">
            <Button variant="primary" onClick={() => setFiltersOpen(false)}>
              Show {pool.length} {pool.length === 1 ? 'polish' : 'polishes'}
            </Button>
            <Button variant="quiet" onClick={() => setFilters(DEFAULT_FILTERS)}>
              Reset
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

/**
 * The empty state, which the brief is explicit must never be a bare "No results".
 * `diagnose()` works out which single filter is costing the most, and each suggestion
 * becomes a button that relaxes exactly that one.
 */
function EmptyPool({
  collectionEmpty,
  suggestions,
  onRelax,
}: {
  collectionEmpty: boolean;
  suggestions: { filter: FilterName; unlocks: number }[];
  onRelax: (filter: FilterName) => void;
}) {
  if (collectionEmpty) {
    return (
      <EmptyState title="Nothing in the collection yet">
        <p>Add a polish and this screen starts working.</p>
      </EmptyState>
    );
  }

  return (
    <EmptyState title="Nothing matches all of that">
      {suggestions.length === 0 ? (
        <p>Every polish is either resting or filtered out. Try widening more than one thing.</p>
      ) : (
        <>
          <p>Loosening one filter would help:</p>
          <ul className="empty__suggestions">
            {suggestions.map((suggestion) => (
              <li key={suggestion.filter}>
                <Button variant="secondary" onClick={() => onRelax(suggestion.filter)}>
                  {RELAX_LABEL[suggestion.filter]}
                  <span className="empty__count">
                    +{suggestion.unlocks} {suggestion.unlocks === 1 ? 'polish' : 'polishes'}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </EmptyState>
  );
}

const RELAX_LABEL: Record<FilterName, string> = {
  restDays: 'Ignore the rest period',
  finish: 'Any finish',
  color: 'Any color',
  brandQuery: 'Any brand',
};

/**
 * A human summary of the active filters for the chip — "14 days · Cream · OPI".
 * Returns null when nothing is narrowed, so the chip falls back to its own invitation
 * ("Narrow it down") rather than reciting a list of defaults.
 */
function describeFilters(filters: PickerFilters): string | null {
  const parts: string[] = [];
  if (filters.restDays !== DEFAULT_FILTERS.restDays) {
    parts.push(filters.restDays === 0 ? 'Any rest' : `${filters.restDays} days`);
  }
  if (filters.finish !== ANY) parts.push(filters.finish);
  if (filters.color !== ANY) parts.push(filters.color);
  if (filters.brandQuery.trim() !== '') parts.push(filters.brandQuery.trim());
  return parts.length === 0 ? null : parts.join(' · ');
}

function isLongRest(days: number | null): boolean {
  return days !== null && days >= LONG_REST_DAYS;
}

/**
 * Honour the OS "reduce motion" setting. Checked at spin time rather than cached, so
 * toggling it in system settings takes effect without a reload.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
