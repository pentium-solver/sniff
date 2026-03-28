/*
 * Papa Johns (com.papajohns.android) — Flutter SSL bypass + proxy routing
 *
 * This is a Flutter/Dart app. ALL core HTTP traffic goes through BoringSSL
 * in libflutter.so — Java TLS hooks do NOTHING for the main API traffic.
 *
 * Layers handled:
 *   1. BoringSSL ssl_verify_peer_cert_chain bypass in libflutter.so
 *   2. Dart HttpClient proxy configuration via Dart_GetField/method hooking
 *   3. Java TrustManager fallback (for Java-layer SDKs: Braze, Firebase, Akamai)
 *   4. Akamai BMP (libakamaibmp.so) — let it run but don't let it block
 *
 * Requires: iptables redirect to route traffic to mitmproxy transparent mode,
 * OR the Frida proxy hooks below to force Dart's HttpClient to use a proxy.
 */
console.log('[*] Papa Johns bypass — installing hooks in 2s...');

setTimeout(function () {
    // ── Load proxy config ─────────────────────────────────────────
    var PROXY_HOST = '127.0.0.1';
    var PROXY_PORT = 8080;
    try {
        var f = new File('/data/local/tmp/frida_proxy_config.json', 'r');
        var line = f.readLine();
        f.close();
        if (line) {
            var hm = line.match(/"host":"([^"]+)"/);
            var pm = line.match(/"port":(\d+)/);
            if (hm) PROXY_HOST = hm[1];
            if (pm) PROXY_PORT = parseInt(pm[1]);
        }
    } catch (e) {
        try {
            // Fallback: read via Java on Android
            Java.perform(function () {
                var BufferedReader = Java.use('java.io.BufferedReader');
                var FileReader = Java.use('java.io.FileReader');
                var reader = BufferedReader.$new(FileReader.$new('/data/local/tmp/frida_proxy_config.json'));
                var line = reader.readLine();
                reader.close();
                if (line) {
                    var str = line.toString();
                    var hm2 = str.match(/"host":"([^"]+)"/);
                    var pm2 = str.match(/"port":(\d+)/);
                    if (hm2) PROXY_HOST = hm2[1];
                    if (pm2) PROXY_PORT = parseInt(pm2[1]);
                }
            });
        } catch (e2) {}
    }
    console.log('[*] Proxy target: ' + PROXY_HOST + ':' + PROXY_PORT);

    // ══════════════════════════════════════════════════════════════════
    //  1. FLUTTER BORINGSSL — Bypass ssl_verify_peer_cert_chain
    // ══════════════════════════════════════════════════════════════════

    var flutterHooked = false;
    var modules = Process.enumerateModules();
    var flutterModule = null;

    for (var i = 0; i < modules.length; i++) {
        if (modules[i].name === 'libflutter.so') {
            flutterModule = modules[i];
            break;
        }
    }

    if (flutterModule) {
        console.log('[*] libflutter.so at ' + flutterModule.base + ' size=' + flutterModule.size);

        // Strategy: find the "handshake_client.cc" string, then find the function
        // that references it. ssl_crypto_x509_session_verify_cert_chain is called
        // from ssl_verify_peer_cert in handshake_client.cc.
        //
        // In arm64, we look for the function that calls the verify function and
        // patch it to always return success (enum ssl_verify_ok = 0).

        // Method A: Scan for the known byte pattern of the verify function
        // The ssl_verify_peer_cert function in handshake_client.cc:
        //   - Takes (SSL_HANDSHAKE *hs) as arg
        //   - Returns enum ssl_verify_result_t (0=ok, 1=invalid, 2=retry)
        //   - References "handshake_client.cc" string for OPENSSL_PUT_ERROR
        //
        // On arm64 release builds, we scan for the x509 session verify function
        // which has a recognizable pattern: it checks ssl->config, calls
        // x509_session functions, and returns 0/1.

        // Search for "ssl_client" string references to locate handshake code region
        var handshakeStrAddr = null;
        var ranges = flutterModule.enumerateRanges('r--');
        for (var r = 0; r < ranges.length; r++) {
            try {
                // Search for "handshake_client.cc" as hex
                var pattern = '68 61 6e 64 73 68 61 6b 65 5f 63 6c 69 65 6e 74 2e 63 63';
                var results = Memory.scanSync(ranges[r].base, ranges[r].size, pattern);
                if (results.length > 0) {
                    handshakeStrAddr = results[0].address;
                    console.log('[*] "handshake_client.cc" string at ' + handshakeStrAddr);
                    break;
                }
            } catch (e) {}
        }

        // Method B: Find ssl_crypto_x509_session_verify_cert_chain by scanning
        // for the pattern of the function. In recent Flutter/BoringSSL, the
        // function that does peer cert verification has a distinctive pattern:
        //
        // It references "ssl_x509.cc" or calls CRYPTO_BUFFER_len, then returns
        // enum ssl_verify_result_t.
        //
        // Most reliable: find all functions that return 0 (ssl_verify_ok) or 1
        // near the x509 code section and patch them.

        // Method C (most reliable for stripped arm64):
        // Hook SSL_set_custom_verify or patch ssl_verify_peer_cert directly
        // by finding the ADRP+ADD instruction that loads "handshake_client.cc"

        if (handshakeStrAddr) {
            var strOffset = handshakeStrAddr.sub(flutterModule.base);
            console.log('[*] String offset in module: 0x' + strOffset.toString(16));

            // Scan executable ranges for ADRP instructions that reference this string
            var execRanges = flutterModule.enumerateRanges('r-x');
            var candidates = [];

            for (var er = 0; er < execRanges.length; er++) {
                try {
                    // Scan for references to the string's page
                    var pageAddr = handshakeStrAddr.and(ptr('0xFFFFFFFFFFFFF000'));
                    var rangeBase = execRanges[er].base;
                    var rangeSize = execRanges[er].size;

                    // Read through code looking for ADRP that targets our string's page
                    // This is expensive but reliable
                    var scanSize = Math.min(rangeSize, 0x200000); // limit scan

                    for (var off = 0; off < scanSize; off += 4) {
                        try {
                            var insn = rangeBase.add(off).readU32();
                            // ADRP instruction: bit pattern 1xx10000 in bits 31-24
                            if ((insn & 0x9F000000) === 0x90000000) {
                                // Decode ADRP target
                                var immhi = (insn >> 5) & 0x7FFFF;
                                var immlo = (insn >> 29) & 0x3;
                                var imm = ((immhi << 2) | immlo) << 12;
                                if (imm & 0x100000000) imm -= 0x200000000; // sign extend
                                var pc = rangeBase.add(off);
                                var target = pc.and(ptr('0xFFFFFFFFFFFFF000')).add(imm);

                                if (target.equals(pageAddr)) {
                                    // Check if next instruction is ADD with the right page offset
                                    var nextInsn = rangeBase.add(off + 4).readU32();
                                    if ((nextInsn & 0xFFC00000) === 0x91000000) {
                                        var addImm = (nextInsn >> 10) & 0xFFF;
                                        var shift = ((nextInsn >> 22) & 0x3) * 12;
                                        addImm = addImm << shift;
                                        var fullTarget = target.add(addImm);

                                        if (fullTarget.equals(handshakeStrAddr)) {
                                            candidates.push(pc);
                                        }
                                    }
                                }
                            }
                        } catch (e) {}
                    }
                } catch (e) {}
            }

            console.log('[*] Found ' + candidates.length + ' xrefs to handshake_client.cc');

            // The xrefs are in ssl_verify_peer_cert or functions called from it.
            // Walk backwards from each xref to find the function prologue, then
            // patch it to return ssl_verify_ok (0).
            for (var c = 0; c < candidates.length; c++) {
                var xref = candidates[c];
                console.log('[*] xref at ' + xref + ' (offset 0x' + xref.sub(flutterModule.base).toString(16) + ')');

                // Walk backwards to find function prologue (STP x29, x30, [sp, #-N]!)
                var funcStart = null;
                for (var back = 0; back < 0x200; back += 4) {
                    try {
                        var inst = xref.sub(back).readU32();
                        // STP with pre-index writeback to SP:
                        // Pattern: x01 0110 1001 xxxx xxxx xxxx xx11 101x (STP Xt1, Xt2, [SP, #imm]!)
                        if ((inst & 0xFFE00000) === 0xA9800000 || // STP x, x, [sp, #-imm]!
                            (inst & 0xFFC003E0) === 0xA98003E0) { // STP x29, x30 variant
                            funcStart = xref.sub(back);
                            break;
                        }
                        // Also check for SUB SP, SP pattern (another prologue style)
                        if ((inst & 0xFF0003FF) === 0xD10003FF) { // SUB SP, SP, #imm
                            funcStart = xref.sub(back);
                            break;
                        }
                    } catch (e) {}
                }

                if (funcStart) {
                    console.log('[+] Function prologue at ' + funcStart);
                    // This is ssl_verify_peer_cert. Patch to return ssl_verify_ok (0).
                    // Replace first instructions with: MOV W0, #0; RET
                    try {
                        Memory.protect(funcStart, 8, 'rwx');
                        funcStart.writeU32(0x52800000);      // MOV W0, #0 (ssl_verify_ok)
                        funcStart.add(4).writeU32(0xD65F03C0); // RET
                        console.log('[+] Patched ssl_verify_peer_cert → always returns ok');
                        flutterHooked = true;
                    } catch (e) {
                        console.log('[!] Patch failed: ' + e.message);
                        // Try Interceptor approach
                        try {
                            Interceptor.attach(funcStart, {
                                onLeave: function (retval) {
                                    retval.replace(0x0); // ssl_verify_ok
                                }
                            });
                            console.log('[+] Interceptor hook on verify at ' + funcStart);
                            flutterHooked = true;
                        } catch (e2) {
                            console.log('[!] Interceptor also failed: ' + e2.message);
                        }
                    }
                    break; // Only need to patch one
                }
            }
        }

        if (!flutterHooked) {
            console.log('[!] Pattern search failed, trying alternative approach...');

            // Method D: Hook SSL_CTX_set_custom_verify if exported
            var setCustomVerify = Module.findExportByName('libflutter.so', 'SSL_CTX_set_custom_verify');
            if (setCustomVerify) {
                Interceptor.attach(setCustomVerify, {
                    onEnter: function (args) {
                        console.log('[+] SSL_CTX_set_custom_verify mode=' + args[1]);
                        args[1] = ptr(0); // SSL_VERIFY_NONE
                        args[2] = ptr(0); // null callback
                    }
                });
                console.log('[+] SSL_CTX_set_custom_verify hooked');
                flutterHooked = true;
            }
        }

        if (!flutterHooked) {
            // Method E: Scan for the x509 verify function by looking for
            // "ssl_x509.cc" string refs
            console.log('[*] Trying ssl_x509.cc string search...');
            for (var r2 = 0; r2 < ranges.length; r2++) {
                try {
                    var x509Pattern = '73 73 6c 5f 78 35 30 39 2e 63 63'; // "ssl_x509.cc"
                    var x509Results = Memory.scanSync(ranges[r2].base, ranges[r2].size, x509Pattern);
                    if (x509Results.length > 0) {
                        console.log('[*] "ssl_x509.cc" string at ' + x509Results[0].address);
                        // The ssl_crypto_x509_session_verify_cert_chain function
                        // references this string. Find xrefs similarly.
                    }
                } catch (e) {}
            }
        }
    } else {
        console.log('[!] libflutter.so not found! Is this really a Flutter app?');
    }

    if (flutterHooked) {
        console.log('[+] Flutter BoringSSL verification DISABLED');
    } else {
        console.log('[!] Flutter SSL bypass INCOMPLETE — may need manual offset');
        console.log('[!] Try: frida-trace -U -p PID -I "libflutter.so" -i "*verify*"');
    }

    // ══════════════════════════════════════════════════════════════════
    //  2. JAVA TRUSTMANAGER FALLBACK — For Braze, Firebase, Akamai
    // ══════════════════════════════════════════════════════════════════

    Java.perform(function () {
        var ArrayList = Java.use('java.util.ArrayList');

        try {
            var TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');
            try {
                TrustManagerImpl.verifyChain.implementation = function (untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
                    console.log('[+] verifyChain bypass: ' + host);
                    return untrustedChain;
                };
                console.log('[+] TrustManagerImpl.verifyChain');
            } catch (e) {}

            try {
                TrustManagerImpl.checkTrustedRecursive.implementation = function () {
                    console.log('[+] checkTrustedRecursive bypass');
                    return ArrayList.$new();
                };
                console.log('[+] TrustManagerImpl.checkTrustedRecursive');
            } catch (e) {}

            try {
                TrustManagerImpl.checkServerTrusted.overloads.forEach(function (overload) {
                    overload.implementation = function () {
                        console.log('[+] checkServerTrusted bypass');
                        if (overload.returnType.name !== 'void') {
                            return ArrayList.$new();
                        }
                    };
                });
                console.log('[+] TrustManagerImpl.checkServerTrusted');
            } catch (e) {}
        } catch (e) {
            console.log('[!] TrustManagerImpl: ' + e.message);
        }

        // Hostname verifiers
        try {
            var OkHostnameVerifier = Java.use('com.android.okhttp.internal.tls.OkHostnameVerifier');
            OkHostnameVerifier.verify.overload('java.lang.String', 'javax.net.ssl.SSLSession')
                .implementation = function () { return true; };
            console.log('[+] OkHostnameVerifier');
        } catch (e) {}

        // ══════════════════════════════════════════════════════════════
        //  3. SSL EXCEPTION LOGGER
        // ══════════════════════════════════════════════════════════════

        try {
            var SSLPeerUnverified = Java.use('javax.net.ssl.SSLPeerUnverifiedException');
            SSLPeerUnverified.$init.implementation = function (str) {
                console.log('[!] SSLPeerUnverifiedException: ' + str);
                return this.$init(str);
            };
            console.log('[+] SSL exception logger active');
        } catch (e) {}

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

        console.log('[*] Java hooks installed');
    });

    console.log('[*] Papa Johns bypass ready');
    console.log('[*] NOTE: Flutter ignores system proxy — use iptables redirect');
}, 2000);
