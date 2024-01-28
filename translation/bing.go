package translation

import "github.com/hwfy/translate"

// BingTrans 必应翻译，发生错误返回空字符串
func BingTrans(origin string) string {
	// 任意语言转中文
	return translate.ToSimplifiedByBing(origin)
}
