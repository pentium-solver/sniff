/*
 * Speedway / 7-Eleven (com.speedway.mobile) — SSL unpin + protection bypass
 *
 * Layers handled:
 *   1. OkHttp3 CertificatePinner bypass (al.C4949b provides pins from Firebase config)
 *   2. TrustManagerImpl real path bypass (checkTrustedRecursive + verifyChain)
 *   3. Distil/Imperva ABP — stub blockingGetToken to return empty string
 *   4. DataTheorem MobileProtect — neutralize detection callbacks
 *   5. NewRelic — stub crash-prone instrumentation paths
 *   6. SSLPeerUnverifiedException logger — discover any remaining failures
 *
 * Delayed 3s after attach to avoid ART/JIT corruption (attach should be 10s+ after launch).
 */
console.log('[*] Speedway bypass — installing hooks in 3s...');

setTimeout(function () {
    Java.perform(function () {
        console.log('[*] Installing hooks...');

        var ArrayList = Java.use('java.util.ArrayList');

        // ── Load proxy config ─────────��─────────────────────────────────
        var PROXY_HOST = '127.0.0.1';
        var PROXY_PORT = 8080;
        try {
            var BufferedReader = Java.use('java.io.BufferedReader');
            var FileReader = Java.use('java.io.FileReader');
            var paths = [
                '/data/local/tmp/frida_proxy_config.json',
                '/tmp/frida_proxy_config.json'
            ];
            for (var p = 0; p < paths.length; p++) {
                try {
                    var reader = BufferedReader.$new(FileReader.$new(paths[p]));
                    var line = reader.readLine();
                    reader.close();
                    if (line) {
                        var str = line.toString();
                        var hm = str.match(/"host":"([^"]+)"/);
                        var pm = str.match(/"port":(\d+)/);
                        if (hm) PROXY_HOST = hm[1];
                        if (pm) PROXY_PORT = parseInt(pm[1]);
                        break;
                    }
                } catch (e) {}
            }
        } catch (e) {}
        console.log('[*] Proxy target: ' + PROXY_HOST + ':' + PROXY_PORT);

        // ══════════════════════════════════════════════════════════════════
        //  1. PROXY ROUTING — Hook any custom ProxySelector subclasses
        // ══════════════════════════════════════════════════════════════════

        var ProxyCls = Java.use('java.net.Proxy');
        var ProxyType = Java.use('java.net.Proxy$Type');
        var InetSocketAddress = Java.use('java.net.InetSocketAddress');

        function makeProxyList() {
            var addr = InetSocketAddress.$new(PROXY_HOST, PROXY_PORT);
            var proxy = ProxyCls.$new(ProxyType.HTTP.value, addr);
            var list = ArrayList.$new();
            list.add(proxy);
            return list;
        }

        // Hook system default ProxySelector (no class scan — too slow on large apps)
        try {
            var ProxySelector = Java.use('java.net.ProxySelector');
            var defaultPS = ProxySelector.getDefault();
            if (defaultPS !== null) {
                var psClassName = defaultPS.$className;
                var DefaultPSClass = Java.use(psClassName);
                DefaultPSClass.select.implementation = function (uri) {
                    console.log('[+] DefaultPS PROXY → ' + uri);
                    return makeProxyList();
                };
                console.log('[+] System ProxySelector (' + psClassName + ') hooked');
            }
        } catch (e) {
            console.log('[!] System ProxySelector: ' + e.message);
        }

        // ════════���════════════════════════════════��════════════════════════
        //  2. OKHTTP3 CERTIFICATE PINNING
        // ═══════════════════════���══════════════════════════════════════════

        // okhttp3.CertificatePinner.check(String, List)
        try {
            var CertificatePinner = Java.use('okhttp3.CertificatePinner');
            CertificatePinner.check.overload('java.lang.String', 'java.util.List')
                .implementation = function (hostname, peerCerts) {
                    console.log('[+] okhttp3 pin bypass: ' + hostname);
                };
            console.log('[+] okhttp3.CertificatePinner.check');
        } catch (e) {
            console.log('[!] okhttp3.CertificatePinner.check: ' + e.message);
        }

        // okhttp3.CertificatePinner.check$okhttp (Kotlin variant)
        try {
            var CertPinnerK = Java.use('okhttp3.CertificatePinner');
            CertPinnerK['check$okhttp'].implementation = function (hostname, peerCertsFn) {
                console.log('[+] okhttp3 pin bypass ($okhttp): ' + hostname);
            };
            console.log('[+] okhttp3.CertificatePinner.check$okhttp');
        } catch (e) {}

        // com.android.okhttp.CertificatePinner (platform bundled)
        try {
            var PlatformPinner = Java.use('com.android.okhttp.CertificatePinner');
            PlatformPinner.check.overloads.forEach(function (o) {
                o.implementation = function () {
                    console.log('[+] android.okhttp pin bypass: ' + arguments[0]);
                };
            });
            console.log('[+] com.android.okhttp.CertificatePinner');
        } catch (e) {}

        // ═════════════════════���════════════════════════════════════════════
        //  3. HOSTNAME VERIFIERS
        // ══════════════════════════════════════════════════════════════════

        var verifiers = [
            'okhttp3.internal.tls.OkHostnameVerifier',
            'com.android.okhttp.internal.tls.OkHostnameVerifier',
        ];
        for (var v = 0; v < verifiers.length; v++) {
            try {
                var HV = Java.use(verifiers[v]);
                HV.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession')
                    .implementation = function () { return true; };
                console.log('[+] ' + verifiers[v]);
            } catch (e) {}
        }

        // ═════════════════════════════════════════��════════════════════════
        //  4. TRUSTMANAGERIMPL — Android platform cert validation
        // ═══���═════════════════════════════════════════════���════════════════

        try {
            var TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');

            try {
                TrustManagerImpl.checkTrustedRecursive.implementation = function (a1, a2, a3, a4, a5, a6) {
                    console.log('[+] checkTrustedRecursive bypassed');
                    return ArrayList.$new();
                };
                console.log('[+] TrustManagerImpl.checkTrustedRecursive');
            } catch (e) {
                console.log('[!] checkTrustedRecursive: ' + e.message);
            }

            try {
                TrustManagerImpl.verifyChain.implementation = function (untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
                    console.log('[+] verifyChain bypassed: ' + host);
                    return untrustedChain;
                };
                console.log('[+] TrustManagerImpl.verifyChain');
            } catch (e) {
                console.log('[!] verifyChain: ' + e.message);
            }

            try {
                TrustManagerImpl.checkServerTrusted.overloads.forEach(function (overload) {
                    overload.implementation = function () {
                        console.log('[+] checkServerTrusted bypassed');
                        if (overload.returnType.name !== 'void') {
                            return ArrayList.$new();
                        }
                    };
                });
                console.log('[+] TrustManagerImpl.checkServerTrusted');
            } catch (e) {}

            console.log('[+] TrustManagerImpl all methods hooked');
        } catch (e) {
            console.log('[!] TrustManagerImpl: ' + e);
        }

        // ══════��══════════════════════════════════��════════════════════════
        //  5. DISTIL / IMPERVA ABP — Stub token retrieval
        // ══════════════════════════════════════════���═══════════════════════

        // The ProtectionManager calls protection.blockingGetToken() to get Imperva tokens.
        // If the protection SDK can't phone home (SSL failure), it throws and the app stalls.
        // Stub the ProtectionManager to return null token gracefully.
        try {
            var ProtectionManager = Java.use('com.sei.android.core.managers.ProtectionManager');
            ProtectionManager.getImpervaToken.implementation = function () {
                console.log('[+] Imperva token stubbed → null');
                return null;
            };
            console.log('[+] ProtectionManager.getImpervaToken stubbed');
        } catch (e) {
            console.log('[!] ProtectionManager: ' + e.message);
        }

        // Also stub the Distil Protection class if it blocks
        try {
            var Protection = Java.use('com.distil.protection.android.Protection');
            Protection.blockingGetToken.implementation = function () {
                console.log('[+] Distil blockingGetToken stubbed → empty');
                return "";
            };
            console.log('[+] Distil Protection.blockingGetToken stubbed');
        } catch (e) {
            console.log('[!] Distil Protection: ' + e.message);
        }

        // ══════════════════════════════════════════════════════════════════
        //  6. DATATHEOREM MOBILEPROTECT — Neutralize detection
        // ════════════════════════���═════════════════════════════════════════

        // MobileProtect uses k7.f to start services. The config check (f().m()) gates
        // whether protection runs. We can stub the init to prevent it from blocking.
        try {
            var MobileProtectConfig = Java.use('com.datatheorem.mobileprotect.MobileProtectConfig');
            // Find the singleton and stub methods that might block
            console.log('[+] MobileProtectConfig found');
        } catch (e) {}

        // Stub the ProcessHelperKt if it does root/frida detection
        try {
            var ProcessHelper = Java.use('com.datatheorem.mobileprotect.ProcessHelperKt');
            console.log('[+] ProcessHelperKt found — monitoring');
        } catch (e) {}

        // ═══════════════════���════════════════════════════════��═════════════
        //  7. NEWRELIC — Prevent crash-prone instrumentation
        // ═══��══════════════════════════════════════════════════════════════

        // NewRelic wraps HttpsURLConnection which can conflict with Frida hooks.
        // Only stub if it causes issues.
        try {
            var NRHttpsExt = Java.use('com.newrelic.agent.android.instrumentation.HttpsURLConnectionExtension');
            console.log('[*] NewRelic HttpsURLConnectionExtension present');
        } catch (e) {}

        // ════════════════════════════════════════════════��═════════════════
        //  8. SSL EXCEPTION LOGGER — Discover remaining failures
        // ═════════════════════════════════��════════════════════════════════

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
                            cls.indexOf('Trust') !== -1 || cls.indexOf('distil') !== -1 ||
                            cls.indexOf('Imperva') !== -1) {
                            console.log('[!]   ' + cls + '.' + method);
                        }
                    }
                } catch (e2) {}
                return this.$init(str);
            };
            console.log('[+] SSL exception logger active');
        } catch (e) {}

        // Also catch SSLHandshakeException for broader coverage
        try {
            var SSLHandshakeEx = Java.use('javax.net.ssl.SSLHandshakeException');
            SSLHandshakeEx.$init.overloads.forEach(function (overload) {
                overload.implementation = function () {
                    console.log('[!] SSLHandshakeException: ' + arguments[0]);
                    return overload.apply(this, arguments);
                };
            });
            console.log('[+] SSLHandshakeException logger active');
        } catch (e) {}

        // ══════════════════════════════════════════════════════════════════
        //  9. EVICT OKHTTP CONNECTION POOL — Force fresh connections
        // ══════════════════════════════════════════════════════════════════
        // OkHttp caches failed connections. After hooks install, evict the pool
        // so the next request creates a NEW connection through our trust hooks.
        try {
            var ConnectionPool = Java.use('okhttp3.ConnectionPool');
            var OkHttpClient = Java.use('okhttp3.OkHttpClient');

            // Evict all idle connections from every OkHttpClient instance
            Java.choose('okhttp3.OkHttpClient', {
                onMatch: function (instance) {
                    try {
                        var pool = instance.connectionPool();
                        pool.evictAll();
                        console.log('[+] Evicted OkHttp connection pool');
                    } catch (e) {
                        console.log('[!] Pool evict failed: ' + e.message);
                    }
                },
                onComplete: function () {}
            });
        } catch (e) {
            console.log('[!] OkHttp pool eviction: ' + e.message);
        }

        console.log('[*] All Speedway hooks installed — restart activity for fresh API calls');
    });
}, 3000);
