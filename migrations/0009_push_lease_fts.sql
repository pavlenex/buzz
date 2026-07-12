-- NIP-PL kind:30350 contains endpoint-bearing NIP-44 ciphertext and is
-- author-only. Exclude it from full-text search as a storage-level backstop.
ALTER TABLE events DROP COLUMN search_tsv;
ALTER TABLE events ADD COLUMN search_tsv TSVECTOR GENERATED ALWAYS AS (
    CASE WHEN kind IN (1059, 30300, 30350, 30622, 44100, 44101, 44200) THEN NULL::tsvector
         ELSE to_tsvector('simple', content)
    END
) STORED;
CREATE INDEX idx_events_search_tsv ON events USING GIN (search_tsv);
