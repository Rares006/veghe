import SwiftUI

@main
struct ControlLaptopApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                // Link-ul din codul QR de pe Mac: controllaptop://pair?url=…&token=…
                .onOpenURL { model.handle(url: $0) }
                // Dacă aplicația pornește direct „activă”, onChange de mai jos nu se
                // declanșează; pornim actualizarea și aici.
                .onAppear { model.startPolling() }
        }
        // Întrebăm Mac-ul doar cât aplicația e pe ecran.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.startPolling() } else { model.stopPolling() }
        }
    }
}
