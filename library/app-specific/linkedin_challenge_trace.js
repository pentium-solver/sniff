Java.perform(function () {
  function log(msg) {
    console.log(msg);
  }

  function safeString(value) {
    try {
      if (value === null || value === undefined) return "null";
      return value.toString();
    } catch (_err) {
      return "<toString failed>";
    }
  }

  function preview(value, limit) {
    var text = safeString(value);
    if (text.length <= limit) return text;
    return text.slice(0, limit) + "...";
  }

  function describeBundle(bundle) {
    if (!bundle) return "null";
    try {
      var out = [];
      var keySet = bundle.keySet();
      var iter = keySet.iterator();
      while (iter.hasNext()) {
        var key = iter.next();
        var value = bundle.get(key);
        if (key === "password" || key === "session_password") {
          out.push(key + "=<redacted:" + (safeString(value).length || 0) + ">");
        } else {
          out.push(key + "=" + preview(value, 180));
        }
      }
      return "{" + out.join(", ") + "}";
    } catch (err) {
      return "<bundle error: " + err + ">";
    }
  }

  function getIntentExtras(activity) {
    try {
      var intent = activity.getIntent();
      if (!intent) return "null";
      return describeBundle(intent.getExtras());
    } catch (err) {
      return "<intent error: " + err + ">";
    }
  }

  function byteArrayToString(bytes) {
    if (!bytes) return "";
    try {
      return Java.use("java.lang.String").$new(bytes, "UTF-8").toString();
    } catch (_err) {
      try {
        return Java.use("java.lang.String").$new(bytes).toString();
      } catch (err2) {
        return "<decode error: " + err2 + ">";
      }
    }
  }

  function javaStack() {
    try {
      var Throwable = Java.use("java.lang.Throwable");
      var Log = Java.use("android.util.Log");
      return Log.getStackTraceString(Throwable.$new()).toString();
    } catch (err) {
      return "<stack unavailable: " + err + ">";
    }
  }

  try {
    var LiAuthImpl = Java.use("com.linkedin.android.liauthlib.LiAuthImpl");
    LiAuthImpl.authenticateWithWebActivity.implementation = function (
      context,
      username,
      midToken,
      password,
      googleIdToken,
      soogleLoginRequestType,
      appleIdToken,
      appleAuthCode,
      facebookAccessToken,
      passkeyData,
      authListener,
      appleAuthListener,
      rememberMeAuthLiveData,
      challengeLiveData,
      challengeAccountRecoveryLiveData,
      webAuthenticationUrl,
      webAuthenticationType
    ) {
      log(
        "[CHALLENGE] authenticateWithWebActivity type=" +
          safeString(webAuthenticationType) +
          " url=" +
          safeString(webAuthenticationUrl)
      );
      log(
        "[CHALLENGE] auth args username=" +
          preview(username, 120) +
          " midToken=" +
          preview(midToken, 120) +
          " hasPassword=" +
          (password ? "true" : "false") +
          " hasGoogleIdToken=" +
          (googleIdToken ? "true" : "false") +
          " hasFacebookAccessToken=" +
          (facebookAccessToken ? "true" : "false") +
          " hasAppleIdToken=" +
          (appleIdToken ? "true" : "false")
      );
      return LiAuthImpl.authenticateWithWebActivity.call(
        this,
        context,
        username,
        midToken,
        password,
        googleIdToken,
        soogleLoginRequestType,
        appleIdToken,
        appleAuthCode,
        facebookAccessToken,
        passkeyData,
        authListener,
        appleAuthListener,
        rememberMeAuthLiveData,
        challengeLiveData,
        challengeAccountRecoveryLiveData,
        webAuthenticationUrl,
        webAuthenticationType
      );
    };
    log("[+] Hooked LiAuthImpl.authenticateWithWebActivity");
  } catch (err) {
    log("[!] Failed to hook LiAuthImpl.authenticateWithWebActivity: " + err);
  }

  try {
    var LiAuthWebActivity = Java.use("com.linkedin.android.liauthlib.LiAuthWebActivity");
    LiAuthWebActivity.onCreate.overload("android.os.Bundle").implementation = function (bundle) {
      log("[CHALLENGE] LiAuthWebActivity.onCreate extras=" + getIntentExtras(this));
      return LiAuthWebActivity.onCreate.overload("android.os.Bundle").call(this, bundle);
    };
    LiAuthWebActivity.openWebViewUrl.overload("java.lang.String", "java.lang.String").implementation = function (url, authType) {
      log("[CHALLENGE] LiAuthWebActivity.openWebViewUrl type=" + safeString(authType) + " url=" + safeString(url));
      log("[CHALLENGE] LiAuthWebActivity extras=" + getIntentExtras(this));
      return LiAuthWebActivity.openWebViewUrl.overload("java.lang.String", "java.lang.String").call(this, url, authType);
    };
    LiAuthWebActivity.sendWebViewAuthenticationCompletedBroadcast
      .overload("java.lang.String", "java.lang.String")
      .implementation = function (result, cookies) {
        log(
          "[CHALLENGE] WebView completed result=" +
            safeString(result) +
            " cookies=" +
            preview(cookies, 300)
        );
        log("[CHALLENGE] completion stack=\n" + javaStack());
        return LiAuthWebActivity.sendWebViewAuthenticationCompletedBroadcast
          .overload("java.lang.String", "java.lang.String")
          .call(this, result, cookies);
      };
    log("[+] Hooked LiAuthWebActivity");
  } catch (err) {
    log("[!] Failed to hook LiAuthWebActivity: " + err);
  }

  try {
    var AuthHttpStackWrapper = Java.use("com.linkedin.android.liauthlib.network.impl.AuthHttpStackWrapper");
    var CookieManager = Java.use("android.webkit.CookieManager");
    AuthHttpStackWrapper.addCookiesToCookieManager.implementation = function (cookieManager) {
      log("[CHALLENGE] addCookiesToCookieManager()");
      var result = AuthHttpStackWrapper.addCookiesToCookieManager.call(this, cookieManager);
      try {
        var linkedinCookies = CookieManager.getInstance().getCookie("https://www.linkedin.com");
        log("[CHALLENGE] CookieManager linkedin.com=" + preview(linkedinCookies, 400));
      } catch (err2) {
        log("[!] CookieManager read failed: " + err2);
      }
      return result;
    };
    log("[+] Hooked AuthHttpStackWrapper.addCookiesToCookieManager");
  } catch (err) {
    log("[!] Failed to hook AuthHttpStackWrapper.addCookiesToCookieManager: " + err);
  }

  try {
    var JSBridge = Java.use("com.linkedin.android.liauthlib.webview.JSBridgeWebViewInterface");
    JSBridge.sendWebMessage.overload("java.lang.String").implementation = function (message) {
      var msg = safeString(message);
      if (msg.indexOf("FRIDA_HTML:") === 0) {
        var html = msg.substring(11);
        log("[CHALLENGE] PAGE-HTML-START");
        var chunk = 4000;
        for (var i = 0; i < html.length; i += chunk) {
          log(html.substring(i, i + chunk));
        }
        log("[CHALLENGE] PAGE-HTML-END");
        return; // don't forward our injected message to the app
      }
      log("[CHALLENGE] JSBridge.sendWebMessage " + preview(message, 500));
      return JSBridge.sendWebMessage.overload("java.lang.String").call(this, message);
    };
    log("[+] Hooked JSBridgeWebViewInterface.sendWebMessage");
  } catch (err) {
    log("[!] Failed to hook JSBridgeWebViewInterface.sendWebMessage: " + err);
  }

  try {
    var WebView = Java.use("android.webkit.WebView");
    WebView.loadUrl.overload("java.lang.String").implementation = function (url) {
      if (url && (url.indexOf("linkedin.com/checkpoint") !== -1 || url.indexOf("linkedin.com/comm/checkpoint") !== -1)) {
        log("[CHALLENGE] WebView.loadUrl " + safeString(url));
      }
      return WebView.loadUrl.overload("java.lang.String").call(this, url);
    };
    WebView.postUrl.overload("java.lang.String", "[B").implementation = function (url, body) {
      if (url && (url.indexOf("linkedin.com/checkpoint") !== -1 || url.indexOf("linkedin.com/comm/checkpoint") !== -1)) {
        log("[CHALLENGE] WebView.postUrl " + safeString(url));
        log("[CHALLENGE] WebView.post body=" + preview(byteArrayToString(body), 1200));
      }
      return WebView.postUrl.overload("java.lang.String", "[B").call(this, url, body);
    };
    log("[+] Hooked WebView.loadUrl/postUrl for LinkedIn checkpoint URLs");
  } catch (err) {
    log("[!] Failed to hook WebView checkpoint methods: " + err);
  }

  try {
    var LiAuthWebViewClient = Java.use("com.linkedin.android.liauthlib.LiAuthWebActivity$1");
    LiAuthWebViewClient.shouldOverrideUrlLoading
      .overload("android.webkit.WebView", "java.lang.String")
      .implementation = function (webView, url) {
        log("[CHALLENGE] shouldOverrideUrlLoading url=" + safeString(url));
        return LiAuthWebViewClient.shouldOverrideUrlLoading
          .overload("android.webkit.WebView", "java.lang.String")
          .call(this, webView, url);
      };
    LiAuthWebViewClient.onPageFinished
      .overload("android.webkit.WebView", "java.lang.String")
      .implementation = function (webView, url) {
        log("[CHALLENGE] onPageFinished url=" + safeString(url));
        return LiAuthWebViewClient.onPageFinished
          .overload("android.webkit.WebView", "java.lang.String")
          .call(this, webView, url);
      };
    if (LiAuthWebViewClient.onReceivedError) {
      LiAuthWebViewClient.onReceivedError
        .overload("android.webkit.WebView", "int", "java.lang.String", "java.lang.String")
        .implementation = function (webView, code, description, failingUrl) {
          log(
            "[CHALLENGE] onReceivedError code=" +
              code +
              " desc=" +
              safeString(description) +
              " url=" +
              safeString(failingUrl)
          );
          return LiAuthWebViewClient.onReceivedError
            .overload("android.webkit.WebView", "int", "java.lang.String", "java.lang.String")
            .call(this, webView, code, description, failingUrl);
        };
    }
    log("[+] Hooked LiAuthWebActivity$1 WebViewClient");
  } catch (err) {
    log("[!] Failed to hook LiAuthWebActivity$1 WebViewClient: " + err);
  }

  // ── Intercept ALL WebView HTTP requests (shouldInterceptRequest) ──────
  // This catches every request the WebView makes including form POSTs,
  // XHR, resource loads, etc. — with full URL, method, and headers.
  try {
    var WebViewClient = Java.use("android.webkit.WebViewClient");
    WebViewClient.shouldInterceptRequest
      .overload("android.webkit.WebView", "android.webkit.WebResourceRequest")
      .implementation = function (webView, request) {
        try {
          var reqUrl = safeString(request.getUrl());
          // Only log linkedin.com requests to avoid noise
          if (reqUrl.indexOf("linkedin.com") !== -1) {
            var method = safeString(request.getMethod());
            log("[WEBVIEW-REQ] " + method + " " + reqUrl);
            try {
              var headers = request.getRequestHeaders();
              if (headers) {
                var Map = Java.use("java.util.Map");
                var castedHeaders = Java.cast(headers, Map);
                var keySet = castedHeaders.keySet();
                var iteratorClass = Java.use("java.util.Iterator");
                var iter = Java.cast(keySet.iterator(), iteratorClass);
                var hdrs = [];
                while (iter.hasNext()) {
                  var key = iter.next();
                  var val = castedHeaders.get(key);
                  hdrs.push(safeString(key) + ": " + safeString(val));
                }
                log("[WEBVIEW-REQ] headers: " + hdrs.join(" | "));
              }
            } catch (_hErr) {
              log("[WEBVIEW-REQ] headers: (failed to read: " + _hErr + ")");
            }
          }
        } catch (reqErr) {
          log("[!] shouldInterceptRequest log error: " + reqErr);
        }
        return WebViewClient.shouldInterceptRequest
          .overload("android.webkit.WebView", "android.webkit.WebResourceRequest")
          .call(this, webView, request);
      };
    log("[+] Hooked WebViewClient.shouldInterceptRequest (all WebView HTTP traffic)");
  } catch (err) {
    log("[!] Failed to hook WebViewClient.shouldInterceptRequest: " + err);
  }

  // ── Hook XMLHttpRequest via WebView JS injection ──────────────────────
  // Captures XHR/fetch calls from within the WebView's JavaScript context
  // by injecting a monitoring script on every page load.
  try {
    var WebViewHtml = Java.use("android.webkit.WebView");
    var origLoadUrl = WebViewHtml.loadUrl.overload("java.lang.String");
    // We already hooked loadUrl above for checkpoint URLs.
    // Add an XHR intercept script injection on onPageFinished via a
    // separate hook on the base WebViewClient.
    var BaseWebViewClient = Java.use("android.webkit.WebViewClient");
    var origOnPageFinished = BaseWebViewClient.onPageFinished
      .overload("android.webkit.WebView", "java.lang.String");
    origOnPageFinished.implementation = function (wv, pageUrl) {
      origOnPageFinished.call(this, wv, pageUrl);
      if (pageUrl && pageUrl.indexOf("linkedin.com") !== -1 && pageUrl.indexOf("javascript:") === -1) {
        try {
          var xhrScript = [
            "javascript:void((function(){",
            "  if(window.__fridaXhrHooked) return; window.__fridaXhrHooked=true;",
            "  var origOpen=XMLHttpRequest.prototype.open;",
            "  var origSend=XMLHttpRequest.prototype.send;",
            "  XMLHttpRequest.prototype.open=function(m,u){",
            "    this._fridaMethod=m; this._fridaUrl=u;",
            "    return origOpen.apply(this,arguments);",
            "  };",
            "  XMLHttpRequest.prototype.send=function(body){",
            "    if(this._fridaUrl && this._fridaUrl.indexOf('linkedin.com')!==-1){",
            "      console.log('[WEBVIEW-XHR] '+this._fridaMethod+' '+this._fridaUrl);",
            "      if(body) console.log('[WEBVIEW-XHR] body='+body.substring(0,2000));",
            "    }",
            "    return origSend.apply(this,arguments);",
            "  };",
            "  var origFetch=window.fetch;",
            "  if(origFetch) window.fetch=function(url,opts){",
            "    var u=(typeof url==='string')?url:(url&&url.url)||'';",
            "    if(u.indexOf('linkedin.com')!==-1){",
            "      console.log('[WEBVIEW-FETCH] '+(opts&&opts.method||'GET')+' '+u);",
            "      if(opts&&opts.body) console.log('[WEBVIEW-FETCH] body='+String(opts.body).substring(0,2000));",
            "    }",
            "    return origFetch.apply(this,arguments);",
            "  };",
            "})())"
          ].join("");
          wv.loadUrl.overload("java.lang.String").call(wv, xhrScript);
        } catch (_injectErr) {
          // ignore injection failures
        }
      }
    };
    log("[+] Hooked WebViewClient.onPageFinished for XHR/fetch interception");
  } catch (err) {
    log("[!] Failed to hook XHR injection: " + err);
  }

  log("[*] LinkedIn challenge trace ready");
});
