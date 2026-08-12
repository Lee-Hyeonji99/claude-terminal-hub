!macro customInstall
  DetailPrint "Visual C++ Redistributable 확인/설치 중..."
  ExecWait '"$INSTDIR\resources\vc_redist.x64.exe" /install /quiet /norestart'
!macroend
