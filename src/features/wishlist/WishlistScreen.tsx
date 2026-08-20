import { useMemo, useState } from 'react';
import { ANY, PRIORITIES } from '../../domain/enums';
import type { Polish, WishlistItem } from '../../domain/types';
import { useStore } from '../../app/storeContext';
import { Badge, Button, Chip, EmptyState, Fab, Swatch } from '../../ui/primitives';
import { Sheet } from '../../ui/Sheet';
import { WishlistForm } from './WishlistForm';

/** Which sheet is open. One value, so two can never be open at once — see CollectionScreen. */
type Sheets =
  | { kind: 'none' }
  | { kind: 'detail'; id: string }
  | { kind: 'edit'; item: WishlistItem }
  | { kind: 'add' };

const CLOSED: Sheets = { kind: 'none' };

/**
 * The wishlist.
 *
 * The two dedupe states the brief insists must look different are rendered differently
 * on purpose:
 *
 *   already owned — amber, and it names the bottle she already has. Useful information,
 *                   not a mistake; she may simply have forgotten she owns it.
 *   listed twice  — alert, because that IS a data-entry slip worth cleaning up.
 *
 * Both come from `flagWishlist()`, so the rule lives in the domain layer and this
 * screen only decides how to say it.
 */
export function WishlistScreen() {
  const { wishlist, wishlistFlags, polishes } = useStore();

  const [priority, setPriority] = useState<string>(ANY);
  const [sheet, setSheet] = useState<Sheets>(CLOSED);

  const polishById = useMemo(() => {
    const map = new Map<string, Polish>();
    for (const polish of polishes) map.set(polish.id, polish);
    return map;
  }, [polishes]);

  const visible = useMemo(() => {
    const order: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
    return wishlist
      .filter((item) => priority === ANY || item.priority === priority)
      .sort((a, b) => {
        const byPriority = order[a.priority] - order[b.priority];
        if (byPriority !== 0) return byPriority;
        return `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`);
      });
  }, [wishlist, priority]);

  const active =
    sheet.kind === 'detail' ? (wishlist.find((item) => item.id === sheet.id) ?? null) : null;

  return (
    <div className="screen">
      <header className="screen__head">
        <div className="screen__headline">
          <div>
            <h1 className="screen__title">Wishlist</h1>
            <p className="screen__sub">
              {wishlist.length} {wishlist.length === 1 ? 'item' : 'items'}
              {wishlistFlags.alreadyOwned.size > 0 &&
                ` · ${wishlistFlags.alreadyOwned.size} already in the collection`}
            </p>
          </div>
          <Fab label="Add to wishlist" onClick={() => setSheet({ kind: 'add' })} />
        </div>
      </header>

      <div className="chip-row" role="group" aria-label="Filter by priority">
        <Chip label="All" active={priority === ANY} onClick={() => setPriority(ANY)} />
        {PRIORITIES.map((level) => (
          <Chip
            key={level}
            label={level}
            active={priority === level}
            onClick={() => setPriority(level)}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={wishlist.length === 0 ? 'Wishlist is empty' : 'Nothing at that priority'}
        >
          <p>Add the polishes you are keeping an eye on, and what they usually cost.</p>
        </EmptyState>
      ) : (
        <ul className="grid">
          {visible.map((item) => (
            <WishCard
              key={item.id}
              item={item}
              ownedName={ownedLabel(wishlistFlags.alreadyOwned.get(item.id), polishById)}
              duplicated={wishlistFlags.duplicated.has(item.id)}
              onOpen={() => setSheet({ kind: 'detail', id: item.id })}
            />
          ))}
        </ul>
      )}

      <Sheet
        open={active !== null}
        size="wide"
        title={active ? active.name : ''}
        subtitle={active?.brand}
        onClose={() => setSheet(CLOSED)}
      >
        {active && (
          <WishDetail
            item={active}
            ownedName={ownedLabel(wishlistFlags.alreadyOwned.get(active.id), polishById)}
            duplicated={wishlistFlags.duplicated.has(active.id)}
            onEdit={() => setSheet({ kind: 'edit', item: active })}
            onClose={() => setSheet(CLOSED)}
          />
        )}
      </Sheet>

      <Sheet open={sheet.kind === 'add'} title="Add to wishlist" onClose={() => setSheet(CLOSED)}>
        <WishlistForm onDone={() => setSheet(CLOSED)} onCancel={() => setSheet(CLOSED)} />
      </Sheet>

      <Sheet
        open={sheet.kind === 'edit'}
        title="Edit wishlist item"
        subtitle={sheet.kind === 'edit' ? `${sheet.item.brand} ${sheet.item.name}` : undefined}
        onClose={() => setSheet(CLOSED)}
      >
        {sheet.kind === 'edit' && (
          <WishlistForm
            existing={sheet.item}
            onDone={() => setSheet(CLOSED)}
            onCancel={() => setSheet(CLOSED)}
          />
        )}
      </Sheet>
    </div>
  );
}

