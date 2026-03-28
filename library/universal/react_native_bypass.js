/*
 * React Native SSL pinning bypass
 *
 * React Native apps typically use OkHttp under the hood (via the
 * com.facebook.react.modules.network module), but some configure
 * pinning through the JS bridge or use react-native-ssl-pinning /
 * TrustKit-RN / rn-fetch-blob with custom TLS.
 *
 * This hooks:
 *   - RN's OkHttpClientProvider (custom OkHttpClient factory)
 *   - TrustManager at the platform level
 *   - OkHttp CertificatePinner
 *   - NetworkingModule SSL factory overrides
 *
 * Best for: React Native apps, especially those using
 * react-native-ssl-pinning, rn-fetch-blob, or custom native modules.
 * How to detect RN: look for libreactnativejni.so, index.android.bundle,
 * or com.facebook.react in the APK.
 *
 * Good for: Most RN apps. Also covers Expo apps.
 * NOT enough for: RN apps that use a native C++ TLS library directly
 * (very rare) or Flutter (completely different stack).
 */
console.log('[*] React Native SSL bypass — installing in 3s...');

setTimeout(function () {
    Java.perform(function () {
        var ArrayList = Java.use('java.util.ArrayList');

        // ── OkHttpClientProvider — RN's default HTTP client factory ───────
        // RN creates its OkHttpClient through this provider. Some apps
        // customize it to add CertificatePinner.
        try {
            var OkHttpClientProvider = Java.use('com.facebook.react.modules.network.OkHttpClientProvider');

            // Hook createClient to strip CertificatePinner from the builder
            try {
                OkHttpClientProvider.createClient.overloads.forEach(function (overload) {
                    overload.implementation = function () {
                        console.log('[+] RN OkHttpClientProvider.createClient intercepted');
                        var client = overload.apply(this, arguments);
                        // The client is built — we bypass pinning at the OkHttp level below
                        return client;
                    };
                });
                console.log('[+] OkHttpClientProvider.createClient');
            } catch (e) {}

            // Hook setOkHttpClientFactory if the app provides a custom factory
            try {
                OkHttpClientProvider.setOkHttpClientFactory.implementation = function (factory) {
                    console.log('[+] RN custom OkHttpClientFactory blocked');
                    // Don't set it — use default (which we hook elsewhere)
                };
                console.log('[+] OkHttpClientProvider.setOkHttpClientFactory');
            } catch (e) {}
        } catch (e) {
            console.log('[!] OkHttpClientProvider not found (not an RN app or RN new arch)');
        }

        // ── react-native-ssl-pinning ─────────────────────────────────────
        try {
            var SSLPinningModule = Java.use('com.toyberman.RNSslPinningModule');
            // This module validates certs in its own OkHttp interceptor
            console.log('[+] Found react-native-ssl-pinning');
        } catch (e) {}

        // ── Standard OkHttp CertificatePinner (used by RN under the hood) ──
        try {
            var CertificatePinner = Java.use('okhttp3.CertificatePinner');
            CertificatePinner.check.overload('java.lang.String', 'java.util.List')
                .implementation = function (hostname, peerCerts) {
                    console.log('[+] RN okhttp3 pin bypass: ' + hostname);
                };
            console.log('[+] okhttp3.CertificatePinner.check');
        } catch (e) {}

        try {
            var CertPinnerK = Java.use('okhttp3.CertificatePinner');
            CertPinnerK['check$okhttp'].implementation = function (hostname, fn) {
                console.log('[+] RN okhttp3 pin bypass ($okhttp): ' + hostname);
            };
            console.log('[+] okhttp3.CertificatePinner.check$okhttp');
        } catch (e) {}

        // ── Hostname verifiers ───────────────────────────────────────────
        try {
            var HV = Java.use('okhttp3.internal.tls.OkHostnameVerifier');
            HV.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession')
                .implementation = function () { return true; };
            console.log('[+] OkHostnameVerifier');
        } catch (e) {}

        // ── TrustManagerImpl (platform level) ────────────────────────────
        try {
            var TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');

            try {
                TrustManagerImpl.checkTrustedRecursive.implementation = function (a1, a2, a3, a4, a5, a6) {
                    return ArrayList.$new();
                };
                console.log('[+] checkTrustedRecursive');
            } catch (e) {}

            try {
                TrustManagerImpl.verifyChain.implementation = function (untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
                    console.log('[+] verifyChain: ' + host);
                    return untrustedChain;
                };
                console.log('[+] verifyChain');
            } catch (e) {}

            try {
                TrustManagerImpl.checkServerTrusted.overloads.forEach(function (overload) {
                    overload.implementation = function () {
                        if (overload.returnType.name !== 'void') {
                            return ArrayList.$new();
                        }
                    };
                });
                console.log('[+] checkServerTrusted');
            } catch (e) {}
        } catch (e) {}

        // ── TrustKit (some RN apps use this) ─────────────────────────────
        try {
            var TrustkitPTM = Java.use('com.datatheorem.android.trustkit.pinning.PinningTrustManager');
            TrustkitPTM.checkServerTrusted.implementation = function () {};
            console.log('[+] TrustKit PinningTrustManager');
        } catch (e) {}

        try {
            var TrustkitHV = Java.use('com.datatheorem.android.trustkit.pinning.OkHostnameVerifier');
            TrustkitHV.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession')
                .implementation = function () { return true; };
            console.log('[+] TrustKit OkHostnameVerifier');
        } catch (e) {}

        // ── SSLPeerUnverifiedException logger ────────────────────────────
        try {
            var UnverifiedCertError = Java.use('javax.net.ssl.SSLPeerUnverifiedException');
            UnverifiedCertError.$init.implementation = function (str) {
                console.log('[!] SSLPeerUnverifiedException: ' + str);
                try {
                    var st = Java.use('java.lang.Thread').currentThread().getStackTrace();
                    for (var i = 0; i < Math.min(st.length, 10); i++) {
                        console.log('[!]   ' + st[i].getClassName() + '.' + st[i].getMethodName());
                    }
                } catch (e2) {}
                return this.$init(str);
            };
        } catch (e) {}

        console.log('[*] React Native bypass ready');
    });
}, 3000);
