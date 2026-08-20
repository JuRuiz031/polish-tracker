import { useMemo } from 'react';
import { LONG_REST_DAYS } from '../../domain/enums';
import type { PolishWithStats, Wear } from '../../domain/types';
import { useStore } from '../../app/storeContext';
import { Badge, Button, Swatch } from '../../ui/primitives';
import { describeDays, formatWearDate } from '../../ui/format';

/**
 * Everything about one polish, and every action that applies to it.
 *
 * This exists so the collection grid does not have to. Before, each tile carried four
 * buttons — log, edit, archive, delete — which made a wall of cards read as a
 * spreadsheet with rounded corners, and put a Delete control one mis-tap away on every
 * row. Now the tile shows only identity and status, and everything else lives one
 * deliberate tap deeper.
 */
export function PolishDetail({
  polish,
  isDuplicate,
  onLogWear,
  onEdit,
  onClose,
}: {
  polish: PolishWithStats;
  isDuplicate: boolean;
  onLogWear: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { wears, removePolish, editPolish, showToast } = useStore();

  /** This polish's own history, newest first. ISO dates compare lexically. */
  const history = useMemo(
    () =>
      wears
        .filter((wear) => wear.polish_id === polish.id && wear.deleted_at === null)
        .sort((a, b) => b.worn_on.localeCompare(a.worn_on)),
    [wears, polish.id],
  );

  const neverWorn = polish.stats.times_worn === 0;
  const restingLong =
    polish.stats.days_since !== null && polish.stats.days_since >= LONG_REST_DAYS;

  return (
    <div className="detail">
      <div className="detail__hero">
        <Swatch hex={polish.swatch_hex} size="lg" />
        <div className="detail__badges">
          {polish.archived && <Badge tone="neutral">Archived</Badge>}
          {neverWorn && <Badge tone="never-worn">Never worn</Badge>}
          {!neverWorn && restingLong && <Badge tone="resting">Resting a while</Badge>}
          {isDuplicate && <Badge tone="duplicate">Possible duplicate</Badge>}
        </div>
      </div>

      <dl className="detail__stats">
        <div>
          <dt>Worn</dt>
          <dd>{polish.stats.times_worn}×</dd>
        </div>
        <div>
          <dt>Last worn</dt>
          <dd>{neverWorn ? 'Never' : describeDays(polish.stats.days_since)}</dd>
        </div>
        <div>
          <dt>Rating</dt>
          <dd>{polish.stats.avg_rating === null ? 'Unrated' : `${polish.stats.avg_rating}★`}</dd>
        </div>
      </dl>

      <dl className="detail__facts">
        <div>
          <dt>Color</dt>
          <dd>{polish.color}</dd>
        </div>
        <div>
          <dt>Finish</dt>
          <dd>{polish.finish}</dd>
        </div>
      </dl>

      {polish.notes && (
        <section className="detail__section">
          <h3 className="detail__heading">Notes</h3>
          <p className="detail__notes">{polish.notes}</p>
        </section>
      )}

      <section className="detail__section">
        <h3 className="detail__heading">
          History {history.length > 0 && <span className="detail__count">{history.length}</span>}
        </h3>
        {history.length === 0 ? (
          <p className="detail__empty">
            Not worn yet. The picker will keep offering it until it is.
          </p>
        ) : (
          <ul className="history">
            {history.map((wear) => (
              <HistoryRow key={wear.id} wear={wear} />
            ))}
          </ul>
        )}
      </section>

      <div className="detail__actions">
        <Button variant="primary" onClick={onLogWear}>
          Log a wear
        </Button>
        <Button variant="secondary" onClick={onEdit}>
          Edit
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            await editPolish(polish.id, { archived: !polish.archived });
            showToast({
              message: polish.archived
                ? `${polish.brand} ${polish.name} is back in rotation.`
                : `${polish.brand} ${polish.name} archived.`,
            });
            onClose();
          }}
        >
          {polish.archived ? 'Unarchive' : 'Archive'}
        </Button>
        <Button
          variant="danger"
          onClick={async () => {
            // No confirm dialog: the delete is soft and the toast offers Undo.
            await removePolish(polish.id);
            onClose();
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function HistoryRow({ wear }: { wear: Wear }) {
  return (
    <li className="history__row">
      <span className="history__date">{formatWearDate(wear.worn_on)}</span>
      <span className="history__meta">
        {wear.rating !== null && <span className="history__rating">{wear.rating}★</span>}
        {wear.days_lasted !== null && <span>lasted {wear.days_lasted}d</span>}
        {wear.rating === null && wear.days_lasted === null && (
          <span className="history__quiet">no details</span>
        )}
      </span>
      {wear.notes && <p className="history__notes">{wear.notes}</p>}
    </li>
  );
}
