; DevBox Pro NSIS Installer Script
; Use a general-purpose register to persist portable install detection between
; customInit and customInstall without introducing an extra NSIS user variable.

!macro customInit
  StrCpy $R9 0

  ${If} ${FileExists} "$INSTDIR\portable.flag"
    StrCpy $R9 1
  ${EndIf}
!macroend

!macro installBundledVCRedist
  StrCpy $4 "$INSTDIR\resources\vcredist\VC_redist.x64.exe"
  SetRegView 64
  ClearErrors
  ReadRegDWORD $5 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ${If} ${Errors}
    StrCpy $5 0
  ${EndIf}
  SetRegView 32

  ${If} $5 == 1
    DetailPrint "Microsoft Visual C++ Redistributable is already installed. Skipping runtime installation."
  ${ElseIf} ${FileExists} "$4"
    DetailPrint "Installing Microsoft Visual C++ Redistributable..."
    ExecWait '"$4" /install /quiet /norestart' $6

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
