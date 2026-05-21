use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use ort::session::Session;
use ort::value::Tensor;
use ort::inputs;

pub struct BasicTokenizer {
    vocab: HashMap<String, i64>,
    unk_id: i64,
    cls_id: i64,
    sep_id: i64,
    pad_id: i64,
}

impl BasicTokenizer {
    pub fn load<P: AsRef<Path>>(vocab_path: P) -> Result<Self, String> {
        let file = File::open(vocab_path).map_err(|e| format!("Failed to open vocab file: {}", e))?;
        let reader = BufReader::new(file);
        let mut vocab = HashMap::new();
        for (idx, line) in reader.lines().enumerate() {
            let line = line.map_err(|e| format!("Failed to read vocab line: {}", e))?;
            vocab.insert(line.trim().to_string(), idx as i64);
        }
        
        let unk_id = *vocab.get("[UNK]").unwrap_or(&100);
        let cls_id = *vocab.get("[CLS]").unwrap_or(&101);
        let sep_id = *vocab.get("[SEP]").unwrap_or(&102);
        let pad_id = *vocab.get("[PAD]").unwrap_or(&0);
        
        Ok(Self { vocab, unk_id, cls_id, sep_id, pad_id })
    }

    pub fn tokenize(&self, text: &str, max_len: usize) -> (Vec<i64>, Vec<i64>, Vec<i64>) {
        let mut input_ids = vec![self.cls_id];
        
        let cleaned_text = text.to_lowercase();
        let words = cleaned_text.split_whitespace();
        
        for word in words {
            let mut sub_tokens = Vec::new();
            let mut start = 0;
            let chars: Vec<char> = word.chars().collect();
            let len = chars.len();
            let mut is_bad = false;
            
            while start < len {
                let mut end = len;
                let mut cur_substr = None;
                while start < end {
                    let mut substr = chars[start..end].iter().collect::<String>();
                    if start > 0 {
                        substr = format!("##{}", substr);
                    }
                    if self.vocab.contains_key(&substr) {
                        cur_substr = Some((substr, end));
                        break;
                    }
                    end -= 1;
                }
                if let Some((sub, next_start)) = cur_substr {
                    sub_tokens.push(sub);
                    start = next_start;
                } else {
                    is_bad = true;
                    break;
                }
            }
            
            if is_bad {
                input_ids.push(self.unk_id);
            } else {
                for token in sub_tokens {
                    if let Some(&id) = self.vocab.get(&token) {
                        input_ids.push(id);
                    }
                }
            }
        }
        
        input_ids.push(self.sep_id);
        
        if input_ids.len() > max_len {
            input_ids.truncate(max_len - 1);
            input_ids.push(self.sep_id);
        }
        
        let actual_len = input_ids.len();
        let mut attention_mask = vec![1i64; actual_len];
        let mut token_type_ids = vec![0i64; actual_len];
        
        while input_ids.len() < max_len {
            input_ids.push(self.pad_id);
            attention_mask.push(0);
            token_type_ids.push(0);
        }
        
        (input_ids, attention_mask, token_type_ids)
    }
}

pub struct EmbeddingEngine {
    session: Mutex<Session>,
    tokenizer: BasicTokenizer,
}

impl EmbeddingEngine {
    pub fn new(model_path: PathBuf, vocab_path: PathBuf) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|e| format!("Failed to create session builder: {}", e))?
            .commit_from_file(model_path)
            .map_err(|e| format!("Failed to load ONNX model: {}", e))?;
            
        let tokenizer = BasicTokenizer::load(vocab_path)?;
        
        Ok(Self { session: Mutex::new(session), tokenizer })
    }

    pub fn embed_sentence(&self, text: &str) -> Result<Vec<f32>, String> {
        let max_len = 256;
        let (input_ids, attention_mask, token_type_ids) = self.tokenizer.tokenize(text, max_len);
        
        let input_ids_tensor = Tensor::from_array(([1usize, max_len], input_ids.clone().into_boxed_slice()))
            .map_err(|e| format!("Failed to create input_ids tensor: {}", e))?;
        let attention_mask_tensor = Tensor::from_array(([1usize, max_len], attention_mask.clone().into_boxed_slice()))
            .map_err(|e| format!("Failed to create attention_mask tensor: {}", e))?;
        let token_type_ids_tensor = Tensor::from_array(([1usize, max_len], token_type_ids.clone().into_boxed_slice()))
            .map_err(|e| format!("Failed to create token_type_ids tensor: {}", e))?;
            
        let mut session = self.session.lock().map_err(|e| format!("Failed to lock session Mutex: {}", e))?;
        let outputs = session.run(inputs![
            "input_ids" => input_ids_tensor,
            "attention_mask" => attention_mask_tensor,
            "token_type_ids" => token_type_ids_tensor
        ])
        .map_err(|e| format!("Model inference error: {}", e))?;

        
        let array_view = outputs[0]
            .try_extract_array::<f32>()
            .map_err(|e| format!("Failed to extract output tensor: {}", e))?;
            
        let shape = array_view.shape();
        let seq_len = shape[1];
        let hidden_size = shape[2];
        
        let mut pooled = vec![0.0f32; hidden_size];
        let mut valid_token_count = 0.0f32;
        
        for i in 0..seq_len {
            let mask_val = attention_mask[i] as f32;
            if mask_val > 0.0 {
                valid_token_count += mask_val;
                for k in 0..hidden_size {
                    let val = array_view[[0, i, k]];
                    pooled[k] += val * mask_val;
                }
            }
        }
        
        if valid_token_count > 0.0 {
            for k in 0..hidden_size {
                pooled[k] /= valid_token_count;
            }
        }
        
        let mut norm = 0.0f32;
        for val in &pooled {
            norm += val * val;
        }
        norm = norm.sqrt();
        
        if norm > 0.0 {
            for val in &mut pooled {
                *val /= norm;
            }
        }
        
        Ok(pooled)
    }
}
