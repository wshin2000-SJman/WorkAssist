use tauri::{plugin::{Builder, TauriPlugin}, Runtime, AppHandle, Manager};
use tokio::process::Command;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use crate::storage::Storage;
use arrow_array::RecordBatch;
use arrow_array::builder::{StringBuilder, Float32Builder, FixedSizeListBuilder};
use lancedb::connect;
use lancedb::query::{QueryBase, ExecutableQuery};




/// Resolves the path to the bundled JRE's java.exe.
///
/// In development mode, looks relative to the Cargo project root (src-tauri/bin/jre/bin/java.exe).
/// In production (bundled app), looks relative to the Tauri resource directory.
/// Dynamically locates the 'bin' directory containing the bundled resources in development mode.
/// Recursively traverses up the directory tree from the current working directory.
fn find_dev_bin_dir() -> Option<PathBuf> {
    let mut curr = std::env::current_dir().ok()?;
    loop {
        // If curr contains the jar inside 'bin', we found it (e.g. at workassist-v2/src-tauri)
        let jar_in_bin = curr.join("bin").join("opendataloader-pdf-cli.jar");
        if jar_in_bin.exists() {
            return Some(curr.join("bin"));
        }
        
        // If curr contains 'src-tauri/bin/opendataloader-pdf-cli.jar' (e.g. at workassist-v2 root)
        let jar_in_src_tauri_bin = curr.join("src-tauri").join("bin").join("opendataloader-pdf-cli.jar");
        if jar_in_src_tauri_bin.exists() {
            return Some(curr.join("src-tauri").join("bin"));
        }

        if !curr.pop() {
            break;
        }
    }
    None
}

/// Sanitizes Windows paths by removing the UNC `\\?\` prefix if present,
/// preventing execution errors with JVM which doesn't support the prefix.
fn clean_windows_path(path: PathBuf) -> String {
    let path_str = path.to_string_lossy().to_string();
    if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        path_str
    }
}

/// Helper to determine the expected output file path created by the sidecar.
fn get_output_file_path(file_path: &str, format: &str, output_dir: &Option<String>) -> PathBuf {
    let input_path = PathBuf::from(file_path);
    let file_stem = input_path.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let ext = match format {
        "json" => "json",
        "markdown" => "md",
        "text" => "txt",
        "html" => "html",
        _ => "json",
    };
    let filename = format!("{}.{}", file_stem, ext);
    
    if let Some(dir) = output_dir {
        PathBuf::from(dir).join(filename)
    } else {
        input_path.parent().unwrap_or(&input_path).join(filename)
    }
}

/// Resolves the path to the bundled JRE's java.exe.
///
/// In development mode, looks relative to the Cargo project root (src-tauri/bin/jre/bin/java.exe).
/// In production (bundled app), looks relative to the Tauri resource directory.
fn resolve_java_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    // Try production path first (resource_dir/bin/jre/bin/java.exe)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let prod_path = resource_dir.join("bin").join("jre").join("bin").join("java.exe");
        if prod_path.exists() {
            return Ok(prod_path);
        }
    }

    // Fallback to development path with dynamic traversal
    if let Some(bin_dir) = find_dev_bin_dir() {
        let dev_path = bin_dir.join("jre").join("bin").join("java.exe");
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    Err("Bundled JRE (java.exe) not found in either production or development paths.".into())
}

/// Resolves the path to the bundled opendataloader-pdf-cli.jar.
fn resolve_jar_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    // Try production path first
    if let Ok(resource_dir) = app.path().resource_dir() {
        let prod_path = resource_dir.join("bin").join("opendataloader-pdf-cli.jar");
        if prod_path.exists() {
            return Ok(prod_path);
        }
    }

    // Fallback to development path with dynamic traversal
    if let Some(bin_dir) = find_dev_bin_dir() {
        let dev_path = bin_dir.join("opendataloader-pdf-cli.jar");
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    Err("opendataloader-pdf-cli.jar not found in either production or development paths.".into())
}

