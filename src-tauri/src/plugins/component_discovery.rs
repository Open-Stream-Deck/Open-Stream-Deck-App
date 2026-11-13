use opensd_package::{ComponentTarget, KnownDirectory, TargetDiscovery};
use std::path::PathBuf;

pub fn known_directory(base: KnownDirectory) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from).filter(|p| p.is_absolute());
    let absolute_env = |name| std::env::var_os(name).map(PathBuf::from).filter(|p| p.is_absolute());
    match base {
        KnownDirectory::AppData if cfg!(windows) => absolute_env("APPDATA"),
        KnownDirectory::LocalAppData if cfg!(windows) => absolute_env("LOCALAPPDATA"),
        KnownDirectory::Config if cfg!(target_os = "linux") => {
            absolute_env("XDG_CONFIG_HOME").or_else(|| home.map(|p| p.join(".config")))
        }
        KnownDirectory::Data if cfg!(target_os = "linux") => {
            absolute_env("XDG_DATA_HOME").or_else(|| home.map(|p| p.join(".local/share")))
        }
        KnownDirectory::ApplicationSupport if cfg!(target_os = "macos") => {
            home.map(|p| p.join("Library/Application Support"))
        }
        _ => None,
    }
}

pub fn steam(target: &ComponentTarget) -> Result<Vec<PathBuf>, String> {
    if !target.discovery.iter().any(|d| matches!(d, TargetDiscovery::Steam { .. })) {
        return Ok(Vec::new());
    }
    let mut roots = Vec::new();
    if cfg!(windows) {
        for name in ["PROGRAMFILES(X86)", "PROGRAMFILES"] {
            if let Some(programs) = std::env::var_os(name) {
                roots.push(PathBuf::from(programs).join("Steam"));
            }
        }
    }
    #[cfg(windows)]
    if let Some(root) = registered_steam()? {
        roots.push(root);
    }
    if cfg!(target_os = "linux") {
        if let Some(data) = known_directory(KnownDirectory::Data) {
            roots.push(data.join("Steam"));
        }
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from).filter(|p| p.is_absolute()) {
            roots.extend([
                home.join(".steam/steam"),
                home.join(".steam/root"),
                home.join(".var/app/com.valvesoftware.Steam/data/Steam"),
            ]);
        }
    }
    if let Some(support) = known_directory(KnownDirectory::ApplicationSupport) {
        roots.push(support.join("Steam"));
    }
    steam_libraries(target, roots)
}

fn steam_libraries(target: &ComponentTarget, roots: Vec<PathBuf>) -> Result<Vec<PathBuf>, String> {
    let mut libraries = roots.clone();
    for root in roots {
        let path = root.join("steamapps/libraryfolders.vdf");
        match std::fs::read_to_string(&path) {
            Ok(text) => {
                for pair in strings(&text).windows(2) {
                    if pair[0] == "path" {
                        libraries.push(PathBuf::from(&pair[1]));
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("{}: {e}", path.display())),
        }
    }
    let mut found = Vec::new();
    for library in libraries {
        for discovery in &target.discovery {
            let TargetDiscovery::Steam { app_id } = discovery;
            let path = library.join("steamapps").join(format!("appmanifest_{app_id}.acf"));
            match std::fs::read_to_string(&path) {
                Ok(text) => {
                    for pair in strings(&text).windows(2) {
                        if pair[0] == "installdir" && opensd_package::safe_path(&pair[1]) {
                            let installation = library.join("steamapps/common").join(&pair[1]);
                            if installation.is_dir() {
                                found.push(installation.canonicalize().map_err(|e| e.to_string())?);
                            }
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("{}: {e}", path.display())),
            }
        }
    }
    Ok(found)
}

fn strings(text: &str) -> Vec<String> {
    let mut strings = Vec::new();
    let mut chars = text.chars();
    while let Some(ch) = chars.next() {
        if ch != '"' {
            continue;
        }
        let mut value = String::new();
        while let Some(ch) = chars.next() {
            match ch {
                '"' => break,
                '\\' => {
                    if let Some(next) = chars.next() {
                        value.push(next);
                    }
                }
                _ => value.push(ch),
            }
        }
        strings.push(value);
    }
    strings
}

#[cfg(windows)]
fn registered_steam() -> Result<Option<PathBuf>, String> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_SZ, RegGetValueW};
    let key: Vec<u16> = "Software\\Valve\\Steam".encode_utf16().chain([0]).collect();
    let name: Vec<u16> = "SteamPath".encode_utf16().chain([0]).collect();
    let mut size = 0;
    let code = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if code == 2 || code == 3 {
        return Ok(None);
    }
    if code != 0 || size == 0 || size > 32768 {
        return Err(format!("Steam registry lookup failed: {code}"));
    }
    let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
    let code = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if code != 0 {
        return Err(format!("Steam registry lookup failed: {code}"));
    }
    let length = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
    Ok(Some(PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length]))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_game_in_secondary_steam_library_without_scanning() {
        let temp = std::env::temp_dir().join(format!("opensd-steam-{}", super::super::token().unwrap()));
        let steam = temp.join("Steam");
        let library = temp.join("Library Тест");
        let game = library.join("steamapps/common/Example Game");
        std::fs::create_dir_all(steam.join("steamapps")).unwrap();
        std::fs::create_dir_all(&game).unwrap();
        std::fs::write(
            steam.join("steamapps/libraryfolders.vdf"),
            format!("\"libraryfolders\" {{ \"1\" {{ \"path\" {} }} }}", serde_json::to_string(&library).unwrap()),
        )
        .unwrap();
        std::fs::write(
            library.join("steamapps/appmanifest_123.acf"),
            "\"AppState\" { \"installdir\" \"Example Game\" }",
        )
        .unwrap();
        let target: ComponentTarget = serde_json::from_value(serde_json::json!({
            "id": "example", "name": "Example", "selection": "directory", "discovery": [{ "type": "steam", "app_id": "123" }]
        })).unwrap();
        let found = steam_libraries(&target, vec![steam]).unwrap();
        assert_eq!(found, vec![game.canonicalize().unwrap()]);
        std::fs::remove_dir_all(temp).unwrap();
    }
}
