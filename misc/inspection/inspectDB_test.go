package inspection

import (
	"context"
	"fmt"
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"

	"FluentRead/repo/db"
	"FluentRead/utils"
)

var ctx = context.Background()

func TestAllEnglish(t *testing.T) {
	// 如果数据库中存在 target 为纯[英文+数字]的翻译，则删除
	transs, err := db.ListTrans(ctx)
	assert.NoError(t, err)

	for _, v := range transs {
		if utils.IsAllEnglishAndNum(v.Target) {
			t.Logf("纯[英文+数字]，删除：%+v", v)
			err := db.RemoveTrans(ctx, v)
			assert.NoError(t, err)
		}
	}
}

// 去除所有翻译后的前后中文双引号
func TestQuotation(t *testing.T) {
	ctx := context.Background()
	transs, err := db.ListTrans(ctx)
	assert.NoError(t, err)

	myRegex, _ := regexp.Compile(`^“(.*)”$`)
	for _, v := range transs {
		// 正则表达式提取中间的内容
		matches := myRegex.FindStringSubmatch(v.Target)
		if len(matches) > 1 {
			fmt.Println("去除前后的中文双引号：", v.Target)
			v.Target = matches[1]
			err := db.UpdateTrans(ctx, v)
			assert.NoError(t, err)
		}
	}
}
