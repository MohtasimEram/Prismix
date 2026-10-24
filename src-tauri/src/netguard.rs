//! Where the native network layer may go: public https hosts only.
//!
//! The page can ask Rust to fetch any URL, so Rust must not become a way into
//! the user's LAN, router or localhost services (SSRF). Every hostname is
//! resolved by [`PublicResolver`], which drops private, loopback, link-local
//! and other special addresses; IP-literal URLs are checked directly; and
//! redirects are re-checked hop by hop.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use url::{Host, Url};

use crate::error::{AppError, AppResult};

pub fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || a == 0
        || (a == 100 && (64..=127).contains(&b)) // CGNAT, 100.64.0.0/10
        || (a == 192 && b == 0 && c == 0) // IETF protocol assignments
        || (a == 198 && (18..=19).contains(&b)) // benchmarking
        || a >= 240) // reserved
}

pub fn is_public_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_public_v4(v4);
    }
    let first = ip.segments()[0];
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || (first & 0xfe00) == 0xfc00 // unique local, fc00::/7
        || (first & 0xffc0) == 0xfe80 // link local, fe80::/10
        || (first & 0xffc0) == 0xfec0 // site local (deprecated)
        || (first == 0x2001 && ip.segments()[1] == 0x0db8) // documentation
        || (first == 0x0064 && ip.segments()[1] == 0xff9b)) // NAT64 to arbitrary v4
}

pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => is_public_v6(v6),
    }
}

fn is_local_name(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || host.ends_with(".internal") || !host.contains('.')
}

/// Whether a URL may be fetched natively. DNS answers are checked separately by the resolver.
pub fn check_url(url: &Url, allow_ws: bool) -> AppResult<()> {
    let scheme_ok = match url.scheme() {
        "https" => true,
        "wss" => allow_ws,
        _ => false,
    };
    if !scheme_ok {
        return Err(AppError::blocked(format!("Only secure ({}) URLs are allowed", if allow_ws { "wss" } else { "https" })));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::blocked("URLs with credentials are not allowed"));
    }
    match url.host() {
        Some(Host::Domain(name)) if !is_local_name(name) => Ok(()),
        Some(Host::Ipv4(ip)) if is_public_v4(ip) => Ok(()),
        Some(Host::Ipv6(ip)) if is_public_v6(ip) => Ok(()),
        _ => Err(AppError::blocked("Local and private network addresses are not reachable from Prismix")),
    }
}

/// System DNS, minus every answer that isn't a public address.
#[derive(Default)]
pub struct PublicResolver;

impl Resolve for PublicResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_owned();
        Box::pin(async move {
            let found = tokio::net::lookup_host((host.as_str(), 0)).await?;
            let public: Vec<SocketAddr> = found.filter(|addr| is_public(addr.ip())).collect();
            if public.is_empty() {
                let error: Box<dyn std::error::Error + Send + Sync> =
                    Box::new(AppError::blocked(format!("{host} resolves only to private or local addresses")));
                return Err(error);
            }
            let addrs: Addrs = Box::new(public.into_iter());
            Ok(addrs)
        })
    }
}

pub fn resolver() -> Arc<PublicResolver> {
    Arc::new(PublicResolver)
}

/// Resolves a host for a raw TCP connection (the WebSocket proxy), public addresses only.
pub async fn resolve_public(host: &str, port: u16) -> AppResult<Vec<SocketAddr>> {
    if let Ok(ip) = host.trim_start_matches('[').trim_end_matches(']').parse::<IpAddr>() {
        return if is_public(ip) { Ok(vec![SocketAddr::new(ip, port)]) } else { Err(AppError::blocked("Private address")) };
    }
    let found = tokio::net::lookup_host((host, port)).await.map_err(|e| AppError::network(e.to_string()))?;
    let public: Vec<SocketAddr> = found.filter(|addr| is_public(addr.ip())).collect();
    if public.is_empty() {
        return Err(AppError::blocked(format!("{host} resolves only to private or local addresses")));
    }
    Ok(public)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_private_and_local() {
        for ip in ["127.0.0.1", "10.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"] {
            assert!(!is_public(ip.parse().unwrap()), "{ip} should be blocked");
        }
        for ip in ["8.8.8.8", "142.250.72.14", "2606:4700:4700::1111"] {
            assert!(is_public(ip.parse().unwrap()), "{ip} should be allowed");
        }
    }

    #[test]
    fn checks_urls() {
        assert!(check_url(&Url::parse("https://music.youtube.com/").unwrap(), false).is_ok());
        assert!(check_url(&Url::parse("http://music.youtube.com/").unwrap(), false).is_err());
        assert!(check_url(&Url::parse("https://localhost/").unwrap(), false).is_err());
        assert!(check_url(&Url::parse("https://127.0.0.1/").unwrap(), false).is_err());
        assert!(check_url(&Url::parse("https://[::1]/").unwrap(), false).is_err());
        assert!(check_url(&Url::parse("https://user:pw@example.com/").unwrap(), false).is_err());
        assert!(check_url(&Url::parse("wss://example.com/").unwrap(), true).is_ok());
        assert!(check_url(&Url::parse("wss://example.com/").unwrap(), false).is_err());
    }
}
