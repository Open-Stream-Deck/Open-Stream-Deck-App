use super::PluginHost;
use opensd_package::{ComponentPlatform, ComponentTarget, Manifest};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Serialize, Deserialize)]
pub struct Installation {
    pub id: String,
    pub plugin: String,
    pub component: String,
    pub target: String,
    pub version: String,
    pub root: PathBuf,
    pub files: Vec<InstalledFile>,
    #[serde(default)]
    pub directories: Vec<PathBuf>,
    #[serde(default)]
    pub executables: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct InstalledFile {
    pub path: String,
    pub hash: String,
    pub owned: bool,
    pub original: Option<Vec<u8>>,
    #[serde(default)]
    pub original_mode: Option<u32>,
    #[serde(default)]
    pub mode: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub action: String,
    pub before: Option<String>,
    pub after: Option<String>,
    #[serde(default)]
    pub before_mode: Option<u32>,
    #[serde(default)]
    pub after_mode: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Plan {
    pub id: String,
    pub plugin: String,
    pub component: String,
    pub target: String,
    pub root: PathBuf,
    pub version: String,
    pub changes: Vec<FileChange>,
    pub conflicts: bool,
    pub uninstall: bool,
}

pub struct Pending {
    pub view: Plan,
    pub manifest: Option<Manifest>,
    pub source: Option<PathBuf>,
    pub writes: BTreeMap<String, Option<Vec<u8>>>,
    pub installation: Installation,
    pub records_digest: String,
    pub source_hashes: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize)]
struct Journal {
    before: Vec<(String, Option<Vec<u8>>)>,
    plan: Plan,
    previous: Vec<Installation>,
    next: Vec<Installation>,
    committed: bool,
    #[serde(default)]
    directories: Vec<PathBuf>,
}

#[derive(Serialize)]
pub struct InstallationSummary {
    pub id: String,
    pub plugin: String,
    pub component: String,
    pub target: String,
    pub version: String,
    pub root: PathBuf,
    pub status: String,
}

#[derive(Serialize)]
pub struct Overview {
    pub manifest: Option<Manifest>,
    pub installations: Vec<InstallationSummary>,
    pub recovery: bool,
    pub platform: Option<ComponentPlatform>,
    pub compatible_components: Vec<String>,
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn save_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let parent = path.parent().ok_or("Missing state directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let staging = parent.join(format!(".state-{}", super::token()?));
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&staging).map_err(|e| e.to_string())?;
    file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(&staging, path).map_err(|e| e.to_string())
}

fn plain_file(path: &Path) -> Result<Option<Vec<u8>>> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if !meta.is_file() || linked(&meta) {
                return Err(format!("Not a plain file: {}", path.display()));
            }
            if meta.len() > opensd_package::MAX_FILE_BYTES {
                return Err(format!("File exceeds component limit: {}", path.display()));
            }
            fs::read(path).map(Some).map_err(|e| format!("{}: {e}", path.display()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

fn linked(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}

fn safe_destination(root: &Path, relative: &str) -> Result<PathBuf> {
    if !root.is_absolute() || !opensd_package::safe_path(relative) {
        return Err("Invalid component destination".into());
    }
    let full = root.join(relative);
    for ancestor in full.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if linked(&meta) => return Err(format!("Linked paths are not supported: {}", ancestor.display())),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(full)
}

fn hash(bytes: &Option<Vec<u8>>) -> Option<String> {
    bytes.as_ref().map(|b| opensd_package::sha256(b))
}

fn file_mode(path: &Path) -> Result<Option<u32>> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match fs::symlink_metadata(path) {
            Ok(meta) => {
                let mode = meta.permissions().mode();
                if mode & 0o7000 != 0 {
                    return Err(format!("Special Unix permissions are not supported: {}", path.display()));
                }
                Ok(Some(mode & 0o777))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(None)
    }
}

fn replace(root: &Path, relative: &str, bytes: Option<&[u8]>, mode: Option<u32>) -> Result<()> {
    let path = safe_destination(root, relative)?;
    if let Some(bytes) = bytes {
        let parent = path.parent().ok_or("Missing destination directory")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        safe_destination(root, relative)?;
        let staging = parent.join(format!(".opensd-{}", super::token()?));
        let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&staging).map_err(|e| e.to_string())?;
        let outcome = (|| -> std::io::Result<()> {
            file.write_all(bytes)?;
            #[cfg(unix)]
            if let Some(mode) = mode {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(fs::Permissions::from_mode(mode))?;
            }
            #[cfg(not(unix))]
            let _ = mode;
            file.sync_all()
        })();
        drop(file);
        let outcome = outcome.map_err(|e| e.to_string()).and_then(|_| {
            safe_destination(root, relative)?;
            fs::rename(&staging, &path).map_err(|e| e.to_string())
        });
        if let Err(e) = outcome {
            let _ = fs::remove_file(&staging);
            return Err(format!("{}: {e}", path.display()));
        }
    } else if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(())
}

impl PluginHost {
    fn component_state(&self) -> PathBuf {
        self.root.with_file_name("components")
    }

    fn component_records(&self) -> Result<Vec<Installation>> {
        let path = self.component_state().join("installations.json");
        if !path.exists() {
            return Ok(Vec::new());
        }
        read_json(&path)
    }

    pub fn component_overview(&self, id: &str) -> Result<Overview> {
        let manifest = self.plugins.lock().map_err(|e| e.to_string())?.get(id).map(|p| p.manifest.clone());
        let platform = ComponentPlatform::current();
        let compatible_components = manifest
            .as_ref()
            .map(|m| {
                m.components
                    .iter()
                    .filter(|c| {
                        platform.is_some_and(|p| {
                            c.variant(p).is_some()
                                && m.targets
                                    .iter()
                                    .any(|t| c.targets.contains(&t.id) && t.os.is_none_or(|os| os == p.os))
                        })
                    })
                    .map(|c| c.id.clone())
                    .collect()
            })
            .unwrap_or_default();
        Ok(Overview {
            platform,
            compatible_components,
            manifest: manifest.clone(),
            installations: self
                .component_records()?
                .into_iter()
                .filter(|i| id.is_empty() || i.plugin == id)
                .map(|i| {
                    let status = if !i.root.is_dir() {
                        "unavailable"
                    } else if i.files.iter().any(|f| {
                        safe_destination(&i.root, &f.path)
                            .and_then(|p| plain_file(&p))
                            .and_then(|b| {
                                Ok(hash(&b).as_ref() != Some(&f.hash) || file_mode(&i.root.join(&f.path))? != f.mode)
                            })
                            .unwrap_or(true)
                    }) {
                        "modified"
                    } else if manifest
                        .as_ref()
                        .and_then(|m| m.components.iter().find(|c| c.id == i.component))
                        .is_some_and(|c| c.version != i.version)
                    {
                        "update_available"
                    } else {
                        "installed"
                    };
                    InstallationSummary {
                        id: i.id,
                        plugin: i.plugin,
                        component: i.component,
                        target: i.target,
                        version: i.version,
                        root: i.root,
                        status: status.into(),
                    }
                })
                .collect(),
            recovery: self.component_state().join("journal.json").exists(),
        })
    }

    pub fn component_candidates(&self, id: &str, target: &str) -> Result<Vec<PathBuf>> {
        let plugins = self.plugins.lock().map_err(|e| e.to_string())?;
        let plugin = plugins.get(id).ok_or("Plugin not found")?;
        let target = plugin.manifest.targets.iter().find(|t| t.id == target).ok_or("Target not found")?;
        let mut paths = Vec::new();
        if let Some(location) = &target.location {
            let base = super::component_discovery::known_directory(location.base);
            if let Some(base) = base {
                paths.push(base.join(&location.path));
            }
        }
        paths.extend(super::component_discovery::steam(target)?);
        paths.extend(
            self.component_records()?.into_iter().filter(|i| i.plugin == id && i.target == target.id).map(|i| i.root),
        );
        paths.retain(|p| validate_target(target, p).is_ok());
        unique_directories(paths)
    }

    pub fn component_export(&self, id: &str, component: &str, output: &Path) -> Result<()> {
        let _guard = self.install_lock.lock().map_err(|e| e.to_string())?;
        let plugin = self.plugins.lock().map_err(|e| e.to_string())?.get(id).cloned().ok_or("Plugin not found")?;
        let manifest = opensd_package::read_dir(&plugin.dir).map_err(|e| e.to_string())?;
        let definition = manifest.components.iter().find(|c| c.id == component).ok_or("Component not found")?;
        let platform = ComponentPlatform::current().ok_or("Unsupported component platform")?;
        let variant = definition.variant(platform).ok_or("No compatible component variant for this system")?;
        let parent = output.parent().ok_or("Missing export directory")?;
        let name = output.file_name().and_then(|n| n.to_str()).ok_or("Invalid export file name")?;
        let output = safe_destination(parent, name)?;
        let mut archive = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for file in &variant.files {
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .unix_permissions(if file.executable { 0o755 } else { 0o644 });
            let bytes =
                plain_file(&safe_destination(&plugin.dir.canonicalize().map_err(|e| e.to_string())?, &file.source)?)?
                    .ok_or("Missing component source")?;
            archive.start_file(&file.destination, options).map_err(|e| e.to_string())?;
            archive.write_all(&bytes).map_err(|e| e.to_string())?;
        }
        let mut instructions = format!(
            "{} {}\n{}\n\nClose the target application. Copy the archive contents into its installation directory. Existing files may need a backup.\n",
            definition.name, definition.version, definition.description
        );
        for target in manifest
            .targets
            .iter()
            .filter(|t| definition.targets.contains(&t.id) && t.os.is_none_or(|os| os == platform.os))
        {
            instructions.push_str(&format!("\n{}: {}\n", target.name, target.after_install));
        }
        archive
            .start_file("OPENSD-INSTALL.txt", zip::write::SimpleFileOptions::default())
            .map_err(|e| e.to_string())?;
        archive.write_all(instructions.as_bytes()).map_err(|e| e.to_string())?;
        let bytes = archive.finish().map_err(|e| e.to_string())?.into_inner();
        let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&output).map_err(|e| e.to_string())?;
        if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(&output);
            return Err(error.to_string());
        }
        Ok(())
    }

