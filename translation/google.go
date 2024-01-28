// Package translation 谷歌翻译
package translation

import gt "github.com/bas24/googletranslatefree"

// GoogleTrans 谷歌翻译
func GoogleTrans(origin string) (string, error) {
	result, err := gt.Translate(origin, "auto", "zh")
	return result, err
}