/// Invokes the bundled opendataloader-pdf sidecar asynchronously.
///
/// Spawns a subprocess using the bundled JRE to execute the JAR file,
/// parses the input PDF at the given path, and returns structured JSON output.
///
/// # Arguments
/// * `app` - Tauri AppHandle for resolving resource paths
/// * `file_path` - Absolute path to the PDF file to parse
/// * `format` - Output format (json, markdown, text, html). Defaults to "json".
/// * `output_dir` - Optional output directory. Defaults to same directory as input file.
#[tauri::command]
async fn invoke_sidecar_test<R: Runtime>(
    app: AppHandle<R>,
    file_path: String,
    format: Option<String>,
    output_dir: Option<String>,
) -> Result<Value, String> {
    let java_path = resolve_java_path(&app)?;
    let jar_path = resolve_jar_path(&app)?;

    let java_path_str = clean_windows_path(java_path);
    let jar_path_str = clean_windows_path(jar_path);
    let file_path_str = clean_windows_path(PathBuf::from(&file_path));

    let output_format = format.unwrap_or_else(|| "json".to_string());
    let clean_output_dir = output_dir.map(|dir| clean_windows_path(PathBuf::from(dir)));

    println!("[RAG] Java path: {}", java_path_str);
    println!("[RAG] JAR path: {}", jar_path_str);
    println!("[RAG] Target file: {}", file_path_str);
    println!("[RAG] Format: {}", output_format);

    let mut cmd = Command::new(&java_path_str);
    // JDK 17+ module system requires explicit opens for PDFBox memory mapping
    cmd.arg("--add-opens").arg("java.base/java.nio=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/sun.nio.ch=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/jdk.internal.ref=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/java.lang=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/java.lang.invoke=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/java.lang.reflect=ALL-UNNAMED")
        .arg("-jar")
        .arg(&jar_path_str)
        .arg("--format")
        .arg(&output_format);

    if let Some(ref dir) = clean_output_dir {
        cmd.arg("--output-dir").arg(dir);
    }

    cmd.arg(&file_path_str);

    // Spawn the subprocess asynchronously — non-blocking for the main Tauri thread
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opendataloader-pdf sidecar: {}", e))?;

    let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!(
            "opendataloader-pdf exited with error (code: {:?}).\nStderr: {}\nStdout: {}",
            output.status.code(),
            stderr_str,
            stdout_str
        ));
    }

    // Determine the path of the generated output file on disk
    let output_file = get_output_file_path(&file_path_str, &output_format, &clean_output_dir);
    println!("[RAG] Expected output file: {}", output_file.display());

    let final_content = if output_file.exists() {
        std::fs::read_to_string(&output_file)
            .map_err(|e| format!("Failed to read generated output file ({}): {}", output_file.display(), e))?
    } else {
        stdout_str
    };

    // Build a structured result
    let result = serde_json::json!({
        "status": "success",
        "exit_code": output.status.code().unwrap_or(0),
        "stdout": final_content.trim(),
        "stderr": stderr_str.trim(),
        "file_processed": file_path_str,
        "format": output_format
    });

    Ok(result)
}

fn resolve_model_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let prod_path = resource_dir.join("bin").join("models").join("all-MiniLM-L6-v2.onnx");
        if prod_path.exists() {
            return Ok(prod_path);
        }
    }
    if let Some(bin_dir) = find_dev_bin_dir() {
        let dev_path = bin_dir.join("models").join("all-MiniLM-L6-v2.onnx");
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }
    Err("ONNX model (all-MiniLM-L6-v2.onnx) not found.".into())
}

fn resolve_vocab_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let prod_path = resource_dir.join("bin").join("models").join("vocab.txt");
        if prod_path.exists() {
            return Ok(prod_path);
        }
    }
    if let Some(bin_dir) = find_dev_bin_dir() {
        let dev_path = bin_dir.join("models").join("vocab.txt");
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }
    Err("Vocabulary file (vocab.txt) not found.".into())
}

#[tauri::command]
async fn generate_embeddings_test<R: Runtime>(
    app: AppHandle<R>,
    text: String,
) -> Result<Vec<f32>, String> {
    let model_path = resolve_model_path(&app)?;
    let vocab_path = resolve_vocab_path(&app)?;
    
    let engine = super::embedding::EmbeddingEngine::new(model_path, vocab_path)?;
    let embedding = engine.embed_sentence(&text)?;
    
    Ok(embedding)
}

