import { EXPORT_VERSION, exportSchema } from '../../domain/schema';
import type { PolishInput, WearInput, WishlistInput } from '../../domain/schema';
import type { IsoDate, Polish, Wear, WishlistItem } from '../../domain/types';
import { GitHubApiError, readFile, writeFile, type GitHubTarget } from '../github/api';
import type { Repository, Snapshot } from './types';

/**
 * The collection, stored as one JSON file in a private GitHub repository.
 *
 * Every mutation rewrites the file and commits it, so the repo's history IS the backup:
 * any night of her collection is recoverable with `git checkout`, with no backup job to
 * schedule and nothing that can quietly stop running. The file is exactly the shape
 * `exportSchema` defines, which means cloning the repo gives her a working export with
 * no app involved — the escape hatch is structural rather than a feature someone has to
 * remember to build.
 *
 * The write amplification is real and accepted: logging one manicure uploads the whole
 * file. At this size (a few hundred KB) that is a fraction of a second, git deltas it to
 * almost nothing, and it buys a format with no assembly step. If the log ever grows
 * enough to matter, shard by table behind this same interface and no screen changes.
 */

const USER_ID = 'owner';

/** Enough attempts to survive the other device saving at the same moment. */
const MAX_ATTEMPTS = 3;

function now(): string {
  return new Date().toISOString();
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * A function, not a shared constant.
 *
 * A module-level `EMPTY` object handed out with `{ ...EMPTY }` is only a SHALLOW copy —
 * the three arrays stay shared, so the first row added to a brand-new collection is
 * pushed into the constant itself and leaks into every later instance. Returning fresh
 * arrays is the only version of this that is safe.
 */
function emptySnapshot(): Snapshot {
  return { polish: [], wear: [], wishlist: [] };
}

export class GitHubRepository implements Repository {
  private readonly target: GitHubTarget;
  private data: Snapshot = emptySnapshot();
  /** SHA of the file as last read. null means it does not exist yet. */
  private sha: string | null = null;
  private loaded = false;

  constructor(target: GitHubTarget) {
    this.target = target;
  }

  async load(): Promise<Snapshot> {
    const { text, sha } = await readFile(this.target);
    this.sha = sha;

    if (text.trim() === '') {
      // A genuinely new repo. Distinct from "we failed to understand the file", which
      // is handled below and must never reach this branch.
      this.data = emptySnapshot();
      this.loaded = true;
      return this.clone();
    }

    this.data = parseSnapshot(text);
    this.loaded = true;
    return this.clone();
  }

  // ---- Polish ------------------------------------------------------------------

  async addPolish(input: PolishInput): Promise<Polish> {
    const row: Polish = {
      id: newId(),
      user_id: USER_ID,
      brand: input.brand,
      name: input.name,
      color: input.color,
      finish: input.finish,
      swatch_hex: input.swatch_hex,
      photo_path: input.photo_path,
      notes: input.notes,
      archived: input.archived,
      created_at: now(),
      updated_at: now(),
      deleted_at: null,
    };
    await this.commit(`Add ${row.brand} ${row.name}`, (data) => {
      upsert(data.polish, row);
    });
    return { ...row };
  }

  async updatePolish(id: string, patch: Partial<PolishInput>): Promise<Polish> {
    const stamp = now();
    let updated!: Polish;
    await this.commit(`Update polish ${id}`, (data) => {
      const row = require_(data.polish, id, 'polish');
      Object.assign(row, patch, { updated_at: stamp });
      updated = { ...row };
    });
    return updated;
  }

  async deletePolish(id: string): Promise<Polish> {
    return this.setDeleted('polish', id, now());
  }

  async restorePolish(id: string): Promise<Polish> {
    return this.setDeleted('polish', id, null);
  }

  // ---- Wear --------------------------------------------------------------------

  async addWear(input: WearInput): Promise<Wear> {
    const row: Wear = {
      id: newId(),
      user_id: USER_ID,
      polish_id: input.polish_id,
      worn_on: input.worn_on,
      rating: input.rating,
      days_lasted: input.days_lasted,
      notes: input.notes,
      created_at: now(),
      updated_at: now(),
      deleted_at: null,
    };
    await this.commit(`Log manicure on ${row.worn_on}`, (data) => {
      upsert(data.wear, row);
    });
    return { ...row };
  }

  async updateWear(id: string, patch: Partial<WearInput>): Promise<Wear> {
    const stamp = now();
    let updated!: Wear;
    await this.commit(`Update manicure ${id}`, (data) => {
      const row = require_(data.wear, id, 'wear');
      Object.assign(row, patch, { updated_at: stamp });
      updated = { ...row };
    });
    return updated;
  }

  async deleteWear(id: string): Promise<Wear> {
    return this.setDeleted('wear', id, now());
  }

  async restoreWear(id: string): Promise<Wear> {
    return this.setDeleted('wear', id, null);
  }

  // ---- Wishlist ----------------------------------------------------------------

  async addWishlistItem(input: WishlistInput): Promise<WishlistItem> {
    const row: WishlistItem = {
      id: newId(),
      user_id: USER_ID,
      brand: input.brand,
      name: input.name,
      color: input.color,
      finish: input.finish,
      swatch_hex: input.swatch_hex,
      where_sold: input.where_sold,
      typical_price: input.typical_price,
      sale_window: input.sale_window,
      priority: input.priority,
      status: input.status,
      link: input.link,
      notes: input.notes,
      bought_polish_id: null,
      bought_on: null,
      created_at: now(),
      updated_at: now(),
      deleted_at: null,
    };
    await this.commit(`Wishlist ${row.brand} ${row.name}`, (data) => {
      upsert(data.wishlist, row);
    });
    return { ...row };
  }

  async updateWishlistItem(id: string, patch: Partial<WishlistInput>): Promise<WishlistItem> {
    const stamp = now();
    let updated!: WishlistItem;
    await this.commit(`Update wishlist item ${id}`, (data) => {
      const row = require_(data.wishlist, id, 'wishlist item');
      Object.assign(row, patch, { updated_at: stamp });
      updated = { ...row };
    });
    return updated;
  }

  async deleteWishlistItem(id: string): Promise<WishlistItem> {
    return this.setDeleted('wishlist', id, now());
  }

  async restoreWishlistItem(id: string): Promise<WishlistItem> {
    return this.setDeleted('wishlist', id, null);
  }

  async markWishlistItemBought(
    id: string,
    polishId: string,
    boughtOn: IsoDate,
  ): Promise<WishlistItem> {
    const stamp = now();
    let updated!: WishlistItem;
    await this.commit(`Bought wishlist item ${id}`, (data) => {
      const row = require_(data.wishlist, id, 'wishlist item');
      // Written together, never separately — the same pairing 0001_schema.sql enforces
      // with a CHECK, kept here so the two backends cannot disagree about what a
      // resolved wishlist row looks like.
      row.status = 'Bought';
      row.bought_polish_id = polishId;
      row.bought_on = boughtOn;
      row.updated_at = stamp;
      updated = { ...row };
    });
    return updated;
  }

  // ---- Internals ---------------------------------------------------------------

  private async setDeleted<T extends Polish | Wear | WishlistItem>(
    table: keyof Snapshot,
    id: string,
    deletedAt: string | null,
  ): Promise<T> {
    const stamp = now();
    let updated!: T;
    const verb = deletedAt === null ? 'Restore' : 'Delete';
    await this.commit(`${verb} ${table} ${id}`, (data) => {
      const row = require_(data[table] as T[], id, table);
      row.deleted_at = deletedAt;
      row.updated_at = stamp;
      updated = { ...row };
    });
    return updated;
  }

  /**
   * Apply a change and push the whole file, retrying if the other device got there
   * first.
   *
   * On a conflict the fix is not to force the write — that would discard whatever the
   * other device just saved. Instead the file is re-read and the SAME change is applied
   * on top of the newer state, which is why `apply` has to be safe to run more than
   * once: adds upsert by id rather than pushing, so a retry cannot double-insert.
   */
  private async commit(message: string, apply: (data: Snapshot) => void): Promise<void> {
    if (!this.loaded) {
      throw new Error('GitHubRepository.load() must be awaited before writing.');
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      apply(this.data);

      // Never write a file that could not be read back.
      //
      // Reads already refuse to parse a malformed file, but that only catches corruption
      // that has already been committed. This is the other half: whatever reaches the
      // repository has been proved to satisfy the same schema that will later be used to
      // load it, so the app cannot be the thing that breaks its own collection. A bug in
      // a mutation surfaces here, before the write, with her stored data still intact.
      const text = serialise(this.data);
      assertReadable(text);

      try {
        this.sha = await writeFile(this.target, text, this.sha, message);
        return;
      } catch (error) {
        const conflicted = error instanceof GitHubApiError && error.isConflict;
        if (!conflicted || attempt === MAX_ATTEMPTS) throw error;
        await this.load();
      }
    }
  }

  private clone(): Snapshot {
    return {
      polish: this.data.polish.map((row) => ({ ...row })),
      wear: this.data.wear.map((row) => ({ ...row })),
      wishlist: this.data.wishlist.map((row) => ({ ...row })),
    };
  }
}

/** Insert or replace by id, so re-running after a conflict cannot duplicate the row. */
function upsert<T extends { id: string }>(rows: T[], row: T): void {
  const index = rows.findIndex((candidate) => candidate.id === row.id);
  if (index === -1) rows.push(row);
  else rows[index] = row;
}

function require_<T extends { id: string }>(rows: T[], id: string, label: string): T {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`No ${label} with id ${id}`);
  return row;
}

