package db

import (
	"context"

	"FluentRead/models"
)

// GetAllByPage 获取某个页面的所有短语
func GetAllByPage(ctx context.Context, page string) ([]*models.Translation, error) {
	var translations []*models.Translation
	// 子查询
	err := db.Where("page_id = (SELECT id FROM pages WHERE link = ?)", page).Find(&translations).Error
	if err != nil {
		return nil, err
	}
	return translations, nil
}