fn map_json_item(item: &serde_json::Value) -> (String, String, String, String, String, serde_json::Value) {
    let obj = item.as_object();
    
    let get_str = |keys: &[&str]| -> Option<String> {
        obj.and_then(|o| {
            keys.iter().find_map(|&k| {
                o.get(k).and_then(|v| match v {
                    serde_json::Value::String(s) => Some(s.clone()),
                    serde_json::Value::Number(n) => Some(n.to_string()),
                    serde_json::Value::Bool(b) => Some(b.to_string()),
                    _ => None
                })
            })
        })
    };

    let part_number = get_str(&["part_number", "partNumber", "part_no", "partNo", "model", "품번", "모델명", "name"])
        .unwrap_or_else(|| format!("PART-{}", uuid::Uuid::new_v4().to_string()[..8].to_string()));
        
    let category = get_str(&["category", "type", "구분", "분류", "종류"])
        .unwrap_or_else(|| "General".to_string());
        
    let manufacturer = get_str(&["manufacturer", "manufacturer_name", "brand", "제조사", "제조원", "maker"])
        .unwrap_or_else(|| "Unknown".to_string());
        
    let description = get_str(&["description", "desc", "설명", "요약"])
        .unwrap_or_else(|| "".to_string());

    // Extract spec_data
    let spec_data = obj.and_then(|o| {
        o.get("spec_data")
            .or_else(|| o.get("specs"))
            .or_else(|| o.get("data"))
            .or_else(|| o.get("spec"))
            .cloned()
    }).unwrap_or_else(|| {
        let mut specs_map = serde_json::Map::new();
        if let Some(o) = obj {
            for (k, v) in o {
                if !["part_number", "partNumber", "part_no", "partNo", "model", "품번", "모델명", "name",
                     "category", "type", "구분", "분류", "종류",
                     "manufacturer", "manufacturer_name", "brand", "제조사", "제조원", "maker",
                     "description", "desc", "설명", "요약", "spec_data", "specs", "data", "spec"].contains(&k.as_str()) {
                    specs_map.insert(k.clone(), v.clone());
                }
            }
        }
        serde_json::Value::Object(specs_map)
    });

    let spec_data_str = spec_data.to_string();

    (part_number, category, manufacturer, description, spec_data_str, spec_data)
}

