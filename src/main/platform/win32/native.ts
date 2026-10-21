// Win32 bindings through koffi (a prebuilt FFI module: no compiler or
// node-gyp needed at install time). Window handles are passed as intptr_t so
// they arrive in JavaScript as plain numbers.
import koffi from 'koffi';

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const dwmapi = koffi.load('dwmapi.dll');

export const EnumWindowsProc = koffi.proto('int __stdcall OrbitEnumWindowsProc(intptr_t hwnd, intptr_t lparam)');

export const api = {
  GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
  SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(intptr_t hwnd)'),
  BringWindowToTop: user32.func('int __stdcall BringWindowToTop(intptr_t hwnd)'),
  SwitchToThisWindow: user32.func('void __stdcall SwitchToThisWindow(intptr_t hwnd, int altTab)'),
  ShowWindow: user32.func('int __stdcall ShowWindow(intptr_t hwnd, int cmd)'),
  IsIconic: user32.func('int __stdcall IsIconic(intptr_t hwnd)'),
  IsWindow: user32.func('int __stdcall IsWindow(intptr_t hwnd)'),
  IsWindowVisible: user32.func('int __stdcall IsWindowVisible(intptr_t hwnd)'),
  GetWindow: user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32_t cmd)'),
  GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)'),
  GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, _Out_ uint8_t *buf, int maxCount)'),
  GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t hwnd, _Out_ uint8_t *buf, int maxCount)'),
  GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)'),
  AttachThreadInput: user32.func('int __stdcall AttachThreadInput(uint32_t idAttach, uint32_t idAttachTo, int attach)'),
  AllowSetForegroundWindow: user32.func('int __stdcall AllowSetForegroundWindow(uint32_t pid)'),
  EnumWindows: user32.func('int __stdcall EnumWindows(OrbitEnumWindowsProc *cb, intptr_t lparam)'),
  SendInput: user32.func('uint32_t __stdcall SendInput(uint32_t count, void *inputs, int size)'),
  MapVirtualKeyW: user32.func('uint32_t __stdcall MapVirtualKeyW(uint32_t code, uint32_t mapType)'),
  GetAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int vk)'),
  SetCursorPos: user32.func('int __stdcall SetCursorPos(int x, int y)'),
  GetCurrentThreadId: kernel32.func('uint32_t __stdcall GetCurrentThreadId()'),
  OpenProcess: kernel32.func('intptr_t __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),
  CloseHandle: kernel32.func('int __stdcall CloseHandle(intptr_t handle)'),
  QueryFullProcessImageNameW: kernel32.func(
    'int __stdcall QueryFullProcessImageNameW(intptr_t process, uint32_t flags, _Out_ uint8_t *buf, _Inout_ uint32_t *size)',
  ),
  DwmGetWindowAttribute: dwmapi.func(
    'int32_t __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attr, _Out_ uint32_t *value, uint32_t size)',
  ),
};

export const C = {
  SW_RESTORE: 9,
  GW_OWNER: 4,
  GWL_EXSTYLE: -20,
  WS_EX_TOOLWINDOW: 0x80,
  WS_EX_APPWINDOW: 0x40000,
  WS_EX_NOACTIVATE: 0x08000000,
  DWMWA_CLOAKED: 14,
  PROCESS_QUERY_LIMITED_INFORMATION: 0x1000,
  ASFW_ANY: 0xffffffff,
  INPUT_KEYBOARD: 1,
  KEYEVENTF_EXTENDEDKEY: 0x1,
  KEYEVENTF_KEYUP: 0x2,
  KEYEVENTF_UNICODE: 0x4,
  MAPVK_VK_TO_VSC: 0,
} as const;

