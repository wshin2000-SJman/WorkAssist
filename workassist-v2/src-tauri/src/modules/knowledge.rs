use tauri::{plugin::{Builder, TauriPlugin}, Runtime, AppHandle, Manager, State};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use oxigraph::store::Store;
use oxigraph::model::*;
use oxigraph::sparql::{QueryResults, SparqlEvaluator};
use calamine::{Reader, open_workbook, Xlsx, DataType};
use arrow_array::RecordBatch;
use arrow_array::builder::{StringBuilder, Float32Builder, FixedSizeListBuilder};
use lancedb::connect;

/// Simple wrapper around Oxigraph's store to make it thread-safe and shareable.
pub struct KnowledgeStore {
    pub store: Store,
}

impl KnowledgeStore {
    pub fn new() -> Result<Self, String> {
        let mut db_path = if cfg!(windows) {
            PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into()))
        } else {
            PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
        };
        db_path.push("SJ_WorkAssist");
        db_path.push("oxigraph_data");
        std::fs::create_dir_all(&db_path).map_err(|e| format!("Failed to create Oxigraph data folder: {}", e))?;
        
        let store = Store::open(&db_path)
            .map_err(|e| format!("Failed to open Oxigraph RDF store: {}", e))?;
            
        Ok(Self { store })
    }
}

// --- HELPER FUNCTIONS ---

fn term_to_json_value(term: &Term) -> Value {
    match term {
        Term::NamedNode(n) => serde_json::json!({
            "type": "uri",
            "value": n.as_str()
        }),
        Term::BlankNode(b) => serde_json::json!({
            "type": "bnode",
            "value": b.as_str()
        }),
        Term::Literal(l) => {
            let datatype = l.datatype().as_str();
            serde_json::json!({
                "type": "literal",
                "value": l.value(),
                "datatype": datatype
            })
        }
    }
}

fn resolve_dev_bin_dir() -> Option<PathBuf> {
    let mut curr = std::env::current_dir().ok()?;
    loop {
        let jar_in_bin = curr.join("bin").join("opendataloader-pdf-cli.jar");
        if jar_in_bin.exists() {
            return Some(curr.join("bin"));
        }
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

fn resolve_java_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let prod_path = resource_dir.join("bin").join("jre").join("bin").join("java.exe");
        if prod_path.exists() {
            return Ok(prod_path);
        }
    }
    if let Some(bin_dir) = resolve_dev_bin_dir() {
        let dev_path = bin_dir.join("jre").join("bin").join("java.exe");
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }
    Err("Bundled JRE (java.exe) not found.".into())
}

fn resolve_jar_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let prod_path = resource_dir.join("bin").join("opendataloader-pdf-cli.jar");
        if prod_path.exists() {
            return Ok(prod_path);
        }
    }
    if let Some(bin_dir) = resolve_dev_bin_dir() {
        let dev_path = bin_dir.join("opendataloader-pdf-cli.jar");
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }
    Err("opendataloader-pdf-cli.jar not found.".into())
}

fn resolve_model_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let prod_path = resource_dir.join("bin").join("models").join("all-MiniLM-L6-v2.onnx");
        if prod_path.exists() {
            return Ok(prod_path);
        }
    }
    if let Some(bin_dir) = resolve_dev_bin_dir() {
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
    if let Some(bin_dir) = resolve_dev_bin_dir() {
        let dev_path = bin_dir.join("models").join("vocab.txt");
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }
    Err("Vocabulary file (vocab.txt) not found.".into())
}

fn sanitize_path(path: PathBuf) -> String {
    let path_str = path.to_string_lossy().to_string();
    if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        path_str
    }
}

// --- TAURI COMMANDS ---

#[tauri::command]
async fn register_project(
    state: State<'_, Arc<Mutex<KnowledgeStore>>>,
    project_code: String,
    project_name: String,
    manager: String,
    customer: String,
    description: Option<String>,
) -> Result<Value, String> {
    let store_guard = state.lock().map_err(|e| e.to_string())?;
    
    let sanitized_code = project_code.trim().replace(" ", "_");
    let desc = description.unwrap_or_default().replace("\"", "\\\"");
    let name = project_name.replace("\"", "\\\"");
    let mgr = manager.replace("\"", "\\\"");
    let cust = customer.replace("\"", "\\\"");

    let update_query = format!(
        r#"
        PREFIX wa: <http://workassist.local/ontology/>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        
        INSERT DATA {{
            wa:Project_{code} rdf:type wa:Project ;
                              wa:projectCode "{code}" ;
                              wa:projectName "{name}" ;
                              wa:manager "{manager}" ;
                              wa:customer "{customer}" ;
                              wa:description "{desc}" .
        }}
        "#,
        code = sanitized_code,
        name = name,
        manager = mgr,
        customer = cust,
        desc = desc
    );

    store_guard.store.update(&update_query)
        .map_err(|e| format!("Failed to register project in Oxigraph: {}", e))?;

    Ok(serde_json::json!({
        "status": "success",
        "message": format!("Successfully registered project: {}", sanitized_code)
    }))
}

