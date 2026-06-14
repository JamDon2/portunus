use std::path::Path;
use std::sync::Arc;

use super::{Provider, SearchResult, SCORE_CONTENT};
use crate::content_index::ContentIndex;

pub struct ContentProvider {
    index: Arc<ContentIndex>,
    /// SQL row cap for the FTS query. Mirrors the launcher's `max_results` so we
    /// only `snippet()` the rows that will actually be shown - snippet generation
    /// is the dominant per-query cost, so fetching the old fixed 50 and discarding
    /// all but `max_results` wasted most of it on common-word queries.
    max_results: usize,
}

impl ContentProvider {
    pub fn new(index: Arc<ContentIndex>, max_results: usize) -> Self {
        Self { index, max_results }
    }
}

impl Provider for ContentProvider {
    fn id(&self) -> &str {
        "content"
    }

    fn search(&self, query: &str) -> Vec<SearchResult> {
        // Content scope is selected by the caller (PluginRegistry::search_content),
        // so the raw query is the search term - no activation prefix to strip.
        let q = query.trim();
        if q.len() < 2 {
            return vec![];
        }

        // Parse into deduped, stopword-stripped FTS terms. Dedup + stopword
        // stripping bound the common-term cost; an all-stopword query comes back
        // `ranked = false` so the search skips the corpus-wide bm25 sort.
        let Some(parsed) = crate::content_index::parse_content_query(q) else {
            return vec![];
        };
        // FTS5 treats space-separated terms as AND.
        let fts_query = parsed.tokens.join(" ");

        match self.index.search(&fts_query, self.max_results.max(1), parsed.ranked) {
            Ok(results) => results
                .into_iter()
                .map(|(path, rank, snip, mtime, size)| {
                    let p = Path::new(&path);
                    let title = p
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(&path)
                        .to_owned();
                    let parent = p
                        .parent()
                        .and_then(|p| p.to_str())
                        .unwrap_or("")
                        .to_owned();
                    let escaped = path.replace('"', "\\\"");
                    // `match_page` is computed lazily by the `content_match_page`
                    // command only for the file actually being previewed - computing
                    // it here ran a full per-PDF page rescan for every one of the (up
                    // to 50) results on each keystroke, which for common-word queries
                    // dominated content-search latency.
                    let created = std::fs::metadata(&path)
                        .ok()
                        .and_then(|m| m.created().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs());
                    SearchResult {
                        id: format!("file:{path}"),
                        title,
                        subtitle: Some(parent),
                        snippet: Some(snip),
                        kind: "file".to_string(),
                        score: SCORE_CONTENT + (-rank as f32) * 1000.0,
                        exec: Some(format!("xdg-open \"{escaped}\"")),
                        file_size: if size > 0 { Some(size) } else { None },
                        created,
                        modified: if mtime > 0 { Some(mtime as u64) } else { None },
                        ..Default::default()
                    }
                })
                .collect(),
            Err(e) => {
                eprintln!("[content] search error: {e}");
                vec![]
            }
        }
    }
}
