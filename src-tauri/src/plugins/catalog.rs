use super::{PluginHost, PluginInfo, broker, not_found, token};
use opensd_package::{Permissions, semver_at_least};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::time::Duration;

const BASE: &str = "https://dl.opensd.dev";
const MAX_CATALOG: u64 = 4 << 20;
const MAX_PACKAGE: u64 = 64 << 20;

#[derive(Deserialize)]
struct Catalog {
    plugins: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    id: String,
    name: String,
    author: String,
    version: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    permissions: Option<Value>,
    #[serde(default)]
    components: Vec<ComponentSummary>,
    #[serde(default)]
    verified: bool,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    features: Vec<String>,
    #[serde(default)]
    changes: Vec<String>,
    #[serde(default)]
    icon: Option<String>,
    download: String,
    size: u64,
    sha256: String,
    #[serde(default)]
    downloads: u64,
}

#[derive(Deserialize, Serialize)]
struct ComponentSummary {
    name: String,
    version: String,
    platforms: Vec<String>,
}

#[derive(Serialize)]
pub struct StorePlugin {
    id: String,
    name: String,
    author: String,
    verified: bool,
    version: String,
    installed: Option<String>,
    update: bool,
    summary: String,
    description: String,
    features: Vec<String>,
    changes: Vec<String>,
    permissions: Vec<broker::Permission>,
    components: Vec<ComponentSummary>,
    downloads: u64,
    color: Option<String>,
    icon: Option<String>,
}

fn get(path: &str, limit: u64, timeout: Duration) -> Result<Vec<u8>, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(timeout)).build().into();
    let fail = |e: ureq::Error| match e {
        ureq::Error::StatusCode(code) => {
            tr!("Магазин недоступен: ошибка {}", "The store is unavailable: error {}", "商店不可用：错误 {}", code)
        }
        _ => tr!(
            "Магазин недоступен, проверьте подключение к интернету",
            "The store is unavailable, check your internet connection",
            "商店不可用，请检查网络连接"
        ),
    };
    let mut response = agent.get(format!("{BASE}{path}")).call().map_err(fail)?;
    response.body_mut().with_config().limit(limit).read_to_vec().map_err(fail)
}

fn fetch() -> Result<Vec<(Entry, Permissions)>, String> {
    parse(&get("/v1/plugins", MAX_CATALOG, Duration::from_secs(15))?)
}

fn parse(body: &[u8]) -> Result<Vec<(Entry, Permissions)>, String> {
    let catalog: Catalog = serde_json::from_slice(body).map_err(|e| e.to_string())?;
    Ok(catalog
        .plugins
        .into_iter()
        .filter_map(|mut entry| {
            let permissions = match entry.permissions.take() {
                Some(value) => serde_json::from_value(value).ok()?,
                None => Permissions::default(),
            };
            Some((entry, permissions))
        })
        .collect())
}

pub fn list(host: &PluginHost) -> Result<Vec<StorePlugin>, String> {
    Ok(fetch()?
        .into_iter()
        .map(|(e, permissions)| {
            let installed = host.find(&e.id).map(|p| p.manifest.version);
            StorePlugin {
                update: installed.as_deref().is_some_and(|v| !semver_at_least(v, &e.version)),
                installed,
                permissions: broker::describe(&permissions),
                components: e.components,
                summary: if e.summary.is_empty() { e.description.clone() } else { e.summary },
                icon: e.icon.map(|path| format!("{BASE}{path}")),
                id: e.id,
                name: e.name,
                author: e.author,
                verified: e.verified,
                version: e.version,
                description: e.description,
                features: e.features,
                changes: e.changes,
                downloads: e.downloads,
                color: e.color,
            }
        })
        .collect())
}

pub fn install(host: &PluginHost, id: &str) -> Result<PluginInfo, String> {
    let (entry, _) = fetch()?.into_iter().find(|(e, _)| e.id == id).ok_or_else(not_found)?;
    if !entry.download.starts_with("/v1/packages/") || entry.size > MAX_PACKAGE {
        return Err(not_found());
    }
    let bytes = get(&entry.download, MAX_PACKAGE, Duration::from_secs(300))?;
    if format!("{:x}", Sha256::digest(&bytes)) != entry.sha256 {
        return Err(tr!(
            "Файл плагина повредился при загрузке, попробуйте ещё раз",
            "The plugin file was damaged in transit, try again",
            "插件文件在下载时损坏，请重试"
        ));
    }
    let path = host.root().join(format!(".download-{}.opensd", token()?));
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    let result = host.install(&path);
    let _ = fs::remove_file(&path);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_plugins_with_unknown_permissions() {
        let body = br#"{"plugins":[
            {"id":"a.b","name":"A","author":"x","version":"1.0.0","download":"/v1/packages/a.b/1.0.0","size":1,"sha256":"00","permissions":{"loopback":["25580"]},"verified":true},
            {"id":"c.d","name":"C","author":"x","version":"2.0.0","download":"/v1/packages/c.d/2.0.0","size":1,"sha256":"00","permissions":{"teleport":true}},
            {"id":"e.f","name":"E","author":"x","version":"0.1.0","download":"/v1/packages/e.f/0.1.0","size":1,"sha256":"00","future_field":1}
        ]}"#;
        let entries = parse(body).unwrap();
        let ids: Vec<_> = entries.iter().map(|(e, _)| e.id.as_str()).collect();
        assert_eq!(ids, ["a.b", "e.f"]);
        assert_eq!(entries[0].1.loopback, ["25580"]);
        assert!(entries[0].0.verified);
    }
}