#[tauri::command]
async fn ingest_bom(
    state: State<'_, Arc<Mutex<KnowledgeStore>>>,
    project_code: String,
    excel_path: String,
) -> Result<Value, String> {
    let store_guard = state.lock().map_err(|e| e.to_string())?;
    
    let path = PathBuf::from(&excel_path);
    if !path.exists() {
        return Err(format!("Excel file not found at: {}", excel_path));
    }

    let mut workbook: Xlsx<_> = open_workbook(&path)
        .map_err(|e| format!("Failed to open excel workbook: {}", e))?;
        
    let sheet_name = workbook.sheet_names().first()
        .ok_or_else(|| "No sheet found in excel workbook".to_string())?.clone();
        
    let range = workbook.worksheet_range(&sheet_name)
        .map_err(|e| format!("Failed to read sheet: {}. Error: {}", sheet_name, e))?;

    let mut header_idx = None;
    let mut part_col_idx = None;
    let mut qty_col_idx = None;
    let mut desc_col_idx = None;
    let mut cat_col_idx = None;
    let mut maker_col_idx = None;
    let mut name_col_idx = None;
    let mut spec_col_idx = None;

    let rows: Vec<_> = range.rows().collect();

    for (r_idx, row) in rows.iter().enumerate() {
        let mut temp_part = None;
        let mut temp_qty = None;
        let mut temp_desc = None;
        let mut temp_cat = None;
        let mut temp_maker = None;
        let mut temp_name = None;
        let mut temp_spec = None;

        for (c_idx, cell) in row.iter().enumerate() {
            let cell_str = cell.to_string().trim().to_lowercase();
            if cell_str.is_empty() {
                continue;
            }
            if cell_str.contains("품번") || cell_str.contains("part") || cell_str.contains("모델") || cell_str.contains("코드") || cell_str.contains("부품번호") || cell_str.contains("부품 번호") || cell_str.contains("도면번호") || cell_str.contains("도면 번호") {
                temp_part = Some(c_idx);
            } else if cell_str.contains("수량") || cell_str.contains("qty") || cell_str.contains("quantity") || cell_str == "수" || cell_str == "수 량" {
                temp_qty = Some(c_idx);
            } else if cell_str.contains("설명") || cell_str.contains("desc") || cell_str.contains("비고") {
                temp_desc = Some(c_idx);
            } else if cell_str.contains("규격") || cell_str.contains("spec") || cell_str.contains("사양") {
                temp_spec = Some(c_idx);
            } else if cell_str.contains("구분") || cell_str.contains("분류") || cell_str.contains("카테고리") || cell_str.contains("type") || cell_str.contains("category") || cell_str.contains("유형") {
                temp_cat = Some(c_idx);
            } else if cell_str.contains("메이커") || cell_str.contains("maker") || cell_str.contains("제조사") {
                temp_maker = Some(c_idx);
            } else if cell_str.contains("항목") || cell_str.contains("품명") || cell_str.contains("품목") || cell_str.contains("name") || cell_str.contains("item") {
                temp_name = Some(c_idx);
            }
        }

        // '부품번호'와 '수량'이 모두 존재하면 이 행을 헤더 행으로 설정
        if temp_part.is_some() && temp_qty.is_some() {
            header_idx = Some(r_idx);
            part_col_idx = temp_part;
            qty_col_idx = temp_qty;
            desc_col_idx = temp_desc;
            cat_col_idx = temp_cat;
            maker_col_idx = temp_maker;
            name_col_idx = temp_name;
            spec_col_idx = temp_spec;
            break;
        }
    }

    let header_idx = header_idx.ok_or_else(|| "Could not locate 'Part Number' or '품번' column in BOM Excel.".to_string())?;
    let part_idx = part_col_idx.unwrap();
    let qty_idx = qty_col_idx.unwrap();

    let sanitized_project = project_code.trim().replace(" ", "_");
    let mut triples_block = String::new();
    let mut row_count = 0;

    for (offset_idx, row) in rows.iter().skip(header_idx + 1).enumerate() {
        let part_number = row.get(part_idx).map(|c| c.to_string().trim().to_string()).unwrap_or_default();
        if part_number.is_empty() {
            continue;
        }

        // 스킵 조건: 파트 번호 컬럼 값이 실제 헤더 명칭과 같거나 임시 구분선인 경우
        if part_number == "부품번호" || part_number == "품번" || part_number == "part number" || part_number.starts_with("---") {
            continue;
        }

        let quantity = row.get(qty_idx)
            .and_then(|c| {
                if let Some(i) = c.as_i64() {
                    Some(i)
                } else if let Some(f) = c.as_f64() {
                    Some(f as i64)
                } else if let Some(s) = c.as_string() {
                    s.trim().parse::<i64>().ok()
                } else {
                    None
                }
            })
            .unwrap_or(1);

        let category = cat_col_idx.and_then(|idx| row.get(idx)).map(|c| c.to_string().trim().replace("\"", "\\\"")).unwrap_or_else(|| "GeneralComponent".to_string());
        let item_name = name_col_idx.and_then(|idx| row.get(idx)).map(|c| c.to_string().trim().replace("\"", "\\\"")).unwrap_or_default();
        let maker = maker_col_idx.and_then(|idx| row.get(idx)).map(|c| c.to_string().trim().replace("\"", "\\\"")).unwrap_or_default();
        let spec = spec_col_idx.and_then(|idx| row.get(idx)).map(|c| c.to_string().trim().replace("\"", "\\\"")).unwrap_or_default();
        let description = desc_col_idx.and_then(|idx| row.get(idx)).map(|c| c.to_string().trim().replace("\"", "\\\"")).unwrap_or_default();
        
        let sanitized_part = part_number.replace(" ", "_").replace("/", "-").replace("\\", "-").replace("\"", "");
        let bom_item_uri = format!("BOM_{}_{}", sanitized_project, offset_idx);

        triples_block.push_str(&format!(
            r#"
            wa:Project_{project} wa:hasBOMItem wa:{bom_item} .
            wa:{bom_item} rdf:type wa:BOMItem ;
                           wa:partNumber "{part}" ;
                           wa:quantity {qty} .
            wa:Component_{part_uri} rdf:type wa:Component ;
                                    wa:partNumber "{part}" ;
                                    wa:category "{cat}" ;
                                    wa:itemName "{name}" ;
                                    wa:maker "{maker}" ;
                                    wa:spec "{spec}" ;
                                    wa:description "{desc}" .
            wa:{bom_item} wa:refersToComponent wa:Component_{part_uri} .
            "#,
            project = sanitized_project,
            bom_item = bom_item_uri,
            part = part_number,
            qty = quantity,
            part_uri = sanitized_part,
            cat = if category.is_empty() { "GeneralComponent".to_string() } else { category },
            name = item_name,
            maker = maker,
            spec = spec,
            desc = description
        ));
        row_count += 1;
    }

    if row_count > 0 {
        let update_query = format!(
            r#"
            PREFIX wa: <http://workassist.local/ontology/>
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
            
            INSERT DATA {{
                {}
            }}
            "#,
            triples_block
        );

        store_guard.store.update(&update_query)
            .map_err(|e| format!("Failed to insert BOM triples in Oxigraph: {}", e))?;
    }

    Ok(serde_json::json!({
        "status": "success",
        "processed_rows": row_count,
        "message": format!("Successfully processed {} BOM items for project {}.", row_count, sanitized_project)
    }))
}