// INPUT layout, computed by koffi for the running architecture.
const KEYBDINPUT = koffi.struct('OrbitKEYBDINPUT', {
  wVk: 'uint16_t',
  wScan: 'uint16_t',
  dwFlags: 'uint32_t',
  time: 'uint32_t',
  dwExtraInfo: 'uintptr_t',
});
const MOUSEINPUT = koffi.struct('OrbitMOUSEINPUT', {
  dx: 'int32_t',
  dy: 'int32_t',
  mouseData: 'uint32_t',
  dwFlags: 'uint32_t',
  time: 'uint32_t',
  dwExtraInfo: 'uintptr_t',
});
const INPUT_UNION = koffi.union('OrbitINPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT });
const INPUT = koffi.struct('OrbitINPUT', { type: 'uint32_t', u: INPUT_UNION });

const INPUT_SIZE = koffi.sizeof(INPUT);
const U_OFFSET = koffi.offsetof(INPUT, 'u');
const KI = {
  wVk: U_OFFSET + koffi.offsetof(KEYBDINPUT, 'wVk'),
  wScan: U_OFFSET + koffi.offsetof(KEYBDINPUT, 'wScan'),
  dwFlags: U_OFFSET + koffi.offsetof(KEYBDINPUT, 'dwFlags'),
  dwExtraInfo: U_OFFSET + koffi.offsetof(KEYBDINPUT, 'dwExtraInfo'),
};
const POINTER_SIZE = koffi.sizeof('uintptr_t');

/** Tag on injected events ("ORBI") so they can be told apart in a debugger. */
const EXTRA_INFO = 0x4f524249;

export interface KeyEvent {
  vk: number;
  scan: number;
  flags: number;
}

/** Sends keyboard events in one SendInput call. Returns how many were injected. */
export function sendKeyEvents(events: readonly KeyEvent[]): number {
  if (events.length === 0) return 0;
  const buf = Buffer.alloc(INPUT_SIZE * events.length);
  events.forEach((e, i) => {
    const base = i * INPUT_SIZE;
    buf.writeUInt32LE(C.INPUT_KEYBOARD, base);
    buf.writeUInt16LE(e.vk, base + KI.wVk);
    buf.writeUInt16LE(e.scan, base + KI.wScan);
    buf.writeUInt32LE(e.flags, base + KI.dwFlags);
    if (POINTER_SIZE === 8) buf.writeBigUInt64LE(BigInt(EXTRA_INFO), base + KI.dwExtraInfo);
    else buf.writeUInt32LE(EXTRA_INFO, base + KI.dwExtraInfo);
  });
  return api.SendInput(events.length, buf, INPUT_SIZE);
}

const textBuffer = Buffer.alloc(1024);

export function windowText(hwnd: number): string {
  const len = api.GetWindowTextW(hwnd, textBuffer, 512);
  return len > 0 ? textBuffer.toString('utf16le', 0, len * 2) : '';
}

export function className(hwnd: number): string {
  const len = api.GetClassNameW(hwnd, textBuffer, 256);
  return len > 0 ? textBuffer.toString('utf16le', 0, len * 2) : '';
}

export function processImagePath(pid: number): string {
  const handle = api.OpenProcess(C.PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!handle) return '';
  try {
    const buf = Buffer.alloc(2048);
    const size = [1024];
    if (!api.QueryFullProcessImageNameW(handle, 0, buf, size)) return '';
    return buf.toString('utf16le', 0, size[0]! * 2);
  } finally {
    api.CloseHandle(handle);
  }
}

export function isCloaked(hwnd: number): boolean {
  const out = [0];
  const hr = api.DwmGetWindowAttribute(hwnd, C.DWMWA_CLOAKED, out, 4);
  return hr === 0 && out[0] !== 0;
}

/** Enumerates top-level windows; the callback returns false to stop. */
export function enumWindows(visit: (hwnd: number) => boolean | void): void {
  const cb = koffi.register((hwnd: number) => (visit(hwnd) === false ? 0 : 1), koffi.pointer(EnumWindowsProc));
  try {
    api.EnumWindows(cb, 0);
  } finally {
    koffi.unregister(cb);
  }
}
