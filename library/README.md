# sniff! Frida Script Library

Drop-in Frida scripts for SSL pinning bypass and traffic interception. Download only what you need.

## Universal Scripts

General-purpose scripts that work across most apps.

| Script | Description |
|--------|-------------|
| `frida_universal_unpin.js` | Comprehensive SSL bypass — hooks TrustManager, OkHttp, TrustKit, Appmattus, Netty, WebView. Start here. |
| `trustmanager_only.js` | Lightweight TrustManager-only bypass. Use when universal is too heavy. |
| `okhttp_pinner.js` | OkHttp CertificatePinner bypass. For apps using OkHttp pinning. |
| `webview_bypass.js` | WebView SSL bypass for hybrid apps (Cordova, Capacitor, etc). |
| `react_native_bypass.js` | React Native SSL bypass — hooks OkHttp + RN networking layer. |
| `flutter_bypass.js` | Flutter/BoringSSL bypass — patches `ssl_verify_peer_cert_chain` in libflutter.so. |
| `proxy_only.js` | Diagnostic — only sets proxy, no SSL bypass. Use to test proxy connectivity. |

## App-Specific Scripts

Targeted bypass scripts for apps with custom protections. These handle app-specific obfuscation, SDK neutralization, and non-standard pinning.

| Script | Target App | Notes |
|--------|-----------|-------|
| `pilot_fj.js` | Pilot Flying J (`com.pilottravelcenters.mypilot`) | Custom ProxySelector + cert pin bypass |
| `pilot_fj_signup_handoff.js` | Pilot Flying J | Signup flow interception with proxy handoff |
| `pilot_fj_auth_trace.js` | Pilot Flying J | Auth flow tracing |
| `dailypay_bypass.js` | DailyPay (`com.dailypay`) | APEX cert injection + WebView hooks |
| `speedway_bypass.js` | Speedway (`com.speedway.mobile`) | OkHttp + Distil/Imperva neutralization |
| `papajohns_bypass.js` | Papa Johns (`com.papajohns.android`) | Flutter BoringSSL + Akamai BMP neutralization |
| `linkedin_cronet_patch.js` | LinkedIn (`com.linkedin.android`) | Cronet/QUIC disable + network engine patch |
| `linkedin_challenge_trace.js` | LinkedIn | Challenge flow interception |
| `linkedin_proxy_trace.js` | LinkedIn | Proxy routing trace |
| `linkedin_ssl_trace.js` | LinkedIn | SSL handshake trace |

## Usage

Copy a script to your device and attach with Frida:

```bash
# Using sniff! (automatic)
sniff

# Manual usage
frida -U -f com.example.app -l library/universal/frida_universal_unpin.js
```

Or place scripts in `frida_scripts/custom/` for sniff! to detect them automatically.
