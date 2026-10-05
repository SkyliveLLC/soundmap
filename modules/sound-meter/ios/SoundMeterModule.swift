import AVFoundation
import ExpoModulesCore

public class SoundMeterModule: Module {
  private let lock = NSLock()
  private var engine: AVAudioEngine?

  public func definition() -> ModuleDefinition {
    Name("SoundMeter")

    Events("onLevel")

    OnCreate {
      EXPermissionsMethodsDelegate.register(
        [MicrophonePermissionRequester()],
        withPermissionsManager: self.appContext?.permissions
      )
    }

    AsyncFunction("getPermissionsAsync") { (promise: Promise) in
      EXPermissionsMethodsDelegate.getPermissionWithPermissionsManager(
        self.appContext?.permissions,
        withRequester: MicrophonePermissionRequester.self,
        resolve: promise.legacyResolver,
        reject: promise.legacyRejecter
      )
    }

    AsyncFunction("requestPermissionsAsync") { (promise: Promise) in
      EXPermissionsMethodsDelegate.askForPermission(
        withPermissionsManager: self.appContext?.permissions,
        withRequester: MicrophonePermissionRequester.self,
        resolve: promise.legacyResolver,
        reject: promise.legacyRejecter
      )
    }

    AsyncFunction("start") {
      try self.start()
    }

    Function("stop") {
      self.stop()
    }

    OnDestroy {
      self.stop()
    }
  }

  private func start() throws {
    lock.lock()
    defer { lock.unlock() }
    guard engine == nil else { return }
    guard MicrophonePermissionRequester.status() == EXPermissionStatusGranted else {
      throw MicrophonePermissionException()
    }

    let session = AVAudioSession.sharedInstance()
    // .measurement turns off the system's gain control and voice processing.
    try session.setCategory(.record, mode: .measurement)
    try session.setActive(true)

    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw NoAudioInputException()
    }

    let meter = LevelMeter(sampleRate: format.sampleRate) { [weak self] dbfs in
      self?.sendEvent("onLevel", ["dbfs": dbfs])
    }
    input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
      guard let samples = buffer.floatChannelData?[0] else { return }
      meter.process(samples, count: Int(buffer.frameLength))
    }
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      try? session.setActive(false)
      throw error
    }
    self.engine = engine
  }

  private func stop() {
    lock.lock()
    defer { lock.unlock() }
    guard let engine else { return }
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    self.engine = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}

final class MicrophonePermissionException: Exception, @unchecked Sendable {
  override var reason: String {
    "Microphone permission has not been granted"
  }
}

final class NoAudioInputException: Exception, @unchecked Sendable {
  override var reason: String {
    "No audio input is available"
  }
}
