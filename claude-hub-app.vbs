' Claude Terminal Hub - Electron 앱 (창 깜빡임 없이 완전 무창 실행)
' 바탕화면/시작메뉴 바로가기로 쓰기 좋음. 더블클릭 시 cmd 플래시조차 없음.
CreateObject("WScript.Shell").Run """C:\Users\Syworks\claude-terminal-hub\node_modules\electron\dist\electron.exe"" ""C:\Users\Syworks\claude-terminal-hub\electron\main.js""", 0, False
