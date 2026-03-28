/*
 * OkHttp CertificatePinner + ProxySelector bypass
 *
 * Targets OkHttp-specific pinning and proxy evasion. Does NOT touch
 * platform-level TrustManagerImpl (pair with trustmanager_only.js or
 * use the universal script if you need both).
 *
 * Best for: Apps built on OkHttp/Retrofit that use CertificatePinner
 * and/or a custom ProxySelector to return NO_PROXY.
 * Covers: okhttp3, com.squareup.okhttp, com.android.okhttp, all
 * OkHostnameVerifier variants, and custom ProxySelector subclasses.
 *
 * Good for: Most commercial Android apps (OkHttp is ~70% market share).
 * Especially apps that ignore system proxy via custom ProxySelector.
 * NOT enough for: Apps with Conscrypt-level pinning, TrustKit, Netty,
 * Flutter, or apps not using OkHttp at all.
 */
console.log('[*] OkHttp pinner + proxy bypass — installing in 3s...');

setTimeout(function () {
    Java.perform(function () {
        var ArrayList = Java.use('java.util.ArrayList');

        // ── Load proxy config ────────────────────────────────────────────
        var PROXY_HOST = '127.0.0.1';
        var PROXY_PORT = 8080;
        try {
            var BufferedReader = Java.use('java.io.BufferedReader');
            var FileReader = Java.use('java.io.FileReader');
            var reader = BufferedReader.$new(FileReader.$new('/tmp/frida_proxy_config.json'));
            var line = reader.readLine();
            reader.close();
            if (line) {
                var str = line.toString();
                var hostMatch = str.match(/"host":"([^"]+)"/);
                var portMatch = str.match(/"port":(\d+)/);
                if (hostMatch) PROXY_HOST = hostMatch[1];
                if (portMatch) PROXY_PORT = parseInt(portMatch[1]);
            }
        } catch (e) {
            console.log('[!] No proxy config, using defaults');
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

        // ══════════════════════════════════════════════════════════════════
        //  PROXY ROUTING — Hook default and custom ProxySelectors
        // ══════════════════════════════════════════════════════════════════

        // Hook system default ProxySelector
        try {
            var ProxySelector = Java.use('java.net.ProxySelector');
            var defaultPS = ProxySelector.getDefault();
            if (defaultPS !== null) {
                var className = defaultPS.$className;
                var DefaultPSClass = Java.use(className);
                DefaultPSClass.select.implementation = function (uri) {
                    console.log('[+] PROXY → ' + uri);
                    return makeProxyList();
                };
                console.log('[+] System ProxySelector (' + className + ') hooked');
            }
        } catch (e) {
            console.log('[!] System ProxySelector: ' + e.message);
        }

        // Scan loaded classes for custom ProxySelector subclasses that return NO_PROXY
        try {
            var foundSelectors = [];
            Java.enumerateLoadedClasses({
                onMatch: function (className) {
                    try {
                        var cls = Java.use(className);
                        if (cls.select && cls.class.getSuperclass() &&
                            cls.class.getSuperclass().getName() === 'java.net.ProxySelector') {
                            foundSelectors.push(className);
                        }
                    } catch (e) {}
                },
                onComplete: function () {}
            });

            for (var i = 0; i < foundSelectors.length; i++) {
                try {
                    var cls = Java.use(foundSelectors[i]);
                    cls.select.implementation = function (uri) {
                        console.log('[+] CustomPS PROXY → ' + uri);
                        return makeProxyList();
                    };
                    console.log('[+] Custom ProxySelector hooked: ' + foundSelectors[i]);
                } catch (e) {}
            }
        } catch (e) {}

        // ══════════════════════════════════════════════════════════════════
        //  OKHTTP CERTIFICATE PINNING
        // ══════════════════════════════════════════════════════════════════

        // okhttp3.CertificatePinner.check(String, List)
        try {
            var CertificatePinner = Java.use('okhttp3.CertificatePinner');
            CertificatePinner.check.overload('java.lang.String', 'java.util.List')
                .implementation = function (hostname, peerCerts) {
                    console.log('[+] okhttp3 pin bypass: ' + hostname);
                };
            console.log('[+] okhttp3.CertificatePinner.check');
        } catch (e) {}

        // okhttp3.CertificatePinner.check$okhttp (Kotlin variant)
        try {
            var CertPinner3k = Java.use('okhttp3.CertificatePinner');
            CertPinner3k['check$okhttp'].implementation = function (hostname, peerCertsFn) {
                console.log('[+] okhttp3 pin bypass ($okhttp): ' + hostname);
            };
            console.log('[+] okhttp3.CertificatePinner.check$okhttp');
        } catch (e) {}

        // com.squareup.okhttp.CertificatePinner (OkHttp 2.x)
        try {
            var SquarePinner = Java.use('com.squareup.okhttp.CertificatePinner');
            SquarePinner.check.overload('java.lang.String', 'java.util.List')
                .implementation = function (hostname, peerCerts) {
                    console.log('[+] squareup pin bypass: ' + hostname);
                };
            console.log('[+] com.squareup.okhttp.CertificatePinner');
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

        // ══════════════════════════════════════════════════════════════════
        //  HOSTNAME VERIFIERS
        // ══════════════════════════════════════════════════════════════════

        var verifiers = [
            'okhttp3.internal.tls.OkHostnameVerifier',
            'com.android.okhttp.internal.tls.OkHostnameVerifier',
            'com.squareup.okhttp.internal.tls.OkHostnameVerifier',
        ];
        for (var i = 0; i < verifiers.length; i++) {
            try {
                var HV = Java.use(verifiers[i]);
                HV.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession')
                    .implementation = function () { return true; };
                console.log('[+] ' + verifiers[i]);
            } catch (e) {}
        }

        console.log('[*] OkHttp hooks installed');
    });
}, 3000);
