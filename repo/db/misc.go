package db

import (
	"context"

	"FluentRead/models"
)

// GetAllByPage 获取某个页面的所有短语
func GetAllByPage(ctx context.Context, page string) ([]*models.Translation, error) {
	var translations []*models.Translation
	// 准备子查询语句
	subQuery := db.Model(&models.Page{}).Select("id").Where("link = ?", page)
	// 主查询语句
	err := db.Where("page_id in (?)", subQuery).Find(&translations).Error
	if err != nil {
		return nil, err
	}
	return translations, nil
}
