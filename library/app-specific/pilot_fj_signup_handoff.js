/*
 * Pilot Flying J signup handoff helper
 *
 * Goal:
 * - let PingOne signup/browser auth run direct
 * - detect the app callback as soon as it returns
 * - prevent the welcome deeplink handler from relaunching signup
 * - keep proxy/pinning hooks loaded, but only enable proxying after the host
 *   flips enabled=true in /data/local/tmp/pilot_fj_handoff_config.json
 */

console.log("[*] Pilot FJ signup handoff attached");

setTimeout(function () {
    Java.perform(function () {
        var CONFIG_PATH = "/data/local/tmp/pilot_fj_handoff_config.json";
        var signupCallbackForwarded = false;

        function useAnyClass(names) {
            for (var i = 0; i < names.length; i++) {
                try {
                    return Java.use(names[i]);
                } catch (e) {}
            }
            throw new Error("unable to resolve any class from: " + names.join(", "));
        }

        function safeString(v) {
            try {
                if (v === null || v === undefined) return "null";
                return v.toString();
            } catch (e) {
                return "<toString failed: " + e + ">";
            }
        }

        function readConfig() {
            var cfg = {
                host: "127.0.0.1",
                port: 8080,
                enabled: false,
                domains: ["pilotflyingj.com", "pilotcloud.net"]
            };
            try {
                var BufferedReader = Java.use("java.io.BufferedReader");
                var FileReader = Java.use("java.io.FileReader");
                var StringBuilder = Java.use("java.lang.StringBuilder");
                var reader = BufferedReader.$new(FileReader.$new(CONFIG_PATH));
                var sb = StringBuilder.$new();
                var line = null;
                while ((line = reader.readLine()) !== null) {
                    sb.append(line);
                }
                reader.close();
                var parsed = JSON.parse(sb.toString());
                if (parsed.host) cfg.host = parsed.host;
                if (parsed.port) cfg.port = parsed.port;
                if (parsed.enabled === true || parsed.enabled === false) cfg.enabled = parsed.enabled;
                if (parsed.domains && parsed.domains.length) cfg.domains = parsed.domains;
            } catch (e) {}
            return cfg;
        }

        function logIntent(prefix, intent) {
            try {
                console.log(
                    prefix +
                    " action=" + safeString(intent.getAction()) +
                    " data=" + safeString(intent.getData()) +
                    " component=" + safeString(intent.getComponent()) +
                    " flags=0x" + intent.getFlags().toString(16)
                );
            } catch (e) {
                console.log(prefix + " intent dump failed: " + e);
            }
        }

        function maybeLogSignupIntent(prefix, intent) {
            try {
                if (!intent) return;
                logIntent(prefix, intent);
                var data = safeString(intent.getData());
                if (data.indexOf("pilot://davincisignup") !== -1 && data.indexOf("access_token=") !== -1) {
                    console.log("[HANDOFF] CALLBACK_INTENT uri=" + data);
                    forwardSignupCallback(intent.getData());
                }
            } catch (e) {
                console.log(prefix + " signup intent check failed: " + e);
            }
        }

        function requestUriString(req) {
            try {
                if (req && req.d && req.d.value) {
                    return safeString(req.d.value);
                }
            } catch (e) {}
            return safeString(req);
        }

        function requestLooksLikeSignupCallback(req) {
            var reqText = requestUriString(req) + " " + safeString(req);
            return reqText.indexOf("pilot://davincisignup") !== -1 &&
                reqText.indexOf("access_token=") !== -1;
        }

        function isSignupCallbackUri(uriText) {
            return uriText.indexOf("pilot://davincisignup") !== -1 &&
                uriText.indexOf("access_token=") !== -1;
        }

        function forwardSignupCallback(uri) {
            if (!uri) return false;
            var uriText = safeString(uri);
            if (!isSignupCallbackUri(uriText)) return false;
            if (signupCallbackForwarded) {
                console.log("[HANDOFF] Pending callback already forwarded");
                return true;
            }
            try {
                var MW3 = useAnyClass(["MW3", "defpackage.MW3"]);
                var pending = MW3.a.value;
                if (!pending) {
                    console.log("[HANDOFF] No pending MW3 callback to forward");
                    return false;
                }
                pending.invoke(uri);
                MW3.a.value = null;
                signupCallbackForwarded = true;
                console.log("[HANDOFF] Forwarded signup callback into MW3.a");
                return true;
            } catch (e) {
                console.log("[HANDOFF] Failed forwarding signup callback: " + e);
                return false;
            }
        }

        function continuePastSignupCallback(activity) {
            try {
                if (!activity) return false;
                activity.startActivity(Java.use("android.content.Intent").$new(activity, Java.use("com.kevinbender.pilot.MainActivity").class));
                activity.finish();
                console.log("[HANDOFF] Forced continuation into MainActivity");
                return true;
            } catch (e) {
                console.log("[HANDOFF] Failed forcing MainActivity continuation: " + e);
                return false;
            }
        }

        function makeProxyList(host, port) {
            var ArrayList = Java.use("java.util.ArrayList");
            var ProxyCls = Java.use("java.net.Proxy");
            var ProxyType = Java.use("java.net.Proxy$Type");
            var InetSocketAddress = Java.use("java.net.InetSocketAddress");
            var addr = InetSocketAddress.$new(host, port);
            var proxy = ProxyCls.$new(ProxyType.HTTP.value, addr);
            var list = ArrayList.$new();
            list.add(proxy);
            return list;
        }

        function makeDirectList() {
            var ArrayList = Java.use("java.util.ArrayList");
            var ProxyCls = Java.use("java.net.Proxy");
            var list = ArrayList.$new();
            list.add(ProxyCls.NO_PROXY.value);
            return list;
        }

        function shouldProxy(uri) {
            var cfg = readConfig();
            if (!cfg.enabled) {
                return false;
            }
            var host = uri.getHost();
            if (host === null) {
                return false;
            }
            var hostStr = host.toString();
            for (var i = 0; i < cfg.domains.length; i++) {
                if (hostStr.indexOf(cfg.domains[i]) !== -1) {
                    return true;
                }
            }
            return false;
        }

        function hookMethod(className, methodName, cb) {
            try {
                var candidates = [className];
                if (className.indexOf(".") === -1) {
                    candidates.push("defpackage." + className);
                }
                var Cls = useAnyClass(candidates);
                if (!Cls[methodName]) {
                    console.log("[!] " + className + "." + methodName + " missing");
                    return;
                }
                Cls[methodName].overloads.forEach(function (overload) {
                    var original = overload;
                    overload.implementation = function () {
                        var args = [];
                        for (var i = 0; i < arguments.length; i++) {
                            args.push(arguments[i]);
                        }
                        try {
                            cb.call(this, original, args);
                        } catch (e) {
                            console.log("[!] " + className + "." + methodName + " hook err: " + e);
                        }
                        return original.apply(this, args);
                    };
                });
                console.log("[+] Hooked " + className + "." + methodName);
            } catch (e) {
                console.log("[!] Failed " + className + "." + methodName + ": " + e);
            }
        }

        // ProxySelector used by the Pilot app. Only active after the host flips enabled=true.
        try {
            var bE1 = useAnyClass(["bE1", "defpackage.bE1"]);
            bE1.select.implementation = function (uri) {
                var cfg = readConfig();
                if (shouldProxy(uri)) {
                    console.log("[PROXY] " + uri + " -> " + cfg.host + ":" + cfg.port);
                    return makeProxyList(cfg.host, cfg.port);
                }
                return makeDirectList();
            };
            console.log("[+] bE1.select hooked");
        } catch (e) {
            console.log("[!] bE1.select failed: " + e);
        }

        // App pinning.
        try {
            var ON = useAnyClass(["ON", "defpackage.ON"]);
            ON.a.implementation = function (hostname, chain) {
                console.log("[PIN] bypass " + safeString(hostname));
            };
            console.log("[+] ON.a hooked");
        } catch (e) {
            console.log("[!] ON.a failed: " + e);
        }

        // Android trust validation.
        try {
            var TrustManagerImpl = Java.use("com.android.org.conscrypt.TrustManagerImpl");
            try {
                TrustManagerImpl.checkTrustedRecursive.implementation = function (a1, a2, a3, a4, a5, a6) {
                    console.log("[TLS] checkTrustedRecursive bypassed");
                    return Java.use("java.util.ArrayList").$new();
                };
                console.log("[+] TrustManagerImpl.checkTrustedRecursive");
            } catch (e) {}
            try {
                TrustManagerImpl.verifyChain.implementation = function (untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
                    console.log("[TLS] verifyChain bypassed host=" + safeString(host));
                    return untrustedChain;
                };
                console.log("[+] TrustManagerImpl.verifyChain");
            } catch (e) {}
        } catch (e) {
            console.log("[!] TrustManagerImpl failed: " + e);
        }

        // Splunk exporter crash prevention.
        try {
            var AndroidSpanExporter = Java.use("com.splunk.rum.common.otel.span.AndroidSpanExporter");
            AndroidSpanExporter.export.implementation = function (spans) {
                var r = Java.use("aV").$new();
                r.e();
                return r;
            };
            AndroidSpanExporter.flush.implementation = function () {
                var r = Java.use("aV").$new();
                r.e();
                return r;
            };
            console.log("[+] Splunk neutralized");
        } catch (e) {}

        // Log callback intent as early as possible.
        hookMethod("com.kevinbender.pilot.welcome.WelcomeActivity", "onNewIntent", function (_overload, args) {
            if (args.length > 0 && args[0]) {
                maybeLogSignupIntent("[CALLBACK]", args[0]);
            }
        });

        hookMethod("com.kevinbender.pilot.welcome.WelcomeActivity", "setIntent", function (_overload, args) {
            if (args.length > 0 && args[0]) {
                maybeLogSignupIntent("[CALLBACK:setIntent]", args[0]);
            }
        });

        hookMethod("com.kevinbender.pilot.welcome.WelcomeActivity", "onCreate", function (_overload, _args) {
            try {
                maybeLogSignupIntent("[CALLBACK:onCreate]", this.getIntent());
            } catch (e) {
                console.log("[CALLBACK:onCreate] failed: " + e);
            }
        });

        // Prevent the welcome deeplink router from relaunching signup after success.
        try {
            var WelcomeActivity = Java.use("com.kevinbender.pilot.welcome.WelcomeActivity");
            var handleWelcomeDeepLinkRequest = WelcomeActivity.handleWelcomeDeepLinkRequest.overloads[0];
            handleWelcomeDeepLinkRequest.implementation = function (req) {
                var reqText = safeString(req);
                var uriText = requestUriString(req);
                console.log("[DEEPLINK] WelcomeActivity.handleWelcomeDeepLinkRequest req=" + reqText);
                if (requestLooksLikeSignupCallback(req)) {
                    var forwarded = false;
                    try {
                        if (req && req.d && req.d.value) {
                            forwarded = forwardSignupCallback(req.d.value);
                        }
                    } catch (e) {
                        console.log("[HANDOFF] Failed to inspect req.d for callback forwarding: " + e);
                    }
                    console.log("[HANDOFF] CALLBACK_READY uri=" + uriText);
                    console.log("[BYPASS] Suppressing welcome deeplink relaunch for signup callback");
                    if (!forwarded) {
                        continuePastSignupCallback(this);
                    }
                    return;
                }
                return handleWelcomeDeepLinkRequest.call(this, req);
            };
            console.log("[+] Hooked WelcomeActivity.handleWelcomeDeepLinkRequest with handoff bypass");
        } catch (e) {
            console.log("[!] WelcomeActivity.handleWelcomeDeepLinkRequest failed: " + e);
        }

        console.log("[*] Pilot FJ signup handoff hooks installed");
    });
}, 3000);
