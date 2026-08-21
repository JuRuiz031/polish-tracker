import { useMemo, useState } from 'react';
import type { Polish, Wear } from '../../domain/types';
import { useStore } from '../../app/storeContext';
import { Button, Chip, EmptyState, Fab, SelectField, Swatch } from '../../ui/primitives';
import { Sheet } from '../../ui/Sheet';
import { WearForm } from './WearForm';
import { formatMonth, formatWearDate } from '../../ui/format';
import { colorOptions } from '../../ui/colorOptions';
import {
  ANY,
  DEFAULT_LOG_FILTER,
  activeLogFilterCount,
  availablePeriods,
  brandNames,
  filterWears,
  orphanedWearCount,
  type LogFilter,
} from '../../domain/filters';

/** Which sheet is open. One value, so two can never be open at once — see CollectionScreen. */
type Sheets =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'edit'; wear: Wear }
  | { kind: 'filters' };

const CLOSED: Sheets = { kind: 'none' };

/**
 * The wear log — every manicure, newest first, plus the aggregate numbers.
 *
 * The summary comes from `summarise()` rather than being counted here, so the figures
 * on this screen and the ones the export writes cannot disagree.
 *
 * Rows are tappable and open an edit sheet. They previously carried a visible Edit and
 * Delete on every line, which turned a reading surface into a control panel and put a
 * destructive action on every row of a list she scrolls through casually.
 */
