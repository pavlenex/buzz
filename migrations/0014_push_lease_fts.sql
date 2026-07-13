-- NIP-PL kind:30350 contains endpoint-bearing NIP-44 ciphertext and is
-- author-only. Preserve the positive search allowlist introduced by 0008, which
-- excludes 30350 (and every other non-allowlisted kind) at the storage layer.
ALTER TABLE events DROP COLUMN search_tsv;
ALTER TABLE events ADD COLUMN search_tsv TSVECTOR GENERATED ALWAYS AS (
    CASE WHEN kind IN (0, 9, 40002, 45001, 45003)
         THEN to_tsvector('simple', content)
         ELSE NULL::tsvector
    END
) STORED;
CREATE INDEX idx_events_search_tsv ON events USING GIN (search_tsv);
