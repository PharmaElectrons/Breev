!include "FileFunc.nsh"
!include "LogicLib.nsh"

!macro RunBreevLifecycle ACTION
  ReadEnvStr $R8 "BREEV_WINDOWS_INJECT_FAILURE"
  ${If} $R8 == ""
    StrCpy $R8 "None"
  ${EndIf}

  DetailPrint "Running the Breev ${ACTION} lifecycle"
  StrCpy $R9 "-1"
  ClearErrors
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\windows-payload\lifecycle.ps1" -Action "${ACTION}" -InstallRoot "$INSTDIR" -PayloadRoot "$INSTDIR\resources\windows-payload" -InjectFailure "$R8"' $R9
  ${If} ${Errors}
    StrCpy $R9 "-1"
  ${EndIf}
  ${If} $R9 != 0
    DetailPrint "The Breev ${ACTION} lifecycle failed with exit code $R9"
    SetErrorLevel $R9
    Abort
  ${EndIf}
!macroend

!macro customInstall
  ${GetParameters} $R7
  ${GetOptions} $R7 "/repair" $R6
  ${If} ${Errors}
    !insertmacro RunBreevLifecycle "Install"
  ${Else}
    !insertmacro RunBreevLifecycle "Repair"
  ${EndIf}
!macroend

!macro customUnInstall
  ; This uninstaller only ever runs the data-preserving Uninstall action. It
  ; stops and removes the services and closes the LAN firewall rule, and leaves
  ; the pharmacy data and the pharmacy CA in place.
  ;
  ; Destroying pharmacy data is a separate, separately authorized action that
  ; no installer path reaches. An administrator runs it by hand from an
  ; elevated PowerShell:
  ;
  ;   powershell.exe -NoProfile -ExecutionPolicy Bypass
  ;     -File "$INSTDIR\resources\windows-payload\lifecycle.ps1"
  ;     -Action DestructiveUninstall -InstallRoot "$INSTDIR"
  ;     -PayloadRoot "$INSTDIR\resources\windows-payload"
  ;     -DataDestructionAuthorized -DestructionConfirmation destroy-pharmacy-data
  ;
  ; The uninstall lifecycle must never abort the uninstaller: any nonzero
  ; result here (including a PowerShell launch or parameter-binding failure
  ; the script itself cannot catch) would send electron-builder's
  ; uninstallOldVersion into its "cannot be closed" retry loop and block
  ; every reinstall. The lifecycle script is itself best-effort for
  ; Uninstall and records what it could not do.
  ReadEnvStr $R8 "BREEV_WINDOWS_INJECT_FAILURE"
  ${If} $R8 == ""
    StrCpy $R8 "None"
  ${EndIf}
  DetailPrint "Running the Breev Uninstall lifecycle"
  StrCpy $R9 "-1"
  ClearErrors
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\windows-payload\lifecycle.ps1" -Action "Uninstall" -InstallRoot "$INSTDIR" -PayloadRoot "$INSTDIR\resources\windows-payload" -InjectFailure "$R8"' $R9
  ${If} ${Errors}
    StrCpy $R9 "-1"
  ${EndIf}
  ${If} $R9 != 0
    DetailPrint "The Breev Uninstall lifecycle reported exit code $R9; continuing removal"
  ${EndIf}
!macroend