function ownedLabel(ownedId: string | undefined, byId: Map<string, Polish>): string | null {
  if (!ownedId) return null;
  const polish = byId.get(ownedId);
  return polish ? `${polish.brand} ${polish.name}` : null;
}

function WishCard({
  item,
  ownedName,
  duplicated,
  onOpen,
}: {
  item: WishlistItem;
  ownedName: string | null;
  duplicated: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <button type="button" className="polish-card" onClick={onOpen}>
        <span className={`priority priority--${item.priority.toLowerCase()}`} aria-hidden="true" />
        <Swatch hex={item.swatch_hex} size="md" />
        <span className="polish-card__id">
          <span className="polish-card__brand">{item.brand}</span>
          <span className="polish-card__name">{item.name}</span>
          <span className="polish-card__meta">
            {item.finish} · {item.color}
            {item.typical_price !== null && ` · $${item.typical_price.toFixed(2)}`}
          </span>
        </span>
        <span className="polish-card__status">
          {ownedName && <Badge tone="resting">Already owned</Badge>}
          {duplicated && <Badge tone="duplicate">Listed twice</Badge>}
          {!ownedName && !duplicated && (
            <span className="polish-card__worn">
              {item.priority} · {item.status}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function WishDetail({
  item,
  ownedName,
  duplicated,
  onEdit,
  onClose,
}: {
  item: WishlistItem;
  ownedName: string | null;
  duplicated: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { addPolish, removeWishlistItem, showToast } = useStore();

  /**
   * "I bought it" — copy into the collection, then take it off the list.
   *
   * Every field she filled in on the wishlist carries across, the bottle colour
   * included. It previously passed null here because the wishlist had nowhere to store
   * a shade, so buying a polish silently threw away the colour she had chosen for it.
   */
  async function moveToCollection() {
    await addPolish({
      brand: item.brand,
      name: item.name,
      color: item.color,
      finish: item.finish,
      swatch_hex: item.swatch_hex,
      photo_path: null,
      notes: item.notes,
      archived: false,
    });
    await removeWishlistItem(item.id);
    showToast({ message: `${item.brand} ${item.name} moved into the collection.` });
    onClose();
  }

  return (
    <div className="detail">
      <div className="detail__hero">
        <Swatch hex={item.swatch_hex} size="lg" />
      </div>

      <div className="detail__badges detail__badges--start">
        <Badge tone="neutral">{item.priority} priority</Badge>
        <Badge tone="neutral">{item.status}</Badge>
        {ownedName && <Badge tone="resting">Already owned</Badge>}
        {duplicated && <Badge tone="duplicate">Listed twice</Badge>}
      </div>

      {ownedName && (
        <p className="notice notice--owned">
          You already have <strong>{ownedName}</strong> in the collection.
        </p>
      )}
      {duplicated && (
        <p className="notice notice--duplicate">
          This is on the wishlist more than once — worth tidying up.
        </p>
      )}

      <dl className="detail__facts">
        <div>
          <dt>Color</dt>
          <dd>{item.color}</dd>
        </div>
        <div>
          <dt>Finish</dt>
          <dd>{item.finish}</dd>
        </div>
        {item.typical_price !== null && (
          <div>
            <dt>Usually</dt>
            <dd>${item.typical_price.toFixed(2)}</dd>
          </div>
        )}
        {item.where_sold && (
          <div>
            <dt>Sold at</dt>
            <dd>{item.where_sold}</dd>
          </div>
        )}
        {item.sale_window && (
          <div>
            <dt>On sale</dt>
            <dd>{item.sale_window}</dd>
          </div>
        )}
      </dl>

      {item.link && (
        <p className="detail__link">
          <a href={item.link} target="_blank" rel="noreferrer noopener">
            Open the listing
          </a>
        </p>
      )}

      {item.notes && (
        <section className="detail__section">
          <h3 className="detail__heading">Notes</h3>
          <p className="detail__notes">{item.notes}</p>
        </section>
      )}

      <div className="detail__actions">
        <Button variant="primary" onClick={moveToCollection}>
          I bought it
        </Button>
        <Button variant="secondary" onClick={onEdit}>
          Edit
        </Button>
        <Button
          variant="danger"
          onClick={async () => {
            await removeWishlistItem(item.id);
            onClose();
          }}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}
