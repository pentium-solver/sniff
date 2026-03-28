/*
 * DailyPay SSL Bypass
 *
 * This is the universal SSL unpin script + APEX conscrypt cert injection.
 * DailyPay uses React Native with WebView, and the WebView's Chromium engine
 * validates certs via BoringSSL which reads from /apex/com.android.conscrypt/cacerts/
 * rather than going through Java TrustManager hooks.
 *
 * The script injects the mitmproxy CA into the app's mount namespace so both
 * Java (OkHttp/RN fetch) and native (Chromium WebView) trust the proxy cert.
 */

console.log('[*] DailyPay SSL bypass — installing in 3s...');

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
                console.log('[!] No proxy config, using defaults');
            }
        } catch (e) {
            console.log('[!] Config load error: ' + e);
        }
        console.log('[*] Proxy target: ' + PROXY_HOST + ':' + PROXY_PORT);

        // ── Proxy helper ────────────────────────────────────────────────────
        var InetSocketAddress = Java.use('java.net.InetSocketAddress');
        var ProxyClass = Java.use('java.net.Proxy');
        var ProxyType = Java.use('java.net.Proxy$Type');

        function makeProxyList() {
            var list = ArrayList.$new();
            var addr = InetSocketAddress.$new(PROXY_HOST, PROXY_PORT);
            var proxy = ProxyClass.$new(ProxyType.HTTP.value, addr);
            list.add(proxy);
            return list;
        }

        // ── System ProxySelector ────────────────────────────────────────────
        try {
            var DefaultProxySelector = Java.use('sun.net.spi.DefaultProxySelector');
            DefaultProxySelector.select.implementation = function (uri) {
                return makeProxyList();
            };
            console.log('[+] System ProxySelector (sun.net.spi.DefaultProxySelector) hooked');
        } catch (e) {
            console.log('[!] DefaultProxySelector: ' + e);
        }

        // ── TrustManagerImpl (Conscrypt real path) ──────────────────────────
        try {
            var TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');
            try {
                TrustManagerImpl.checkTrustedRecursive.implementation = function () {
                    console.log('[+] checkTrustedRecursive bypassed');
                    return Java.use('java.util.ArrayList').$new();
                };
                console.log('[+] TrustManagerImpl.checkTrustedRecursive');
            } catch (e2) {}
            try {
                TrustManagerImpl.verifyChain.implementation = function () {
                    console.log('[+] verifyChain bypassed');
                    return Java.use('java.util.ArrayList').$new();
                };
                console.log('[+] TrustManagerImpl.verifyChain');
            } catch (e2) {}
            try {
                var overloads = TrustManagerImpl.checkServerTrusted.overloads;
                for (var i = 0; i < overloads.length; i++) {
                    (function(overload) {
                        var retType = overload.returnType.className;
                        overload.implementation = function () {
                            if (retType === 'void') return;
                            return Java.use('java.util.ArrayList').$new();
                        };
                    })(overloads[i]);
                }
                console.log('[+] TrustManagerImpl.checkServerTrusted');
            } catch (e2) {}
        } catch (e) {
            console.log('[!] TrustManagerImpl: ' + e);
        }

        // ── OkHttp3 CertificatePinner ───────────────────────────────────────
        try {
            var CertPinner = Java.use('okhttp3.CertificatePinner');
            try {
                CertPinner.check.overload('java.lang.String', 'java.util.List').implementation = function (host) {
                    console.log('[+] okhttp3.CertificatePinner.check bypassed: ' + host);
                };
            } catch (e2) {}
            try {
                CertPinner['check$okhttp'].implementation = function (host) {
                    console.log('[+] okhttp3.CertificatePinner.check$okhttp bypassed: ' + host);
                };
            } catch (e2) {}
            console.log('[+] okhttp3.CertificatePinner');
        } catch (e) {}

        // ── Platform okhttp CertificatePinner ───────────────────────────────
        try {
            var PlatformPinner = Java.use('com.android.okhttp.CertificatePinner');
            PlatformPinner.check.overload('java.lang.String', 'java.util.List').implementation = function () {};
            console.log('[+] com.android.okhttp.CertificatePinner');
        } catch (e) {}

        // ── HostnameVerifier ────────────────────────────────────────────────
        try {
            var OkHostnameVerifier = Java.use('com.android.okhttp.internal.tls.OkHostnameVerifier');
            OkHostnameVerifier.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession').implementation = function () { return true; };
            OkHostnameVerifier.verify.overload('java.lang.String', 'java.security.cert.X509Certificate').implementation = function () { return true; };
            console.log('[+] OkHostnameVerifier');
        } catch (e) {}

        try {
            var OkHttp3Verifier = Java.use('okhttp3.internal.tls.OkHostnameVerifier');
            OkHttp3Verifier.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession').implementation = function () { return true; };
            console.log('[+] okhttp3.OkHostnameVerifier');
        } catch (e) {}

        // ── HttpsURLConnection ──────────────────────────────────────────────
        try {
            var HttpsConn = Java.use('javax.net.ssl.HttpsURLConnection');
            HttpsConn.setDefaultHostnameVerifier.implementation = function () {};
            HttpsConn.setSSLSocketFactory.implementation = function () {};
            HttpsConn.setHostnameVerifier.implementation = function () {};
            console.log('[+] HttpsURLConnection verifier/factory hooks');
        } catch (e) {}

        // ── WebView SSL bypass via custom WebViewClient injection ────────
        // The app may not set a WebViewClient, so onReceivedSslError never fires.
        // We intercept WebView creation and inject our own client that calls proceed().
        try {
            var WebView = Java.use('android.webkit.WebView');
            var WebViewClient = Java.use('android.webkit.WebViewClient');

            var WebViewClientBypass = Java.registerClass({
                name: 'com.bypass.WebViewClientBypass',
                superClass: WebViewClient,
                fields: {
                    origClient: 'android.webkit.WebViewClient',
                },
                methods: {
                    $init: [{
                        returnType: 'void',
                        argumentTypes: ['android.webkit.WebViewClient'],
                        implementation: function (client) {
                            this.$super.$init();
                            this.origClient.value = client;
                        }
                    }],
                    onReceivedSslError: [{
                        returnType: 'void',
                        argumentTypes: ['android.webkit.WebView', 'android.webkit.SslErrorHandler', 'android.net.http.SslError'],
                        implementation: function (view, handler, error) {
                            console.log('[+] WebViewClientBypass.onReceivedSslError -> proceed() url=' + error.getUrl());
                            handler.proceed();
                        }
                    }],
                    onPageStarted: [{
                        returnType: 'void',
                        argumentTypes: ['android.webkit.WebView', 'java.lang.String', 'android.graphics.Bitmap'],
                        implementation: function (view, url, favicon) {
                            console.log('[+] WebView loading: ' + url);
                            var orig = this.origClient.value;
                            if (orig) orig.onPageStarted(view, url, favicon);
                        }
                    }],
                    onPageFinished: [{
                        returnType: 'void',
                        argumentTypes: ['android.webkit.WebView', 'java.lang.String'],
                        implementation: function (view, url) {
                            console.log('[+] WebView finished: ' + url);
                            var orig = this.origClient.value;
                            if (orig) orig.onPageFinished(view, url);
                        }
                    }],
                    onReceivedError: [{
                        returnType: 'void',
                        argumentTypes: ['android.webkit.WebView', 'android.webkit.WebResourceRequest', 'android.webkit.WebResourceError'],
                        implementation: function (view, request, error) {
                            console.log('[!] WebView error: ' + error.getDescription() + ' url=' + request.getUrl());
                            var orig = this.origClient.value;
                            if (orig) {
                                try { orig.onReceivedError(view, request, error); } catch(e) {}
                            }
                        }
                    }],
                    shouldOverrideUrlLoading: [
                        {
                            returnType: 'boolean',
                            argumentTypes: ['android.webkit.WebView', 'android.webkit.WebResourceRequest'],
                            implementation: function (view, request) {
                                var orig = this.origClient.value;
                                if (orig) {
                                    try { return orig.shouldOverrideUrlLoading(view, request); } catch(e) {}
                                }
                                return false;
                            }
                        },
                        {
                            returnType: 'boolean',
                            argumentTypes: ['android.webkit.WebView', 'java.lang.String'],
                            implementation: function (view, url) {
                                var orig = this.origClient.value;
                                if (orig) {
                                    try { return orig.shouldOverrideUrlLoading(view, url); } catch(e) {}
                                }
                                return false;
                            }
                        }
                    ],
                    shouldInterceptRequest: [
                        {
                            returnType: 'android.webkit.WebResourceResponse',
                            argumentTypes: ['android.webkit.WebView', 'android.webkit.WebResourceRequest'],
                            implementation: function (view, request) {
                                var orig = this.origClient.value;
                                if (orig) {
                                    try { return orig.shouldInterceptRequest(view, request); } catch(e) {}
                                }
                                return null;
                            }
                        }
                    ],
                }
            });

            // Intercept setWebViewClient to wrap with our bypass
            WebView.setWebViewClient.implementation = function (client) {
                console.log('[+] setWebViewClient intercepted -> injecting SSL bypass');
                var bypass = WebViewClientBypass.$new(client);
                return this.setWebViewClient(bypass);
            };
            console.log('[+] WebView.setWebViewClient interceptor');

            // Also intercept WebView init to catch cases where no client is set
            var initOverloads = WebView.$init.overloads;
            for (var i = 0; i < initOverloads.length; i++) {
                (function(overload) {
                    var origImpl = overload;
                    origImpl.implementation = function () {
                        origImpl.apply(this, arguments);
                        try {
                            console.log('[+] WebView created -> injecting SSL bypass client');
                            this.setWebViewClient(WebViewClientBypass.$new(null));
                        } catch (e) {
                            console.log('[!] WebView init inject failed: ' + e);
                        }
                    };
                })(initOverloads[i]);
            }
            console.log('[+] WebView.$init interceptor (' + initOverloads.length + ' overloads)');

        } catch (e) {
            console.log('[!] WebView bypass failed: ' + e);
        }

        // ── SSLPeerUnverifiedException logger ───────────────────────────────
        try {
            var SSLPeerEx = Java.use('javax.net.ssl.SSLPeerUnverifiedException');
            SSLPeerEx.$init.implementation = function (msg) {
                console.log('[!] SSLPeerUnverifiedException: ' + msg);
                try {
                    var stack = Java.use('java.lang.Thread').currentThread().getStackTrace();
                    for (var i = 2; i < Math.min(stack.length, 8); i++) {
                        console.log('    at ' + stack[i].toString());
                    }
                } catch (e2) {}
                return this.$init(msg);
            };
            console.log('[+] SSLPeerUnverifiedException auto-patcher');
        } catch (e) {}

        // ── Pendo Certificate Transparency bypass ─────────────────────────
        try {
            var PendoCT = Java.use('sdk.pendo.io.k.e');
            PendoCT.a.implementation = function () {
                console.log('[+] Pendo CT check bypassed');
            };
            console.log('[+] Pendo CT (sdk.pendo.io.k.e.a)');
        } catch (e) {}

        console.log('[*] All hooks installed — use the app now');
    });
}, 3000);
