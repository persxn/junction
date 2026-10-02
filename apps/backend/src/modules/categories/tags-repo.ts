import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';
import type { DerivedTag } from './domain/tags.js';

/**
 * Writing an event's source tags (ruling R87).
 *
 * Runs inside the classification pass, so it shares its transaction and its
 * triggers: every link, merge, unmerge, manual entry and re-classification
 * that re-derives an event's categories re-derives its tags in the same breath
 * (`CategoryClassifier`).
 *
 * Only `SOURCE_TAG` rows are this function's to replace. A tag a person added
 * (`MANUAL`, from a later WP) is never removed here, and the same tag arriving
 * from a source does not overwrite its origin.
 */

type Raw = DatabaseHandle['raw'];

/** Replaces the event's `SOURCE_TAG` rows with `tags`. Returns whether anything changed. */
export function replaceSourceTags(
  raw: Raw,
  eventId: string,
  tags: readonly DerivedTag[],
  at: number,
): boolean {
  const ensure = raw.prepare(
    `INSERT INTO tags (id, kind, name, normalized, aliases_json, created_at)
     VALUES (?, ?, ?, ?, '[]', ?) ON CONFLICT (kind, normalized) DO NOTHING`,
  );
  const idOf = raw.prepare('SELECT id FROM tags WHERE kind = ? AND normalized = ?');
  const wanted = new Set<string>();
  for (const tag of tags) {
    ensure.run(uuid7(), tag.kind, tag.name, tag.normalized, at);
    const row = idOf.get(tag.kind, tag.normalized) as { id: string } | undefined;
    if (row !== undefined) {
      wanted.add(row.id);
    }
  }

  const existing = new Set(
    (
      raw
        .prepare(
          `SELECT tag_id AS tagId FROM event_tags WHERE event_id = ? AND origin = 'SOURCE_TAG'`,
        )
        .all(eventId) as { tagId: string }[]
    ).map((row) => row.tagId),
  );
  let changed = false;
  const remove = raw.prepare('DELETE FROM event_tags WHERE event_id = ? AND tag_id = ?');
  for (const tagId of existing) {
    if (!wanted.has(tagId)) {
      remove.run(eventId, tagId);
      changed = true;
    }
  }
  const add = raw.prepare(
    `INSERT INTO event_tags (event_id, tag_id, origin) VALUES (?, ?, 'SOURCE_TAG')
     ON CONFLICT (event_id, tag_id) DO NOTHING`,
  );
  for (const tagId of wanted) {
    if (!existing.has(tagId)) {
      changed = add.run(eventId, tagId).changes > 0 || changed;
    }
  }
  return writeTagsText(raw, eventId) || changed;
}

/**
 * `events.tags_text`: every tag the event carries, whatever its origin, one
 * per line in a stable order. Written only when it moved, so the FTS update
 * trigger fires only for a real change.
 */
function writeTagsText(raw: Raw, eventId: string): boolean {
  const row = raw
    .prepare(
      `SELECT coalesce(group_concat(name, char(10)), '') AS text FROM (
         SELECT t.name FROM event_tags et JOIN tags t ON t.id = et.tag_id
         WHERE et.event_id = ? ORDER BY t.normalized, t.kind)`,
    )
    .get(eventId) as { text: string };
  return (
    raw
      .prepare('UPDATE events SET tags_text = ? WHERE id = ? AND tags_text <> ?')
      .run(row.text, eventId, row.text).changes > 0
  );
}
