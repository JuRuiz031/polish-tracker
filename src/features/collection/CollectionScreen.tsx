import { useMemo, useState } from 'react';
import { today } from '../../domain/date';
import { FINISHES, LONG_REST_DAYS } from '../../domain/enums';
import { countDuplicateGroups } from '../../domain/dedupe';
import {
  ANY,
  DEFAULT_COLLECTION_FILTER,
  activeFilterCount,
  brandNames,
  filterPolishes,
  type CollectionFilter,
} from '../../domain/filters';
import type { Polish, PolishWithStats } from '../../domain/types';
import { useStore } from '../../app/storeContext';
import { Badge, Button, Chip, EmptyState, Fab, SelectField, Swatch } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import { colorOptions } from '../../ui/colorOptions';
import { PolishForm } from './PolishForm';
import { PolishDetail } from './PolishDetail';
import { describeDays } from '../../ui/format';
import { WearForm } from '../log/WearForm';

type SortKey = 'oldest-worn' | 'brand' | 'most-worn' | 'rating' | 'recent';

/** Minimum average rating. 0 is "no constraint" rather than "rated zero". */
const RATING_OPTIONS = [
  { value: '0', label: 'Any rating' },
  { value: '5', label: '5 stars' },
  { value: '4', label: '4 stars and up' },
  { value: '3', label: '3 stars and up' },
  { value: '2', label: '2 stars and up' },
];

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'oldest-worn', label: 'Longest rested first' },
  { value: 'brand', label: 'Brand A–Z' },
  { value: 'most-worn', label: 'Most worn' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'recent', label: 'Recently added' },
];


/**
 * Which sheet is open, if any.
 *
 * One value rather than five independent pieces of state. The old shape could represent
 * "detail and edit both open", which is not a state this screen has — and it is exactly
 * the situation that put two modal dialogs on screen at once. A union makes that
 * unrepresentable instead of merely unlikely, and every handler becomes one assignment
 * rather than one set plus one clear.
 */
type Sheets =
  | { kind: 'none' }
  | { kind: 'detail'; id: string }
  | { kind: 'edit'; polish: Polish }
  | { kind: 'log'; polish: PolishWithStats }
  | { kind: 'add' }
  | { kind: 'filters' };

const CLOSED: Sheets = { kind: 'none' };

/**
 * The collection.
 *
 * Search stays on screen because it is used constantly; everything else lives behind
 * one "Filter" chip that reports its own state. The permanently expanded filter panel
 * this replaces cost most of a phone screen and made browsing feel like operating a
 * database.
 *
 * Default sort is longest-rested rather than alphabetical. The premise of the app is
 * that bottles get forgotten, so the default view surfaces the forgotten ones — the
 * same bias the picker has, applied to browsing.
 */
