use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System, UpdateKind};

const FRESH: Duration = Duration::from_secs(1);

static CACHE: Mutex<Option<(Instant, System)>> = Mutex::new(None);

fn canon(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn same(exe: &Path, target: &Path) -> bool {
    if cfg!(windows) {
        exe.as_os_str().eq_ignore_ascii_case(target.as_os_str())
    } else {
        exe == target || (cfg!(target_os = "macos") && exe.starts_with(target))
    }
}

pub fn find(path: &Path) -> Vec<(u32, Vec<String>)> {
    let target = canon(path);
    let target = target.to_string_lossy();
    let target = Path::new(target.strip_prefix(r"\\?\").unwrap_or(&target));
    let mut cache = CACHE.lock().unwrap();
    if cache.as_ref().is_none_or(|(at, _)| at.elapsed() > FRESH) {
        let mut system = System::new_with_specifics(RefreshKind::nothing());
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::Always).with_cmd(UpdateKind::Always),
        );
        *cache = Some((Instant::now(), system));
    }
    let (_, system) = cache.as_ref().unwrap();
    system
        .processes()
        .iter()
        .filter(|(_, p)| p.exe().is_some_and(|exe| same(exe, target)))
        .map(|(pid, p)| (pid.as_u32(), p.cmd().iter().skip(1).map(|a| a.to_string_lossy().into_owned()).collect()))
        .filter(|(_, args): &(u32, Vec<String>)| !args.iter().any(|a| a.starts_with("--type=")))
        .collect()
}

pub fn forget() {
    *CACHE.lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_itself() {
        let exe = std::env::current_exe().unwrap();
        let pid = std::process::id();
        assert!(find(&exe).iter().any(|(p, _)| *p == pid));
        assert!(find(Path::new("/definitely/not/here.exe")).is_empty());
    }
}
