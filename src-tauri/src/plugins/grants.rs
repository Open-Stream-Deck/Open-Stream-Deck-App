use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Grants {
    path: PathBuf,
    cache: Mutex<Option<BTreeMap<String, String>>>,
}

impl Grants {
    pub fn new(path: PathBuf) -> Self {
        Self { path, cache: Mutex::default() }
    }

    fn read(&self) -> BTreeMap<String, String> {
        fs::read(&self.path).ok().and_then(|v| serde_json::from_slice(&v).ok()).unwrap_or_default()
    }

    pub fn approved(&self, id: &str, digest: &str) -> bool {
        let mut cache = self.cache.lock().unwrap();
        cache.get_or_insert_with(|| self.read()).get(id).is_some_and(|d| d == digest)
    }

    pub fn set(&self, id: &str, digest: Option<&str>) -> Result<(), String> {
        let mut cache = self.cache.lock().unwrap();
        let mut grants = self.read();
        match digest {
            Some(digest) => grants.insert(id.into(), digest.into()),
            None => grants.remove(id),
        };
        write_atomic(&self.path, &serde_json::to_vec_pretty(&grants).map_err(|e| e.to_string())?)?;
        *cache = Some(grants);
        Ok(())
    }
}

fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    fs::write(&temp, data).map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consent_follows_the_digest() {
        let dir = std::env::temp_dir().join(format!("opensd-grants-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let grants = Grants::new(dir.join("grants.json"));
        assert!(!grants.approved("com.example.a", "d1"));
        grants.set("com.example.a", Some("d1")).unwrap();
        assert!(grants.approved("com.example.a", "d1") && !grants.approved("com.example.a", "d2"));
        grants.set("com.example.a", None).unwrap();
        assert!(!grants.approved("com.example.a", "d1"));
        fs::remove_dir_all(dir).unwrap();
    }
}
