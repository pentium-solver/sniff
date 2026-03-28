/*
 * Pilot Flying J auth trace helper
 *
 * Goal:
 * - trace PingOne / DaVinci auth URL creation
 * - trace browser handoff intents
 * - trace callback / deep-link return into app activities
 *
 * This script does not try to MITM PingOne. It logs the auth flow so the
 * browser redirect logic can be reconstructed even when the browser page is blank.
 */

console.log("[*] pilot_fj_auth_trace attached");

setTimeout(function () {
    Java.perform(function () {
        var ENABLE_HELPER_BROWSER_HOOKS = false;
        var ENABLE_CALLBACK_HOOKS = true;
        var ENABLE_DEEPLINK_NAV_HOOKS = true;

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

        function argsToArray(argsLike) {
            var out = [];
            for (var i = 0; i < argsLike.length; i++) {
                out.push(argsLike[i]);
            }
            return out;
        }

        function logIntent(prefix, intent) {
            try {
                var action = safeString(intent.getAction());
                var data = safeString(intent.getData());
                var component = safeString(intent.getComponent());
                var pkg = safeString(intent.getPackage());
                var flags = intent.getFlags();
                console.log(
                    prefix +
                    " action=" + action +
                    " data=" + data +
                    " component=" + component +
                    " package=" + pkg +
                    " flags=0x" + flags.toString(16)
                );

                try {
                    var extras = intent.getExtras();
                    if (extras) {
                        var keys = extras.keySet().toArray();
                        for (var i = 0; i < keys.length; i++) {
                            var k = keys[i];
                            console.log(prefix + " extra[" + k + "]=" + safeString(extras.get(k)));
                        }
                    }
                } catch (e) {
                    console.log(prefix + " extras read failed: " + e);
                }
            } catch (e) {
                console.log(prefix + " intent dump failed: " + e);
            }
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
                        var callArgs = argsToArray(arguments);
                        try {
                            cb.call(this, original, callArgs);
                        } catch (e) {
                            console.log("[!] " + className + "." + methodName + " hook err: " + e);
                        }
                        return original.apply(this, callArgs);
                    };
                });
                console.log("[+] Hooked " + className + "." + methodName);
            } catch (e) {
                console.log("[!] Failed " + className + "." + methodName + ": " + e);
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

        function requestLooksLikeDavinciSignupCallback(req) {
            var reqText = requestUriString(req) + " " + safeString(req);
            return reqText.indexOf("pilot://davincisignup") !== -1 &&
                reqText.indexOf("access_token=") !== -1;
        }

        // 1. Log authorize endpoint creation.
        try {
            var Builder = useAnyClass(["C10769tq0", "defpackage.C10769tq0"]);
            var authorizeBase = Builder.j.overloads[0];
            authorizeBase.implementation = function () {
                var out = authorizeBase.call(Builder);
                console.log("[AUTH] authorize_base=" + out);
                return out;
            };
            console.log("[+] Hooked C10769tq0.j");
        } catch (e) {
            console.log("[!] C10769tq0.j failed: " + e);
        }

        // 2. Log auth parameter construction, including redirect_uri.
        try {
            var Builder2 = useAnyClass(["C10769tq0", "defpackage.C10769tq0"]);
            var buildParams = null;
            Builder2.c.overloads.forEach(function (ov) {
                if (ov.argumentTypes.length === 7) {
                    buildParams = ov;
                }
            });
            if (buildParams === null) {
                throw new Error("no matching C10769tq0.c overload");
            }
            buildParams.implementation = function (clientId, redirectUri, source, locationId, entryPoint, loyaltyCard, mask) {
                console.log(
                    "[AUTH] params client_id=" + safeString(clientId) +
                    " redirect_uri=" + safeString(redirectUri) +
                    " source=" + safeString(source) +
                    " location_id=" + safeString(locationId) +
                    " entry_point=" + safeString(entryPoint) +
                    " loyalty_card=" + safeString(loyaltyCard) +
                    " mask=" + mask
                );
                return buildParams.call(Builder2, clientId, redirectUri, source, locationId, entryPoint, loyaltyCard, mask);
            };
            console.log("[+] Hooked C10769tq0.c");
        } catch (e) {
            console.log("[!] C10769tq0.c failed: " + e);
        }

        // 3. Log app-level DaVinci auth entry points.
        hookMethod("com.abhishekkumar.auth.LoginActivity", "startDaVinciAuth", function (_overload, args) {
            console.log("[AUTH] LoginActivity.startDaVinciAuth locationId=" + safeString(args[0]));
        });

        hookMethod("com.kevinbender.pilot.welcome.WelcomeActivity", "startDaVinciAuth", function (_overload, args) {
            console.log(
                "[AUTH] WelcomeActivity.startDaVinciAuth locationId=" + safeString(args[0]) +
                " source=" + safeString(args[1]) +
                " entryPoint=" + safeString(args[2])
            );
        });

        try {
            var WelcomeActivity = Java.use("com.kevinbender.pilot.welcome.WelcomeActivity");
            var handleWelcomeDeepLinkRequest = WelcomeActivity.handleWelcomeDeepLinkRequest.overloads[0];
            handleWelcomeDeepLinkRequest.implementation = function (req) {
                var reqText = safeString(req);
                var uriText = requestUriString(req);
                console.log("[DEEPLINK] WelcomeActivity.handleWelcomeDeepLinkRequest req=" + reqText);
                if (requestLooksLikeDavinciSignupCallback(req)) {
                    console.log("[BYPASS] Suppressing welcome deeplink relaunch for PingOne callback uri=" + uriText);
                    return;
                }
                return handleWelcomeDeepLinkRequest.call(this, req);
            };
            console.log("[+] Hooked WelcomeActivity.handleWelcomeDeepLinkRequest with bypass");
        } catch (e) {
            console.log("[!] WelcomeActivity.handleWelcomeDeepLinkRequest bypass failed: " + e);
        }

        // 4. Log the app's actual DaVinci browser launch path.
        try {
            var PW3 = useAnyClass(["PW3", "defpackage.PW3"]);
            var launchDavinci = null;
            PW3.k.overloads.forEach(function (ov) {
                if (ov.argumentTypes.length === 5) {
                    launchDavinci = ov;
                }
            });
            if (launchDavinci === null) {
                throw new Error("no matching PW3.k overload");
            }
            launchDavinci.implementation = function (context, baseUrl, params, inApp, cont) {
                console.log(
                    "[BROWSER] PW3.k context=" + (context ? safeString(context.getClass().getName()) : "null") +
                    " baseUrl=" + safeString(baseUrl) +
                    " inApp=" + inApp +
                    " params=" + safeString(params)
                );
                return launchDavinci.call(PW3, context, baseUrl, params, inApp, cont);
            };
            console.log("[+] Hooked PW3.k");
        } catch (e) {
            console.log("[!] PW3.k failed: " + e);
        }

        // 5. Trace the dedicated PingOne callback continuation and token persistence.
        try {
            var L03 = useAnyClass(["L03", "defpackage.L03"]);
            var l03Invoke = L03.invoke.overloads[0];
            l03Invoke.implementation = function (arg) {
                console.log("[PING] L03.invoke arg=" + safeString(arg));
                try {
                    var out = l03Invoke.call(this, arg);
                    console.log("[PING] L03.invoke completed");
                    return out;
                } catch (e) {
                    console.log("[PING] L03.invoke threw: " + e);
                    throw e;
                }
            };
            console.log("[+] Hooked L03.invoke");
        } catch (e) {
            console.log("[!] L03.invoke failed: " + e);
        }

        try {
            var TokenStore = useAnyClass(["C3852Wt", "defpackage.C3852Wt"]);
            var tokenInvokeSuspend = TokenStore.invokeSuspend.overloads[0];
            tokenInvokeSuspend.implementation = function (arg) {
                var tokenPreview = "null";
                var expiry = "null";
                try {
                    tokenPreview = this.l.value ? safeString(this.l.value).slice(0, 48) + "..." : "null";
                } catch (e) {}
                try {
                    expiry = safeString(this.m.value);
                } catch (e) {}
                console.log("[TOKEN] C3852Wt.invokeSuspend token=" + tokenPreview + " expirySeconds=" + expiry);
                return tokenInvokeSuspend.call(this, arg);
            };
            console.log("[+] Hooked C3852Wt.invokeSuspend");
        } catch (e) {
            console.log("[!] C3852Wt.invokeSuspend failed: " + e);
        }

        // Optional helper and callback hooks are disabled by default.
        if (ENABLE_HELPER_BROWSER_HOOKS) {
            hookMethod("HE", "n", function (_overload, args) {
                console.log("[BROWSER] HE.n custom-tab url=" + safeString(args[1]));
            });

            hookMethod("HE", "o", function (_overload, args) {
                console.log("[BROWSER] HE.o external-browser url=" + safeString(args[0]));
            });
        } else {
            console.log("[*] Helper browser hooks disabled");
        }

        if (ENABLE_CALLBACK_HOOKS) {
            [
                "com.kevinbender.pilot.welcome.WelcomeActivity",
                "com.abhishekkumar.auth.LoginActivity",
                "com.kevinbender.pilot.MainActivity"
            ].forEach(function (className) {
                hookMethod(className, "onNewIntent", function (_overload, args) {
                    console.log("[CALLBACK] " + className + ".onNewIntent");
                    if (args.length > 0 && args[0]) {
                        logIntent("[CALLBACK]", args[0]);
                    }
                });
            });
        } else {
            console.log("[*] Callback activity hooks disabled");
        }

        if (ENABLE_DEEPLINK_NAV_HOOKS) {
            hookMethod("com.kevinbender.pilot.MainActivity", "handleIntentDeeplink", function (_overload, args) {
                console.log("[DEEPLINK] MainActivity.handleIntentDeeplink");
                if (args.length > 0 && args[0]) {
                    logIntent("[DEEPLINK]", args[0]);
                }
            });

            hookMethod("com.abhishekkumar.auth.LoginActivity", "navigateToMain", function () {
                console.log("[DEEPLINK] LoginActivity.navigateToMain");
            });

            hookMethod("com.kevinbender.pilot.welcome.WelcomeActivity", "startMainOrLoginForDeepLink", function (_overload, args) {
                console.log(
                    "[DEEPLINK] WelcomeActivity.startMainOrLoginForDeepLink request=" + safeString(args[0]) +
                    " isLoggedIn=" + safeString(args[1])
                );
            });

            hookMethod("com.codyponder.core.ui.base.BaseActivity", "navigateToLoginWithDeepLink", function (_overload, args) {
                console.log("[DEEPLINK] BaseActivity.navigateToLoginWithDeepLink request=" + safeString(args[0]));
            });

            hookMethod("com.codyponder.core.ui.base.BaseActivity", "navigateToMainActivityWithDeepLink", function (_overload, args) {
                console.log("[DEEPLINK] BaseActivity.navigateToMainActivityWithDeepLink request=" + safeString(args[0]));
            });
        } else {
            console.log("[*] Deep-link navigation hooks disabled");
        }

        console.log("[*] pilot_fj_auth_trace hooks installed");
    });
}, 1000);
