// META: name=sniff_unpin_com_marriott_mrt label=AUTO-UNPIN desc=Auto-generated_SSL_unpinning_script
// ════════════════════════════════════════════════════════════════════
// sniff! Auto-Generated SSL Unpinning Script
// Package : com.marriott.mrt
// Detected : OkHttp3 CertificatePinner, Custom X509TrustManager, NetworkSecurityConfig Pins, WebViewClient SSL Override, Conscrypt SSL Provider, HttpsURLConnection, Custom HostnameVerifier
// ────────────────────────────────────────────────────────────────────
// Each block is wrapped in try/catch. A missing class prints a notice
// and never prevents other hooks from loading.
// ════════════════════════════════════════════════════════════════════

'use strict';

Java.perform(function () {
    var T = '[sniff/mrt]';
    var n = 0;
    function ok(s)      { n++; console.log(T + ' ✓ ' + s); }
    function skip(s, e) { console.log(T + ' ○ ' + s + ' — ' + ((e && e.message) || e)); }

    // ─── OkHttp3 CertificatePinner ───────────────────────────────────
    try {
        var CP3 = Java.use('okhttp3.CertificatePinner');
        CP3.check.overload('java.lang.String', 'java.util.List').implementation = function (host) {
            console.log(T + ' OkHttp3 pin → ' + host);
        };
        try { CP3.check.overload('java.lang.String', '[Ljava.security.cert.Certificate;').implementation = function (host) {}; } catch (_) {}
        ok('OkHttp3.CertificatePinner');
    } catch (e) { skip('OkHttp3.CertificatePinner', e); }

    // ─── OkHttpClient$Builder.sslSocketFactory (custom TM installer) ─────
    try {
        var OkBuilder = Java.use('okhttp3.OkHttpClient$Builder');
        OkBuilder.sslSocketFactory.overload(
            'javax.net.ssl.SSLSocketFactory', 'javax.net.ssl.X509TrustManager'
        ).implementation = function (sf, tm) {
            console.log(T + ' OkHttpClient custom TM intercepted — using platform default');
            return this; // drop custom factory; OkHttp falls back to SSLContext.getDefault() → TrustAll
        };
        ok('OkHttpClient$Builder.sslSocketFactory');
    } catch (e) { skip('OkHttpClient$Builder.sslSocketFactory', e); }

    // ─── Android NetworkSecurityConfig pins ──────────────────────────
    try {
        var NSTM = Java.use('android.security.net.config.NetworkSecurityTrustManager');
        NSTM.checkPins.implementation = function (chain) { console.log(T + ' NSConfig pin bypassed'); };
        ok('NetworkSecurityTrustManager.checkPins');
    } catch (e) { skip('NetworkSecurityTrustManager', e); }

    // ─── WebViewClient.onReceivedSslError ─────────────────────────────
    try {
        var WVC = Java.use('android.webkit.WebViewClient');
        WVC.onReceivedSslError.implementation = function (view, handler, error) { handler.proceed(); };
        ok('WebViewClient.onReceivedSslError');
    } catch (e) { skip('WebViewClient.onReceivedSslError', e); }

    // ─── Conscrypt TrustManagerImpl ───────────────────────────────────
    // Hook the internal TrustManagerImpl used by Conscrypt's SSL engine.
    // Platform.checkServerTrusted has multiple overloads that vary by API level;
    // TrustManagerImpl.checkTrusted is the stable choke point across all versions.
    try {
        var ConTM = Java.use('com.android.org.conscrypt.TrustManagerImpl');
        ConTM.checkTrusted.implementation = function () { return null; };
        ok('Conscrypt.TrustManagerImpl.checkTrusted');
    } catch (e) {
        try {
            // Fallback: Platform shim (varies by Android version)
            var ConP = Java.use('com.android.org.conscrypt.Platform');
            ConP.checkServerTrusted.overload(
                'javax.net.ssl.X509TrustManager', '[Ljava.security.cert.X509Certificate;', 'java.lang.String'
            ).implementation = function () {};
            ok('Conscrypt.Platform.checkServerTrusted');
        } catch (e2) { skip('Conscrypt', e2); }
    }

    // ─── Nuclear fallback: global TrustAll + HostnameVerifier ───────────
    try {
        var X509    = Java.use('javax.net.ssl.X509TrustManager');
        var SSLCtx  = Java.use('javax.net.ssl.SSLContext');
        var HVIface = Java.use('javax.net.ssl.HostnameVerifier');

        var TrustAll = Java.registerClass({ name: 'sniff.comxmarriottxmrtTrustAll', implements: [X509], methods: {
            checkClientTrusted: function (chain, authType) {},
            checkServerTrusted: function (chain, authType) {},
            getAcceptedIssuers:  function () { return Java.array('Ljava.security.cert.X509Certificate;', []); },
        }});
        var AllowAll = Java.registerClass({ name: 'sniff.comxmarriottxmrtAllowAll', implements: [HVIface], methods: {
            verify: function (hostname, session) { return true; },
        }});

        var sc = SSLCtx.getInstance('TLS');
        sc.init(null, [TrustAll.$new()], null);
        SSLCtx.setDefault(sc);
        Java.use('javax.net.ssl.HttpsURLConnection').setDefaultHostnameVerifier(AllowAll.$new());
        ok('SSLContext(TrustAll) + HostnameVerifier(AllowAll)');
    } catch (e) { skip('nuclear SSLContext', e); }

    console.log(T + ' ══ ' + n + ' hooks active ══');
});
