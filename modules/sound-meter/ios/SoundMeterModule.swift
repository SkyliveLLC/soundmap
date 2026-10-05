import ExpoModulesCore

public class SoundMeterModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SoundMeter")

    Events("onChange")

    Function("hello") {
      return "Hello world! 👋"
    }

    AsyncFunction("setValueAsync") { (value: String) in
      self.sendEvent("onChange", [
        "value": value
      ])
    }
  }
}
