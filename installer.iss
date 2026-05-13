; ============================================================
;  WorkAssist - Inno Setup Installer Script
;  Samjeong Automation | 2026
; ============================================================

#define AppName "WorkAssist"
#define AppVersion "1.2.2"
#define AppPublisher "Samjeong Automation"
#define AppExeName "WorkAssist.exe"
#define AppExeSrc "dist\SJ_WorkAssist.exe"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} v{#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=http://www.sjautomation.com
AppSupportURL=http://www.sjautomation.com
AppUpdatesURL=http://www.sjautomation.com
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppPublisher}
AllowNoIcons=yes
; Output installer file
OutputDir=installer_output
OutputBaseFilename=WorkAssist_Setup_v{#AppVersion}
SetupIconFile=assets\logo.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
; 64-bit only
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
; Minimum OS: Windows 10
MinVersion=10.0.17763
; Show language selection
ShowLanguageDialog=yes
; Uninstall settings
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName} v{#AppVersion}

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕화면에 바로가기 만들기"; GroupDescription: "추가 아이콘:"; Flags: checkedonce
Name: "startupicon"; Description: "Windows 시작 시 자동 실행"; GroupDescription: "시작 옵션:"; Flags: unchecked

[Files]
; Main executable
Source: "{#AppExeSrc}"; DestDir: "{app}"; DestName: "{#AppExeName}"; Flags: ignoreversion

[Icons]
; Start Menu
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Comment: "WorkAssist - 업무 보조 툴"
Name: "{group}\{#AppName} 제거"; Filename: "{uninstallexe}"
; Desktop shortcut (optional task - checked by default on first install)
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon; Comment: "WorkAssist - 업무 보조 툴"
; Desktop shortcut (always update if shortcut already exists - ensures upgrades work)
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Flags: createalways; Check: DesktopShortcutExists; Comment: "WorkAssist - 업무 보조 툴"
; Startup (optional task) - use common startup for admin install
Name: "{commonstartup}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: startupicon

[Registry]
; Register app in Add/Remove Programs with extra info
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppName}"; ValueType: string; ValueName: "DisplayName"; ValueData: "{#AppName}"; Flags: uninsdeletekey
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppName}"; ValueType: string; ValueName: "Publisher"; ValueData: "{#AppPublisher}"
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppName}"; ValueType: string; ValueName: "DisplayVersion"; ValueData: "{#AppVersion}"

[Run]
; Offer to launch app after install
Filename: "{app}\{#AppExeName}"; Description: "설치 완료 후 {#AppName} 실행"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Clean up local data folder on uninstall (optional - silently)
; Filename: "{cmd}"; Parameters: "/C rmdir /s /q ""%LOCALAPPDATA%\SJ_WorkAssist"""; Flags: runhidden

[Code]
// Check if desktop shortcut already exists (for upgrade scenarios)
function DesktopShortcutExists(): Boolean;
var
  DesktopPath: String;
begin
  DesktopPath := ExpandConstant('{autodesktop}\{#AppName}.lnk');
  Result := FileExists(DesktopPath);
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
end;