fn generate_spec_chunk_text(
    part_number: &str,
    category: &str,
    manufacturer: &str,
    description: &str,
    spec_data: &serde_json::Value
) -> String {
    let mut specs_str = String::new();
    if let Some(obj) = spec_data.as_object() {
        let mut pairs = Vec::new();
        for (k, v) in obj {
            let val_str = match v {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            pairs.push(format!("{}: {}", k, val_str));
        }
        specs_str = pairs.join(", ");
    }
    
    format!(
        "Part Number: {} | Category: {} | Manufacturer: {} | Description: {} | Key Specifications: [{}]",
        part_number, category, manufacturer, description, specs_str
    )
}

#[tauri::command]
async fn index_parsed_specs<R: Runtime>(
    app: AppHandle<R>,
    storage: tauri::State<'_, Arc<Storage>>,
    json_content: String,
    catalog_name: Option<String>,
) -> Result<Value, String> {
    let parsed_val: Value = serde_json::from_str(&json_content)
        .map_err(|e| format!("Failed to parse JSON content: {}", e))?;

    // Standardize input into a vector of items
    let items = if let Some(arr) = parsed_val.as_array() {
        arr.clone()
    } else if parsed_val.is_object() {
        vec![parsed_val]
    } else {
        return Err("Invalid JSON structure: expected a JSON array or object".into());
    };

    if items.is_empty() {
        return Ok(serde_json::json!({
            "status": "success",
            "indexed_count": 0,
            "message": "No specification items found to index."
        }));
    }

    let model_path = resolve_model_path(&app)?;
    let vocab_path = resolve_vocab_path(&app)?;
    let engine = super::embedding::EmbeddingEngine::new(model_path, vocab_path)?;

    // Initialize LanceDB connection
    let mut db_path = if cfg!(windows) {
        PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into()))
    } else {
        PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
    };
    db_path.push("SJ_WorkAssist");
    db_path.push("lancedb_data");
    let db_dir = db_path.to_string_lossy().to_string();
    std::fs::create_dir_all(&db_path).map_err(|e| format!("Failed to create LanceDB folder: {}", e))?;
    
    let lancedb_conn = connect(&db_dir)
        .execute()
        .await
        .map_err(|e| format!("Failed to connect to LanceDB: {}", e))?;

    let table_name = "specs_vectors";
    let schema = Arc::new(arrow_schema::Schema::new(vec![
        arrow_schema::Field::new("id", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("part_number", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("chunk_text", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new(
            "vector",
            arrow_schema::DataType::FixedSizeList(
                Arc::new(arrow_schema::Field::new("item", arrow_schema::DataType::Float32, true)),
                384
            ),
            false
        ),
    ]));

    let table = match lancedb_conn.open_table(table_name).execute().await {
        Ok(t) => t,
        Err(_) => {
            let batch = arrow_array::RecordBatch::new_empty(schema.clone());
            lancedb_conn
                .create_table(table_name, vec![batch])
                .execute()
                .await
                .map_err(|e| format!("Failed to create LanceDB table: {}", e))?

        }
    };

    let created_at = chrono::Local::now().to_rfc3339();
    let catalog = catalog_name.unwrap_or_else(|| "Unknown Catalog".to_string());
    
    let mut indexed_count = 0;
    
    for item in items {
        let (part_number, category, manufacturer, description, spec_data_str, spec_data) = map_json_item(&item);

        // 1. Insert/Replace in SQLite (locked in local scope to avoid holding MutexGuard across await)
        {
            let sqlite_conn = storage.conn.lock().unwrap();
            sqlite_conn.execute(
                "INSERT OR REPLACE INTO specs (part_number, category, manufacturer, catalog_name, description, spec_data, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
                rusqlite::params![part_number, category, manufacturer, &catalog, description, spec_data_str, &created_at],
            ).map_err(|e| format!("Failed to save specification to SQLite: {}", e))?;
        }

        // 2. Generate Search-Friendly Descriptive Text Chunk
        let chunk_text = generate_spec_chunk_text(&part_number, &category, &manufacturer, &description, &spec_data);

        // 3. Compute Embeddings Vector (384 Dimensions)
        let vector = engine.embed_sentence(&chunk_text)?;

        // 4. Delete existing vector record in LanceDB to avoid duplicate embeddings
        let escaped_part_number = part_number.replace("'", "''");
        let delete_predicate = format!("part_number = '{}'", escaped_part_number);
        let _ = table.delete(&delete_predicate).await;

        // 5. Construct Arrow RecordBatch for inserting to LanceDB
        let mut id_builder = StringBuilder::new();
        let mut part_number_builder = StringBuilder::new();
        let mut chunk_text_builder = StringBuilder::new();
        let mut vector_builder = FixedSizeListBuilder::new(Float32Builder::new(), 384);

        let chunk_id = format!("{}_{}", part_number, indexed_count);
        id_builder.append_value(&chunk_id);
        part_number_builder.append_value(&part_number);
        chunk_text_builder.append_value(&chunk_text);
        
        for &val in &vector {
            vector_builder.values().append_value(val);
        }
        vector_builder.append(true);

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(id_builder.finish()),
                Arc::new(part_number_builder.finish()),
                Arc::new(chunk_text_builder.finish()),
                Arc::new(vector_builder.finish()),
            ]
        ).map_err(|e| format!("Failed to build Arrow record batch for LanceDB: {}", e))?;

        // 6. Append data using table.add
        table.add(vec![batch])
            .execute()
            .await
            .map_err(|e| format!("Failed to insert vector into LanceDB: {}", e))?;

        indexed_count += 1;
    }

    Ok(serde_json::json!({
        "status": "success",
        "indexed_count": indexed_count,
        "message": format!("Successfully indexed {} specification(s) to SQLite & LanceDB.", indexed_count)
    }))
}

