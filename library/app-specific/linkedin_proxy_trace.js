/*
 * LinkedIn proxy detection trace
 *
 * Goal:
 * - log when the app or its libraries read system proxy settings
 * - confirm whether the failure happens before any CONNECT/TLS due to proxy awareness
 */
console.log('[*] LinkedIn proxy trace — installing in 2s...');

setTimeout(function () {
    Java.perform(function () {
        function safe(v) {
            try {
                if (v === null || v === undefined) return 'null';
                return v.toString();
            } catch (e) {
                return '<err ' + e + '>';
            }
        }

        function logStack(prefix) {
            try {
                var stack = Java.use('java.lang.Thread').currentThread().getStackTrace();
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
                    if (shown >= 8) break;
                }
            } catch (e) {
                console.log(prefix + ' <stack failed: ' + e + '>');
            }
        }

        try {
            var System = Java.use('java.lang.System');
            System.getProperty.overload('java.lang.String').implementation = function (key) {
                var ret = System.getProperty.overload('java.lang.String').call(this, key);
                if (
                    key.indexOf('proxy') !== -1 ||
                    key.indexOf('Proxy') !== -1 ||
                    key === 'http.proxyHost' ||
                    key === 'http.proxyPort' ||
                    key === 'https.proxyHost' ||
                    key === 'https.proxyPort'
                ) {
                    console.log('[PROXY-JAVA] System.getProperty(' + key + ') => ' + safe(ret));
                    logStack('[STACK]');
                }
                return ret;
            };
            console.log('[+] Hooked java.lang.System.getProperty(String)');
        } catch (e) {
            console.log('[!] System.getProperty hook failed: ' + e);
        }

        try {
            var Proxy = Java.use('android.net.Proxy');
            Proxy.getHost.overload('android.content.Context').implementation = function (ctx) {
                var ret = Proxy.getHost.overload('android.content.Context').call(this, ctx);
                console.log('[PROXY-ANDROID] Proxy.getHost(ctx) => ' + safe(ret));
                logStack('[STACK]');
                return ret;
            };
            Proxy.getPort.overload('android.content.Context').implementation = function (ctx) {
                var ret = Proxy.getPort.overload('android.content.Context').call(this, ctx);
                console.log('[PROXY-ANDROID] Proxy.getPort(ctx) => ' + safe(ret));
                logStack('[STACK]');
                return ret;
            };
            console.log('[+] Hooked android.net.Proxy');
        } catch (e) {
            console.log('[!] android.net.Proxy hook failed: ' + e);
        }

        try {
            var ProxyInfo = Java.use('android.net.ProxyInfo');
            ProxyInfo.getHost.implementation = function () {
                var ret = this.getHost();
                console.log('[PROXY-INFO] getHost() => ' + safe(ret));
                logStack('[STACK]');
                return ret;
            };
            ProxyInfo.getPort.implementation = function () {
                var ret = this.getPort();
                console.log('[PROXY-INFO] getPort() => ' + safe(ret));
                logStack('[STACK]');
                return ret;
            };
            console.log('[+] Hooked android.net.ProxyInfo');
        } catch (e) {
            console.log('[!] ProxyInfo hook failed: ' + e);
        }

        try {
            var ProxySelector = Java.use('java.net.ProxySelector');
            ProxySelector.select.overload('java.net.URI').implementation = function (uri) {
                var ret = ProxySelector.select.overload('java.net.URI').call(this, uri);
                console.log('[PROXY-JAVA] ProxySelector.select(' + safe(uri) + ') => ' + safe(ret));
                logStack('[STACK]');
                return ret;
            };
            console.log('[+] Hooked java.net.ProxySelector.select');
        } catch (e) {
            console.log('[!] ProxySelector hook failed: ' + e);
        }

        try {
            var URL = Java.use('java.net.URL');
            URL.openConnection.overload().implementation = function () {
                var ret = URL.openConnection.overload().call(this);
                console.log('[URL] openConnection ' + safe(this.toString()) + ' => ' + safe(ret));
                return ret;
            };
            console.log('[+] Hooked java.net.URL.openConnection');
        } catch (e) {
            console.log('[!] URL.openConnection hook failed: ' + e);
        }

        console.log('[*] LinkedIn proxy trace ready');
    });
}, 2000);