export function CollectionScreen() {
  const { polishes, allPolishes, duplicateIds } = useStore();

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<CollectionFilter>(DEFAULT_COLLECTION_FILTER);
  const [sort, setSort] = useState<SortKey>('oldest-worn');
  const [sheet, setSheet] = useState<Sheets>(CLOSED);

  const duplicateGroups = useMemo(() => countDuplicateGroups(allPolishes), [allPolishes]);

  const brands = useMemo(() => brandNames(polishes), [polishes]);

  const visible = useMemo(() => {
    const filtered = filterPolishes(polishes, filters, query);

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'brand':
          return `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`);
        case 'most-worn':
          return b.stats.times_worn - a.stats.times_worn;
        case 'rating':
          // Unrated sinks to the bottom rather than sorting as zero.
          return (b.stats.avg_rating ?? -1) - (a.stats.avg_rating ?? -1);
        case 'recent':
          return b.created_at.localeCompare(a.created_at);
        case 'oldest-worn':
        default: {
          // Never-worn first — they are the point — then longest-rested.
          const aDays = a.stats.days_since;
          const bDays = b.stats.days_since;
          if (aDays === null && bDays === null) return a.brand.localeCompare(b.brand);
          if (aDays === null) return -1;
          if (bDays === null) return 1;
          return bDays - aDays;
        }
      }
    });
  }, [polishes, query, filters, sort]);

  /** Looked up from the store rather than snapshotted, so an edit shows immediately. */
  const active =
    sheet.kind === 'detail' ? (polishes.find((polish) => polish.id === sheet.id) ?? null) : null;

  // Sort is a view preference rather than a constraint, so it is counted separately —
  // the chip says how much is being HIDDEN, and re-sorting hides nothing.
  const filterCount = activeFilterCount(filters);

  const archivedCount = polishes.filter((polish) => polish.archived).length;

  return (
    <div className="screen">
      <header className="screen__head">
        <div className="screen__headline">
          <div>
            <h1 className="screen__title">Collection</h1>
            <p className="screen__sub">
              {polishes.length - archivedCount} polishes
              {archivedCount > 0 && ` · ${archivedCount} archived`}
              {duplicateGroups > 0 &&
                ` · ${duplicateGroups} possible ${duplicateGroups === 1 ? 'duplicate' : 'duplicates'}`}
            </p>
          </div>
          <Fab label="Add a polish" onClick={() => setSheet({ kind: 'add' })} />
        </div>
      </header>

      <div className="searchbar">
        <div className="searchbar__field">
          <Icon name="search" className="searchbar__icon" />
          <input
            className="searchbar__input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search brand or name"
            aria-label="Search the collection"
            autoComplete="off"
          />
        </div>
        <Chip
          label={filterCount > 0 ? `Filter · ${filterCount}` : 'Filter'}
          active={filterCount > 0}
          onClick={() => setSheet({ kind: 'filters' })}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={polishes.length === 0 ? 'No polishes yet' : 'Nothing matches that'}
          action={
            polishes.length > 0 && (filterCount > 0 || query !== '') ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setFilters(DEFAULT_COLLECTION_FILTER);
                  setSort('oldest-worn');
                  setQuery('');
                }}
              >
                Clear everything
              </Button>
            ) : undefined
          }
        >
          <p>
            {polishes.length === 0
              ? 'Add the first one and the picker starts working.'
              : 'Try clearing the search or widening a filter.'}
          </p>
        </EmptyState>
      ) : (
        <ul className="grid">
          {visible.map((polish) => (
            <PolishCard
              key={polish.id}
              polish={polish}
              isDuplicate={duplicateIds.has(polish.id)}
              onOpen={() => setSheet({ kind: 'detail', id: polish.id })}
            />
          ))}
        </ul>
      )}

      {/* ---- Detail ---- */}
      <Sheet
        open={active !== null}
        size="wide"
        title={active ? active.name : ''}
        subtitle={active?.brand}
        onClose={() => setSheet(CLOSED)}
      >
        {active && (
          <PolishDetail
            polish={active}
            isDuplicate={duplicateIds.has(active.id)}
            onLogWear={() => setSheet({ kind: 'log', polish: active })}
            onEdit={() => setSheet({ kind: 'edit', polish: active })}
            onClose={() => setSheet(CLOSED)}
          />
        )}
      </Sheet>

      {/* ---- Filters ---- */}
      <Sheet open={sheet.kind === 'filters'} title="Filter and sort" onClose={() => setSheet(CLOSED)}>
        <div className="form">
          <SelectField
            label="Brand"
            value={filters.brand}
            onChange={(value) => setFilters((f) => ({ ...f, brand: value }))}
            /* Built from the collection rather than a fixed list — offering brands she
               does not own would be worse than not offering any. */
            options={[{ value: ANY, label: 'Any brand' }, ...brands]}
          />
          <SelectField
            label="Color"
            value={filters.color}
            onChange={(value) =>
              setFilters((f) => ({ ...f, color: value as CollectionFilter['color'] }))
            }
            options={colorOptions('Any color')}
          />
          <SelectField
            label="Finish"
            value={filters.finish}
            onChange={(value) =>
              setFilters((f) => ({ ...f, finish: value as CollectionFilter['finish'] }))
            }
            options={[{ value: ANY, label: 'Any finish' }, ...FINISHES]}
          />
          <SelectField
            label="Rating"
            value={String(filters.minRating)}
            onChange={(value) => setFilters((f) => ({ ...f, minRating: Number(value) }))}
            options={RATING_OPTIONS}
            hint="Polishes you have never rated are left out of a rating filter."
          />
          <SelectField
            label="Sort by"
            value={sort}
            onChange={(value) => setSort(value as SortKey)}
            options={SORTS}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={filters.showArchived}
              onChange={(event) =>
                setFilters((f) => ({ ...f, showArchived: event.target.checked }))
              }
            />
            <span>
              Show archived
              <span className="checkbox__hint">Bottles you have used up or given away.</span>
            </span>
          </label>
          <div className="form__actions">
            <Button variant="primary" onClick={() => setSheet(CLOSED)}>
              Show {visible.length} {visible.length === 1 ? 'polish' : 'polishes'}
            </Button>
            <Button variant="quiet" onClick={() => setFilters(DEFAULT_COLLECTION_FILTER)}>
              Reset
            </Button>
          </div>
        </div>
      </Sheet>

      {/* ---- Add / edit / log ---- */}
      <Sheet open={sheet.kind === 'add'} title="Add a polish" onClose={() => setSheet(CLOSED)}>
        <PolishForm onDone={() => setSheet(CLOSED)} onCancel={() => setSheet(CLOSED)} />
      </Sheet>

      <Sheet
        open={sheet.kind === 'edit'}
        title="Edit polish"
        subtitle={sheet.kind === 'edit' ? `${sheet.polish.brand} ${sheet.polish.name}` : undefined}
        onClose={() => setSheet(CLOSED)}
      >
        {sheet.kind === 'edit' && (
          <PolishForm
            existing={sheet.polish}
            onDone={() => setSheet(CLOSED)}
            onCancel={() => setSheet(CLOSED)}
          />
        )}
      </Sheet>

      <Sheet
        open={sheet.kind === 'log'}
        title="Log a manicure"
        subtitle={sheet.kind === 'log' ? `${sheet.polish.brand} ${sheet.polish.name}` : undefined}
        onClose={() => setSheet(CLOSED)}
      >
        {sheet.kind === 'log' && (
          <WearForm
            polishId={sheet.polish.id}
            defaultDate={today()}
            onDone={() => setSheet(CLOSED)}
            onCancel={() => setSheet(CLOSED)}
          />
        )}
      </Sheet>
    </div>
  );
}