#[tauri::command]
async fn search_specs<R: Runtime>(
    app: AppHandle<R>,
    storage: tauri::State<'_, Arc<Storage>>,
    query: String,
    limit: Option<usize>,
) -> Result<Value, String> {
    let limit = limit.unwrap_or(5);
    
    let model_path = resolve_model_path(&app)?;
    let vocab_path = resolve_vocab_path(&app)?;
    let engine = super::embedding::EmbeddingEngine::new(model_path, vocab_path)?;
    
    // 1. Generate Query Vector Embedding
    let query_vector = engine.embed_sentence(&query)?;

    // 2. Initialize LanceDB connection
    let mut db_path = if cfg!(windows) {
        PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into()))
    } else {
        PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
    };
    db_path.push("SJ_WorkAssist");
    db_path.push("lancedb_data");
    let db_dir = db_path.to_string_lossy().to_string();
    
    if !db_path.exists() {
        return Ok(serde_json::json!([]));
    }

    let lancedb_conn = connect(&db_dir)
        .execute()
        .await
        .map_err(|e| format!("Failed to connect to LanceDB: {}", e))?;

    let table_name = "specs_vectors";
    let table = match lancedb_conn.open_table(table_name).execute().await {
        Ok(t) => t,
        Err(_) => return Ok(serde_json::json!([])), // Return empty list if table not initialized
    };

    // 3. Execute Vector Search
    let query_result = table
        .query()
        .nearest_to(query_vector)
        .map_err(|e| format!("Failed to create vector query: {}", e))?

        .limit(limit)
        .execute()
        .await
        .map_err(|e| format!("Vector search error: {}", e))?;

    // Collect Arrow RecordBatches
    use futures::stream::StreamExt;
    let mut stream = query_result;
    let mut search_hits = Vec::new();

    while let Some(batch_res) = stream.next().await {
        let batch = batch_res.map_err(|e| format!("Arrow stream batch error: {}", e))?;
        
        let ids = batch.column_by_name("id")
            .ok_or("id column not found in LanceDB")?
            .as_any()
            .downcast_ref::<arrow_array::StringArray>()
            .ok_or("Failed to downcast id column to StringArray")?;

        let part_numbers = batch.column_by_name("part_number")
            .ok_or("part_number column not found in LanceDB")?
            .as_any()
            .downcast_ref::<arrow_array::StringArray>()
            .ok_or("Failed to downcast part_number column to StringArray")?;

        let chunk_texts = batch.column_by_name("chunk_text")
            .ok_or("chunk_text column not found in LanceDB")?
            .as_any()
            .downcast_ref::<arrow_array::StringArray>()
            .ok_or("Failed to downcast chunk_text column to StringArray")?;

        let distances = batch.column_by_name("_distance")
            .map(|c| c.as_any().downcast_ref::<arrow_array::Float32Array>().ok_or("Failed to downcast _distance to Float32Array"))
            .transpose()?;

        for i in 0..batch.num_rows() {
            let id = ids.value(i).to_string();
            let part_number = part_numbers.value(i).to_string();
            let chunk_text = chunk_texts.value(i).to_string();
            let score = distances.map(|d| d.value(i)).unwrap_or(0.0);
            
            search_hits.push((id, part_number, chunk_text, score));
        }
    }

    // 4. Retrieve complete specification metadata from SQLite for each unique part number
    let sqlite_conn = storage.conn.lock().unwrap();
    let mut results = Vec::new();

    for (_id, part_number, chunk_text, score) in search_hits {
        // Query SQLite specs metadata
        let spec_meta: Option<(String, String, Option<String>, Option<String>, String)> = sqlite_conn.query_row(
            "SELECT category, manufacturer, catalog_name, description, spec_data FROM specs WHERE part_number = ?",
            [&part_number],
            |row| Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?
            ))
        ).ok();

        if let Some((category, manufacturer, catalog_name, description, spec_data_str)) = spec_meta {
            let spec_data_val: Value = serde_json::from_str(&spec_data_str).unwrap_or(serde_json::Value::Null);
            results.push(serde_json::json!({
                "part_number": part_number,
                "category": category,
                "manufacturer": manufacturer,
                "catalog_name": catalog_name,
                "description": description,
                "spec_data": spec_data_val,
                "chunk_text": chunk_text,
                "similarity_score": score
            }));
        } else {
            results.push(serde_json::json!({
                "part_number": part_number,
                "chunk_text": chunk_text,
                "similarity_score": score
            }));
        }
    }

    Ok(serde_json::json!(results))
}

