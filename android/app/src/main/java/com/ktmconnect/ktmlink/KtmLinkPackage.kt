package com.ktmconnect.ktmlink

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.ktmconnect.update.BundleUpdateModule

/** Registers this app's own native modules: the dashboard link and the updater. */
class KtmLinkPackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    when (name) {
      KtmLinkModule.NAME -> KtmLinkModule(reactContext)
      BundleUpdateModule.NAME -> BundleUpdateModule(reactContext)
      else -> null
    }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    listOf(KtmLinkModule.NAME, BundleUpdateModule.NAME).associateWith { name ->
      ReactModuleInfo(
        name,
        name,
        false, // canOverrideExistingModule
        false, // needsEagerInit
        false, // isCxxModule
        true, // isTurboModule
      )
    }
  }
}
