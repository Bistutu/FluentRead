package inspection

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"FluentRead/repo/db"
	"FluentRead/utils"
)

var ctx = context.Background()

func TestInsectDB(t *testing.T) {
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