/**
 * One tile. Identity and status only — every action lives in the detail sheet.
 *
 * The whole card is a single <button> rather than a div with nested controls, so it is
 * one tab stop, one tap target, and its accessible name is the polish itself.
 */
function PolishCard({
  polish,
  isDuplicate,
  onOpen,
}: {
  polish: PolishWithStats;
  isDuplicate: boolean;
  onOpen: () => void;
}) {
  const neverWorn = polish.stats.times_worn === 0;
  const restingLong =
    polish.stats.days_since !== null && polish.stats.days_since >= LONG_REST_DAYS;

  return (
    <li>
      <button
        type="button"
        className={`polish-card ${polish.archived ? 'is-archived' : ''}`}
        onClick={onOpen}
      >
        <Swatch hex={polish.swatch_hex} size="md" />
        <span className="polish-card__id">
          <span className="polish-card__brand">{polish.brand}</span>
          <span className="polish-card__name">{polish.name}</span>
          <span className="polish-card__meta">
            {polish.finish} · {polish.color}
          </span>
        </span>

        <span className="polish-card__status">
          {polish.archived && <Badge tone="neutral">Archived</Badge>}
          {isDuplicate && <Badge tone="duplicate">Duplicate</Badge>}
          {neverWorn ? (
            <Badge tone="never-worn">Never worn</Badge>
          ) : restingLong ? (
            <Badge tone="resting">{describeDays(polish.stats.days_since)}</Badge>
          ) : (
            <span className="polish-card__worn">
              {polish.stats.times_worn}× · {describeDays(polish.stats.days_since)}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
