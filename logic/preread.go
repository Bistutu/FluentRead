package logic

import (
	"context"
	"encoding/json"
	"time"

	"FluentRead/misc/log"
	"FluentRead/models"
	"FluentRead/repo/cache"
	"FluentRead/repo/db"
)

const (
	prereadKey = "preread"
)

func PreRead(ctx context.Context) ([]string, error) {

	// 1、读缓存
	data, err := cache.GetKey(ctx, prereadKey)
	if err != nil {
		log.Warnf("获取缓存失败: %v", err)
	}
	if data != "" {
		var pageToStrings []string
		err = json.Unmarshal([]byte(data), &pageToStrings)
		if err != nil {
			log.Errorf("解析缓存失败: %v", err)
			return nil, err
		}
		return pageToStrings, nil
	}

	// 2、读数据库
	pages, err := db.ListAllPages(ctx)
	if err != nil {
		log.Errorf("获取所有页面信息失败: %v", err)
		return nil, err
	}
	pageToStrings := models.PageToStrings(pages)

	// 3、写缓存
	bytes, _ := json.Marshal(pageToStrings)
	err = cache.SetKeyWithTimeout(ctx, prereadKey, time.Millisecond, string(bytes))
	if err != nil {
		log.Warnf("写入缓存失败: %v", err)
	}

	return pageToStrings, nil
}
