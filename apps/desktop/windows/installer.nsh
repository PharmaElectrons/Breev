!include "FileFunc.nsh"
!include "LogicLib.nsh"

!macro RunBreevLifecycle ACTION
  ReadEnvStr $R8 "BREEV_WINDOWS_INJECT_FAILURE"
  ${If} $R8 == ""
    StrCpy $R8 "None"
  ${EndIf}

  DetailPrint "Running the Breev ${ACTION} lifecycle"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\windows-payload\lifecycle.ps1" -Action "${ACTION}" -InstallRoot "$INSTDIR" -PayloadRoot "$INSTDIR\resources\windows-payload" -InjectFailure "$R8"' $R9
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
  !insertmacro RunBreevLifecycle "Uninstall"
!macroend
