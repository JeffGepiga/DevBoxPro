; DevBox Pro NSIS Installer Script
; Use a general-purpose register to persist portable install detection between
; customInit and customInstall without introducing an extra NSIS user variable.

!define VCREDIST_REG_KEY "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64"
!define VCREDIST_MIN_VERSION "14.44.35211.0"
!define VCREDIST_MIN_MAJOR 14
!define VCREDIST_MIN_MINOR 44
!define VCREDIST_MIN_BLD 35211
!define VCREDIST_MIN_RBLD 0

!macro showVCRedistBanner
  SetDetailsView show
  DetailPrint "Installing Microsoft Visual C++ Redistributable. This may take a minute..."
  Banner::show /NOUNLOAD "Installing Microsoft Visual C++ Redistributable" "DevBox Pro is installing a required Windows runtime. Please wait..."
  BringToFront
!macroend

!macro hideVCRedistBanner
  Banner::destroy
!macroend

!macro customInit
  StrCpy $R9 0

  ${If} ${FileExists} "$INSTDIR\portable.flag"
    StrCpy $R9 1
  ${EndIf}
!macroend

!macro installBundledVCRedist
  StrCpy $4 "$INSTDIR\resources\vcredist\VC_redist.x64.exe"
  StrCpy $5 1
  StrCpy $6 ""
  SetRegView 64
  ClearErrors
  ReadRegDWORD $7 HKLM "${VCREDIST_REG_KEY}" "Installed"
  ${If} ${Errors}
    StrCpy $7 0
  ${EndIf}

  ${If} $7 == 1
    ClearErrors
    ReadRegDWORD $8 HKLM "${VCREDIST_REG_KEY}" "Major"
    ${If} ${Errors}
      StrCpy $6 "installed (version unavailable)"
      DetailPrint "Microsoft Visual C++ Redistributable is present, but Windows did not report its version. DevBox Pro will install the bundled ${VCREDIST_MIN_VERSION} runtime to ensure compatibility."
    ${Else}
      ClearErrors
      ReadRegDWORD $9 HKLM "${VCREDIST_REG_KEY}" "Minor"
      ${If} ${Errors}
        StrCpy $6 "$8.unknown"
        DetailPrint "Microsoft Visual C++ Redistributable was detected, but Windows did not report the full version. DevBox Pro will install the bundled ${VCREDIST_MIN_VERSION} runtime to ensure compatibility."
      ${Else}
        ClearErrors
        ReadRegDWORD $0 HKLM "${VCREDIST_REG_KEY}" "Bld"
        ${If} ${Errors}
          StrCpy $6 "$8.$9.unknown"
          DetailPrint "Microsoft Visual C++ Redistributable $6 was detected, but Windows did not report the full build number. DevBox Pro will install the bundled ${VCREDIST_MIN_VERSION} runtime to ensure compatibility."
        ${Else}
          ClearErrors
          ReadRegDWORD $1 HKLM "${VCREDIST_REG_KEY}" "Rbld"
          ${If} ${Errors}
            StrCpy $6 "$8.$9.$0.unknown"
            DetailPrint "Microsoft Visual C++ Redistributable $6 was detected, but Windows did not report the full revision. DevBox Pro will install the bundled ${VCREDIST_MIN_VERSION} runtime to ensure compatibility."
          ${Else}
            StrCpy $6 "$8.$9.$0.$1"
            IntCmp $8 ${VCREDIST_MIN_MAJOR} vcCheckMinor vcNeedsRuntimeInstall vcSkipRuntimeInstall
vcCheckMinor:
            IntCmp $9 ${VCREDIST_MIN_MINOR} vcCheckBuild vcNeedsRuntimeInstall vcSkipRuntimeInstall
vcCheckBuild:
            IntCmp $0 ${VCREDIST_MIN_BLD} vcCheckRevision vcNeedsRuntimeInstall vcSkipRuntimeInstall
vcCheckRevision:
            IntCmp $1 ${VCREDIST_MIN_RBLD} vcSkipRuntimeInstall vcNeedsRuntimeInstall vcSkipRuntimeInstall
vcNeedsRuntimeInstall:
            DetailPrint "Microsoft Visual C++ Redistributable $6 is installed, but DevBox Pro requires ${VCREDIST_MIN_VERSION} or newer. Updating runtime."
            Goto vcRuntimeCheckDone
vcSkipRuntimeInstall:
            StrCpy $5 0
            DetailPrint "Microsoft Visual C++ Redistributable $6 is already installed. Skipping runtime installation."
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${Else}
    DetailPrint "Microsoft Visual C++ Redistributable ${VCREDIST_MIN_VERSION} or newer was not detected. DevBox Pro will install the bundled runtime."
  ${EndIf}

vcRuntimeCheckDone:
  SetRegView 32

  ${If} $5 == 0
    DetailPrint "VC++ runtime check complete. Continuing DevBox Pro setup."
  ${ElseIf} ${FileExists} "$4"
    !insertmacro showVCRedistBanner
    ExecWait '"$4" /install /quiet /norestart' $6
    !insertmacro hideVCRedistBanner

    ${If} $6 == 0
      DetailPrint "Microsoft Visual C++ Redistributable installed successfully."
    ${ElseIf} $6 == 1638
      DetailPrint "Microsoft Visual C++ Redistributable is already installed."
    ${ElseIf} $6 == 3010
      DetailPrint "Microsoft Visual C++ Redistributable installed. A restart is recommended."
    ${Else}
      DetailPrint "Visual C++ Redistributable installer exited with code $6. Continuing DevBox Pro setup."
    ${EndIf}
  ${Else}
    DetailPrint "Bundled Visual C++ Redistributable installer not found. Skipping system runtime installation."
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro installBundledVCRedist

  ; Register devbox:// protocol handler
  WriteRegStr HKCR "devbox" "" "URL:DevBox Pro Protocol"
  WriteRegStr HKCR "devbox" "URL Protocol" ""
  WriteRegStr HKCR "devbox\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCR "devbox\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; Preserve portable mode across updates, and only infer portability from the
  ; install path for fresh installs.
  ${If} $R9 == 1
    FileOpen $1 "$INSTDIR\portable.flag" w
    FileClose $1
  ${Else}
    ; Treat both the machine-wide and per-user electron-builder defaults as standard.
    StrCpy $0 "$PROGRAMFILES64\${APP_FILENAME}"
    StrCpy $2 "$LOCALAPPDATA\Programs\${APP_FILENAME}"
    StrCpy $3 0

    ${If} "$INSTDIR" == "$0"
      StrCpy $3 1
    ${ElseIf} "$INSTDIR" == "$0\"
      StrCpy $3 1
    ${ElseIf} "$INSTDIR" == "$2"
      StrCpy $3 1
    ${ElseIf} "$INSTDIR" == "$2\"
      StrCpy $3 1
    ${EndIf}

    ${If} $3 == 0
      FileOpen $1 "$INSTDIR\portable.flag" w
      FileClose $1
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ; Remove protocol handler
  DeleteRegKey HKCR "devbox"
  ${ifNot} ${isUpdated}
    Delete "$INSTDIR\portable.flag"
  ${endif}
!macroend
