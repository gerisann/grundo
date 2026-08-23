import Capacitor

/** A GRUNDO helyi Capacitor pluginjainak regisztrációs pontja. */
class GRUNDOBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(BackgroundLocationPlugin())
    }
}
