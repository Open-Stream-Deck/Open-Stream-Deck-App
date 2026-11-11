use serde::Serialize;

#[derive(Serialize, Clone, Default)]
pub struct Gpu {
    pub id: String,
    pub name: String,
    pub load: f32,
    pub mem_used: u64,
    pub mem_total: u64,
}

#[cfg(windows)]
mod imp {
    use super::Gpu;
    use std::collections::HashMap;
    use windows::Win32::Foundation::LUID;
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE, IDXGIFactory1};
    use windows::Win32::System::Performance::*;
    use windows::core::{PCWSTR, w};

    struct Adapter {
        luid: String,
        name: String,
        total: u64,
    }

    pub struct Gpus {
        query: PDH_HQUERY,
        engines: PDH_HCOUNTER,
        memory: PDH_HCOUNTER,
        adapters: Vec<Adapter>,
    }

    unsafe impl Send for Gpus {}

    fn luid(l: LUID) -> String {
        format!("0x{:08x}_0x{:08x}", l.HighPart as u32, l.LowPart)
    }

    fn adapters() -> Vec<Adapter> {
        let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else { return Vec::new() };
        (0..)
            .map_while(|i| unsafe { factory.EnumAdapters1(i) }.ok())
            .filter_map(|a| unsafe { a.GetDesc1() }.ok())
            .filter(|d| d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 == 0)
            .map(|d| Adapter {
                luid: luid(d.AdapterLuid),
                name: String::from_utf16_lossy(&d.Description).trim_end_matches('\0').trim().to_string(),
                total: d.DedicatedVideoMemory as u64,
            })
            .collect()
    }

    fn luid_of(instance: &str) -> Option<&str> {
        instance.split("luid_").nth(1)?.get(..21)
    }

    fn values(counter: PDH_HCOUNTER) -> Vec<(String, f64)> {
        let (mut size, mut count) = (0u32, 0u32);
        unsafe {
            if PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, None) != PDH_MORE_DATA {
                return Vec::new();
            }
            let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
            let items = buffer.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
            if PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, Some(items)) != 0 {
                return Vec::new();
            }
            std::slice::from_raw_parts(items, count as usize)
                .iter()
                .filter(|i| i.FmtValue.CStatus <= PDH_CSTATUS_NEW_DATA)
                .map(|i| (i.szName.to_string().unwrap_or_default().to_lowercase(), i.FmtValue.Anonymous.doubleValue))
                .collect()
        }
    }

    impl Gpus {
        pub fn new() -> Option<Self> {
            let mut query = PDH_HQUERY::default();
            let mut engines = PDH_HCOUNTER::default();
            let mut memory = PDH_HCOUNTER::default();
            unsafe {
                if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != 0 {
                    return None;
                }
                PdhAddEnglishCounterW(query, w!(r"\GPU Engine(*)\Utilization Percentage"), 0, &mut engines);
                PdhAddEnglishCounterW(query, w!(r"\GPU Adapter Memory(*)\Dedicated Usage"), 0, &mut memory);
                PdhCollectQueryData(query);
            }
            Some(Gpus { query, engines, memory, adapters: adapters() })
        }

        pub fn sample(&mut self) -> Vec<Gpu> {
            unsafe { PdhCollectQueryData(self.query) };
            let mut engines: HashMap<(String, String), f64> = HashMap::new();
            for (name, value) in values(self.engines) {
                let (Some(luid), Some(kind)) = (luid_of(&name), name.split("engtype_").nth(1)) else { continue };
                *engines.entry((luid.to_string(), kind.to_string())).or_default() += value;
            }
            let mut memory: HashMap<String, f64> = HashMap::new();
            for (name, value) in values(self.memory) {
                if let Some(luid) = luid_of(&name) {
                    *memory.entry(luid.to_string()).or_default() += value;
                }
            }
            self.adapters
                .iter()
                .map(|a| Gpu {
                    id: a.luid.clone(),
                    name: a.name.clone(),
                    load: engines
                        .iter()
                        .filter(|((l, _), _)| *l == a.luid)
                        .map(|(_, v)| *v)
                        .fold(0.0, f64::max)
                        .min(100.0) as f32,
                    mem_used: memory.get(&a.luid).copied().unwrap_or(0.0) as u64,
                    mem_total: a.total,
                })
                .collect()
        }
    }

    impl Drop for Gpus {
        fn drop(&mut self) {
            unsafe { PdhCloseQuery(self.query) };
        }
    }
}

#[cfg(windows)]
pub use imp::Gpus;

#[cfg(not(windows))]
pub struct Gpus;

#[cfg(not(windows))]
impl Gpus {
    pub fn new() -> Option<Self> {
        None
    }

    pub fn sample(&mut self) -> Vec<Gpu> {
        Vec::new()
    }
}
