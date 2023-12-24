package ext

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"

	"FluentRead/models"
	"FluentRead/repo/db"
)

var (
	ctx = context.Background()
)

// 翻译 db 中的数据
func TestAliTransData(t *testing.T) {
	count := 1
	list, err := db.ListNotTranslated(ctx)
	assert.NoError(t, err)
	for _, item := range list {
		// 每次翻译数量
		if count > 100 {
			return
		}
		translatedText, err := AliTrans(item.Source)
		assert.NoError(t, err)
		item.Target = translatedText
		item.Translated = true
		err = db.UpdateTrans(ctx, item)
		assert.NoError(t, err)
		fmt.Printf("第 %d 条翻译完成：%v\n", count, translatedText)
		count++
	}
}

// 并发翻译 db 中的数据
func TestAliTransDataParallel(t *testing.T) {
	list, err := db.ListNotTranslated(ctx)
	assert.NoError(t, err)

	// 创建一个并发限制的通道
	semaphore := make(chan struct{}, 8)

	// 创建一个等待组
	var wg sync.WaitGroup

	// 遍历列表并启动goroutine
	for i, item := range list {
		if i >= 2000 {
			break
		}

		// 添加到等待组
		wg.Add(1)

		temp := item
		// 启动goroutine
		go func(item *models.Translation) {
			defer wg.Done() // 确保在goroutine完成时通知等待组
			// 限制并发数
			semaphore <- struct{}{}
			// 执行翻译
			translatedText, err := AliTrans(item.Source)
			assert.NoError(t, err)
			// 更新item
			item.Target = translatedText
			item.Translated = true
			// 插入数据库
			err = db.InsertTrans(ctx, item)
			assert.NoError(t, err)

			fmt.Printf("翻译完成：%v\n", translatedText)
			// 释放一个并发槽
			<-semaphore
		}(temp)
	}

	// 等待所有goroutine完成
	wg.Wait()
	close(semaphore)
}

// 刷数据
func TestRefreshDB(t *testing.T) {
	list, err := db.ListTrans(ctx)
	assert.NoError(t, err)
	for _, item := range list {
		if item.Target == "" {
			item.Translated = false
		}
	}
	db.BatchInsert(ctx, list)
}
