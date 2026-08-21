import { useRef, useState, type ChangeEvent } from 'react';
import { buildExportBundle, buildExportFiles } from '../../data/transfer/exportData';
import { importJson } from '../../data/transfer/importData';
import { useStore } from '../../app/storeContext';
import { Button } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';

/**
 * Backup — the escape hatch, made reachable.
 *
 * Requirement #3 in the brief: if this project ever goes unmaintained, she has to be
 * able to walk away with everything. The export/import layer this screen wires up has
 * existed since before persistence did; nothing about the format changed to get here.
 *
 * Restoring MERGES rather than replaces, through the exact same row-level last-write-wins
 * rule that reconciles two devices (domain/merge.ts). That is what makes it safe to hand
 * her an old backup file by mistake — the newer rows win regardless of which file they
 * came from, so restoring can only ever add or lose to something more recent, never wipe
 * out today's manicure with last month's file.
 */
export function DataScreen() {
  const { allPolishes, wears, allWishlist, importBackup, showToast } = useStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  function downloadBackup() {
    const bundle = buildExportBundle(allPolishes, wears, allWishlist);
    const file = buildExportFiles(bundle).find((candidate) => candidate.filename.endsWith('.json'));
    if (file) triggerDownload(file.filename, file.content, file.mimeType);
  }

  function downloadSpreadsheets() {
    const bundle = buildExportBundle(allPolishes, wears, allWishlist);
    // Multiple downloads from one click work in every browser this app targets; a zip
    // would need a new dependency for something she can already do with three taps.
    for (const file of buildExportFiles(bundle)) {
      if (file.filename.endsWith('.json')) continue;
      triggerDownload(file.filename, file.content, file.mimeType);
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared immediately so picking the same file again later still fires onChange.
    event.target.value = '';
    if (!file) return;

    setProblems([]);
    const text = await file.text();
    const result = importJson(text);

    if (result.problems.length > 0) {
      setProblems(result.problems.map((problem) => problem.message));
      return;
    }

    setRestoring(true);
    try {
      await importBackup(result.rows[0]);
      showToast({ message: 'Backup restored.' });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="screen screen--data">
      <header className="screen__head">
        <h1 className="screen__title">Backup</h1>
        <p className="screen__sub">Save a copy of everything, or bring an old copy back.</p>
      </header>

      <section>
        <h2 className="section-title">Download a backup</h2>
        <p className="section-note">
          One file with your whole collection, wear log, and wishlist. Save it somewhere
          safe — email it to yourself, or keep it with your photos.
        </p>
        <div className="form__actions">
          <Button variant="primary" onClick={downloadBackup}>
            <Icon name="download" />
            Download backup
          </Button>
          <Button variant="secondary" onClick={downloadSpreadsheets}>
            Download as spreadsheet
          </Button>
        </div>
      </section>

      <section>
        <h2 className="section-title">Restore a backup</h2>
        <p className="section-note">
          Choose a backup file you downloaded before. It joins what's already here —
          nothing recent gets overwritten by something older.
        </p>
        <div className="form__actions">
          <Button
            variant="secondary"
            onClick={() => fileInput.current?.click()}
            disabled={restoring}
          >
            <Icon name="upload" />
            {restoring ? 'Restoring…' : 'Choose a backup file'}
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          onChange={handleFile}
        />
        {problems.length > 0 && (
          <div className="notice notice--duplicate" role="alert">
            <p>That file couldn't be read:</p>
            <ul>
              {problems.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
