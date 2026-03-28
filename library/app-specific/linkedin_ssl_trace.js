/*
 * LinkedIn SSL trace helper
 *
 * Goal:
 * - keep the app's failure behavior intact
 * - log which trust/pinning code path is actually firing
 * - surface useful stack frames for app-specific hook targeting
 */
console.log('[*] LinkedIn SSL trace — installing in 3s...');

setTimeout(function () {
    Java.perform(function () {
        var Thread = Java.use('java.lang.Thread');

        function safeString(v) {
            try {
                if (v === null || v === undefined) return 'null';
                return v.toString();
            } catch (e) {
                return '<toString failed: ' + e + '>';
            }
        }

        function logInterestingStack(prefix) {
            try {
                var stack = Thread.currentThread().getStackTrace();
                var shown = 0;
                for (var i = 0; i < stack.length; i++) {
                    var cls = stack[i].getClassName();
                    if (
                        cls.indexOf('java.') === 0 ||
                        cls.indexOf('javax.') === 0 ||
                        cls.indexOf('android.') === 0 ||
                        cls.indexOf('dalvik.') === 0 ||
                        cls.indexOf('sun.') === 0
                    ) {
                        continue;
                    }
                    console.log(prefix + ' ' + cls + '.' + stack[i].getMethodName());
                    shown++;
                    if (shown >= 12) break;
                }
            } catch (e) {
                console.log(prefix + ' <stack failed: ' + e + '>');
            }
        }

        function traceClassMethod(className, methodName, formatter) {
            try {
                var Cls = Java.use(className);
                if (!Cls[methodName]) {
                    console.log('[!] Missing ' + className + '.' + methodName);
                    return;
                }
                Cls[methodName].overloads.forEach(function (overload) {
                    overload.implementation = function () {
                        var args = [];
                        for (var i = 0; i < arguments.length; i++) {
                            args.push(arguments[i]);
                        }
                        try {
                            console.log(formatter(args, overload));
                            logInterestingStack('[TRACE]');
                        } catch (e) {
                            console.log('[!] Trace formatter failed for ' + className + '.' + methodName + ': ' + e);
                        }
                        return overload.apply(this, args);
                    };
                });
                console.log('[+] Tracing ' + className + '.' + methodName);
            } catch (e) {
                console.log('[!] Failed tracing ' + className + '.' + methodName + ': ' + e);
            }
        }

        try {
            var Unverified = Java.use('javax.net.ssl.SSLPeerUnverifiedException');
            Unverified.$init.implementation = function (msg) {
                console.log('[!] SSLPeerUnverifiedException: ' + safeString(msg));
                logInterestingStack('[PEER]');
                return this.$init(msg);
            };
            console.log('[+] SSLPeerUnverifiedException logger');
        } catch (e) {
            console.log('[!] SSLPeerUnverifiedException logger failed: ' + e);
        }

        try {
            var Handshake = Java.use('javax.net.ssl.SSLHandshakeException');
            Handshake.$init.implementation = function (msg) {
                console.log('[!] SSLHandshakeException: ' + safeString(msg));
                logInterestingStack('[HANDSHAKE]');
                return this.$init(msg);
            };
            console.log('[+] SSLHandshakeException logger');
        } catch (e) {
            console.log('[!] SSLHandshakeException logger failed: ' + e);
        }

        try {
            var CertEx = Java.use('java.security.cert.CertificateException');
            CertEx.$init.overloads.forEach(function (overload) {
                overload.implementation = function () {
                    console.log('[!] CertificateException: ' + safeString(arguments[0]));
                    logInterestingStack('[CERT]');
                    return overload.apply(this, arguments);
                };
            });
            console.log('[+] CertificateException logger');
        } catch (e) {
            console.log('[!] CertificateException logger failed: ' + e);
        }

        traceClassMethod(
            'com.android.org.conscrypt.TrustManagerImpl',
            'verifyChain',
            function (args) {
                return '[TM] verifyChain host=' + safeString(args[2]);
            }
        );

        traceClassMethod(
            'com.android.org.conscrypt.TrustManagerImpl',
            'checkTrustedRecursive',
            function (args) {
                return '[TM] checkTrustedRecursive host=' + safeString(args[2]);
            }
        );

        traceClassMethod(
            'okhttp3.CertificatePinner',
            'check',
            function (args) {
                return '[OKHTTP] CertificatePinner.check host=' + safeString(args[0]);
            }
        );

        traceClassMethod(
            'okhttp3.CertificatePinner',
            'check$okhttp',
            function (args) {
                return '[OKHTTP] CertificatePinner.check$okhttp host=' + safeString(args[0]);
            }
        );

        traceClassMethod(
            'com.android.okhttp.CertificatePinner',
            'check',
            function (args) {
                return '[AOSP] CertificatePinner.check host=' + safeString(args[0]);
            }
        );

        traceClassMethod(
            'org.chromium.net.CronetEngine$Builder',
            'addPublicKeyPins',
            function (args) {
                return '[CRONET] addPublicKeyPins host=' + safeString(args[0]);
            }
        );

        traceClassMethod(
            'org.chromium.net.CronetEngine$Builder',
            'enablePublicKeyPinningBypassForLocalTrustAnchors',
            function (args) {
                return '[CRONET] enablePublicKeyPinningBypassForLocalTrustAnchors=' + safeString(args[0]);
            }
        );

        traceClassMethod(
            'org.chromium.net.impl.CronetEngineBuilderImpl',
            'addPublicKeyPins',
            function (args) {
                return '[CRONET] impl.addPublicKeyPins host=' + safeString(args[0]);
            }
        );

        traceClassMethod(
            'org.chromium.net.impl.CronetEngineBuilderImpl',
            'enablePublicKeyPinningBypassForLocalTrustAnchors',
            function (args) {
                return '[CRONET] impl.enablePublicKeyPinningBypassForLocalTrustAnchors=' + safeString(args[0]);
            }
        );

        traceClassMethod(
            'org.apache.http.conn.ssl.AbstractVerifier',
            'verify',
            function (args) {
                return '[APACHE] AbstractVerifier.verify host=' + safeString(args[0]);
            }
        );

        console.log('[*] LinkedIn SSL trace ready');
    });
}, 3000);
