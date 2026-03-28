/*
 * WebView + HttpsURLConnection SSL bypass
 *
 * Targets WebView-based apps and apps using HttpsURLConnection (not OkHttp).
 * Hooks WebViewClient.onReceivedSslError to auto-proceed on cert errors,
 * and patches HttpsURLConnection hostname/factory verification.
 *
 * Best for: Hybrid apps (Cordova, Ionic, Capacitor), WebView wrappers,
 * banking apps that load content in WebViews, and apps using
 * HttpsURLConnection instead of OkHttp.
 *
 * Good for: Apps where the main API works but embedded WebView content
 * shows SSL errors. Also catches apps using legacy java.net.URL API.
 * NOT enough for: OkHttp-based API calls, Flutter, React Native with
 * custom TLS config.
 */
console.log('[*] WebView + HttpsURLConnection bypass — installing in 3s...');

setTimeout(function () {
    Java.perform(function () {
        var ArrayList = Java.use('java.util.ArrayList');

        // ── WebViewClient.onReceivedSslError ─────────────────────────────
        // Auto-proceed on SSL errors in any WebView
        try {
            var WebViewClient = Java.use('android.webkit.WebViewClient');
            WebViewClient.onReceivedSslError.overload(
                'android.webkit.WebView', 'android.webkit.SslErrorHandler', 'android.net.http.SslError'
            ).implementation = function (view, handler, error) {
                console.log('[+] WebView SSL error → proceed');
                console.log('    URL: ' + view.getUrl());
                handler.proceed();
            };
            console.log('[+] WebViewClient.onReceivedSslError');
        } catch (e) {
            console.log('[!] WebViewClient: ' + e.message);
        }

        // ── Also hook custom WebViewClient subclasses ────────────────────
        try {
            Java.enumerateLoadedClasses({
                onMatch: function (className) {
                    try {
                        var cls = Java.use(className);
                        if (cls.class.getSuperclass() &&
                            cls.class.getSuperclass().getName() === 'android.webkit.WebViewClient') {
                            try {
                                cls.onReceivedSslError.overload(
                                    'android.webkit.WebView', 'android.webkit.SslErrorHandler', 'android.net.http.SslError'
                                ).implementation = function (view, handler, error) {
                                    console.log('[+] ' + className + ' SSL → proceed');
                                    handler.proceed();
                                };
                                console.log('[+] Custom WebViewClient: ' + className);
                            } catch (e) {}
                        }
                    } catch (e) {}
                },
                onComplete: function () {}
            });
        } catch (e) {}

        // ── HttpsURLConnection ───────────────────────────────────────────
        try {
            var HttpsURLConnection = Java.use('javax.net.ssl.HttpsURLConnection');
            HttpsURLConnection.setDefaultHostnameVerifier.implementation = function (v) {
                console.log('[+] setDefaultHostnameVerifier blocked');
            };
            HttpsURLConnection.setSSLSocketFactory.implementation = function (f) {
                console.log('[+] setSSLSocketFactory blocked');
            };
            HttpsURLConnection.setHostnameVerifier.implementation = function (v) {
                console.log('[+] setHostnameVerifier blocked');
            };
            console.log('[+] HttpsURLConnection verifier hooks');
        } catch (e) {}

        // ── HostnameVerifier — accept all ────────────────────────────────
        try {
            var SSLSession = Java.use('javax.net.ssl.SSLSession');
            var HostnameVerifier = Java.use('javax.net.ssl.HostnameVerifier');

            // Hook all loaded HostnameVerifier implementations
            Java.enumerateLoadedClasses({
                onMatch: function (className) {
                    try {
                        var cls = Java.use(className);
                        var interfaces = cls.class.getInterfaces();
                        for (var i = 0; i < interfaces.length; i++) {
                            if (interfaces[i].getName() === 'javax.net.ssl.HostnameVerifier') {
                                try {
                                    cls.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession')
                                        .implementation = function () { return true; };
                                    console.log('[+] HostnameVerifier: ' + className);
                                } catch (e) {}
                            }
                        }
                    } catch (e) {}
                },
                onComplete: function () {}
            });
        } catch (e) {}

        // ── TrustManagerImpl basics (for HttpsURLConnection) ─────────────
        try {
            var TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');

            try {
                TrustManagerImpl.verifyChain.implementation = function (untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
                    console.log('[+] verifyChain: ' + host);
                    return untrustedChain;
                };
                console.log('[+] TrustManagerImpl.verifyChain');
            } catch (e) {}

            try {
                TrustManagerImpl.checkTrustedRecursive.implementation = function (a1, a2, a3, a4, a5, a6) {
                    return ArrayList.$new();
                };
                console.log('[+] TrustManagerImpl.checkTrustedRecursive');
            } catch (e) {}
        } catch (e) {}

        // ── SSLPeerUnverifiedException logger ────────────────────────────
        try {
            var UnverifiedCertError = Java.use('javax.net.ssl.SSLPeerUnverifiedException');
            UnverifiedCertError.$init.implementation = function (str) {
                console.log('[!] SSLPeerUnverifiedException: ' + str);
                return this.$init(str);
            };
        } catch (e) {}

        console.log('[*] WebView + HttpsURLConnection bypass ready');
    });
}, 3000);
