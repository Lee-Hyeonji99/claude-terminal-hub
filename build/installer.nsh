!macro customInstall
  ; 자동 업데이트(--updated)로 덮어쓸 때는 이미 깔려 있으므로 건너뛴다
  ${ifNot} ${isUpdated}
    DetailPrint "Visual C++ Redistributable 확인/설치 중..."
    ExecWait '"$INSTDIR\resources\vc_redist.x64.exe" /install /quiet /norestart'
  ${endIf}
!macroend
