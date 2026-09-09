import AVFoundation
import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureAudioSession()
        return true
    }

    /// A rendszer hangútvonalának beállítása — ENÉLKÜL BLUETOOTH-ON NEM SZÓLT
    /// SEMMI.
    ///
    /// A projektben eddig EGYETLEN sor AVAudioSession-konfiguráció sem volt: a
    /// WebView alapértelmezésére hagyatkoztunk. Ennek két mért következménye
    /// lett (Geri, iPhone, 2026-09-09): csatlakoztatott Bluetooth-fülhallgatóval
    /// egyetlen hangeffekt sem szólalt meg.
    ///
    /// A választott kategória Geri döntése:
    ///
    ///   - `.playback` — a hang a NÉMÍTÓ KAPCSOLÓ állásától függetlenül
    ///     megszólal, és a rendszer a csatlakoztatott kimenetre (fülhallgató,
    ///     autó, hangszóró) irányítja. Futás közben a telefon jellemzően néma
    ///     kapcsolón van a zsebben; egy elfoglalt mező visszajelzése viszont
    ///     pont ilyenkor kell.
    ///   - `.mixWithOthers` — a felhasználó zenéje MEGY TOVÁBB, a koppanások
    ///     ráülnek. Nem `.duckOthers`: a rövid koppanás miatt lehalkítani a
    ///     zenét zavaróbb lenne, mint maga a koppanás.
    ///
    /// ⚠️ AKI NEM AKARJA HALLANI, AZ APPBAN NÉMÍTJA. Mivel a `.playback` a
    /// készülék néma kapcsolóját szándékosan figyelmen kívül hagyja, a rögzítés
    /// felületén külön némító gomb van (`TrackingScreen` → `.track__mute`), és a
    /// Beállítások → Hangok főkapcsolója ugyanazt az értéket állítja.
    ///
    /// A hibát elnyeljük: egy sikertelen hangbeállítás miatt az app nem
    /// indulhat el hibásan — legrosszabb esetben marad a régi, néma viselkedés.
    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .default,
                options: [.mixWithOthers]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // Szándékosan néma ág: a rögzítés sosem múlhat a hangeszközön.
        }
    }

    // Az APNs regisztráció eredményét a Capacitor Firebase Messaging pluginnek
    // továbbítjuk. A plugin ebből készíti el a szerver által használható FCM
    // tokent; a nyers APNs token önmagában nem küldhető a Firebase Admin SDK-val.
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }

    func application(_ application: UIApplication,
                     didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NotificationCenter.default.post(
            name: Notification.Name("didReceiveRemoteNotification"),
            object: completionHandler,
            userInfo: userInfo
        )
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
