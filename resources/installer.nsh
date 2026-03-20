; DevBox Pro NSIS Installer Script
; Use a general-purpose register to persist portable install detection between
; customInit and customInstall without introducing an extra NSIS user variable.

!macro customInit
  StrCpy $R9 0

  ${If} ${FileExists} "$INSTDIR\portable.flag"
    StrCpy $R9 1
  ${EndIf}
!macroend

!macro customInstall
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
