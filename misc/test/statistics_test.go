package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"FluentRead/repo/db"
	"FluentRead/utils"
)

var (
	ctx = context.Background()
)

// 统计未翻译的字符数
func TestNotTransCountCharacter(t *testing.T) {

	listNotTranslated, err := db.ListNotTranslated(ctx)
	assert.NoError(t, err)
	count := 0
	for _, item := range listNotTranslated {
		count += len(item.Source)
	}
	countInKB := float64(count) / 1024
	t.Logf("未翻译字符数：%d 字符，约 %.2f KB", count, countInKB)
}

// 统计全部字符数
func TestCountCharacter(t *testing.T) {
	listNotTranslated, err := db.ListTrans(ctx)
	assert.NoError(t, err)
	count := 0
	for _, item := range listNotTranslated {
		count += len(item.Source)
	}
	// 将字符总数转换为KB，假设每个字符1字节
	countInKB := float64(count) / 1024
	t.Logf("全部字符数：%d 字符，约 %.2f KB", count, countInKB)
}

// 统计某网站的未翻译字符数
func TestNotTransCountCharacterByLink(t *testing.T) {
	link := utils.GetHost("https://platform.openai.com/")
	// 查询网站对应的pageId
	page, err := db.GetPageByLink(ctx, link)
	assert.NoError(t, err)
	trans, err := db.ListTrans(ctx)

	assert.NoError(t, err)
	count := 0
	for _, item := range trans {
		if item.PageId == page.ID {
			count += len(item.Target)
		}
	}
	countInKB := float64(count) / 1024
	t.Logf("%s 网站的字符数：%d 字符，约 %.2f KB", link, count, countInKB)
}
