use rusqlite::{params, OptionalExtension, Connection};
use rand::{Rng, thread_rng};
use regex::Regex;

pub struct SecurityEngine;

impl SecurityEngine {
    /// Tokenizes the input text by replacing detected entities with tokens from the vault.
    pub fn tokenize(conn: &Connection, text: &str) -> String {
        if text.is_empty() {
            return String::new();
        }

        let mut tokenized_text = text.to_string();

        let re = Regex::new(r"\b([A-Z][a-zA-Z0-9]+(?:-[A-Z0-9][a-zA-Z0-9]*)?)\b").unwrap();
        
        let matches: Vec<String> = re.find_iter(text)
            .map(|m| m.as_str().to_string())
            .collect();

        let mut unique_matches = matches;
        unique_matches.sort_by(|a, b| b.len().cmp(&a.len()));
        unique_matches.dedup();

        for entity in unique_matches {
            let token = Self::get_or_create_token(conn, &entity, "GENERAL");
            tokenized_text = tokenized_text.replace(&entity, &token);
        }

        tokenized_text
    }

    /// Detokenizes the text by replacing tokens back with original text from the vault.
    pub fn detokenize(conn: &Connection, text: &str) -> String {
        let mut raw_text = text.to_string();
        
        let mut stmt = conn.prepare("SELECT original_text, token_id FROM secure_vault").unwrap();
        let vault_iter = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).unwrap();

        for entry in vault_iter {
            if let Ok((original, token)) = entry {
                raw_text = raw_text.replace(&token, &original);
            }
        }

        raw_text
    }

    fn get_or_create_token(conn: &Connection, original: &str, entity_type: &str) -> String {
        // 1. Check if already exists in vault
        let existing: Option<String> = conn.query_row(
            "SELECT token_id FROM secure_vault WHERE original_text = ?",
            params![original],
            |row| row.get(0)
        ).optional().unwrap();

        if let Some(token) = existing {
            return token;
        }

        // 2. Create new token if not exists
        let random_id: u32 = thread_rng().gen_range(1000..9999);
        let prefix = match entity_type {
            "PROJECT" => "PROJ",
            "USER" => "USER",
            _ => "WA",
        };
        let new_token = format!("[{}-{}]", prefix, random_id);

        let _ = conn.execute(
            "INSERT INTO secure_vault (original_text, token_id, entity_type) VALUES (?, ?, ?)",
            params![original, new_token, entity_type]
        );

        new_token
    }
}
