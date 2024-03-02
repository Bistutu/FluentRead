package logic

import "github.com/Bistutu/whatlanggo"

func DetectLanguage(origin string) string {
	info := whatlanggo.Detect(origin)
	return whatlanggo.Scripts[info.Script]
}
