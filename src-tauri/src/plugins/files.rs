use percent_encoding::percent_decode_str;
use std::borrow::Cow;
use std::fs;
use std::path::Path;
use tauri::http::{Request, Response, StatusCode, header};

const PAGE_POLICY: &str = "default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("wasm") => "application/wasm",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn respond(status: StatusCode, mime: &str, body: Cow<'static, [u8]>) -> Response<Cow<'static, [u8]>> {
    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-cache")
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .body(body)
        .unwrap();
    if mime.starts_with("text/html") || mime == "image/svg+xml" {
        response.headers_mut().insert(header::CONTENT_SECURITY_POLICY, header::HeaderValue::from_static(PAGE_POLICY));
    }
    response
}

pub fn not_found() -> Response<Cow<'static, [u8]>> {
    respond(StatusCode::NOT_FOUND, "text/plain", Cow::Borrowed(b"Not found"))
}

pub fn split(request: &Request<Vec<u8>>) -> Option<(String, String)> {
    let path = percent_decode_str(request.uri().path()).decode_utf8_lossy().into_owned();
    let (id, rest) = path.trim_start_matches('/').split_once('/')?;
    Some((id.to_string(), rest.to_string()))
}

pub fn bridge(path: &str) -> Option<Response<Cow<'static, [u8]>>> {
    opensd_ui::file(path).map(|(mime, body)| respond(StatusCode::OK, mime, Cow::Borrowed(body)))
}

pub fn serve(root: &Path, rel: &str) -> Response<Cow<'static, [u8]>> {
    if rel.is_empty() || !opensd_package::safe_path(rel) {
        return not_found();
    }
    let (Ok(file), Ok(base)) = (root.join(rel).canonicalize(), root.canonicalize()) else {
        return not_found();
    };
    if !file.starts_with(&base) || !file.is_file() {
        return not_found();
    }
    match fs::read(&file) {
        Ok(body) => respond(StatusCode::OK, mime(&file), Cow::Owned(body)),
        Err(_) => not_found(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages_get_the_strict_policy_and_paths_stay_inside() {
        let root = std::env::temp_dir().join(format!("opensd-files-{}", std::process::id()));
        fs::create_dir_all(root.join("ui")).unwrap();
        fs::write(root.join("ui/page.html"), b"<!doctype html>").unwrap();
        fs::write(root.join("plugin.js"), b"1").unwrap();
        let page = serve(&root, "ui/page.html");
        let policy = page.headers()[header::CONTENT_SECURITY_POLICY].to_str().unwrap();
        assert!(
            policy.contains("connect-src 'none'")
                && policy.contains("sandbox allow-scripts")
                && !policy.contains("allow-same-origin")
        );
        assert!(!serve(&root, "plugin.js").headers().contains_key(header::CONTENT_SECURITY_POLICY));
        for bad in ["../secret", "ui/../../x", "/etc/passwd", "ui\\page.html", ""] {
            assert_eq!(serve(&root, bad).status(), StatusCode::NOT_FOUND, "{bad}");
        }
        assert!(bridge("/_opensd/inspector.js").is_some() && bridge("/_opensd/other.js").is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
