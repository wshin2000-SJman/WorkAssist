; ============================================================================
; WorkAssist v4 NSIS Installer Script
; ============================================================================

Unicode true

!define PRODUCT_NAME "WorkAssist v4"
!define PRODUCT_VERSION "4.0.0"
!define PRODUCT_PUBLISHER "SJ Automation"
!define PRODUCT_DIR_NAME "WorkAssist_v4"
!define OUT_FILE_NAME "WorkAssist_v4_Setup.exe"

; Request user execution level (No Admin privileges required for easy install)
RequestExecutionLevel user

; Set compression
SetCompressor /SOLID lzma

; Modern UI
!include "MUI2.nsh"

; MUI Settings
!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

; Welcome page
!insertmacro MUI_PAGE_WELCOME
; Directory page
!insertmacro MUI_PAGE_DIRECTORY
; Instfiles page
!insertmacro MUI_PAGE_INSTFILES
; Finish page
!define MUI_FINISHPAGE_RUN "$INSTDIR\workassist-v4.exe"
!define MUI_FINISHPAGE_RUN_TEXT "WorkAssist v4 실행하기"
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Language
!insertmacro MUI_LANGUAGE "Korean"

; Installer General Attributes
Name "${PRODUCT_NAME}"
OutFile "${OUT_FILE_NAME}"
InstallDir "$LOCALAPPDATA\${PRODUCT_DIR_NAME}"
ShowInstDetails show
ShowUnInstDetails show

; ============================================================================
; Installer Sections
; ============================================================================

Section "MainSection" SEC01
    SetOutPath "$INSTDIR"
    SetOverwrite on

    ; 1. Copy Executable
    File "target\release\workassist-v4.exe"

    ; 2. Copy UI folder recursively
    SetOutPath "$INSTDIR\ui"
    File /r "ui\*.*"

    ; 3. Create Shortcuts
    SetOutPath "$INSTDIR"
    CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
    CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\workassist-v4.exe"
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\workassist-v4.exe"

    ; 4. Create Uninstaller
    WriteUninstaller "$INSTDIR\Uninstall.exe"

    ; 5. Register in Windows Control Panel (Add/Remove Programs)
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayName" "${PRODUCT_NAME}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "UninstallString" "$INSTDIR\Uninstall.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayIcon" "$INSTDIR\workassist-v4.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersionUninstall\${PRODUCT_NAME}" "Publisher" "${PRODUCT_PUBLISHER}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayVersion" "${PRODUCT_VERSION}"
SectionEnd

; ============================================================================
; Uninstaller Section
; ============================================================================

Section "Uninstall"
    ; Remove Shortcuts
    Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
    Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
    RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

    ; Remove Installed Files & Folders
    RMDir /r "$INSTDIR\ui"
    Delete "$INSTDIR\workassist-v4.exe"
    Delete "$INSTDIR\Uninstall.exe"
    RMDir "$INSTDIR"

    ; Remove Registry Entry
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
SectionEnd
