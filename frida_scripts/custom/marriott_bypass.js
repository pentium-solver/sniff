// META: name=marriott_bypass label=MARRIOTT desc=Root+Frida+integrity_bypass_with_full_diagnostic_logging_for_com.marriott.mrt
//
// ═══════════════════════════════════════════════════════════════════════════
// Marriott (com.marriott.mrt) — Root / Frida / Integrity Bypass v3
// ═══════════════════════════════════════════════════════════════════════════
// Layer 1  — Java kill/exit intercept (System.exit, Runtime.exit, Process.kill)
// Layer 2  — Root detection bypass (File, Runtime.exec, Build, SELinux, PM)
// Layer 3  — Frida detection bypass (/proc/maps filter, port 27042, debug flag)
// Layer 4  — SSL/TLS full bypass (Conscrypt deep hooks + OkHttp + nuclear TM)
// Layer 5  — ProxySelector: force all traffic through mitmdump
// Layer 6  — Response body rewriter: patches block verdicts from backend
// Layer 7  — Play Integrity / SafetyNet intercept
// Layer 8  — Diagnostics: AlertDialog capture, loaded-class scan
// Layer 9  — Marriott obfuscated kill chain (mfWkY6 / dWW8n3 / anonymous Runnables)
// Layer 10 — Native watchdog suppression via loadLibrary0 probe
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

var T = '[mrt]';
function log(s)  { console.log(T + ' ' + s); }
function warn(s) { console.log(T + ' ⚠ ' + s); }

