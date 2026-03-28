/*
 * Pilot FJ — SSL unpin + proxy redirect
 * Combines codeshare techniques with app-specific hooks
 * Delayed to avoid ART JIT corruption
 */
console.log('[*] Frida attached — installing hooks in 3s...');

setTimeout(function () {
    Java.perform(function () {
        console.log('[*] Installing hooks...');

        var ArrayList = Java.use('java.util.ArrayList');
        var ProxyCls = Java.use('java.net.Proxy');
        var ProxyType = Java.use('java.net.Proxy$Type');
        var InetSocketAddress = Java.use('java.net.InetSocketAddress');

        // ── 1. Hook bE1 ProxySelector (API client uses this, bypasses system proxy) ──
        try {
            var bE1 = Java.use('bE1');
            bE1.select.implementation = function (uri) {
                var host = uri.getHost();
                if (host !== null) {
                    var hostStr = host.toString();
                    if (hostStr.indexOf('pilotflyingj.com') !== -1 ||
                        hostStr.indexOf('pilotcloud.net') !== -1) {
                        var addr = InetSocketAddress.$new("172.16.1.129", 8080);
                        var proxy = ProxyCls.$new(ProxyType.HTTP.value, addr);
                        var list = ArrayList.$new();
                        list.add(proxy);
                        console.log('[+] PROXY → ' + uri);
                        return list;
                    }
                }
                var list = ArrayList.$new();
                list.add(ProxyCls.NO_PROXY.value);
                return list;
            };
            console.log('[+] bE1.select hooked');
        } catch (e) {
            console.log('[!] bE1 failed: ' + e);
        }

        // ── 2. ON.a cert pin bypass ──
        try {
            var ON = Java.use('ON');
            ON.a.implementation = function (hostname, chain) {
                console.log('[+] Pin bypass: ' + hostname);
            };
            console.log('[+] ON.a hooked');
        } catch (e) {
            console.log('[!] ON.a failed: ' + e);
        }

        // ── 3. TrustManagerImpl — Android 7+ cert validation bypass ──
        // From codeshare: hook checkTrustedRecursive + verifyChain (the REAL methods)
        try {
            var TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');

            // checkTrustedRecursive is the actual validation method
            try {
                TrustManagerImpl.checkTrustedRecursive.implementation = function (a1, a2, a3, a4, a5, a6) {
                    console.log('[+] checkTrustedRecursive bypassed');
                    return ArrayList.$new();
                };
                console.log('[+] TrustManagerImpl.checkTrustedRecursive hooked');
            } catch (e) {
                console.log('[!] checkTrustedRecursive not found: ' + e.message);
            }

            // verifyChain is the entry point on newer Android
            try {
                TrustManagerImpl.verifyChain.implementation = function (untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
                    console.log('[+] verifyChain bypassed: ' + host);
                    return untrustedChain;
                };
                console.log('[+] TrustManagerImpl.verifyChain hooked');
            } catch (e) {
                console.log('[!] verifyChain not found: ' + e.message);
            }

            // Also hook checkServerTrusted as fallback
            try {
                TrustManagerImpl.checkServerTrusted.overloads.forEach(function (overload) {
                    overload.implementation = function () {
                        console.log('[+] checkServerTrusted bypassed');
                        if (overload.returnType.name !== 'void') {
                            return ArrayList.$new();
                        }
                    };
                });
                console.log('[+] TrustManagerImpl.checkServerTrusted hooked');
            } catch (e) {
                console.log('[!] checkServerTrusted failed: ' + e.message);
            }

            console.log('[+] TrustManagerImpl all methods hooked');
        } catch (e) {
            console.log('[!] TrustManagerImpl class not found: ' + e);
        }

        // ── 4. SSLPeerUnverifiedException auto-patcher (from fdciabdul) ──
        // Catches any SSL exception and patches the throwing method dynamically
        try {
            var UnverifiedCertError = Java.use('javax.net.ssl.SSLPeerUnverifiedException');
            UnverifiedCertError.$init.implementation = function (str) {
                console.log('[!] SSLPeerUnverifiedException: ' + str);
                try {
                    var stackTrace = Java.use('java.lang.Thread').currentThread().getStackTrace();
                    var exIdx = -1;
                    for (var i = 0; i < stackTrace.length; i++) {
                        if (stackTrace[i].getClassName() === 'javax.net.ssl.SSLPeerUnverifiedException') {
                            exIdx = i;
                            break;
                        }
                    }
                    if (exIdx >= 0 && exIdx + 1 < stackTrace.length) {
                        var caller = stackTrace[exIdx + 1];
                        console.log('[!] Thrown by: ' + caller.getClassName() + '.' + caller.getMethodName());
                    }
                } catch (e2) {}
                return this.$init(str);
            };
            console.log('[+] SSLPeerUnverifiedException auto-patcher');
        } catch (e) {}

        // ── 5. Splunk exporter neutralization ──
        try {
            var AndroidSpanExporter = Java.use('com.splunk.rum.common.otel.span.AndroidSpanExporter');
            AndroidSpanExporter.export.implementation = function (spans) {
                var r = Java.use('aV').$new(); r.e(); return r;
            };
            AndroidSpanExporter.flush.implementation = function () {
                var r = Java.use('aV').$new(); r.e(); return r;
            };
            console.log('[+] Splunk neutralized');
        } catch (e) {}

        try {
            var SpanInterceptor = Java.use('com.splunk.rum.common.otel.span.SpanInterceptorExporter');
            SpanInterceptor.export.implementation = function (spans) {
                var r = Java.use('aV').$new(); r.e(); return r;
            };
        } catch (e) {}

        console.log('[*] All hooks installed — refresh the app');
    });
}, 3000);
