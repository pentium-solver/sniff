/*
 * Lightweight TrustManager-only bypass
 *
 * Minimal hooks — just the Android platform TLS validation.
 * Best for: Apps that ONLY use default Android TLS (no OkHttp pinning,
 * no custom ProxySelector). Lowest crash risk since it touches very few classes.
 * Works on: Android 7+ (Conscrypt TrustManagerImpl)
 *
 * Good for: WebView-heavy apps, apps using HttpsURLConnection directly,
 * basic Retrofit/Volley setups without custom CertificatePinner.
 * NOT enough for: OkHttp CertificatePinner, custom ProxySelector (NO_PROXY),
 * TrustKit, Flutter, or any app with cert pinning beyond the platform default.
 */
console.log('[*] TrustManager-only bypass — installing in 3s...');

setTimeout(function () {
    Java.perform(function () {
        var ArrayList = Java.use('java.util.ArrayList');

        // ── TrustManagerImpl (Android 7+ Conscrypt) ──────────────────────
        try {
            var TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');

            try {
                TrustManagerImpl.checkTrustedRecursive.implementation = function (a1, a2, a3, a4, a5, a6) {
                    console.log('[+] checkTrustedRecursive bypassed');
                    return ArrayList.$new();
                };
                console.log('[+] checkTrustedRecursive hooked');
            } catch (e) {}

            try {
                TrustManagerImpl.verifyChain.implementation = function (untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
                    console.log('[+] verifyChain bypassed: ' + host);
                    return untrustedChain;
                };
                console.log('[+] verifyChain hooked');
            } catch (e) {}

            try {
                TrustManagerImpl.checkServerTrusted.overloads.forEach(function (overload) {
                    overload.implementation = function () {
                        if (overload.returnType.name !== 'void') {
                            return ArrayList.$new();
                        }
                    };
                });
                console.log('[+] checkServerTrusted hooked');
            } catch (e) {}
        } catch (e) {
            console.log('[!] TrustManagerImpl not found: ' + e);
        }

        // ── SSLPeerUnverifiedException logger ────────────────────────────
        // If this fires, the app has ADDITIONAL pinning beyond TrustManager.
        // Check the log to see which class is throwing.
        try {
            var UnverifiedCertError = Java.use('javax.net.ssl.SSLPeerUnverifiedException');
            UnverifiedCertError.$init.implementation = function (str) {
                console.log('[!] SSLPeerUnverifiedException: ' + str);
                try {
                    var stackTrace = Java.use('java.lang.Thread').currentThread().getStackTrace();
                    for (var i = 0; i < stackTrace.length; i++) {
                        var cls = stackTrace[i].getClassName();
                        var method = stackTrace[i].getMethodName();
                        if (cls.indexOf('ssl') !== -1 || cls.indexOf('SSL') !== -1 ||
                            cls.indexOf('Certificate') !== -1 || cls.indexOf('Pin') !== -1 ||
                            cls.indexOf('Trust') !== -1) {
                            console.log('[!]   ' + cls + '.' + method);
                        }
                    }
                } catch (e2) {}
                return this.$init(str);
            };
            console.log('[+] SSL exception logger active');
        } catch (e) {}

        console.log('[*] TrustManager bypass ready');
    });
}, 3000);
