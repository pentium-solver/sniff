/*
 * Universal Android SSL Unpinning + Proxy Redirect
 *
 * Hooks every known SSL pinning mechanism on Android.
 * Reads proxy config from /data/local/tmp/frida_proxy_config.json on-device.
 *
 * Techniques combined from:
 *   - Static analysis of obfuscated OkHttp apps
 *   - codeshare.frida.re/@sowdust/universal-android-ssl-pinning-bypass-2
 *   - codeshare.frida.re/@fdciabdul/frida-multiple-bypass
 *   - codeshare.frida.re/@masbog/frida-android-unpinning-ssl
 *   - httptoolkit/frida-interception-and-unpinning
 */

console.log('[*] Universal SSL Unpin — installing hooks in 3s...');

setTimeout(function () {
    Java.perform(function () {
        console.log('[*] Installing hooks...');

        var ArrayList = Java.use('java.util.ArrayList');

        // ── Load proxy config ───────────────────────────────────────────────
        var PROXY_HOST = '127.0.0.1';
        var PROXY_PORT = 8080;
        try {
            var BufferedReader = Java.use('java.io.BufferedReader');
            var FileReader = Java.use('java.io.FileReader');
            var configPaths = [
                '/data/local/tmp/frida_proxy_config.json',
                '/tmp/frida_proxy_config.json'
            ];
            var loadedPath = null;
            for (var p = 0; p < configPaths.length; p++) {
                try {
                    var reader = BufferedReader.$new(FileReader.$new(configPaths[p]));
                    var line = reader.readLine();
                    reader.close();
                    if (line) {
                        var str = line.toString();
                        var hostMatch = str.match(/"host":"([^"]+)"/);
                        var portMatch = str.match(/"port":(\d+)/);
                        if (hostMatch) PROXY_HOST = hostMatch[1];
                        if (portMatch) PROXY_PORT = parseInt(portMatch[1]);
                        loadedPath = configPaths[p];
                        break;
                    }
                } catch (inner) {}
            }
            if (loadedPath !== null) {
                console.log('[*] Loaded proxy config from ' + loadedPath);
            } else {
                console.log('[!] No proxy config found, using defaults: ' + PROXY_HOST + ':' + PROXY_PORT);
            }
        } catch (e) {
            console.log('[!] No proxy config found, using defaults: ' + PROXY_HOST + ':' + PROXY_PORT);
        }
        console.log('[*] Proxy target: ' + PROXY_HOST + ':' + PROXY_PORT);

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

        function makeDirectList() {
            var list = ArrayList.$new();
            list.add(ProxyCls.NO_PROXY.value);
            return list;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  PROXY ROUTING
        // ══════════════════════════════════════════════════════════════════════

        // Read PROXY_DOMAINS from environment or use empty list (proxy everything)
        // To selectively proxy, set PROXY_DOMAINS env var before running sniff.sh:
        //   export PROXY_DOMAINS="targetdomain.com,otherdomain.net"
        var PROXY_DOMAINS = [];
        try {
            var System = Java.use('java.lang.System');
            var domainsEnv = System.getenv('PROXY_DOMAINS');
            if (domainsEnv !== null && domainsEnv.toString().length > 0) {
                PROXY_DOMAINS = domainsEnv.toString().split(',');
                console.log('[*] Selective proxy for: ' + PROXY_DOMAINS.join(', '));
            } else {
                console.log('[*] Proxying ALL domains (set PROXY_DOMAINS to filter)');
            }
        } catch (e) {}

        var IGNORE_DOMAINS = [];
        try {
            var System = Java.use('java.lang.System');
            var ignoreEnv = System.getenv('MITM_IGNORE');
            if (ignoreEnv !== null) {
                // Extract domain keywords from regex patterns
                var parts = ignoreEnv.toString().split('|');
                for (var i = 0; i < parts.length; i++) {
                    var d = parts[i].replace(/\.\*/g, '').replace(/\\\./g, '.').replace(/^\./,'');
                    if (d.length > 0) IGNORE_DOMAINS.push(d);
                }
            }
        } catch (e) {}

        function shouldProxy(uri) {
            var host = uri.getHost();
            if (host === null) return false;
            var hostStr = host.toString();

            // Never proxy ignored domains (anti-bot, auth, etc.)
            for (var i = 0; i < IGNORE_DOMAINS.length; i++) {
                if (hostStr.indexOf(IGNORE_DOMAINS[i]) !== -1) return false;
            }

            // If no specific domains set, proxy everything
            if (PROXY_DOMAINS.length === 0) return true;

            // Otherwise only proxy matching domains
            for (var i = 0; i < PROXY_DOMAINS.length; i++) {
                if (hostStr.indexOf(PROXY_DOMAINS[i]) !== -1) return true;
            }
            return false;
        }

        // ── Hook system default ProxySelector ───────────────────────────────
        try {
            var ProxySelector = Java.use('java.net.ProxySelector');
            var defaultPS = ProxySelector.getDefault();
            if (defaultPS !== null) {
                var className = defaultPS.$className;
                var DefaultPSClass = Java.use(className);
                DefaultPSClass.select.implementation = function (uri) {
                    if (shouldProxy(uri)) {
                        console.log('[+] PROXY → ' + uri);
                        return makeProxyList();
                    }
                    return this.select(uri);
                };
                console.log('[+] System ProxySelector (' + className + ') hooked');
            }
        } catch (e) {
            console.log('[!] System ProxySelector: ' + e.message);
        }

        // ── Hook all custom ProxySelector subclasses ────────────────────────
        // Many apps use a custom ProxySelector that returns NO_PROXY.
        // Find and hook them all.
        try {
            Java.enumerateLoadedClasses({
                onMatch: function (className) {
                    if (className.indexOf('ProxySelector') !== -1 ||
                        className.match(/^[a-zA-Z]{1,4}$/) ) {
                        // Skip — too broad for short names, handled below
                    }
                },
                onComplete: function () {}
            });

            // Hook ProxySelector.select at the base level via all subclasses
            // that override select() and return NO_PROXY
            var ProxySelectorBase = Java.use('java.net.ProxySelector');
            // We can't hook abstract methods, but we can enumerate instances
        } catch (e) {}

        // ══════════════════════════════════════════════════════════════════════
        //  SSL PINNING BYPASS
        // ══════════════════════════════════════════════════════════════════════

        // ── TrustManagerImpl (Android 7+) — the critical hooks ──────────────
        try {
            var TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');

            try {
                TrustManagerImpl.checkTrustedRecursive.implementation = function (a1, a2, a3, a4, a5, a6) {
                    console.log('[+] checkTrustedRecursive bypassed');
                    return ArrayList.$new();
                };
                console.log('[+] TrustManagerImpl.checkTrustedRecursive');
            } catch (e) {}

            try {
                TrustManagerImpl.verifyChain.implementation = function (untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
                    console.log('[+] verifyChain bypassed: ' + host);
                    return untrustedChain;
                };
                console.log('[+] TrustManagerImpl.verifyChain');
            } catch (e) {}

            try {
                TrustManagerImpl.checkServerTrusted.overloads.forEach(function (overload) {
                    overload.implementation = function () {
                        if (overload.returnType.name !== 'void') {
                            return ArrayList.$new();
                        }
                    };
                });
                console.log('[+] TrustManagerImpl.checkServerTrusted');
            } catch (e) {}
        } catch (e) {
            console.log('[!] TrustManagerImpl not found');
        }

        // ── Conscrypt OpenSSL socket-level verification ─────────────────────
        try {
            var OpenSSLSocketImpl = Java.use('com.android.org.conscrypt.OpenSSLSocketImpl');
            OpenSSLSocketImpl.verifyCertificateChain.implementation = function (certRefs, javaObject, authMethod) {
                console.log('[+] OpenSSLSocketImpl.verifyCertificateChain bypassed');
            };
            console.log('[+] OpenSSLSocketImpl.verifyCertificateChain');
        } catch (e) {}

        try {
            var OpenSSLEngineSocketImpl = Java.use('com.android.org.conscrypt.OpenSSLEngineSocketImpl');
            OpenSSLEngineSocketImpl.verifyCertificateChain.overload('[Ljava.lang.Long;', 'java.lang.String')
                .implementation = function (a, b) {
                    console.log('[+] OpenSSLEngineSocketImpl bypassed: ' + b);
                };
            console.log('[+] OpenSSLEngineSocketImpl.verifyCertificateChain');
        } catch (e) {}

        // ── Conscrypt CertPinManager ────────────────────────────────────────
        try {
            var CertPinManager = Java.use('com.android.org.conscrypt.CertPinManager');
            CertPinManager.isChainValid.overload('java.lang.String', 'java.util.List')
                .implementation = function (a, b) {
                    console.log('[+] CertPinManager.isChainValid bypassed: ' + a);
                    return true;
                };
            console.log('[+] Conscrypt CertPinManager');
        } catch (e) {}

        // ── OkHttp3 CertificatePinner ───────────────────────────────────────
        try {
            var CertificatePinner = Java.use('okhttp3.CertificatePinner');
            CertificatePinner.check.overload('java.lang.String', 'java.util.List')
                .implementation = function (a, b) {
                    console.log('[+] okhttp3.CertificatePinner.check bypassed: ' + a);
                };
            console.log('[+] okhttp3.CertificatePinner');
        } catch (e) {}

        try {
            var CertificatePinner3 = Java.use('okhttp3.CertificatePinner');
            CertificatePinner3['check$okhttp'].implementation = function (a, b) {
                console.log('[+] okhttp3.CertificatePinner.check$okhttp bypassed: ' + a);
            };
            console.log('[+] okhttp3.CertificatePinner.check$okhttp');
        } catch (e) {}

        // ── Square OkHttp (older) ───────────────────────────────────────────
        try {
            var SquarePinner = Java.use('com.squareup.okhttp.CertificatePinner');
            SquarePinner.check.overload('java.lang.String', 'java.util.List')
                .implementation = function (a, b) {
                    console.log('[+] squareup.CertificatePinner bypassed: ' + a);
                };
            console.log('[+] com.squareup.okhttp.CertificatePinner');
        } catch (e) {}

        // ── Android platform OkHttp ─────────────────────────────────────────
        try {
            var PlatformPinner = Java.use('com.android.okhttp.CertificatePinner');
            PlatformPinner.check.overloads.forEach(function (o) {
                o.implementation = function () {
                    console.log('[+] android.okhttp.CertificatePinner bypassed: ' + arguments[0]);
                };
            });
            console.log('[+] com.android.okhttp.CertificatePinner');
        } catch (e) {}

        // ── Hostname verifiers ──────────────────────────────────────────────
        try {
            var HV = Java.use('com.android.okhttp.internal.tls.OkHostnameVerifier');
            HV.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession')
                .implementation = function () { return true; };
            console.log('[+] OkHostnameVerifier');
        } catch (e) {}

        try {
            var HV3 = Java.use('okhttp3.internal.tls.OkHostnameVerifier');
            HV3.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession')
                .implementation = function () { return true; };
            console.log('[+] okhttp3.OkHostnameVerifier');
        } catch (e) {}

        try {
            var SquareHV = Java.use('com.squareup.okhttp.internal.tls.OkHostnameVerifier');
            SquareHV.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession')
                .implementation = function () { return true; };
            console.log('[+] squareup.OkHostnameVerifier');
        } catch (e) {}

        // ── HttpsURLConnection ──────────────────────────────────────────────
        try {
            var HttpsURLConnection = Java.use('javax.net.ssl.HttpsURLConnection');
            HttpsURLConnection.setDefaultHostnameVerifier.implementation = function (v) {
                console.log('[+] HttpsURLConnection.setDefaultHostnameVerifier bypassed');
            };
            HttpsURLConnection.setSSLSocketFactory.implementation = function (f) {
                console.log('[+] HttpsURLConnection.setSSLSocketFactory bypassed');
            };
            HttpsURLConnection.setHostnameVerifier.implementation = function (v) {
                console.log('[+] HttpsURLConnection.setHostnameVerifier bypassed');
            };
            console.log('[+] HttpsURLConnection verifier/factory hooks');
        } catch (e) {}

        // ── WebViewClient SSL error handler ─────────────────────────────────
        try {
            var WebViewClient = Java.use('android.webkit.WebViewClient');
            WebViewClient.onReceivedSslError.overload(
                'android.webkit.WebView', 'android.webkit.SslErrorHandler', 'android.net.http.SslError'
            ).implementation = function (view, handler, error) {
                console.log('[+] WebView SSL error bypassed — proceeding');
                handler.proceed();
            };
            console.log('[+] WebViewClient.onReceivedSslError');
        } catch (e) {}

        // ── SSLPeerUnverifiedException auto-patcher ─────────────────────────
        // Catches any SSL exception and logs the throwing class/method.
        // Useful for discovering app-specific pinning classes.
        try {
            var UnverifiedCertError = Java.use('javax.net.ssl.SSLPeerUnverifiedException');
            UnverifiedCertError.$init.implementation = function (str) {
                console.log('[!] SSLPeerUnverifiedException: ' + str);
                try {
                    var stackTrace = Java.use('java.lang.Thread').currentThread().getStackTrace();
                    for (var i = 0; i < stackTrace.length; i++) {
                        if (stackTrace[i].getClassName() === 'javax.net.ssl.SSLPeerUnverifiedException') {
                            if (i + 1 < stackTrace.length) {
                                var caller = stackTrace[i + 1];
                                console.log('[!]   Thrown by: ' + caller.getClassName() + '.' + caller.getMethodName());
                                console.log('[!]   → Hook this class to bypass app-specific pinning');
                            }
                            break;
                        }
                    }
                } catch (e2) {}
                return this.$init(str);
            };
            console.log('[+] SSLPeerUnverifiedException auto-patcher');
        } catch (e) {}

        // ── TrustKit ────────────────────────────────────────────────────────
        try {
            var TrustkitHV = Java.use('com.datatheorem.android.trustkit.pinning.OkHostnameVerifier');
            TrustkitHV.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession')
                .implementation = function (a, b) { return true; };
            console.log('[+] TrustKit OkHostnameVerifier');
        } catch (e) {}

        try {
            var TrustkitPTM = Java.use('com.datatheorem.android.trustkit.pinning.PinningTrustManager');
            TrustkitPTM.checkServerTrusted.implementation = function () {};
            console.log('[+] TrustKit PinningTrustManager');
        } catch (e) {}

        // ── Appmattus Certificate Transparency ──────────────────────────────
        try {
            var CTInterceptor = Java.use('com.appmattus.certificatetransparency.internal.verifier.CertificateTransparencyInterceptor');
            CTInterceptor.intercept.implementation = function (chain) {
                return chain.proceed(chain.request());
            };
            console.log('[+] Appmattus CertificateTransparencyInterceptor');
        } catch (e) {}

        // ── Chromium Cronet public key pinning ─────────────────────────────
        function hookCronetBuilder(className) {
            try {
                var CronetBuilder = Java.use(className);
                try {
                    CronetBuilder.enablePublicKeyPinningBypassForLocalTrustAnchors
                        .overload('boolean')
                        .implementation = function (_enabled) {
                            console.log('[+] Cronet local trust anchor bypass forced: ' + className);
                            return this.enablePublicKeyPinningBypassForLocalTrustAnchors(true);
                        };
                    console.log('[+] ' + className + '.enablePublicKeyPinningBypassForLocalTrustAnchors');
                } catch (inner) {}

                try {
                    CronetBuilder.addPublicKeyPins
                        .overload('java.lang.String', 'java.util.Set', 'boolean', 'java.util.Date')
                        .implementation = function (hostName, pinsSha256, includeSubdomains, expirationDate) {
                            console.log('[+] Cronet addPublicKeyPins bypassed: ' + hostName + ' (' + className + ')');
                            return this;
                        };
                    console.log('[+] ' + className + '.addPublicKeyPins');
                } catch (inner) {}
            } catch (e) {}
        }

        hookCronetBuilder('org.chromium.net.CronetEngine$Builder');
        hookCronetBuilder('org.chromium.net.impl.CronetEngineBuilderImpl');

        // ── Netty ───────────────────────────────────────────────────────────
        try {
            var NettyFP = Java.use('io.netty.handler.ssl.util.FingerprintTrustManagerFactory');
            NettyFP.checkTrusted.implementation = function (type, chain) {};
            console.log('[+] Netty FingerprintTrustManagerFactory');
        } catch (e) {}

        // ══════════════════════════════════════════════════════════════════════
        //  CRASH PREVENTION
        // ══════════════════════════════════════════════════════════════════════

        // ── Splunk RUM exporter (common crash source) ───────────────────────
        function makeSplunkSuccess() {
            try {
                var aVClass = Java.use('aV');
                var r = aVClass.$new();
                r.e();
                return r;
            } catch (e) {
                return null;
            }
        }

        try {
            var AndroidSpanExporter = Java.use('com.splunk.rum.common.otel.span.AndroidSpanExporter');
            AndroidSpanExporter.export.implementation = function (spans) { return makeSplunkSuccess(); };
            AndroidSpanExporter.flush.implementation = function () { return makeSplunkSuccess(); };
            console.log('[+] Splunk RUM exporter neutralized');
        } catch (e) {}

        try {
            var SpanInterceptor = Java.use('com.splunk.rum.common.otel.span.SpanInterceptorExporter');
            SpanInterceptor.export.implementation = function (spans) { return makeSplunkSuccess(); };
            console.log('[+] Splunk SpanInterceptorExporter neutralized');
        } catch (e) {}

        console.log('[*] All hooks installed — use the app now');
    });
}, 3000);
