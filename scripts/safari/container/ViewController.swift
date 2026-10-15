// Safari 平台容器：使用公开系统 API 启用扩展；网页只呈现本地中英安装指引。
import WebKit
import SafariServices

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
typealias PlatformViewController = NSViewController
#endif

let extensionBundleIdentifier = "__FLUENTREAD_EXTENSION_BUNDLE_ID__"

// WKUserContentController 强持有 handler；弱转发避免容器控制器与 WebView 形成持有环。
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var delegate: WKScriptMessageHandler?

    init(_ delegate: WKScriptMessageHandler) {
        self.delegate = delegate
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {
    @IBOutlet var webView: WKWebView!

    #if os(iOS)
    private var extensionSettingsIdentifier: String? {
        #if targetEnvironment(simulator)
        // iOS 26.2 / 23C52 实测：已注册的无团队扩展仍只打开设置根页，模拟器使用手动路径。
        return nil
        #else
        // 仅使用 Xcode 实际 DEVELOPMENT_TEAM 展开值；不伪造团队，不从此设置签名。
        guard let team = Bundle.main.object(forInfoDictionaryKey: "FluentReadDevelopmentTeam") as? String,
              team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { return nil }
        return "\(extensionBundleIdentifier) (\(team))"
        #endif
    }
    #endif

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.navigationDelegate = self
        webView.configuration.userContentController.add(WeakScriptMessageHandler(self), name: "controller")
        webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "controller")
    }

    private func showGuide(enabled: Bool? = nil) {
        let language = Locale.preferredLanguages.first ?? "en"
        #if os(iOS)
        let platform = "ios"
        let canOpen: Bool
        if #available(iOS 26.2, *) { canOpen = extensionSettingsIdentifier != nil } else { canOpen = false }
        #else
        let platform = "mac"
        let canOpen = true
        #endif
        let arguments: [Any] = [platform, language, canOpen, enabled.map { $0 as Any } ?? NSNull()]
        guard let data = try? JSONSerialization.data(withJSONObject: arguments), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("show(...\(json))")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        showGuide()
        #if os(macOS)
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { [weak self] state, error in
            guard let state = state, error == nil else { return }
            DispatchQueue.main.async { self?.showGuide(enabled: state.isEnabled) }
        }
        #endif
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true,
              message.body as? String == "open-settings" else { return }
        #if os(iOS)
        if #available(iOS 26.2, *), let identifier = extensionSettingsIdentifier {
            SFSafariSettings.openExtensionsSettings(forIdentifiers: [identifier]) { [weak self] error in
                if error != nil { self?.webView.evaluateJavaScript("settingsFailed()") }
            }
        }
        #elseif os(macOS)
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { [weak self] error in
            DispatchQueue.main.async {
                if error != nil { self?.webView.evaluateJavaScript("settingsFailed()") }
                else { NSApp.terminate(self) }
            }
        }
        #endif
    }
}
