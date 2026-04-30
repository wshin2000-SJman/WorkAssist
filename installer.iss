[Setup]
AppName=SJ Kanban
AppVersion=1.0.0
AppPublisher=Samjeong Automation
AppPublisherURL=http://www.sjautomation.com
DefaultDirName={autopf}\SJKanban
DefaultGroupName=SJ Kanban
DisableProgramGroupPage=yes
OutputBaseFilename=SJKanban_Installer
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64
SetupIconFile=assets\logo.ico

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "dist\SJ_Kanban.exe"; DestDir: "{app}"; Flags: ignoreversion
; Add any other required files if not bundled completely in the single exe

[Icons]
Name: "{group}\SJ Kanban"; Filename: "{app}\SJ_Kanban.exe"
Name: "{autodesktop}\SJ Kanban"; Filename: "{app}\SJ_Kanban.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\SJ_Kanban.exe"; Description: "{cm:LaunchProgram,SJ Kanban}"; Flags: nowait postinstall skipifsilent
