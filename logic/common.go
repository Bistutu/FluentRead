package logic

import (
	"context"
	"fmt"
	"sync"

	"FluentRead/models"
	"FluentRead/repo/cache"
)

const (
	sentence = "sentence"
)

// 缓存翻译文本对象
func insertCache(ctx context.Context, translations []*models.Translation) error {
	keys := generateCacheKey(translations)
	cacheMap := sync.Map{}
	for k, v := range translations {
		cacheMap.Store(keys[k], v)
	}
	return cache.MSet(ctx, cacheMap)
}

// 批量生成单个短语的缓存键
func generateCacheKey(models []*models.Translation) []string {
	keys := make([]string, 0, len(models))
	for _, v := range models {
		// key 范例：sentence:pageId:hash
		key := fmt.Sprintf("%s:%d:%s", sentence, v.PageId, v.Hash)
		keys = append(keys, key)
	}
	return keys
}
