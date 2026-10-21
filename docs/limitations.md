# Known limitations

These come from how Windows works, not from missing features. Each is handled as gracefully as the OS allows and, where possible, reported to the user.

| Area | Limitation | What OrbitMenu does |
| --- | --- | --- |
| Elevated apps | Windows' User Interface Privilege Isolation stops a normal process from sending input to, or focusing, windows of a process running as administrator. `SendInput` gives no error in this case. | Documented in the editor (About page, keyboard action help). Run OrbitMenu as administrator if you need to control elevated apps. |
| Secure desktop | Nothing can be injected into the lock screen, UAC prompts or Ctrl+Alt+Del screen. While the session is locked (including a minimised RDP session) `SendInput` is rejected. | Reported as "Windows blocked the simulated keys". |
| Reserved shortcuts | Some combinations can never be simulated (Win+L, Ctrl+Alt+Del) and some cannot be registered as global shortcuts because Windows or another app owns them. | Conflicts are shown per menu ("Taken by another app"); use a command such as `rundll32.exe user32.dll,LockWorkStation` to lock the PC. |
| Ctrl+Space and IMEs | Chinese, Japanese and Korean input methods use Ctrl+Space (or similar) to switch modes. | Choose another shortcut, e.g. Ctrl+Alt+Q or a spare F-key (F13–F24 are ideal for mouse buttons). |
| Clipboard restore | Electron exposes text, HTML, RTF and images. Files copied in Explorer and private application formats cannot be read and are therefore lost when a snippet is pasted. The restore happens after a delay; very slow apps may paste late. | Use *Type* instead of *Paste*, turn off *Restore the clipboard*, or raise *Clipboard restore delay*. The restore is skipped if something else changed the clipboard meanwhile. |
| Typing | Typed text is sent as Unicode characters, which some games and remote-desktop clients ignore. | Use *Paste* there. |
| Foreground lock | Windows may refuse to bring a window to the front (it then flashes in the taskbar). | OrbitMenu tries `SetForegroundWindow`, thread-input attachment and `SwitchToThisWindow`, and grants started programs permission to come forward. |
| Store apps | UWP / Store apps (Calculator, Settings) are hosted by `ApplicationFrameHost.exe`, so their process name is not useful for *Focus window*. | Match them by window title. |
| Fullscreen | Exclusive-fullscreen games can draw over every other window, including the overlay. | Use borderless-windowed mode. |
| Batch files | Windows always runs `.bat`/`.cmd` through `cmd.exe`, which interprets `& | < > ^ % !` even in arguments. | Arguments with these characters are refused for batch files; run `cmd.exe` explicitly if you really need shell syntax. |
| Mixed-DPI setups | Electron occasionally sizes a window with the previous monitor's scale factor when moving between monitors. | The overlay's bounds are applied twice and verified after showing. |
| Turbo mode | Requires the activation shortcut to contain a modifier and the main process to observe its state. | A quick tap of the shortcut leaves the menu open for clicking. |