// ── Stack trace helper ────────────────────────────────────────────────────────
function stackTrace(label) {
    try {
        Java.perform(function() {
            var e  = Java.use('java.lang.Exception').$new(label);
            var lg = Java.use('android.util.Log');
            var s  = lg.getStackTraceString(e);
            var lines = s.split('\n').filter(function(l) {
                return l.indexOf('java.lang.Exception') < 0 &&
                       l.indexOf('dalvik.system') < 0;
            }).slice(0, 10).join('\n');
            log('STACK ' + label + '\n' + lines);
        });
    } catch(_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// MC PATCHES — REMOVED (InAuth integrity detection)
//
// Memory.patchCode on libart.so was effective (MarkCompact stopped crashing)
// but InAuth SDK reads the first 4 bytes of critical ART functions as an
// integrity check.  With RunPhases()+DecodeGcMasksOnly() patched to RET, InAuth
// detects the modification and terminates WITHOUT making the risk-api.inauth.com
// HTTP call — we never see the network traffic.
//
// Known good offsets for future use (BuildId 448a8ce89fb4fdbeea9d1dc3756d6f96):
//   MarkCompact::RunPhases()       libartBase + 0x291894
//   CodeInfo::DecodeGcMasksOnly()  libartBase + 0x634b8c
//
// Without patches, GC still runs.  setTargetHeapUtilization(0.99) below delays
// automatic GC enough that the original working run reached InAuth fine.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// KILL/TGKILL INTERCEPT — catch non-exit() termination vectors
//
// InAuth (or another component) may be calling kill(getpid(), SIGKILL) or
// tgkill() directly instead of _exit().  Hook both libc functions to detect
// and log what's actually killing the process.
// ─────────────────────────────────────────────────────────────────────────────
(function interceptKillSyscalls() {
    // Signal 33 = SIGRTMIN+1 on Android bionic = ART's MarkCompact flip-thread-roots
    // signal.  When MarkCompact hits the flip phase it tgkill(sig=33) every app thread.
    // If a thread has a Frida trampoline on its stack and tries to run the flip handler,
    // DecodeGcMasksOnly(null) crashes inside a signal handler context.  SIGSEGV inside
    // a signal handler is fatal: ART catches it and calls exit_group syscall directly
    // (bypassing our libc _exit hook) → "Process terminated".
    //
    // Fix: replace tgkill to DROP sig=33 calls (return 0 without sending signal).
    // Effect: threads never get the flip signal → MarkCompact can't complete flip phase
    // → GC either skips or times out.  For our 30s window that's acceptable.
    //
    // kill/tkill: log only for now; block if needed once we confirm sig=33 is the vector.
    try {
        var libcMod = Process.findModuleByName('libc.so');
        if (!libcMod) return;
        var selfPid = Process.id;

        // tgkill(tgid, tid, sig) — REPLACE to block sig=33
        var tgkillAddr = libcMod.findExportByName('tgkill');
        if (tgkillAddr) {
            var realTgkill = new NativeFunction(tgkillAddr, 'int', ['int', 'int', 'int']);
            Interceptor.replace(tgkillAddr, new NativeCallback(function(tgid, tid, sig) {
                if (sig === 33) {
                    // MarkCompact flip-roots signal — drop it; let GC skip/timeout
                    // (first few fires get a warn so we can confirm the block works)
                    return 0;
                }
                if (sig === 9 || sig === 6) {
                    warn('TGKILL: tgkill(' + tgid + ', tid=' + tid + ', sig=' + sig +
                         ') ← lethal signal from thread ' + Process.getCurrentThreadId());
                }
                return realTgkill(tgid, tid, sig);
            }, 'int', ['int', 'int', 'int']));
            log('tgkill @ ' + tgkillAddr + ' REPLACED (sig=33 dropped)');
        }

        // kill/tkill — observe only, log self-directed lethal signals
        ['kill', 'tkill'].forEach(function(fnName) {
            var addr = libcMod.findExportByName(fnName);
            if (!addr) return;
            try {
                Interceptor.attach(addr, {
                    onEnter: function(args) {
                        var pid = args[0].toInt32();
                        var sig = args[1].toInt32();
                        if (sig === 9 || sig === 6 || pid === selfPid) {
                            warn('KILL: ' + fnName + '(' + pid + ', sig=' + sig +
                                 ') from thread ' + Process.getCurrentThreadId());
                        }
                    }
                });
                log('hooked ' + fnName + ' @ ' + addr);
            } catch(e) { warn('hook ' + fnName + ' failed: ' + e); }
        });
    } catch(e) { warn('interceptKillSyscalls failed: ' + e); }
})();

// ─────────────────────────────────────────────────────────────────────────────
// NATIVE EXIT BLOCK — InAuth SDK calls _exit() from JNI after verdict decrypt
//
// InAuth's response is {"encryptedBody":"..."}.  The SDK decrypts it internally,
// reads "deny", and calls native _exit(0) directly from JNI — bypassing every
// Java-level hook (System.exit, Runtime.exit, Process.killProcess).
// Intercept _exit and exit in bionic libc before Java.perform so it's active
// for the full lifetime of the process.
// ─────────────────────────────────────────────────────────────────────────────
(function blockNativeExit() {
    // _exit / exit are __attribute__((noreturn)).  A NativeCallback that just
    // returns void is UB — the caller's epilogue has no return path, so Frida's
    // trampoline unwinds into garbage → crash.
    //
    // Fix: call pthread_exit(ptr(0)) instead of returning.  This terminates the
    // calling thread cleanly (not the whole process), and like _exit it never
    // returns — so the noreturn ABI contract is satisfied.  If InAuth fires
    // from a background thread the process lives; if from the main thread we
    // need the thread to STAY ALIVE (not exit) so the process keeps running.
    //
    // pthread_exit(0) was wrong: on Android the main Looper thread calls _exit()
    // when InAuth gets a deny verdict.  pthread_exit() on the main thread triggers
    // ART shutdown and the process dies cleanly ("Process terminated").
    //
    // Fix: use pause() in an infinite loop.  pause() blocks the calling thread
    // on a signal-wait syscall — zero CPU, thread stays alive, process continues.
    // Works correctly for both main thread and background threads.
    //
    // API note: Module.findExportByName(moduleName, sym) is REMOVED in Frida 17.
    // Use Process.findModuleByName(name) → instance.findExportByName(sym) instead.
    var libcMod = Process.findModuleByName('libc.so');
    if (!libcMod) { warn('blockNativeExit: libc.so not found — skipping exit hooks'); return; }

    // pause() blocks the calling thread until any signal arrives, then we loop.
    // This satisfies the __noreturn ABI contract (we never return to caller).
    var pauseAddr = libcMod.findExportByName('pause');
    var nativePause = pauseAddr ? new NativeFunction(pauseAddr, 'int', []) : null;
    if (nativePause) {
        log('pause @ ' + pauseAddr + ' resolved (exit block strategy)');
    } else {
        warn('blockNativeExit: pause() not found — will busy-spin');
    }

    ['_exit', 'exit'].forEach(function(fnName) {
        try {
            var addr = libcMod.findExportByName(fnName);
            if (!addr) { warn('native ' + fnName + ': export not found in libc.so'); return; }
            (function(capturedName, capturedAddr) {
                Interceptor.replace(capturedAddr, new NativeCallback(function(code) {
                    console.log('[mrt] ⚠ native ' + capturedName + '(' + code +
                                ') BLOCKED — thread frozen via pause() loop');
                    // pause() loop: thread sleeps on signal-wait, never returns.
                    // Zero CPU. Main thread stays alive → process stays alive.
                    if (nativePause) {
                        while (true) { nativePause(); }
                    }
                    // Fallback busy-spin (shouldn't reach here if pause resolved)
                    while (true) {}
                }, 'void', ['int']));
                log('native ' + capturedName + ' @ ' + capturedAddr + ' BLOCKED (→ pause loop)');
            })(fnName, addr);
        } catch(e) {
            warn('native ' + fnName + ' hook failed: ' + e);
        }
    });
})();

// ─────────────────────────────────────────────────────────────────────────────
// LAYERS 1–10 — Java-side hooks
// ─────────────────────────────────────────────────────────────────────────────
Java.perform(function() {

// ─────────────────────────────────────────────────────────────────────────────
// GC COMPATIBILITY — Android 14 MarkCompact GC + Frida trampolines
//
// Android 14 MarkCompact GC does stop-the-world root-scanning on ALL threads.
// Frida's JS engine lives in anonymous pages with no OatQuickMethodHeader.
// When GC walks a thread mid-hook → DecodeGcMasksOnly(null) → SIGSEGV in
// HeapTaskDaemon.  Fix: force CC (Concurrent Copying) GC before spawning:
//
//   adb shell setprop dalvik.vm.gctype CC
//   frida -U -f com.marriott.mrt -l ...
//
// Script-side mitigations below buy extra time but are not a full substitute.
// ─────────────────────────────────────────────────────────────────────────────
    (function() {
        // ── Detect GC type (diagnostic only) ────────────────────────────────
        // NOTE: dalvik.vm.gctype reports what was SET, not what is ACTIVE.
        // The active GC is determined at Zygote startup — setprop alone does NOT
        // change a running process.  To apply the change you must restart Zygote:
        //
        //   adb shell setprop dalvik.vm.gctype CC
        //   adb shell stop && adb shell start   ← restarts Zygote
        //   frida -U -f com.marriott.mrt -l ... ← now uses CC GC
        //
        // DO NOT call System.gc() inside Java.perform() — it triggers a MarkCompact
        // checkpoint on the calling thread while Frida JS is on its stack → SIGSEGV.
        try {
            var gctype = Java.use('android.os.SystemProperties')
                             .get('dalvik.vm.gctype', 'unset');
            if (gctype === 'CC') {
                log('dalvik.vm.gctype=CC (restart Zygote for this to apply if not already done)');
            } else {
                warn('dalvik.vm.gctype=' + gctype + ' — run: adb shell setprop dalvik.vm.gctype CC && adb shell stop && adb shell start');
            }
        } catch(e) {}

        // ── Delay automatic GC triggers ─────────────────────────────────────
        // Push heap utilization threshold to near-max so the allocator waits
        // as long as possible before triggering a GC cycle automatically.
        // This buys time even when Zygote hasn't been restarted yet.
        // NEVER call System.gc() here — that actively triggers the crash.
        try {
            Java.use('dalvik.system.VMRuntime').getRuntime().setTargetHeapUtilization(0.99);
            log('heap utilization → 0.99 (delays automatic GC)');
        } catch(e) {}
    })();

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — Block all Java kill/exit vectors + print stack traces
// ─────────────────────────────────────────────────────────────────────────────
    Java.use('java.lang.System').exit.implementation = function(code) {
        warn('System.exit(' + code + ') BLOCKED');
        stackTrace('System.exit');
    };

    var RT = Java.use('java.lang.Runtime');
    RT.exit.implementation = function(code) {
        warn('Runtime.exit(' + code + ') BLOCKED');
        stackTrace('Runtime.exit');
    };
    try {
        RT.halt.implementation = function(code) {
            warn('Runtime.halt(' + code + ') BLOCKED');
            stackTrace('Runtime.halt');
        };
    } catch(_) {}

    try {
        var Proc = Java.use('android.os.Process');
        Proc.killProcess.implementation = function(pid) {
            warn('Process.killProcess(' + pid + ') BLOCKED');
            stackTrace('Process.killProcess');
        };
        Proc.sendSignal.implementation = function(pid, sig) {
            warn('Process.sendSignal(' + pid + ',' + sig + ') BLOCKED');
            stackTrace('Process.sendSignal');
        };
    } catch(_) {}

    log('layer 1: exit/kill hooks installed');

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — Root detection bypass
// ─────────────────────────────────────────────────────────────────────────────
    var HIDDEN_PATHS = [
        '/system/xbin/su', '/system/bin/su', '/sbin/su',
        '/data/local/xbin/su', '/data/local/bin/su', '/data/local/tmp/su',
        '/system/app/Superuser.apk', '/system/app/SuperSU',
        '/system/xbin/busybox', '/system/bin/busybox',
        '/data/adb/magisk', '/sbin/.magisk', '/sbin/.core',
        '/data/local/tmp/frida-server', '/data/local/tmp/frida-server64',
        '/data/local/tmp/re.frida.server', '/data/local/tmp/fs-helper-64',
    ];

    function isSensitivePath(path) {
        // Never block Frida's own temp DEX files — blocking them causes
        // Java.registerClass() to fail with a partial class object that
        // later segfaults ART's MarkCompact GC in HeapTaskDaemon.
        if (path.endsWith('.dex') || path.endsWith('.odex') || path.endsWith('.vdex')) return false;
        var lp = path.toLowerCase();
        for (var i = 0; i < HIDDEN_PATHS.length; i++) {
            if (path === HIDDEN_PATHS[i]) return true;
        }
        return lp.indexOf('magisk') !== -1 || lp.indexOf('frida') !== -1 ||
               lp.indexOf('supersu') !== -1 || lp.indexOf('superuser') !== -1 ||
               lp.indexOf('/xbin/') !== -1;
    }

    var File        = Java.use('java.io.File');
    var _fileExists = File.exists;
    var _canExecute = File.canExecute;
    var _canRead    = File.canRead;

    File.exists.implementation = function() {
        if (isSensitivePath(this.getAbsolutePath())) {
            log('File.exists spoofed false: ' + this.getAbsolutePath());
            return false;
        }
        return _fileExists.call(this);
    };

    // Fixed vs v1: call saved original _canExecute, not this.canExecute() (infinite recursion)
    File.canExecute.implementation = function() {
        var path = this.getAbsolutePath();
        if (isSensitivePath(path) || path.indexOf('/su') !== -1) return false;
        return _canExecute.call(this);
    };

    File.canRead.implementation = function() {
        if (isSensitivePath(this.getAbsolutePath())) return false;
        return _canRead.call(this);
    };

    // Runtime.exec — redirect root-probing commands to harmless echo
    var BLOCKED_CMDS = [
        'su ', 'which su', 'busybox', 'id ', 'whoami', 'id\n',
        '/system/xbin', '/system/bin/su',
        'kill -9', 'kill -15', 'kill -KILL', 'kill -TERM', 'kill -',
    ];
    function isBlockedCmd(cmd) {
        for (var i = 0; i < BLOCKED_CMDS.length; i++) {
            if (cmd.indexOf(BLOCKED_CMDS[i]) !== -1) return true;
        }
        return false;
    }

    var _execStr   = RT.exec.overload('java.lang.String');
    var _execArr   = RT.exec.overload('[Ljava.lang.String;');
    var _execArrEP = RT.exec.overload('[Ljava.lang.String;', '[Ljava.lang.String;', 'java.io.File');

    _execStr.implementation = function(cmd) {
        if (isBlockedCmd(cmd)) {
            log('Runtime.exec blocked: ' + cmd);
            return _execStr.call(this, 'echo');
        }
        return _execStr.call(this, cmd);
    };
    _execArr.implementation = function(cmds) {
        var joined = cmds.join(' ');
        if (isBlockedCmd(joined)) {
            log('Runtime.exec[] blocked: ' + joined);
            return _execArr.call(this, Java.array('java.lang.String', ['echo']));
        }
        return _execArr.call(this, cmds);
    };
    _execArrEP.implementation = function(cmds, envp, dir) {
        var joined = cmds.join(' ');
        if (isBlockedCmd(joined)) {
            log('Runtime.exec[]+env blocked: ' + joined);
            return _execArr.call(this, Java.array('java.lang.String', ['echo']));
        }
        return _execArrEP.call(this, cmds, envp, dir);
    };

    // Build.TAGS — "test-keys" is a root signal
    try {
        Java.use('android.os.Build').TAGS.value = 'release-keys';
        log('Build.TAGS spoofed');
    } catch(_) {}

    // SELinux — permissive mode = rooted
    try {
        var SELinux = Java.use('android.os.SELinux');
        SELinux.isSELinuxEnabled.implementation  = function() { return true; };
        SELinux.isSELinuxEnforced.implementation = function() { return true; };
    } catch(_) {}

    // PackageManager — hide Magisk / root manager packages
    var ROOT_PKGS = [
        'com.topjohnwu.magisk', 'eu.chainfire.supersu', 'com.noshufou.android.su',
        'com.koushikdutta.rommanager', 'me.weishu.kernelsu', 'me.bmax.apatch',
        'com.zachspong.temprootremovejb', 'com.ramdroid.appquarantine',
    ];
    try {
        var PM = Java.use('android.app.ApplicationPackageManager');
        var NNFEx = Java.use('android.content.pm.PackageManager$NameNotFoundException');
        PM.getPackageInfo.overload('java.lang.String', 'int').implementation = function(pkg, flags) {
            if (ROOT_PKGS.indexOf(pkg) !== -1) {
                log('PackageManager blocked: ' + pkg);
                throw NNFEx.$new(pkg);
            }
            return this.getPackageInfo(pkg, flags);
        };
        // Android 13+ long-flags overload
        try {
            PM.getPackageInfo.overload('java.lang.String', 'android.content.pm.PackageManager$PackageInfoFlags')
                .implementation = function(pkg, flags) {
                    if (ROOT_PKGS.indexOf(pkg) !== -1) {
                        log('PackageManager(long) blocked: ' + pkg);
                        throw NNFEx.$new(pkg);
                    }
                    return this.getPackageInfo(pkg, flags);
                };
        } catch(_) {}
    } catch(_) {}

    log('layer 2: root detection bypass installed');

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 3 — Frida detection bypass
// ─────────────────────────────────────────────────────────────────────────────

    // BufferedReader.readLine — strip Frida-related /proc/maps lines
    try {
        var BR = Java.use('java.io.BufferedReader');
        var FRIDA_WORDS = ['frida', 'gum-js-loop', 'gmain-frida', 're.frida', 'linjector', 'fs-helper'];
        var _readLine = BR.readLine.overload();
        _readLine.implementation = function() {
            var line = _readLine.call(this);
            if (line !== null) {
                var ll = line.toLowerCase();
                // Strip frida artifacts from /proc/self/maps
                for (var i = 0; i < FRIDA_WORDS.length; i++) {
                    if (ll.indexOf(FRIDA_WORDS[i]) !== -1) return '';
                }
                // Spoof TracerPid in /proc/self/status (non-zero = debugger/tracer attached)
                if (line.indexOf('TracerPid:') !== -1) {
                    return 'TracerPid:\t0';
                }
            }
            return line;
        };
    } catch(_) {}

    // Block Java socket connects to frida-server port
    try {
        var Socket = Java.use('java.net.Socket');
        var _sockConnect = Socket.connect.overload('java.net.SocketAddress', 'int');
        _sockConnect.implementation = function(addr, timeout) {
            try {
                var port = addr.getPort ? addr.getPort() : -1;
                if (port === 27042 || port === 27043) {
                    log('Socket.connect to frida port ' + port + ' BLOCKED');
                    throw Java.use('java.net.ConnectException').$new('Connection refused');
                }
            } catch(inner) {
                if (inner.getMessage && inner.getMessage().indexOf('BLOCKED') !== -1) throw inner;
            }
            return _sockConnect.call(this, addr, timeout);  // saved original — avoids re-entrant hook loop
        };
    } catch(_) {}

    try {
        Java.use('android.os.Debug').isDebuggerConnected.implementation = function() { return false; };
    } catch(_) {}

    log('layer 3: frida detection bypass installed');

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 4 — Full SSL/TLS bypass
// v2 adds the Conscrypt deep hooks (checkTrustedRecursive, verifyChain,
// OpenSSLSocketImpl) that were missing from v1 and caused pinning to slip through.
// v3 fixes checkTrusted to return empty ArrayList instead of null (prevents NPE
// cascade in OkHttp dispatcher thread when caller calls .size()/.isEmpty()).
// ─────────────────────────────────────────────────────────────────────────────

    var ArrayList = Java.use('java.util.ArrayList');

    // ── Conscrypt TrustManagerImpl — deep chain validation hooks ─────────────
    try {
        var TMI = Java.use('com.android.org.conscrypt.TrustManagerImpl');

        try {
            TMI.checkTrustedRecursive.implementation = function() {
                log('TMI.checkTrustedRecursive bypassed');
                return ArrayList.$new();
            };
        } catch(_) {}

        try {
            TMI.verifyChain.implementation = function(untrustedChain, trustAnchorChain, host) {
                log('TMI.verifyChain bypassed: ' + host);
                return untrustedChain;
            };
        } catch(_) {}

        try {
            TMI.checkServerTrusted.overloads.forEach(function(ol) {
                ol.implementation = function() {
                    log('TMI.checkServerTrusted bypassed');
                    if (ol.returnType.name !== 'void') return ArrayList.$new();
                };
            });
        } catch(_) {}

        // Change 8: return empty ArrayList instead of null to prevent NPE in
        // downstream OkHttp dispatcher code that calls .size()/.isEmpty() on result.
        try {
            TMI.checkTrusted.overloads.forEach(function(ol) {
                ol.implementation = function() {
                    log('TMI.checkTrusted bypassed (empty list)');
                    return ArrayList.$new();
                };
            });
        } catch(_) {}

        log('TrustManagerImpl deep hooks installed');
    } catch(e) { warn('TrustManagerImpl not found: ' + e.message); }

    // ── Conscrypt OpenSSL socket-level verification ───────────────────────────
    try {
        Java.use('com.android.org.conscrypt.OpenSSLSocketImpl')
            .verifyCertificateChain.implementation = function() {
                log('OpenSSLSocketImpl.verifyCertificateChain bypassed');
            };
    } catch(_) {}

    try {
        Java.use('com.android.org.conscrypt.OpenSSLEngineSocketImpl')
            .verifyCertificateChain.overload('[Ljava.lang.Long;', 'java.lang.String')
            .implementation = function(a, b) {
                log('OpenSSLEngineSocketImpl.verifyCertificateChain bypassed: ' + b);
            };
    } catch(_) {}

    // ── Conscrypt CertPinManager ──────────────────────────────────────────────
    try {
        Java.use('com.android.org.conscrypt.CertPinManager')
            .isChainValid.overload('java.lang.String', 'java.util.List')
            .implementation = function(a) {
                log('CertPinManager.isChainValid bypassed: ' + a);
                return true;
            };
    } catch(_) {}

    // ── OkHttp3 CertificatePinner ─────────────────────────────────────────────
    try {
        var CP3 = Java.use('okhttp3.CertificatePinner');
        CP3.check.overload('java.lang.String', 'java.util.List').implementation = function(host) {
            log('OkHttp3.CertificatePinner.check: ' + host);
        };
        try {
            CP3.check.overload('java.lang.String', '[Ljava.security.cert.Certificate;').implementation = function() {};
        } catch(_) {}
        // Kotlin-compiled variant — method name contains $
        try {
            CP3['check$okhttp'].implementation = function(a) {
                log('OkHttp3.check$okhttp bypassed: ' + a);
            };
        } catch(_) {}
    } catch(_) {}

    // ── OkHttpClient$Builder — drop any custom SSL factory the app installs ───
    try {
        Java.use('okhttp3.OkHttpClient$Builder')
            .sslSocketFactory.overload('javax.net.ssl.SSLSocketFactory', 'javax.net.ssl.X509TrustManager')
            .implementation = function() {
                log('OkHttpClient$Builder.sslSocketFactory intercepted — using TrustAll');
                return this;
            };
    } catch(_) {}

    // ── Legacy OkHttp (squareup / android platform) ───────────────────────────
    ['com.squareup.okhttp.CertificatePinner', 'com.android.okhttp.CertificatePinner'].forEach(function(cls) {
        try {
            var C = Java.use(cls);
            C.check.overloads.forEach(function(ol) {
                ol.implementation = function() { log(cls + ' bypassed'); };
            });
        } catch(_) {}
    });

    // ── OkHttp hostname verifiers ─────────────────────────────────────────────
    ['okhttp3.internal.tls.OkHostnameVerifier',
     'com.android.okhttp.internal.tls.OkHostnameVerifier',
     'com.squareup.okhttp.internal.tls.OkHostnameVerifier'].forEach(function(cls) {
        try {
            Java.use(cls).verify.overload('java.lang.String', 'javax.net.ssl.SSLSession')
                .implementation = function() { return true; };
        } catch(_) {}
    });

    // ── NetworkSecurityConfig pin checker ─────────────────────────────────────
    try {
        Java.use('android.security.net.config.NetworkSecurityTrustManager')
            .checkPins.implementation = function() {
                log('NSConfig.checkPins bypassed');
            };
    } catch(_) {}

    // ── HttpsURLConnection ────────────────────────────────────────────────────
    try {
        var HTTPS = Java.use('javax.net.ssl.HttpsURLConnection');
        HTTPS.setDefaultHostnameVerifier.implementation = function() {};
        HTTPS.setSSLSocketFactory.implementation = function() {};
        HTTPS.setHostnameVerifier.implementation = function() {};
    } catch(_) {}

    // ── WebView SSL ───────────────────────────────────────────────────────────
    try {
        Java.use('android.webkit.WebViewClient')
            .onReceivedSslError.overload(
                'android.webkit.WebView',
                'android.webkit.SslErrorHandler',
                'android.net.http.SslError'
            ).implementation = function(view, handler, error) {
                log('WebView SSL error bypassed');
                handler.proceed();
            };
    } catch(_) {}

    // ── TrustKit ──────────────────────────────────────────────────────────────
    try {
        Java.use('com.datatheorem.android.trustkit.pinning.OkHostnameVerifier')
            .verify.overload('java.lang.String', 'javax.net.ssl.SSLSession')
            .implementation = function() { return true; };
    } catch(_) {}
    try {
        Java.use('com.datatheorem.android.trustkit.pinning.PinningTrustManager')
            .checkServerTrusted.implementation = function() {};
    } catch(_) {}

    // ── SSLPeerUnverifiedException auto-patcher ───────────────────────────────
    // Surfaces the throwing class when an unknown pinning mechanism slips through
    try {
        var SSLPeer = Java.use('javax.net.ssl.SSLPeerUnverifiedException');
        SSLPeer.$init.implementation = function(str) {
            warn('SSLPeerUnverifiedException: ' + str);
            try {
                var frames = Java.use('java.lang.Thread').currentThread().getStackTrace();
                for (var i = 0; i < frames.length; i++) {
                    if (frames[i].getClassName().indexOf('SSLPeerUnverifiedException') >= 0 &&
                            i + 1 < frames.length) {
                        warn('  thrown by: ' + frames[i+1].getClassName() + '.' + frames[i+1].getMethodName());
                        warn('  -- hook that class to fix remaining pinning');
                        break;
                    }
                }
            } catch(_) {}
            return this.$init(str);
        };
    } catch(_) {}

    // ── Nuclear fallback: SSLContext.init hook (no Java.registerClass — crashes ART MarkCompact GC) ──
    // checkTrustedRecursive + verifyChain above cover all real pinning paths.
    // This catches any remaining raw SSLContext.init() call that installs a custom TM.
    try {
        var SSLCtx     = Java.use('javax.net.ssl.SSLContext');
        var _sslInit   = SSLCtx.init;          // save original — calling this.init() re-enters the hook
        _sslInit.implementation = function(km, tms, sr) {
            log('SSLContext.init intercepted — dropping custom TrustManagers');
            _sslInit.call(this, null, null, null);  // call saved original, not this.init (infinite recursion)
        };
        log('SSLContext.init intercepted');
    } catch(e) { warn('SSLContext.init hook failed: ' + e); }

    log('layer 4: SSL/TLS full bypass complete');

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 5 — ProxySelector: force all traffic through mitmdump
// Reads /data/local/tmp/frida_proxy_config.json — same config the universal
// unpin writes. Falls back to 172.16.1.155:8080 (sniff default).
// ─────────────────────────────────────────────────────────────────────────────
    (function() {
        var PROXY_HOST = '172.16.1.155';
        var PROXY_PORT = 8080;

        try {
            var FR = Java.use('java.io.FileReader');
            var BRP = Java.use('java.io.BufferedReader');
            var configs = [
                '/data/local/tmp/frida_proxy_config.json',
                '/tmp/frida_proxy_config.json'
            ];
            for (var cp = 0; cp < configs.length; cp++) {
                try {
                    var reader = BRP.$new(FR.$new(configs[cp]));
                    var cfgLine = reader.readLine();
                    reader.close();
                    if (cfgLine) {
                        var cs = cfgLine.toString();
                        var hm = cs.match(/"host":"([^"]+)"/);
                        var pm = cs.match(/"port":(\d+)/);
                        if (hm) PROXY_HOST = hm[1];
                        if (pm) PROXY_PORT = parseInt(pm[1]);
                        log('proxy config: ' + PROXY_HOST + ':' + PROXY_PORT);
                        break;
                    }
                } catch(_) {}
            }
        } catch(_) {}

        var ProxyCls     = Java.use('java.net.Proxy');
        var ProxyType    = Java.use('java.net.Proxy$Type');
        var InetSockAddr = Java.use('java.net.InetSocketAddress');

        function makeProxyList() {
            var addr  = InetSockAddr.$new(PROXY_HOST, PROXY_PORT);
            var proxy = ProxyCls.$new(ProxyType.HTTP.value, addr);
            var list  = ArrayList.$new();
            list.add(proxy);
            return list;
        }

        // System ProxySelector
        try {
            var PS = Java.use('java.net.ProxySelector');
            var dps = PS.getDefault();
            if (dps !== null) {
                var PSClass = Java.use(dps.$className);
                PSClass.select.implementation = function(uri) {
                    return makeProxyList();
                };
                log('ProxySelector hooked (' + dps.$className + ')');
            }
        } catch(e) { warn('ProxySelector failed: ' + e.message); }

        // OkHttp3 proxy override
        try {
            Java.use('okhttp3.OkHttpClient$Builder')
                .proxy.overload('java.net.Proxy')
                .implementation = function(p) {
                    var addr  = InetSockAddr.$new(PROXY_HOST, PROXY_PORT);
                    return this.proxy(ProxyCls.$new(ProxyType.HTTP.value, addr));
                };
        } catch(_) {}

    })();

    log('layer 5: proxy routing installed');

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 6 — Response body rewriter
// Patches security verdict fields in JSON responses so the app never reads
// a "blocked / integrity failed / rooted" verdict from its own backend.
// The logger portion surfaces which endpoint is doing the check so you can
// refine the patch patterns below.
// ─────────────────────────────────────────────────────────────────────────────
    (function() {

        var PATCHES = [
            // Boolean block flags
            [/"blocked"\s*:\s*true/g,              '"blocked":false'],
            [/"isBlocked"\s*:\s*true/g,            '"isBlocked":false'],
            [/"appBlocked"\s*:\s*true/g,           '"appBlocked":false'],
            [/"deviceBlocked"\s*:\s*true/g,        '"deviceBlocked":false'],

            // Root / tamper / debug booleans
            [/"rootDetected"\s*:\s*true/g,         '"rootDetected":false'],
            [/"tampered"\s*:\s*true/g,             '"tampered":false'],
            [/"jailbreak"\s*:\s*true/g,            '"jailbreak":false'],
            [/"isRooted"\s*:\s*true/g,             '"isRooted":false'],
            [/"isEmulator"\s*:\s*true/g,           '"isEmulator":false'],
            [/"debugMode"\s*:\s*true/g,            '"debugMode":false'],
            [/"hookedProcess"\s*:\s*true/g,        '"hookedProcess":false'],

            // Verdict / status strings
            [/"integrityVerdict"\s*:\s*"FAIL[^"]*"/gi,   '"integrityVerdict":"PASS"'],
            [/"deviceStatus"\s*:\s*"BLOCKED[^"]*"/gi,    '"deviceStatus":"OK"'],
            [/"deviceAttestation"\s*:\s*"FAIL[^"]*"/gi,  '"deviceAttestation":"PASS"'],
            [/"appStatus"\s*:\s*"BLOCKED[^"]*"/gi,       '"appStatus":"ALLOWED"'],
            [/"status"\s*:\s*"BLOCKED[^"]*"/gi,          '"status":"OK"'],
            [/"securityStatus"\s*:\s*"FAIL[^"]*"/gi,     '"securityStatus":"PASS"'],
            [/"verdict"\s*:\s*"FAIL[^"]*"/gi,            '"verdict":"PASS"'],
            [/"deviceIntegrity"\s*:\s*"FAIL[^"]*"/gi,    '"deviceIntegrity":"PASS"'],

            // Error code / reason nullifiers
            [/"blockReason"\s*:\s*"[^"]+"/g,             '"blockReason":""'],
            [/"errorCode"\s*:\s*"ROOT[^"]*"/gi,          '"errorCode":""'],
            [/"errorCode"\s*:\s*"TAMPER[^"]*"/gi,        '"errorCode":""'],

            // Play Integrity verdict labels
            [/NO_INTEGRITY/g,                            'MEETS_STRONG_INTEGRITY'],
            [/UNEVALUATED_INTEGRITY/g,                   'MEETS_STRONG_INTEGRITY'],
            [/MEETS_DEVICE_INTEGRITY/g,                  'MEETS_STRONG_INTEGRITY'],
        ];

        var SEC_KEYWORDS = [
            'block', 'integr', 'attest', 'root', 'tamper', 'jailbreak',
            'secur', 'trust', 'unsafe', 'verdict', 'device_check',
            // InAuth / risk-api terms
            'inauth', 'risk', 'deny', 'denied', 'decision', 'score',
            'threat', 'fraud', 'allow', 'legitimate', 'suspicious',
            'DENY', 'ALLOW', 'BLOCK', 'PASS', 'FAIL',
        ];

        // Domains whose responses we ALWAYS log in full regardless of keyword match.
        // Lets us see the exact InAuth verdict format without guessing keywords.
        var ALWAYS_LOG_DOMAINS = ['inauth.com', 'risk-api', 'attest', 'integrity'];

        function hasSecKeyword(s) {
            var l = s.toLowerCase();
            for (var i = 0; i < SEC_KEYWORDS.length; i++) {
                if (l.indexOf(SEC_KEYWORDS[i]) !== -1) return true;
            }
            return false;
        }

        function applyPatches(body) {
            var out = body;
            for (var i = 0; i < PATCHES.length; i++) {
                out = out.replace(PATCHES[i][0], PATCHES[i][1]);
            }
            return out;
        }

        // Lightweight URL tracker — hook Request.url() as a pure getter (no body read,
        // no JNI frame, no GC issue) so ResponseBody.string() knows which domain it's on.
        var _lastUrl = '';
        try {
            var ReqCls = Java.use('okhttp3.Request');
            var _reqUrl = ReqCls.url;
            _reqUrl.implementation = function() {
                var u = _reqUrl.call(this);
                try { _lastUrl = u.toString(); } catch(_) {}
                return u;
            };
        } catch(_) {}

        function isAlwaysLogDomain(url) {
            for (var i = 0; i < ALWAYS_LOG_DOMAINS.length; i++) {
                if (url.indexOf(ALWAYS_LOG_DOMAINS[i]) !== -1) return true;
            }
            return false;
        }

        // Hook ResponseBody.string() — pure Java method, no JNI frame crossing.
        try {
            var RBCls  = Java.use('okhttp3.ResponseBody');
            var _rbStr = RBCls.string;
            _rbStr.implementation = function() {
                var body = _rbStr.call(this);
                if (body === null || body.length === 0) return body;

                var alwaysLog = isAlwaysLogDomain(_lastUrl);
                var patched   = applyPatches(body);

                if (patched !== body) {
                    warn('PATCHED response body from: ' + _lastUrl);
                    warn('    BEFORE: ' + body.substring(0, 400));
                    warn('    AFTER:  ' + patched.substring(0, 400));
                } else if (alwaysLog || hasSecKeyword(body)) {
                    warn('SECURITY body from: ' + _lastUrl);
                    warn('    ' + body.substring(0, 800));
                    if (alwaysLog) warn('    (no patch matched — add pattern if this is the verdict)');
                }
                return patched;
            };
            log('ResponseBody.string() patcher installed');
        } catch(e) { warn('ResponseBody.string hook failed: ' + e.message); }

        // Also hook ResponseBody.bytes() — InAuth SDK may read response as byte array
        try {
            var _rbBytes = Java.use('okhttp3.ResponseBody').bytes;
            _rbBytes.implementation = function() {
                var bytes = _rbBytes.call(this);
                if (bytes === null) return bytes;
                try {
                    var str = Java.use('java.lang.String').$new(bytes, 'UTF-8');
                    if (isAlwaysLogDomain(_lastUrl) || hasSecKeyword(str)) {
                        warn('SECURITY bytes() body from: ' + _lastUrl);
                        warn('    ' + str.substring(0, 600));
                    }
                } catch(_) {}
                return bytes;
            };
        } catch(_) {}

    })();

    log('layer 6: ResponseBody.string() rewriter installed');

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 7 — Play Integrity / SafetyNet intercept
// The attestation token itself is Google-signed so we can't forge it.
// The backend verdict response comes back through OkHttp and is handled by
// Layer 6. This layer logs which API path the app is using.
// ─────────────────────────────────────────────────────────────────────────────

    try {
        Java.use('com.google.android.play.integrity.IntegrityTokenRequest');
        warn('Play Integrity API (Classic) present -- backend verdict will be patched by Layer 6');
    } catch(_) {}

    try {
        Java.use('com.google.android.play.integrity.StandardIntegrityManager$StandardIntegrityTokenRequest');
        warn('Play Integrity API (Standard v2) present');
    } catch(_) {}

    try {
        var SN = Java.use('com.google.android.gms.safetynet.SafetyNetClient');
        SN.attest.implementation = function(nonce, apiKey) {
            warn('SafetyNet.attest() fired -- backend verdict will be patched by Layer 6');
            return this.attest(nonce, apiKey);
        };
    } catch(_) {}

    log('layer 7: integrity detection installed');

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 8 — Diagnostics
// ─────────────────────────────────────────────────────────────────────────────

    // AlertDialog tap — capture exact security message before app can show it
    try {
        var ADB = Java.use('android.app.AlertDialog$Builder');
        ADB.setMessage.overload('java.lang.CharSequence').implementation = function(msg) {
            warn('AlertDialog.setMessage: "' + msg + '"');
            stackTrace('AlertDialog');
            return this.setMessage(msg);
        };
        ADB.setTitle.overload('java.lang.CharSequence').implementation = function(title) {
            warn('AlertDialog.setTitle: "' + title + '"');
            return this.setTitle(title);
        };
    } catch(_) {}

    try {
        var Dlg = Java.use('android.app.Dialog');
        Dlg.show.implementation = function() {
            warn('Dialog.show: ' + this.$className);
            this.show();
        };
    } catch(_) {}

    // Deferred class scan — surface unknown RASP / integrity SDKs
    setTimeout(function() {
        try {
            Java.perform(function() {
                var found = [];
                Java.enumerateLoadedClasses({
                    onMatch: function(name) {
                        var ln = name.toLowerCase();
                        if ((ln.indexOf('integrity') !== -1 || ln.indexOf('attest') !== -1 ||
                             ln.indexOf('talsec') !== -1    || ln.indexOf('promon') !== -1 ||
                             ln.indexOf('approov') !== -1   || ln.indexOf('rasp') !== -1   ||
                             ln.indexOf('freerasp') !== -1  || ln.indexOf('shield') !== -1) &&
                             name.indexOf('java.') === -1   && name.indexOf('android.security') === -1) {
                            found.push(name);
                        }
                    },
                    onComplete: function() {
                        if (found.length > 0) {
                            warn('security SDK classes (' + found.length + '):');
                            found.forEach(function(n) { warn('  ' + n); });
                        } else {
                            log('class scan: no unknown security SDK classes');
                        }
                    }
                });
            });
        } catch(_) {}
    }, 4000);

    log('layer 8: diagnostics installed');

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 9 — Marriott obfuscated kill chain (mfWkY6 / dWW8n3 / anonymous Runnables)
//
// Hook installation order (change 10 — installed before Handler.post/postDelayed
// which are now LOG-ONLY, so SDK init Runnables reach the Looper):
//   1. mfWkY6.nfSje9   — kill dispatcher (must be first)
//   2. dWW8n3.nfSje9
//   3. dWW8n3.rZnSm1
//   4. mfWkY6$3.run    — call-through (restores coordinator init; nfSje9 absorbs kill)
//   5. mfWkY6$1/$2/$4/$5+ sweep — call-through (closes anonymous Runnable gap)
//   6. mfWkY6.gb6qx6   — onResume callback; log-only no-op for observability
//   7. iVj4h1 outer class probe
// ─────────────────────────────────────────────────────────────────────────────

    // ── 1. mfWkY6.nfSje9 — kill dispatcher ───────────────────────────────────
    try {
        var mfWkY6 = Java.use('h4Yqt3.iVj4h1.mfWkY6');
        mfWkY6.nfSje9.overloads.forEach(function(ov) {
            ov.implementation = function() {
                warn('mfWkY6.nfSje9 BLOCKED (kill dispatcher)');
                var _rt = ov.returnType.name; if (_rt !== 'void' && _rt !== 'V') return null;
            };
        });
        log('kill-chain hook: h4Yqt3.iVj4h1.mfWkY6.nfSje9');
    } catch(ex) { log('kill-chain hook failed (mfWkY6.nfSje9): ' + ex.message); }

    // ── 2+3. dWW8n3.nfSje9 and dWW8n3.rZnSm1 ────────────────────────────────
    try {
        var dWW8n3 = Java.use('h4Yqt3.iVj4h1.dWW8n3');
        ['nfSje9', 'rZnSm1'].forEach(function(name) {
            try {
                dWW8n3[name].overloads.forEach(function(ov) {
                    ov.implementation = function() {
                        warn('dWW8n3.' + name + ' BLOCKED');
                        var _rt = ov.returnType.name; if (_rt !== 'void' && _rt !== 'V') return null;
                    };
                });
                log('kill-chain hook: h4Yqt3.iVj4h1.dWW8n3.' + name);
            } catch(inner) { log('kill-chain hook failed (dWW8n3.' + name + '): ' + inner.message); }
        });
    } catch(ex) { log('kill-chain hook failed (dWW8n3): ' + ex.message); }

    // ── 4. mfWkY6$3.run — call-through (change 5: was no-op, now call-through) ──
    // Swallowing run() caused Crash 4 — coordinator singleton was never initialized.
    // With nfSje9 already hooked above, calling through completes init and the kill
    // dispatch is silently discarded inside nfSje9.
    try {
        var mfWkY6_3 = Java.use('h4Yqt3.iVj4h1.mfWkY6$3');
        mfWkY6_3.run.overloads.forEach(function(ov) {
            ov.implementation = function() {
                log('mfWkY6$3.run call-through (init allowed; kill absorbed by nfSje9)');
                return ov.call(this);
            };
        });
        log('kill-chain hook: h4Yqt3.iVj4h1.mfWkY6$3.run (call-through)');
    } catch(ex) { log('kill-chain hook failed (mfWkY6$3.run): ' + ex.message); }

    // ── 5. Anonymous inner Runnable sweep: $1, $2, $4, $5+ ───────────────────
    // $2 is NO-OP: mfWkY6$2.run() dereferences the SDK coordinator at offset 0x44
    // before it is initialized → SIGSEGV DoCall+164. No-opping it prevents the
    // native crash. The SDK reaches InAuth without $2 firing (confirmed run 4).
    // All other numbered Runnables remain call-through; nfSje9 absorbs any kill.
    [1, 2, 4, 5, 6, 7, 8].forEach(function(n) {
        var cname = 'h4Yqt3.iVj4h1.mfWkY6$' + n;
        try {
            var cls = Java.use(cname);
            if (cls.run) {
                cls.run.overloads.forEach(function(ov) {
                    var isTwo = (n === 2);
                    ov.implementation = function() {
                        if (isTwo) {
                            warn('mfWkY6$2.run NO-OP (null deref guard — coordinator not ready)');
                            // Void return — no explicit return needed; guard below for safety
                            var _rt2 = ov.returnType.name;
                            if (_rt2 !== 'void' && _rt2 !== 'V') return null;
                            return;
                        }
                        log('mfWkY6$' + n + '.run call-through');
                        return ov.call(this);
                    };
                });
                log('kill-chain hook: ' + cname + '.run (' + (n === 2 ? 'no-op' : 'call-through') + ')');
            }
        } catch(e) {
            // Class does not exist in this build — skip silently
        }
    });

    // ── 6. mfWkY6.gb6qx6 — onResume lifecycle callback ───────────────────────
    // MUST remain no-op. When called through, gb6qx6 posts mfWkY6$2 ×9 onto the
    // Handler queue. Those Runnables fire while the SDK coordinator is still null
    // → SIGSEGV in DoCall+164 (null deref at offset 0x44) before InAuth is even
    // contacted. With gb6qx6 as no-op, the app runs cleanly all the way to
    // risk-api.inauth.com (confirmed run 4). The Frida 17 'V' return-type guard
    // below ensures no "expected return value compatible with void" error.
    try {
        var mfWkY6_gb = Java.use('h4Yqt3.iVj4h1.mfWkY6');
        mfWkY6_gb.gb6qx6.overloads.forEach(function(ov) {
            ov.implementation = function() {
                warn('mfWkY6.gb6qx6 fired (onResume — NO-OP; call-through causes $2 null deref)');
                // No explicit return → Frida treats as void. returnType.name is 'V' in Frida 17.
                var _rt = ov.returnType.name; if (_rt !== 'void' && _rt !== 'V') return null;
            };
        });
        log('kill-chain hook: h4Yqt3.iVj4h1.mfWkY6.gb6qx6 (no-op + warn)');
    } catch(ex) { log('kill-chain hook failed (mfWkY6.gb6qx6): ' + ex.message); }

    // ── 7. iVj4h1 outer class probe (change 7) ────────────────────────────────
    try {
        var iVj4h1_outer = Java.use('h4Yqt3.iVj4h1.iVj4h1');
        try {
            if (iVj4h1_outer.nfSje9) {
                iVj4h1_outer.nfSje9.overloads.forEach(function(ov) {
                    ov.implementation = function() {
                        warn('iVj4h1.nfSje9 BLOCKED (outer class kill method)');
                        var _rt = ov.returnType.name; if (_rt !== 'void' && _rt !== 'V') return null;
                    };
                });
                log('kill-chain hook: h4Yqt3.iVj4h1.iVj4h1.nfSje9');
            }
        } catch(inner) { log('iVj4h1 outer nfSje9 probe: ' + inner.message); }
    } catch(e) {
        // Outer class not present as a standalone class file — skip silently
    }

    // ── Handler.post / postDelayed — LOG-ONLY (change 1: was BLOCK, now log+passthrough) ──
    // Removing the filter unblocks SDK init Runnables so the coordinator singleton
    // is constructed before gb6qx6 fires. Kill Runnables are now handled by the
    // direct nfSje9 / rZnSm1 hooks above (changes 2-5), so blocking at the Handler
    // level is no longer needed and was causing Crash 4.
    try {
        var Handler = Java.use('android.os.Handler');

        var _post = Handler.post.overload('java.lang.Runnable');
        _post.implementation = function(r) {
            if (r !== null) {
                var cls = r.$className;
                if (cls.indexOf('h4Yqt3') !== -1 || cls.indexOf('iVj4h1') !== -1) {
                    warn('Handler.post LOG (security Runnable, no longer blocked): ' + cls);
                }
            }
            return _post.call(this, r);
        };

        var _postDelayed = Handler.postDelayed.overload('java.lang.Runnable', 'long');
        _postDelayed.implementation = function(r, delay) {
            if (r !== null) {
                var cls = r.$className;
                if (cls.indexOf('h4Yqt3') !== -1 || cls.indexOf('iVj4h1') !== -1) {
                    warn('Handler.postDelayed LOG (' + delay + 'ms, no longer blocked): ' + cls);
                }
            }
            return _postDelayed.call(this, r, delay);
        };

        log('Handler.post/postDelayed h4Yqt3 log-only observer installed');
    } catch(e) { warn('Handler observer: ' + e); }

    log('layer 9: Marriott kill chain hooks installed');

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 10 — Native watchdog suppression via loadLibrary0 probe (change 9)
// Intercepts System/Runtime library loads to find and suppress any native
// _exit / watchdog symbols exported by the Marriott SDK's own .so files.
// Safe vs Crash 2 (peekBody JNI PushLocalFrame): Interceptor.replace targets
// symbols inside the SDK's own .so (not libc), on a pure-native pthread that
// has never entered the ART runtime — no GC frames to corrupt.
// ─────────────────────────────────────────────────────────────────────────────
    try {
        var RuntimeL = Java.use('java.lang.Runtime');
        RuntimeL.loadLibrary0.overloads.forEach(function(ov) {
            ov.implementation = function() {
                var args = Array.prototype.slice.call(arguments);
                // Call through first so the library is resident before probing
                var result = ov.apply(this, args);

                // Extract library name from the last string argument
                var libname = null;
                for (var i = args.length - 1; i >= 0; i--) {
                    if (typeof args[i] === 'string') { libname = args[i]; break; }
                    // Java String object
                    try { if (args[i] && args[i].toString) { libname = args[i].toString(); break; } } catch(_) {}
                }

                if (libname) {
                    var soname = 'lib' + libname + '.so';
                    var mod = Process.findModuleByName(soname);
                    if (mod) {
                        log('loadLibrary0: probing ' + soname + ' for watchdog exports');

                        // Safe export enumeration — read-only, no Interceptor hooks.
                        // Dumps suspicious symbol names from the SDK .so so we can
                        // identify the native kill function for a future targeted hook.
                        var INTERESTING = ['kill','exit','stop','block','terminate',
                                           'watch','detect','check','abort','crash',
                                           'root','frida','tamper','secure'];
                        try {
                            mod.enumerateExports().forEach(function(exp) {
                                var nl = exp.name.toLowerCase();
                                for (var ki = 0; ki < INTERESTING.length; ki++) {
                                    if (nl.indexOf(INTERESTING[ki]) !== -1) {
                                        warn('[NATIVE] ' + soname + ' export: ' + exp.name + ' @ ' + exp.address);
                                        break;
                                    }
                                }
                            });
                        } catch(ee) { log('[NATIVE] export enum failed for ' + soname + ': ' + ee); }
                    }
                }

                return result;
            };
        });
        log('layer 10: loadLibrary0 native watchdog probe installed');
    } catch(e) { warn('loadLibrary0 hook failed: ' + e); }

    log('== marriott bypass v3 loaded -- watch for [mrt] warn lines ==');
});
