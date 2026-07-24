' Claude Terminal Hub - Electron 앱 (창 깜빡임 없이 완전 무창 실행)
' 바탕화면/시작메뉴 바로가기로 쓰기 좋음. 더블클릭 시 cmd 플래시조차 없음.
Dim fso, scriptDir
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & scriptDir & "\node_modules\electron\dist\electron.exe"" """ & scriptDir & "\electron\main.js""", 0, False
