import SwiftUI
import UIKit

extension View {
    /// iOS 15-compatible programmatic pushes. Destinations inherit the same environment and navigation stack.
    func pushDestination<Destination: View>(isPresented: Binding<Bool>, @ViewBuilder destination: () -> Destination) -> some View {
        background(NavigationLink(isActive: isPresented, destination: destination, label: { EmptyView() }).hidden())
    }

    func pushDestination<Item, Destination: View>(item: Binding<Item?>, @ViewBuilder destination: @escaping (Item) -> Destination) -> some View {
        background(ItemNavigationLink(item: item, destination: destination))
    }

    /// Keep UIKit's interactive, cancellable horizontal pop, with the same guards as the visible back button.
    func navigationBack(title: String, isEnabled: Bool = true, requiresConfirmation: Bool = false,
                        onReturn: @escaping () -> Void = {},
                        action: @escaping () -> Void) -> some View {
        navigationTitle(title).navigationBarTitleDisplayMode(.inline).navigationBarHidden(false)
            .navigationBarBackButtonHidden(true)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: action) {
                        Image(systemName: "chevron.left").font(.body.weight(.semibold))
                            .foregroundColor(Brand.ink).frame(width: 44, height: 44)
                    }
                    .disabled(!isEnabled).accessibilityLabel("返回").accessibilityIdentifier("navigate-back")
                }
            }
            .background(NativeBackGuard(isEnabled: isEnabled, requiresConfirmation: requiresConfirmation, onRequest: action, onReturn: onReturn))
    }
}

private struct ItemNavigationLink<Item, Destination: View>: View {
    @Binding var item: Item?
    // Keep the outgoing destination alive while UIKit finishes its pop animation.
    @State private var lastItem: Item?
    let destination: (Item) -> Destination

    var body: some View {
        NavigationLink(isActive: Binding(get: { item != nil }, set: { if !$0 { item = nil } })) {
            if let value = item ?? lastItem {
                destination(value).onDisappear { if item == nil { lastItem = nil } }
            }
        } label: { EmptyView() }
        .hidden()
        .onChange(of: item != nil) { if $0 { lastItem = item } }
    }
}

/// SwiftUI hides the system pop gesture when using a custom back button. Restore the native gesture,
/// not a DragGesture that dismisses a modal. No navigation-controller delegate or animation is replaced.
private struct NativeBackGuard: UIViewControllerRepresentable {
    let isEnabled: Bool
    let requiresConfirmation: Bool
    let onRequest: () -> Void
    let onReturn: () -> Void

    func makeUIViewController(context: Context) -> Controller { Controller() }

    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.isBackEnabled = isEnabled
        controller.requiresConfirmation = requiresConfirmation
        controller.onRequest = onRequest
        controller.onReturn = onReturn
        if controller.viewIfLoaded?.window != nil {
            DispatchQueue.main.async { [weak controller] in controller?.install() }
        }
    }

    static func dismantleUIViewController(_ controller: Controller, coordinator: ()) { controller.restore() }

    final class Controller: UIViewController, UIGestureRecognizerDelegate {
        var isBackEnabled = true
        var requiresConfirmation = false
        var onRequest: () -> Void = {}
        var onReturn: () -> Void = {}
        private weak var gesture: UIGestureRecognizer?
        private weak var previousDelegate: UIGestureRecognizerDelegate?
        private weak var owner: UIViewController?
        private weak var registeredNavigation: UINavigationController?
        private weak var contentGesture: UIGestureRecognizer?
        private var previousContentEnabled: Bool?
        private var previousEnabled = true

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            // SwiftUI applies the custom back-button preference after child appearance callbacks.
            DispatchQueue.main.async { [weak self] in self?.install() }
        }

        override func viewDidDisappear(_ animated: Bool) {
            super.viewDidDisappear(animated)
            restore()
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            guard let navigation = registeredNavigation, let owner else { return }
            let didReturn = onReturn
            if let transition = navigation.transitionCoordinator {
                transition.animate(alongsideTransition: nil) { context in
                    if !context.isCancelled && !navigation.viewControllers.contains(where: { $0 === owner }) { didReturn() }
                }
            } else if !navigation.viewControllers.contains(where: { $0 === owner }) {
                didReturn()
            }
        }

        func install() {
            guard let navigationController, let recognizer = navigationController.interactivePopGestureRecognizer,
                  navigationController.viewControllers.count > 1 else { return }
            if gesture === recognizer, recognizer.delegate === self {
                recognizer.isEnabled = true
                limitToLeadingEdge(navigationController)
                return
            }
            restore()
            gesture = recognizer
            owner = navigationController.topViewController
            registeredNavigation = navigationController
            previousDelegate = recognizer.delegate
            previousEnabled = recognizer.isEnabled
            recognizer.delegate = self
            recognizer.isEnabled = true
            limitToLeadingEdge(navigationController)
        }

        private func limitToLeadingEdge(_ navigation: UINavigationController) {
            // iOS 26 also offers a whole-content pop. Keep reading/input drags local, and prevent
            // that second recognizer from bypassing the generation/deletion/live-call guards.
            if #available(iOS 26.0, *), let content = navigation.interactiveContentPopGestureRecognizer,
               content !== gesture {
                if contentGesture !== content {
                    contentGesture = content
                    previousContentEnabled = content.isEnabled
                }
                content.isEnabled = false
            }
        }

        func restore() {
            if let gesture, gesture.delegate === self {
                gesture.delegate = previousDelegate
                gesture.isEnabled = previousEnabled
                if let previousContentEnabled { contentGesture?.isEnabled = previousContentEnabled }
            }
            gesture = nil
            previousDelegate = nil
            owner = nil
            registeredNavigation = nil
            contentGesture = nil
            previousContentEnabled = nil
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard isBackEnabled, let navigationController,
                  navigationController.viewControllers.count > 1,
                  navigationController.topViewController === owner,
                  navigationController.transitionCoordinator == nil else { return false }
            if requiresConfirmation { onRequest(); return false }
            return true
        }
    }
}