#[tauri::command]
async fn ingest_project_document<R: Runtime>(
    app: AppHandle<R>,
    project_code: String,
    doc_type: String,
    file_path: String,
) -> Result<Value, String> {
    let java_path = resolve_java_path(&app)?;
    let jar_path = resolve_jar_path(&app)?;
    let model_path = resolve_model_path(&app)?;
    let vocab_path = resolve_vocab_path(&app)?;

    let java_path_str = sanitize_path(java_path);
    let jar_path_str = sanitize_path(jar_path);
    let file_path_str = sanitize_path(PathBuf::from(&file_path));

    let output_dir = PathBuf::from(std::env::var("TEMP").unwrap_or_else(|_| ".".into()));
    let output_dir_str = sanitize_path(output_dir.clone());

    // 1. Invoke PDF parsing sidecar
    let mut cmd = tokio::process::Command::new(&java_path_str);
    cmd.arg("--add-opens").arg("java.base/java.nio=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/sun.nio.ch=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/jdk.internal.ref=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/java.lang=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/java.lang.invoke=ALL-UNNAMED")
        .arg("--add-opens").arg("java.base/java.lang.reflect=ALL-UNNAMED")
        .arg("-jar")
        .arg(&jar_path_str)
        .arg("--format")
        .arg("text")
        .arg("--output-dir")
        .arg(&output_dir_str)
        .arg(&file_path_str);

    let output = cmd.output().await
        .map_err(|e| format!("Failed to invoke pdf sidecar: {}", e))?;

    if !output.status.success() {
        return Err(format!("PDF Parser failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let file_stem = PathBuf::from(&file_path).file_stem().unwrap_or_default().to_string_lossy().to_string();
    let expected_txt_file = output_dir.join(format!("{}.txt", file_stem));
    let doc_content = if expected_txt_file.exists() {
        let content = std::fs::read_to_string(&expected_txt_file)
            .map_err(|e| format!("Failed to read txt file: {}", e))?;
        let _ = std::fs::remove_file(&expected_txt_file); // cleanup
        content
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };

    if doc_content.trim().is_empty() {
        return Err("The parsed document content is empty.".into());
    }

    // 2. Setup Embedding Engine
    let engine = super::embedding::EmbeddingEngine::new(model_path, vocab_path)?;

    // 3. Connect to LanceDB and ensure Table exists
    let mut db_path = if cfg!(windows) {
        PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into()))
    } else {
        PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
    };
    db_path.push("SJ_WorkAssist");
    db_path.push("lancedb_data");
    let db_dir = db_path.to_string_lossy().to_string();
    std::fs::create_dir_all(&db_path).map_err(|e| format!("Failed to create LanceDB folder: {}", e))?;

    let lancedb_conn = connect(&db_dir).execute().await
        .map_err(|e| format!("Failed to connect to LanceDB: {}", e))?;

    let table_name = "project_docs_vectors";
    let schema = Arc::new(arrow_schema::Schema::new(vec![
        arrow_schema::Field::new("id", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("project_code", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("doc_type", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("file_path", arrow_schema::DataType::Utf8, false),
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
            lancedb_conn.create_table(table_name, vec![batch]).execute().await
                .map_err(|e| format!("Failed to create project docs table in LanceDB: {}", e))?
        }
    };

    // 4. Split document into chunks and generate vector embeddings
    let chars: Vec<char> = doc_content.chars().collect();
    let chunk_size = 600; // character length
    let overlap = 100;
    
    let mut start = 0;
    let mut chunk_idx = 0;

    while start < chars.len() {
        let end = std::cmp::min(start + chunk_size, chars.len());
        let chunk_text: String = chars[start..end].iter().collect();
        start += chunk_size - overlap;

        if chunk_text.trim().is_empty() {
            continue;
        }

        let vector = engine.embed_sentence(&chunk_text)?;

        let mut id_builder = StringBuilder::new();
        let mut proj_builder = StringBuilder::new();
        let mut type_builder = StringBuilder::new();
        let mut path_builder = StringBuilder::new();
        let mut chunk_text_builder = StringBuilder::new();
        let mut vector_builder = FixedSizeListBuilder::new(Float32Builder::new(), 384);

        let chunk_id = format!("{}_{}_{}", project_code, file_stem, chunk_idx);
        id_builder.append_value(&chunk_id);
        proj_builder.append_value(&project_code);
        type_builder.append_value(&doc_type);
        path_builder.append_value(&file_path);
        chunk_text_builder.append_value(&chunk_text);

        for &val in &vector {
            vector_builder.values().append_value(val);
        }
        vector_builder.append(true);

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(id_builder.finish()),
                Arc::new(proj_builder.finish()),
                Arc::new(type_builder.finish()),
                Arc::new(path_builder.finish()),
                Arc::new(chunk_text_builder.finish()),
                Arc::new(vector_builder.finish()),
            ]
        ).map_err(|e| format!("Failed to construct Arrow batch: {}", e))?;

        table.add(vec![batch]).execute().await
            .map_err(|e| format!("Failed to add document chunk to LanceDB: {}", e))?;

        chunk_idx += 1;
    }

    Ok(serde_json::json!({
        "status": "success",
        "chunks_indexed": chunk_idx,
        "message": format!("Successfully parsed and indexed document: {} ({} chunks).", file_stem, chunk_idx)
    }))
}

#[tauri::command]
async fn query_knowledge(
    state: State<'_, Arc<Mutex<KnowledgeStore>>>,
    query: String,
) -> Result<Value, String> {
    let store_guard = state.lock().map_err(|e| e.to_string())?;

    let query_result = store_guard.store.query(&query)
        .map_err(|e| format!("SPARQL evaluation error: {}", e))?;

    if let QueryResults::Solutions(solutions) = query_result {
        let mut results = Vec::new();
        for solution in solutions {
            let solution = solution.map_err(|e| e.to_string())?;
            let mut row = serde_json::Map::new();
            for (var, term) in solution.iter() {
                row.insert(var.as_str().to_string(), term_to_json_value(term));
            }
            results.push(Value::Object(row));
        }
        Ok(Value::Array(results))
    } else {
        Ok(serde_json::json!([]))
    }
}

#[tauri::command]
async fn get_graph_data(
    state: State<'_, Arc<Mutex<KnowledgeStore>>>,
    project_code: Option<String>,
) -> Result<Value, String> {
    let store_guard = state.lock().map_err(|e| e.to_string())?;

    // If a project code is given, limit the scope. Otherwise, fetch everything (capped at 150 triples for performance)
    let sparql_query = if let Some(code) = project_code {
        format!(
            r#"
            PREFIX wa: <http://workassist.local/ontology/>
            SELECT ?s ?p ?o WHERE {{
                {{
                    ?s ?p ?o .
                    FILTER(?s = wa:Project_{code} || ?o = wa:Project_{code})
                }} UNION {{
                    wa:Project_{code} wa:hasBOMItem ?bom .
                    ?bom ?p ?o .
                    BIND(?bom AS ?s)
                }}
            }} LIMIT 150
            "#,
            code = code.trim().replace(" ", "_")
        )
    } else {
        r#"
        SELECT ?s ?p ?o WHERE {
            ?s ?p ?o .
        } LIMIT 150
        "#.to_string()
    };

    let query_result = store_guard.store.query(&sparql_query)
        .map_err(|e| format!("SPARQL query failed: {}", e))?;

    let mut nodes_map = std::collections::HashMap::new();
    let mut links = Vec::new();

    if let QueryResults::Solutions(solutions) = query_result {
        for solution in solutions {
            let sol = solution.map_err(|e| e.to_string())?;
            let s = sol.get("s");
            let p = sol.get("p");
            let o = sol.get("o");

            if let (Some(s_term), Some(p_term), Some(o_term)) = (s, p, o) {
                let s_str = match s_term {
                    Term::NamedNode(n) => n.as_str().to_string(),
                    other => other.to_string()
                };
                let p_str = match p_term {
                    Term::NamedNode(n) => n.as_str().to_string(),
                    other => other.to_string()
                };
                let o_str = match o_term {
                    Term::NamedNode(n) => n.as_str().to_string(),
                    Term::Literal(l) => l.value().to_string(),
                    other => other.to_string()
                };

                // Shorten URIs for visual aesthetics
                let shorten = |uri: &str| -> String {
                    uri.replace("http://workassist.local/ontology/", "wa:")
                       .replace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "rdf:")
                };

                let s_short = shorten(&s_str);
                let p_short = shorten(&p_str);
                let o_short = shorten(&o_str);

                // Skip standard high-frequency triples if they clutter visual graph
                if p_short == "rdf:type" && o_short == "wa:BOMItem" {
                    continue;
                }

                // Determine node categories
                let get_group = |id: &str| -> &'static str {
                    if id.starts_with("wa:Project_") { "Project" }
                    else if id.starts_with("wa:BOM_") { "BOM" }
                    else if id.starts_with("wa:Component_") { "Component" }
                    else { "Literal" }
                };

                nodes_map.entry(s_short.clone()).or_insert_with(|| serde_json::json!({
                    "id": s_short.clone(),
                    "label": s_short.replace("wa:Project_", "").replace("wa:Component_", ""),
                    "group": get_group(&s_short)
                }));

                nodes_map.entry(o_short.clone()).or_insert_with(|| serde_json::json!({
                    "id": o_short.clone(),
                    "label": o_short.replace("wa:Project_", "").replace("wa:Component_", ""),
                    "group": get_group(&o_short)
                }));

                links.push(serde_json::json!({
                    "source": s_short,
                    "target": o_short,
                    "type": p_short.replace("wa:", "")
                }));
            }
        }
    }

    let nodes: Vec<Value> = nodes_map.into_values().collect();

    Ok(serde_json::json!({
        "nodes": nodes,
        "links": links
    }))
}

#[tauri::command]
async fn delete_knowledge_entity(
    state: State<'_, Arc<Mutex<KnowledgeStore>>>,
    entity_uri: String,
    project_code: Option<String>,
) -> Result<Value, String> {
    {
        let store_guard = state.lock().map_err(|e| e.to_string())?;

        let escaped_uri = entity_uri.replace("\\", "\\\\").replace("\"", "\\\"");
        let delete_q1 = format!(
            "DELETE {{ ?s ?p ?o }} WHERE {{ ?s ?p ?o . FILTER(str(?s) = \"{}\") }}",
            escaped_uri
        );
        let delete_q2 = format!(
            "DELETE {{ ?s ?p ?o }} WHERE {{ ?s ?p ?o . FILTER(str(?o) = \"{}\") }}",
            escaped_uri
        );

        store_guard.store.update(&delete_q1).map_err(|e| e.to_string())?;
        store_guard.store.update(&delete_q2).map_err(|e| e.to_string())?;
    } // store_guard is dropped here so it is not held across await points below

    // If project code is provided, clean up LanceDB vectors
    if let Some(code) = project_code {
        let mut db_path = if cfg!(windows) {
            PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into()))
        } else {
            PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()))
        };
        db_path.push("SJ_WorkAssist");
        db_path.push("lancedb_data");
        let db_dir = db_path.to_string_lossy().to_string();

        if db_path.exists() {
            if let Ok(conn) = connect(&db_dir).execute().await {
                if let Ok(table) = conn.open_table("project_docs_vectors").execute().await {
                    let pred = format!("project_code = '{}'", code.replace("'", "''"));
                    let _ = table.delete(&pred).await;
                }
            }
        }
    }

    Ok(serde_json::json!({
        "status": "success",
        "message": format!("Successfully deleted entity {}", entity_uri)
    }))
}