    pub fn component_plan(&self, id: &str, component: &str, target: &str, root: PathBuf) -> Result<Plan> {
        let _guard = self.install_lock.lock().map_err(|e| e.to_string())?;
        let plugin = self.plugins.lock().map_err(|e| e.to_string())?.get(id).cloned().ok_or("Plugin not found")?;
        let manifest = opensd_package::read_dir(&plugin.dir).map_err(|e| e.to_string())?;
        let definition = manifest.components.iter().find(|c| c.id == component).ok_or("Component not found")?;
        if !definition.targets.iter().any(|t| t == target) {
            return Err("Target is not supported by this component".into());
        }
        let target_definition = manifest.targets.iter().find(|t| t.id == target).ok_or("Target not found")?;
        validate_target(target_definition, &root)?;
        let root = normalize(&root)?;
        let platform = ComponentPlatform::current().ok_or("Unsupported component platform")?;
        let variant = definition.variant(platform).ok_or("No compatible component variant for this system")?;
        let records = self.component_records()?;
        let previous =
            records.iter().find(|i| i.plugin == id && i.component == component && i.target == target && i.root == root);
        let mut installation = Installation {
            id: previous.map(|i| i.id.clone()).unwrap_or(super::token()?),
            plugin: id.into(),
            component: component.into(),
            target: target.into(),
            version: definition.version.clone(),
            root: root.clone(),
            files: Vec::new(),
            executables: target_definition.required_files.clone(),
            directories: previous.map(|i| i.directories.clone()).unwrap_or_default(),
        };
        let mut writes = BTreeMap::new();
        let mut changes = Vec::new();
        let mut conflicts = false;
        let mut source_hashes = BTreeMap::new();
        let mut snapshot_size = 0usize;
        for file in &variant.files {
            let path = safe_destination(&root, &file.destination)?;
            for other in &records {
                if Some(&other.id) == previous.map(|i| &i.id) {
                    continue;
                }
                if other.files.iter().any(|f| overlapping(&other.root.join(&f.path), &path)) {
                    return Err(format!("Destination is used by component {}", other.component));
                }
            }
            let before = plain_file(&path)?;
            let before_mode = file_mode(&path)?;
            let after_mode = if cfg!(unix) {
                Some(if file.executable { 0o755 } else { before_mode.unwrap_or(0o644) })
            } else {
                None
            };
            let bytes =
                plain_file(&safe_destination(&plugin.dir.canonicalize().map_err(|e| e.to_string())?, &file.source)?)?
                    .ok_or("Missing component source")?;
            snapshot_size += bytes.len() + before.as_ref().map_or(0, Vec::len);
            if snapshot_size as u64 > opensd_package::MAX_TOTAL_BYTES {
                return Err("Component plan and backups exceed 64 MiB".into());
            }
            let desired = opensd_package::sha256(&bytes);
            source_hashes.insert(file.source.clone(), desired.clone());
            let old = previous.and_then(|i| i.files.iter().find(|f| f.path == file.destination));
            let current = hash(&before);
            let action = if current.as_ref() == Some(&desired) && before_mode == after_mode {
                "skip"
            } else if current.is_none() {
                "create"
            } else if old.is_some_and(|f| f.owned && Some(&f.hash) == current.as_ref() && f.mode == before_mode) {
                "update"
            } else {
                conflicts = true;
                "conflict"
            };
            installation.files.push(InstalledFile {
                path: file.destination.clone(),
                hash: desired.clone(),
                owned: old.is_some_and(|f| f.owned) || action != "skip",
                original: old.filter(|f| f.owned).map(|f| f.original.clone()).unwrap_or(before),
                original_mode: old.filter(|f| f.owned).map(|f| f.original_mode).unwrap_or(before_mode),
                mode: after_mode,
            });
            changes.push(FileChange {
                path: file.destination.clone(),
                action: action.into(),
                before: current,
                after: Some(desired),
                before_mode,
                after_mode,
            });
            if action != "skip" {
                writes.insert(file.destination.clone(), Some(bytes));
            }
        }
        if let Some(previous) = previous {
            for file in &previous.files {
                if !installation.files.iter().any(|f| f.path == file.path) && file.owned {
                    removal(&root, file, &mut writes, &mut changes, &mut conflicts)?;
                }
            }
        }
        let view = Plan {
            id: super::token()?,
            plugin: id.into(),
            component: component.into(),
            target: target.into(),
            root,
            version: definition.version.clone(),
            changes,
            conflicts,
            uninstall: false,
        };
        self.component_plans.lock().map_err(|e| e.to_string())?.clear();
        self.component_plans.lock().map_err(|e| e.to_string())?.insert(
            view.id.clone(),
            Pending {
                view: view.clone(),
                source_hashes,
                manifest: Some(manifest),
                source: Some(plugin.dir),
                writes,
                installation,
                records_digest: opensd_package::sha256(
                    &serde_json::to_vec(&self.component_records()?).map_err(|e| e.to_string())?,
                ),
            },
        );
        Ok(view)
    }