export function LogScreen() {
  const { wears, polishes, summary } = useStore();
  const [sheet, setSheet] = useState<Sheets>(CLOSED);
  const [filters, setFilters] = useState<LogFilter>(DEFAULT_LOG_FILTER);

  const polishById = useMemo(() => {
    const map = new Map<string, Polish>();
    for (const polish of polishes) map.set(polish.id, polish);
    return map;
  }, [polishes]);

  const brands = useMemo(() => brandNames(polishes), [polishes]);
  /** Only periods that actually contain a manicure — see availablePeriods. */
  const periods = useMemo(() => availablePeriods(wears), [wears]);

  const entries = useMemo(
    () =>
      filterWears(wears, polishes, filters)
        // ISO dates sort lexically, so this is a plain string compare.
        .sort((a, b) => b.worn_on.localeCompare(a.worn_on)),
    [wears, polishes, filters],
  );

  const filterCount = activeLogFilterCount(filters);
  const totalLogged = wears.filter((wear) => wear.deleted_at === null).length;
  const orphaned = useMemo(() => orphanedWearCount(wears, polishes), [wears, polishes]);
  const orphansHidden = orphaned > 0 && (filters.brand !== ANY || filters.color !== ANY);

  /** Grouped by month so a long log stays scannable. */
  const months = useMemo(() => {
    const grouped = new Map<string, Wear[]>();
    for (const wear of entries) {
      const key = wear.worn_on.slice(0, 7); // YYYY-MM
      const bucket = grouped.get(key);
      if (bucket) bucket.push(wear);
      else grouped.set(key, [wear]);
    }
    return [...grouped.entries()];
  }, [entries]);

  return (
    <div className="screen">
      <header className="screen__head">
        <div className="screen__headline">
          <div>
            <h1 className="screen__title">Log</h1>
            <p className="screen__sub">Every manicure you have recorded.</p>
          </div>
          <Fab
            label="Log a manicure"
            onClick={() => setSheet({ kind: 'add' })}
            disabled={polishes.length === 0}
          />
        </div>
      </header>

      <section className="summary" aria-label="Collection summary">
        <SummaryStat
          label="Polishes"
          value={
            summary.archived > 0
              ? `${summary.total_polishes} (${summary.archived} archived)`
              : String(summary.total_polishes)
          }
        />
        <SummaryStat label="Never worn" value={String(summary.never_worn)} />
        <SummaryStat label="Manicures" value={String(summary.manicures_logged)} />
        <SummaryStat
          label="Average rating"
          value={summary.avg_rating === null ? '—' : `${summary.avg_rating}★`}
        />
      </section>

      <div className="searchbar">
        <Chip
          label={filterCount > 0 ? `Filter · ${filterCount}` : 'Filter'}
          active={filterCount > 0}
          onClick={() => setSheet({ kind: 'filters' })}
        />
        {filterCount > 0 && (
          <>
            <span className="searchbar__count">
              {entries.length} of {totalLogged}
            </span>
            <Button variant="quiet" onClick={() => setFilters(DEFAULT_LOG_FILTER)}>
              Clear
            </Button>
          </>
        )}
      </div>

      {orphansHidden && (
        <p className="section-note">
          {orphaned} {orphaned === 1 ? 'manicure is' : 'manicures are'} for a polish that
          was deleted, so brand and color can't match {orphaned === 1 ? 'it' : 'them'}.
        </p>
      )}

      {entries.length === 0 && filterCount > 0 ? (
        <EmptyState
          title="No manicures match that"
          action={
            <Button variant="secondary" onClick={() => setFilters(DEFAULT_LOG_FILTER)}>
              Clear the filters
            </Button>
          }
        >
          <p>Try a wider period, or a different brand or color.</p>
        </EmptyState>
      ) : entries.length === 0 ? (
        <EmptyState
          title="Nothing logged yet"
          action={
            <Button
              variant="primary"
              onClick={() => setSheet({ kind: 'add' })}
              disabled={polishes.length === 0}
            >
              Log the first one
            </Button>
          }
        >
          <p>
            Log a manicure and the picker starts learning what has been resting and what
            has not.
          </p>
        </EmptyState>
      ) : (
        months.map(([month, monthEntries]) => (
          <section key={month} className="log-month">
            <h2 className="section-title">{formatMonth(month)}</h2>
            <ul className="log-list">
              {monthEntries.map((wear) => {
                const polish = polishById.get(wear.polish_id);
                return (
                  <li key={wear.id}>
                    <button type="button" className="log-row" onClick={() => setSheet({ kind: 'edit', wear })}>
                      <Swatch hex={polish?.swatch_hex ?? null} size="sm" />
                      <span className="log-row__text">
                        <span className="log-row__name">
                          {polish ? `${polish.brand} ${polish.name}` : 'Deleted polish'}
                        </span>
                        <span className="log-row__meta">
                          {formatWearDate(wear.worn_on)}
                          {wear.rating !== null && ` · ${wear.rating}★`}
                          {wear.days_lasted !== null && ` · lasted ${wear.days_lasted} days`}
                        </span>
                        {wear.notes && <span className="log-row__notes">{wear.notes}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <Sheet open={sheet.kind === 'filters'} title="Filter the log" onClose={() => setSheet(CLOSED)}>
        <div className="form">
          <SelectField
            label="When"
            value={filters.period}
            onChange={(value) => setFilters((f) => ({ ...f, period: value }))}
            /* Years and their months, newest first. A period with nothing in it is never
               offered, so no choice here can produce an empty screen. */
            options={[
              { value: ANY, label: 'Any time' },
              ...periods.map((period) => ({ value: period.value, label: period.label })),
            ]}
          />
          <SelectField
            label="Brand"
            value={filters.brand}
            onChange={(value) => setFilters((f) => ({ ...f, brand: value }))}
            options={[{ value: ANY, label: 'Any brand' }, ...brands]}
          />
          <SelectField
            label="Color"
            value={filters.color}
            onChange={(value) =>
              setFilters((f) => ({ ...f, color: value as LogFilter['color'] }))
            }
            options={colorOptions('Any color')}
          />
          <div className="form__actions">
            <Button variant="primary" onClick={() => setSheet(CLOSED)}>
              Show {entries.length} {entries.length === 1 ? 'manicure' : 'manicures'}
            </Button>
            <Button variant="quiet" onClick={() => setFilters(DEFAULT_LOG_FILTER)}>
              Reset
            </Button>
          </div>
        </div>
      </Sheet>

      <Sheet open={sheet.kind === 'add'} title="Log a manicure" onClose={() => setSheet(CLOSED)}>
        <WearForm onDone={() => setSheet(CLOSED)} onCancel={() => setSheet(CLOSED)} />
      </Sheet>

      <Sheet open={sheet.kind === 'edit'} title="Edit manicure" onClose={() => setSheet(CLOSED)}>
        {sheet.kind === 'edit' && (
          <WearForm
            existing={sheet.wear}
            onDone={() => setSheet(CLOSED)}
            onCancel={() => setSheet(CLOSED)}
            onDelete={() => setSheet(CLOSED)}
          />
        )}
      </Sheet>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary__stat">
      <span className="summary__value">{value}</span>
      <span className="summary__label">{label}</span>
    </div>
  );
}