#[tauri::command]
async fn get_all_projects(
    state: State<'_, Arc<Mutex<KnowledgeStore>>>,
) -> Result<Value, String> {
    let store_guard = state.lock().map_err(|e| e.to_string())?;

    let query = r#"
        PREFIX wa: <http://workassist.local/ontology/>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?project ?code ?name ?manager ?customer ?desc WHERE {
            ?project rdf:type wa:Project .
            ?project wa:projectCode ?code .
            OPTIONAL { ?project wa:projectName ?name }
            OPTIONAL { ?project wa:manager ?manager }
            OPTIONAL { ?project wa:customer ?customer }
            OPTIONAL { ?project wa:description ?desc }
        }
    "#;

    let query_result = store_guard.store.query(query)
        .map_err(|e| format!("SPARQL evaluation error: {}", e))?;

    let mut projects = Vec::new();

    if let QueryResults::Solutions(solutions) = query_result {
        for solution in solutions {
            let sol = solution.map_err(|e| e.to_string())?;
            let project_uri = sol.get("project").map(|t| t.to_string()).unwrap_or_default();
            let code = sol.get("code").map(|t| match t { Term::Literal(l) => l.value().to_string(), other => other.to_string() }).unwrap_or_default();
            let name = sol.get("name").map(|t| match t { Term::Literal(l) => l.value().to_string(), other => other.to_string() }).unwrap_or_default();
            let manager = sol.get("manager").map(|t| match t { Term::Literal(l) => l.value().to_string(), other => other.to_string() }).unwrap_or_default();
            let customer = sol.get("customer").map(|t| match t { Term::Literal(l) => l.value().to_string(), other => other.to_string() }).unwrap_or_default();
            let desc = sol.get("desc").map(|t| match t { Term::Literal(l) => l.value().to_string(), other => other.to_string() }).unwrap_or_default();

            projects.push(serde_json::json!({
                "uri": project_uri,
                "project_code": code,
                "project_name": name,
                "manager": manager,
                "customer": customer,
                "description": desc
            }));
        }
    }

    Ok(Value::Array(projects))
}

// --- MODULE PLUG-IN SETUP ---

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("knowledge")
        .invoke_handler(tauri::generate_handler![
            register_project,
            ingest_bom,
            ingest_project_document,
            query_knowledge,
            get_graph_data,
            delete_knowledge_entity,
            get_all_projects
        ])
        .build()
}
