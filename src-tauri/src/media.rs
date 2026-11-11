#[cfg(windows)]
mod imp {
    use std::time::{SystemTime, UNIX_EPOCH};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{IMMDeviceEnumerator, MMDeviceEnumerator, eMultimedia, eRender};
    use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx};
    use windows::core::Result;

    const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;

    fn endpoint() -> Result<IAudioEndpointVolume> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            devices.GetDefaultAudioEndpoint(eRender, eMultimedia)?.Activate(CLSCTX_ALL, None)
        }
    }

    pub fn muted() -> Result<bool> {
        unsafe { Ok(endpoint()?.GetMute()?.as_bool()) }
    }

    pub fn toggle_mute() -> Result<()> {
        let volume = endpoint()?;
        unsafe { volume.SetMute(!volume.GetMute()?.as_bool(), std::ptr::null()) }
    }

    pub fn volume(delta: f32) -> Result<()> {
        let volume = endpoint()?;
        unsafe {
            let level = (volume.GetMasterVolumeLevelScalar()? + delta).clamp(0.0, 1.0);
            volume.SetMute(false, std::ptr::null())?;
            volume.SetMasterVolumeLevelScalar(level, std::ptr::null())
        }
    }

    fn session() -> Result<Session> {
        Manager::RequestAsync()?.join()?.GetCurrentSession()
    }

    pub fn playing() -> Result<bool> {
        Ok(session()?.GetPlaybackInfo()?.PlaybackStatus()? == Status::Playing)
    }

    pub fn play_pause() -> Result<()> {
        session()?.TryTogglePlayPauseAsync()?.join()?;
        Ok(())
    }

    pub fn skip(forward: bool) -> Result<()> {
        let session = session()?;
        if forward {
            session.TrySkipNextAsync()?.join()?
        } else {
            session.TrySkipPreviousAsync()?.join()?
        };
        Ok(())
    }

    fn now_ticks() -> i64 {
        let since = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        UNIX_EPOCH_TICKS + (since.as_nanos() / 100) as i64
    }

    pub fn seek(seconds: f64) -> Result<()> {
        let session = session()?;
        let timeline = session.GetTimelineProperties()?;
        let mut position = timeline.Position()?.Duration;
        if session.GetPlaybackInfo()?.PlaybackStatus()? == Status::Playing {
            position += now_ticks() - timeline.LastUpdatedTime()?.UniversalTime;
        }
        let target =
            (position + (seconds * 1e7) as i64).clamp(timeline.StartTime()?.Duration, timeline.EndTime()?.Duration);
        session.TryChangePlaybackPositionAsync(target)?.join()?;
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod imp {
    const PLAYER: &str = "/org/mpris/MediaPlayer2";

    fn run(program: &str, args: &[&str]) -> Result<String, String> {
        let out = crate::actions::command(program).args(args).output().map_err(|e| format!("{program}: {e}"))?;
        if !out.status.success() {
            return Err(format!("{program}: {}", out.status));
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn gdbus(dest: &str, path: &str, method: &str, args: &[&str]) -> Result<String, String> {
        let mut all = vec!["call", "--session", "--dest", dest, "--object-path", path, "--method", method];
        all.extend_from_slice(args);
        run("gdbus", &all)
    }

    fn players() -> Vec<String> {
        gdbus("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.ListNames", &[])
            .unwrap_or_default()
            .split('\'')
            .filter(|name| name.starts_with("org.mpris.MediaPlayer2."))
            .map(String::from)
            .collect()
    }

    fn is_playing(player: &str) -> bool {
        let args = ["org.mpris.MediaPlayer2.Player", "PlaybackStatus"];
        gdbus(player, PLAYER, "org.freedesktop.DBus.Properties.Get", &args).is_ok_and(|out| out.contains("Playing"))
    }

    fn call(method: &str, args: &[&str]) -> Result<(), String> {
        let all = players();
        let player = all.iter().find(|p| is_playing(p)).or(all.first()).ok_or("No MPRIS player")?;
        gdbus(player, PLAYER, &format!("org.mpris.MediaPlayer2.Player.{method}"), args).map(drop)
    }

    fn sink(wpctl: &[&str], pactl: &[&str]) -> Result<String, String> {
        run("wpctl", wpctl).or_else(|_| run("pactl", pactl))
    }

    pub fn muted() -> Result<bool, String> {
        sink(&["get-volume", "@DEFAULT_AUDIO_SINK@"], &["get-sink-mute", "@DEFAULT_SINK@"])
            .map(|out| out.contains("MUTED") || out.contains("yes"))
    }

    pub fn toggle_mute() -> Result<(), String> {
        sink(&["set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"], &["set-sink-mute", "@DEFAULT_SINK@", "toggle"]).map(drop)
    }

    pub fn volume(delta: f32) -> Result<(), String> {
        let pct = (delta.abs() * 100.0).round();
        let sign = if delta < 0.0 { "-" } else { "+" };
        let wpctl = format!("{pct}%{sign}");
        let pactl = format!("{sign}{pct}%");
        sink(
            &["set-volume", "-l", "1", "@DEFAULT_AUDIO_SINK@", &wpctl],
            &["--", "set-sink-volume", "@DEFAULT_SINK@", &pactl],
        )
        .map(drop)
    }

    pub fn playing() -> Result<bool, String> {
        Ok(players().iter().any(|p| is_playing(p)))
    }

    pub fn play_pause() -> Result<(), String> {
        call("PlayPause", &[])
    }

    pub fn skip(forward: bool) -> Result<(), String> {
        call(if forward { "Next" } else { "Previous" }, &[])
    }

    pub fn seek(seconds: f64) -> Result<(), String> {
        call("Seek", &[&format!("int64 {}", (seconds * 1e6) as i64)])
    }
}

#[cfg(any(windows, target_os = "linux"))]
pub fn muted() -> Result<bool, String> {
    imp::muted().map_err(|e| e.to_string())
}

#[cfg(any(windows, target_os = "linux"))]
pub fn toggle_mute() -> Result<(), String> {
    imp::toggle_mute().map_err(|e| e.to_string())
}

#[cfg(any(windows, target_os = "linux"))]
pub fn volume(delta: f32) -> Result<(), String> {
    imp::volume(delta).map_err(|e| e.to_string())
}

#[cfg(any(windows, target_os = "linux"))]
pub fn playing() -> bool {
    imp::playing().unwrap_or(false)
}

#[cfg(any(windows, target_os = "linux"))]
pub fn play_pause() -> Result<(), String> {
    imp::play_pause().map_err(|e| e.to_string())
}

#[cfg(any(windows, target_os = "linux"))]
pub fn skip(forward: bool) -> Result<(), String> {
    imp::skip(forward).map_err(|e| e.to_string())
}

#[cfg(any(windows, target_os = "linux"))]
pub fn seek(seconds: f64) -> Result<(), String> {
    imp::seek(seconds).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
pub fn muted() -> Result<bool, String> {
    Err("unsupported".into())
}

#[cfg(target_os = "macos")]
pub fn toggle_mute() -> Result<(), String> {
    Err("unsupported".into())
}

#[cfg(target_os = "macos")]
pub fn volume(_delta: f32) -> Result<(), String> {
    Err("unsupported".into())
}

#[cfg(target_os = "macos")]
pub fn playing() -> bool {
    false
}

#[cfg(target_os = "macos")]
pub fn play_pause() -> Result<(), String> {
    Err("unsupported".into())
}

#[cfg(target_os = "macos")]
pub fn skip(_forward: bool) -> Result<(), String> {
    Err("unsupported".into())
}

#[cfg(target_os = "macos")]
pub fn seek(_seconds: f64) -> Result<(), String> {
    Err("unsupported".into())
}
