const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

// UIKit on iOS 27 traps at launch unless the app adopts the scene life cycle, and the
// Expo SDK 57 iOS template predates that. This backports the SDK 58 template: the
// ExpoAppSceneDelegate shipped in `expo` creates the window and starts React Native.
// Delete this plugin when upgrading to SDK 58.
const WINDOW_SETUP = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif\n/;

module.exports = function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
          },
        ],
      },
    };
    return mod;
  });

  return withAppDelegate(config, (mod) => {
    const source = mod.modResults.contents;
    if (source.includes('ExpoReactNativeFactoryProvider')) return mod;
    if (!source.includes('class AppDelegate: ExpoAppDelegate {') || !WINDOW_SETUP.test(source)) {
      throw new Error('with-ios-scene-lifecycle: AppDelegate.swift no longer matches the SDK 57 template');
    }
    mod.modResults.contents = source
      .replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {')
      .replace(WINDOW_SETUP, '\n');
    return mod;
  });
};