export function serialise(data: Snapshot): string {
  return `${JSON.stringify(
    {
      version: EXPORT_VERSION,
      exported_at: now(),
      polish: data.polish,
      wear: data.wear,
      wishlist: data.wishlist,
    },
    null,
    2,
  )}\n`;
}

/**
 * Refuse to send something the loader would reject.
 *
 * The message is aimed at whoever is debugging, not at her: reaching this means the app
 * built an invalid snapshot in memory, which is a bug rather than anything she did. The
 * important part is that it throws BEFORE the network call, so the stored collection is
 * untouched and the failure is recoverable by reloading.
 */
export function assertReadable(text: string): void {
  try {
    parseSnapshot(text);
  } catch (cause) {
    throw new Error(
      `Refusing to save: the collection failed its own validity check, so it was not ` +
        `written. Your stored data has not been changed. (${(cause as Error).message})`,
    );
  }
}

/**
 * Parse the stored file, or refuse.
 *
 * This throws rather than falling back to an empty collection, and that is the single
 * most important decision in this file. Every mutation writes the whole snapshot back —
 * so if a malformed file were quietly treated as "no data", the next thing she did would
 * commit an empty collection over the top of everything she owns. A hard failure means
 * she sees an error and her data stays untouched in the repo, one `git revert` away.
 */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(
      'The collection file in the repository is not valid JSON. Refusing to continue so ' +
        'the existing data is not overwritten.',
    );
  }

  const result = exportSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(
      `The collection file does not match the expected format (${first?.path.join('.') || 'file'}: ` +
        `${first?.message ?? 'unknown problem'}). Refusing to continue so the existing data is not overwritten.`,
    );
  }

  return {
    polish: result.data.polish as Snapshot['polish'],
    wear: result.data.wear as Snapshot['wear'],
    wishlist: result.data.wishlist as Snapshot['wishlist'],
  };
}
