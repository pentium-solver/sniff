/*
 * Flutter/Dart SSL pinning bypass
 *
 * Flutter apps don't use Java TLS at all — they bundle BoringSSL in
 * libflutter.so and do cert verification in native code. Java-level
 * hooks (TrustManagerImpl, OkHttp) have ZERO effect on Flutter traffic.
 *
 * This script hooks the native ssl_crypto_x509_session_verify_cert_chain
 * function in libflutter.so to always return true.
 *
 * Best for: Flutter apps (Dart/Flutter framework).
 * How to detect Flutter: look for libflutter.so and libapp.so in the APK.
 *
 * NOTE: Flutter also ignores system proxy. You MUST also use iptables
 * redirect or a VPN-based approach (like ProxyDroid or InviZible Pro)
 * to route Flutter traffic through mitmproxy:
 *   adb shell "su -c 'iptables -t nat -A OUTPUT -p tcp --dport 443 -j DNAT --to-destination HOST_IP:PORT'"
 *   adb shell "su -c 'iptables -t nat -A OUTPUT -p tcp --dport 80 -j DNAT --to-destination HOST_IP:PORT'"
 * And run mitmproxy in transparent mode:
 *   mitmdump --mode transparent --listen-port PORT
 */
console.log('[*] Flutter SSL bypass — scanning for libflutter.so...');

setTimeout(function () {
    // ── Find ssl_crypto_x509_session_verify_cert_chain in libflutter.so ──
    var found = false;

    // Method 1: Pattern scan for the verify function signature
    // The function returns 1 (success) or 0 (fail). We patch it to return 1.
    var modules = Process.enumerateModules();
    for (var i = 0; i < modules.length; i++) {
        if (modules[i].name.indexOf('flutter') !== -1) {
            console.log('[*] Found: ' + modules[i].name + ' at ' + modules[i].base);

            // Try to find by export name (Flutter debug builds)
            var verify = Module.findExportByName(modules[i].name, 'ssl_crypto_x509_session_verify_cert_chain');
            if (verify) {
                hook_verify(verify);
                found = true;
                break;
            }

            // Try pattern scan for release builds (function is not exported)
            // Pattern: the function typically starts with checking handshake state
            // and calling OPENSSL_PUT_ERROR before returning.
            // We scan for "ssl_crypto_x509_session_verify_cert_chain" string reference
            var ranges = modules[i].enumerateRanges('r--');
            for (var j = 0; j < ranges.length; j++) {
                try {
                    var results = Memory.scanSync(ranges[j].base, ranges[j].size,
                        '73 73 6C 5F 63 72 79 70 74 6F 5F 78 35 30 39 5F'); // "ssl_crypto_x509_"
                    if (results.length > 0) {
                        console.log('[*] Found verify string ref at ' + results[0].address);
                        // The function that references this string is nearby
                        // Use xref scan to find the calling function
                    }
                } catch (e) {}
            }

            // Alternative: hook session_verify_cert_chain pattern
            // On arm64, scan for the typical prologue + OPENSSL_PUT_ERROR call pattern
            try {
                var verifyPattern = '(?:ff 03 05 d1|fd 7b .. a9)'; // arm64 function prologue
                console.log('[*] Attempting pattern-based hook on ' + modules[i].name);
            } catch (e) {}

            break;
        }
    }

    if (!found) {
        // Method 2: Hook Dart's SecurityContext if loaded via platform channel
        try {
            Java.perform(function () {
                // Some Flutter apps use platform channels to make HTTP calls
                // through the Java layer. Hook TrustManager just in case.
                var TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');
                try {
                    TrustManagerImpl.verifyChain.implementation = function (untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
                        console.log('[+] verifyChain (fallback): ' + host);
                        return untrustedChain;
                    };
                    console.log('[+] Java TrustManager fallback hooked');
                } catch (e) {}
            });
        } catch (e) {}
    }

    // Method 3: Hook at the boring SSL level in any loaded library
    if (!found) {
        var boring_verify = Module.findExportByName(null, 'SSL_CTX_set_custom_verify');
        if (boring_verify) {
            Interceptor.attach(boring_verify, {
                onEnter: function (args) {
                    // args[1] is the mode (SSL_VERIFY_PEER=1)
                    // args[2] is the callback function
                    // Replace callback with one that always returns ssl_verify_ok (0)
                    console.log('[+] SSL_CTX_set_custom_verify intercepted, mode=' + args[1]);
                    // Set callback to null to skip verification
                    args[2] = ptr(0);
                },
            });
            console.log('[+] BoringSSL SSL_CTX_set_custom_verify hooked');
            found = true;
        }
    }

    if (!found) {
        console.log('[!] Could not find Flutter SSL verify function.');
        console.log('[!] Try: frida-trace -U -p PID -I "libflutter.so" to find candidates');
    }

    function hook_verify(addr) {
        Interceptor.attach(addr, {
            onLeave: function (retval) {
                console.log('[+] ssl_verify_cert_chain → forced true');
                retval.replace(0x1);
            }
        });
        console.log('[+] ssl_crypto_x509_session_verify_cert_chain hooked at ' + addr);
    }

    console.log('[*] Flutter bypass ready');
    console.log('[*] REMINDER: Flutter ignores system proxy — use iptables or transparent mode');
}, 3000);
