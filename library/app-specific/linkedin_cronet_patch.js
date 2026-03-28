/*
 * LinkedIn Cronet patch
 *
 * Goal:
 * - disable the LinkedIn Cronet transport options that may be interfering with
 *   proxy tunneling before any CONNECT bytes are written
 * - keep a small trust bypass in place so a successful tunnel does not fail
 *   immediately on the MITM certificate
 */

console.log('[*] LinkedIn Cronet patch — installing...');

Java.perform(function () {
        var ArrayList = Java.use('java.util.ArrayList');
        var Collections = Java.use('java.util.Collections');

        function safe(v) {
            try {
                if (v === null || v === undefined) return 'null';
                return v.toString();
            } catch (e) {
                return '<err ' + e + '>';
            }
        }

        function emptyMap() {
            return Collections.emptyMap();
        }

        try {
            var NetworkingModule = Java.use('com.linkedin.android.infra.modules.NetworkingModule');
            var networkEngine = NetworkingModule.networkEngine.overload(
                'android.content.Context',
                'com.linkedin.android.networking.cookies.LinkedInHttpCookieManager',
                'com.linkedin.android.infra.data.FlagshipSharedPreferences',
                'com.linkedin.android.infra.network.AppNetworkingConfig',
                'com.linkedin.android.lixclient.PersistentLixStorage'
            );
            networkEngine.implementation = function (context, cookieManager, sharedPrefs, appNetworkingConfig, lixStorage) {
                console.log('[CRONET-PATCH] NetworkingModule.networkEngine invoked');
                return networkEngine.call(this, context, cookieManager, sharedPrefs, appNetworkingConfig, lixStorage);
            };
            console.log('[+] Hooked NetworkingModule.networkEngine');
        } catch (e) {
            console.log('[!] NetworkingModule.networkEngine hook failed: ' + e);
        }

        try {
            var CronetExperimentalOptions = Java.use('com.linkedin.android.networking.engines.cronet.CronetExperimentalOptions');
            var cronetCtor = CronetExperimentalOptions.$init.overload(
                'boolean',
                'java.lang.String',
                'boolean',
                'java.lang.String',
                'boolean',
                'java.util.Map',
                'boolean'
            );
            cronetCtor.implementation = function (
                enableBrotli,
                experimentalDnsOptionsTreatmentString,
                enableDiagnosticLogging,
                warmupUrl,
                enableNetworkQualityMetricsListening,
                hostResolverRemap,
                enableQuic
            ) {
                console.log(
                    '[CRONET-PATCH] options ctor ' +
                    'quic=' + enableQuic +
                    ' warmup=' + safe(warmupUrl) +
                    ' dns=' + safe(experimentalDnsOptionsTreatmentString) +
                    ' remap=' + safe(hostResolverRemap)
                );
                return cronetCtor.call(
                    this,
                    enableBrotli,
                    null,
                    enableDiagnosticLogging,
                    null,
                    enableNetworkQualityMetricsListening,
                    emptyMap(),
                    false
                );
            };
            console.log('[+] Hooked CronetExperimentalOptions.$init');
        } catch (e) {
            console.log('[!] CronetExperimentalOptions hook failed: ' + e);
        }

        try {
            var CronetNetworkEngineWithoutExecution = Java.use('com.linkedin.android.networking.engines.cronet.CronetNetworkEngineWithoutExecution');
            var init = CronetNetworkEngineWithoutExecution.init.overload();
            init.implementation = function () {
                try {
                    var opts = this.experimentalOptions.value;
                    if (opts !== null) {
                        try { opts.enableQuic.value = false; } catch (e1) {}
                        try { opts.experimentalDnsOptionsTreatmentString.value = null; } catch (e2) {}
                        try { opts.warmupUrl.value = null; } catch (e3) {}
                        try { opts.hostResolverRemap.value = emptyMap(); } catch (e4) {}
                        console.log(
                            '[CRONET-PATCH] init ' +
                            'quic=' + safe(opts.enableQuic.value) +
                            ' warmup=' + safe(opts.warmupUrl.value) +
                            ' dns=' + safe(opts.experimentalDnsOptionsTreatmentString.value) +
                            ' remap=' + safe(opts.hostResolverRemap.value)
                        );
                    }
                } catch (inner) {
                    console.log('[!] init option patch failed: ' + inner);
                }
                return init.call(this);
            };
            console.log('[+] Hooked CronetNetworkEngineWithoutExecution.init');
        } catch (e) {
            console.log('[!] CronetNetworkEngineWithoutExecution.init hook failed: ' + e);
        }

        try {
            var CronetBuilderImpl = Java.use('org.chromium.net.impl.CronetEngineBuilderImpl');
            try {
                var implEnableQuic = CronetBuilderImpl.enableQuic.overload('boolean');
                implEnableQuic.implementation = function (value) {
                    console.log('[CRONET-PATCH] CronetEngineBuilderImpl.enableQuic(' + value + ') -> false');
                    return implEnableQuic.call(this, false);
                };
                console.log('[+] Hooked CronetEngineBuilderImpl.enableQuic');
            } catch (inner0) {
                console.log('[!] CronetEngineBuilderImpl.enableQuic hook failed: ' + inner0);
            }

            try {
                var addPublicKeyPins = CronetBuilderImpl.addPublicKeyPins.overload(
                    'java.lang.String',
                    'java.util.Set',
                    'boolean',
                    'java.util.Date'
                );
                addPublicKeyPins.implementation = function (hostName, pinsSha256, includeSubdomains, expirationDate) {
                    console.log('[CRONET-PATCH] addPublicKeyPins bypassed: ' + safe(hostName));
                    return this;
                };
                console.log('[+] Hooked CronetEngineBuilderImpl.addPublicKeyPins');
            } catch (inner1) {}
            try {
                var bypassLocalAnchors = CronetBuilderImpl.enablePublicKeyPinningBypassForLocalTrustAnchors.overload('boolean');
                bypassLocalAnchors.implementation = function (value) {
                    console.log('[CRONET-PATCH] enablePublicKeyPinningBypassForLocalTrustAnchors(' + value + ') -> true');
                    return bypassLocalAnchors.call(this, true);
                };
                console.log('[+] Hooked CronetEngineBuilderImpl.enablePublicKeyPinningBypassForLocalTrustAnchors');
            } catch (inner2) {}
        } catch (e) {
            console.log('[!] CronetEngineBuilderImpl hooks unavailable: ' + e);
        }

        try {
            var TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');

            try {
                TrustManagerImpl.checkTrustedRecursive.implementation = function (a1, a2, a3, a4, a5, a6) {
                    console.log('[TLS] checkTrustedRecursive bypassed');
                    return ArrayList.$new();
                };
                console.log('[+] TrustManagerImpl.checkTrustedRecursive');
            } catch (inner3) {}

            try {
                TrustManagerImpl.verifyChain.implementation = function (untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
                    console.log('[TLS] verifyChain bypassed: ' + safe(host));
                    return untrustedChain;
                };
                console.log('[+] TrustManagerImpl.verifyChain');
            } catch (inner4) {}
        } catch (e) {
            console.log('[!] TrustManagerImpl hooks unavailable: ' + e);
        }

        try {
            var PlatformPinner = Java.use('com.android.okhttp.CertificatePinner');
            PlatformPinner.check.overloads.forEach(function (overload) {
                overload.implementation = function () {
                    var host = arguments.length > 0 ? safe(arguments[0]) : '<unknown>';
                    console.log('[TLS] com.android.okhttp.CertificatePinner bypassed: ' + host);
                };
            });
            console.log('[+] com.android.okhttp.CertificatePinner');
        } catch (e) {
            console.log('[!] com.android.okhttp.CertificatePinner unavailable: ' + e);
        }

        try {
            var OkHostnameVerifier = Java.use('com.android.okhttp.internal.tls.OkHostnameVerifier');
            OkHostnameVerifier.verify.overloads.forEach(function (overload) {
                overload.implementation = function () {
                    var host = arguments.length > 0 ? safe(arguments[0]) : '<unknown>';
                    console.log('[TLS] OkHostnameVerifier bypassed: ' + host);
                    return true;
                };
            });
            console.log('[+] com.android.okhttp.internal.tls.OkHostnameVerifier');
        } catch (e) {
            console.log('[!] OkHostnameVerifier unavailable: ' + e);
        }

        console.log('[*] LinkedIn Cronet patch ready');
});