    pub fn component_remove_plan(&self, installation_id: &str) -> Result<Plan> {
        let _guard = self.install_lock.lock().map_err(|e| e.to_string())?;
        let installation =
            self.component_records()?.into_iter().find(|i| i.id == installation_id).ok_or("Installation not found")?;
        let mut writes = BTreeMap::new();
        let mut changes = Vec::new();
        let mut conflicts = false;
        for file in &installation.files {
            if file.owned {
                removal(&installation.root, file, &mut writes, &mut changes, &mut conflicts)?;
            }
        }
        let view = Plan {
            id: super::token()?,
            plugin: installation.plugin.clone(),
            component: installation.component.clone(),
            target: installation.target.clone(),
            root: installation.root.clone(),
            version: installation.version.clone(),
            changes,
            conflicts,
            uninstall: true,
        };
        self.component_plans.lock().map_err(|e| e.to_string())?.clear();
        self.component_plans.lock().map_err(|e| e.to_string())?.insert(
            view.id.clone(),
            Pending {
                view: view.clone(),
                source_hashes: BTreeMap::new(),
                manifest: None,
                source: None,
                writes,
                installation,
                records_digest: opensd_package::sha256(
                    &serde_json::to_vec(&self.component_records()?).map_err(|e| e.to_string())?,
                ),
            },
        );
        Ok(view)
    }

