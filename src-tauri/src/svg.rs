use base64::Engine;
use resvg::{tiny_skia, usvg};
use std::sync::OnceLock;

fn options() -> &'static usvg::Options<'static> {
    static OPTIONS: OnceLock<usvg::Options> = OnceLock::new();
    OPTIONS.get_or_init(|| {
        let mut opt = usvg::Options::default();
        let db = opt.fontdb_mut();
        db.load_system_fonts();
        let ids: Vec<_> = db.faces().map(|f| f.id).collect();
        for id in ids {
            unsafe { db.make_shared_face_data(id) };
        }
        opt
    })
}

fn payload(src: &str) -> Result<Vec<u8>, String> {
    let (head, body) = src.split_once(',').ok_or("bad data uri")?;
    if head.ends_with(";base64") {
        return base64::engine::general_purpose::STANDARD.decode(body.trim()).map_err(|e| e.to_string());
    }
    Ok(percent_encoding::percent_decode_str(body).collect())
}

pub fn raster(src: &str, size: u32) -> Result<Vec<u8>, String> {
    let tree = usvg::Tree::from_data(&payload(src)?, options()).map_err(|e| e.to_string())?;
    let (w, h) = (tree.size().width(), tree.size().height());
    let k = size.min(1024) as f32 / w.max(h);
    let (pw, ph) = ((w * k).round().max(1.0) as u32, (h * k).round().max(1.0) as u32);
    let mut pixmap = tiny_skia::Pixmap::new(pw, ph).ok_or("empty svg")?;
    resvg::render(&tree, tiny_skia::Transform::from_scale(pw as f32 / w, ph as f32 / h), &mut pixmap.as_mut());
    let mut out = Vec::with_capacity(8 + pixmap.data().len());
    out.extend_from_slice(&pw.to_le_bytes());
    out.extend_from_slice(&ph.to_le_bytes());
    for p in pixmap.pixels() {
        let c = p.demultiply();
        out.extend_from_slice(&[c.red(), c.green(), c.blue(), c.alpha()]);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rasters_data_uris() {
        let svg = "<svg xmlns='http://www.w3.org/2000/svg' width='72' height='36'><rect width='72' height='36' fill='#ff0000'/></svg>";
        let b64 = format!("data:image/svg+xml;base64,{}", base64::engine::general_purpose::STANDARD.encode(svg));
        let plain = format!("data:image/svg+xml,{}", svg.replace('#', "%23"));
        for src in [b64, plain] {
            let out = raster(&src, 256).unwrap();
            assert_eq!(u32::from_le_bytes(out[0..4].try_into().unwrap()), 256);
            assert_eq!(u32::from_le_bytes(out[4..8].try_into().unwrap()), 128);
            assert_eq!(&out[8..12], &[255, 0, 0, 255]);
            assert_eq!(out.len(), 8 + 256 * 128 * 4);
        }
    }
}
