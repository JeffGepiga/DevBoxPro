; DevBox Pro NSIS Installer Script
!macro customInstall
  ; Register devbox:// protocol handler
  WriteRegStr HKCR "devbox" "" "URL:DevBox Pro Protocol"
  WriteRegStr HKCR "devbox" "URL Protocol" ""
  WriteRegStr HKCR "devbox\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCR "devbox\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  
  ; Add to PATH for CLI access
  ${EnvVarUpdate} $0 "PATH" "A" "HKCU" "$INSTDIR"
!macroend

!macro customUnInstall
  ; Remove protocol handler
  DeleteRegKey HKCR "devbox"
  
  ; Remove from PATH
  ${un.EnvVarUpdate} $0 "PATH" "R" "HKCU" "$INSTDIR"
!macroend
