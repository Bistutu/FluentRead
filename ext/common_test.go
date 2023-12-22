package ext

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"FluentRead/repo/db"
)

var (
	ctx = context.Background()
)

func TestCountCharacter(t *testing.T) {

	listNotTranslated, err := db.ListNotTranslated(ctx)
	assert.NoError(t, err)
	count := 0
	for _, item := range listNotTranslated {
		count += len(item.Source)
	}
	t.Log("未翻译的字符数：", count)
}
