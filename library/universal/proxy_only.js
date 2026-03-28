/*
 * Proxy redirect only — NO SSL bypass
 *
 * Forces ALL traffic through the proxy by hooking ProxySelector and
 * scanning for custom ProxySelector subclasses. Does NOT touch any
 * SSL/TLS validation.
 *
 * Best for: Apps where you already have the CA trusted (Magisk module)
 * and the app doesn't pin, but it ignores the system proxy setting.
 * Many apps ship a custom ProxySelector that returns Proxy.NO_PROXY,
 * completely bypassing `settings put global http_proxy`.
 *
 * Good for: Debugging connectivity issues, seeing which domains an app
 * talks to without needing cert bypass (if CA is system-trusted).
 * Also useful as a diagnostic — run this FIRST to see if traffic flows.
 * If it does, you don't need SSL bypass at all (just proxy redirect).
 *
 * Pair with: trustmanager_only.js or okhttp_pinner.js if you still get
 * SSL errors after proxy redirect.
 */
console.log('[*] Proxy redirect (no SSL bypass) — installing in 3s...');

setTimeout(function () {
    Java.perform(function () {
        var ArrayList = Java.use('java.util.ArrayList');
        var ProxyCls = Java.use('java.net.Proxy');
        var ProxyType = Java.use('java.net.Proxy$Type');
        var InetSocketAddress = Java.use('java.net.InetSocketAddress');

        // ── Load proxy config ────────────────────────────────────────────
        var PROXY_HOST = '127.0.0.1';
        var PROXY_PORT = 8080;
        try {
            var BufferedReader = Java.use('java.io.BufferedReader');
            var FileReader = Java.use('java.io.FileReader');
            var reader = BufferedReader.$new(FileReader.$new('/tmp/frida_proxy_config.json'));
            var line = reader.readLine();
            reader.close();
            if (line) {
                var str = line.toString();
                var hostMatch = str.match(/"host":"([^"]+)"/);
                var portMatch = str.match(/"port":(\d+)/);
                if (hostMatch) PROXY_HOST = hostMatch[1];
                if (portMatch) PROXY_PORT = parseInt(portMatch[1]);
            }
        } catch (e) {
            console.log('[!] No proxy config, using defaults');
        }
        console.log('[*] Proxy target: ' + PROXY_HOST + ':' + PROXY_PORT);

        function makeProxyList() {
            var addr = InetSocketAddress.$new(PROXY_HOST, PROXY_PORT);
            var proxy = ProxyCls.$new(ProxyType.HTTP.value, addr);
            var list = ArrayList.$new();
            list.add(proxy);
            return list;
        }

        // ── Hook system default ProxySelector ────────────────────────────
        try {
            var ProxySelector = Java.use('java.net.ProxySelector');
            var defaultPS = ProxySelector.getDefault();
            if (defaultPS !== null) {
                var className = defaultPS.$className;
                var DefaultPSClass = Java.use(className);
                DefaultPSClass.select.implementation = function (uri) {
                    console.log('[+] PROXY → ' + uri);
                    return makeProxyList();
                };
                console.log('[+] System ProxySelector (' + className + ') → proxy');
            }
        } catch (e) {
            console.log('[!] System ProxySelector: ' + e.message);
        }

        // ── Scan for ALL custom ProxySelector subclasses ─────────────────
        var hookedSelectors = 0;
        try {
            Java.enumerateLoadedClasses({
                onMatch: function (className) {
                    try {
                        var cls = Java.use(className);
                        if (cls.class.getSuperclass() &&
                            cls.class.getSuperclass().getName() === 'java.net.ProxySelector') {
                            cls.select.implementation = function (uri) {
                                console.log('[+] ' + className + ' PROXY → ' + uri);
                                return makeProxyList();
                            };
                            console.log('[+] Hooked: ' + className);
                            hookedSelectors++;
                        }
                    } catch (e) {}
                },
                onComplete: function () {}
            });
        } catch (e) {}
        console.log('[*] Hooked ' + hookedSelectors + ' custom ProxySelector(s)');

        // ── Also hook HttpsURLConnection to not bypass proxy ─────────────
        try {
            var HttpsURLConnection = Java.use('javax.net.ssl.HttpsURLConnection');
            // Some apps call openConnection(Proxy.NO_PROXY) directly
            var URL = Java.use('java.net.URL');
            URL.openConnection.overload('java.net.Proxy').implementation = function (proxy) {
                var proxyAddr = InetSocketAddress.$new(PROXY_HOST, PROXY_PORT);
                var httpProxy = ProxyCls.$new(ProxyType.HTTP.value, proxyAddr);
                console.log('[+] URL.openConnection proxy forced: ' + this.toString());
                return this.openConnection(httpProxy);
            };
            console.log('[+] URL.openConnection(Proxy) hooked');
        } catch (e) {}

        console.log('[*] Proxy redirect ready — all traffic → ' + PROXY_HOST + ':' + PROXY_PORT);
    });
}, 3000);