    pub fn component_apply(&self, plan_id: &str, replace_conflicts: bool) -> Result<()> {
        let _guard = self.install_lock.lock().map_err(|e| e.to_string())?;
        let pending = self
            .component_plans
            .lock()
            .map_err(|e| e.to_string())?
            .remove(plan_id)
            .ok_or("Plan expired; review the installation again")?;
        apply_pending(&self.component_state(), pending, replace_conflicts)
    }

    pub fn component_recover(&self) -> Result<()> {
        let _guard = self.install_lock.lock().map_err(|e| e.to_string())?;
        self.recover_components_inner()
    }

    fn recover_components_inner(&self) -> Result<()> {
        recover(&self.component_state())
    }
}

fn apply_pending(state: &Path, pending: Pending, replace_conflicts: bool) -> Result<()> {
    if pending.view.conflicts && !replace_conflicts {
        return Err("Resolve conflicting files manually, then create a new plan".into());
    }
    crate::procs::forget();
    for executable in &pending.installation.executables {
        let path = safe_destination(&pending.view.root, executable)?;
        if !crate::procs::find(&path).is_empty() {
            return Err(format!("Close the target application before changing files: {}", path.display()));
        }
    }
    let journal_path = state.join("journal.json");
    if journal_path.exists() {
        return Err("Recover the interrupted component operation first".into());
    }
    if let (Some(source), Some(manifest)) = (&pending.source, &pending.manifest) {
        let current = opensd_package::read_dir(source).map_err(|e| e.to_string())?;
        if &current != manifest {
            return Err("Plugin changed; review a new plan".into());
        }
        for (source_path, expected) in &pending.source_hashes {
            let path = safe_destination(&source.canonicalize().map_err(|e| e.to_string())?, source_path)?;
            let actual = plain_file(&path)?.ok_or("Missing component source")?;
            if opensd_package::sha256(&actual) != *expected {
                return Err("Component source changed; review a new plan".into());
            }
        }
    }
    let previous = records(state)?;
    if opensd_package::sha256(&serde_json::to_vec(&previous).map_err(|e| e.to_string())?) != pending.records_digest {
        return Err("Component installations changed; review a new plan".into());
    }
    let mut next = previous.clone();
    next.retain(|i| i.id != pending.installation.id);
    let installation_id = pending.installation.id.clone();
    let removed_directories = pending.installation.directories.clone();
    if !pending.view.uninstall {
        next.push(pending.installation);
    }
    let mut before = Vec::new();
    for change in &pending.view.changes {
        let bytes = plain_file(&safe_destination(&pending.view.root, &change.path)?)?;
        if hash(&bytes) != change.before
            || file_mode(&safe_destination(&pending.view.root, &change.path)?)? != change.before_mode
        {
            return Err(format!("{} changed; review a new plan", change.path));
        }
        if pending.writes.contains_key(&change.path) {
            before.push((change.path.clone(), bytes));
        }
    }
    let mut directories = Vec::new();
    for (relative, bytes) in &pending.writes {
        if bytes.is_none() {
            continue;
        }
        let path = safe_destination(&pending.view.root, relative)?;
        for parent in path.parent().into_iter().flat_map(|p| p.ancestors()) {
            if !parent.starts_with(&pending.view.root) || parent.exists() {
                break;
            }
            if !directories.iter().any(|p| p == parent) {
                directories.push(parent.to_path_buf());
            }
        }
    }
    if let Some(record) = next.iter_mut().find(|i| i.id == installation_id) {
        record.directories.extend(directories.clone());
        record.directories.sort();
        record.directories.dedup();
    }
    let mut journal = Journal { before, plan: pending.view, previous, next, committed: false, directories };
    let required = pending.writes.values().filter_map(|b| b.as_ref()).map(|b| b.len() as u64).sum::<u64>();
    let disks = sysinfo::Disks::new_with_refreshed_list();
    if disks
        .iter()
        .filter(|d| d.mount_point().canonicalize().is_ok_and(|mount| journal.plan.root.starts_with(mount)))
        .max_by_key(|d| d.mount_point().components().count())
        .is_some_and(|disk| disk.available_space() < required)
    {
        return Err("Not enough free space on the target volume".into());
    }
    save_json(&journal_path, &journal)?;
    if journal.plan.conflicts {
        save_json(
            &state.join("backups").join(format!("{}.json", journal.plan.id)),
            &serde_json::json!({ "plan": journal.plan, "files": journal.before }),
        )?;
    }
    let outcome = (|| -> Result<()> {
        for (path, bytes) in &pending.writes {
            let change = journal.plan.changes.iter().find(|c| &c.path == path).ok_or("Missing planned change")?;
            let destination = safe_destination(&journal.plan.root, path)?;
            if hash(&plain_file(&destination)?) != change.before || file_mode(&destination)? != change.before_mode {
                return Err(format!("{path} changed during installation"));
            }
            replace(&journal.plan.root, path, bytes.as_deref(), change.after_mode)?;
        }
        save_json(&state.join("installations.json"), &journal.next)?;
        journal.committed = true;
        save_json(&journal_path, &journal)?;
        Ok(())
    })();
    if let Err(error) = outcome {
        return match recover(state) {
            Ok(()) => Err(format!("{error}. Changes were rolled back")),
            Err(recovery) => Err(format!("{error}. Recovery required: {recovery}")),
        };
    }
    if journal.plan.uninstall {
        clean_directories(&removed_directories);
    }
    fs::remove_file(journal_path).map_err(|e| e.to_string())
}

