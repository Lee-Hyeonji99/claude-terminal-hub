' Claude Terminal Hub - Electron 앱 (창 깜빡임 없이 완전 무창 실행)
' 바탕화면/시작메뉴 바로가기로 쓰기 좋음. 더블클릭 시 cmd 플래시조차 없음.
' MsgBox 문구는 코드페이지 충돌 방지를 위해 영어로 유지
Dim fso, shell, scriptDir, electronExe, brandedExe, mainJs
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = scriptDir & "\node_modules\electron\dist\electron.exe"
brandedExe = scriptDir & "\node_modules\electron\dist\Claude Terminal Hub.exe"
mainJs = scriptDir & "\electron\main.js"

If Not fso.FileExists(electronExe) Then
    Dim answer
    answer = MsgBox("Electron binary not found:" & vbCrLf & electronExe & vbCrLf & vbCrLf & _
        "Install it now via npm install? (may take a few minutes)", _
        vbYesNo + vbQuestion, "Claude Terminal Hub")
    If answer = vbNo Then
        WScript.Quit 1
    End If
    shell.Run "cmd /c cd /d """ & scriptDir & """ && npm install", 1, True
    If Not fso.FileExists(electronExe) Then
        shell.Run "cmd /c cd /d """ & scriptDir & """ && node node_modules\electron\install.js", 1, True
    End If
    If Not fso.FileExists(electronExe) Then
        MsgBox "Still missing after install. Please check manually.", vbCritical, "Claude Terminal Hub"
        WScript.Quit 1
    End If
End If

If Not fso.FileExists(brandedExe) Then
    shell.Run "cmd /c cd /d """ & scriptDir & """ && node electron\brand-exe.js", 1, True
End If

If fso.FileExists(brandedExe) Then
    shell.Run """" & brandedExe & """ """ & mainJs & """", 0, False
Else
    shell.Run """" & electronExe & """ """ & mainJs & """", 0, False
End If
