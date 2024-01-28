package logic

import (
	"context"
	"encoding/json"

	"FluentRead/misc/log"
	"FluentRead/models"
	"FluentRead/repo/cache"
	"FluentRead/repo/db"
)

const (
	prereadKey = "preread"
)

func PreRead(ctx context.Context) (map[string]string, error) {

	// 1、读缓存
	data, err := cache.GetKey(ctx, prereadKey)
	if err != nil {
		log.Warnf("获取缓存失败: %v", err)
	}
	if data != "" {
		var pageMap map[string]string
		err = json.Unmarshal([]byte(data), &pageMap)
		if err != nil {
			log.Errorf("解析缓存失败: %v", err)
			return nil, err
		}
		return pageMap, nil
	}

	// 2、读数据库
	pages, err := db.ListPages(ctx)
	if err != nil {
		log.Errorf("获取所有页面信息失败: %v", err)
		return nil, err
	}
	pageMap := models.PageToMap(pages)

	// 3、写缓存
	bytes, _ := json.Marshal(pageMap)
	err = cache.SetKey(ctx, prereadKey, bytes)
	if err != nil {
		log.Warnf("写入缓存失败: %v", err)
	}

	return pageMap, nil
}