fn recover(state: &Path) -> Result<()> {
    let path = state.join("journal.json");
    let journal: Journal = read_json(&path)?;
    if !journal.committed {
        crate::procs::forget();
        for installation in journal.previous.iter().chain(&journal.next) {
            for executable in &installation.executables {
                if !crate::procs::find(&safe_destination(&installation.root, executable)?).is_empty() {
                    return Err("Close the target application before recovery".into());
                }
            }
        }
        for (relative, before) in journal.before.iter().rev() {
            let current = hash(&plain_file(&safe_destination(&journal.plan.root, relative)?)?);
            let change = journal.plan.changes.iter().find(|c| &c.path == relative).ok_or("Missing recovery change")?;
            let mode = file_mode(&safe_destination(&journal.plan.root, relative)?)?;
            if current == hash(before) && mode == change.before_mode {
                continue;
            }
            if current != change.after || mode != change.after_mode {
                return Err(format!("{relative} was modified outside the installer"));
            }
            replace(&journal.plan.root, relative, before.as_deref(), change.before_mode)?;
        }
        clean_directories(&journal.directories);
        save_json(&state.join("installations.json"), &journal.previous)?;
    }
    fs::remove_file(path).map_err(|e| e.to_string())
}

fn records(state: &Path) -> Result<Vec<Installation>> {
    let path = state.join("installations.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    read_json(&path)
}

fn clean_directories(paths: &[PathBuf]) {
    let mut paths = paths.to_vec();
    paths.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
    for path in paths {
        if path.ancestors().all(|p| fs::symlink_metadata(p).is_ok_and(|m| !linked(&m)))
            && fs::symlink_metadata(&path).is_ok_and(|m| m.is_dir() && !linked(&m))
        {
            let _ = fs::remove_dir(path);
        }
    }
}

fn unique_directories(paths: Vec<PathBuf>) -> Result<Vec<PathBuf>> {
    let mut paths = paths.iter().map(|path| normalize(path)).collect::<Result<Vec<_>>>()?;
    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn normalize(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        return path.canonicalize().map_err(|e| e.to_string());
    }
    let parent = path.parent().ok_or("Missing directory parent")?;
    let name = path.file_name().ok_or("Missing directory name")?;
    Ok(normalize(parent)?.join(name))
}

fn overlapping(a: &Path, b: &Path) -> bool {
    let a = a.to_string_lossy().to_lowercase();
    let b = b.to_string_lossy().to_lowercase();
    let a = Path::new(&a);
    let b = Path::new(&b);
    a.starts_with(b) || b.starts_with(a)
}

fn removal(
    root: &Path,
    file: &InstalledFile,
    writes: &mut BTreeMap<String, Option<Vec<u8>>>,
    changes: &mut Vec<FileChange>,
    conflicts: &mut bool,
) -> Result<()> {
    let current = hash(&plain_file(&safe_destination(root, &file.path)?)?);
    let before_mode = file_mode(&safe_destination(root, &file.path)?)?;
    let conflict = current.as_ref() != Some(&file.hash) || before_mode != file.mode;
    *conflicts |= conflict;
    changes.push(FileChange {
        path: file.path.clone(),
        action: if conflict {
            "conflict"
        } else if file.original.is_some() {
            "restore"
        } else {
            "remove"
        }
        .into(),
        before: current,
        after: hash(&file.original),
        before_mode,
        after_mode: file.original_mode,
    });
    writes.insert(file.path.clone(), file.original.clone());
    Ok(())
}

fn validate_target(target: &ComponentTarget, root: &Path) -> Result<()> {
    if target.os.is_some_and(|os| ComponentPlatform::current().is_none_or(|p| p.os != os)) {
        return Err("Target is not supported on this system".into());
    }
    if !root.is_absolute() || (!root.is_dir() && (target.location.is_none() || !target.required_files.is_empty())) {
        return Err("Select an existing absolute application directory".into());
    }
    safe_destination(root, ".opensd-validation")?;
    for file in &target.required_files {
        let path = safe_destination(root, file)?;
        if !fs::symlink_metadata(path).is_ok_and(|m| m.is_file() && !linked(&m)) {
            return Err(format!("Selected directory is missing {file}"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("opensd-components-{}", super::super::token().unwrap()));
            fs::create_dir(&path).unwrap();
            Self(path.canonicalize().unwrap())
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(windows)]
    #[test]
    fn discovery_merges_windows_path_aliases_but_keeps_separate_installations() {
        let fixture = Fixture::new();
        let game = fixture.0.join("Steam Library Тест").join("Euro Truck Simulator 2");
        let other_game = fixture.0.join("Another Installation");
        fs::create_dir_all(&game).unwrap();
        fs::create_dir(&other_game).unwrap();
        let lowercase = PathBuf::from(game.to_string_lossy().to_ascii_lowercase().replace('\\', "/"));
        let mixed = game.parent().unwrap().join("Euro Truck Simulator 2/");
        let paths =
            unique_directories(vec![game.clone(), lowercase, mixed, game.join("."), other_game.clone()]).unwrap();
        let mut expected = vec![game.canonicalize().unwrap(), other_game.canonicalize().unwrap()];
        expected.sort();
        assert_eq!(paths, expected);
    }

    fn pending(
        root: &Path,
        previous: &[Installation],
        uninstall: bool,
        original: Option<Vec<u8>>,
        bytes: Option<Vec<u8>>,
    ) -> Pending {
        let before = plain_file(&root.join("bridge.dll")).unwrap();
        let before_mode = file_mode(&root.join("bridge.dll")).unwrap();
        let after_mode = if cfg!(unix) && bytes.is_some() { Some(before_mode.unwrap_or(0o644)) } else { None };
        let installation = Installation {
            id: "installation".into(),
            plugin: "com.example.test".into(),
            component: "bridge".into(),
            target: "example".into(),
            version: "1.0.0".into(),
            root: root.into(),
            directories: Vec::new(),
            executables: Vec::new(),
            files: vec![InstalledFile {
                path: "bridge.dll".into(),
                hash: hash(&bytes).unwrap_or_default(),
                owned: true,
                original,
                original_mode: before_mode,
                mode: after_mode,
            }],
        };
        Pending {
            view: Plan {
                id: "plan".into(),
                plugin: installation.plugin.clone(),
                component: "bridge".into(),
                target: "example".into(),
                root: root.into(),
                version: "1.0.0".into(),
                conflicts: false,
                uninstall,
                changes: vec![FileChange {
                    path: "bridge.dll".into(),
                    action: "update".into(),
                    before: hash(&before),
                    after: hash(&bytes),
                    before_mode,
                    after_mode,
                }],
            },
            source_hashes: BTreeMap::new(),
            manifest: None,
            source: None,
            writes: BTreeMap::from([("bridge.dll".into(), bytes)]),
            installation,
            records_digest: opensd_package::sha256(&serde_json::to_vec(previous).unwrap()),
        }
    }

    #[test]
    fn installs_updates_and_restores_original_without_accepting_stale_plans() {
        let fixture = Fixture::new();
        let root = fixture.0.join("app");
        let state = fixture.0.join("state");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("bridge.dll"), b"original").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(root.join("bridge.dll"), fs::Permissions::from_mode(0o640)).unwrap();
        }
        let original_mode = file_mode(&root.join("bridge.dll")).unwrap();
        let first = pending(&root, &[], false, Some(b"original".to_vec()), Some(b"version1".to_vec()));
        fs::write(root.join("bridge.dll"), b"changed after preview").unwrap();
        assert!(apply_pending(&state, first, false).is_err());
        assert_eq!(fs::read(root.join("bridge.dll")).unwrap(), b"changed after preview");
        fs::write(root.join("bridge.dll"), b"original").unwrap();
        apply_pending(
            &state,
            pending(&root, &[], false, Some(b"original".to_vec()), Some(b"version1".to_vec())),
            false,
        )
        .unwrap();
        let installed = records(&state).unwrap();
        apply_pending(
            &state,
            pending(&root, &installed, false, installed[0].files[0].original.clone(), Some(b"version2".to_vec())),
            false,
        )
        .unwrap();
        assert_eq!(fs::read(root.join("bridge.dll")).unwrap(), b"version2");
        assert_eq!(file_mode(&root.join("bridge.dll")).unwrap(), original_mode);
        let installed = records(&state).unwrap();
        apply_pending(&state, pending(&root, &installed, true, None, installed[0].files[0].original.clone()), false)
            .unwrap();
        assert_eq!(fs::read(root.join("bridge.dll")).unwrap(), b"original");
        assert_eq!(file_mode(&root.join("bridge.dll")).unwrap(), original_mode);
        assert!(records(&state).unwrap().is_empty());
    }

    #[test]
    fn recovery_preserves_unrelated_edits_and_can_resume_after_restart() {
        let fixture = Fixture::new();
        let root = fixture.0.join("app");
        let state = fixture.0.join("state");
        fs::create_dir(&root).unwrap();
        let p = pending(&root, &[], false, None, Some(b"installed".to_vec()));
        let journal = Journal {
            plan: p.view,
            before: vec![("bridge.dll".into(), Some(b"original".to_vec()))],
            previous: Vec::new(),
            next: Vec::new(),
            committed: false,
            directories: Vec::new(),
        };
        save_json(&state.join("journal.json"), &journal).unwrap();
        fs::write(root.join("bridge.dll"), b"external edit").unwrap();
        assert!(recover(&state).is_err());
        assert_eq!(fs::read(root.join("bridge.dll")).unwrap(), b"external edit");
        fs::write(root.join("bridge.dll"), b"installed").unwrap();
        recover(&state).unwrap();
        assert_eq!(fs::read(root.join("bridge.dll")).unwrap(), b"original");
        assert!(!state.join("journal.json").exists());
    }

    #[test]
    fn rejects_path_escapes_and_windows_junctions() {
        let fixture = Fixture::new();
        assert!(safe_destination(&fixture.0, "../outside.dll").is_err());
        assert!(safe_destination(&fixture.0, "C:/outside.dll").is_err());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let outside = Fixture::new();
            let junction = fixture.0.join("linked");
            let status = std::process::Command::new("cmd.exe")
                .args(["/c", "mklink", "/J"])
                .arg(&junction)
                .arg(&outside.0)
                .creation_flags(0x08000000)
                .output()
                .unwrap();
            assert!(status.status.success(), "{}", String::from_utf8_lossy(&status.stderr));
            assert!(safe_destination(&fixture.0, "linked/bridge.dll").is_err());
            fs::remove_dir(junction).unwrap();
        }
    }
}