/// Parses an Excel workbook (xlsx, xls, xlsb, ods) offline using calamine.
///
/// Returns a JSON structure containing all worksheets, each represented as
/// an array of row-objects where the first row provides the column keys.
///
/// # Arguments
/// * `file_path` – Absolute path to the spreadsheet file.
#[tauri::command]
async fn parse_excel(
    file_path: String,
) -> Result<Value, String> {
    use calamine::{open_workbook_auto, Reader, Data};

    let mut workbook = open_workbook_auto(&file_path)
        .map_err(|e| format!("Failed to open workbook '{}': {}", file_path, e))?;

    let sheet_names: Vec<String> = workbook.sheet_names().to_vec();

    if sheet_names.is_empty() {
        return Ok(serde_json::json!({
            "status": "success",
            "sheets": {},
            "sheet_names": [],
            "message": "The workbook contains no worksheets."
        }));
    }

    let mut sheets_map = serde_json::Map::new();

    for name in &sheet_names {
        let range = workbook.worksheet_range(name)
            .map_err(|e| format!("Failed to read sheet '{}': {}", name, e))?;

        let mut rows_iter = range.rows();

        // First row → column header keys
        let headers: Vec<String> = match rows_iter.next() {
            Some(first_row) => first_row.iter().map(|cell| cell_to_string(cell)).collect(),
            None => {
                sheets_map.insert(name.clone(), serde_json::json!([]));
                continue;
            }
        };

        // Remaining rows → data objects
        let mut data_rows: Vec<Value> = Vec::new();
        for row in rows_iter {
            // Skip entirely empty rows
            if row.iter().all(|c| matches!(c, Data::Empty)) {
                continue;
            }
            let mut obj = serde_json::Map::new();
            for (i, cell) in row.iter().enumerate() {
                let key = headers.get(i)
                    .cloned()
                    .unwrap_or_else(|| format!("column_{}", i));
                obj.insert(key, cell_to_json(cell));
            }
            data_rows.push(Value::Object(obj));
        }

        sheets_map.insert(name.clone(), Value::Array(data_rows));
    }

    Ok(serde_json::json!({
        "status": "success",
        "sheets": sheets_map,
        "sheet_names": sheet_names,
        "message": format!("Successfully parsed {} worksheet(s).", sheet_names.len())
    }))
}

/// Converts a calamine Data cell to a plain string (for header keys).
fn cell_to_string(cell: &calamine::Data) -> String {
    use calamine::Data;
    match cell {
        Data::Empty => String::new(),
        Data::String(s) => s.clone(),
        Data::Float(f) => {
            if *f == (*f as i64) as f64 { format!("{}", *f as i64) } else { format!("{}", f) }
        }
        Data::Int(i) => format!("{}", i),
        Data::Bool(b) => format!("{}", b),
        Data::DateTime(dt) => format!("{}", dt),
        Data::DateTimeIso(s) => s.clone(),
        Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("{:?}", e),
    }
}

/// Converts a calamine Data cell to a serde_json Value (for row data).
fn cell_to_json(cell: &calamine::Data) -> Value {
    use calamine::Data;
    match cell {
        Data::Empty => Value::Null,
        Data::String(s) => Value::String(s.clone()),
        Data::Float(f) => serde_json::json!(*f),
        Data::Int(i) => serde_json::json!(*i),
        Data::Bool(b) => Value::Bool(*b),
        Data::DateTime(dt) => Value::String(format!("{}", dt)),
        Data::DateTimeIso(s) => Value::String(s.clone()),
        Data::DurationIso(s) => Value::String(s.clone()),
        Data::Error(e) => Value::String(format!("{:?}", e)),
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("rag")
        .invoke_handler(tauri::generate_handler![
            invoke_sidecar_test,
            generate_embeddings_test,
            index_parsed_specs,
            search_specs,
            parse_excel
        ])
        .build()
}

