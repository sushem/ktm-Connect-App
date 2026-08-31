package com.ktmconnect

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.ktmconnect.ktmlink.KtmLinkPackage
import com.ktmconnect.update.BundleStore

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      // A downloaded bundle when one is staged and still trusted, otherwise the
      // copy inside the APK. Resolved here because it has to be known before
      // React starts.
      jsBundleFilePath = BundleStore.resolveBundlePath(applicationContext),
      packageList =
        PackageList(this).packages.apply {
          // The MY RIDE RFCOMM link lives in this app rather than in a library,
          // so it has to be registered by hand.
          add(KtmLinkPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
