# The release check's window-message half (docs/RELEASE-CHECK.md). Needs no keyboard, mouse or focus, so the window may
# sit behind others or the screen may be locked.
#
#   win32.ps1 -Action dialog -ProcessId <pid> -FilePath <path> [-Button '&Save' | '&Open']
#       Finds the app's common file dialog (#32770), types the path into its file box and clicks the button.
#   win32.ps1 -Action menu -ProcessId <pid>
#       Prints the main window's native menu as JSON: each menu's label and its items' text, id and state.
#   win32.ps1 -Action command -ProcessId <pid> -ItemId <id>
#       Posts the WM_COMMAND a click on that menu item sends.
#
# Windows PowerShell 5 compiles the C# below, so it is C# 5. The button click is posted, not sent: SendMessage blocks
# until any modal the click raises is answered.
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [string]$FilePath = '',
  [string]$Button = '&Save',
  [int]$ItemId = 0
)
$ErrorActionPreference = 'Stop'
# The menu's labels carry "…": printed in the console's code page it would arrive as something else.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class IncudoWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr m);
  [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr m, int pos);
  [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr m, int pos);
  [DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr m, uint id, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetMenuString(IntPtr m, uint id, StringBuilder s, int n, uint flags);
  public static string ClassOf(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static string TextOf(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  public static string MenuText(IntPtr m, int pos) { var s = new StringBuilder(512); GetMenuString(m, (uint)pos, s, 512, 0x400); return s.ToString(); }
  public static List<IntPtr> Tops(uint pid) {
    var r = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) r.Add(h); return true; }, IntPtr.Zero);
    return r;
  }
  public static List<IntPtr> Kids(IntPtr top) { var r = new List<IntPtr>(); EnumChildWindows(top, (h, l) => { r.Add(h); return true; }, IntPtr.Zero); return r; }
}
"@

function Find-MainWindow {
  foreach ($h in [IncudoWin]::Tops($ProcessId)) { if ([IncudoWin]::GetMenu($h) -ne [IntPtr]::Zero) { return $h } }
  throw "no window of process $ProcessId has a menu"
}

switch ($Action) {
  'dialog' {
    $dialog = $null
    for ($i = 0; $i -lt 60 -and -not $dialog; $i++) {
      $dialog = [IncudoWin]::Tops($ProcessId) | Where-Object { [IncudoWin]::ClassOf($_) -eq '#32770' } | Select-Object -First 1
      if (-not $dialog) { Start-Sleep -Milliseconds 250 }
    }
    if (-not $dialog) { throw 'no file dialog opened' }
    $kids = [IncudoWin]::Kids($dialog)
    $edit = $kids | Where-Object { [IncudoWin]::ClassOf($_) -eq 'Edit' -and [IncudoWin]::ClassOf([IncudoWin]::GetParent($_)) -eq 'ComboBox' } | Select-Object -First 1
    if (-not $edit) { $edit = $kids | Where-Object { [IncudoWin]::ClassOf($_) -eq 'Edit' } | Select-Object -First 1 }
    if (-not $edit) { throw 'the file dialog has no file box' }
    [void][IncudoWin]::SendMessage($edit, 0x000C, [IntPtr]::Zero, $FilePath)
    $btn = $kids | Where-Object { [IncudoWin]::ClassOf($_) -eq 'Button' -and [IncudoWin]::TextOf($_) -eq $Button } | Select-Object -First 1
    if (-not $btn) { throw "the file dialog has no $Button button" }
    [void][IncudoWin]::PostMessage($btn, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
    ConvertTo-Json -Compress @{ title = [IncudoWin]::TextOf($dialog) }
  }
  'menu' {
    $bar = [IncudoWin]::GetMenu((Find-MainWindow))
    $menus = @()
    for ($i = 0; $i -lt [IncudoWin]::GetMenuItemCount($bar); $i++) {
      $sub = [IncudoWin]::GetSubMenu($bar, $i)
      $items = @()
      if ($sub -ne [IntPtr]::Zero) {
        for ($j = 0; $j -lt [IncudoWin]::GetMenuItemCount($sub); $j++) {
          $state = [IncudoWin]::GetMenuState($sub, [uint32]$j, 0x400)
          $items += @{
            text = [IncudoWin]::MenuText($sub, $j)
            id = [int][IncudoWin]::GetMenuItemID($sub, $j)
            separator = (($state -band 0x800) -ne 0) -and ([IncudoWin]::MenuText($sub, $j) -eq '')
            greyed = ($state -band 0x3) -ne 0
          }
        }
      }
      $menus += @{ label = [IncudoWin]::MenuText($bar, $i); items = $items }
    }
    ConvertTo-Json -Compress -Depth 5 $menus
  }
  'command' {
    [void][IncudoWin]::PostMessage((Find-MainWindow), 0x0111, [IntPtr]$ItemId, [IntPtr]::Zero)
    ConvertTo-Json -Compress @{ posted = $ItemId }
  }
  default { throw "unknown action $Action" }
}
