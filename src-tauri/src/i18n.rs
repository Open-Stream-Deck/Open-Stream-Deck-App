use std::sync::atomic::{AtomicU8, Ordering};

static LANG: AtomicU8 = AtomicU8::new(0);

pub fn set(lang: &str) {
    let lang = lang.to_ascii_lowercase();
    let index = if lang.starts_with("ru") {
        0
    } else if lang.starts_with("zh") {
        2
    } else {
        1
    };
    LANG.store(index, Ordering::Relaxed);
}

pub fn lang() -> u8 {
    LANG.load(Ordering::Relaxed)
}

#[macro_export]
macro_rules! tr {
    ($ru:literal, $en:literal, $zh:literal $(, $arg:expr)* $(,)?) => {
        match $crate::i18n::lang() {
            1 => format!($en $(, $arg)*),
            2 => format!($zh $(, $arg)*),
            _ => format!($ru $(, $arg)*),
        }
    };
}
