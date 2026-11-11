use crate::gpu::{Gpu, Gpus};
use serde::Serialize;
use std::sync::Mutex;
use std::time::Instant;
use sysinfo::{Disks, Networks, System};

#[derive(Serialize, Clone, Default)]
pub struct Stats {
    pub cpu: f32,
    pub cores: Vec<f32>,
    pub ram_used: u64,
    pub ram_total: u64,
    pub net_down: f64,
    pub net_up: f64,
    pub disks: Vec<DiskStat>,
    pub gpus: Vec<Gpu>,
    pub uptime: u64,
}

#[derive(Serialize, Clone, Default)]
pub struct DiskStat {
    pub id: String,
    pub name: String,
    pub used: u64,
    pub total: u64,
}

pub struct Collector {
    inner: Mutex<Inner>,
}

struct Inner {
    system: System,
    networks: Networks,
    disks: Disks,
    last: Instant,
    disk_checked: Option<Instant>,
    gpus: Option<Gpus>,
}

impl Collector {
    pub fn new() -> Self {
        let mut system = System::new();
        system.refresh_cpu_usage();
        system.refresh_memory();
        Collector {
            inner: Mutex::new(Inner {
                system,
                networks: Networks::new_with_refreshed_list(),
                disks: Disks::new_with_refreshed_list(),
                last: Instant::now(),
                disk_checked: None,
                gpus: Gpus::new(),
            }),
        }
    }

    pub fn sample(&self) -> Stats {
        let mut s = self.inner.lock().unwrap();
        let elapsed = s.last.elapsed().as_secs_f64().max(0.05);
        s.last = Instant::now();
        s.system.refresh_cpu_usage();
        s.system.refresh_memory();
        s.networks.refresh(true);
        if s.disk_checked.is_none_or(|t| t.elapsed().as_secs() >= 10) {
            s.disks.refresh(true);
            s.disk_checked = Some(Instant::now());
        }
        let (down, up) = s.networks.iter().fold((0u64, 0u64), |(d, u), (_, n)| (d + n.received(), u + n.transmitted()));
        let root = std::env::var("SystemDrive").map_or_else(|_| "/".into(), |drive| format!("{drive}\\"));
        let mut disks: Vec<DiskStat> = s
            .disks
            .iter()
            .filter(|d| d.total_space() > 0)
            .map(|d| DiskStat {
                id: d.mount_point().to_string_lossy().into_owned(),
                name: d.name().to_string_lossy().into_owned(),
                used: d.total_space() - d.available_space(),
                total: d.total_space(),
            })
            .collect();
        disks.sort_by_key(|d| !d.id.eq_ignore_ascii_case(&root));
        Stats {
            cpu: s.system.global_cpu_usage(),
            cores: s.system.cpus().iter().map(|c| c.cpu_usage()).collect(),
            ram_used: s.system.used_memory(),
            ram_total: s.system.total_memory(),
            net_down: down as f64 / elapsed,
            net_up: up as f64 / elapsed,
            disks,
            gpus: s.gpus.as_mut().map(Gpus::sample).unwrap_or_default(),
            uptime: System::uptime(),
        }
    }
}
