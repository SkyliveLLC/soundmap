import AVFoundation
import ExpoModulesCore

final class MicrophonePermissionRequester: NSObject, EXPermissionsRequester {
  static func permissionType() -> String {
    "microphone"
  }

  static func status() -> EXPermissionStatus {
    if #available(iOS 17.0, *) {
      switch AVAudioApplication.shared.recordPermission {
      case .granted: return EXPermissionStatusGranted
      case .denied: return EXPermissionStatusDenied
      default: return EXPermissionStatusUndetermined
      }
    }
    switch AVAudioSession.sharedInstance().recordPermission {
    case .granted: return EXPermissionStatusGranted
    case .denied: return EXPermissionStatusDenied
    default: return EXPermissionStatusUndetermined
    }
  }

  func getPermissions() -> [AnyHashable: Any] {
    ["status": Self.status().rawValue]
  }

  func requestPermissions(resolver resolve: @escaping EXPromiseResolveBlock, rejecter reject: @escaping EXPromiseRejectBlock) {
    let completion: (Bool) -> Void = { _ in resolve(self.getPermissions()) }
    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission(completionHandler: completion)
    } else {
      AVAudioSession.sharedInstance().requestRecordPermission(completion)
    }
  }
}
